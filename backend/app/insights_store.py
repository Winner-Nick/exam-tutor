"""错题与学习统计的 SQL 查询。"""
from __future__ import annotations

import json
from datetime import datetime

from .db import get_conn

MAX_DAYS = 3650
REVIEW_ATTEMPTS_PER_QUESTION = 20
_ATTEMPT_BATCH_SIZE = 500
_STAT_KEYS = ("total", "correct", "wrong", "unknown", "subjective")
_ATTEMPT_FIELDS = (
    "action", "answer", "result", "interval_days", "next_review_at", "created_at",
)
_STRIPPED_KP_SQL = (
    "TRIM(q.knowledge_point, char(9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 133, 160, "
    "5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, "
    "8203, 8232, 8233, 8239, 8287, 12288))"
)


def cutoff_for_days(days: int | None, now: float) -> float | None:
    if not days:
        return None
    return now - min(days, MAX_DAYS) * 86400


def _scope(owner_id: int, student_id: int | None, cutoff: float | None) -> tuple[str, list]:
    where = "j.user_id = ? AND j.status = 'done'"
    params: list = [owner_id]
    if student_id is not None:
        where += " AND j.student_id = ?"
        params.append(student_id)
    if cutoff is not None:
        where += " AND j.created_at >= ?"
        params.append(cutoff)
    return where, params


def list_mistake_rows(
    owner_id: int, student_id: int | None, paper_id: str | None,
    review: str, keyword: str | None, cutoff: float | None, now: float,
    limit: int, offset: int,
):
    where, params = _scope(owner_id, student_id, cutoff)
    where += " AND q.status = 'wrong'"
    if paper_id:
        where += " AND j.paper_id = ?"
        params.append(paper_id)
    if review in ("pending", "open"):
        where += " AND q.review_status != 'mastered'"
    elif review == "mastered":
        where += " AND q.review_status = 'mastered'"
    elif review == "due":
        where += (" AND q.review_status != 'mastered' AND q.next_review_at IS NOT NULL"
                  " AND q.next_review_at <= ?")
        params.append(now)
    if keyword and keyword.strip():
        where += (" AND (q.stem LIKE ? OR q.student_answer LIKE ? OR q.correct_answer LIKE ?"
                  " OR q.knowledge_point LIKE ? OR q.number LIKE ?)")
        params.extend([f"%{keyword.strip()}%"] * 5)

    conn = get_conn()
    from_clause = " FROM questions q JOIN jobs j ON j.id = q.job_id WHERE " + where
    total = conn.execute("SELECT COUNT(*)" + from_clause, params).fetchone()[0]
    sql = """SELECT q.*, j.id AS jid, j.paper_id AS job_paper_id,
                    j.student_id AS job_student_id, j.created_at AS job_created_at,
                    COALESCE(p.title, j.title, j.filename, '试卷') AS job_title,
                    s.name AS student_name
             FROM questions q JOIN jobs j ON j.id = q.job_id
             LEFT JOIN students s ON s.id = j.student_id
             LEFT JOIN papers p ON p.id = j.paper_id
             WHERE """ + where + " ORDER BY j.created_at DESC, q.id"
    page_params = list(params)
    if limit > 0:
        sql += " LIMIT ? OFFSET ?"
        page_params.extend([limit, offset])
    rows = conn.execute(sql, page_params).fetchall()
    return rows, total


def list_review_attempts_for_questions(question_pks: list[int]) -> dict[int, list[dict]]:
    attempts = {question_pk: [] for question_pk in question_pks}
    conn = get_conn()
    for start in range(0, len(question_pks), _ATTEMPT_BATCH_SIZE):
        batch = question_pks[start:start + _ATTEMPT_BATCH_SIZE]
        marks = ",".join("?" for _ in batch)
        rows = conn.execute(
            f"""WITH ranked AS (
                    SELECT question_pk, action, answer, result, interval_days,
                           next_review_at, created_at,
                           ROW_NUMBER() OVER (
                               PARTITION BY question_pk ORDER BY created_at DESC, id DESC
                           ) AS attempt_rank
                    FROM review_attempts WHERE question_pk IN ({marks})
                )
                SELECT question_pk, action, answer, result, interval_days,
                       next_review_at, created_at
                FROM ranked WHERE attempt_rank <= ?
                ORDER BY question_pk, attempt_rank""",
            [*batch, REVIEW_ATTEMPTS_PER_QUESTION],
        ).fetchall()
        for row in rows:
            attempts[row["question_pk"]].append(
                {key: row[key] for key in _ATTEMPT_FIELDS}
            )
    return attempts


def _stat_expression(key: str) -> str:
    stats_json = "COALESCE(NULLIF(j.stats_json, ''), '{}')"
    return f"COALESCE(CAST(json_extract({stats_json}, '$.{key}') AS INTEGER), 0)"


def _job_stats_cte(where: str) -> str:
    columns = ",\n".join(
        f"                       {_stat_expression(key)} AS {key}" for key in _STAT_KEYS
    )
    return f"""WITH job_stats AS (
                   SELECT j.id, j.student_id, j.created_at,
{columns}
                   FROM jobs j WHERE {where}
               )"""


def _summary(where: str, params: list) -> dict:
    row = get_conn().execute(
        _job_stats_cte(where) + """
        SELECT COUNT(*) AS total_jobs,
               COALESCE(SUM(total), 0) AS total,
               COALESCE(SUM(correct), 0) AS correct,
               COALESCE(SUM(wrong), 0) AS wrong,
               COALESCE(SUM(unknown), 0) AS unknown,
               COALESCE(SUM(subjective), 0) AS subjective,
               COALESCE(SUM(CASE WHEN correct + wrong = 0 THEN 1 ELSE 0 END), 0)
                   AS no_objective_jobs
        FROM job_stats""",
        params,
    ).fetchone()
    return dict(row)


def _jobs(where: str, params: list, limit: int, offset: int) -> list[dict]:
    sql = f"""SELECT j.id, j.student_id, j.created_at, j.stats_json,
                     COALESCE(p.title, j.title, j.filename, '试卷') AS title,
                     s.name AS student_name
              FROM jobs j LEFT JOIN students s ON s.id = j.student_id
              LEFT JOIN papers p ON p.id = j.paper_id
              WHERE {where} ORDER BY j.created_at DESC, j.id DESC"""
    page_params = list(params)
    if limit > 0:
        sql += " LIMIT ? OFFSET ?"
        page_params.extend([limit, offset])
    rows = get_conn().execute(sql, page_params).fetchall()
    return [{
        "id": row["id"], "title": row["title"], "student_id": row["student_id"],
        "student_name": row["student_name"], "created_at": row["created_at"],
        "stats": json.loads(row["stats_json"]) if row["stats_json"] else {},
    } for row in rows]


def _knowledge_points(where: str, params: list) -> list[dict]:
    rows = get_conn().execute(
        f"""SELECT {_STRIPPED_KP_SQL} AS knowledge_point,
                   SUM(CASE WHEN q.status = 'wrong' THEN 1 ELSE 0 END) AS wrong,
                   COUNT(*) AS total
            FROM questions q JOIN jobs j ON j.id = q.job_id
            WHERE {where} AND q.knowledge_point IS NOT NULL
              AND {_STRIPPED_KP_SQL} != ''
            GROUP BY {_STRIPPED_KP_SQL}
            HAVING SUM(CASE WHEN q.status = 'wrong' THEN 1 ELSE 0 END) > 0
            ORDER BY wrong DESC, total DESC LIMIT 30""",
        params,
    ).fetchall()
    return [dict(row) for row in rows]


def _knowledge_coverage(where: str, params: list) -> dict:
    row = get_conn().execute(
        f"""SELECT COUNT(*) AS total,
                   COALESCE(SUM(CASE WHEN q.knowledge_point IS NOT NULL
                                     AND {_STRIPPED_KP_SQL} != ''
                                THEN 1 ELSE 0 END), 0) AS covered
            FROM questions q JOIN jobs j ON j.id = q.job_id WHERE {where}""",
        params,
    ).fetchone()
    covered, total = row["covered"], row["total"]
    return {
        "covered": covered, "tagged": covered, "total": total,
        "percent": round(covered / total * 100) if total else 0,
    }


def _student_summaries(where: str, params: list) -> list[dict]:
    rows = get_conn().execute(
        _job_stats_cte(where) + """,
        ranked AS (
            SELECT job_stats.*, s.name AS student_name,
                   ROW_NUMBER() OVER (
                       ORDER BY job_stats.created_at DESC, job_stats.id DESC
                   ) AS recency
            FROM job_stats LEFT JOIN students s ON s.id = job_stats.student_id
        )
        SELECT student_id, COALESCE(student_name, '未指定学生') AS student_name,
               COUNT(*) AS total_jobs,
               COALESCE(SUM(correct), 0) AS correct,
               COALESCE(SUM(wrong), 0) AS wrong,
               COALESCE(SUM(unknown), 0) AS unknown,
               COALESCE(SUM(subjective), 0) AS subjective,
               MIN(recency) AS first_seen
        FROM ranked WHERE student_id IS NOT NULL
        GROUP BY student_id, student_name
        ORDER BY wrong DESC, first_seen""",
        params,
    ).fetchall()
    keys = (
        "student_id", "student_name", "total_jobs", "correct", "wrong", "unknown",
        "subjective",
    )
    return [{key: row[key] for key in keys} for row in rows]


def _percent(correct: int, wrong: int) -> int:
    graded = correct + wrong
    return int(correct / graded * 100 + 0.5)


def _date_label(value: str) -> str:
    return f"{int(value[5:7])}/{int(value[8:10])}"


def _trend(where: str, params: list, personal: bool) -> list[dict]:
    if personal:
        rows = get_conn().execute(
            _job_stats_cte(where) + """
            SELECT id, created_at, correct, wrong FROM job_stats
            WHERE correct + wrong > 0 ORDER BY created_at DESC, id DESC LIMIT 30""",
            params,
        ).fetchall()
        points = []
        for row in reversed(rows):
            date = datetime.fromtimestamp(row["created_at"]).date().isoformat()
            points.append({
                "id": row["id"], "created_at": row["created_at"],
                "correct": row["correct"], "wrong": row["wrong"],
                "pct": _percent(row["correct"], row["wrong"]),
                "label": _date_label(date),
            })
        return points

    rows = get_conn().execute(
        _job_stats_cte(where) + """
        SELECT date(created_at, 'unixepoch', 'localtime') AS day,
               SUM(correct) AS correct, SUM(wrong) AS wrong,
               MAX(created_at) AS created_at
        FROM job_stats GROUP BY day
        HAVING SUM(correct) + SUM(wrong) > 0
        ORDER BY day DESC LIMIT 30""",
        params,
    ).fetchall()
    return [{
        "id": row["day"], "date": row["day"], "created_at": row["created_at"],
        "correct": row["correct"], "wrong": row["wrong"],
        "pct": _percent(row["correct"], row["wrong"]),
        "label": _date_label(row["day"]),
    } for row in reversed(rows)]


def get_overview(
    owner_id: int, student_id: int | None, cutoff: float | None,
    job_limit: int, job_offset: int,
) -> dict:
    job_offset = job_offset if job_limit > 0 else 0
    where, params = _scope(owner_id, student_id, cutoff)
    summary = _summary(where, params)
    return {
        "jobs": _jobs(where, params, job_limit, job_offset),
        "job_total": summary["total_jobs"],
        "job_limit": job_limit,
        "job_offset": job_offset,
        "knowledge_points": _knowledge_points(where, params),
        "summary": summary,
        "knowledge_coverage": _knowledge_coverage(where, params),
        "student_summaries": _student_summaries(where, params),
        "trend": _trend(where, params, student_id is not None),
    }
