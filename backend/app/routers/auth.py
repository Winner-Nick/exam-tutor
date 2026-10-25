"""认证路由：注册（邀请码）、登录、登出、当前用户、改密码、邀请码管理。"""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from .. import auth, security, store
from ..config import settings
from ..db import transaction
from ..models import (
    AdminPasswordRequest, ChangePasswordRequest, InviteCreateRequest,
    LoginRequest, RegisterRequest,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
admin_router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/registration-options")
def registration_options():
    return {"bootstrap": store.count_users() == 0,
            "allow_open_register": settings.allow_open_register}


@router.post("/register")
def register(req: RegisterRequest, request: Request, response: Response):
    security.hit(f"register:{security.client_ip(request)}", 5, 60)
    username = req.username.strip()
    password_hash = auth.hash_password(req.password)
    try:
        with transaction():
            if store.get_user_by_username(username):
                raise HTTPException(400, "用户名已被占用")
            bootstrap = store.count_users() == 0
            if not bootstrap and not settings.allow_open_register:
                code = (req.invite_code or "").strip()
                if not code or not store.consume_invite(code):
                    raise HTTPException(400, "邀请码无效或已用完")
            user_id = store.create_user(
                username, password_hash, role="admin" if bootstrap else "user"
            )
    except sqlite3.IntegrityError:
        raise HTTPException(400, "用户名已被占用") from None

    user = store.get_user(user_id)
    auth.set_session_cookie(response, auth.create_token(user))
    return {"id": user_id, "username": user["username"], "role": user["role"]}


@router.post("/login")
def login(req: LoginRequest, request: Request, response: Response):
    ip = security.client_ip(request)
    username = req.username.strip()
    account_key = f"login-account:{username.casefold()}:{ip}"
    security.hit(f"login-ip:{ip}", 60, 300, "登录尝试过于频繁，请稍后再试")
    security.hit(account_key, 5, 300, "该账号登录失败次数较多，请 5 分钟后再试")

    user = store.get_user_by_username(username)
    if not user or not auth.verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "用户名或密码错误")

    security.clear(account_key)
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
def change_password(req: ChangePasswordRequest, request: Request, response: Response,
                    user: dict = Depends(auth.get_current_user)):
    security.hit(f"pwd:{user['id']}:{security.client_ip(request)}", 5, 300, "尝试过于频繁，请 5 分钟后再试")
    if not auth.verify_password(req.old_password, user["password_hash"]):
        raise HTTPException(400, "原密码错误")
    store.set_password(user["id"], auth.hash_password(req.new_password))
    refreshed = store.get_user(user["id"])
    auth.set_session_cookie(response, auth.create_token(refreshed))
    return {"ok": True}


@admin_router.get("/users")
def list_users(user: dict = Depends(auth.require_admin)):
    return {"users": store.list_users()}


@admin_router.post("/users/{user_id}/password")
def reset_user_password(user_id: int, req: AdminPasswordRequest, response: Response,
                        user: dict = Depends(auth.require_admin)):
    target = store.get_user(user_id)
    if not target:
        raise HTTPException(404, "用户不存在")
    store.set_password(user_id, auth.hash_password(req.password))
    if user_id == user["id"]:
        refreshed = store.get_user(user_id)
        auth.set_session_cookie(response, auth.create_token(refreshed))
    return {"ok": True, "id": user_id}


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
