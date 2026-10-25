"""试卷、文件、题目编辑、识别恢复与知识点管理。"""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from .. import auth, events, pipeline, security, store, workers
from ..config import settings
from ..models import (
    KnowledgePointsRequest,
    PaperQuestionCreateRequest,
    PaperQuestionPatchRequest,
    PaperUpdateRequest,
)

router = APIRouter(prefix="/api/papers", tags=["papers"])

MAX_FILES_PER_REQUEST = 30
_FILE_KINDS = {"mixed", "questions", "answers"}


def _public(paper: dict, full: bool = False) -> dict:
    paper.pop("user_id", None)
    meta = paper.get("meta") or {}
    paper["failed_pages"] = meta.get("failed_pages") or []
    paper["accepted_partial"] = bool(meta.get("accepted_partial"))
    if full:
        paper["questions"] = store.get_paper_questions(paper["id"])
        paper["files"] = [
            {"id": f["id"], "kind": f["kind"], "filename": f["filename"],
             "page_start": f["page_start"], "page_count": f["page_count"]}
            for f in store.list_paper_files(paper["id"])
        ]
    return paper


async def _save_paper_files(paper_id: str, files: list[UploadFile], kind: str) -> None:
    created: list[str] = []
    try:
        for f in files:
            fid = store.add_paper_file(paper_id, kind, f.filename, None)
            created.append(fid)
            _, sha = await security.save_upload(
                f, store.paper_dir(paper_id) / "files" / fid,
                allow_pdf=True, allow_image=True,
            )
            store.set_paper_file_sha(fid, sha)
    except Exception:
        for fid in created:
            path = store.paper_file_path(paper_id, fid)
            if path:
                path.unlink(missing_ok=True)
            store.delete_paper_file(fid, paper_id)
        raise


def _mark_partial(paper: dict, message: str) -> None:
    meta = dict(paper.get("meta") or {})
    meta["accepted_partial"] = False
    store.update_paper(paper["id"], status="partial", error=message, meta=meta)


@router.post("", status_code=201)
async def create_paper(
    files: list[UploadFile] = File(...),
    title: str | None = Form(default=None),
    subject: str | None = Form(default=None),
    grade: str | None = Form(default=None),
    kind: str = Form(default="mixed"),
    user: dict = Depends(auth.require_teacher),
):
    security.hit(f"paper:{user['id']}", 10, 3600, "上传过于频繁，请 1 小时后再试")
    if not files or len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(400, f"一次最多上传 {MAX_FILES_PER_REQUEST} 个文件")
    if kind not in _FILE_KINDS:
        raise HTTPException(400, "无效的文件类型标记")
    paper_id = store.new_job_id()
    try:
        store.create_paper(
            paper_id, user["id"], (title or "").strip() or None,
            (subject or "").strip() or None, (grade or "").strip() or None,
            max_processing=settings.max_processing_per_user,
        )
        await _save_paper_files(paper_id, files, kind)
    except store.ProcessingLimitError:
        store.delete_paper(paper_id)
        raise HTTPException(429, "已有任务正在处理中，请稍后再试") from None
    except Exception:
        store.delete_paper(paper_id)
        raise
    workers.enqueue_paper(paper_id)
    return {"paper_id": paper_id}


@router.post("/manual", status_code=201)
def create_manual_paper(req: PaperUpdateRequest, user: dict = Depends(auth.require_teacher)):
    if not req.title or not req.title.strip():
        raise HTTPException(422, "试卷名称不能为空")
    paper_id = store.new_job_id()
    store.create_paper(
        paper_id, user["id"], req.title.strip(),
        (req.subject or "").strip() or None, (req.grade or "").strip() or None,
    )
    store.update_paper(
        paper_id, status="partial", stage="done", error="请先添加至少一道题目",
        progress_done=1, progress_total=1, progress_label="等待录入题目",
        meta={"title": req.title.strip(), "total_questions": 0},
    )
    return {"paper_id": paper_id}


@router.get("")
def list_papers(
    q: str | None = None, limit: int = 100, offset: int = 0,
    user: dict = Depends(auth.get_current_user),
):
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    if user["role"] == "student":
        papers, total = store.list_papers_page(
            user["teacher_id"], q=q, limit=limit, offset=offset, ready_only=True,
        )
        return {"papers": [{
            "id": p["id"], "title": p["title"], "status": p["status"],
            "subject": p.get("subject"), "grade": p.get("grade"),
            "question_count": p["question_count"], "answered_count": p["answered_count"],
        } for p in papers], "total": total, "limit": limit, "offset": offset}
    papers, total = store.list_papers_page(user["id"], q=q, limit=limit, offset=offset)
    return {"papers": [_public(p) for p in papers], "total": total, "limit": limit, "offset": offset}


@router.get("/{paper_id}")
def get_paper(paper: dict = Depends(auth.get_owned_paper)):
    return _public(paper, full=True)


@router.patch("/{paper_id}")
def update_paper(req: PaperUpdateRequest, paper: dict = Depends(auth.get_owned_paper)):
    fields = {}
    if req.title is not None:
        if not req.title.strip():
            raise HTTPException(422, "试卷名称不能为空")
        fields["title"] = req.title.strip()
    if req.subject is not None:
        fields["subject"] = req.subject.strip() or None
    if req.grade is not None:
        fields["grade"] = req.grade.strip() or None
    store.update_paper(paper["id"], **fields)
    return _public(store.get_paper(paper["id"]))


@router.delete("/{paper_id}")
def delete_paper(paper: dict = Depends(auth.get_owned_paper)):
    if paper["status"] == "processing":
        raise HTTPException(409, "试卷正在识别中，暂不能删除")
    if store.list_submission_ids_for_paper(paper["id"]):
        raise HTTPException(409, "该试卷已有批改记录，请先在批改列表筛选并删除对应记录")
    try:
        store.delete_paper(paper["id"])
    except sqlite3.IntegrityError:
        raise HTTPException(409, "该试卷已有批改记录，请先删除对应记录") from None
    return {"ok": True}


def _retry_paper(paper: dict):
    if not store.list_paper_files(paper["id"]):
        raise HTTPException(400, "没有可重新识别的文件，请先上传文件")
    if not store.try_mark_paper_processing(paper["id"]):
        raise HTTPException(409, "试卷正在识别中")
    workers.enqueue_paper(paper["id"])
    return {"ok": True}


@router.post("/{paper_id}/retry", status_code=202)
def retry_paper(paper: dict = Depends(auth.get_owned_paper)):
    return _retry_paper(paper)


@router.post("/{paper_id}/reprocess", status_code=202)
def reprocess_paper(paper: dict = Depends(auth.get_owned_paper)):
    return _retry_paper(paper)


@router.post("/{paper_id}/accept-partial")
def accept_partial(paper: dict = Depends(auth.get_owned_paper)):
    if paper["status"] != "partial":
        raise HTTPException(409, "当前试卷不是部分识别状态")
    if not store.get_paper_questions(paper["id"]):
        raise HTTPException(409, "至少保留一道题目后才能接受部分结果")
    meta = dict(paper.get("meta") or {})
    meta["accepted_partial"] = True
    store.update_paper(paper["id"], status="ready", error=None, meta=meta)
    return {"ok": True}


@router.post("/{paper_id}/files", status_code=202)
async def add_files(
    files: list[UploadFile] = File(...),
    kind: str = Form(default="answers"),
    paper: dict = Depends(auth.get_owned_paper),
):
    if not files or len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(400, f"一次最多上传 {MAX_FILES_PER_REQUEST} 个文件")
    if kind not in _FILE_KINDS:
        raise HTTPException(400, "无效的文件类型标记")
    if not store.try_mark_paper_processing(paper["id"]):
        raise HTTPException(409, "试卷正在识别中，请稍后再补传")
    prev_status = paper["status"]
    try:
        await _save_paper_files(paper["id"], files, kind)
    except Exception:
        store.update_paper(
            paper["id"], status=prev_status, stage="done",
            progress_done=1, progress_total=1, progress_label="已恢复",
        )
        raise
    workers.enqueue_paper(paper["id"])
    return {"ok": True, "file_count": len(store.list_paper_files(paper["id"]))}


@router.delete("/{paper_id}/files/{file_id}")
def delete_file(file_id: str, paper: dict = Depends(auth.get_owned_paper)):
    if paper["status"] == "processing":
        raise HTTPException(409, "正在识别中，暂不能删除文件")
    target = next((f for f in store.list_paper_files(paper["id"]) if f["id"] == file_id), None)
    if not target:
        raise HTTPException(404, "文件不存在")
    path = store.paper_file_path(paper["id"], file_id)
    store.delete_paper_file(file_id, paper["id"])
    if path:
        path.unlink(missing_ok=True)
    remaining = store.list_paper_files(paper["id"])
    if remaining:
        store.try_mark_paper_processing(paper["id"])
        workers.enqueue_paper(paper["id"])
    else:
        store.update_paper(paper["id"], page_count=0)
        if store.get_paper_questions(paper["id"]):
            store.update_paper(paper["id"], status="ready", error=None)
        else:
            _mark_partial(paper, "没有可用文件，请上传或手动录题")
    return {"ok": True}


@router.post("/{paper_id}/questions", status_code=201)
def add_question(req: PaperQuestionCreateRequest, paper: dict = Depends(auth.get_owned_paper)):
    if paper["status"] == "processing":
        raise HTTPException(409, "试卷正在识别中")
    content = req.model_dump(exclude={"number", "correct_answer", "type"})
    ca = (req.correct_answer or "").strip() or None
    try:
        result = store.add_paper_question(
            paper["id"], req.number, ca, (req.type or "").strip() or None, content,
        )
    except sqlite3.IntegrityError:
        raise HTTPException(409, f"题号 {req.number.strip()} 已存在") from None
    except ValueError as exc:
        raise HTTPException(422 if str(exc) == "题号不能为空" else 400, str(exc)) from None
    meta = dict(paper.get("meta") or {})
    if not meta.get("failed_pages"):
        store.update_paper(paper["id"], status="ready", error=None)
    return result


@router.patch("/{paper_id}/questions/{qid}")
def patch_question(
    qid: str, req: PaperQuestionPatchRequest,
    paper: dict = Depends(auth.get_owned_paper),
):
    if paper["status"] == "processing":
        raise HTTPException(409, "试卷正在识别中，请稍后再编辑")
    with store.paper_lock(paper["id"]):
        if not store.get_paper_question(paper["id"], qid):
            raise HTTPException(404, "题目不存在")
        fields = req.model_dump(exclude_unset=True)
        for key, value in list(fields.items()):
            if isinstance(value, str):
                fields[key] = value.strip()
        if "number" in fields and not fields["number"]:
            raise HTTPException(422, "题号不能为空")
        if "correct_answer" in fields:
            fields["correct_answer"] = fields["correct_answer"] or None
        if "options" in fields and not fields["options"]:
            fields["options"] = None
        try:
            store.update_paper_question(paper["id"], qid, **fields)
        except sqlite3.IntegrityError:
            raise HTTPException(409, f"题号 {fields.get('number', '').strip()} 已存在") from None
        except ValueError as exc:
            if str(exc) == "题号不能为空":
                raise HTTPException(422, str(exc)) from None
            raise
        regraded = pipeline.regrade_paper_submissions(paper["id"])
    return {"question": store.get_paper_question(paper["id"], qid), "regraded": regraded}


@router.delete("/{paper_id}/questions/{qid}")
def delete_question(qid: str, paper: dict = Depends(auth.get_owned_paper)):
    if paper["status"] == "processing":
        raise HTTPException(409, "试卷正在识别中")
    with store.paper_lock(paper["id"]):
        if not store.delete_paper_question(paper["id"], qid):
            raise HTTPException(404, "题目不存在")
    return {"ok": True}


@router.post("/{paper_id}/knowledge-points")
def knowledge_points(
    req: KnowledgePointsRequest | None = None,
    paper: dict = Depends(auth.get_owned_paper),
):
    with store.paper_lock(paper["id"]):
        if req and req.items is not None:
            count = 0
            for qid, value in req.items.items():
                if store.get_paper_question(paper["id"], qid):
                    store.update_paper_question(paper["id"], qid, knowledge_point=(value or "").strip() or None)
                    count += 1
        else:
            count = pipeline.complete_knowledge_points(paper["id"], overwrite=bool(req and req.overwrite))
    return {"ok": True, "updated": count}


@router.get("/{paper_id}/events")
def paper_events(paper: dict = Depends(auth.get_owned_paper)):
    return StreamingResponse(
        events.sse_stream(paper["id"], _public(dict(paper))),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{paper_id}/page/{n}")
def page_image(n: int, paper: dict = Depends(auth.get_owned_paper)):
    if n < 1 or n > 999:
        raise HTTPException(404, "页面不存在")
    path = store.paper_dir(paper["id"]) / "pages" / f"page_{n:02d}.jpg"
    if not path.exists():
        raise HTTPException(404, "页面不存在")
    return FileResponse(path, media_type="image/jpeg")
