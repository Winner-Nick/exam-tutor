"""SQLite 连接管理与 schema 迁移。

- 每线程一个连接（threading.local），WAL 模式支持读写并发，
  替代旧 store.py 的全局 RLock。
- 迁移用 PRAGMA user_version 顺序执行 MIGRATIONS 列表，新增表/列时
  在列表末尾追加函数即可。
"""
from __future__ import annotations

import json
import sqlite3
import threading
import unicodedata
import uuid

from .config import DATA_DIR

DB_PATH = DATA_DIR / "app.db"


def normalize_number_key(value) -> str:
    return unicodedata.normalize(
        "NFKC", "" if value is None else str(value),
    ).strip().casefold()


_local = threading.local()
_init_lock = threading.Lock()
_initialized = False


def _v1(conn: sqlite3.Connection) -> None:
    _execute_script(conn,
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
    _add_column_if_missing(conn, "invite_codes", "created_at", "REAL")


def _add_column_if_missing(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    """幂等加列：迁移中途崩溃后重跑不会因 duplicate column 报错。"""
    cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def _execute_script(conn: sqlite3.Connection, script: str) -> None:
    """逐条执行 SQL，避免 executescript 在事务中隐式提交。"""
    buffer = ""
    for char in script:
        buffer += char
        if sqlite3.complete_statement(buffer):
            statement = buffer.strip()
            if statement:
                conn.execute(statement)
            buffer = ""
    if buffer.strip():
        if not sqlite3.complete_statement(buffer):
            raise sqlite3.OperationalError("incomplete SQL statement")
        conn.execute(buffer)


def _v3(conn: sqlite3.Connection) -> None:
    """老师-学生-试卷模型：papers 持有题目与标准答案（识别一次复用），
    jobs 退化为一次"作答提交"（kind=submission），挂在 paper + student 下。"""
    _execute_script(conn,
        """
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            name TEXT NOT NULL,
            is_self INTEGER NOT NULL DEFAULT 0,
            created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_students_user ON students(user_id);

        CREATE TABLE IF NOT EXISTS papers (
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
        CREATE INDEX IF NOT EXISTS idx_papers_user ON papers(user_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS paper_files (
            id TEXT PRIMARY KEY,
            paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
            kind TEXT NOT NULL DEFAULT 'mixed',
            filename TEXT,
            sha256 TEXT,
            page_start INTEGER,
            page_count INTEGER,
            created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pfiles_paper ON paper_files(paper_id);

        CREATE TABLE IF NOT EXISTS paper_questions (
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
        CREATE INDEX IF NOT EXISTS idx_pq_paper ON paper_questions(paper_id);
        """
    )
    _add_column_if_missing(conn, "jobs", "kind", "TEXT NOT NULL DEFAULT 'legacy'")
    _add_column_if_missing(conn, "jobs", "paper_id", "TEXT REFERENCES papers(id)")
    _add_column_if_missing(conn, "jobs", "student_id", "INTEGER REFERENCES students(id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_paper ON jobs(paper_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_student ON jobs(student_id)")


def _v4(conn: sqlite3.Connection) -> None:
    """questions.overridden：老师人工修正过的答案/判定，补拍重跑时不被覆盖。"""
    _add_column_if_missing(conn, "questions", "overridden", "INTEGER NOT NULL DEFAULT 0")


def _v5(conn: sqlite3.Connection) -> None:
    """用户反馈：自动附带客户端诊断信息（设备/内核/报错），管理员可查看。"""
    _execute_script(conn,
        """
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            message TEXT,
            page TEXT,
            diag_json TEXT,
            created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_feedback_at ON feedback(created_at DESC);
        """
    )


def _v6(conn: sqlite3.Connection) -> None:
    """paper_questions.edited：老师手工录入/核对过的答案，重新识别时不被覆盖。"""
    _add_column_if_missing(conn, "paper_questions", "edited", "INTEGER NOT NULL DEFAULT 0")


def _v7(conn: sqlite3.Connection) -> None:
    """students 每用户至多一条"我自己"：防并发首访产生重复记录。"""
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_students_self "
        "ON students(user_id) WHERE is_self = 1"
    )


def _v8(conn: sqlite3.Connection) -> None:
    """学生登录账号：users 可挂载到所属老师（teacher_id）与学生档案（student_id）。

    role='student' 的账号由老师创建；其产生的批改记录仍归老师账号所有
    （jobs.user_id = 老师），学生端按 student_id 过滤只见自己的。"""
    _add_column_if_missing(conn, "users", "teacher_id", "INTEGER REFERENCES users(id)")
    _add_column_if_missing(conn, "users", "student_id", "INTEGER REFERENCES students(id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_users_teacher ON users(teacher_id)")
    # 一个学生档案至多绑一个登录账号
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_student "
        "ON users(student_id) WHERE student_id IS NOT NULL"
    )


def _v9(conn: sqlite3.Connection) -> None:
    """会话版本、通用试卷上下文、内容版本、人工编辑保护与错题复习。"""
    _add_column_if_missing(conn, "users", "session_version", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "papers", "subject", "TEXT")
    _add_column_if_missing(conn, "papers", "grade", "TEXT")
    _add_column_if_missing(conn, "students", "grade", "TEXT")

    _add_column_if_missing(conn, "questions", "revision", "INTEGER NOT NULL DEFAULT 1")
    _add_column_if_missing(conn, "questions", "explanation_revision", "INTEGER")
    _add_column_if_missing(conn, "questions", "needs_review", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "questions", "review_status", "TEXT NOT NULL DEFAULT 'open'")
    _add_column_if_missing(conn, "questions", "review_count", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "questions", "review_streak", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "questions", "last_reviewed_at", "REAL")
    _add_column_if_missing(conn, "questions", "next_review_at", "REAL")
    _add_column_if_missing(conn, "questions", "mastered_at", "REAL")
    conn.execute(
        "UPDATE questions SET explanation_revision = revision "
        "WHERE explanation_json IS NOT NULL AND explanation_revision IS NULL"
    )

    _add_column_if_missing(conn, "paper_questions", "manual_created", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "paper_questions", "content_edited", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "paper_questions", "needs_review", "INTEGER NOT NULL DEFAULT 0")
    _execute_script(conn,
        """
        CREATE TABLE IF NOT EXISTS paper_question_tombstones (
            paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
            qid TEXT NOT NULL,
            number TEXT,
            deleted_at REAL NOT NULL,
            PRIMARY KEY (paper_id, qid)
        );

        CREATE TABLE IF NOT EXISTS review_attempts (
            id INTEGER PRIMARY KEY,
            question_pk INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
            job_id TEXT NOT NULL,
            qid TEXT NOT NULL,
            action TEXT NOT NULL,
            answer TEXT,
            result TEXT,
            interval_days INTEGER,
            next_review_at REAL,
            created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_review_attempts_question
            ON review_attempts(question_pk, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_questions_review
            ON questions(review_status, next_review_at);
        """
    )


def _v10(conn: sqlite3.Connection) -> None:
    """规范化试卷题号并加唯一索引；历史重号全部保留且转为人工核对。"""
    _add_column_if_missing(conn, "paper_questions", "number_key", "TEXT")
    conn.execute("DROP INDEX IF EXISTS idx_paper_questions_number_key")
    rows = conn.execute(
        "SELECT id, paper_id, number FROM paper_questions ORDER BY paper_id, id"
    ).fetchall()
    groups: dict[tuple[str, str], list[int]] = {}
    paper_keys: dict[str, set[str]] = {}
    for row_id, paper_id, number in rows:
        key = normalize_number_key(number)
        if key:
            groups.setdefault((paper_id, key), []).append(row_id)
            paper_keys.setdefault(paper_id, set()).add(key)
    for (paper_id, key), row_ids in groups.items():
        if len(row_ids) > 1:
            conn.execute(
                f"UPDATE paper_questions SET needs_review = 1, correct_answer = NULL "
                f"WHERE paper_id = ? AND id IN ({','.join('?' for _ in row_ids)})",
                [paper_id, *row_ids],
            )

    used: set[tuple[str, str]] = set()
    for row_id, paper_id, number in rows:
        key = normalize_number_key(number)
        if not key:
            conn.execute(
                "UPDATE paper_questions SET number_key = NULL, needs_review = 1, "
                "correct_answer = NULL WHERE id = ?",
                (row_id,),
            )
            continue
        stored_key = key
        if (paper_id, stored_key) in used:
            base = f"__examtutor_duplicate__:{row_id}"
            stored_key = base
            serial = 2
            while ((paper_id, stored_key) in used
                   or stored_key in paper_keys.get(paper_id, set())):
                stored_key = f"{base}:{serial}"
                serial += 1
        conn.execute(
            "UPDATE paper_questions SET number_key = ? WHERE id = ?",
            (stored_key, row_id),
        )
        used.add((paper_id, stored_key))
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_questions_number_key "
        "ON paper_questions(paper_id, number_key)"
    )


def _v11(conn: sqlite3.Connection) -> None:
    """paper 来源身份与结构版本；关联数据随旧 qid 映射原子迁移。"""
    _add_column_if_missing(conn, "papers", "revision", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "jobs", "paper_revision", "INTEGER")
    _add_column_if_missing(conn, "jobs", "applied_paper_revision", "INTEGER")
    for column in ("source_key", "source_json", "alias_json"):
        _add_column_if_missing(conn, "paper_questions", column, "TEXT")
    for column in ("source_key", "alias_json"):
        _add_column_if_missing(conn, "paper_question_tombstones", column, "TEXT")
    conn.execute("DROP INDEX IF EXISTS idx_paper_questions_source_key")
    conn.execute("UPDATE papers SET revision = 1 WHERE revision = 0")

    paper_ids = [row[0] for row in conn.execute("SELECT id FROM papers").fetchall()]
    for paper_id in paper_ids:
        current = conn.execute(
            "SELECT qid, number, manual_created, source_json, alias_json "
            "FROM paper_questions WHERE paper_id = ? ORDER BY id", (paper_id,),
        ).fetchall()
        tombstones = conn.execute(
            "SELECT qid, number, alias_json FROM paper_question_tombstones WHERE paper_id = ?",
            (paper_id,),
        ).fetchall()
        mapping: dict[str, str] = {}
        for qid, _number, manual_created, _source, _aliases in current:
            mapping[qid] = (
                qid if manual_created or qid.startswith("q_") else "q_" + uuid.uuid4().hex
            )
        for qid, _number, _aliases in tombstones:
            if qid not in mapping:
                mapping[qid] = qid if qid.startswith(("manual-", "q_")) else "q_" + uuid.uuid4().hex

        for qid, number, _manual, source_json, alias_json in current:
            old_qid = qid
            aliases = set(json.loads(alias_json) if alias_json else [])
            aliases.update((old_qid, mapping[old_qid]))
            source = source_json or json.dumps(
                {"occurrences": [], "legacy": {"qid": old_qid, "number": number}},
                ensure_ascii=False,
            )
            conn.execute(
                "UPDATE paper_questions SET qid = ?, source_json = ?, alias_json = ? "
                "WHERE paper_id = ? AND qid = ?",
                (mapping[old_qid], source,
                 json.dumps(sorted(aliases), ensure_ascii=False), paper_id, old_qid),
            )
        for qid, _number, alias_json in tombstones:
            aliases = set(json.loads(alias_json) if alias_json else [])
            aliases.update((qid, mapping[qid]))
            conn.execute(
                "UPDATE paper_question_tombstones SET qid = ?, alias_json = ? "
                "WHERE paper_id = ? AND qid = ?",
                (mapping[qid], json.dumps(sorted(aliases), ensure_ascii=False), paper_id, qid),
            )

        for old_qid, new_qid in mapping.items():
            if old_qid == new_qid:
                continue
            submission_ids = (
                "SELECT id FROM jobs WHERE paper_id = ? AND kind = 'submission'"
            )
            conn.execute(
                f"UPDATE questions SET qid = ? WHERE qid = ? AND job_id IN ({submission_ids})",
                (new_qid, old_qid, paper_id),
            )
            conn.execute(
                f"UPDATE review_attempts SET qid = ? WHERE qid = ? AND job_id IN ({submission_ids})",
                (new_qid, old_qid, paper_id),
            )
            conn.execute(
                f"UPDATE chat_messages SET qid = ? WHERE qid = ? AND job_id IN ({submission_ids})",
                (new_qid, old_qid, paper_id),
            )

    conn.execute(
        """UPDATE jobs SET
             paper_revision = COALESCE(paper_revision,
               (SELECT revision FROM papers WHERE papers.id = jobs.paper_id)),
             applied_paper_revision = COALESCE(applied_paper_revision,
               (SELECT revision FROM papers WHERE papers.id = jobs.paper_id))
           WHERE kind = 'submission' AND paper_id IS NOT NULL"""
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_questions_source_key "
        "ON paper_questions(paper_id, source_key) WHERE source_key IS NOT NULL"
    )


def _v12(conn: sqlite3.Connection) -> None:
    """持久任务运行、资源活动互斥与创建幂等预留。"""
    _execute_script(conn,
        """
        CREATE TABLE IF NOT EXISTS task_runs (
            id TEXT PRIMARY KEY,
            resource_type TEXT NOT NULL,
            resource_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            owner_id INTEGER NOT NULL REFERENCES users(id),
            status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'waiting', 'done', 'error')),
            generation INTEGER NOT NULL,
            attempt INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 5,
            options_json TEXT NOT NULL DEFAULT '{}',
            available_at REAL NOT NULL,
            heartbeat_at REAL,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL,
            started_at REAL,
            finished_at REAL,
            last_error TEXT,
            UNIQUE(resource_type, resource_id, generation)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_task_runs_active_resource
            ON task_runs(resource_type, resource_id)
            WHERE status IN ('queued', 'running', 'waiting');
        CREATE INDEX IF NOT EXISTS idx_task_runs_available
            ON task_runs(status, available_at);
        CREATE INDEX IF NOT EXISTS idx_task_runs_owner
            ON task_runs(owner_id, status);

        CREATE TABLE IF NOT EXISTS idempotency_keys (
            owner_id INTEGER NOT NULL REFERENCES users(id),
            operation TEXT NOT NULL,
            key TEXT NOT NULL,
            resource_type TEXT NOT NULL,
            resource_id TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL,
            PRIMARY KEY(owner_id, operation, key)
        );
        CREATE INDEX IF NOT EXISTS idx_idempotency_resource
            ON idempotency_keys(resource_type, resource_id);
        """
    )


def _v13(conn: sqlite3.Connection) -> None:
    """复习记录按提交与题目查询的覆盖索引。"""
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_review_attempts_job_qid "
        "ON review_attempts(job_id, qid)"
    )


MIGRATIONS = [_v1, _v2, _v3, _v4, _v5, _v6, _v7, _v8, _v9, _v10, _v11, _v12, _v13]


def init_db() -> None:
    global _initialized
    if _initialized:
        return
    with _init_lock:
        if _initialized:
            return
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB_PATH)
        conn.isolation_level = None
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            for i in range(version, len(MIGRATIONS)):
                conn.execute("BEGIN IMMEDIATE")
                try:
                    MIGRATIONS[i](conn)
                    conn.execute(f"PRAGMA user_version = {i + 1}")
                    conn.execute("COMMIT")
                except Exception:
                    if conn.in_transaction:
                        conn.execute("ROLLBACK")
                    raise
        finally:
            conn.close()
        _initialized = True


def get_conn() -> sqlite3.Connection:
    """当前线程的连接（懒创建）。写操作使用 transaction()。"""
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


def transaction():
    """可嵌套写事务；最外层立即取得写锁，内层使用 SAVEPOINT。"""
    from contextlib import contextmanager

    @contextmanager
    def scoped():
        conn = get_conn()
        depth = getattr(_local, "tx_depth", 0)
        outer = depth == 0 and not conn.in_transaction
        savepoint = f"et_{depth}_{getattr(_local, 'tx_seq', 0)}"
        _local.tx_seq = getattr(_local, "tx_seq", 0) + 1
        _local.tx_depth = depth + 1
        try:
            if outer:
                conn.execute("BEGIN IMMEDIATE")
            else:
                conn.execute(f"SAVEPOINT {savepoint}")
            try:
                yield conn
            except Exception:
                if outer:
                    conn.rollback()
                else:
                    conn.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
                    conn.execute(f"RELEASE SAVEPOINT {savepoint}")
                raise
            else:
                if outer:
                    conn.commit()
                else:
                    conn.execute(f"RELEASE SAVEPOINT {savepoint}")
        finally:
            _local.tx_depth = depth

    return scoped()


def read_snapshot():
    """只读快照；嵌套在写事务中时不另起事务。"""
    from contextlib import contextmanager

    @contextmanager
    def scoped():
        conn = get_conn()
        if conn.in_transaction:
            yield conn
            return
        conn.execute("BEGIN")
        try:
            yield conn
        except Exception:
            conn.rollback()
            raise
        else:
            conn.commit()

    return scoped()
