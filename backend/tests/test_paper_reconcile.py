from __future__ import annotations

import pytest

from app import llm, pdf_utils, pipeline, store, workers
from app.models import KnowledgePointsRequest
from app.routers import jobs as jobs_router
from app.routers import papers as papers_router


def _question(qid: str, number: str, stem: str | None = None, correct: str = "A") -> dict:
    return {
        "id": qid, "number": number, "type": "single_choice",
        "stem": stem or f"题目 {number}", "options": {"A": "甲", "B": "乙"},
        "correct_answer": correct, "knowledge_point": None,
    }


def _setup_submission(monkeypatch, paper_questions: list[dict],
                      old_questions: list[dict] | None = None,
                      applied_revision: int | None = None) -> tuple[str, str]:
    user_id = store.create_user("reconcile-teacher", "hash")
    paper_id = "paper-reconcile"
    job_id = "job-reconcile"
    store.create_paper(paper_id, user_id, "同步测试")
    store.replace_paper_questions(paper_id, paper_questions)
    store.update_paper(paper_id, status="ready", stage="done")
    student = store.create_student(user_id, "学生")
    store.create_job(
        job_id, user_id, "answers.pdf", kind="submission",
        paper_id=paper_id, student_id=student["id"],
    )
    store.update_job(job_id, status="done", stage="done")
    if old_questions is not None:
        store.replace_questions(job_id, old_questions)
    if applied_revision is not None:
        store.update_job(job_id, applied_paper_revision=applied_revision)
    monkeypatch.setattr(workers, "enqueue_explanations", lambda *args, **kwargs: [])
    return paper_id, job_id


def _mock_render(monkeypatch, job_id: str, sha: str = "sha-answers") -> None:
    store.save_job_files(job_id, [{"id": "answers", "filename": "answers.jpg", "sha256": sha}])
    pages_dir = store.job_dir(job_id) / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    (pages_dir / "page_01.jpg").write_bytes(b"page")

    def fake_render(owner_dir, files, path_of):
        return [(files[0], 0, 1)]

    monkeypatch.setattr(pipeline, "_render_files", fake_render)
    monkeypatch.setattr(pdf_utils, "is_blank_page", lambda path: False)
    monkeypatch.setattr(pdf_utils, "image_to_data_url", lambda path: "data")


def test_revision_advances_once_per_logical_change():
    user_id = store.create_user("revision-teacher", "hash")
    paper_id = "paper-revisions"
    store.create_paper(paper_id, user_id, "版本测试")
    questions = [_question("q1", "1"), _question("q2", "2")]
    store.replace_paper_questions(paper_id, questions)
    assert store.get_paper(paper_id)["revision"] == 1

    store.replace_paper_questions(paper_id, questions)
    assert store.get_paper(paper_id)["revision"] == 1
    store.update_paper_question(paper_id, "q1", number="10")
    assert store.get_paper(paper_id)["revision"] == 2
    updated = store.update_paper_knowledge_points(
        paper_id, {"q1": "知识点一", "q2": "知识点二"}, mark_content_edited=False,
    )
    assert updated == 2
    assert store.get_paper(paper_id)["revision"] == 3
    assert store.update_paper_knowledge_points(
        paper_id, {"q1": "知识点一", "q2": "知识点二"}, mark_content_edited=False,
    ) == 0
    assert store.get_paper(paper_id)["revision"] == 3

    added = store.add_paper_question(paper_id, "3", "A", "single_choice")
    assert store.get_paper(paper_id)["revision"] == 4
    assert store.delete_paper_question(paper_id, added["id"]) is True
    assert store.get_paper(paper_id)["revision"] == 5


def test_reconcile_adds_updates_and_deletes_with_override_semantics(monkeypatch):
    old = [
        {**_question("q1", "1", "旧题干"), "student_answer": "人工答案",
         "status": "correct", "overridden": True},
        {**_question("q2", "2"), "student_answer": "B", "status": "correct",
         "overridden": True},
    ]
    paper_id, job_id = _setup_submission(
        monkeypatch, [_question("q1", "1"), _question("q2", "2")], old,
    )
    original_revision = store.get_job(job_id)["paper_revision"]
    store.replace_paper_questions(paper_id, [
        _question("q1", "10", "新题干", "B"), _question("q3", "3", "新增题"),
    ])

    assert pipeline.regrade_paper_submissions(paper_id) == 1

    questions = store.get_questions(job_id)
    assert {q["id"] for q in questions} == {"q1", "q3"}
    first = store.get_question(job_id, "q1")
    assert first["number"] == "10" and first["stem"] == "新题干"
    assert first["correct_answer"] == "B"
    assert first["student_answer"] == "人工答案"
    assert first["status"] == "correct" and first["overridden"] is True
    assert store.get_question(job_id, "q2") is None
    job = store.get_job(job_id)
    assert job["stats"] == {
        "total": 2, "correct": 1, "wrong": 0, "unknown": 1, "subjective": 0,
    }
    assert job["meta"]["total_questions"] == 2
    assert job["paper_revision"] == original_revision
    assert job["applied_paper_revision"] == store.get_paper(paper_id)["revision"]


def test_reconcile_rolls_back_questions_stats_meta_and_revision(monkeypatch):
    paper_id, job_id = _setup_submission(
        monkeypatch, [_question("q1", "1")],
        [{**_question("q1", "1"), "student_answer": "A", "status": "correct"}],
        applied_revision=1,
    )
    store.replace_paper_questions(
        paper_id, [_question("q1", "1", "改变题干"), _question("q2", "2")],
    )
    before_questions = store.get_questions(job_id)
    before_job = store.get_job(job_id)
    original_update = store.update_job

    def fail_on_meta(job_id_arg, **fields):
        if "meta" in fields:
            raise RuntimeError("injected reconcile failure")
        return original_update(job_id_arg, **fields)

    published = []
    monkeypatch.setattr(store, "update_job", fail_on_meta)
    monkeypatch.setattr(pipeline.events, "publish", lambda *args: published.append(args))

    with pytest.raises(RuntimeError, match="injected reconcile failure"):
        pipeline.regrade_paper_submissions(paper_id)

    assert store.get_questions(job_id) == before_questions
    after = store.get_job(job_id)
    assert after["stats"] == before_job["stats"]
    assert after["meta"] == before_job["meta"]
    assert after["applied_paper_revision"] == before_job["applied_paper_revision"]
    assert published == []


def test_manual_knowledge_point_items_bump_once_and_sync(monkeypatch):
    paper_id, job_id = _setup_submission(
        monkeypatch, [_question("q1", "1")],
        [{**_question("q1", "1"), "student_answer": "A", "status": "correct"}],
        applied_revision=1,
    )
    revision = store.get_paper(paper_id)["revision"]

    result = papers_router.knowledge_points(
        KnowledgePointsRequest(items={"q1": "几何", "missing": "忽略"}),
        paper=store.get_paper(paper_id),
    )

    assert result == {"ok": True, "updated": 1}
    assert store.get_paper(paper_id)["revision"] == revision + 1
    assert store.get_paper_question(paper_id, "q1")["content_edited"] is True
    assert store.get_question(job_id, "q1")["knowledge_point"] == "几何"
    assert store.get_job(job_id)["applied_paper_revision"] == revision + 1


def test_answer_cache_is_isolated_by_paper_revision(monkeypatch):
    paper_id, job_id = _setup_submission(monkeypatch, [_question("q1", "1")])
    _mock_render(monkeypatch, job_id)
    sha = "sha-answers"
    store.write_json_atomic(
        store.vision_cache_path(sha, pipeline._answer_cache_mode(paper_id, 1)),
        [{"page": 1, "answers": [{"number": "1", "answer": "A", "confidence": "high"}]}],
    )
    calls = []

    def new_answer(payload, **kwargs):
        calls.append([page for page, _ in payload])
        return [{"page": 1, "answers": [{"number": "1", "answer": "B", "confidence": "high"}]}]

    monkeypatch.setattr(llm, "vision_extract_pages", new_answer)
    pipeline.process_submission(job_id)
    assert store.get_question(job_id, "q1")["status"] == "correct"
    assert calls == []

    store.update_paper_question(paper_id, "q1", stem="revision 2 题干")
    assert store.get_paper(paper_id)["revision"] == 2
    pipeline.process_submission(job_id)

    assert calls == [[1]]
    assert store.get_question(job_id, "q1")["student_answer"] == "B"
    assert store.get_question(job_id, "q1")["status"] == "wrong"
    job = store.get_job(job_id)
    assert job["paper_revision"] == 2 and job["applied_paper_revision"] == 2
    assert store.vision_cache_path(sha, pipeline._answer_cache_mode(paper_id, 2)).exists()


def test_revision_change_during_ocr_does_not_apply_old_observations(monkeypatch):
    paper_id, job_id = _setup_submission(
        monkeypatch, [_question("q1", "1")],
        [{**_question("q1", "1"), "student_answer": "旧作答", "status": "wrong"}],
        applied_revision=1,
    )
    _mock_render(monkeypatch, job_id)
    before = store.get_questions(job_id)

    def change_structure(*args, **kwargs):
        store.update_paper_question(paper_id, "q1", stem="处理期间变化")
        return [{"page": 1, "answers": [{"number": "1", "answer": "A", "confidence": "high"}]}]

    monkeypatch.setattr(pipeline, "_vision_file_pages", change_structure)

    with pytest.raises(RuntimeError, match="结构版本已变化"):
        pipeline.process_submission(job_id)

    assert store.get_questions(job_id) == before
    job = store.get_job(job_id)
    assert job["status"] == "error"
    assert job["applied_paper_revision"] == 1


def test_source_partial_propagates_and_cannot_be_accepted_as_plain_done(monkeypatch):
    paper_id, job_id = _setup_submission(monkeypatch, [_question("q1", "1")])
    paper = store.get_paper(paper_id)
    store.update_paper(
        paper_id,
        meta={"accepted_partial": True, "numbering_needs_review": True, "failed_pages": []},
    )
    _mock_render(monkeypatch, job_id)
    monkeypatch.setattr(
        pipeline, "_vision_file_pages",
        lambda *args, **kwargs: [{
            "page": 1, "answers": [{"number": "1", "answer": "A", "confidence": "high"}],
        }],
    )

    pipeline.process_submission(job_id)

    job = store.get_job(job_id)
    assert job["status"] == "partial"
    assert job["meta"]["source_accepted_partial"] is True
    assert job["meta"]["source_needs_review"] is True
    jobs_router.accept_partial(store.get_job(job_id))
    assert store.get_job(job_id)["status"] == "partial"
    assert paper["status"] == "ready"


def test_unmatched_answers_and_notes_enter_quality_metadata(monkeypatch):
    paper_id, job_id = _setup_submission(monkeypatch, [_question("q1", "1")])
    _mock_render(monkeypatch, job_id)
    monkeypatch.setattr(
        pipeline, "_vision_file_pages",
        lambda *args, **kwargs: [{
            "page": 1, "notes": "无法确定第99题归属",
            "answers": [
                {"number": "1", "answer": "A", "confidence": "high"},
                {"number": "99", "answer": "B", "confidence": "low"},
            ],
        }],
    )

    pipeline.process_submission(job_id)

    job = store.get_job(job_id)
    assert job["status"] == "partial"
    quality = job["meta"]["quality"]
    assert quality["unmatched_answers"][0]["number"] == "99"
    assert quality["unmatched_answers"][0]["answer"] == "B"
    assert quality["notes"] == [{"page": 1, "notes": "无法确定第99题归属"}]
