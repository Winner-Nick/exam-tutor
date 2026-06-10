"""SQLite 持久化 DAO：users / invite_codes / jobs / questions / chat_messages。

PDF 与页面图片仍存文件系统 data/jobs/{job_id}/，由 job_dir() 推导路径。
题目在 DAO 边界转换为旧版 job.json 的字段形状（id/options/explanation 为
Python 对象），上层代码无需关心 JSON 列的编码细节。
"""
from __future__ import annotations

import json
import secrets
import shutil
import time
import uuid
from pathlib import Path

from .config import JOBS_DIR
from .db import get_conn

# ---------------------------------------------------------------------------
# 作业文件目录
# ---------------------------------------------------------------------------

def new_job_id() -> str:
    return uuid.uuid4().hex[:12]


def job_dir(job_id: str) -> Path:
    d = JOBS_DIR / job_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def pdf_path(job_id: str) -> Path:
    return job_dir(job_id) / "source.pdf"


# ---------------------------------------------------------------------------
# users
# ---------------------------------------------------------------------------

def create_user(username: str, password_hash: str, role: str = "user") -> int:
    conn = get_conn()
    with conn:
        cur = conn.execute(
            "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
            (username, password_hash, role, time.time()),
        )
    return cur.lastrowid


def get_user_by_username(username: str) -> dict | None:
    row = get_conn().execute(
        "SELECT * FROM users WHERE username = ?", (username,)
    ).fetchone()
    return dict(row) if row else None


def get_user(user_id: int) -> dict | None:
    row = get_conn().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return dict(row) if row else None


def set_password(user_id: int, password_hash: str) -> None:
    conn = get_conn()
    with conn:
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))


def count_users() -> int:
    return get_conn().execute("SELECT COUNT(*) FROM users").fetchone()[0]


# ---------------------------------------------------------------------------
# invite codes
# ---------------------------------------------------------------------------

def create_invite(created_by: int, max_uses: int = 1, ttl_days: float | None = None) -> str:
    code = secrets.token_urlsafe(8)
    expires_at = time.time() + ttl_days * 86400 if ttl_days else None
    conn = get_conn()
    with conn:
        conn.execute(
            "INSERT INTO invite_codes (code, created_by, max_uses, expires_at) VALUES (?, ?, ?, ?)",
            (code, created_by, max_uses, expires_at),
        )
    return code


def list_invites() -> list[dict]:
    rows = get_conn().execute(
        "SELECT * FROM invite_codes ORDER BY rowid DESC LIMIT 50"
    ).fetchall()
    return [dict(r) for r in rows]


def consume_invite(code: str) -> bool:
    """原子核销：有效则 used_count+1 并返回 True。"""
    conn = get_conn()
    with conn:
        cur = conn.execute(
            """UPDATE invite_codes SET used_count = used_count + 1
               WHERE code = ? AND used_count < max_uses
                 AND (expires_at IS NULL OR expires_at > ?)""",
            (code, time.time()),
        )
    return cur.rowcount > 0


# ---------------------------------------------------------------------------
# jobs
# ---------------------------------------------------------------------------

_JOB_FIELDS = {
    "filename", "title", "pdf_sha256", "status", "stage", "progress_done",
    "progress_total", "progress_label", "error", "page_count", "meta_json",
    "stats_json",
}


def create_job(job_id: str, user_id: int, filename: str | None,
               pdf_sha256: str | None = None, created_at: float | None = None) -> None:
    conn = get_conn()
    with conn:
        conn.execute(
            """INSERT INTO jobs (id, user_id, filename, pdf_sha256, status, stage,
                                 progress_done, progress_total, progress_label, created_at)
               VALUES (?, ?, ?, ?, 'processing', 'queued', 0, 1, '排队中…', ?)""",
            (job_id, user_id, filename, pdf_sha256, created_at or time.time()),
        )


def update_job(job_id: str, **fields) -> None:
    if "meta" in fields:
        fields["meta_json"] = json.dumps(fields.pop("meta"), ensure_ascii=False)
    if "stats" in fields:
        fields["stats_json"] = json.dumps(fields.pop("stats"), ensure_ascii=False)
    bad = set(fields) - _JOB_FIELDS
    if bad:
        raise ValueError(f"未知 job 字段: {bad}")
    if not fields:
        return
    keys = list(fields)
    conn = get_conn()
    with conn:
        conn.execute(
            f"UPDATE jobs SET {', '.join(k + ' = ?' for k in keys)} WHERE id = ?",
            [fields[k] for k in keys] + [job_id],
        )


def set_progress(job_id: str, stage: str, done: int, total: int, label: str) -> None:
    update_job(job_id, stage=stage, progress_done=done, progress_total=total,
               progress_label=label)


def _job_row_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "filename": row["filename"],
        "status": row["status"],
        "stage": row["stage"],
        "progress": {
            "done": row["progress_done"],
            "total": row["progress_total"],
            "label": row["progress_label"],
        },
        "error": row["error"],
        "page_count": row["page_count"],
        "created_at": row["created_at"],
        "meta": json.loads(row["meta_json"]) if row["meta_json"] else {},
        "stats": json.loads(row["stats_json"]) if row["stats_json"] else {},
    }


def get_job(job_id: str) -> dict | None:
    row = get_conn().execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return _job_row_to_dict(row) if row else None


def get_job_full(job_id: str) -> dict | None:
    """作业 + 全部题目（兼容旧 job.json 的响应形状）。"""
    job = get_job(job_id)
    if job is None:
        return None
    job["questions"] = get_questions(job_id)
    return job


def list_jobs(user_id: int) -> list[dict]:
    rows = get_conn().execute(
        "SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC", (user_id,)
    ).fetchall()
    return [_job_row_to_dict(r) for r in rows]


def delete_job(job_id: str) -> None:
    conn = get_conn()
    with conn:
        conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
    shutil.rmtree(JOBS_DIR / job_id, ignore_errors=True)


def find_reusable_job_by_sha(sha256: str, exclude_id: str) -> str | None:
    """找一个相同 PDF 且已有视觉识别缓存的旧作业（跨用户，转写只依赖文件内容）。"""
    rows = get_conn().execute(
        "SELECT id FROM jobs WHERE pdf_sha256 = ? AND id != ? ORDER BY created_at DESC",
        (sha256, exclude_id),
    ).fetchall()
    for r in rows:
        if (JOBS_DIR / r["id"] / "pages_raw.json").exists():
            return r["id"]
    return None


def count_processing(user_id: int) -> int:
    return get_conn().execute(
        "SELECT COUNT(*) FROM jobs WHERE user_id = ? AND status = 'processing'",
        (user_id,),
    ).fetchone()[0]


def count_recent_uploads(user_id: int, hours: float = 24) -> int:
    return get_conn().execute(
        "SELECT COUNT(*) FROM jobs WHERE user_id = ? AND created_at > ?",
        (user_id, time.time() - hours * 3600),
    ).fetchone()[0]


def list_processing_job_ids() -> list[str]:
    rows = get_conn().execute("SELECT id FROM jobs WHERE status = 'processing'").fetchall()
    return [r["id"] for r in rows]


# ---------------------------------------------------------------------------
# questions
# ---------------------------------------------------------------------------

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
    }


def replace_questions(job_id: str, questions: list[dict]) -> None:
    conn = get_conn()
    with conn:
        conn.execute("DELETE FROM questions WHERE job_id = ?", (job_id,))
        conn.executemany(
            """INSERT INTO questions (job_id, qid, number, section, type, stem,
                   options_json, passage, student_answer, correct_answer, status,
                   knowledge_point, explanation_json, explain_state)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    job_id, q["id"], q.get("number"), q.get("section"), q.get("type"),
                    q.get("stem"),
                    json.dumps(q["options"], ensure_ascii=False) if q.get("options") else None,
                    q.get("passage"), q.get("student_answer"), q.get("correct_answer"),
                    q.get("status") or "unknown", q.get("knowledge_point"),
                    json.dumps(q["explanation"], ensure_ascii=False) if q.get("explanation") else None,
                    q.get("explain_state") or ("done" if q.get("explanation") else "none"),
                )
                for q in questions
            ],
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
    "student_answer", "correct_answer", "status", "knowledge_point",
    "explanation_json", "explain_state",
}


def update_question(job_id: str, qid: str, **fields) -> None:
    if "explanation" in fields:
        exp = fields.pop("explanation")
        fields["explanation_json"] = json.dumps(exp, ensure_ascii=False) if exp else None
    bad = set(fields) - _Q_FIELDS
    if bad:
        raise ValueError(f"未知 question 字段: {bad}")
    if not fields:
        return
    keys = list(fields)
    conn = get_conn()
    with conn:
        conn.execute(
            f"UPDATE questions SET {', '.join(k + ' = ?' for k in keys)} "
            "WHERE job_id = ? AND qid = ?",
            [fields[k] for k in keys] + [job_id, qid],
        )


def refresh_stats(job_id: str) -> dict:
    """按题目状态重算统计并写回 jobs.stats_json。"""
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


def mark_explain_queued(job_id: str, qids: list[str]) -> list[str]:
    """把待讲解题置为 queued，返回实际发生转移的 qid（防重复入队）。"""
    out: list[str] = []
    conn = get_conn()
    with conn:
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
    with conn:
        conn.execute(
            "UPDATE questions SET explain_state = 'queued' WHERE explain_state = 'generating'"
        )
    rows = conn.execute(
        "SELECT job_id, qid FROM questions WHERE explain_state = 'queued' ORDER BY job_id, id"
    ).fetchall()
    return [(r["job_id"], r["qid"]) for r in rows]


# ---------------------------------------------------------------------------
# chat
# ---------------------------------------------------------------------------

def add_chat_message(job_id: str, qid: str | None, role: str, content: str) -> None:
    conn = get_conn()
    with conn:
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
