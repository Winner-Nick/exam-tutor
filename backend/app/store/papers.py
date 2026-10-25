from __future__ import annotations

import json
import sqlite3
import time
import uuid

from ..db import get_conn, normalize_number_key, read_snapshot, transaction
from .common import _reserve_processing_slot

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


def _bump_paper_revision(conn: sqlite3.Connection, paper_id: str) -> int:
    conn.execute("UPDATE papers SET revision = revision + 1 WHERE id = ?", (paper_id,))
    row = conn.execute("SELECT revision FROM papers WHERE id = ?", (paper_id,)).fetchone()
    if not row:
        raise ValueError("试卷不存在")
    return row[0]


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
        "revision": row["revision"],
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
    from . import get_conn
    sql = f"{_PAPER_SELECT} WHERE p.user_id = ?"
    params: list = [user_id]
    if ready_only:
        sql += """ AND p.status = 'ready' AND EXISTS
                   (SELECT 1 FROM paper_questions pq WHERE pq.paper_id = p.id)"""
    if q:
        sql += " AND (p.title LIKE ? OR p.subject LIKE ? OR p.grade LIKE ?)"
        params.extend([f"%{q}%"] * 3)
    with read_snapshot():
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


def delete_paper(paper_id: str) -> bool:
    with transaction():
        cur = get_conn().execute(
            "DELETE FROM papers WHERE id = ? AND status != 'processing'", (paper_id,),
        )
    return cur.rowcount > 0


def count_processing_papers(user_id: int) -> int:
    return get_conn().execute(
        "SELECT COUNT(*) FROM papers WHERE user_id = ? AND status = 'processing'",
        (user_id,),
    ).fetchone()[0]


def try_mark_paper_processing(paper_id: str, max_processing: int | None = None) -> bool:
    conn = get_conn()
    with transaction():
        row = conn.execute("SELECT status, user_id FROM papers WHERE id = ?", (paper_id,)).fetchone()
        if not row or row["status"] in ("processing", "deleting"):
            return False
        _reserve_processing_slot(conn, row["user_id"], max_processing)
        cur = conn.execute(
            """UPDATE papers SET status = 'processing', stage = 'queued',
                      progress_done = 0, progress_total = 1, progress_label = '排队中…',
                      error = NULL
               WHERE id = ? AND status NOT IN ('processing', 'deleting')""",
            (paper_id,),
        )
    return cur.rowcount > 0


def try_mark_job_processing(job_id: str, max_processing: int | None = None) -> bool:
    conn = get_conn()
    with transaction():
        row = conn.execute("SELECT status, user_id FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if not row or row["status"] in ("processing", "deleting"):
            return False
        _reserve_processing_slot(conn, row["user_id"], max_processing)
        cur = conn.execute(
            """UPDATE jobs SET status = 'processing', stage = 'queued',
                      progress_done = 0, progress_total = 1, progress_label = '排队中…',
                      error = NULL
               WHERE id = ? AND status NOT IN ('processing', 'deleting')""",
            (job_id,),
        )
    return cur.rowcount > 0


def try_mark_paper_deleting(paper_id: str) -> bool:
    with transaction():
        cur = get_conn().execute(
            "UPDATE papers SET status = 'deleting' WHERE id = ? AND status != 'deleting'",
            (paper_id,),
        )
    return cur.rowcount > 0


def try_mark_job_deleting(job_id: str) -> bool:
    with transaction():
        cur = get_conn().execute(
            "UPDATE jobs SET status = 'deleting' WHERE id = ? AND status != 'deleting'",
            (job_id,),
        )
    return cur.rowcount > 0


def list_processing_paper_ids() -> list[str]:
    rows = get_conn().execute("SELECT id FROM papers WHERE status = 'processing'").fetchall()
    return [r["id"] for r in rows]


def list_deleting_paper_ids() -> list[str]:
    rows = get_conn().execute("SELECT id FROM papers WHERE status = 'deleting'").fetchall()
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
    source = json.loads(row["source_json"]) if row["source_json"] else {}
    occurrences = source.get("occurrences") or []
    return {
        "id": row["qid"],
        "number": row["number"],
        "number_key": row["number_key"] if "number_key" in row.keys() else None,
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
        "source_key": row["source_key"],
        "source_occurrence": source.get("occurrence") or (occurrences[0] if occurrences else None),
        "source_occurrences": occurrences,
        "aliases": json.loads(row["alias_json"]) if row["alias_json"] else [],
    }


def _paper_question_parts(q: dict, number_key: str | None) -> tuple:
    occurrence = q.get("source_occurrence")
    occurrences = q.get("source_occurrences")
    if occurrences is None:
        occurrences = [occurrence] if occurrence else []
    source_json = json.dumps({"occurrences": occurrences}, ensure_ascii=False)
    aliases = sorted({str(alias) for alias in (q.get("aliases") or []) if alias})
    return (
        q["id"], q.get("number"), number_key, q.get("section"), q.get("type"), q.get("stem"),
        json.dumps(q["options"], ensure_ascii=False) if q.get("options") is not None else None,
        q.get("passage"), q.get("correct_answer"), q.get("knowledge_point"),
        1 if q.get("edited") else 0, 1 if q.get("manual_created") else 0,
        1 if q.get("content_edited") else 0, 1 if q.get("needs_review") else 0,
        q.get("source_key"), source_json, json.dumps(aliases, ensure_ascii=False),
    )


def _replacement_number_keys(questions: list[dict]) -> list[str | None]:
    counts: dict[str, int] = {}
    for q in questions:
        number = ("" if q.get("number") is None else str(q.get("number"))).strip()
        q["number"] = number or None
        key = normalize_number_key(number)
        q["_number_key"] = key
        counts[key] = counts.get(key, 0) + 1

    used: set[str] = set()
    result: list[str | None] = []
    for q in questions:
        key = q.pop("_number_key")
        if not key:
            q["needs_review"] = True
            result.append(None)
            continue
        if counts[key] > 1:
            q["correct_answer"] = None
            q["needs_review"] = True
        stored_key = key
        if stored_key in used:
            base = f"__examtutor_duplicate__:{q['id']}"
            stored_key = base
            serial = 2
            while stored_key in used or stored_key in counts:
                stored_key = f"{base}:{serial}"
                serial += 1
        used.add(stored_key)
        result.append(stored_key)
    return result


def replace_paper_questions(paper_id: str, questions: list[dict]) -> int:
    qids = [q["id"] for q in questions]
    if len(qids) != len(set(qids)):
        raise ValueError("试卷题目 occurrence ID 重复")
    number_keys = _replacement_number_keys(questions)
    parts = [
        _paper_question_parts(q, number_key)
        for q, number_key in zip(questions, number_keys, strict=True)
    ]
    conn = get_conn()
    with transaction():
        old_rows = conn.execute(
            """SELECT qid, number, number_key, section, type, stem, options_json, passage,
                      correct_answer, knowledge_point, edited, manual_created, content_edited,
                      needs_review, source_key, source_json, alias_json
               FROM paper_questions WHERE paper_id = ?""", (paper_id,),
        ).fetchall()
        old = {row["qid"]: tuple(row) for row in old_rows}
        changed = old != {part[0]: part for part in parts}
        conn.execute("DELETE FROM paper_questions WHERE paper_id = ?", (paper_id,))
        conn.executemany(
            """INSERT INTO paper_questions (paper_id, qid, number, number_key, section, type,
                   stem, options_json, passage, correct_answer, knowledge_point, edited,
                   manual_created, content_edited, needs_review, source_key, source_json, alias_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [(paper_id, *part) for part in parts],
        )
        if changed:
            return _bump_paper_revision(conn, paper_id)
        return conn.execute("SELECT revision FROM papers WHERE id = ?", (paper_id,)).fetchone()[0]


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


MAX_PAPER_QUESTIONS = 200


def add_paper_question(paper_id: str, number: str, correct_answer: str | None,
                       qtype: str | None, content: dict | None = None) -> dict:
    content = content or {}
    number = ("" if number is None else str(number)).strip()
    number_key = normalize_number_key(number)
    if not number_key:
        raise ValueError("题号不能为空")
    qid = "manual-" + uuid.uuid4().hex[:12]
    conn = get_conn()
    with transaction():
        if conn.execute(
            "SELECT COUNT(*) FROM paper_questions WHERE paper_id = ?", (paper_id,),
        ).fetchone()[0] >= MAX_PAPER_QUESTIONS:
            raise ValueError("题目数量已达上限")
        existing_numbers = conn.execute(
            "SELECT number FROM paper_questions WHERE paper_id = ?", (paper_id,),
        ).fetchall()
        if any(normalize_number_key(row["number"]) == number_key for row in existing_numbers):
            raise sqlite3.IntegrityError("duplicate question number")
        conn.execute(
            """INSERT INTO paper_questions
               (paper_id, qid, number, number_key, section, type, stem, options_json, passage,
                correct_answer, knowledge_point, edited, manual_created, content_edited,
                source_json, alias_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, ?, ?)""",
            (paper_id, qid, number, number_key, content.get("section"), qtype, content.get("stem"),
             json.dumps(content["options"], ensure_ascii=False)
             if content.get("options") is not None else None,
             content.get("passage"), correct_answer, content.get("knowledge_point"),
             '{"occurrences":[]}', json.dumps([qid])),
        )
        _bump_paper_revision(conn, paper_id)
    return get_paper_question(paper_id, qid)  # type: ignore[return-value]


def delete_paper_question(paper_id: str, qid: str) -> bool:
    conn = get_conn()
    with transaction():
        row = conn.execute(
            "SELECT number, source_key, alias_json FROM paper_questions "
            "WHERE paper_id = ? AND qid = ?", (paper_id, qid),
        ).fetchone()
        if not row:
            return False
        conn.execute(
            """INSERT INTO paper_question_tombstones
               (paper_id, qid, number, deleted_at, source_key, alias_json)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(paper_id, qid) DO UPDATE SET
                 deleted_at = excluded.deleted_at, number = excluded.number,
                 source_key = excluded.source_key, alias_json = excluded.alias_json""",
            (paper_id, qid, row["number"], time.time(), row["source_key"], row["alias_json"]),
        )
        conn.execute("DELETE FROM paper_questions WHERE paper_id = ? AND qid = ?", (paper_id, qid))
        _bump_paper_revision(conn, paper_id)
    return True


def list_paper_question_tombstones(paper_id: str, *, full: bool = False) -> list[dict]:
    if not full:
        rows = get_conn().execute(
            "SELECT qid, number FROM paper_question_tombstones WHERE paper_id = ?", (paper_id,)
        ).fetchall()
        return [dict(r) for r in rows]
    rows = get_conn().execute(
        "SELECT qid, number, source_key, alias_json FROM paper_question_tombstones "
        "WHERE paper_id = ?", (paper_id,),
    ).fetchall()
    return [{
        "qid": row["qid"], "number": row["number"], "source_key": row["source_key"],
        "aliases": json.loads(row["alias_json"]) if row["alias_json"] else [],
    } for row in rows]


def update_paper_question(paper_id: str, qid: str, *,
                          mark_content_edited: bool = True, **fields) -> None:
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
    number_key = None
    if "number" in fields:
        fields["number"] = ("" if fields["number"] is None else str(fields["number"])).strip()
        number_key = normalize_number_key(fields["number"])
        if not number_key:
            raise ValueError("题号不能为空")
        fields["number_key"] = number_key
    if "correct_answer" in fields:
        fields["edited"] = 1
    content_fields = {"number", "section", "type", "stem", "options_json", "passage", "knowledge_point"}
    if mark_content_edited and set(fields) & content_fields:
        fields["content_edited"] = 1
    keys = list(fields)
    conn = get_conn()
    with transaction():
        if number_key is not None:
            existing_numbers = conn.execute(
                "SELECT number FROM paper_questions WHERE paper_id = ? AND qid != ?",
                (paper_id, qid),
            ).fetchall()
            if any(normalize_number_key(row["number"]) == number_key for row in existing_numbers):
                raise sqlite3.IntegrityError("duplicate question number")
        row = conn.execute(
            "SELECT * FROM paper_questions WHERE paper_id = ? AND qid = ?", (paper_id, qid),
        ).fetchone()
        if not row:
            return
        if all(fields[key] == row[key] for key in keys):
            return
        conn.execute(
            f"UPDATE paper_questions SET {', '.join(k + ' = ?' for k in keys)} "
            "WHERE paper_id = ? AND qid = ?",
            [fields[k] for k in keys] + [paper_id, qid],
        )
        _bump_paper_revision(conn, paper_id)


def update_paper_knowledge_points(paper_id: str, items: dict[str, str | None], *,
                                  mark_content_edited: bool) -> int:
    updated = 0
    conn = get_conn()
    with transaction():
        for qid, value in items.items():
            row = conn.execute(
                "SELECT knowledge_point, content_edited FROM paper_questions "
                "WHERE paper_id = ? AND qid = ?", (paper_id, qid),
            ).fetchone()
            if not row:
                continue
            content_edited = 1 if mark_content_edited else row["content_edited"]
            if row["knowledge_point"] == value and row["content_edited"] == content_edited:
                continue
            conn.execute(
                "UPDATE paper_questions SET knowledge_point = ?, content_edited = ? "
                "WHERE paper_id = ? AND qid = ?",
                (value, content_edited, paper_id, qid),
            )
            updated += 1
        if updated:
            _bump_paper_revision(conn, paper_id)
    return updated


def update_paper_question_answer(paper_id: str, qid: str, correct_answer: str | None) -> None:
    update_paper_question(paper_id, qid, correct_answer=correct_answer)


def list_submission_ids_for_paper(paper_id: str) -> list[str]:
    rows = get_conn().execute(
        "SELECT id FROM jobs WHERE paper_id = ?", (paper_id,)
    ).fetchall()
    return [r["id"] for r in rows]
