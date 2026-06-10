"""答疑路由：提问 + 聊天历史。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from .. import auth, llm, prompts, security, store
from ..models import AskRequest

router = APIRouter(prefix="/api/jobs/{job_id}", tags=["chat"])


@router.post("/ask")
def ask(req: AskRequest, job: dict = Depends(auth.get_owned_job),
        user: dict = Depends(auth.get_current_user)):
    security.hit(f"ask:{user['id']}", 10, 60, "提问过于频繁，请稍后再问")
    if not req.question.strip():
        raise HTTPException(400, "问题不能为空")

    job_id = job["id"]
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


@router.get("/chat")
def get_chat(qid: str | None = None, job: dict = Depends(auth.get_owned_job)):
    return {"messages": store.get_chat(job["id"], qid or None)}
