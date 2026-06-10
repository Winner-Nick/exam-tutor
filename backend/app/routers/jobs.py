"""批改记录路由：提交作答（照片/PDF）、列表、详情、删除、页面图、SSE。

一条"批改记录"= 某学生对某试卷的一次作答提交（jobs 表 kind=submission）。
"""
from __future__ import annotations

import shutil

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from .. import auth, events, security, store, workers
from ..config import settings

router = APIRouter(prefix="/api", tags=["jobs"])

MAX_FILES_PER_SUBMISSION = 12  # 手机逐页拍照，留足页数


def _public(job: dict) -> dict:
    job.pop("user_id", None)
    job.pop("pdf_sha256", None)
    return job


@router.post("/submissions", status_code=201)
async def create_submission(
    paper_id: str = Form(...),
    student_id: int = Form(...),
    files: list[UploadFile] | None = File(default=None),
    use_paper_files: bool = Form(default=False),
    user: dict = Depends(auth.get_current_user),
):
    security.hit(f"upload:{user['id']}", 20, 3600, "提交过于频繁，请 1 小时后再试")
    if store.count_processing(user["id"]) >= settings.max_processing_per_user:
        raise HTTPException(429, "已有批改正在处理中，请稍后再提交")

    paper = store.get_paper(paper_id)
    if not paper or paper["user_id"] != user["id"]:
        raise HTTPException(404, "试卷不存在")
    if paper["status"] != "ready":
        raise HTTPException(409, "试卷尚未识别完成，暂不能批改")
    student = store.get_student(student_id)
    if not student or student["user_id"] != user["id"]:
        raise HTTPException(404, "学生不存在")
    if not use_paper_files and not files:
        raise HTTPException(400, "请上传作答的照片或 PDF")
    if files and len(files) > MAX_FILES_PER_SUBMISSION:
        raise HTTPException(400, f"一次最多上传 {MAX_FILES_PER_SUBMISSION} 个文件")

    job_id = store.new_job_id()
    manifest: list[dict] = []
    try:
        if use_paper_files:
            # 学生直接答在试卷上、试卷文件本身就含作答：复用试卷文件，
            # 视觉识别命中全量缓存，零额外成本
            for pf in store.list_paper_files(paper_id):
                src = store.paper_file_path(paper_id, pf["id"])
                if not src:
                    continue
                dest = store.job_dir(job_id) / "files" / (pf["id"] + src.suffix)
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dest)
                manifest.append({"id": pf["id"], "filename": pf["filename"],
                                 "sha256": pf["sha256"]})
        else:
            for f in files or []:
                fid = store.new_job_id()
                dest_stem = store.job_dir(job_id) / "files" / fid
                _, sha = await security.save_upload(f, dest_stem,
                                                    allow_pdf=True, allow_image=True)
                manifest.append({"id": fid, "filename": f.filename, "sha256": sha})
        if not manifest:
            raise HTTPException(400, "没有可用的作答文件")
        store.save_job_files(job_id, manifest)
    except HTTPException:
        shutil.rmtree(store.job_dir(job_id), ignore_errors=True)
        raise

    filename = manifest[0]["filename"] if manifest else None
    store.create_job(job_id, user["id"], filename, kind="submission",
                     paper_id=paper_id, student_id=student_id)
    workers.enqueue_job(job_id)
    return {"job_id": job_id}


@router.get("/jobs")
def list_jobs(student_id: int | None = None, paper_id: str | None = None,
              user: dict = Depends(auth.get_current_user)):
    return {"jobs": [_public(j) for j in store.list_jobs(user["id"], student_id, paper_id)]}


@router.get("/jobs/{job_id}")
def get_job(job: dict = Depends(auth.get_owned_job)):
    return _public(store.get_job_full(job["id"]))


@router.delete("/jobs/{job_id}")
def delete_job(job: dict = Depends(auth.get_owned_job)):
    if job["status"] == "processing":
        raise HTTPException(409, "正在处理中，暂不能删除")
    store.delete_job(job["id"])
    return {"ok": True}


@router.get("/jobs/{job_id}/events")
async def job_events(job: dict = Depends(auth.get_owned_job)):
    """SSE：进度 / 完成 / 出错 / 讲解就绪。连接后先推一条完整快照。"""
    snapshot = _public(dict(job))
    return StreamingResponse(
        events.sse_stream(job["id"], snapshot),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/jobs/{job_id}/page/{n}")
def page_image(n: int, job: dict = Depends(auth.get_owned_job)):
    if n < 1 or n > 999:
        raise HTTPException(404, "页面不存在")
    p = store.job_dir(job["id"]) / "pages" / f"page_{n:02d}.jpg"
    if not p.exists():
        raise HTTPException(404, "页面不存在")
    return FileResponse(p, media_type="image/jpeg")
