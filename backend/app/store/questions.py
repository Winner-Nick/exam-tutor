from __future__ import annotations

import json

from ..db import get_conn, transaction

def _q_row_to_dict(row) -> dict:
    return {
        "id": row["qid"],
        "number": row["number"],
        "section": row["section"],
        "type": row["type"],
        "stem": row["stem"],
        "options": json.loads(row["options_json"]) if row["options_json"] else None,
        "passage": row["passage"],
        "student_answer": row["student_answer"],
        "correct_answer": row["correct_answer"],
        "status": row["status"],
        "knowledge_point": row["knowledge_point"],
        "explanation": json.loads(row["explanation_json"]) if row["explanation_json"] else None,
        "explain_state": row["explain_state"],
        "explanation_revision": row["explanation_revision"],
        "revision": row["revision"],
        "needs_review": bool(row["needs_review"]),
        "overridden": bool(row["overridden"]) if "overridden" in row.keys() else False,
        "review_status": row["review_status"],
        "review_count": row["review_count"],
        "review_streak": row["review_streak"],
        "last_reviewed_at": row["last_reviewed_at"],
        "next_review_at": row["next_review_at"],
        "mastered_at": row["mastered_at"],
    }


_Q_SEMANTIC_FIELDS = {
    "number", "section", "type", "stem", "options", "passage",
    "student_answer", "correct_answer", "status", "knowledge_point", "needs_review",
}


def replace_questions(job_id: str, questions: list[dict]) -> None:
    qids = [q["id"] for q in questions]
    if len(qids) != len(set(qids)):
        raise ValueError("题目 occurrence ID 重复")
    conn = get_conn()
    with transaction():
        old_rows = conn.execute("SELECT * FROM questions WHERE job_id = ?", (job_id,)).fetchall()
        old = {r["qid"]: r for r in old_rows}
        if qids:
            marks = ",".join("?" for _ in qids)
            conn.execute(
                f"DELETE FROM questions WHERE job_id = ? AND qid NOT IN ({marks})",
                [job_id, *qids],
            )
        else:
            conn.execute("DELETE FROM questions WHERE job_id = ?", (job_id,))
        for q in questions:
            old_row = old.get(q["id"])
            old_q = _q_row_to_dict(old_row) if old_row else None
            normalized = {
                "number": q.get("number"), "section": q.get("section"),
                "type": q.get("type"), "stem": q.get("stem"),
                "options": q.get("options"), "passage": q.get("passage"),
                "student_answer": q.get("student_answer"),
                "correct_answer": q.get("correct_answer"),
                "status": q.get("status") or "unknown",
                "knowledge_point": q.get("knowledge_point"),
                "needs_review": bool(q.get("needs_review")),
            }
            changed = old_q is None or any(
                normalized[k] != old_q[k] for k in _Q_SEMANTIC_FIELDS
            )
            revision = (old_row["revision"] + 1 if changed else old_row["revision"]) if old_row else 1
            if old_q and not changed:
                explanation = old_q["explanation"]
                explain_state = old_q["explain_state"]
                explanation_revision = old_q["explanation_revision"]
            else:
                explanation = None
                explain_state = "none"
                explanation_revision = None
            values = (
                normalized["number"], normalized["section"], normalized["type"],
                normalized["stem"],
                json.dumps(normalized["options"], ensure_ascii=False)
                if normalized["options"] is not None else None,
                normalized["passage"], normalized["student_answer"],
                normalized["correct_answer"], normalized["status"],
                normalized["knowledge_point"],
                json.dumps(explanation, ensure_ascii=False) if explanation else None,
                explain_state, 1 if q.get("overridden") else 0, revision,
                explanation_revision, 1 if normalized["needs_review"] else 0,
            )
            if old_row:
                conn.execute(
                    """UPDATE questions SET number = ?, section = ?, type = ?, stem = ?,
                       options_json = ?, passage = ?, student_answer = ?, correct_answer = ?,
                       status = ?, knowledge_point = ?, explanation_json = ?, explain_state = ?,
                       overridden = ?, revision = ?, explanation_revision = ?, needs_review = ?
                       WHERE job_id = ? AND qid = ?""",
                    (*values, job_id, q["id"]),
                )
            else:
                conn.execute(
                    """INSERT INTO questions (job_id, qid, number, section, type, stem,
                       options_json, passage, student_answer, correct_answer, status,
                       knowledge_point, explanation_json, explain_state, overridden, revision,
                       explanation_revision, needs_review)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (job_id, q["id"], *values),
                )


def get_questions(job_id: str) -> list[dict]:
    rows = get_conn().execute(
        "SELECT * FROM questions WHERE job_id = ? ORDER BY id", (job_id,)
    ).fetchall()
    return [_q_row_to_dict(r) for r in rows]


def get_question(job_id: str, qid: str) -> dict | None:
    row = get_conn().execute(
        "SELECT * FROM questions WHERE job_id = ? AND qid = ?", (job_id, qid)
    ).fetchone()
    return _q_row_to_dict(row) if row else None


_Q_FIELDS = {
    "number", "section", "type", "stem", "options_json", "passage",
    "student_answer", "correct_answer", "status", "knowledge_point",
    "explanation_json", "explain_state", "explanation_revision", "overridden",
    "revision", "needs_review", "review_status", "review_count", "review_streak",
    "last_reviewed_at", "next_review_at", "mastered_at",
}


def update_question(job_id: str, qid: str, **fields) -> None:
    if "explanation" in fields:
        exp = fields.pop("explanation")
        fields["explanation_json"] = json.dumps(exp, ensure_ascii=False) if exp else None
    if "options" in fields:
        options = fields.pop("options")
        fields["options_json"] = json.dumps(options, ensure_ascii=False) if options is not None else None
    bad = set(fields) - _Q_FIELDS
    if bad:
        raise ValueError(f"未知 question 字段: {bad}")
    if not fields:
        return
    conn = get_conn()
    with transaction():
        row = conn.execute(
            "SELECT * FROM questions WHERE job_id = ? AND qid = ?", (job_id, qid)
        ).fetchone()
        if not row:
            return
        public = _q_row_to_dict(row)
        semantic_changed = False
        for key in _Q_SEMANTIC_FIELDS:
            column = "options_json" if key == "options" else key
            if column not in fields:
                continue
            new_value = fields[column]
            if key == "options" and column in fields:
                new_value = json.loads(new_value) if new_value else None
            if key == "needs_review":
                new_value = bool(new_value)
            if new_value != public[key]:
                semantic_changed = True
                break
        if semantic_changed and "revision" not in fields:
            fields["revision"] = row["revision"] + 1
            fields["explanation_json"] = None
            fields["explanation_revision"] = None
            fields["explain_state"] = "none"
        keys = list(fields)
        conn.execute(
            f"UPDATE questions SET {', '.join(k + ' = ?' for k in keys)} "
            "WHERE job_id = ? AND qid = ?",
            [fields[k] for k in keys] + [job_id, qid],
        )
def refresh_stats(job_id: str) -> dict:
    """按题目状态重算统计，并在同一写事务中写回。"""
    from .jobs import update_job
    with transaction():
        rows = get_conn().execute(
            "SELECT status, COUNT(*) AS n FROM questions WHERE job_id = ? GROUP BY status",
            (job_id,),
        ).fetchall()
        stats = {"total": 0, "correct": 0, "wrong": 0, "unknown": 0, "subjective": 0}
        for r in rows:
            stats["total"] += r["n"]
            if r["status"] in stats:
                stats[r["status"]] += r["n"]
        update_job(job_id, stats=stats)
        return stats
