from __future__ import annotations

import json
import time

from ..db import get_conn, transaction

def add_review_attempt(job_id: str, qid: str, action: str, answer: str | None,
                       result: str | None, interval_days: int | None,
                       next_review_at: float | None) -> None:
    with transaction():
        row = get_conn().execute(
            "SELECT id FROM questions WHERE job_id = ? AND qid = ?", (job_id, qid)
        ).fetchone()
        if not row:
            raise ValueError("题目不存在")
        get_conn().execute(
            """INSERT INTO review_attempts
               (question_pk, job_id, qid, action, answer, result, interval_days,
                next_review_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (row["id"], job_id, qid, action, answer, result, interval_days,
             next_review_at, time.time()),
        )


def list_review_attempts(job_id: str, qid: str, limit: int = 20) -> list[dict]:
    rows = get_conn().execute(
        """SELECT action, answer, result, interval_days, next_review_at, created_at
           FROM review_attempts WHERE job_id = ? AND qid = ?
           ORDER BY created_at DESC, id DESC LIMIT ?""",
        (job_id, qid, limit),
    ).fetchall()
    return [dict(r) for r in rows]


def write_explanation(job_id: str, qid: str, expected_revision: int,
                      explanation: dict, knowledge_point: str | None = None) -> bool:
    with transaction():
        cur = get_conn().execute(
            """UPDATE questions SET explanation_json = ?, explanation_revision = revision,
               explain_state = 'done', knowledge_point = CASE
                 WHEN ? IS NOT NULL AND (knowledge_point IS NULL OR TRIM(knowledge_point) = '')
                 THEN ? ELSE knowledge_point END
               WHERE job_id = ? AND qid = ? AND revision = ?
                 AND explain_state = 'generating' AND status IN ('wrong', 'unknown')""",
            (json.dumps(explanation, ensure_ascii=False), knowledge_point, knowledge_point,
             job_id, qid, expected_revision),
        )
    return cur.rowcount > 0


def fail_explanation(job_id: str, qid: str, expected_revision: int) -> None:
    with transaction():
        get_conn().execute(
            """UPDATE questions SET explain_state = 'failed'
               WHERE job_id = ? AND qid = ? AND revision = ? AND explain_state = 'generating'""",
            (job_id, qid, expected_revision),
        )
def mark_explain_queued(job_id: str, qids: list[str]) -> list[str]:
    """把待讲解题置为 queued，返回实际发生转移的 qid（防重复入队）。"""
    out: list[str] = []
    conn = get_conn()
    with transaction():
        for qid in qids:
            cur = conn.execute(
                """UPDATE questions SET explain_state = 'queued'
                   WHERE job_id = ? AND qid = ? AND explain_state IN ('none', 'failed')""",
                (job_id, qid),
            )
            if cur.rowcount:
                out.append(qid)
    return out


def reset_stale_explanations() -> list[tuple[str, str]]:
    """重启续跑：generating 复位为 queued，返回所有 queued 的 (job_id, qid)。"""
    conn = get_conn()
    with transaction():
        conn.execute(
            "UPDATE questions SET explain_state = 'queued' WHERE explain_state = 'generating'"
        )
    rows = conn.execute(
        "SELECT job_id, qid FROM questions WHERE explain_state = 'queued' ORDER BY job_id, id"
    ).fetchall()
    return [(r["job_id"], r["qid"]) for r in rows]
