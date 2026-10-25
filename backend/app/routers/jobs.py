"""作答提交、文件补传、失败恢复、详情与 SSE。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from .. import auth, events, run_store, security, store, upload_utils, workers
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


def _idempotency_key(value: str | None) -> str | None:
    if value is not None and (not value or len(value) > run_store.IDEMPOTENCY_KEY_MAX_LENGTH):
        raise HTTPException(422, f"Idempotency-Key 长度需为 1-{run_store.IDEMPOTENCY_KEY_MAX_LENGTH}")
    return value


def _discard_job(job_id: str) -> None:
    if store.get_job(job_id):
        store.try_mark_job_deleting(job_id)
        store.delete_job(job_id)
    store.cleanup_path(store.JOBS_DIR / job_id)


def _cleanup_failed_job(job_id: str, owner_id: int) -> None:
    try:
        _discard_job(job_id)
    except OSError:
        workers.enqueue_job_cleanup({"id": job_id, "user_id": owner_id, "paper_id": None})


def _restore_job(job: dict) -> None:
    store.update_job(
        job["id"], status=job["status"], stage=job.get("stage"), error=job.get("error"),
        progress_done=job["progress"]["done"], progress_total=job["progress"]["total"],
        progress_label=job["progress"].get("label"),
    )


def _cleanup_new_files(job: dict, paths: list) -> None:
    failed = []
    for path in paths:
        try:
            store.cleanup_path(path)
        except OSError:
            failed.append(str(path))
    if failed:
        workers.enqueue_file_cleanup("job", job["id"], job["user_id"], failed)


async def _manifest_budget(manifest: list[dict], path_of) -> tuple[int, int]:
    total_bytes = total_pages = 0
    for index, item in enumerate(manifest, start=1):
        path = path_of(item["id"])
        if path is None:
            raise HTTPException(400, f"源文件缺失: {item.get('filename') or item['id']}")
        size, pages = await upload_utils.inspect_source_async(path, item.get("page_count"))
        total_bytes += size
        total_pages += pages
        upload_utils.check_file_budget(
            index, total_bytes, total_pages, max_files=MAX_FILES_PER_SUBMISSION,
        )
    return total_bytes, total_pages


async def _create_submission_resource(job_id: str, paper: dict, student_id: int,
                                      owner_id: int, files: list[UploadFile] | None,
                                      use_paper_files: bool, user: dict, key: str | None) -> dict:
    try:
        if key:
            _discard_job(job_id)
        security.hit(f"upload:{owner_id}", 20, 3600, "提交过于频繁，请 1 小时后再试")
        if not use_paper_files and not files:
            raise HTTPException(400, "请上传作答的照片或 PDF")
        if files and len(files) > MAX_FILES_PER_SUBMISSION:
            raise HTTPException(400, f"一次最多上传 {MAX_FILES_PER_SUBMISSION} 个文件")
        manifest: list[dict] = []
        if use_paper_files:
            paper_files = store.list_paper_files(paper["id"])
            if not paper_files:
                raise HTTPException(400, "没有可复用的试卷文件")
            await _manifest_budget(
                paper_files, lambda file_id: store.paper_file_path(paper["id"], file_id),
            )
            for paper_file in paper_files:
                src = store.paper_file_path(paper["id"], paper_file["id"])
                if src is None or not src.is_file():
                    raise HTTPException(400, f"复用的试卷源文件缺失: {paper_file.get('filename') or paper_file['id']}")
                dest = store.job_dir(job_id) / "files" / (paper_file["id"] + src.suffix)
                await upload_utils.link_or_copy(src, dest)
                manifest.append({
                    "id": paper_file["id"], "filename": paper_file["filename"],
                    "sha256": paper_file["sha256"], "page_count": paper_file.get("page_count"),
                })
        else:
            total_bytes = total_pages = 0
            for index, file in enumerate(files or [], start=1):
                fid = store.new_job_id()
                path, sha = await security.save_upload(
                    file, store.job_dir(job_id) / "files" / fid,
                    allow_pdf=True, allow_image=True,
                )
                size, pages = await upload_utils.inspect_source_async(path)
                total_bytes += size
                total_pages += pages
                upload_utils.check_file_budget(
                    index, total_bytes, total_pages, max_files=MAX_FILES_PER_SUBMISSION,
                )
                manifest.append({
                    "id": fid, "filename": file.filename, "sha256": sha, "page_count": pages,
                })
        if not manifest:
            raise HTTPException(400, "没有可用的作答文件，请上传或关闭复用试卷文件")
        store.save_job_files(job_id, manifest)
        store.create_job(
            job_id, owner_id, manifest[0]["filename"], kind="submission",
            paper_id=paper["id"], student_id=student_id,
            max_processing=settings.max_processing_per_user,
        )
        if key:
            run_store.mark_files_ready(user["id"], "create_submission", key)
    except store.ProcessingLimitError:
        _cleanup_failed_job(job_id, owner_id)
        if key:
            run_store.release_idempotency(user["id"], "create_submission", key)
        raise HTTPException(429, "已有任务正在处理中，请稍后再试") from None
    except Exception:
        _cleanup_failed_job(job_id, owner_id)
        if key:
            run_store.release_idempotency(user["id"], "create_submission", key)
        raise
    workers.enqueue_job(job_id)
    if key:
        run_store.complete_idempotency(user["id"], "create_submission", key)
    return {"job_id": job_id}


@router.post("/submissions", status_code=201)
async def create_submission(
    paper_id: str = Form(...),
    student_id: int = Form(...),
    files: list[UploadFile] | None = File(default=None),
    use_paper_files: bool = Form(default=False),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: dict = Depends(auth.get_current_user),
):
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
    key = _idempotency_key(idempotency_key)
    job_id = store.new_job_id()
    if key:
        async with run_store.async_idempotency_lock(user["id"], "create_submission", key):
            with run_store.idempotency_lock(user["id"], "create_submission", key):
                try:
                    job_id, duplicate = run_store.begin_idempotency(
                        user["id"], "create_submission", key, "job", job_id,
                    )
                except ValueError as exc:
                    raise HTTPException(409, str(exc)) from None
                if duplicate:
                    workers.enqueue_job(job_id)
                    return {"job_id": job_id}
                return await _create_submission_resource(
                    job_id, paper, student_id, owner_id, files, use_paper_files, user, key,
                )
    return await _create_submission_resource(
        job_id, paper, student_id, owner_id, files, use_paper_files, user, None,
    )


@router.post("/jobs/{job_id}/files", status_code=202)
async def add_submission_files(
    files: list[UploadFile] = File(...),
    job: dict = Depends(auth.get_owned_job),
):
    if job["kind"] != "submission":
        raise HTTPException(400, "旧版记录不支持补传")
    with store.job_lock(job["id"]):
        manifest = store.job_files(job["id"])
        remaining = MAX_FILES_PER_SUBMISSION - len(manifest)
        if not files or len(files) > remaining:
            raise HTTPException(400, f"还可上传 {max(0, remaining)} 个文件，总数不能超过 {MAX_FILES_PER_SUBMISSION} 个")
        security.hit(f"upload:{job['user_id']}", 20, 3600, "提交过于频繁，请 1 小时后再试")
        try:
            if not store.try_mark_job_processing(job["id"], settings.max_processing_per_user):
                raise HTTPException(409, "正在处理中，请稍后再补传")
        except store.ProcessingLimitError:
            raise HTTPException(429, "已有任务正在处理中，请稍后再试") from None
        created: list = []
        try:
            total_bytes, total_pages = await _manifest_budget(
                manifest, lambda file_id: store.job_file_path(job["id"], file_id),
            )
            for index, file in enumerate(files, start=len(manifest) + 1):
                fid = store.new_job_id()
                path, sha = await security.save_upload(
                    file, store.job_dir(job["id"]) / "files" / fid,
                    allow_pdf=True, allow_image=True,
                )
                created.append(path)
                size, pages = await upload_utils.inspect_source_async(path)
                total_bytes += size
                total_pages += pages
                upload_utils.check_file_budget(
                    index, total_bytes, total_pages, max_files=MAX_FILES_PER_SUBMISSION,
                )
                manifest.append({
                    "id": fid, "filename": file.filename, "sha256": sha, "page_count": pages,
                })
            store.save_job_files(job["id"], manifest)
        except Exception:
            _cleanup_new_files(job, created)
            _restore_job(job)
            raise
        workers.enqueue_job(job["id"])
    return {"ok": True, "file_count": len(manifest), "remaining": MAX_FILES_PER_SUBMISSION - len(manifest)}


def _retry_job(job: dict, *, force: bool = False):
    with store.job_lock(job["id"]):
        if job["kind"] == "submission" and not store.job_files(job["id"]):
            raise HTTPException(400, "没有可重试的文件，请先上传")
        if job["kind"] == "legacy" and not store.pdf_path(job["id"]).exists():
            raise HTTPException(400, "原始 PDF 不存在，无法重试")
        try:
            if not store.try_mark_job_processing(job["id"], settings.max_processing_per_user):
                raise HTTPException(409, "正在处理中，请稍后重试")
        except store.ProcessingLimitError:
            raise HTTPException(429, "已有任务正在处理中，请稍后再试") from None
        workers.enqueue_job(job["id"], force=force)
    return {"ok": True}


@router.post("/jobs/{job_id}/retry", status_code=202)
def retry_job(job: dict = Depends(auth.get_owned_job)):
    return _retry_job(job)


@router.post("/jobs/{job_id}/reprocess", status_code=202)
def reprocess_job(job: dict = Depends(auth.get_owned_job)):
    return _retry_job(job, force=True)


@router.post("/jobs/{job_id}/accept-partial")
def accept_partial(job: dict = Depends(auth.get_owned_job)):
    if job["status"] != "partial":
        raise HTTPException(409, "当前记录不是部分识别状态")
    if not store.get_questions(job["id"]):
        raise HTTPException(409, "没有可保留的识别结果")
    meta = dict(job.get("meta") or {})
    meta["accepted_partial"] = True
    source_partial = any(meta.get(key) for key in (
        "source_needs_review", "source_accepted_partial", "source_failed_pages",
    ))
    status = "partial" if source_partial else "done"
    error = "来源试卷仍需核对，不能接受为普通完成状态" if source_partial else None
    store.update_job(
        job["id"], status=status, error=error, meta=meta,
        stats=store.refresh_stats(job["id"]),
        progress_label="部分完成" if source_partial else "完成",
    )
    targets = [q["id"] for q in store.get_questions(job["id"])
               if q.get("status") in ("wrong", "unknown") and not q.get("explanation")]
    if targets and status == "done":
        workers.enqueue_explanations(job["id"], targets, priority=1)
    events.publish(job["id"], "job_done", {"status": status, "accepted_partial": True})
    return {"ok": True}


@router.delete("/jobs/{job_id}/files/{file_id}")
def delete_submission_file(
    file_id: str, job: dict = Depends(auth.get_owned_job),
    user: dict = Depends(auth.require_teacher),
):
    with store.job_lock(job["id"]):
        if job["status"] == "processing":
            raise HTTPException(409, "正在处理中，暂不能删除文件")
        manifest = store.job_files(job["id"])
        target = next((item for item in manifest if item["id"] == file_id), None)
        if not target:
            raise HTTPException(404, "文件不存在")
        if len(manifest) <= 1:
            raise HTTPException(409, "至少保留一份文件；如需移除全部，请删除整条批改记录")
        try:
            if not store.try_mark_job_processing(job["id"], settings.max_processing_per_user):
                raise HTTPException(409, "正在处理中，请稍后再试")
        except store.ProcessingLimitError:
            raise HTTPException(429, "已有任务正在处理中，请稍后再试") from None
        remaining = [item for item in manifest if item["id"] != file_id]
        try:
            store.save_job_files(job["id"], remaining)
        except Exception:
            _restore_job(job)
            raise
        path = store.job_file_path(job["id"], file_id)
        if path:
            store.cleanup_path(path)
        if target.get("sha256"):
            store.cleanup_answer_cache(job["paper_id"], target["sha256"])
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
    with store.job_lock(job["id"]):
        if job["status"] == "processing":
            raise HTTPException(409, "正在处理中，暂不能删除")
        if not store.try_mark_job_deleting(job["id"]):
            raise HTTPException(409, "记录正在处理中，暂不能删除")
        workers.enqueue_job_cleanup(job)
        if not store.delete_job(job["id"]):
            raise HTTPException(409, "记录正在处理中，暂不能删除")
    return {"ok": True}


@router.get("/jobs/{job_id}/events")
def job_events(job: dict = Depends(auth.get_owned_job)):
    return StreamingResponse(
        events.sse_stream(job["id"], lambda: _public(store.get_job_full(job["id"]), full=True)),
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
