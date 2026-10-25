"""聊天历史的分页读取与一问一答原子写入。"""
from __future__ import annotations

import threading
import time

from .db import get_conn, transaction

_locks: dict[str, threading.RLock] = {}
_locks_guard = threading.Lock()


def chat_lock(job_id: str, qid: str | None) -> threading.RLock:
    key = f"{job_id}:{qid or ''}"
    with _locks_guard:
        return _locks.setdefault(key, threading.RLock())


def get_chat_page(job_id: str, qid: str | None, limit: int = 100,
                  before_id: int | None = None) -> tuple[list[dict], bool]:
    sql = "SELECT id, role, content FROM chat_messages WHERE job_id = ? AND qid IS ?"
    params: list = [job_id, qid]
    if before_id is not None:
        sql += " AND id < ?"
        params.append(before_id)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit + 1)
    rows = get_conn().execute(sql, params).fetchall()
    has_more = len(rows) > limit
    rows = rows[:limit]
    rows.reverse()
    return [dict(row) for row in rows], has_more


def recent_chat(job_id: str, qid: str | None, limit: int = 12) -> list[dict]:
    return get_chat_page(job_id, qid, limit)[0]


def add_chat_exchange(job_id: str, qid: str | None, question: str, answer: str) -> None:
    now = time.time()
    with transaction():
        conn = get_conn()
        conn.execute(
            "INSERT INTO chat_messages (job_id, qid, role, content, created_at) VALUES (?, ?, 'user', ?, ?)",
            (job_id, qid, question, now),
        )
        conn.execute(
            "INSERT INTO chat_messages (job_id, qid, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)",
            (job_id, qid, answer, now),
        )
