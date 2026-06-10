"""认证路由：注册（邀请码）、登录、登出、当前用户、改密码、邀请码管理。"""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from .. import auth, security, store
from ..config import settings
from ..models import ChangePasswordRequest, InviteCreateRequest, LoginRequest, RegisterRequest

router = APIRouter(prefix="/api/auth", tags=["auth"])
admin_router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/register")
def register(req: RegisterRequest, request: Request, response: Response):
    security.hit(f"register:{security.client_ip(request)}", 5, 60)

    bootstrap = store.count_users() == 0  # 首个用户：免邀请码并成为管理员
    if not bootstrap and not settings.allow_open_register:
        if not req.invite_code or not store.consume_invite(req.invite_code.strip()):
            raise HTTPException(400, "邀请码无效或已用完")

    try:
        user_id = store.create_user(
            req.username.strip(),
            auth.hash_password(req.password),
            role="admin" if bootstrap else "user",
        )
    except sqlite3.IntegrityError:
        raise HTTPException(400, "用户名已被占用") from None

    user = store.get_user(user_id)
    auth.set_session_cookie(response, auth.create_token(user))
    return {"id": user_id, "username": user["username"], "role": user["role"]}


@router.post("/login")
def login(req: LoginRequest, request: Request, response: Response):
    security.hit(f"login:{security.client_ip(request)}", 5, 60, "登录尝试过于频繁，请 1 分钟后再试")

    user = store.get_user_by_username(req.username.strip())
    if not user or not auth.verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "用户名或密码错误")

    auth.set_session_cookie(response, auth.create_token(user))
    return {"id": user["id"], "username": user["username"], "role": user["role"]}


@router.post("/logout")
def logout(response: Response):
    auth.clear_session_cookie(response)
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(auth.get_current_user)):
    return {"id": user["id"], "username": user["username"], "role": user["role"]}


@router.post("/password")
def change_password(req: ChangePasswordRequest, user: dict = Depends(auth.get_current_user)):
    if not auth.verify_password(req.old_password, user["password_hash"]):
        raise HTTPException(400, "原密码错误")
    store.set_password(user["id"], auth.hash_password(req.new_password))
    return {"ok": True}


@admin_router.post("/invites")
def create_invite(req: InviteCreateRequest, user: dict = Depends(auth.require_admin)):
    code = store.create_invite(user["id"], max_uses=req.max_uses, ttl_days=req.ttl_days)
    return {"code": code}


@admin_router.get("/invites")
def list_invites(user: dict = Depends(auth.require_admin)):
    return {"invites": store.list_invites()}


@admin_router.delete("/invites/{code}")
def revoke_invite(code: str, user: dict = Depends(auth.require_admin)):
    if not store.delete_invite(code):
        raise HTTPException(404, "邀请码不存在")
    return {"ok": True}
