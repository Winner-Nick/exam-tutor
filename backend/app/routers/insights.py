"""跨作业聚合：错题本（按知识点分组）+ 统计总览。"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends

from .. import auth
from ..db import get_conn

router = APIRouter(prefix="/api", tags=["insights"])


@router.get("/mistakes")
def mistakes(student_id: int | None = None, user: dict = Depends(auth.get_current_user)):
    sql = """SELECT q.*, j.id AS jid, COALESCE(j.title, j.filename, '试卷') AS job_title,
                    s.name AS student_name
             FROM questions q JOIN jobs j ON j.id = q.job_id
             LEFT JOIN students s ON s.id = j.student_id
             WHERE j.user_id = ? AND q.status = 'wrong'"""
    params: list = [user["id"]]
    if student_id is not None:
        sql += " AND j.student_id = ?"
        params.append(student_id)
    rows = get_conn().execute(sql + " ORDER BY j.created_at DESC, q.id", params).fetchall()

    groups: dict[str, list[dict]] = {}
    for r in rows:
        kp = r["knowledge_point"] or "未分类"
        groups.setdefault(kp, []).append({
            "id": r["qid"],
            "job_id": r["jid"],
            "job_title": r["job_title"],
            "student_name": r["student_name"],
            "number": r["number"],
            "section": r["section"],
            "type": r["type"],
            "stem": r["stem"],
            "options": json.loads(r["options_json"]) if r["options_json"] else None,
            "passage": None,  # 列表页不需要长文章
            "student_answer": r["student_answer"],
            "correct_answer": r["correct_answer"],
            "status": r["status"],
            "knowledge_point": r["knowledge_point"],
            "explanation": json.loads(r["explanation_json"]) if r["explanation_json"] else None,
            "explain_state": r["explain_state"],
        })

    out = [{"knowledge_point": kp, "questions": qs} for kp, qs in groups.items()]
    out.sort(key=lambda g: len(g["questions"]), reverse=True)
    return {"groups": out}


@router.get("/stats/overview")
def overview(student_id: int | None = None, user: dict = Depends(auth.get_current_user)):
    conn = get_conn()
    jobs_sql = """SELECT j.id, j.title, j.filename, j.created_at, j.stats_json,
                         s.name AS student_name
                  FROM jobs j LEFT JOIN students s ON s.id = j.student_id
                  WHERE j.user_id = ? AND j.status = 'done'"""
    kp_sql = """SELECT q.knowledge_point,
                       SUM(CASE WHEN q.status = 'wrong' THEN 1 ELSE 0 END) AS wrong,
                       COUNT(*) AS total
                FROM questions q JOIN jobs j ON j.id = q.job_id
                WHERE j.user_id = ? AND q.knowledge_point IS NOT NULL"""
    params: list = [user["id"]]
    if student_id is not None:
        jobs_sql += " AND j.student_id = ?"
        kp_sql += " AND j.student_id = ?"
        params.append(student_id)

    jobs = [
        {
            "id": r["id"],
            "title": r["title"] or r["filename"] or "试卷",
            "student_name": r["student_name"],
            "created_at": r["created_at"],
            "stats": json.loads(r["stats_json"]) if r["stats_json"] else {},
        }
        for r in conn.execute(jobs_sql + " ORDER BY j.created_at DESC", params).fetchall()
    ]
    kps = [
        {"knowledge_point": r["knowledge_point"], "wrong": r["wrong"], "total": r["total"]}
        for r in conn.execute(
            kp_sql + """ GROUP BY q.knowledge_point
                         HAVING wrong > 0
                         ORDER BY wrong DESC, total DESC LIMIT 30""",
            params,
        ).fetchall()
    ]
    return {"jobs": jobs, "knowledge_points": kps}
