"""人工判分、讲解生成与错题复习。"""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException

from .. import auth, pipeline, store, workers
from ..db import transaction
from ..models import OverrideRequest, ReviewRequest

router = APIRouter(prefix="/api/jobs/{job_id}/questions", tags=["questions"])
REVIEW_INTERVALS = (1, 3, 7, 16, 30)


def _public(job_id: str, qid: str) -> dict:
    q = store.get_question(job_id, qid)
    if not q:
        raise HTTPException(404, "题目不存在")
    attempts = store.list_review_attempts(job_id, qid)
    mastered = q.get("review_status") == "mastered"
    q["review"] = {
        "mastered": mastered,
        "review_count": q.get("review_count") or 0,
        "streak": q.get("review_streak") or 0,
        "last_reviewed_at": q.get("last_reviewed_at"),
        "next_review_at": q.get("next_review_at"),
        "attempts": attempts,
    }
    q["review_attempts"] = attempts
    return q


@router.post("/{qid}/override")
def override_answer(
    qid: str, req: OverrideRequest,
    job: dict = Depends(auth.get_owned_job),
    user: dict = Depends(auth.require_teacher),
):
    if job["status"] == "processing":
        raise HTTPException(409, "正在重新识别，请完成后再人工核对")
    job_id = job["id"]
    with store.job_lock(job_id):
        q = store.get_question(job_id, qid)
        if not q:
            raise HTTPException(404, "题目不存在")
        answer_provided = "student_answer" in req.model_fields_set
        if req.status is None and not answer_provided:
            raise HTTPException(400, "没有需要保存的修改")
        allowed = {"correct", "wrong", "unknown", "subjective"}
        if req.status is not None and req.status not in allowed:
            raise HTTPException(422, "无效的判分状态")
        if answer_provided:
            q["student_answer"] = (req.student_answer or "").strip() or None
        if req.status in allowed:
            q["status"] = req.status
        else:
            pipeline.regrade([q])
        store.update_question(
            job_id, qid,
            student_answer=q.get("student_answer"), status=q["status"], overridden=1,
        )
        updated = store.get_question(job_id, qid)
        if updated["status"] in ("wrong", "unknown") and not updated.get("explanation"):
            workers.enqueue_explanations(job_id, [qid], priority=0)
        stats = store.refresh_stats(job_id)
    return {"question": _public(job_id, qid), "stats": stats}


@router.post("/{qid}/explain", status_code=202)
def request_explanation(qid: str, job: dict = Depends(auth.get_owned_job)):
    if job["status"] == "processing":
        raise HTTPException(409, "题目正在更新，请稍后再生成讲解")
    q = store.get_question(job["id"], qid)
    if not q:
        raise HTTPException(404, "题目不存在")
    if q["status"] not in ("wrong", "unknown"):
        raise HTTPException(409, "当前题目不需要错题讲解")
    if q["explain_state"] == "done":
        return {"explain_state": "done"}
    workers.enqueue_explanations(job["id"], [qid], priority=0)
    return {"explain_state": store.get_question(job["id"], qid)["explain_state"]}


@router.post("/{qid}/review")
def review(qid: str, req: ReviewRequest, job: dict = Depends(auth.get_owned_job)):
    if job["status"] != "done":
        raise HTTPException(409, "只有完成且已确认的批改结果才能复习")
    job_id = job["id"]
    with store.job_lock(job_id), transaction():
        q = store.get_question(job_id, qid)
        if not q:
            raise HTTPException(404, "题目不存在")
        now = time.time()
        if req.action == "mastered":
            store.update_question(
                job_id, qid, review_status="mastered", mastered_at=now, next_review_at=None,
            )
            store.add_review_attempt(job_id, qid, "mastered", None, "mastered", None, None)
        elif req.action == "reopen":
            store.update_question(
                job_id, qid, review_status="open", mastered_at=None,
                review_streak=0, next_review_at=now,
            )
            store.add_review_attempt(job_id, qid, "reopen", None, "reopened", None, now)
        else:
            answer = (req.answer or "").strip()
            if not answer:
                raise HTTPException(400, "请先填写这次重新作答的答案")
            result = req.result
            if result is None:
                candidate = dict(q)
                candidate["student_answer"] = answer
                pipeline.regrade([candidate])
                if candidate["status"] not in ("correct", "wrong"):
                    raise HTTPException(400, "这题无法可靠自动判分，请根据标准答案选择本次答对或答错")
                result = candidate["status"]
            streak = (q.get("review_streak") or 0) + 1 if result == "correct" else 0
            days = REVIEW_INTERVALS[min(max(streak - 1, 0), len(REVIEW_INTERVALS) - 1)] if result == "correct" else 1
            next_at = now + days * 86400
            store.update_question(
                job_id, qid, review_status="open", mastered_at=None,
                review_count=(q.get("review_count") or 0) + 1,
                review_streak=streak, last_reviewed_at=now, next_review_at=next_at,
            )
            store.add_review_attempt(job_id, qid, "attempt", answer, result, days, next_at)
    return {"question": _public(job_id, qid)}
