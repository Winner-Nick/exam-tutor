from __future__ import annotations

import gc
import json

from app import db, llm, pdf_utils, pipeline, store


def _paper() -> str:
    user_id = store.create_user("identity-teacher", "hash")
    store.create_paper("paper-identity", user_id, "身份测试")
    store.update_paper("paper-identity", status="ready", stage="done")
    return "paper-identity"


def _ocr_question(source_key: str, number: str, stem: str) -> dict:
    _, page, _, index = source_key.split(":")
    source = {
        "file_sha256": "sha-source", "page": int(page), "index": int(index),
        "local_number": number, "section": "第一节", "continuation": None,
    }
    return {
        "id": store.new_question_id(), "number": number, "section": "第一节",
        "type": "single_choice", "stem": stem,
        "options": {"A": "甲", "B": "乙", "C": "丙"},
        "correct_answer": "A", "knowledge_point": None, "needs_review": False,
        "source_key": source_key, "source_occurrence": source,
        "source_occurrences": [source], "aliases": [source_key],
    }


def test_answer_occurrences_map_duplicate_section_numbers(monkeypatch):
    pages = [
        {"page": 1, "_file_page": 1, "_file_sha": "sha-sections",
         "questions": [{"number": "1", "section": "第一节", "stem": "甲题"}],
         "answer_occurrences": []},
        {"page": 2, "_file_page": 2, "_file_sha": "sha-sections",
         "questions": [{"number": "1", "section": "第二节", "stem": "乙题"}],
         "answer_occurrences": []},
        {"page": 3, "_file_page": 3, "_file_sha": "sha-sections", "questions": [],
         "answer_occurrences": [
             {"section": "第一节", "local_number": "1", "page": 3, "answer": "A"},
             {"section": "第二节", "local_number": "1", "page": 3, "answer": "B"},
         ]},
    ]
    pipeline._prepare_source_occurrences(pages)
    first_uid = pages[0]["questions"][0]["_source_uid"]
    second_uid = pages[1]["questions"][0]["_source_uid"]
    first_answer = pages[2]["answer_occurrences"][0]["_answer_uid"]
    second_answer = pages[2]["answer_occurrences"][1]["_answer_uid"]
    monkeypatch.setattr(llm, "deepseek_json", lambda *args, **kwargs: {
        "mapping": [{"uid": first_uid, "global": "1"}, {"uid": second_uid, "global": "2"}],
        "answer_mapping": [
            {"uid": first_answer, "question_uid": first_uid, "global": "1"},
            {"uid": second_answer, "question_uid": second_uid, "global": "2"},
        ],
    })

    pipeline._renumber_pages(pages)
    questions = pipeline.build_paper_questions(pages)

    assert len(questions) == 2
    by_section = {q["section"]: q for q in questions}
    assert by_section["第一节"]["correct_answer"] == "A"
    assert by_section["第二节"]["correct_answer"] == "B"
    assert by_section["第一节"]["number"] == "1"
    assert by_section["第二节"]["number"] == "2"
    assert all(q["id"].startswith("q_") for q in questions)
    assert all(q["id"] != "q" + q["number"] for q in questions)
    assert not any(q["needs_review"] for q in questions)


def test_unresolved_explicit_answer_target_is_not_guessed():
    pages = [{
        "page": 1, "_file_page": 1, "_file_sha": "sha-unresolved",
        "questions": [{"number": "1", "section": "第一节", "stem": "题干"}],
        "answer_occurrences": [{"section": "第一节", "local_number": "1", "page": 1, "answer": "A"}],
    }]
    pipeline._prepare_source_occurrences(pages)
    pages[0]["answer_occurrences"][0]["_question_uid"] = "missing-target"

    questions = pipeline.build_paper_questions(pages)

    original = next(q for q in questions if q.get("stem") == "题干")
    assert original["correct_answer"] is None
    assert original["needs_review"] is True
    assert any(q.get("source_occurrence", {}).get("kind") == "answer" and q["needs_review"]
               for q in questions)


def test_continuation_requires_a_resolvable_explicit_target():
    pages = [
        {"page": 1, "_file_page": 1, "_file_sha": "sha-continuation",
         "questions": [{"number": "1", "section": "第一节", "stem": "题干"}],
         "answer_occurrences": [{"local_number": "1", "page": 1, "answer": "A"}]},
        {"page": 2, "_file_page": 2, "_file_sha": "sha-continuation",
         "questions": [{
             "number": "1", "section": "第一节", "stem": "续写内容",
             "continuation": {"target_page": 1, "target_question_index": 1},
         }], "answer_occurrences": []},
    ]

    merged = pipeline.build_paper_questions(pages)
    assert len(merged) == 1
    assert len(merged[0]["source_occurrences"]) == 2
    assert merged[0]["correct_answer"] == "A"

    pages[1]["questions"][0]["continuation"] = {
        "target_page": 99, "target_question_index": 1,
    }
    separate = pipeline.build_paper_questions(pages)
    assert len(separate) == 2
    assert separate[-1]["needs_review"] is True


def test_display_number_edit_does_not_change_qid_or_source():
    paper_id = _paper()
    original = _ocr_question("sha-source:1:q:1", "1", "原题干")
    store.replace_paper_questions(paper_id, [original])
    qid = original["id"]
    revision = store.get_paper(paper_id)["revision"]

    store.update_paper_question(paper_id, qid, number=" 99 ")

    changed = store.get_paper_question(paper_id, qid)
    assert changed["id"] == qid
    assert changed["number"] == "99"
    assert changed["source_key"] == "sha-source:1:q:1"
    assert store.get_paper(paper_id)["revision"] == revision + 1


def test_reconcile_preserves_edits_and_tombstones_across_source_changes():
    paper_id = _paper()
    first = _ocr_question("sha-source:1:q:1", "1", "第一题")
    second = _ocr_question("sha-source:2:q:1", "2", "第二题")
    store.replace_paper_questions(paper_id, [first, second])
    first_id = first["id"]
    store.update_paper_question(paper_id, first_id, stem="人工题干", correct_answer="C")
    assert store.delete_paper_question(paper_id, second["id"]) is True
    manual = store.add_paper_question(paper_id, "50", "A", "single_choice")

    regenerated = [
        _ocr_question("sha-source:1:q:1", "1", "OCR 第一题"),
        _ocr_question("sha-source:2:q:1", "2", "OCR 第二题"),
        _ocr_question("sha-source:3:q:1", "3", "新增第三题"),
    ]
    reconciled = pipeline._reconcile_paper_identity(paper_id, regenerated)
    store.replace_paper_questions(paper_id, reconciled)

    current = {q["source_key"]: q for q in store.get_paper_questions(paper_id)}
    assert current["sha-source:1:q:1"]["id"] == first_id
    assert current["sha-source:1:q:1"]["stem"] == "人工题干"
    assert current["sha-source:1:q:1"]["correct_answer"] == "C"
    assert "sha-source:2:q:1" not in current
    assert store.get_paper_question(paper_id, manual["id"]) is not None

    removed = pipeline._reconcile_paper_identity(
        paper_id, [_ocr_question("sha-source:1:q:1", "1", "OCR 第一题")],
    )
    store.replace_paper_questions(paper_id, removed)
    remaining = store.get_paper_questions(paper_id)
    assert {q["source_key"] for q in remaining} == {"sha-source:1:q:1", None}
    assert store.get_paper_question(paper_id, first_id) is not None
    assert store.get_paper_question(paper_id, manual["id"]) is not None


def test_v11_migrates_qids_without_breaking_submission_associations():
    paper_id = _paper()
    store.replace_paper_questions(paper_id, [
        {"id": "q1", "number": "1", "stem": "一"},
        {"id": "q2", "number": "2", "stem": "二"},
    ])
    assert store.delete_paper_question(paper_id, "q2") is True
    paper = store.get_paper(paper_id)
    student = store.create_student(paper["user_id"], "学生")
    store.create_job(
        "submission-identity", paper["user_id"], "answers.pdf", kind="submission",
        paper_id=paper_id, student_id=student["id"],
    )
    store.replace_questions("submission-identity", [
        {"id": "q1", "number": "1", "status": "correct"},
        {"id": "q2", "number": "2", "status": "wrong"},
    ])
    store.add_review_attempt("submission-identity", "q1", "attempt", "A", "correct", 1, None)
    store.add_chat_message("submission-identity", "q1", "user", "保留聊天")
    review_pk = db.get_conn().execute(
        "SELECT question_pk FROM review_attempts WHERE job_id = 'submission-identity'"
    ).fetchone()[0]
    store.create_job("legacy-identity", paper["user_id"], "legacy.pdf")
    store.replace_questions("legacy-identity", [{"id": "q1", "number": "1", "status": "correct"}])
    conn = db.get_conn()
    conn.executescript("""
        UPDATE papers SET revision = 0;
        UPDATE jobs SET paper_revision = NULL, applied_paper_revision = NULL
        WHERE kind = 'submission';
        UPDATE paper_questions SET source_key = NULL, source_json = NULL, alias_json = NULL;
        UPDATE paper_question_tombstones SET source_key = NULL, alias_json = NULL;
    """)

    db._v11(conn)

    migrated = store.get_paper_questions(paper_id)[0]
    new_qid = migrated["id"]
    tombstone = store.list_paper_question_tombstones(paper_id, full=True)[0]
    assert new_qid.startswith("q_") and new_qid != "q1"
    assert tombstone["qid"].startswith("q_") and tombstone["qid"] != "q2"
    assert "q1" in migrated["aliases"]
    assert store.get_question("submission-identity", new_qid) is not None
    assert store.get_question("submission-identity", tombstone["qid"]) is not None
    assert store.list_review_attempts("submission-identity", new_qid)[0]["answer"] == "A"
    assert store.get_chat("submission-identity", new_qid)[0]["content"] == "保留聊天"
    assert db.get_conn().execute(
        "SELECT question_pk FROM review_attempts WHERE job_id = 'submission-identity'"
    ).fetchone()[0] == review_pk
    assert store.get_question("legacy-identity", "q1") is not None
    job = store.get_job("submission-identity")
    assert job["paper_revision"] == store.get_paper(paper_id)["revision"]
    assert job["applied_paper_revision"] == store.get_paper(paper_id)["revision"]


def test_full_cache_writes_occurrences_instead_of_flat_answer_key(tmp_path, monkeypatch):
    (tmp_path / "page_01.jpg").write_bytes(b"page")
    monkeypatch.setattr(pdf_utils, "is_blank_page", lambda path: False)
    monkeypatch.setattr(pdf_utils, "image_to_data_url", lambda path: "data")
    cache = store.vision_cache_path("sha-full", "full")

    results = pipeline._vision_file_pages(
        tmp_path, 0, 1, "sha-full", "full",
        lambda payload: [{"page": 1, "questions": [], "answer_key": {"1": "A"}}],
        lambda page: {"page": page, "questions": [], "answer_occurrences": []},
    )

    assert results[0]["answer_occurrences"][0]["local_number"] == "1"
    cached = json.loads(cache.read_text(encoding="utf-8"))
    assert "answer_key" not in cached[0]
    assert cached[0]["answer_occurrences"][0]["answer"] == "A"


def test_resource_and_cache_lock_tables_are_weakly_referenced():
    paper_lock = store.paper_lock("weak-paper")
    cache_lock = pipeline._cache_lock_for("weak-cache")
    assert ("paper", "weak-paper") in store._locks
    assert "weak-cache" in pipeline._cache_locks

    del paper_lock
    del cache_lock
    gc.collect()

    assert ("paper", "weak-paper") not in store._locks
    assert "weak-cache" not in pipeline._cache_locks
