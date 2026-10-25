"""基于真实试卷上下文的单题与整卷答疑。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from .. import auth, llm, prompts, security, store
from ..models import AskRequest

router = APIRouter(prefix="/api/jobs/{job_id}", tags=["chat"])


@router.post("/ask")
def ask(
    req: AskRequest, job: dict = Depends(auth.get_owned_job),
    user: dict = Depends(auth.get_current_user),
):
    security.hit(f"ask:{user['id']}", 10, 60, "提问过于频繁，请稍后再问")
    question = req.question.strip()
    if not question:
        raise HTTPException(400, "问题不能为空")
    job_id = job["id"]
    qid = req.qid or None
    messages = [{"role": "system", "content": prompts.CHAT_SYSTEM}]
    if qid:
        q = store.get_question(job_id, qid)
        if not q:
            raise HTTPException(404, "当前题目不存在")
        messages.append({"role": "system", "content": prompts.chat_question_context(q, job)})
    else:
        messages.append({
            "role": "system",
            "content": prompts.chat_job_context(job, store.get_questions(job_id)),
        })
    messages.extend(store.get_chat(job_id, qid)[-12:])
    messages.append({"role": "user", "content": question})
    answer = llm.deepseek_chat(messages)
    store.add_chat_message(job_id, qid, "user", question)
    store.add_chat_message(job_id, qid, "assistant", answer)
    return {"answer": answer}


@router.get("/chat")
def get_chat(qid: str | None = None, job: dict = Depends(auth.get_owned_job)):
    if qid and not store.get_question(job["id"], qid):
        raise HTTPException(404, "当前题目不存在")
    return {"messages": store.get_chat(job["id"], qid or None)}
