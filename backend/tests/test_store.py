import pytest

from app import store
from app.db import transaction


def test_user_and_invite_crud():
    user_id = store.create_user("store-admin", "initial-hash", role="admin")

    assert store.count_users() == 1
    assert store.get_user(user_id)["username"] == "store-admin"
    assert store.get_user_by_username("store-admin")["role"] == "admin"

    store.set_password(user_id, "new-hash")
    updated = store.get_user(user_id)
    assert updated["password_hash"] == "new-hash"
    assert updated["session_version"] == 1

    code = store.create_invite(user_id, max_uses=2, ttl_days=1)
    assert store.list_invites()[0]["status"] == "active"
    assert store.consume_invite(code) is True
    assert store.consume_invite(code) is True
    assert store.consume_invite(code) is False
    assert store.list_invites()[0]["status"] == "used_up"
    assert store.delete_invite(code) is True
    assert store.delete_invite(code) is False
    assert store.list_invites() == []


def test_job_and_question_crud_with_stats():
    user_id = store.create_user("job-owner", "hash")
    store.create_job("job-crud", user_id, "answers.pdf", created_at=1.0)
    store.update_job(
        "job-crud", status="done", stage="done", title="练习",
        meta={"source": "test"}, stats={"total": 0},
    )

    job = store.get_job("job-crud")
    assert job["filename"] == "answers.pdf"
    assert job["meta"] == {"source": "test"}
    assert job["status"] == "done"

    store.replace_questions("job-crud", [
        {
            "id": "q1", "number": "1", "type": "single_choice",
            "stem": "第一题", "options": {"A": "对", "B": "错"},
            "student_answer": "A", "correct_answer": "A", "status": "correct",
        },
        {
            "id": "q2", "number": "2", "type": "single_choice",
            "stem": "第二题", "options": {"A": "对", "B": "错"},
            "student_answer": "B", "correct_answer": "A", "status": "wrong",
        },
    ])

    assert store.get_questions("job-crud")[0]["options"] == {"A": "对", "B": "错"}
    assert store.get_question("job-crud", "q1")["revision"] == 1

    store.update_question("job-crud", "q2", student_answer="A", status="correct")
    changed = store.get_question("job-crud", "q2")
    assert changed["status"] == "correct"
    assert changed["revision"] == 2

    store.update_question(
        "job-crud", "q2", explanation={"text": "解析"}, explain_state="done",
    )
    assert store.get_question("job-crud", "q2")["explanation"] == {"text": "解析"}

    stats = store.refresh_stats("job-crud")
    assert stats == {"total": 2, "correct": 2, "wrong": 0, "unknown": 0, "subjective": 0}
    assert store.get_job("job-crud")["stats"] == stats
    assert [item["id"] for item in store.list_jobs(user_id)] == ["job-crud"]

    store.delete_job("job-crud")
    assert store.get_job("job-crud") is None
    assert store.get_questions("job-crud") == []


def test_paper_question_and_file_crud():
    user_id = store.create_user("paper-owner", "hash")
    store.create_paper("paper-crud", user_id, "综合练习", subject="数学", grade="五年级")
    store.update_paper("paper-crud", status="ready", stage="done", meta={"source": "test"})

    question = store.add_paper_question(
        "paper-crud", "1", "A", "single_choice",
        {"stem": "题目", "options": {"A": "甲", "B": "乙"}},
    )
    store.update_paper_question_answer("paper-crud", question["id"], "B")

    paper = store.get_paper("paper-crud")
    assert paper["status"] == "ready"
    assert paper["meta"] == {"source": "test"}
    assert paper["question_count"] == 1
    assert paper["answered_count"] == 1
    assert store.get_paper_question("paper-crud", question["id"])["correct_answer"] == "B"
    assert [item["id"] for item in store.list_papers(user_id)] == ["paper-crud"]

    file_id = store.add_paper_file("paper-crud", "questions", "paper.pdf", None)
    store.set_paper_file_sha(file_id, "test-sha")
    store.update_paper_file(file_id, page_start=1, page_count=2)
    files = store.list_paper_files("paper-crud")
    assert files[0]["sha256"] == "test-sha"
    assert files[0]["page_start"] == 1
    assert files[0]["page_count"] == 2
    assert store.delete_paper_file(file_id, "paper-crud") is True
    assert store.list_paper_files("paper-crud") == []

    assert store.delete_paper_question("paper-crud", question["id"]) is True
    assert store.get_paper_questions("paper-crud") == []
    assert store.list_paper_question_tombstones("paper-crud") == [
        {"qid": question["id"], "number": "1"}
    ]

    store.delete_paper("paper-crud")
    assert store.get_paper("paper-crud") is None
    assert store.list_paper_question_tombstones("paper-crud") == []


def test_nested_transaction_rolls_back_only_inner_savepoint():
    with transaction():
        store.create_user("outer-before", "hash")
        with pytest.raises(ValueError, match="rollback inner"):
            with transaction():
                store.create_user("inner-discarded", "hash")
                raise ValueError("rollback inner")
        store.create_user("outer-after", "hash")

    assert store.get_user_by_username("outer-before") is not None
    assert store.get_user_by_username("inner-discarded") is None
    assert store.get_user_by_username("outer-after") is not None


def test_outer_transaction_rolls_back_nested_store_writes():
    with pytest.raises(RuntimeError, match="rollback outer"):
        with transaction():
            store.create_user("outer-discarded", "hash")
            with transaction():
                store.create_user("nested-also-discarded", "hash")
            raise RuntimeError("rollback outer")

    assert store.count_users() == 0
