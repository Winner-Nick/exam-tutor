from __future__ import annotations

import json
import time
from datetime import datetime, timedelta

from app import auth, db, store
from app.routers import insights


def _question(qid: str, status: str = "wrong", knowledge_point: str | None = "代数") -> dict:
    return {
        "id": qid, "number": qid, "type": "single_choice", "stem": f"题干 {qid}",
        "student_answer": "B", "correct_answer": "A", "status": status,
        "knowledge_point": knowledge_point,
    }


def _job(
    owner_id: int, job_id: str, created_at: float, stats: dict,
    *, student_id: int | None = None, questions: list[dict] | None = None,
) -> None:
    store.create_job(
        job_id, owner_id, f"{job_id}.pdf", created_at=created_at,
        student_id=student_id,
    )
    store.update_job(job_id, status="done", stage="done", title=job_id, stats=stats)
    if questions:
        store.replace_questions(job_id, questions)


def _flat_groups(payload: dict) -> list[dict]:
    return [question for group in payload["groups"] for question in group["questions"]]


def _legacy_overview(owner_id: int, student_id: int | None, days: int) -> dict:
    conn = db.get_conn()
    where = "j.user_id = ? AND j.status = 'done'"
    params: list = [owner_id]
    if student_id is not None:
        where += " AND j.student_id = ?"
        params.append(student_id)
    if days and days > 0:
        where += " AND j.created_at >= ?"
        params.append(time.time() - min(days, 3650) * 86400)
    rows = conn.execute(
        f"""SELECT j.id, j.student_id, j.created_at, j.stats_json,
                   COALESCE(p.title, j.title, j.filename, '试卷') AS title,
                   s.name AS student_name
            FROM jobs j LEFT JOIN students s ON s.id = j.student_id
            LEFT JOIN papers p ON p.id = j.paper_id
            WHERE {where} ORDER BY j.created_at DESC, j.id DESC""",
        params,
    ).fetchall()
    jobs = []
    summary = {
        "total_jobs": len(rows), "total": 0, "correct": 0, "wrong": 0,
        "unknown": 0, "subjective": 0, "no_objective_jobs": 0,
    }
    students: dict[int, dict] = {}
    for row in rows:
        stats = json.loads(row["stats_json"]) if row["stats_json"] else {}
        jobs.append({
            "id": row["id"], "title": row["title"], "student_id": row["student_id"],
            "student_name": row["student_name"], "created_at": row["created_at"],
            "stats": stats,
        })
        for key in ("total", "correct", "wrong", "unknown", "subjective"):
            summary[key] += int(stats.get(key) or 0)
        if int(stats.get("correct") or 0) + int(stats.get("wrong") or 0) == 0:
            summary["no_objective_jobs"] += 1
        sid = row["student_id"]
        if sid is not None:
            current = students.setdefault(sid, {
                "student_id": sid, "student_name": row["student_name"] or "未指定学生",
                "total_jobs": 0, "correct": 0, "wrong": 0, "unknown": 0, "subjective": 0,
            })
            current["total_jobs"] += 1
            for key in ("correct", "wrong", "unknown", "subjective"):
                current[key] += int(stats.get(key) or 0)

    question_rows = conn.execute(
        f"""SELECT q.knowledge_point, q.status
            FROM questions q JOIN jobs j ON j.id = q.job_id WHERE {where}""",
        params,
    ).fetchall()
    tagged: dict[str, dict] = {}
    for row in question_rows:
        knowledge_point = (row["knowledge_point"] or "").strip()
        if not knowledge_point:
            continue
        current = tagged.setdefault(
            knowledge_point, {"knowledge_point": knowledge_point, "wrong": 0, "total": 0},
        )
        current["total"] += 1
        if row["status"] == "wrong":
            current["wrong"] += 1
    covered = sum(item["total"] for item in tagged.values())
    total_questions = len(question_rows)
    knowledge_points = sorted(
        (item for item in tagged.values() if item["wrong"] > 0),
        key=lambda item: (item["wrong"], item["total"]), reverse=True,
    )[:30]
    return {
        "jobs": jobs,
        "knowledge_points": knowledge_points,
        "summary": summary,
        "knowledge_coverage": {
            "covered": covered, "tagged": covered, "total": total_questions,
            "percent": round(covered / total_questions * 100) if total_questions else 0,
        },
        "student_summaries": sorted(
            students.values(), key=lambda item: item["wrong"], reverse=True,
        ),
    }


def test_mistakes_pagination_and_batched_attempts(admin_client):
    owner_id = admin_client.get("/api/auth/me").json()["id"]
    now = time.time()
    _job(owner_id, "mistake-a", now - 10, {"total": 3, "wrong": 3}, questions=[
        _question("a1"), _question("a2"), _question("a3"),
    ])
    _job(owner_id, "mistake-b", now - 20, {"total": 2, "wrong": 2}, questions=[
        _question("b1"), _question("b2"),
    ])

    conn = db.get_conn()
    question_rows = conn.execute(
        "SELECT id, job_id, qid FROM questions ORDER BY id"
    ).fetchall()
    with db.transaction():
        for row in question_rows:
            conn.executemany(
                """INSERT INTO review_attempts
                   (question_pk, job_id, qid, action, answer, result, created_at)
                   VALUES (?, ?, ?, 'attempt', ?, 'correct', ?)""",
                [
                    (row["id"], row["job_id"], row["qid"], f"answer-{n}", float(n))
                    for n in range(25)
                ],
            )

    user = store.get_user(owner_id)
    statements: list[str] = []
    conn.set_trace_callback(statements.append)
    try:
        payload = insights.mistakes(
            student_id=None, paper_id=None, review="all", q=None, days=None,
            limit=2, offset=0, user=user,
        )
    finally:
        conn.set_trace_callback(None)

    queries = [statement for statement in statements if statement.lstrip().startswith(("SELECT", "WITH"))]
    attempt_queries = [statement for statement in queries if "review_attempts" in statement]
    assert len(queries) == 3
    assert len(attempt_queries) == 1
    normalized_attempt_sql = "".join(attempt_queries[0].split())
    assert "question_pkIN(" in normalized_attempt_sql
    assert "PARTITIONBYquestion_pk" in normalized_attempt_sql
    assert payload["total"] == 5
    assert payload["limit"] == 2
    assert payload["offset"] == 0
    questions = _flat_groups(payload)
    assert [question["id"] for question in questions] == ["a1", "a2"]
    for question in questions:
        attempts = question["review_attempts"]
        assert len(attempts) == 20
        assert attempts[0]["answer"] == "answer-24"
        assert attempts[-1]["answer"] == "answer-5"
        assert len({(item["created_at"], item["answer"]) for item in attempts}) == 20
        assert "attempts" not in question["review"]

    second_page = admin_client.get("/api/mistakes?limit=2&offset=2")
    assert second_page.status_code == 200, second_page.text
    second_payload = second_page.json()
    assert second_payload["total"] == 5
    second_questions = _flat_groups(second_payload)
    assert [question["id"] for question in second_questions] == ["a3", "b1"]
    assert {question["id"] for question in questions}.isdisjoint(
        question["id"] for question in second_questions
    )

    legacy = admin_client.get("/api/mistakes?limit=0&offset=4")
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["total"] == 5
    assert len(_flat_groups(legacy.json())) == 5
    assert legacy.json()["offset"] == 0


def test_overview_sql_aggregates_match_legacy_logic(admin_client):
    owner_id = admin_client.get("/api/auth/me").json()["id"]
    other_owner_id = store.create_user("other-overview-owner", "hash", role="admin")
    alice = store.create_student(owner_id, "甲")
    bob = store.create_student(owner_id, "乙")
    now = time.time()
    _job(
        owner_id, "overview-1", now - 10,
        {"total": 6, "correct": 3, "wrong": 2, "unknown": 1, "subjective": 0},
        student_id=alice["id"], questions=[
            _question("o11", "correct", " 代数 "), _question("o12", "correct", "代数"),
            _question("o13", "correct", "几何"), _question("o14", "wrong", "代数"),
            _question("o15", "wrong", "\t几何\n"), _question("o16", "unknown", " \t\n"),
        ],
    )
    _job(
        owner_id, "overview-2", now - 20,
        {"total": 4, "correct": 1, "wrong": 1, "unknown": 1, "subjective": 1},
        student_id=bob["id"], questions=[
            _question("o21", "correct", "几何"), _question("o22", "wrong", "几何"),
            _question("o23", "unknown"), _question("o24", "subjective"),
        ],
    )
    _job(
        owner_id, "overview-3", now - 30,
        {"total": 2, "correct": 0, "wrong": 0, "unknown": 1, "subjective": 1},
        student_id=alice["id"], questions=[
            _question("o31", "unknown", "代数"), _question("o32", "subjective", "应用题"),
        ],
    )
    _job(
        owner_id, "overview-4", now - 40,
        {"total": 1, "correct": 0, "wrong": 1}, questions=[_question("o41", "wrong", None)],
    )
    _job(
        other_owner_id, "overview-other", now,
        {"total": 20, "correct": 10, "wrong": 10}, questions=[_question("other", "wrong", "代数")],
    )
    store.create_job("overview-processing", owner_id, "processing.pdf", created_at=now)

    response = admin_client.get("/api/stats/overview?days=0")
    assert response.status_code == 200, response.text
    payload = response.json()
    expected = _legacy_overview(owner_id, None, 0)
    for key in ("jobs", "knowledge_points", "summary", "knowledge_coverage", "student_summaries"):
        assert payload[key] == expected[key], key
    assert payload["job_total"] == expected["summary"]["total_jobs"] == 4
    assert payload["job_limit"] == 0
    assert payload["job_offset"] == 0
    legacy = admin_client.get("/api/stats/overview?days=0&job_limit=0&job_offset=3")
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["jobs"] == expected["jobs"]
    assert legacy.json()["job_offset"] == 0

    filtered = admin_client.get(f"/api/stats/overview?days=0&student_id={alice['id']}")
    assert filtered.status_code == 200, filtered.text
    filtered_expected = _legacy_overview(owner_id, alice["id"], 0)
    for key in ("jobs", "knowledge_points", "summary", "knowledge_coverage", "student_summaries"):
        assert filtered.json()[key] == filtered_expected[key], key


def test_overview_job_pagination_does_not_shrink_summary_or_personal_trend(admin_client):
    owner_id = admin_client.get("/api/auth/me").json()["id"]
    student = store.create_student(owner_id, "趋势学生")
    other_student = store.create_student(owner_id, "另一学生")
    now = time.time()
    for index in range(35):
        _job(
            owner_id, f"personal-{index:02d}", now - index * 60,
            {"total": 3, "correct": 2, "wrong": 1}, student_id=student["id"],
        )
    _job(
        owner_id, "personal-no-objective", now + 1,
        {"total": 1, "subjective": 1}, student_id=student["id"],
    )
    _job(
        owner_id, "personal-other-student", now + 2,
        {"total": 1, "correct": 1}, student_id=other_student["id"],
    )

    response = admin_client.get(
        f"/api/stats/overview?days=0&student_id={student['id']}&job_limit=2&job_offset=0"
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert [job["id"] for job in payload["jobs"]] == ["personal-no-objective", "personal-00"]
    assert payload["job_total"] == payload["summary"]["total_jobs"] == 36
    assert payload["job_limit"] == 2
    assert payload["job_offset"] == 0
    assert payload["summary"]["correct"] == 70
    assert payload["summary"]["wrong"] == 35
    assert payload["summary"]["no_objective_jobs"] == 1

    trend = payload["trend"]
    assert len(trend) == 30
    assert [point["id"] for point in trend] == [
        f"personal-{index:02d}" for index in range(29, -1, -1)
    ]
    assert all(point["pct"] == 67 for point in trend)
    assert all(point["correct"] == 2 and point["wrong"] == 1 for point in trend)
    assert trend[0]["created_at"] < trend[-1]["created_at"]


def test_overview_class_trend_aggregates_last_30_days(admin_client):
    owner_id = admin_client.get("/api/auth/me").json()["id"]
    alice = store.create_student(owner_id, "甲")
    bob = store.create_student(owner_id, "乙")
    now = datetime.now().astimezone()
    timestamps = [(now - timedelta(days=index)).timestamp() for index in range(31)]
    for index, created_at in enumerate(timestamps):
        _job(
            owner_id, f"class-{index:02d}", created_at,
            {"total": 2, "correct": 1, "wrong": 1},
            student_id=alice["id"] if index % 2 == 0 else bob["id"],
        )
    _job(
        owner_id, "class-latest-second", timestamps[0] + 60,
        {"total": 4, "correct": 3, "wrong": 1},
    )
    _job(
        owner_id, "class-latest-no-objective", timestamps[0] + 120,
        {"total": 1, "subjective": 1}, student_id=alice["id"],
    )

    response = admin_client.get("/api/stats/overview?days=0&job_limit=1")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert len(payload["jobs"]) == 1
    assert payload["job_total"] == payload["summary"]["total_jobs"] == 33
    trend = payload["trend"]
    assert len(trend) == 30
    expected_days = [
        datetime.fromtimestamp(value).date().isoformat() for value in timestamps
    ]
    assert [point["date"] for point in trend] == list(reversed(expected_days[:30]))
    assert trend[-1]["id"] == expected_days[0]
    assert trend[-1]["correct"] == 4
    assert trend[-1]["wrong"] == 2
    assert trend[-1]["pct"] == 67
    assert all("date" in point for point in trend)


def test_days_and_forced_student_scope(admin_client):
    owner = admin_client.get("/api/auth/me").json()
    other_owner_id = store.create_user("scope-other-owner", "hash", role="admin")
    own = store.create_student(owner["id"], "本人档案")
    other = store.create_student(owner["id"], "其他同学")
    password = "student-test-password"
    store.create_student_account(
        owner["id"], own["id"], "scope-student", auth.hash_password(password),
    )
    now = time.time()
    _job(
        owner["id"], "scope-own-recent", now - 86400,
        {"total": 2, "correct": 1, "wrong": 1}, student_id=own["id"],
        questions=[_question("own-recent", "wrong", "本人")],
    )
    _job(
        owner["id"], "scope-own-old", now - 40 * 86400,
        {"total": 1, "correct": 1}, student_id=own["id"],
        questions=[_question("own-old", "wrong", "本人旧题")],
    )
    _job(
        owner["id"], "scope-other-recent", now - 3600,
        {"total": 2, "wrong": 2}, student_id=other["id"],
        questions=[_question("other-recent", "wrong", "他人")],
    )
    _job(
        other_owner_id, "scope-other-owner", now,
        {"total": 1, "wrong": 1}, student_id=own["id"],
        questions=[_question("other-owner", "wrong", "越权")],
    )

    logged_in = admin_client.post(
        "/api/auth/login", json={"username": "scope-student", "password": password},
    )
    assert logged_in.status_code == 200, logged_in.text

    recent = admin_client.get(f"/api/stats/overview?days=30&student_id={other['id']}")
    assert recent.status_code == 200, recent.text
    assert recent.json()["summary"]["total_jobs"] == 1
    assert [job["id"] for job in recent.json()["jobs"]] == ["scope-own-recent"]
    assert [point["id"] for point in recent.json()["trend"]] == ["scope-own-recent"]

    all_time = admin_client.get(
        f"/api/stats/overview?days=0&student_id={other['id']}&job_limit=1"
    )
    assert all_time.status_code == 200, all_time.text
    assert all_time.json()["summary"]["total_jobs"] == 2
    assert all_time.json()["job_total"] == 2
    assert len(all_time.json()["jobs"]) == 1
    assert {job["id"] for job in all_time.json()["jobs"]} <= {
        "scope-own-recent", "scope-own-old",
    }
    assert all_time.json()["student_summaries"][0]["student_id"] == own["id"]
    assert {point["id"] for point in all_time.json()["trend"]} == {
        "scope-own-recent", "scope-own-old",
    }

    mistakes = admin_client.get(f"/api/mistakes?days=0&student_id={other['id']}&limit=100")
    assert mistakes.status_code == 200, mistakes.text
    assert mistakes.json()["total"] == 2
    assert {question["job_id"] for question in _flat_groups(mistakes.json())} == {
        "scope-own-recent", "scope-own-old",
    }


def test_invalid_pagination_and_days_return_422(admin_client):
    paths = [
        "/api/mistakes?days=-1",
        "/api/mistakes?limit=-1",
        "/api/mistakes?limit=101",
        "/api/mistakes?offset=-1",
        "/api/mistakes?limit=not-an-integer",
        "/api/stats/overview?days=-1",
        "/api/stats/overview?job_limit=-1",
        "/api/stats/overview?job_limit=101",
        "/api/stats/overview?job_offset=-1",
        "/api/stats/overview?job_offset=not-an-integer",
    ]
    for path in paths:
        response = admin_client.get(path)
        assert response.status_code == 422, (path, response.text)


def test_days_above_cap_is_clamped(admin_client):
    owner_id = admin_client.get("/api/auth/me").json()["id"]
    now = time.time()
    _job(owner_id, "days-inside-cap", now - 3649 * 86400, {"total": 1, "correct": 1})
    _job(owner_id, "days-outside-cap", now - 3651 * 86400, {"total": 1, "correct": 1})

    response = admin_client.get("/api/stats/overview?days=5000")
    assert response.status_code == 200, response.text
    assert response.json()["summary"]["total_jobs"] == 1
    assert [job["id"] for job in response.json()["jobs"]] == ["days-inside-cap"]

    mistakes = admin_client.get("/api/mistakes?days=5000")
    assert mistakes.status_code == 200, mistakes.text
    assert mistakes.json()["total"] == 0
