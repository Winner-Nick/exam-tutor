"""题目路由：修正答案 / 重新判分 / 按需讲解。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from .. import auth, llm, pipeline, prompts, store
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

    # 若改后变成错题且尚无讲解，则即时生成（阶段 3 改为入队）
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
