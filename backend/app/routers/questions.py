"""题目路由：修正答案 / 重新判分 / 按需讲解（插队）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from .. import auth, pipeline, store, workers
from ..models import OverrideRequest

router = APIRouter(prefix="/api/jobs/{job_id}/questions", tags=["questions"])


@router.post("/{qid}/override")
def override_answer(qid: str, req: OverrideRequest, job: dict = Depends(auth.get_owned_job)):
    job_id = job["id"]
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

    store.update_question(
        job_id, qid, student_answer=q.get("student_answer"), status=q["status"],
    )

    # 改后变成错题且尚无讲解 -> 高优先级入队（SSE question_explained 通知就绪）
    if q["status"] in ("wrong", "unknown") and not q.get("explanation"):
        workers.enqueue_explanations(job_id, [qid], priority=0)

    stats = store.refresh_stats(job_id)
    return {"question": store.get_question(job_id, qid), "stats": stats}


@router.post("/{qid}/explain", status_code=202)
def request_explanation(qid: str, job: dict = Depends(auth.get_owned_job)):
    """用户点开未讲解的题：插队优先生成。"""
    job_id = job["id"]
    q = store.get_question(job_id, qid)
    if not q:
        raise HTTPException(404, "题目不存在")
    if q["explain_state"] == "done":
        return {"explain_state": "done"}
    workers.enqueue_explanations(job_id, [qid], priority=0)
    q = store.get_question(job_id, qid)
    return {"explain_state": q["explain_state"]}
