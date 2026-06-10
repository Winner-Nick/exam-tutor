"""FastAPI 服务：上传试卷、查询进度、获取题目、改答案、答疑。

阶段 1 过渡版：存储已切到 SQLite，认证在阶段 2 引入（作业暂归属首个用户）。
"""
from __future__ import annotations

import shutil
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import auth, llm, pipeline, prompts, store
from .config import STATIC_DIR, settings
from .db import get_conn, init_db
from .models import AskRequest, OverrideRequest


def _resume_interrupted_jobs() -> None:
    """服务重启后自动续跑仍处于 processing 的作业（视觉结果有缓存，续跑很快）。"""
    for job_id in store.list_processing_job_ids():
        threading.Thread(target=pipeline.process_job, args=(job_id,), daemon=True).start()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    _resume_interrupted_jobs()
    yield


app = FastAPI(title="ExamTutor", version="0.2.0", lifespan=lifespan)


def _default_user_id() -> int:
    """阶段 2 引入登录前的过渡：作业归属首个用户（无则创建占位账号）。"""
    row = get_conn().execute("SELECT id FROM users ORDER BY id LIMIT 1").fetchone()
    if row:
        return row["id"]
    return store.create_user("local", auth.hash_password("local"), role="admin")


# ---------------------------------------------------------------------------
# 上传 + 处理
# ---------------------------------------------------------------------------

@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "请上传 PDF 文件")

    job_id = store.new_job_id()
    pdf = store.pdf_path(job_id)
    with pdf.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    store.create_job(job_id, _default_user_id(), file.filename)
    threading.Thread(target=pipeline.process_job, args=(job_id,), daemon=True).start()
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = store.get_job_full(job_id)
    if not job:
        raise HTTPException(404, "作业不存在")
    job.pop("user_id", None)
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
    q = store.get_question(job_id, qid)
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
                q["explain_state"] = "done"
        except Exception:  # noqa: BLE001
            pass

    store.update_question(
        job_id, qid,
        student_answer=q.get("student_answer"), status=q["status"],
        explanation=q.get("explanation"), explain_state=q.get("explain_state") or "none",
    )
    stats = store.refresh_stats(job_id)
    return {"question": q, "stats": stats}


# ---------------------------------------------------------------------------
# 答疑
# ---------------------------------------------------------------------------

@app.post("/api/jobs/{job_id}/ask")
def ask(job_id: str, req: AskRequest):
    job = store.get_job(job_id)
    if not job:
        raise HTTPException(404, "作业不存在")
    if not req.question.strip():
        raise HTTPException(400, "问题不能为空")

    messages = [{"role": "system", "content": prompts.CHAT_SYSTEM}]
    qid = req.qid or None
    if qid:
        q = store.get_question(job_id, qid)
        if q:
            messages.append({"role": "system", "content": prompts.chat_question_context(q)})

    history = store.get_chat(job_id, qid)
    messages.extend(history[-12:])
    messages.append({"role": "user", "content": req.question})

    answer = llm.deepseek_chat(messages)

    store.add_chat_message(job_id, qid, "user", req.question)
    store.add_chat_message(job_id, qid, "assistant", answer)
    return {"answer": answer}


@app.get("/api/jobs/{job_id}/chat")
def get_chat(job_id: str, qid: str | None = None):
    job = store.get_job(job_id)
    if not job:
        raise HTTPException(404, "作业不存在")
    return {"messages": store.get_chat(job_id, qid or None)}


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
