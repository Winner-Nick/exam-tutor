"""作业路由：上传、列表、详情、删除、页面图。"""
from __future__ import annotations

import shutil
import threading

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .. import auth, pipeline, security, store
from ..config import settings

router = APIRouter(prefix="/api", tags=["jobs"])


def _public(job: dict) -> dict:
    job.pop("user_id", None)
    return job


@router.post("/upload")
async def upload(file: UploadFile = File(...), user: dict = Depends(auth.get_current_user)):
    security.hit(f"upload:{user['id']}", 5, 3600, "上传过于频繁，请 1 小时后再试")
    if store.count_processing(user["id"]) >= settings.max_processing_per_user:
        raise HTTPException(429, "已有作业正在处理中，请稍后再上传")
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "请上传 PDF 文件")

    job_id = store.new_job_id()
    try:
        sha256 = await security.save_upload_pdf(file, store.pdf_path(job_id))
    except HTTPException:
        shutil.rmtree(store.job_dir(job_id), ignore_errors=True)
        raise

    store.create_job(job_id, user["id"], file.filename, pdf_sha256=sha256)
    threading.Thread(target=pipeline.process_job, args=(job_id,), daemon=True).start()
    return {"job_id": job_id}


@router.get("/jobs")
def list_jobs(user: dict = Depends(auth.get_current_user)):
    return {"jobs": [_public(j) for j in store.list_jobs(user["id"])]}


@router.get("/jobs/{job_id}")
def get_job(job: dict = Depends(auth.get_owned_job)):
    return _public(store.get_job_full(job["id"]))


@router.delete("/jobs/{job_id}")
def delete_job(job: dict = Depends(auth.get_owned_job)):
    if job["status"] == "processing":
        raise HTTPException(409, "作业正在处理中，暂不能删除")
    store.delete_job(job["id"])
    return {"ok": True}


@router.get("/jobs/{job_id}/page/{n}")
def page_image(n: int, job: dict = Depends(auth.get_owned_job)):
    if n < 1 or n > 999:
        raise HTTPException(404, "页面不存在")
    p = store.job_dir(job["id"]) / "pages" / f"page_{n:02d}.jpg"
    if not p.exists():
        raise HTTPException(404, "页面不存在")
    return FileResponse(p, media_type="image/jpeg")
