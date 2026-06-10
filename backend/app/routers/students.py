"""学生管理：老师账号下的学生增删改查（"我自己"自动创建、不可删）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from .. import auth, store
from ..models import StudentRequest

router = APIRouter(prefix="/api/students", tags=["students"])

MAX_STUDENTS = 100


@router.get("")
def list_students(user: dict = Depends(auth.get_current_user)):
    store.ensure_self_student(user["id"])
    return {"students": store.list_students(user["id"])}


@router.post("")
def create_student(req: StudentRequest, user: dict = Depends(auth.get_current_user)):
    if len(store.list_students(user["id"])) >= MAX_STUDENTS:
        raise HTTPException(400, f"学生数量已达上限 {MAX_STUDENTS}")
    name = req.name.strip()
    if not name:
        raise HTTPException(400, "学生姓名不能为空")
    if any(s["name"] == name for s in store.list_students(user["id"])):
        raise HTTPException(409, "已存在同名学生")
    return store.create_student(user["id"], name)


@router.patch("/{student_id}")
def rename_student(req: StudentRequest, student: dict = Depends(auth.get_owned_student)):
    name = req.name.strip()
    if not name:
        raise HTTPException(400, "学生姓名不能为空")
    store.rename_student(student["id"], name)
    return store.get_student(student["id"])


@router.delete("/{student_id}")
def delete_student(student: dict = Depends(auth.get_owned_student)):
    if student["is_self"]:
        raise HTTPException(400, "不能删除“我自己”")
    if store.count_student_submissions(student["id"]):
        raise HTTPException(409, "该学生名下已有批改记录，请先删除对应记录")
    store.delete_student(student["id"])
    return {"ok": True}
