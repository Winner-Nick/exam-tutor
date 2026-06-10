"""跨作业聚合：错题本（按知识点分组）+ 统计总览。"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends

from .. import auth
from ..db import get_conn

router = APIRouter(prefix="/api", tags=["insights"])


@router.get("/mistakes")
def mistakes(user: dict = Depends(auth.get_current_user)):
    rows = get_conn().execute(
        """SELECT q.*, j.id AS jid, COALESCE(j.title, j.filename, '试卷') AS job_title
           FROM questions q JOIN jobs j ON j.id = q.job_id
           WHERE j.user_id = ? AND q.status = 'wrong'
           ORDER BY j.created_at DESC, q.id""",
        (user["id"],),
    ).fetchall()

    groups: dict[str, list[dict]] = {}
    for r in rows:
        kp = r["knowledge_point"] or "未分类"
        groups.setdefault(kp, []).append({
            "id": r["qid"],
            "job_id": r["jid"],
            "job_title": r["job_title"],
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
def overview(user: dict = Depends(auth.get_current_user)):
    conn = get_conn()
    jobs = [
        {
            "id": r["id"],
            "title": r["title"] or r["filename"] or "试卷",
            "created_at": r["created_at"],
            "stats": json.loads(r["stats_json"]) if r["stats_json"] else {},
        }
        for r in conn.execute(
            "SELECT id, title, filename, created_at, stats_json FROM jobs "
            "WHERE user_id = ? AND status = 'done' ORDER BY created_at DESC",
            (user["id"],),
        ).fetchall()
    ]
    kps = [
        {"knowledge_point": r["knowledge_point"], "wrong": r["wrong"], "total": r["total"]}
        for r in conn.execute(
            """SELECT q.knowledge_point,
                      SUM(CASE WHEN q.status = 'wrong' THEN 1 ELSE 0 END) AS wrong,
                      COUNT(*) AS total
               FROM questions q JOIN jobs j ON j.id = q.job_id
               WHERE j.user_id = ? AND q.knowledge_point IS NOT NULL
               GROUP BY q.knowledge_point
               HAVING wrong > 0
               ORDER BY wrong DESC, total DESC LIMIT 30""",
            (user["id"],),
        ).fetchall()
    ]
    return {"jobs": jobs, "knowledge_points": kps}
