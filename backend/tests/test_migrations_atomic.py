from __future__ import annotations

import sqlite3

import pytest

from app import db


@pytest.fixture
def isolated_db(tmp_path):
    old_path = db.DB_PATH
    old_initialized = db._initialized
    old_conn = getattr(db._local, "conn", None)
    if old_conn is not None:
        old_conn.close()
        del db._local.conn
    db.DB_PATH = tmp_path / "migration.db"
    db._initialized = False
    try:
        yield db.DB_PATH
    finally:
        conn = getattr(db._local, "conn", None)
        if conn is not None:
            conn.close()
            del db._local.conn
        db.DB_PATH = old_path
        db._initialized = old_initialized


def _table_names(path) -> set[str]:
    conn = sqlite3.connect(path)
    try:
        return {row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()}
    finally:
        conn.close()


def _user_version(path) -> int:
    conn = sqlite3.connect(path)
    try:
        return conn.execute("PRAGMA user_version").fetchone()[0]
    finally:
        conn.close()


def _migrate_to_v9(path) -> None:
    conn = sqlite3.connect(path)
    conn.isolation_level = None
    try:
        for index in range(9):
            conn.execute("BEGIN IMMEDIATE")
            db.MIGRATIONS[index](conn)
            conn.execute(f"PRAGMA user_version = {index + 1}")
            conn.execute("COMMIT")
        conn.execute(
            "INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'old', 'hash', 1)"
        )
        conn.execute(
            "INSERT INTO papers (id, user_id, title, status, created_at) VALUES ('p', 1, 'old', 'ready', 1)"
        )
        conn.execute(
            "INSERT INTO jobs (id, user_id, status, created_at, kind, paper_id) "
            "VALUES ('j', 1, 'done', 1, 'submission', 'p')"
        )
        conn.execute(
            "INSERT INTO paper_questions (paper_id, qid, number, correct_answer) VALUES ('p', 'q1', '1', 'A')"
        )
        conn.execute(
            "INSERT INTO questions (job_id, qid, number, status) VALUES ('j', 'q1', '1', 'correct')"
        )
        question_pk = conn.execute("SELECT id FROM questions WHERE job_id = 'j' AND qid = 'q1'").fetchone()[0]
        conn.execute(
            "INSERT INTO review_attempts (question_pk, job_id, qid, action, created_at) "
            "VALUES (?, 'j', 'q1', 'attempt', 1)", (question_pk,)
        )
        conn.execute(
            "INSERT INTO chat_messages (job_id, qid, role, content, created_at) "
            "VALUES ('j', 'q1', 'user', 'old chat', 1)"
        )
        conn.execute(
            "INSERT INTO paper_question_tombstones (paper_id, qid, deleted_at) VALUES ('p', 'q2', 1)"
        )
    finally:
        conn.close()


def test_v1_failure_rolls_back_everything_and_retries(isolated_db, monkeypatch):
    path = isolated_db
    original = db._execute_script

    def fail_on_jobs(conn, script):
        if "CREATE TABLE jobs" in script:
            raise RuntimeError("injected v1 failure")
        return original(conn, script)

    monkeypatch.setattr(db, "_execute_script", fail_on_jobs)
    with pytest.raises(RuntimeError, match="injected v1 failure"):
        db.init_db()

    assert _user_version(path) == 0
    assert "users" not in _table_names(path)
    assert "invite_codes" not in _table_names(path)
    assert "jobs" not in _table_names(path)

    monkeypatch.setattr(db, "_execute_script", original)
    db.init_db()
    assert _user_version(path) == len(db.MIGRATIONS)
    assert "users" in _table_names(path)
    db.init_db()


def test_v10_through_v13_upgrade_preserves_data_and_is_repeatable(isolated_db):
    path = isolated_db
    _migrate_to_v9(path)

    db.init_db()

    assert _user_version(path) == 13
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    migrated = conn.execute("SELECT qid FROM paper_questions WHERE paper_id = 'p'").fetchone()[0]
    assert migrated.startswith("q_")
    assert conn.execute("SELECT qid FROM questions WHERE job_id = 'j'").fetchone()[0] == migrated
    assert conn.execute("SELECT qid FROM review_attempts WHERE job_id = 'j'").fetchone()[0] == migrated
    assert conn.execute("SELECT content FROM chat_messages WHERE job_id = 'j'").fetchone()[0] == "old chat"
    assert conn.execute("SELECT qid FROM paper_question_tombstones WHERE paper_id = 'p'").fetchone()[0] != "q2"
    assert {"task_runs", "idempotency_keys"} <= _table_names(path)
    indexes = {row[1] for row in conn.execute("PRAGMA index_list(review_attempts)")}
    assert "idx_review_attempts_job_qid" in indexes

    for migration in (db._v10, db._v11, db._v12, db._v13):
        migration(conn)
    assert conn.execute("SELECT qid FROM paper_questions WHERE paper_id = 'p'").fetchone()[0] == migrated
    assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
    conn.close()
