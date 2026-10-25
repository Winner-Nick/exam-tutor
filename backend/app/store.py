"""SQLite 持久化 DAO：users / invite_codes / jobs / questions / chat_messages。

PDF 与页面图片仍存文件系统 data/jobs/{job_id}/，由 job_dir() 推导路径。
题目在 DAO 边界转换为旧版 job.json 的字段形状（id/options/explanation 为
Python 对象），上层代码无需关心 JSON 列的编码细节。
"""
from __future__ import annotations

import json
import os
import secrets
import shutil
import sqlite3
import threading
import time
import uuid
from pathlib import Path

from .config import JOBS_DIR, PAPERS_DIR, VISION_CACHE_DIR
from .db import get_conn, transaction


class ProcessingLimitError(RuntimeError):
    pass


_locks: dict[tuple[str, str], threading.RLock] = {}
_locks_guard = threading.Lock()


def _resource_lock(kind: str, item_id: str) -> threading.RLock:
    with _locks_guard:
        return _locks.setdefault((kind, item_id), threading.RLock())


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

# ---------------------------------------------------------------------------
# 文件目录
# ---------------------------------------------------------------------------

def new_job_id() -> str:
    return uuid.uuid4().hex[:12]


def job_dir(job_id: str) -> Path:
    d = JOBS_DIR / job_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def pdf_path(job_id: str) -> Path:
    return job_dir(job_id) / "source.pdf"


def paper_dir(paper_id: str) -> Path:
    d = PAPERS_DIR / paper_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def vision_cache_path(sha256: str, mode: str) -> Path:
    """视觉识别结果缓存。mode: 'full'（试卷全量）或 'ans-{paper_id}'（仅学生答案）。"""
    return VISION_CACHE_DIR / f"{sha256}.{mode}.json"


def paper_file_path(paper_id: str, file_id: str) -> Path | None:
    for p in (paper_dir(paper_id) / "files").glob(f"{file_id}.*"):
        return p
    return None


def job_file_path(job_id: str, file_id: str) -> Path | None:
    for p in (job_dir(job_id) / "files").glob(f"{file_id}.*"):
        return p
    return None


def job_files(job_id: str) -> list[dict]:
    """作答提交的文件清单（files.json）。legacy 作业没有清单，返回 []。"""
    p = job_dir(job_id) / "files.json"
    if not p.exists():
        return []
    return json.loads(p.read_text(encoding="utf-8"))


def save_job_files(job_id: str, files: list[dict]) -> None:
    write_json_atomic(job_dir(job_id) / "files.json", files, indent=2)


# ---------------------------------------------------------------------------
# users
# ---------------------------------------------------------------------------

def create_user(username: str, password_hash: str, role: str = "user") -> int:
    conn = get_conn()
    with transaction():
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
    with transaction():
        get_conn().execute(
            "UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?",
            (password_hash, user_id),
        )


def count_users() -> int:
    return get_conn().execute("SELECT COUNT(*) FROM users").fetchone()[0]


def list_users() -> list[dict]:
    rows = get_conn().execute(
        """SELECT u.id, u.username, u.role, u.created_at, u.session_version,
                  u.teacher_id, t.username AS teacher_username,
                  u.student_id, s.name AS student_name
           FROM users u LEFT JOIN users t ON t.id = u.teacher_id
           LEFT JOIN students s ON s.id = u.student_id
           ORDER BY u.created_at, u.id"""
    ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# 学生登录账号（挂在老师账号 + 学生档案下）
# ---------------------------------------------------------------------------

def create_student_account(teacher_id: int, student_row_id: int,
                           username: str, password_hash: str) -> int:
    conn = get_conn()
    with transaction():
        if conn.execute("SELECT 1 FROM users WHERE student_id = ?", (student_row_id,)).fetchone():
            raise sqlite3.IntegrityError("student account already exists")
        if conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
            raise sqlite3.IntegrityError("username already exists")
        cur = conn.execute(
            """INSERT INTO users (username, password_hash, role, created_at, teacher_id, student_id)
               VALUES (?, ?, 'student', ?, ?, ?)""",
            (username, password_hash, time.time(), teacher_id, student_row_id),
        )
    return cur.lastrowid


def get_account_for_student(student_row_id: int) -> dict | None:
    row = get_conn().execute(
        "SELECT * FROM users WHERE student_id = ?", (student_row_id,)
    ).fetchone()
    return dict(row) if row else None


def delete_student_account(student_row_id: int) -> bool:
    conn = get_conn()
    with transaction():
        cur = conn.execute("DELETE FROM users WHERE student_id = ?", (student_row_id,))
    return cur.rowcount > 0


# ---------------------------------------------------------------------------
# invite codes
# ---------------------------------------------------------------------------

def create_invite(created_by: int, max_uses: int = 1, ttl_days: float | None = None) -> str:
    code = secrets.token_urlsafe(8)
    expires_at = time.time() + ttl_days * 86400 if ttl_days else None
    conn = get_conn()
    with transaction():
        conn.execute(
            "INSERT INTO invite_codes (code, created_by, max_uses, expires_at, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (code, created_by, max_uses, expires_at, time.time()),
        )
    return code


def list_invites() -> list[dict]:
    """邀请码列表（带创建者用户名与计算出的状态）。"""
    rows = get_conn().execute(
        """SELECT i.*, u.username AS created_by_name
           FROM invite_codes i LEFT JOIN users u ON u.id = i.created_by
           ORDER BY i.rowid DESC LIMIT 100"""
    ).fetchall()
    now = time.time()
    out = []
    for r in rows:
        d = dict(r)
        if d["used_count"] >= d["max_uses"]:
            d["status"] = "used_up"
        elif d["expires_at"] and d["expires_at"] <= now:
            d["status"] = "expired"
        else:
            d["status"] = "active"
        out.append(d)
    return out


def delete_invite(code: str) -> bool:
    conn = get_conn()
    with transaction():
        cur = conn.execute("DELETE FROM invite_codes WHERE code = ?", (code,))
    return cur.rowcount > 0


def consume_invite(code: str) -> bool:
    """原子核销：有效则 used_count+1 并返回 True。"""
    conn = get_conn()
    with transaction():
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


def create_job(job_id: str, user_id: int, filename: str | None,
               pdf_sha256: str | None = None, created_at: float | None = None,
               kind: str = "legacy", paper_id: str | None = None,
               student_id: int | None = None,
               max_processing: int | None = None) -> None:
    conn = get_conn()
    with transaction():
        _reserve_processing_slot(conn, user_id, max_processing)
        conn.execute(
            """INSERT INTO jobs (id, user_id, filename, pdf_sha256, status, stage,
                                 progress_done, progress_total, progress_label, created_at,
                                 kind, paper_id, student_id)
               VALUES (?, ?, ?, ?, 'processing', 'queued', 0, 1, '排队中…', ?, ?, ?, ?)""",
            (job_id, user_id, filename, pdf_sha256, created_at or time.time(),
             kind, paper_id, student_id),
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
    with transaction():
        conn.execute(
            f"UPDATE jobs SET {', '.join(k + ' = ?' for k in keys)} WHERE id = ?",
            [fields[k] for k in keys] + [job_id],
        )


def set_progress(job_id: str, stage: str, done: int, total: int, label: str) -> None:
    update_job(job_id, stage=stage, progress_done=done, progress_total=total,
               progress_label=label)


def _job_row_to_dict(row) -> dict:
    keys = row.keys()
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "filename": row["filename"],
        "pdf_sha256": row["pdf_sha256"],
        "kind": row["kind"],
        "paper_id": row["paper_id"],
        "student_id": row["student_id"],
        "student_name": row["student_name"] if "student_name" in keys else None,
        "paper_title": row["paper_title"] if "paper_title" in keys else None,
        "subject": row["paper_subject"] if "paper_subject" in keys else None,
        "grade": row["paper_grade"] if "paper_grade" in keys else None,
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


_JOB_SELECT = """SELECT j.*, s.name AS student_name, p.title AS paper_title,
                        p.subject AS paper_subject, p.grade AS paper_grade
                 FROM jobs j
                 LEFT JOIN students s ON s.id = j.student_id
                 LEFT JOIN papers p ON p.id = j.paper_id"""


def get_job(job_id: str) -> dict | None:
    row = get_conn().execute(f"{_JOB_SELECT} WHERE j.id = ?", (job_id,)).fetchone()
    return _job_row_to_dict(row) if row else None


def get_job_full(job_id: str) -> dict | None:
    """作业 + 全部题目（兼容旧 job.json 的响应形状）。"""
    job = get_job(job_id)
    if job is None:
        return None
    job["questions"] = get_questions(job_id)
    return job


def list_jobs_page(user_id: int, student_id: int | None = None,
                   paper_id: str | None = None, q: str | None = None,
                   limit: int | None = None, offset: int = 0) -> tuple[list[dict], int]:
    sql = f"{_JOB_SELECT} WHERE j.user_id = ?"
    params: list = [user_id]
    if student_id is not None:
        sql += " AND j.student_id = ?"
        params.append(student_id)
    if paper_id is not None:
        sql += " AND j.paper_id = ?"
        params.append(paper_id)
    if q:
        sql += """ AND (j.title LIKE ? OR j.filename LIKE ? OR p.title LIKE ?
                       OR s.name LIKE ?)"""
        params.extend([f"%{q}%"] * 4)
    total = get_conn().execute(f"SELECT COUNT(*) FROM ({sql})", params).fetchone()[0]
    page_params = list(params)
    sql += " ORDER BY j.created_at DESC, j.id DESC"
    if limit is not None:
        sql += " LIMIT ? OFFSET ?"
        page_params.extend([limit, offset])
    rows = get_conn().execute(sql, page_params).fetchall()
    return [_job_row_to_dict(r) for r in rows], total


def list_jobs(user_id: int, student_id: int | None = None,
              paper_id: str | None = None) -> list[dict]:
    return list_jobs_page(user_id, student_id, paper_id)[0]


def delete_job(job_id: str) -> None:
    with transaction():
        get_conn().execute("DELETE FROM jobs WHERE id = ?", (job_id,))
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


def refresh_stats(job_id: str) -> dict:
    """按题目状态重算统计，并在同一写事务中写回。"""
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


# ---------------------------------------------------------------------------
# students
# ---------------------------------------------------------------------------

def ensure_self_student(user_id: int) -> dict:
    """每个老师账号有一条 is_self 学生（"我自己"），首次访问时自动创建。
    唯一索引兜底并发首访；撞索引时重查已有记录。"""
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM students WHERE user_id = ? AND is_self = 1", (user_id,)
    ).fetchone()
    if row:
        return dict(row)
    try:
        with transaction():
            cur = conn.execute(
                "INSERT INTO students (user_id, name, is_self, created_at) VALUES (?, '我自己', 1, ?)",
                (user_id, time.time()),
            )
        return get_student(cur.lastrowid)  # type: ignore[return-value]
    except sqlite3.IntegrityError:
        row = conn.execute(
            "SELECT * FROM students WHERE user_id = ? AND is_self = 1", (user_id,)
        ).fetchone()
        return dict(row)


def create_student(user_id: int, name: str, grade: str | None = None) -> dict:
    conn = get_conn()
    with transaction():
        if conn.execute(
            "SELECT 1 FROM students WHERE user_id = ? AND name = ? COLLATE NOCASE",
            (user_id, name),
        ).fetchone():
            raise sqlite3.IntegrityError("duplicate student name")
        cur = conn.execute(
            """INSERT INTO students (user_id, name, is_self, grade, created_at)
               VALUES (?, ?, 0, ?, ?)""",
            (user_id, name, grade, time.time()),
        )
    return get_student(cur.lastrowid)  # type: ignore[return-value]


def get_student(student_id: int) -> dict | None:
    row = get_conn().execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()
    return dict(row) if row else None


def list_students(user_id: int) -> list[dict]:
    rows = get_conn().execute(
        """SELECT s.*, COUNT(j.id) AS submission_count,
                  SUM(CASE WHEN j.status = 'done'
                       THEN json_extract(j.stats_json, '$.wrong') ELSE 0 END) AS wrong_total,
                  u.username AS account_username
           FROM students s LEFT JOIN jobs j ON j.student_id = s.id
           LEFT JOIN users u ON u.student_id = s.id
           WHERE s.user_id = ?
           GROUP BY s.id ORDER BY s.is_self DESC, s.created_at""",
        (user_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def rename_student(student_id: int, name: str, grade: str | None = None,
                   update_grade: bool = False) -> None:
    conn = get_conn()
    with transaction():
        student = conn.execute("SELECT user_id FROM students WHERE id = ?", (student_id,)).fetchone()
        if student and conn.execute(
            """SELECT 1 FROM students WHERE user_id = ? AND name = ? COLLATE NOCASE
               AND id != ?""",
            (student["user_id"], name, student_id),
        ).fetchone():
            raise sqlite3.IntegrityError("duplicate student name")
        conn.execute("UPDATE students SET name = ? WHERE id = ?", (name, student_id))
        if update_grade:
            conn.execute("UPDATE students SET grade = ? WHERE id = ?", (grade, student_id))


def count_student_submissions(student_id: int) -> int:
    return get_conn().execute(
        "SELECT COUNT(*) FROM jobs WHERE student_id = ?", (student_id,)
    ).fetchone()[0]


def delete_student(student_id: int) -> None:
    conn = get_conn()
    with transaction():
        if conn.execute("SELECT 1 FROM jobs WHERE student_id = ? LIMIT 1", (student_id,)).fetchone():
            raise sqlite3.IntegrityError("student has submissions")
        conn.execute("DELETE FROM users WHERE student_id = ?", (student_id,))
        conn.execute("DELETE FROM students WHERE id = ?", (student_id,))


# ---------------------------------------------------------------------------
# papers
# ---------------------------------------------------------------------------

_PAPER_FIELDS = {
    "title", "status", "stage", "progress_done", "progress_total",
    "progress_label", "error", "page_count", "meta_json", "subject", "grade",
}


def create_paper(paper_id: str, user_id: int, title: str | None,
                 subject: str | None = None, grade: str | None = None,
                 max_processing: int | None = None) -> None:
    conn = get_conn()
    with transaction():
        _reserve_processing_slot(conn, user_id, max_processing)
        conn.execute(
            """INSERT INTO papers (id, user_id, title, subject, grade, status, stage,
                                   progress_done, progress_total, progress_label, created_at)
               VALUES (?, ?, ?, ?, ?, 'processing', 'queued', 0, 1, '排队中…', ?)""",
            (paper_id, user_id, title, subject, grade, time.time()),
        )


def update_paper(paper_id: str, **fields) -> None:
    if "meta" in fields:
        fields["meta_json"] = json.dumps(fields.pop("meta"), ensure_ascii=False)
    bad = set(fields) - _PAPER_FIELDS
    if bad:
        raise ValueError(f"未知 paper 字段: {bad}")
    if not fields:
        return
    keys = list(fields)
    conn = get_conn()
    with transaction():
        conn.execute(
            f"UPDATE papers SET {', '.join(k + ' = ?' for k in keys)} WHERE id = ?",
            [fields[k] for k in keys] + [paper_id],
        )


def set_paper_progress(paper_id: str, stage: str, done: int, total: int, label: str) -> None:
    update_paper(paper_id, stage=stage, progress_done=done, progress_total=total,
                 progress_label=label)


def _paper_row_to_dict(row) -> dict:
    keys = row.keys()
    d = {
        "id": row["id"],
        "user_id": row["user_id"],
        "title": row["title"],
        "subject": row["subject"],
        "grade": row["grade"],
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
    }
    for extra in ("question_count", "answered_count", "submission_count"):
        if extra in keys:
            d[extra] = row[extra] or 0
    return d


def get_paper(paper_id: str) -> dict | None:
    row = get_conn().execute(
        """SELECT p.*,
                  (SELECT COUNT(*) FROM paper_questions q WHERE q.paper_id = p.id) AS question_count,
                  (SELECT COUNT(*) FROM paper_questions q
                    WHERE q.paper_id = p.id AND q.correct_answer IS NOT NULL) AS answered_count,
                  (SELECT COUNT(*) FROM jobs j WHERE j.paper_id = p.id) AS submission_count
           FROM papers p WHERE p.id = ?""",
        (paper_id,),
    ).fetchone()
    return _paper_row_to_dict(row) if row else None


_PAPER_SELECT = """SELECT p.*,
                  (SELECT COUNT(*) FROM paper_questions q WHERE q.paper_id = p.id) AS question_count,
                  (SELECT COUNT(*) FROM paper_questions q
                    WHERE q.paper_id = p.id AND q.correct_answer IS NOT NULL) AS answered_count,
                  (SELECT COUNT(*) FROM jobs j WHERE j.paper_id = p.id) AS submission_count
           FROM papers p"""


def list_papers_page(user_id: int, q: str | None = None, limit: int | None = None,
                     offset: int = 0, ready_only: bool = False) -> tuple[list[dict], int]:
    sql = f"{_PAPER_SELECT} WHERE p.user_id = ?"
    params: list = [user_id]
    if ready_only:
        sql += """ AND p.status = 'ready' AND EXISTS
                   (SELECT 1 FROM paper_questions pq WHERE pq.paper_id = p.id)"""
    if q:
        sql += " AND (p.title LIKE ? OR p.subject LIKE ? OR p.grade LIKE ?)"
        params.extend([f"%{q}%"] * 3)
    total = get_conn().execute(f"SELECT COUNT(*) FROM ({sql})", params).fetchone()[0]
    page_params = list(params)
    sql += " ORDER BY p.created_at DESC, p.id DESC"
    if limit is not None:
        sql += " LIMIT ? OFFSET ?"
        page_params.extend([limit, offset])
    rows = get_conn().execute(sql, page_params).fetchall()
    return [_paper_row_to_dict(r) for r in rows], total


def list_papers(user_id: int) -> list[dict]:
    return list_papers_page(user_id)[0]


def delete_paper(paper_id: str) -> None:
    conn = get_conn()
    with transaction():
        conn.execute("DELETE FROM papers WHERE id = ?", (paper_id,))
    shutil.rmtree(PAPERS_DIR / paper_id, ignore_errors=True)


def count_processing_papers(user_id: int) -> int:
    return get_conn().execute(
        "SELECT COUNT(*) FROM papers WHERE user_id = ? AND status = 'processing'",
        (user_id,),
    ).fetchone()[0]


def try_mark_paper_processing(paper_id: str) -> bool:
    """原子占位：仅当试卷当前非 processing 时置为 processing。防双击/重试导致
    同一试卷被两个 worker 并发处理（渲染目录会被互相清空）。"""
    conn = get_conn()
    with transaction():
        cur = conn.execute(
            """UPDATE papers SET status = 'processing', stage = 'queued',
                      progress_done = 0, progress_total = 1, progress_label = '排队中…',
                      error = NULL
               WHERE id = ? AND status != 'processing'""",
            (paper_id,),
        )
    return cur.rowcount > 0


def try_mark_job_processing(job_id: str) -> bool:
    """同上，作答提交补拍时的原子占位。"""
    conn = get_conn()
    with transaction():
        cur = conn.execute(
            """UPDATE jobs SET status = 'processing', stage = 'queued',
                      progress_done = 0, progress_total = 1, progress_label = '排队中…',
                      error = NULL
               WHERE id = ? AND status != 'processing'""",
            (job_id,),
        )
    return cur.rowcount > 0


def list_processing_paper_ids() -> list[str]:
    rows = get_conn().execute("SELECT id FROM papers WHERE status = 'processing'").fetchall()
    return [r["id"] for r in rows]


# ---------------------------------------------------------------------------
# paper files
# ---------------------------------------------------------------------------

def add_paper_file(paper_id: str, kind: str, filename: str | None,
                   sha256: str | None) -> str:
    fid = uuid.uuid4().hex[:12]
    conn = get_conn()
    with transaction():
        conn.execute(
            """INSERT INTO paper_files (id, paper_id, kind, filename, sha256, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (fid, paper_id, kind, filename, sha256, time.time()),
        )
    return fid


def list_paper_files(paper_id: str) -> list[dict]:
    rows = get_conn().execute(
        "SELECT * FROM paper_files WHERE paper_id = ? ORDER BY created_at, id", (paper_id,)
    ).fetchall()
    return [dict(r) for r in rows]


def set_paper_file_sha(file_id: str, sha256: str) -> None:
    conn = get_conn()
    with transaction():
        conn.execute("UPDATE paper_files SET sha256 = ? WHERE id = ?", (sha256, file_id))


def delete_paper_file(file_id: str, paper_id: str | None = None) -> bool:
    conn = get_conn()
    with transaction():
        if paper_id is None:
            cur = conn.execute("DELETE FROM paper_files WHERE id = ?", (file_id,))
        else:
            cur = conn.execute(
                "DELETE FROM paper_files WHERE id = ? AND paper_id = ?", (file_id, paper_id)
            )
    return cur.rowcount > 0


def update_paper_file(file_id: str, page_start: int, page_count: int) -> None:
    conn = get_conn()
    with transaction():
        conn.execute(
            "UPDATE paper_files SET page_start = ?, page_count = ? WHERE id = ?",
            (page_start, page_count, file_id),
        )


# ---------------------------------------------------------------------------
# paper questions
# ---------------------------------------------------------------------------

def _pq_row_to_dict(row) -> dict:
    return {
        "id": row["qid"],
        "number": row["number"],
        "section": row["section"],
        "type": row["type"],
        "stem": row["stem"],
        "options": json.loads(row["options_json"]) if row["options_json"] else None,
        "passage": row["passage"],
        "correct_answer": row["correct_answer"],
        "knowledge_point": row["knowledge_point"],
        "edited": bool(row["edited"]) if "edited" in row.keys() else False,
        "manual_created": bool(row["manual_created"]),
        "content_edited": bool(row["content_edited"]),
        "needs_review": bool(row["needs_review"]),
    }


def replace_paper_questions(paper_id: str, questions: list[dict]) -> None:
    qids = [q["id"] for q in questions]
    if len(qids) != len(set(qids)):
        raise ValueError("试卷题目 occurrence ID 重复")
    conn = get_conn()
    with transaction():
        conn.execute("DELETE FROM paper_questions WHERE paper_id = ?", (paper_id,))
        conn.executemany(
            """INSERT INTO paper_questions (paper_id, qid, number, section, type, stem,
                   options_json, passage, correct_answer, knowledge_point, edited,
                   manual_created, content_edited, needs_review)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    paper_id, q["id"], q.get("number"), q.get("section"), q.get("type"),
                    q.get("stem"),
                    json.dumps(q["options"], ensure_ascii=False)
                    if q.get("options") is not None else None,
                    q.get("passage"), q.get("correct_answer"), q.get("knowledge_point"),
                    1 if q.get("edited") else 0, 1 if q.get("manual_created") else 0,
                    1 if q.get("content_edited") else 0, 1 if q.get("needs_review") else 0,
                )
                for q in questions
            ],
        )


def get_paper_questions(paper_id: str) -> list[dict]:
    rows = get_conn().execute(
        "SELECT * FROM paper_questions WHERE paper_id = ? ORDER BY id", (paper_id,)
    ).fetchall()
    return [_pq_row_to_dict(r) for r in rows]


def get_paper_question(paper_id: str, qid: str) -> dict | None:
    row = get_conn().execute(
        "SELECT * FROM paper_questions WHERE paper_id = ? AND qid = ?", (paper_id, qid)
    ).fetchone()
    return _pq_row_to_dict(row) if row else None


def add_paper_question(paper_id: str, number: str, correct_answer: str | None,
                       qtype: str | None, content: dict | None = None) -> dict | None:
    content = content or {}
    qid = "manual-" + uuid.uuid4().hex[:12]
    with transaction():
        get_conn().execute(
            """INSERT INTO paper_questions
               (paper_id, qid, number, section, type, stem, options_json, passage,
                correct_answer, knowledge_point, edited, manual_created, content_edited)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1)""",
            (paper_id, qid, number, content.get("section"), qtype, content.get("stem"),
             json.dumps(content["options"], ensure_ascii=False)
             if content.get("options") is not None else None,
             content.get("passage"), correct_answer, content.get("knowledge_point")),
        )
    return get_paper_question(paper_id, qid)


def delete_paper_question(paper_id: str, qid: str) -> bool:
    conn = get_conn()
    with transaction():
        row = conn.execute(
            "SELECT number FROM paper_questions WHERE paper_id = ? AND qid = ?", (paper_id, qid)
        ).fetchone()
        if not row:
            return False
        conn.execute(
            """INSERT INTO paper_question_tombstones (paper_id, qid, number, deleted_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(paper_id, qid) DO UPDATE SET deleted_at = excluded.deleted_at""",
            (paper_id, qid, row["number"], time.time()),
        )
        conn.execute("DELETE FROM paper_questions WHERE paper_id = ? AND qid = ?", (paper_id, qid))
    return True


def list_paper_question_tombstones(paper_id: str) -> list[dict]:
    rows = get_conn().execute(
        "SELECT qid, number FROM paper_question_tombstones WHERE paper_id = ?", (paper_id,)
    ).fetchall()
    return [dict(r) for r in rows]


def update_paper_question(paper_id: str, qid: str, **fields) -> None:
    if "options" in fields:
        options = fields.pop("options")
        fields["options_json"] = json.dumps(options, ensure_ascii=False) if options is not None else None
    allowed = {
        "number", "section", "type", "stem", "options_json", "passage",
        "correct_answer", "knowledge_point", "edited", "content_edited", "needs_review",
    }
    bad = set(fields) - allowed
    if bad:
        raise ValueError(f"未知 paper question 字段: {bad}")
    if not fields:
        return
    if "correct_answer" in fields:
        fields["edited"] = 1
    if set(fields) & {"number", "section", "type", "stem", "options_json", "passage", "knowledge_point"}:
        fields["content_edited"] = 1
    keys = list(fields)
    with transaction():
        get_conn().execute(
            f"UPDATE paper_questions SET {', '.join(k + ' = ?' for k in keys)} "
            "WHERE paper_id = ? AND qid = ?",
            [fields[k] for k in keys] + [paper_id, qid],
        )


def update_paper_question_answer(paper_id: str, qid: str, correct_answer: str | None) -> None:
    update_paper_question(paper_id, qid, correct_answer=correct_answer)


def list_submission_ids_for_paper(paper_id: str) -> list[str]:
    rows = get_conn().execute(
        "SELECT id FROM jobs WHERE paper_id = ?", (paper_id,)
    ).fetchall()
    return [r["id"] for r in rows]


# ---------------------------------------------------------------------------
# feedback
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# chat
# ---------------------------------------------------------------------------

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
