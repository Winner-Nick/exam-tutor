from __future__ import annotations

import sqlite3

import pytest
from fastapi import HTTPException

from app import db, pipeline, store, workers
from app.models import OverrideRequest, PaperQuestionPatchRequest
from app.routers import papers as papers_router
from app.routers import questions as questions_router


def _question(qid: str = "q1", number: str = "1") -> dict:
    return {
        "id": qid,
        "number": number,
        "type": "single_choice",
        "stem": "选择正确答案",
        "options": {"A": "甲", "B": "乙"},
        "correct_answer": "A",
    }


def _paper(questions: list[dict] | None = None) -> str:
    user_id = store.create_user("teacher", "hash")
    paper_id = "paper-1"
    store.create_paper(paper_id, user_id, "测试卷")
    store.replace_paper_questions(paper_id, questions or [])
    store.update_paper(paper_id, status="ready", stage="done")
    return paper_id


def test_number_migration_preserves_duplicate_rows_and_marks_review():
    conn = sqlite3.connect(":memory:")
    conn.executescript("""
        CREATE TABLE paper_questions (
            id INTEGER PRIMARY KEY,
            paper_id TEXT,
            qid TEXT,
            number TEXT,
            correct_answer TEXT,
            needs_review INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO paper_questions (paper_id, qid, number, correct_answer)
        VALUES ('p', 'qa', ' 1 ', 'A'), ('p', 'qb', '１', 'B'), ('p', 'qc', '2', 'C');
    """)

    db._v10(conn)
    db._v10(conn)

    rows = conn.execute(
        "SELECT qid, correct_answer, needs_review, number_key, number "
        "FROM paper_questions WHERE paper_id = 'p' ORDER BY id"
    ).fetchall()
    assert len(rows) == 3
    assert [row[0] for row in rows] == ["qa", "qb", "qc"]
    assert [row[1] for row in rows] == [None, None, "C"]
    assert [row[2] for row in rows] == [1, 1, 0]
    assert len({row[3] for row in rows}) == 3
    assert rows[0][4] == " 1 " and rows[1][4] == "１"
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO paper_questions (paper_id, qid, number, number_key) "
            "VALUES ('p', 'qd', '1', '1')"
        )


def test_add_and_patch_numbers_are_normalized_checked_and_atomic():
    paper_id = _paper()
    first = store.add_paper_question(paper_id, " 1 ", "A", "single_choice")
    second = store.add_paper_question(paper_id, "2", "B", "single_choice")
    assert first["number"] == "1" and first["number_key"] == "1"

    with pytest.raises(ValueError, match="题号不能为空"):
        store.add_paper_question(paper_id, "   ", None, None)
    with pytest.raises(sqlite3.IntegrityError):
        store.add_paper_question(paper_id, "１", None, None)
    with pytest.raises(HTTPException) as exc_info:
        papers_router.patch_question(
            second["id"], PaperQuestionPatchRequest(number=" 1 "),
            paper=store.get_paper(paper_id),
        )

    assert exc_info.value.status_code == 409
    unchanged = store.get_paper_question(paper_id, second["id"])
    assert unchanged["number"] == "2" and unchanged["number_key"] == "2"
    assert len(store.get_paper_questions(paper_id)) == 2


def test_two_hundred_question_limit_is_enforced_by_store_transaction():
    paper_id = _paper([_question(f"q{i}", str(i)) for i in range(1, 201)])

    with pytest.raises(ValueError, match="题目数量已达上限"):
        store.add_paper_question(paper_id, "201", None, None)

    assert len(store.get_paper_questions(paper_id)) == 200


def test_replacement_duplicate_numbers_are_reviewed_not_last_write_wins():
    paper_id = _paper([
        {**_question("qa", "1"), "correct_answer": "A"},
        {**_question("qb", "1"), "correct_answer": "B"},
    ])

    questions = store.get_paper_questions(paper_id)
    assert len(questions) == 2
    assert all(q["needs_review"] for q in questions)
    assert all(q["correct_answer"] is None for q in questions)
    assert len({q["number_key"] for q in questions}) == 2
    with pytest.raises(sqlite3.IntegrityError):
        store.add_paper_question(paper_id, "1", None, None)

    assert store.delete_paper_question(paper_id, "qa") is True
    third = store.add_paper_question(paper_id, "3", None, None)
    with pytest.raises(sqlite3.IntegrityError):
        store.add_paper_question(paper_id, "1", None, None)
    with pytest.raises(sqlite3.IntegrityError):
        store.update_paper_question(paper_id, third["id"], number="1")


def test_automatic_knowledge_point_is_not_manual_content_edit(monkeypatch):
    paper_id = _paper([_question()])
    monkeypatch.setattr(
        pipeline.llm, "deepseek_json",
        lambda *args, **kwargs: {"knowledge_points": {"q1": "自动知识点"}},
    )

    assert pipeline.complete_knowledge_points(paper_id) == 1
    question = store.get_paper_question(paper_id, "q1")
    assert question["knowledge_point"] == "自动知识点"
    assert question["content_edited"] is False

    store.update_paper_question(paper_id, "q1", knowledge_point="手工知识点")
    question = store.get_paper_question(paper_id, "q1")
    assert question["content_edited"] is True


def test_override_distinguishes_omitted_answer_from_explicit_null(monkeypatch):
    user_id = store.create_user("teacher", "hash")
    job_id = "job-1"
    store.create_job(job_id, user_id, "answers.pdf")
    store.update_job(job_id, status="done")
    store.replace_questions(job_id, [{
        **_question(), "student_answer": "A", "status": "correct",
    }])
    monkeypatch.setattr(workers, "enqueue_explanations", lambda *args, **kwargs: None)

    questions_router.override_answer(
        "q1", OverrideRequest(status="wrong"),
        job=store.get_job(job_id), user={"role": "user"},
    )
    question = store.get_question(job_id, "q1")
    assert question["student_answer"] == "A"
    assert question["status"] == "wrong"
    assert question["overridden"] is True

    questions_router.override_answer(
        "q1", OverrideRequest(student_answer=None),
        job=store.get_job(job_id), user={"role": "user"},
    )
    question = store.get_question(job_id, "q1")
    assert question["student_answer"] is None
    assert question["status"] == "unknown"
    assert question["overridden"] is True
