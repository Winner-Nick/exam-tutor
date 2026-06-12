"""试卷库路由：上传（题目/答案可分多文件、可补传）、核对答案、页面图、SSE。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from .. import auth, events, pipeline, security, store, workers
from ..config import settings
from ..models import PaperAnswerRequest, PaperQuestionCreateRequest, PaperUpdateRequest

router = APIRouter(prefix="/api/papers", tags=["papers"])

MAX_FILES_PER_REQUEST = 30  # 逐页拍照的试卷轻松超过 5 张；页数总闸由 MAX_PAGES 把守
_FILE_KINDS = {"mixed", "questions", "answers"}


async def _save_paper_files(paper_id: str, files: list[UploadFile], kind: str) -> None:
    """逐个落盘并登记。任何一个失败则整体回滚由调用方负责。"""
    for f in files:
        fid = store.add_paper_file(paper_id, kind, f.filename, None)
        dest_stem = store.paper_dir(paper_id) / "files" / fid
        _, sha = await security.save_upload(f, dest_stem, allow_pdf=True, allow_image=True)
        store.set_paper_file_sha(fid, sha)


@router.post("", status_code=201)
async def create_paper(
    files: list[UploadFile] = File(...),
    title: str | None = Form(default=None),
    kind: str = Form(default="mixed"),
    user: dict = Depends(auth.get_current_user),
):
    security.hit(f"paper:{user['id']}", 10, 3600, "上传过于频繁，请 1 小时后再试")
    if store.count_processing_papers(user["id"]) >= settings.max_processing_per_user:
        raise HTTPException(429, "已有试卷正在识别中，请稍后再上传")
    if not files or len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(400, f"一次最多上传 {MAX_FILES_PER_REQUEST} 个文件")
    if kind not in _FILE_KINDS:
        raise HTTPException(400, "无效的文件类型标记")

    paper_id = store.new_job_id()
    store.create_paper(paper_id, user["id"], (title or "").strip() or None)
    try:
        await _save_paper_files(paper_id, files, kind)
    except HTTPException:
        store.delete_paper(paper_id)
        raise
    workers.enqueue_paper(paper_id)
    return {"paper_id": paper_id}


@router.post("/manual", status_code=201)
def create_manual_paper(req: PaperUpdateRequest, user: dict = Depends(auth.get_current_user)):
    """不传文件、纯手动录入题号和答案的试卷（适合只有答案没有卷子的场景）。"""
    paper_id = store.new_job_id()
    store.create_paper(paper_id, user["id"], req.title.strip())
    store.update_paper(paper_id, status="ready", stage="done",
                       progress_done=1, progress_total=1, progress_label="完成",
                       meta={"title": req.title.strip(), "total_questions": 0})
    return {"paper_id": paper_id}


@router.post("/{paper_id}/files", status_code=202)
async def add_files(
    files: list[UploadFile] = File(...),
    kind: str = Form(default="answers"),
    paper: dict = Depends(auth.get_owned_paper),
):
    """补传文件（典型场景：答案在另一份 PDF/照片里）。上传后整卷重新汇总，
    已核对的答案会保留，已识别过的文件走缓存不重复花钱。"""
    if paper["status"] == "processing":
        raise HTTPException(409, "试卷正在识别中，请稍后再补传")
    if not files or len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(400, f"一次最多上传 {MAX_FILES_PER_REQUEST} 个文件")
    if kind not in _FILE_KINDS:
        raise HTTPException(400, "无效的文件类型标记")
    await _save_paper_files(paper["id"], files, kind)
    store.update_paper(paper["id"], status="processing", stage="queued",
                       progress_done=0, progress_total=1, progress_label="排队中…",
                       error=None)
    workers.enqueue_paper(paper["id"])
    return {"ok": True}


@router.get("")
def list_papers(user: dict = Depends(auth.get_current_user)):
    return {"papers": store.list_papers(user["id"])}


@router.get("/{paper_id}")
def get_paper(paper: dict = Depends(auth.get_owned_paper)):
    paper["questions"] = store.get_paper_questions(paper["id"])
    paper["files"] = [
        {"id": f["id"], "kind": f["kind"], "filename": f["filename"],
         "page_start": f["page_start"], "page_count": f["page_count"]}
        for f in store.list_paper_files(paper["id"])
    ]
    return paper


@router.patch("/{paper_id}")
def update_paper(req: PaperUpdateRequest, paper: dict = Depends(auth.get_owned_paper)):
    store.update_paper(paper["id"], title=req.title.strip())
    return store.get_paper(paper["id"])


@router.delete("/{paper_id}")
def delete_paper(paper: dict = Depends(auth.get_owned_paper)):
    if paper["status"] == "processing":
        raise HTTPException(409, "试卷正在识别中，暂不能删除")
    if store.list_submission_ids_for_paper(paper["id"]):
        raise HTTPException(409, "该试卷已有批改记录，请先删除对应记录")
    store.delete_paper(paper["id"])
    return {"ok": True}


@router.post("/{paper_id}/reprocess", status_code=202)
def reprocess(paper: dict = Depends(auth.get_owned_paper)):
    """识别失败或效果不佳时手动重跑（已识别文件命中缓存，不重复花钱）。"""
    if paper["status"] == "processing":
        raise HTTPException(409, "试卷正在识别中")
    store.update_paper(paper["id"], status="processing", stage="queued",
                       progress_done=0, progress_total=1, progress_label="排队中…",
                       error=None)
    workers.enqueue_paper(paper["id"])
    return {"ok": True}


@router.post("/{paper_id}/questions", status_code=201)
def add_question(req: PaperQuestionCreateRequest, paper: dict = Depends(auth.get_owned_paper)):
    """手动补一道题（识别漏题，或仅答案/纯手动建卷时录入题号+答案）。"""
    if paper["status"] == "processing":
        raise HTTPException(409, "试卷正在识别中")
    number = req.number.strip()
    if store.get_paper_question(paper["id"], "q" + number):
        raise HTTPException(409, f"题号 {number} 已存在")
    if len(store.get_paper_questions(paper["id"])) >= 200:
        raise HTTPException(400, "题目数量已达上限")
    ca = (req.correct_answer or "").strip() or None
    return store.add_paper_question(paper["id"], number, ca, (req.type or "").strip() or None)


@router.delete("/{paper_id}/questions/{qid}")
def delete_question(qid: str, paper: dict = Depends(auth.get_owned_paper)):
    if paper["status"] == "processing":
        raise HTTPException(409, "试卷正在识别中")
    if not store.delete_paper_question(paper["id"], qid):
        raise HTTPException(404, "题目不存在")
    return {"ok": True}


@router.patch("/{paper_id}/questions/{qid}")
def set_answer(qid: str, req: PaperAnswerRequest, paper: dict = Depends(auth.get_owned_paper)):
    """老师核对/修改标准答案，并同步重判该试卷下所有已批改记录。"""
    pq = store.get_paper_question(paper["id"], qid)
    if not pq:
        raise HTTPException(404, "题目不存在")
    ca = (req.correct_answer or "").strip() or None
    store.update_paper_question_answer(paper["id"], qid, ca)

    regraded = 0
    for sub_id in store.list_submission_ids_for_paper(paper["id"]):
        q = store.get_question(sub_id, qid)
        if not q:
            continue
        q["correct_answer"] = ca
        pipeline.regrade([q])
        store.update_question(sub_id, qid, correct_answer=ca, status=q["status"])
        store.refresh_stats(sub_id)
        if q["status"] in ("wrong", "unknown") and not q.get("explanation"):
            workers.enqueue_explanations(sub_id, [qid], priority=1)
        regraded += 1
    return {"question": store.get_paper_question(paper["id"], qid), "regraded": regraded}


@router.get("/{paper_id}/events")
async def paper_events(paper: dict = Depends(auth.get_owned_paper)):
    return StreamingResponse(
        events.sse_stream(paper["id"], paper),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{paper_id}/page/{n}")
def page_image(n: int, paper: dict = Depends(auth.get_owned_paper)):
    if n < 1 or n > 999:
        raise HTTPException(404, "页面不存在")
    p = store.paper_dir(paper["id"]) / "pages" / f"page_{n:02d}.jpg"
    if not p.exists():
        raise HTTPException(404, "页面不存在")
    return FileResponse(p, media_type="image/jpeg")
