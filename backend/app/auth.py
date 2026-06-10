"""认证：bcrypt 密码哈希 + JWT 会话（httpOnly cookie）。

选 cookie 而非 Authorization 头：EventSource(SSE) 与 <img> 标签无法自定义
请求头，cookie 是它们唯一的鉴权通道；HttpOnly 同时免疫 XSS 窃取。
CSRF 由 SameSite=Lax + 写请求 Origin 校验（security.py）兜底。
"""
from __future__ import annotations

import time

import bcrypt
import jwt
from fastapi import Cookie, Depends, HTTPException, Response

from . import store
from .config import settings

COOKIE_NAME = "et_session"
TOKEN_TTL = 7 * 86400  # 7 天；剩余不足一半时自动续签


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))
    except ValueError:
        return False


def create_token(user: dict) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user["id"]),
        "username": user["username"],
        "role": user["role"],
        "iat": now,
        "exp": now + TOKEN_TTL,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME, token,
        max_age=TOKEN_TTL, httponly=True, samesite="lax",
        secure=settings.cookie_secure, path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


def get_current_user(
    response: Response,
    et_session: str | None = Cookie(default=None, alias=COOKIE_NAME),
) -> dict:
    if not et_session:
        raise HTTPException(401, "请先登录")
    payload = decode_token(et_session)
    if not payload:
        raise HTTPException(401, "登录已过期，请重新登录")
    user = store.get_user(int(payload["sub"]))
    if not user:
        raise HTTPException(401, "账号不存在")
    if payload["exp"] - time.time() < TOKEN_TTL / 2:
        set_session_cookie(response, create_token(user))
    return user


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(403, "需要管理员权限")
    return user


def get_owned_job(job_id: str, user: dict = Depends(get_current_user)) -> dict:
    """作业归属校验。查无与不属于均返回 404，不泄露作业是否存在。"""
    job = store.get_job(job_id)
    if not job or job["user_id"] != user["id"]:
        raise HTTPException(404, "作业不存在")
    return job
