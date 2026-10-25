from __future__ import annotations

import json
import time

from ..db import get_conn, transaction

def add_feedback(user_id: int, message: str | None, page: str | None, diag: dict) -> int:
    conn = get_conn()
    with transaction():
        cur = conn.execute(
            "INSERT INTO feedback (user_id, message, page, diag_json, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (user_id, message, page, json.dumps(diag, ensure_ascii=False), time.time()),
        )
    return cur.lastrowid


def list_feedback(limit: int = 200) -> list[dict]:
    rows = get_conn().execute(
        """SELECT f.*, u.username FROM feedback f
           LEFT JOIN users u ON u.id = f.user_id
           ORDER BY f.created_at DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    return [
        {
            "id": r["id"], "username": r["username"], "message": r["message"],
            "page": r["page"], "created_at": r["created_at"],
            "diag": json.loads(r["diag_json"]) if r["diag_json"] else {},
        }
        for r in rows
    ]


def delete_feedback(feedback_id: int) -> bool:
    conn = get_conn()
    with transaction():
        cur = conn.execute("DELETE FROM feedback WHERE id = ?", (feedback_id,))
    return cur.rowcount > 0
