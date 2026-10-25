"""错题复习聚合与可靠的学习统计。"""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import auth, insights_store, store

router = APIRouter(prefix="/api", tags=["insights"])


def _owner(user: dict, student_id: int | None) -> tuple[int, int | None]:
    if user["role"] == "student":
        return user["teacher_id"], user["student_id"]
    return user["id"], student_id


def _review_fields(row, attempts: list[dict]) -> dict:
    return {
        "review": {
            "mastered": row["review_status"] == "mastered",
            "review_count": row["review_count"] or 0,
            "streak": row["review_streak"] or 0,
            "last_reviewed_at": row["last_reviewed_at"],
            "next_review_at": row["next_review_at"],
        },
        "review_attempts": attempts,
    }


@router.get("/mistakes")
def mistakes(
    student_id: int | None = None, paper_id: str | None = None,
    review: str = "all", q: str | None = None,
    days: int | None = Query(default=None, ge=0, description="只统计最近 N 天；0 或缺省为全部时间"),
    limit: int = Query(default=0, ge=0, le=100,
                       description="每页错题数（1..100）；0（默认）保留旧版全量行为，此时不分页"),
    offset: int = Query(default=0, ge=0, description="错题偏移量，仅在 limit 大于 0 时生效"),
    user: dict = Depends(auth.get_current_user),
):
    """按知识点返回错题；total 始终是分页前的筛选总数。"""
    owner_id, student_id = _owner(user, student_id)
    if review not in ("all", "pending", "open", "mastered", "due"):
        raise HTTPException(422, "无效的复习筛选")
    now = time.time()
    rows, total = insights_store.list_mistake_rows(
        owner_id, student_id, paper_id, review, q,
        insights_store.cutoff_for_days(days, now), now, limit, offset,
    )
    attempts_by_question = insights_store.list_review_attempts_for_questions(
        [row["id"] for row in rows]
    )

    groups: dict[str, list[dict]] = {}
    for row in rows:
        item = store._q_row_to_dict(row)
        item.update({
            "job_id": row["jid"], "job_title": row["job_title"],
            "paper_id": row["job_paper_id"], "student_id": row["job_student_id"],
            "student_name": row["student_name"], "created_at": row["job_created_at"],
            "passage": None,
        })
        item.update(_review_fields(row, attempts_by_question[row["id"]]))
        groups.setdefault(row["knowledge_point"] or "未分类", []).append(item)
    out = [{"knowledge_point": kp, "questions": questions} for kp, questions in groups.items()]
    out.sort(key=lambda group: len(group["questions"]), reverse=True)
    return {
        "groups": out, "total": total, "limit": limit,
        "offset": offset if limit > 0 else 0,
    }


@router.get("/stats/overview")
def overview(
    student_id: int | None = None,
    days: int = Query(default=30, ge=0, description="统计最近 N 天；0 为全部时间，超过 3650 时按 3650 天计算"),
    job_limit: int = Query(default=0, ge=0, le=100,
                           description="jobs 每页条数（1..100）；0（默认）保留旧版全部 jobs 行为"),
    job_offset: int = Query(default=0, ge=0,
                            description="jobs 偏移量，仅在 job_limit 大于 0 时生效"),
    user: dict = Depends(auth.get_current_user),
):
    """返回全范围 SQL 汇总、分页 jobs 和最多 30 个按时间升序排列的 trend 点。"""
    owner_id, student_id = _owner(user, student_id)
    now = time.time()
    return insights_store.get_overview(
        owner_id, student_id, insights_store.cutoff_for_days(days, now),
        job_limit, job_offset,
    )
