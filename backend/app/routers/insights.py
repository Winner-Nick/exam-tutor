"""错题复习聚合与可靠的学习统计。"""
from __future__ import annotations

import json
import time

from fastapi import APIRouter, Depends, HTTPException

from .. import auth, store
from ..db import get_conn

router = APIRouter(prefix="/api", tags=["insights"])


def _owner(user: dict, student_id: int | None) -> tuple[int, int | None]:
    if user["role"] == "student":
        return user["teacher_id"], user["student_id"]
    return user["id"], student_id


def _review_fields(job_id: str, qid: str, row) -> dict:
    attempts = store.list_review_attempts(job_id, qid)
    return {
        "review": {
            "mastered": row["review_status"] == "mastered",
            "review_count": row["review_count"] or 0,
            "streak": row["review_streak"] or 0,
            "last_reviewed_at": row["last_reviewed_at"],
            "next_review_at": row["next_review_at"],
            "attempts": attempts,
        },
        "review_attempts": attempts,
    }


@router.get("/mistakes")
def mistakes(
    student_id: int | None = None, paper_id: str | None = None,
    review: str = "all", q: str | None = None, days: int | None = None,
    user: dict = Depends(auth.get_current_user),
):
    owner_id, student_id = _owner(user, student_id)
    if review not in ("all", "pending", "open", "mastered", "due"):
        raise HTTPException(422, "无效的复习筛选")
    sql = """SELECT q.*, j.id AS jid, j.paper_id AS job_paper_id,
                    j.student_id AS job_student_id, j.created_at AS job_created_at,
                    COALESCE(p.title, j.title, j.filename, '试卷') AS job_title,
                    s.name AS student_name
             FROM questions q JOIN jobs j ON j.id = q.job_id
             LEFT JOIN students s ON s.id = j.student_id
             LEFT JOIN papers p ON p.id = j.paper_id
             WHERE j.user_id = ? AND j.status = 'done' AND q.status = 'wrong'"""
    params: list = [owner_id]
    if student_id is not None:
        sql += " AND j.student_id = ?"
        params.append(student_id)
    if paper_id:
        sql += " AND j.paper_id = ?"
        params.append(paper_id)
    if review in ("pending", "open"):
        sql += " AND q.review_status != 'mastered'"
    elif review == "mastered":
        sql += " AND q.review_status = 'mastered'"
    elif review == "due":
        sql += " AND q.review_status != 'mastered' AND q.next_review_at IS NOT NULL AND q.next_review_at <= ?"
        params.append(time.time())
    if days:
        sql += " AND j.created_at >= ?"
        params.append(time.time() - min(days, 3650) * 86400)
    if q and q.strip():
        sql += " AND (q.stem LIKE ? OR q.student_answer LIKE ? OR q.correct_answer LIKE ? OR q.knowledge_point LIKE ? OR q.number LIKE ?)"
        params.extend([f"%{q.strip()}%"] * 5)
    rows = get_conn().execute(sql + " ORDER BY j.created_at DESC, q.id", params).fetchall()

    groups: dict[str, list[dict]] = {}
    for row in rows:
        item = store._q_row_to_dict(row)
        item.update({
            "job_id": row["jid"], "job_title": row["job_title"],
            "paper_id": row["job_paper_id"], "student_id": row["job_student_id"],
            "student_name": row["student_name"], "created_at": row["job_created_at"],
            "passage": None,
        })
        item.update(_review_fields(row["jid"], row["qid"], row))
        groups.setdefault(row["knowledge_point"] or "未分类", []).append(item)
    out = [{"knowledge_point": kp, "questions": questions} for kp, questions in groups.items()]
    out.sort(key=lambda group: len(group["questions"]), reverse=True)
    return {"groups": out, "total": len(rows)}


@router.get("/stats/overview")
def overview(
    student_id: int | None = None, days: int = 30,
    user: dict = Depends(auth.get_current_user),
):
    owner_id, student_id = _owner(user, student_id)
    conn = get_conn()
    where = "j.user_id = ? AND j.status = 'done'"
    params: list = [owner_id]
    if student_id is not None:
        where += " AND j.student_id = ?"
        params.append(student_id)
    if days and days > 0:
        where += " AND j.created_at >= ?"
        params.append(time.time() - min(days, 3650) * 86400)
    rows = conn.execute(
        f"""SELECT j.id, j.student_id, j.created_at, j.stats_json,
                   COALESCE(p.title, j.title, j.filename, '试卷') AS title,
                   s.name AS student_name
            FROM jobs j LEFT JOIN students s ON s.id = j.student_id
            LEFT JOIN papers p ON p.id = j.paper_id
            WHERE {where} ORDER BY j.created_at DESC, j.id DESC""",
        params,
    ).fetchall()
    jobs = []
    summary = {"total_jobs": len(rows), "total": 0, "correct": 0, "wrong": 0,
               "unknown": 0, "subjective": 0, "no_objective_jobs": 0}
    students: dict[int, dict] = {}
    for row in rows:
        stats = json.loads(row["stats_json"]) if row["stats_json"] else {}
        jobs.append({
            "id": row["id"], "title": row["title"], "student_id": row["student_id"],
            "student_name": row["student_name"], "created_at": row["created_at"], "stats": stats,
        })
        for key in ("total", "correct", "wrong", "unknown", "subjective"):
            summary[key] += int(stats.get(key) or 0)
        if int(stats.get("correct") or 0) + int(stats.get("wrong") or 0) == 0:
            summary["no_objective_jobs"] += 1
        sid = row["student_id"]
        if sid is not None:
            current = students.setdefault(sid, {
                "student_id": sid, "student_name": row["student_name"] or "未指定学生",
                "total_jobs": 0, "correct": 0, "wrong": 0, "unknown": 0, "subjective": 0,
            })
            current["total_jobs"] += 1
            for key in ("correct", "wrong", "unknown", "subjective"):
                current[key] += int(stats.get(key) or 0)

    question_rows = conn.execute(
        f"""SELECT q.knowledge_point, q.status
            FROM questions q JOIN jobs j ON j.id = q.job_id WHERE {where}""",
        params,
    ).fetchall()
    tagged: dict[str, dict] = {}
    for row in question_rows:
        kp = (row["knowledge_point"] or "").strip()
        if not kp:
            continue
        current = tagged.setdefault(kp, {"knowledge_point": kp, "wrong": 0, "total": 0})
        current["total"] += 1
        if row["status"] == "wrong":
            current["wrong"] += 1
    covered = sum(item["total"] for item in tagged.values())
    total_questions = len(question_rows)
    knowledge_points = sorted(
        (item for item in tagged.values() if item["wrong"] > 0),
        key=lambda item: (item["wrong"], item["total"]), reverse=True,
    )[:30]
    return {
        "jobs": jobs,
        "knowledge_points": knowledge_points,
        "summary": summary,
        "knowledge_coverage": {
            "covered": covered, "tagged": covered, "total": total_questions,
            "percent": round(covered / total_questions * 100) if total_questions else 0,
        },
        "student_summaries": sorted(students.values(), key=lambda item: item["wrong"], reverse=True),
    }
