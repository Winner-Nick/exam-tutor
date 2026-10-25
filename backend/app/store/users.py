from __future__ import annotations

import secrets
import sqlite3
import time

from ..db import get_conn, transaction

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
