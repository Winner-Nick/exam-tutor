from __future__ import annotations

import json
import sqlite3
import time

from ..config import JOBS_DIR
from ..db import get_conn, read_snapshot, transaction
from .common import _reserve_processing_slot

_JOB_FIELDS = {
    "filename", "title", "pdf_sha256", "status", "stage", "progress_done",
    "progress_total", "progress_label", "error", "page_count", "meta_json",
    "stats_json", "paper_revision", "applied_paper_revision",
}
def create_job(job_id: str, user_id: int, filename: str | None,
               pdf_sha256: str | None = None, created_at: float | None = None,
               kind: str = "legacy", paper_id: str | None = None,
               student_id: int | None = None,
               max_processing: int | None = None) -> None:
    conn = get_conn()
    with transaction():
        _reserve_processing_slot(conn, user_id, max_processing)
        paper_revision = None
        if kind == "submission" and paper_id is not None:
            row = conn.execute("SELECT revision FROM papers WHERE id = ?", (paper_id,)).fetchone()
            paper_revision = row[0] if row else None
        conn.execute(
            """INSERT INTO jobs (id, user_id, filename, pdf_sha256, status, stage,
                                 progress_done, progress_total, progress_label, created_at,
                                 kind, paper_id, student_id, paper_revision)
               VALUES (?, ?, ?, ?, 'processing', 'queued', 0, 1, '排队中…', ?, ?, ?, ?, ?)""",
            (job_id, user_id, filename, pdf_sha256, created_at or time.time(),
             kind, paper_id, student_id, paper_revision),
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
        "title": row["title"],
        "pdf_sha256": row["pdf_sha256"],
        "kind": row["kind"],
        "paper_id": row["paper_id"],
        "paper_revision": row["paper_revision"],
        "applied_paper_revision": row["applied_paper_revision"],
        "student_id": row["student_id"],
        "student_name": row["student_name"] if "student_name" in keys else None,
        "paper_title": row["paper_title"] if "paper_title" in keys else None,
        "subject": row["paper_subject"] if "paper_subject" in keys else None,
        "grade": row["paper_grade"] if "paper_grade" in keys else None,
        "sync_pending": bool(
            row["paper_id"] and (
                row["applied_paper_revision"] is None
                or row["applied_paper_revision"] < (row["paper_current_revision"] or 0)
                or row["reconcile_pending"]
            )
        ),
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
                        p.subject AS paper_subject, p.grade AS paper_grade,
                        p.revision AS paper_current_revision,
                        EXISTS(
                          SELECT 1 FROM task_runs tr
                          WHERE tr.resource_type = 'paper' AND tr.resource_id = j.paper_id
                            AND tr.operation = 'reconcile'
                            AND tr.status IN ('queued', 'running', 'waiting')
                        ) AS reconcile_pending
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
    from .questions import get_questions
    job["questions"] = get_questions(job_id)
    return job


def list_jobs_page(user_id: int, student_id: int | None = None,
                   paper_id: str | None = None, q: str | None = None,
                   limit: int | None = None, offset: int = 0) -> tuple[list[dict], int]:
    from . import get_conn
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
    with read_snapshot():
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


def delete_job(job_id: str) -> bool:
    with transaction():
        cur = get_conn().execute(
            "DELETE FROM jobs WHERE id = ? AND status != 'processing'", (job_id,),
        )
    return cur.rowcount > 0
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


def list_deleting_job_ids() -> list[str]:
    rows = get_conn().execute("SELECT id FROM jobs WHERE status = 'deleting'").fetchall()
    return [r["id"] for r in rows]
