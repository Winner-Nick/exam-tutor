from __future__ import annotations

import json

import pytest

from app import llm, pdf_utils, pipeline, store, workers
from app.routers import jobs as jobs_router


def _choice(qid: str, number: str, correct: str = "A") -> dict:
    return {
        "id": qid,
        "number": number,
        "type": "single_choice",
        "stem": "选择正确答案",
        "options": {"A": "甲", "B": "乙"},
        "correct_answer": correct,
    }


def _make_submission(monkeypatch, manifest: list[dict], paper_questions: list[dict],
                     old_questions: list[dict] | None = None) -> tuple[str, str]:
    user_id = store.create_user("teacher", "hash")
    paper_id = "paper-1"
    job_id = "job-1"
    store.create_paper(paper_id, user_id, "测试卷")
    store.replace_paper_questions(paper_id, paper_questions)
    store.update_paper(paper_id, status="ready", stage="done")
    student = store.create_student(user_id, "学生")
    store.create_job(
        job_id, user_id, "answers.jpg", kind="submission",
        paper_id=paper_id, student_id=student["id"],
    )
    store.update_job(job_id, status="done", stage="done")
    store.save_job_files(job_id, manifest)
    for item in manifest:
        path = store.job_dir(job_id) / "files" / f"{item['id']}.jpg"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"source")
    if old_questions:
        store.replace_questions(job_id, old_questions)

    def fake_render(owner_dir, files, path_of):
        pages_dir = owner_dir / "pages"
        pages_dir.mkdir(parents=True, exist_ok=True)
        plans = []
        start = 0
        for item in files:
            count = item.get("pages", 1)
            plans.append((item, start, count))
            start += count
        for page in range(1, start + 1):
            (pages_dir / f"page_{page:02d}.jpg").write_bytes(b"page")
        return plans

    monkeypatch.setattr(pipeline, "_render_files", fake_render)
    monkeypatch.setattr(workers, "enqueue_job", lambda *args, **kwargs: None)
    monkeypatch.setattr(workers, "enqueue_explanations", lambda *args, **kwargs: None)
    return paper_id, job_id


@pytest.mark.parametrize(
    ("question", "expected"),
    [
        ({"type": "多选题", "options": {"A": "1", "B": "2", "C": "3"},
          "correct_answer": "AB", "student_answer": "B, A"}, "correct"),
        ({"type": "多选题", "options": {"A": "1", "B": "2", "C": "3"},
          "correct_answer": "A,B", "student_answer": "B/A"}, "correct"),
        ({"type": "多选题", "options": {"A": "1", "B": "2"},
          "correct_answer": "AB", "student_answer": "A"}, "wrong"),
        ({"type": "single_choice", "options": {"A": "1", "B": "2"},
          "correct_answer": "A", "student_answer": "B"}, "wrong"),
        ({"type": "single_choice", "options": {"A": "1", "B": "2"},
          "correct_answer": "E", "student_answer": "A"}, "unknown"),
        ({"type": "single_choice", "options": {"A": "1", "B": "2"},
          "correct_answer": "A", "student_answer": "E"}, "unknown"),
        ({"type": "numeric", "correct_answer": "0.5", "student_answer": ".50"}, "correct"),
        ({"type": "numeric", "correct_answer": "2", "student_answer": "3"}, "wrong"),
        ({"type": "numeric", "correct_answer": "2", "student_answer": "二"}, "unknown"),
        ({"type": "fill_blank", "correct_answer": "3", "student_answer": "3.0"}, "correct"),
        ({"type": "fill_blank", "correct_answer": "London", "student_answer": "Paris"}, "wrong"),
        ({"type": "fill_blank", "correct_answer": "合理即可", "student_answer": "任意作答"}, "unknown"),
        ({"type": "简答题", "correct_answer": "参考", "student_answer": "作答"}, "subjective"),
        ({"type": "other", "correct_answer": "foo", "student_answer": "bar"}, "unknown"),
    ],
)
def test_grade_one_uses_reliable_type_comparators(question, expected):
    pipeline._grade_one(question)
    assert question["status"] == expected


def test_section_number_conflict_never_merges_old_answer_key():
    pages = [
        {"page": 1, "questions": [{"number": "1", "section": "第一节", "stem": "甲"}],
         "answer_key": {"1": "A"}},
        {"page": 2, "questions": [{"number": "1", "section": "第二节", "stem": "乙"}],
         "answer_key": {"1": "B"}},
    ]
    pipeline._mark_number_conflicts(pages)
    pages[1]["questions"][0]["number"] = "2"

    questions = pipeline.build_paper_questions(pages)

    assert len(questions) == 2
    assert [q["number"] for q in questions] == ["1", "2"]
    assert all(q["correct_answer"] is None for q in questions)
    assert all(q["needs_review"] for q in questions)


def test_answer_only_conflict_creates_review_stub_without_answer():
    pages = [
        {"page": 1, "questions": [], "answer_key": {"7": "A"}},
        {"page": 2, "questions": [], "answer_key": {"7": "B"}},
    ]

    questions = pipeline.build_paper_questions(pages)

    assert len(questions) == 1
    assert questions[0]["number"] == "7"
    assert questions[0]["correct_answer"] is None
    assert questions[0]["needs_review"] is True


def test_duplicate_paper_numbers_do_not_share_submission_answer():
    first, second = _choice("q-first", "1"), _choice("q-second", "1", "B")

    questions = pipeline.grade_submission_questions([first, second], {"1": "A"})

    assert len(questions) == 2
    assert all(q["student_answer"] is None for q in questions)
    assert all(q["correct_answer"] is None for q in questions)
    assert all(q["status"] == "unknown" for q in questions)
    assert all(q["needs_review"] for q in questions)


def test_regrade_duplicate_numbers_preserves_only_manual_override(monkeypatch):
    old = [
        {**_choice("q-first", "1"), "student_answer": "人工答案", "status": "correct",
         "overridden": True},
        {**_choice("q-second", "1", "B"), "student_answer": "B", "status": "correct"},
    ]
    paper_id, job_id = _make_submission(
        monkeypatch,
        [{"id": "file-1", "filename": "one.jpg", "sha256": "sha-one"}],
        [_choice("q-first", "1"), _choice("q-second", "1", "B")],
        old,
    )

    pipeline.regrade_paper_submissions(paper_id)

    overridden = store.get_question(job_id, "q-first")
    old_ocr = store.get_question(job_id, "q-second")
    assert overridden["student_answer"] == "人工答案"
    assert overridden["status"] == "correct"
    assert overridden["needs_review"] is True
    assert old_ocr["student_answer"] is None
    assert old_ocr["correct_answer"] is None
    assert old_ocr["status"] == "unknown"
    assert old_ocr["needs_review"] is True


def test_deleted_file_does_not_restore_old_correct_answer(monkeypatch):
    manifest = [
        {"id": "file-1", "filename": "one.jpg", "sha256": "sha-one"},
        {"id": "file-2", "filename": "two.jpg", "sha256": "sha-two"},
    ]
    old = [
        {**_choice("q1", "1"), "student_answer": "人工答案", "status": "correct",
         "overridden": True},
        {**_choice("q2", "2"), "student_answer": "A", "status": "correct"},
    ]
    _, job_id = _make_submission(
        monkeypatch, manifest, [_choice("q1", "1"), _choice("q2", "2")], old,
    )
    monkeypatch.setattr(
        pipeline, "_vision_file_pages",
        lambda *args, **kwargs: [{"page": 1, "answers": []}],
    )

    jobs_router.delete_submission_file(
        "file-1", job=store.get_job(job_id), user={"role": "user"},
    )
    pipeline.process_submission(job_id)

    overridden = store.get_question(job_id, "q1")
    old_ocr = store.get_question(job_id, "q2")
    assert overridden["student_answer"] == "人工答案"
    assert overridden["status"] == "correct"
    assert overridden["overridden"] is True
    assert old_ocr["student_answer"] is None
    assert old_ocr["status"] == "unknown"
    assert store.get_job(job_id)["status"] == "done"


def test_legacy_rerun_preserves_overridden_answer(monkeypatch):
    user_id = store.create_user("teacher", "hash")
    job_id = "legacy-1"
    store.create_job(job_id, user_id, "legacy.pdf")
    store.update_job(job_id, status="done")
    store.replace_questions(job_id, [
        {**_choice("q1", "1"), "student_answer": "人工答案", "status": "correct",
         "overridden": True},
    ])
    job_dir = store.job_dir(job_id)
    (job_dir / "pages").mkdir(parents=True, exist_ok=True)
    (job_dir / "pages" / "page_01.jpg").write_bytes(b"page")
    pages = [{
        "page": 1,
        "questions": [{
            "number": "1", "type": "single_choice", "stem": "题",
            "options": {"A": "甲", "B": "乙"},
            "student_marked": "B", "student_marked_confidence": "high",
        }],
        "answer_key": {"1": "A"},
    }]
    (job_dir / "pages_raw.json").write_text(json.dumps(pages), encoding="utf-8")
    monkeypatch.setattr(workers, "enqueue_explanations", lambda *args, **kwargs: None)

    pipeline.process_job(job_id)

    question = store.get_question(job_id, "q1")
    assert question["student_answer"] == "人工答案"
    assert question["status"] == "correct"
    assert question["overridden"] is True


def test_two_page_submission_with_one_cached_page_is_partial(monkeypatch):
    sha = "two-page-sha"
    manifest = [{"id": "file-1", "filename": "two.jpg", "sha256": sha, "pages": 2}]
    _, job_id = _make_submission(monkeypatch, manifest, [_choice("q1", "1")])
    store.write_json_atomic(store.vision_cache_path(sha, "full"), [{
        "page": 1,
        "questions": [{"number": "1", "student_marked": "A",
                       "student_marked_confidence": "high"}],
    }])
    store.write_json_atomic(store.vision_cache_path(sha, "ans-paper-1"), [{
        "page": 1, "answers": [{"number": "1", "answer": "A", "confidence": "high"}],
    }])
    calls = []

    def missing_page(payload, **kwargs):
        calls.append([page for page, _ in payload])
        return []

    monkeypatch.setattr(llm, "vision_extract_pages", missing_page)
    monkeypatch.setattr(pdf_utils, "is_blank_page", lambda path: False)
    monkeypatch.setattr(pdf_utils, "image_to_data_url", lambda path: "data:image/jpeg;base64,x")

    pipeline.process_submission(job_id)

    job = store.get_job(job_id)
    assert calls == [[2]]
    assert job["status"] == "partial"
    assert job["meta"]["failed_pages"] == [2]


def test_vision_cache_missing_page_is_retried_and_completed(tmp_path, monkeypatch):
    sha = "retry-sha"
    cache = store.vision_cache_path(sha, "ans-paper")
    store.write_json_atomic(cache, [{"page": 1, "answers": []}])
    (tmp_path / "page_02.jpg").write_bytes(b"page")
    monkeypatch.setattr(pdf_utils, "is_blank_page", lambda path: False)
    monkeypatch.setattr(pdf_utils, "image_to_data_url", lambda path: "data")

    results = pipeline._vision_file_pages(
        tmp_path, 0, 2, sha, "ans-paper",
        lambda payload: [{"page": 2, "answers": []}],
        lambda page: {"page": page, "answers": []},
    )

    assert [p["page"] for p in results] == [1, 2]
    assert not any(p.get("error") for p in results)
    assert [p["page"] for p in json.loads(cache.read_text(encoding="utf-8"))] == [1, 2]


def test_render_files_missing_manifest_source_fails(tmp_path):
    with pytest.raises(FileNotFoundError, match="清单源文件缺失"):
        pipeline._render_files(
            tmp_path, [{"id": "missing", "filename": "missing.jpg"}],
            lambda file_id: None,
        )
