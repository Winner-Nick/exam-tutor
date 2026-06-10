"""用户反馈：提交时自动附带客户端诊断信息（设备/内核/JS 报错），管理员查看。"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Request

from .. import auth, security, store
from ..models import FeedbackRequest

router = APIRouter(prefix="/api", tags=["feedback"])


@router.post("/feedback", status_code=201)
def submit_feedback(req: FeedbackRequest, request: Request,
                    user: dict = Depends(auth.get_current_user)):
    security.hit(f"feedback:{user['id']}", 10, 3600, "反馈过于频繁，请稍后再试")
    diag = req.diag if isinstance(req.diag, dict) else {}
    if len(json.dumps(diag)) > 8000:  # 防恶意超大诊断体
        diag = {"truncated": True}
    fid = store.add_feedback(
        user["id"], req.message.strip() or None, req.page.strip() or None, diag,
    )
    return {"id": fid}


@router.get("/admin/feedback")
def list_feedback(user: dict = Depends(auth.require_admin)):
    return {"feedback": store.list_feedback()}


@router.delete("/admin/feedback/{feedback_id}")
def delete_feedback(feedback_id: int, user: dict = Depends(auth.require_admin)):
    if not store.delete_feedback(feedback_id):
        raise HTTPException(404, "反馈不存在")
    return {"ok": True}
