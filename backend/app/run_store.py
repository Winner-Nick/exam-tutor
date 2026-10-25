"""SQLite 持久任务运行与创建幂等状态。"""
from __future__ import annotations

import asyncio
import json
import sqlite3
import threading
import time
import uuid
import weakref
from contextlib import asynccontextmanager, contextmanager
from typing import AsyncIterator, Iterator

from .db import get_conn, transaction

ACTIVE_STATUSES = ("queued", "running", "waiting")
TERMINAL_STATUSES = ("done", "error")
IDEMPOTENCY_KEY_MAX_LENGTH = 128


class RetryLater(RuntimeError):
    def __init__(self, message: str, *, delay: float = 2.0) -> None:
        super().__init__(message)
        self.delay = max(0.1, delay)


class StaleRun(RuntimeError):
    pass


def _row(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    result = dict(row)
    result["options"] = json.loads(result.pop("options_json") or "{}")
    return result


def get_run(run_id: str) -> dict | None:
    return _row(get_conn().execute("SELECT * FROM task_runs WHERE id = ?", (run_id,)).fetchone())


def enqueue_run(resource_type: str, resource_id: str, operation: str, owner_id: int, *,
                options: dict | None = None, max_attempts: int = 5,
                available_at: float | None = None) -> tuple[dict, bool]:
    """返回 (run, 新建)。同资源活动 run 去重，后续 operation 追加为 followup。"""
    now = time.time()
    available = available_at if available_at is not None else now
    conn = get_conn()
    with transaction():
        active = conn.execute(
            """SELECT * FROM task_runs
               WHERE resource_type = ? AND resource_id = ?
                 AND status IN ('queued', 'running', 'waiting')
               ORDER BY created_at, id LIMIT 1""",
            (resource_type, resource_id),
        ).fetchone()
        if active:
            current = _row(active)
            if current["operation"] != operation:
                followups = list(current["options"].get("followups") or [])
                candidate = {"operation": operation, "options": options or {},
                             "max_attempts": max_attempts}
                if not any(item["operation"] == operation for item in followups):
                    followups.append(candidate)
                    updated_options = dict(current["options"])
                    updated_options["followups"] = followups
                    conn.execute(
                        "UPDATE task_runs SET options_json = ?, updated_at = ? WHERE id = ?",
                        (json.dumps(updated_options, ensure_ascii=False), now, active["id"]),
                    )
                    current["options"] = updated_options
            return current, False
        generation = conn.execute(
            "SELECT COALESCE(MAX(generation), 0) + 1 FROM task_runs "
            "WHERE resource_type = ? AND resource_id = ?",
            (resource_type, resource_id),
        ).fetchone()[0]
        run_id = uuid.uuid4().hex
        status = "queued" if available <= now else "waiting"
        conn.execute(
            """INSERT INTO task_runs
               (id, resource_type, resource_id, operation, owner_id, status, generation,
                attempt, max_attempts, options_json, available_at, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)""",
            (run_id, resource_type, resource_id, operation, owner_id, status, generation,
             max_attempts, json.dumps(options or {}, ensure_ascii=False), available, now, now),
        )
        row = get_run(run_id)
        return row, True  # type: ignore[return-value]


def claim_run(run_id: str) -> dict | None:
    now = time.time()
    conn = get_conn()
    with transaction():
        row = conn.execute("SELECT * FROM task_runs WHERE id = ?", (run_id,)).fetchone()
        if not row or row["status"] not in ("queued", "waiting"):
            return None
        if row["available_at"] > now:
            if row["status"] != "waiting":
                conn.execute(
                    "UPDATE task_runs SET status = 'waiting', updated_at = ? WHERE id = ?",
                    (now, run_id),
                )
            return None
        cur = conn.execute(
            """UPDATE task_runs SET status = 'running', attempt = attempt + 1,
                 started_at = COALESCE(started_at, ?), heartbeat_at = ?, updated_at = ?
               WHERE id = ? AND generation = ? AND status IN ('queued', 'waiting')""",
            (now, now, now, run_id, row["generation"]),
        )
        if cur.rowcount != 1:
            return None
        return get_run(run_id)


def assert_current(run_id: str, generation: int, attempt: int | None = None) -> None:
    sql = "SELECT 1 FROM task_runs WHERE id = ? AND generation = ? AND status = 'running'"
    params: list = [run_id, generation]
    if attempt is not None:
        sql += " AND attempt = ?"
        params.append(attempt)
    if not get_conn().execute(sql, params).fetchone():
        raise StaleRun(f"任务运行已失效: {run_id}@{generation}/{attempt}")


def heartbeat(run_id: str, generation: int, attempt: int | None = None) -> bool:
    now = time.time()
    sql = "UPDATE task_runs SET heartbeat_at = ?, updated_at = ? WHERE id = ? AND generation = ? AND status = 'running'"
    params: list = [now, now, run_id, generation]
    if attempt is not None:
        sql += " AND attempt = ?"
        params.append(attempt)
    with transaction():
        cur = get_conn().execute(sql, params)
    return cur.rowcount == 1


def mark_done(run_id: str, generation: int, attempt: int | None = None) -> bool:
    now = time.time()
    sql = """UPDATE task_runs SET status = 'done', finished_at = ?, updated_at = ?,
               heartbeat_at = NULL, last_error = NULL
             WHERE id = ? AND generation = ? AND status = 'running'"""
    params: list = [now, now, run_id, generation]
    if attempt is not None:
        sql += " AND attempt = ?"
        params.append(attempt)
    with transaction():
        cur = get_conn().execute(sql, params)
    return cur.rowcount == 1


def mark_retry(run_id: str, generation: int, error: str, delay: float,
               attempt: int | None = None) -> str:
    now = time.time()
    conn = get_conn()
    with transaction():
        row = conn.execute("SELECT * FROM task_runs WHERE id = ?", (run_id,)).fetchone()
        if (not row or row["generation"] != generation or row["status"] != "running"
                or (attempt is not None and row["attempt"] != attempt)):
            return "stale"
        if row["attempt"] >= row["max_attempts"]:
            conn.execute(
                """UPDATE task_runs SET status = 'error', finished_at = ?, updated_at = ?,
                     heartbeat_at = NULL, last_error = ? WHERE id = ? AND generation = ?""",
                (now, now, error, run_id, generation),
            )
            return "error"
        conn.execute(
            """UPDATE task_runs SET status = 'waiting', available_at = ?, updated_at = ?,
                 heartbeat_at = NULL, last_error = ? WHERE id = ? AND generation = ?""",
            (now + max(0.1, delay), now, error, run_id, generation),
        )
        return "waiting"


def mark_error(run_id: str, generation: int, error: str, attempt: int | None = None) -> bool:
    now = time.time()
    sql = """UPDATE task_runs SET status = 'error', finished_at = ?, updated_at = ?,
               heartbeat_at = NULL, last_error = ?
             WHERE id = ? AND generation = ? AND status = 'running'"""
    params: list = [now, now, error, run_id, generation]
    if attempt is not None:
        sql += " AND attempt = ?"
        params.append(attempt)
    with transaction():
        cur = get_conn().execute(sql, params)
    return cur.rowcount == 1


def recover_running() -> int:
    now = time.time()
    with transaction():
        cur = get_conn().execute(
            """UPDATE task_runs SET status = 'queued', available_at = ?, updated_at = ?,
                 heartbeat_at = NULL WHERE status = 'running'""",
            (now, now),
        )
    return cur.rowcount


def list_active_runs(*, due_only: bool = False) -> list[dict]:
    now = time.time()
    condition = "AND available_at <= ?" if due_only else ""
    params = (now,) if due_only else ()
    rows = get_conn().execute(
        f"""SELECT * FROM task_runs
            WHERE status IN ('queued', 'waiting') {condition}
            ORDER BY available_at, created_at, id""", params,
    ).fetchall()
    return [_row(row) for row in rows]


def followups(run: dict) -> None:
    current = get_run(run["id"]) or run
    for item in current.get("options", {}).get("followups") or []:
        enqueue_run(
            current["resource_type"], current["resource_id"], item["operation"], current["owner_id"],
            options=item.get("options") or {}, max_attempts=item.get("max_attempts") or 5,
        )


def list_outdated_submissions(paper_id: str | None = None) -> list[str]:
    sql = """SELECT j.id FROM jobs j JOIN papers p ON p.id = j.paper_id
             WHERE j.kind = 'submission' AND j.status != 'processing'
               AND (j.applied_paper_revision IS NULL
                    OR j.applied_paper_revision < p.revision)"""
    params: tuple = ()
    if paper_id is not None:
        sql += " AND j.paper_id = ?"
        params = (paper_id,)
    return [row[0] for row in get_conn().execute(sql, params).fetchall()]


def count_outdated_submissions(paper_id: str, *, force: bool = False) -> int:
    if force:
        return get_conn().execute(
            "SELECT COUNT(*) FROM jobs WHERE paper_id = ? AND kind = 'submission' "
            "AND status != 'processing'", (paper_id,),
        ).fetchone()[0]
    return get_conn().execute(
        """SELECT COUNT(*) FROM jobs j JOIN papers p ON p.id = j.paper_id
           WHERE j.paper_id = ? AND j.kind = 'submission' AND j.status != 'processing'
             AND (j.applied_paper_revision IS NULL
                  OR j.applied_paper_revision < p.revision)""", (paper_id,),
    ).fetchone()[0]


_idempotency_locks: weakref.WeakValueDictionary[tuple[int, str, str], threading.RLock] = (
    weakref.WeakValueDictionary()
)
_idempotency_locks_guard = threading.Lock()


@contextmanager
def idempotency_lock(owner_id: int, operation: str, key: str) -> Iterator[None]:
    lock_key = (owner_id, operation, key)
    with _idempotency_locks_guard:
        lock = _idempotency_locks.get(lock_key)
        if lock is None:
            lock = threading.RLock()
            _idempotency_locks[lock_key] = lock
    with lock:
        yield


_async_idempotency_locks: weakref.WeakValueDictionary = weakref.WeakValueDictionary()


@asynccontextmanager
async def async_idempotency_lock(owner_id: int, operation: str, key: str) -> AsyncIterator[None]:
    lock_key = (asyncio.get_running_loop(), owner_id, operation, key)
    with _idempotency_locks_guard:
        lock = _async_idempotency_locks.get(lock_key)
        if lock is None:
            lock = asyncio.Lock()
            _async_idempotency_locks[lock_key] = lock
    async with lock:
        yield


def _idempotency_row(owner_id: int, operation: str, key: str) -> sqlite3.Row | None:
    return get_conn().execute(
        "SELECT * FROM idempotency_keys WHERE owner_id = ? AND operation = ? AND key = ?",
        (owner_id, operation, key),
    ).fetchone()


def _resource_exists(resource_type: str, resource_id: str) -> bool:
    table = "papers" if resource_type == "paper" else "jobs"
    return bool(get_conn().execute(
        f"SELECT 1 FROM {table} WHERE id = ?", (resource_id,),
    ).fetchone())


def begin_idempotency(owner_id: int, operation: str, key: str,
                      resource_type: str, resource_id: str) -> tuple[str, bool]:
    if not key or len(key) > IDEMPOTENCY_KEY_MAX_LENGTH:
        raise ValueError(f"Idempotency-Key 长度需为 1-{IDEMPOTENCY_KEY_MAX_LENGTH}")
    now = time.time()
    conn = get_conn()
    with transaction():
        row = _idempotency_row(owner_id, operation, key)
        if row:
            resource_id = row["resource_id"]
            exists = _resource_exists(resource_type, resource_id)
            if row["status"] in ("created", "files_ready") and exists:
                conn.execute(
                    "UPDATE idempotency_keys SET status = 'created', updated_at = ? "
                    "WHERE owner_id = ? AND operation = ? AND key = ?",
                    (now, owner_id, operation, key),
                )
                return resource_id, True
            if row["status"] == "failed":
                cleanup_running = conn.execute(
                    """SELECT 1 FROM task_runs
                       WHERE resource_type = ? AND resource_id = ?
                         AND operation IN ('cleanup', 'cleanup_files')
                         AND status IN ('queued', 'running', 'waiting') LIMIT 1""",
                    (resource_type, resource_id),
                ).fetchone()
                if exists or cleanup_running:
                    raise ValueError("上次创建的资源仍在清理，请稍后重试")
            conn.execute(
                "UPDATE idempotency_keys SET status = 'reserved', updated_at = ? "
                "WHERE owner_id = ? AND operation = ? AND key = ?",
                (now, owner_id, operation, key),
            )
            return resource_id, False
        conn.execute(
            """INSERT INTO idempotency_keys
               (owner_id, operation, key, resource_type, resource_id, status,
                created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?)""",
            (owner_id, operation, key, resource_type, resource_id, now, now),
        )
        return resource_id, False


def mark_files_ready(owner_id: int, operation: str, key: str) -> None:
    with transaction():
        get_conn().execute(
            "UPDATE idempotency_keys SET status = 'files_ready', updated_at = ? "
            "WHERE owner_id = ? AND operation = ? AND key = ?",
            (time.time(), owner_id, operation, key),
        )


def complete_idempotency(owner_id: int, operation: str, key: str) -> None:
    with transaction():
        get_conn().execute(
            "UPDATE idempotency_keys SET status = 'created', updated_at = ? "
            "WHERE owner_id = ? AND operation = ? AND key = ?",
            (time.time(), owner_id, operation, key),
        )


def release_idempotency(owner_id: int, operation: str, key: str) -> None:
    with transaction():
        get_conn().execute(
            "UPDATE idempotency_keys SET status = 'failed', updated_at = ? "
            "WHERE owner_id = ? AND operation = ? AND key = ?",
            (time.time(), owner_id, operation, key),
        )


def get_idempotency(owner_id: int, operation: str, key: str) -> dict | None:
    row = _idempotency_row(owner_id, operation, key)
    return dict(row) if row else None
