"""学生管理：老师账号下的学生增删改查 + 学生登录账号的创建/重置/注销。

学生账号（users.role='student'）挂在老师的 user_id 与一条学生档案上：
批改数据归老师所有，学生端只能看到并操作「自己档案」下的提交。
"""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request

from .. import auth, security, store
from ..models import StudentAccountPasswordRequest, StudentAccountRequest, StudentRequest

router = APIRouter(prefix="/api/students", tags=["students"])

MAX_STUDENTS = 100


@router.get("")
def list_students(user: dict = Depends(auth.get_current_user)):
    # 学生账号只看自己的档案（供上传页自动选中自己）
    if user["role"] == "student":
        st = store.get_student(user["student_id"])
        return {"students": [st] if st else []}
    store.ensure_self_student(user["id"])
    return {"students": store.list_students(user["id"])}


@router.post("")
def create_student(req: StudentRequest, user: dict = Depends(auth.require_teacher)):
    if len(store.list_students(user["id"])) >= MAX_STUDENTS:
        raise HTTPException(400, f"学生数量已达上限 {MAX_STUDENTS}")
    name = req.name.strip()
    if not name:
        raise HTTPException(400, "学生姓名不能为空")
    if any(s["name"] == name for s in store.list_students(user["id"])):
        raise HTTPException(409, "已存在同名学生")
    return store.create_student(user["id"], name)


@router.patch("/{student_id}")
def rename_student(req: StudentRequest, student: dict = Depends(auth.get_owned_student),
                   user: dict = Depends(auth.require_teacher)):
    name = req.name.strip()
    if not name:
        raise HTTPException(400, "学生姓名不能为空")
    store.rename_student(student["id"], name)
    return store.get_student(student["id"])


@router.delete("/{student_id}")
def delete_student(student: dict = Depends(auth.get_owned_student),
                   user: dict = Depends(auth.require_teacher)):
    if student["is_self"]:
        raise HTTPException(400, "不能删除“我自己”")
    if store.count_student_submissions(student["id"]):
        raise HTTPException(409, "该学生名下已有批改记录，请先删除对应记录")
    # 连同登录账号一起注销（如有）
    store.delete_student_account(student["id"])
    try:
        store.delete_student(student["id"])
    except sqlite3.IntegrityError:
        # 检查与删除之间恰好产生了新提交
        raise HTTPException(409, "该学生名下已有批改记录，请先删除对应记录") from None
    return {"ok": True}


# ---------------------------------------------------------------------------
# 学生登录账号
# ---------------------------------------------------------------------------

@router.post("/{student_id}/account", status_code=201)
def create_account(req: StudentAccountRequest, request: Request,
                   student: dict = Depends(auth.get_owned_student),
                   user: dict = Depends(auth.require_teacher)):
    """给学生档案开通登录账号。学生登录后可自助上传作答、查看批改与讲解。"""
    security.hit(f"mkacct:{user['id']}", 20, 3600, "创建过于频繁，请稍后再试")
    username = req.username.strip()
    if store.get_account_for_student(student["id"]):
        raise HTTPException(409, "该学生已有账号，可重置密码或先注销")
    if store.get_user_by_username(username):
        raise HTTPException(409, "用户名已被占用")
    uid = store.create_student_account(user["id"], student["id"], username,
                                       auth.hash_password(req.password))
    return {"id": uid, "username": username}


@router.post("/{student_id}/account/password")
def reset_account_password(req: StudentAccountPasswordRequest,
                           student: dict = Depends(auth.get_owned_student),
                           user: dict = Depends(auth.require_teacher)):
    """老师重置学生账号密码（学生忘记密码时）。"""
    acct = store.get_account_for_student(student["id"])
    if not acct:
        raise HTTPException(404, "该学生还没有登录账号")
    store.set_password(acct["id"], auth.hash_password(req.password))
    return {"ok": True}


@router.delete("/{student_id}/account")
def delete_account(student: dict = Depends(auth.get_owned_student),
                   user: dict = Depends(auth.require_teacher)):
    """注销学生登录账号（批改数据保留，学生无法再登录）。"""
    if not store.delete_student_account(student["id"]):
        raise HTTPException(404, "该学生还没有登录账号")
    return {"ok": True}
