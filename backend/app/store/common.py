from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
import weakref
from pathlib import Path

class ProcessingLimitError(RuntimeError):
    pass


_locks: weakref.WeakValueDictionary[tuple[str, str], threading.RLock] = (
    weakref.WeakValueDictionary()
)
_locks_guard = threading.Lock()


def _resource_lock(kind: str, item_id: str) -> threading.RLock:
    key = (kind, item_id)
    with _locks_guard:
        lock = _locks.get(key)
        if lock is None:
            lock = threading.RLock()
            _locks[key] = lock
        return lock


def paper_lock(paper_id: str) -> threading.RLock:
    return _resource_lock("paper", paper_id)


def job_lock(job_id: str) -> threading.RLock:
    return _resource_lock("job", job_id)


def write_json_atomic(path: Path, data, indent: int | None = None) -> None:
    """原子写 JSON：先写临时文件再 rename，崩溃/并发读不会拿到半截文件。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex[:8]}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=indent), encoding="utf-8")
    os.replace(tmp, path)
def _reserve_processing_slot(conn: sqlite3.Connection, user_id: int,
                             maximum: int | None) -> None:
    if maximum is None:
        return
    active = conn.execute(
        """SELECT (SELECT COUNT(*) FROM jobs WHERE user_id = ? AND status = 'processing') +
                  (SELECT COUNT(*) FROM papers WHERE user_id = ? AND status = 'processing')""",
        (user_id, user_id),
    ).fetchone()[0]
    if active >= maximum:
        raise ProcessingLimitError("processing slot limit reached")
