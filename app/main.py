"""FastAPI 服务：上传试卷、查询进度、获取题目、改答案、答疑。"""
from __future__ import annotations

import shutil
import threading
import time

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import llm, pipeline, prompts, store
from .config import STATIC_DIR, settings
from .models import AskRequest, OverrideRequest

app = FastAPI(title="ExamTutor", version="0.1.0")


def _find_question(job: dict, qid: str) -> dict | None:
    for q in job.get("questions", []):
        if q.get("id") == qid:
            return q
    return None


# ---------------------------------------------------------------------------
# 上传 + 处理
# ---------------------------------------------------------------------------

@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "请上传 PDF 文件")

    job_id = store.new_job_id()
    jd = store.job_dir(job_id)
    pdf_path = jd / "source.pdf"
    with pdf_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    job = {
        "id": job_id,
        "filename": file.filename,
        "pdf_path": str(pdf_path),
        "status": "processing",
        "stage": "queued",
        "progress": {"done": 0, "total": 1, "label": "排队中…"},
        "error": None,
        "created_at": time.time(),
        "meta": {},
        "questions": [],
        "stats": {},
        "chat": {},
    }
    store.save_job(job)

    threading.Thread(target=pipeline.process_job, args=(job_id,), daemon=True).start()
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = store.load_job(job_id)
    if not job:
        raise HTTPException(404, "作业不存在")
    # 不必把内部路径暴露给前端
    job.pop("pdf_path", None)
    return job


@app.get("/api/jobs/{job_id}/page/{n}")
def page_image(job_id: str, n: int):
    p = store.job_dir(job_id) / "pages" / f"page_{n:02d}.jpg"
    if not p.exists():
        raise HTTPException(404, "页面不存在")
    return FileResponse(p, media_type="image/jpeg")


# ---------------------------------------------------------------------------
# 改答案 / 重新判分 / 按需讲解
# ---------------------------------------------------------------------------

@app.post("/api/jobs/{job_id}/questions/{qid}/override")
def override_answer(job_id: str, qid: str, req: OverrideRequest):
    job = store.load_job(job_id)
    if not job:
        raise HTTPException(404, "作业不存在")
    q = _find_question(job, qid)
    if not q:
        raise HTTPException(404, "题目不存在")

    allowed = {"correct", "wrong", "unknown", "subjective"}
    if req.status in allowed:
        q["status"] = req.status
        if req.student_answer is not None:
            q["student_answer"] = (req.student_answer or "").strip() or None
    else:
        q["student_answer"] = (req.student_answer or "").strip() or None
        pipeline.regrade([q])

    # 若改后变成错题且尚无讲解，则即时生成
    if q.get("status") in ("wrong", "unknown") and not q.get("explanation"):
        try:
            res = llm.deepseek_json(prompts.EXPLAIN_SYSTEM, prompts.explain_user([q]))
            exp = (res.get("explanations") or {}).get(q["id"])
            if exp:
                q["explanation"] = exp
        except Exception:  # noqa: BLE001
            pass

    with store.editing(job_id) as j:
        if j is None:
            raise HTTPException(404, "作业不存在")
        tq = _find_question(j, qid)
        tq.update(q)
        j["stats"] = pipeline._stats(j["questions"])
        stats = j["stats"]
    return {"question": q, "stats": stats}


# ---------------------------------------------------------------------------
# 答疑
# ---------------------------------------------------------------------------

@app.post("/api/jobs/{job_id}/ask")
def ask(job_id: str, req: AskRequest):
    job = store.load_job(job_id)
    if not job:
        raise HTTPException(404, "作业不存在")
    if not req.question.strip():
        raise HTTPException(400, "问题不能为空")

    messages = [{"role": "system", "content": prompts.CHAT_SYSTEM}]
    if req.qid:
        q = _find_question(job, req.qid)
        if q:
            messages.append({"role": "system", "content": prompts.chat_question_context(q)})

    key = req.qid or "general"
    history = (job.get("chat") or {}).get(key, [])
    messages.extend(history[-12:])
    messages.append({"role": "user", "content": req.question})

    answer = llm.deepseek_chat(messages)

    with store.editing(job_id) as j:
        chat = j.setdefault("chat", {})
        lst = chat.setdefault(key, [])
        lst.append({"role": "user", "content": req.question})
        lst.append({"role": "assistant", "content": answer})
    return {"answer": answer}


@app.get("/api/jobs/{job_id}/chat")
def get_chat(job_id: str, qid: str | None = None):
    job = store.load_job(job_id)
    if not job:
        raise HTTPException(404, "作业不存在")
    key = qid or "general"
    return {"messages": (job.get("chat") or {}).get(key, [])}


# ---------------------------------------------------------------------------
# 健康检查 + 静态前端
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    problems = settings.validate()
    return JSONResponse({"ok": not problems, "problems": problems})


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
