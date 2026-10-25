"""作答提交、文件补传、失败恢复、详情与 SSE。"""
from __future__ import annotations

import shutil

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from .. import auth, events, security, store, workers
from ..config import settings

router = APIRouter(prefix="/api", tags=["jobs"])

MAX_FILES_PER_SUBMISSION = 12


def _public(job: dict, full: bool = False) -> dict:
    job.pop("user_id", None)
    job.pop("pdf_sha256", None)
    meta = job.get("meta") or {}
    job["failed_pages"] = meta.get("failed_pages") or []
    job["accepted_partial"] = bool(meta.get("accepted_partial"))
    if full:
        job["files"] = [
            {"id": f["id"], "kind": "submission", "filename": f.get("filename"),
             "page_start": None, "page_count": None}
            for f in store.job_files(job["id"])
        ]
    return job


def _cleanup_answer_cache(paper_id: str, sha256: str) -> None:
    for other_id in store.list_submission_ids_for_paper(paper_id):
        if any(f.get("sha256") == sha256 for f in store.job_files(other_id)):
            return
    store.vision_cache_path(sha256, f"ans-{paper_id}").unlink(missing_ok=True)


@router.post("/submissions", status_code=201)
async def create_submission(
    paper_id: str = Form(...),
    student_id: int = Form(...),
    files: list[UploadFile] | None = File(default=None),
    use_paper_files: bool = Form(default=False),
    user: dict = Depends(auth.get_current_user),
):
    security.hit(f"upload:{user['id']}", 20, 3600, "提交过于频繁，请 1 小时后再试")
    if user["role"] == "student":
        owner_id, student_id = user["teacher_id"], user["student_id"]
        use_paper_files = False
    else:
        owner_id = user["id"]
    paper = store.get_paper(paper_id)
    if not paper or paper["user_id"] != owner_id:
        raise HTTPException(404, "试卷不存在")
    if paper["status"] != "ready" or not store.get_paper_questions(paper_id):
        raise HTTPException(409, "试卷尚未准备好，请先补齐题目并处理识别失败页")
    student = store.get_student(student_id)
    if not student or student["user_id"] != owner_id:
        raise HTTPException(404, "学生不存在")
    if not use_paper_files and not files:
        raise HTTPException(400, "请上传作答的照片或 PDF")
    if files and len(files) > MAX_FILES_PER_SUBMISSION:
        raise HTTPException(400, f"一次最多上传 {MAX_FILES_PER_SUBMISSION} 个文件")

    job_id = store.new_job_id()
    manifest: list[dict] = []
    try:
        if use_paper_files:
            for pf in store.list_paper_files(paper_id):
                src = store.paper_file_path(paper_id, pf["id"])
                if not src:
                    continue
                dest = store.job_dir(job_id) / "files" / (pf["id"] + src.suffix)
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dest)
                manifest.append({"id": pf["id"], "filename": pf["filename"], "sha256": pf["sha256"]})
        else:
            for f in files or []:
                fid = store.new_job_id()
                _, sha = await security.save_upload(
                    f, store.job_dir(job_id) / "files" / fid,
                    allow_pdf=True, allow_image=True,
                )
                manifest.append({"id": fid, "filename": f.filename, "sha256": sha})
        if not manifest:
            raise HTTPException(400, "没有可用的作答文件，请上传或关闭复用试卷文件")
        store.save_job_files(job_id, manifest)
        store.create_job(
            job_id, owner_id, manifest[0]["filename"], kind="submission",
            paper_id=paper_id, student_id=student_id,
            max_processing=settings.max_processing_per_user,
        )
    except store.ProcessingLimitError:
        shutil.rmtree(store.job_dir(job_id), ignore_errors=True)
        raise HTTPException(429, "已有任务正在处理中，请稍后再提交") from None
    except Exception:
        shutil.rmtree(store.job_dir(job_id), ignore_errors=True)
        raise
    workers.enqueue_job(job_id)
    return {"job_id": job_id}


@router.post("/jobs/{job_id}/files", status_code=202)
async def add_submission_files(
    files: list[UploadFile] = File(...),
    job: dict = Depends(auth.get_owned_job),
):
    if job["kind"] != "submission":
        raise HTTPException(400, "旧版记录不支持补传")
    manifest = store.job_files(job["id"])
    remaining = MAX_FILES_PER_SUBMISSION - len(manifest)
    if not files or len(files) > remaining:
        raise HTTPException(400, f"还可上传 {max(0, remaining)} 个文件，总数不能超过 {MAX_FILES_PER_SUBMISSION} 个")
    if not store.try_mark_job_processing(job["id"]):
        raise HTTPException(409, "正在处理中，请稍后再补传")
    created: list = []
    try:
        for f in files:
            fid = store.new_job_id()
            path, sha = await security.save_upload(
                f, store.job_dir(job["id"]) / "files" / fid,
                allow_pdf=True, allow_image=True,
            )
            created.append(path)
            manifest.append({"id": fid, "filename": f.filename, "sha256": sha})
        store.save_job_files(job["id"], manifest)
    except Exception:
        for path in created:
            path.unlink(missing_ok=True)
        store.update_job(
            job["id"], status=job["status"], stage=job.get("stage"), error=job.get("error"),
            progress_done=job["progress"]["done"], progress_total=job["progress"]["total"],
            progress_label=job["progress"].get("label"),
        )
        raise
    workers.enqueue_job(job["id"])
    return {"ok": True, "file_count": len(manifest), "remaining": MAX_FILES_PER_SUBMISSION - len(manifest)}


@router.post("/jobs/{job_id}/retry", status_code=202)
def retry_job(job: dict = Depends(auth.get_owned_job)):
    if job["kind"] == "submission" and not store.job_files(job["id"]):
        raise HTTPException(400, "没有可重试的文件，请先上传")
    if job["kind"] == "legacy" and not store.pdf_path(job["id"]).exists():
        raise HTTPException(400, "原始 PDF 不存在，无法重试")
    if not store.try_mark_job_processing(job["id"]):
        raise HTTPException(409, "正在处理中，请稍后重试")
    workers.enqueue_job(job["id"])
    return {"ok": True}


@router.post("/jobs/{job_id}/accept-partial")
def accept_partial(job: dict = Depends(auth.get_owned_job)):
    if job["status"] != "partial":
        raise HTTPException(409, "当前记录不是部分识别状态")
    if not store.get_questions(job["id"]):
        raise HTTPException(409, "没有可保留的识别结果")
    meta = dict(job.get("meta") or {})
    meta["accepted_partial"] = True
    store.update_job(job["id"], status="done", error=None, meta=meta, stats=store.refresh_stats(job["id"]))
    targets = [q["id"] for q in store.get_questions(job["id"])
               if q.get("status") in ("wrong", "unknown") and not q.get("explanation")]
    if targets:
        workers.enqueue_explanations(job["id"], targets, priority=1)
    events.publish(job["id"], "job_done", {"status": "done", "accepted_partial": True})
    return {"ok": True}


@router.delete("/jobs/{job_id}/files/{file_id}")
def delete_submission_file(
    file_id: str, job: dict = Depends(auth.get_owned_job),
    user: dict = Depends(auth.require_teacher),
):
    if job["status"] == "processing":
        raise HTTPException(409, "正在处理中，暂不能删除文件")
    manifest = store.job_files(job["id"])
    target = next((f for f in manifest if f["id"] == file_id), None)
    if not target:
        raise HTTPException(404, "文件不存在")
    if len(manifest) <= 1:
        raise HTTPException(409, "至少保留一份文件；如需移除全部，请删除整条批改记录")
    path = store.job_file_path(job["id"], file_id)
    remaining = [f for f in manifest if f["id"] != file_id]
    store.save_job_files(job["id"], remaining)
    if path:
        path.unlink(missing_ok=True)
    if target.get("sha256"):
        _cleanup_answer_cache(job["paper_id"], target["sha256"])
    store.try_mark_job_processing(job["id"])
    workers.enqueue_job(job["id"])
    return {"ok": True, "file_count": len(remaining)}


@router.get("/jobs")
def list_jobs(
    student_id: int | None = None, paper_id: str | None = None,
    q: str | None = None, limit: int = 12, offset: int = 0,
    user: dict = Depends(auth.get_current_user),
):
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    if user["role"] == "student":
        owner_id, student_id = user["teacher_id"], user["student_id"]
    else:
        owner_id = user["id"]
    jobs, total = store.list_jobs_page(owner_id, student_id, paper_id, q, limit, offset)
    return {"jobs": [_public(j) for j in jobs], "total": total, "limit": limit, "offset": offset}


@router.get("/jobs/{job_id}")
def get_job(job: dict = Depends(auth.get_owned_job)):
    return _public(store.get_job_full(job["id"]), full=True)


@router.delete("/jobs/{job_id}")
def delete_job(
    job: dict = Depends(auth.get_owned_job),
    user: dict = Depends(auth.require_teacher),
):
    if job["status"] == "processing":
        raise HTTPException(409, "正在处理中，暂不能删除")
    files = store.job_files(job["id"])
    store.delete_job(job["id"])
    if job.get("paper_id"):
        for f in files:
            if f.get("sha256"):
                _cleanup_answer_cache(job["paper_id"], f["sha256"])
    return {"ok": True}


@router.get("/jobs/{job_id}/events")
def job_events(job: dict = Depends(auth.get_owned_job)):
    snapshot = _public(store.get_job_full(job["id"]), full=True)
    return StreamingResponse(
        events.sse_stream(job["id"], snapshot),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/jobs/{job_id}/page/{n}")
def page_image(n: int, job: dict = Depends(auth.get_owned_job)):
    if n < 1 or n > 999:
        raise HTTPException(404, "页面不存在")
    path = store.job_dir(job["id"]) / "pages" / f"page_{n:02d}.jpg"
    if not path.exists():
        raise HTTPException(404, "页面不存在")
    return FileResponse(path, media_type="image/jpeg")
