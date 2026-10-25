from __future__ import annotations

import time

from ..db import get_conn, transaction

def add_chat_message(job_id: str, qid: str | None, role: str, content: str) -> None:
    conn = get_conn()
    with transaction():
        conn.execute(
            "INSERT INTO chat_messages (job_id, qid, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
            (job_id, qid, role, content, time.time()),
        )


def get_chat(job_id: str, qid: str | None) -> list[dict]:
    rows = get_conn().execute(
        "SELECT role, content FROM chat_messages WHERE job_id = ? AND qid IS ? ORDER BY id",
        (job_id, qid),
    ).fetchall()
    return [{"role": r["role"], "content": r["content"]} for r in rows]
