"""SQLite 连接管理与 schema 迁移。

- 每线程一个连接（threading.local），WAL 模式支持读写并发，
  替代旧 store.py 的全局 RLock。
- 迁移用 PRAGMA user_version 顺序执行 MIGRATIONS 列表，新增表/列时
  在列表末尾追加函数即可。
"""
from __future__ import annotations

import sqlite3
import threading

from .config import DATA_DIR

DB_PATH = DATA_DIR / "app.db"

_local = threading.local()
_init_lock = threading.Lock()
_initialized = False


def _v1(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at REAL NOT NULL
        );

        CREATE TABLE invite_codes (
            code TEXT PRIMARY KEY,
            created_by INTEGER REFERENCES users(id),
            max_uses INTEGER NOT NULL DEFAULT 1,
            used_count INTEGER NOT NULL DEFAULT 0,
            expires_at REAL
        );

        CREATE TABLE jobs (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            filename TEXT,
            title TEXT,
            pdf_sha256 TEXT,
            status TEXT NOT NULL,
            stage TEXT,
            progress_done INTEGER NOT NULL DEFAULT 0,
            progress_total INTEGER NOT NULL DEFAULT 1,
            progress_label TEXT,
            error TEXT,
            page_count INTEGER,
            meta_json TEXT,
            stats_json TEXT,
            created_at REAL NOT NULL
        );
        CREATE INDEX idx_jobs_user ON jobs(user_id, created_at DESC);
        CREATE INDEX idx_jobs_sha ON jobs(pdf_sha256);

        CREATE TABLE questions (
            id INTEGER PRIMARY KEY,
            job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
            qid TEXT NOT NULL,
            number TEXT,
            section TEXT,
            type TEXT,
            stem TEXT,
            options_json TEXT,
            passage TEXT,
            student_answer TEXT,
            correct_answer TEXT,
            status TEXT NOT NULL,
            knowledge_point TEXT,
            explanation_json TEXT,
            explain_state TEXT NOT NULL DEFAULT 'none',
            UNIQUE(job_id, qid)
        );
        CREATE INDEX idx_q_job ON questions(job_id);
        CREATE INDEX idx_q_kp ON questions(knowledge_point);

        CREATE TABLE chat_messages (
            id INTEGER PRIMARY KEY,
            job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
            qid TEXT,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at REAL NOT NULL
        );
        CREATE INDEX idx_chat ON chat_messages(job_id, qid, id);
        """
    )


def _v2(conn: sqlite3.Connection) -> None:
    conn.execute("ALTER TABLE invite_codes ADD COLUMN created_at REAL")


def _v3(conn: sqlite3.Connection) -> None:
    """老师-学生-试卷模型：papers 持有题目与标准答案（识别一次复用），
    jobs 退化为一次"作答提交"（kind=submission），挂在 paper + student 下。"""
    conn.executescript(
        """
        CREATE TABLE students (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            name TEXT NOT NULL,
            is_self INTEGER NOT NULL DEFAULT 0,
            created_at REAL NOT NULL
        );
        CREATE INDEX idx_students_user ON students(user_id);

        CREATE TABLE papers (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            title TEXT,
            status TEXT NOT NULL,
            stage TEXT,
            progress_done INTEGER NOT NULL DEFAULT 0,
            progress_total INTEGER NOT NULL DEFAULT 1,
            progress_label TEXT,
            error TEXT,
            page_count INTEGER,
            meta_json TEXT,
            created_at REAL NOT NULL
        );
        CREATE INDEX idx_papers_user ON papers(user_id, created_at DESC);

        CREATE TABLE paper_files (
            id TEXT PRIMARY KEY,
            paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
            kind TEXT NOT NULL DEFAULT 'mixed',
            filename TEXT,
            sha256 TEXT,
            page_start INTEGER,
            page_count INTEGER,
            created_at REAL NOT NULL
        );
        CREATE INDEX idx_pfiles_paper ON paper_files(paper_id);

        CREATE TABLE paper_questions (
            id INTEGER PRIMARY KEY,
            paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
            qid TEXT NOT NULL,
            number TEXT,
            section TEXT,
            type TEXT,
            stem TEXT,
            options_json TEXT,
            passage TEXT,
            correct_answer TEXT,
            knowledge_point TEXT,
            UNIQUE(paper_id, qid)
        );
        CREATE INDEX idx_pq_paper ON paper_questions(paper_id);
        """
    )
    conn.execute("ALTER TABLE jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy'")
    conn.execute("ALTER TABLE jobs ADD COLUMN paper_id TEXT REFERENCES papers(id)")
    conn.execute("ALTER TABLE jobs ADD COLUMN student_id INTEGER REFERENCES students(id)")
    conn.execute("CREATE INDEX idx_jobs_paper ON jobs(paper_id)")
    conn.execute("CREATE INDEX idx_jobs_student ON jobs(student_id)")


MIGRATIONS = [_v1, _v2, _v3]


def init_db() -> None:
    global _initialized
    if _initialized:
        return
    with _init_lock:
        if _initialized:
            return
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB_PATH)
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            for i in range(version, len(MIGRATIONS)):
                with conn:
                    MIGRATIONS[i](conn)
                    conn.execute(f"PRAGMA user_version = {i + 1}")
        finally:
            conn.close()
        _initialized = True


def get_conn() -> sqlite3.Connection:
    """当前线程的连接（懒创建）。写操作请用 `with get_conn():` 包事务。"""
    conn = getattr(_local, "conn", None)
    if conn is None:
        init_db()
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return conn
