from __future__ import annotations

import sqlite3
import time

from ..db import get_conn, transaction

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
