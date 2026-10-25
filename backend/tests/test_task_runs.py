from __future__ import annotations

import queue

import pytest

from app import run_store, store, workers
from app.models import PaperQuestionPatchRequest
from app.routers import papers as papers_router

REAL_RESUME_PENDING = workers.resume_pending


def _question(qid: str = "q1") -> dict:
    return {
        "id": qid, "number": "1", "type": "single_choice", "stem": "题",
        "options": {"A": "甲", "B": "乙"}, "correct_answer": "A",
    }


def _paper_with_submission(*, ready: bool = True) -> tuple[int, str, str]:
    owner_id = store.create_user("task-owner", "hash")
    paper_id = "task-paper"
    job_id = "task-job"
    store.create_paper(paper_id, owner_id, "任务试卷")
    if ready:
        store.replace_paper_questions(paper_id, [_question()])
        store.update_paper(paper_id, status="ready", stage="done")
    student = store.create_student(owner_id, "学生")
    store.create_job(
        job_id, owner_id, "answers.pdf", kind="submission",
        paper_id=paper_id, student_id=student["id"],
    )
    store.update_job(job_id, status="done" if ready else "processing")
    return owner_id, paper_id, job_id


def test_active_run_dedup_generation_and_heartbeat():
    owner_id = store.create_user("run-owner", "hash")
    first, created = run_store.enqueue_run("paper", "p1", "process", owner_id)
    duplicate, created_again = run_store.enqueue_run("paper", "p1", "process", owner_id)
    assert created is True and created_again is False
    assert duplicate["id"] == first["id"]

    claimed = run_store.claim_run(first["id"])
    assert claimed["attempt"] == 1
    assert run_store.claim_run(first["id"]) is None
    assert run_store.heartbeat(first["id"], first["generation"]) is True
    run_store.assert_current(first["id"], first["generation"])
    assert run_store.mark_done(first["id"], first["generation"]) is True

    second, _ = run_store.enqueue_run("paper", "p1", "process", owner_id)
    assert second["generation"] == first["generation"] + 1
    with pytest.raises(run_store.StaleRun):
        run_store.assert_current(first["id"], first["generation"])


def test_followups_added_while_running_are_read_from_latest_db_state(monkeypatch):
    owner_id = store.create_user("followup-owner", "hash")
    run, _ = run_store.enqueue_run("paper", "followup-paper", "process", owner_id)
    claimed = run_store.claim_run(run["id"])
    run_store.enqueue_run("paper", "followup-paper", "reconcile", owner_id)
    calls = []

    def record(*args, **kwargs):
        calls.append((args, kwargs))

    monkeypatch.setattr(run_store, "enqueue_run", record)
    run_store.followups(claimed)

    assert len(calls) == 1
    assert calls[0][0][2] == "reconcile"


def test_restart_recovers_running_and_legacy_processing(monkeypatch):
    owner_id = store.create_user("restart-owner", "hash")
    run, _ = run_store.enqueue_run("paper", "restart-paper", "process", owner_id)
    run_store.claim_run(run["id"])
    store.create_job("legacy-restart", owner_id, "legacy.pdf")
    pending_queue = queue.Queue()
    monkeypatch.setattr(workers, "_job_q", pending_queue)

    assert run_store.recover_running() == 1
    REAL_RESUME_PENDING()

    assert run_store.get_run(run["id"])["status"] in ("queued", "waiting")
    operations = {item["operation"] for item in run_store.list_active_runs()}
    assert "process_legacy" in operations
    assert pending_queue.qsize() >= 1
    assert all(isinstance(pending_queue.get(), str) for _ in range(pending_queue.qsize()))


def test_duplicate_enqueue_never_executes_twice(monkeypatch):
    owner_id = store.create_user("duplicate-owner", "hash")
    store.create_job("duplicate-job", owner_id, "legacy.pdf")
    pending_queue = queue.Queue()
    monkeypatch.setattr(workers, "_job_q", pending_queue)
    calls = []

    def process(job_id):
        calls.append(job_id)
        store.update_job(job_id, status="done")

    monkeypatch.setattr(workers.pipeline, "process_job", process)
    workers.enqueue_job("duplicate-job")
    workers.enqueue_job("duplicate-job")
    run = run_store.list_active_runs()[0]
    workers._execute_run_id(run["id"])
    workers._execute_run_id(run["id"])

    assert calls == ["duplicate-job"]
    assert pending_queue.qsize() == 1
    assert run_store.get_run(run["id"])["status"] == "done"


def test_dependency_wait_retries_without_permanent_error(monkeypatch):
    owner_id, paper_id, job_id = _paper_with_submission(ready=False)
    run, _ = run_store.enqueue_run(
        "job", job_id, "process_submission", owner_id, max_attempts=2,
    )

    workers._execute_run_id(run["id"])

    waiting = run_store.get_run(run["id"])
    assert waiting["status"] == "waiting"
    assert store.get_job(job_id)["status"] == "processing"
    assert store.get_job(job_id)["stage"] == "waiting"
    store.get_conn().execute("UPDATE task_runs SET available_at = 0 WHERE id = ?", (run["id"],))
    monkeypatch.setattr(
        workers.pipeline, "process_submission",
        lambda job_id_arg: store.update_job(job_id_arg, status="done"),
    )
    workers._execute_run_id(run["id"])
    assert run_store.get_run(run["id"])["status"] == "done"
    assert store.get_job(job_id)["status"] == "done"


def test_dependency_exhaustion_marks_error_only_after_max_attempts():
    owner_id, _paper_id, job_id = _paper_with_submission(ready=False)
    run, _ = run_store.enqueue_run(
        "job", job_id, "process_submission", owner_id, max_attempts=1,
    )

    workers._execute_run_id(run["id"])

    assert run_store.get_run(run["id"])["status"] == "error"
    assert store.get_job(job_id)["status"] == "error"


def test_teacher_processing_quota_is_atomic():
    owner_id = store.create_user("quota-owner", "hash")
    store.create_job("quota-1", owner_id, "one.pdf")
    store.update_job("quota-1", status="done")
    store.create_job("quota-2", owner_id, "two.pdf", max_processing=2)
    store.update_job("quota-2", status="done")

    assert store.try_mark_job_processing("quota-1", max_processing=1) is True
    with pytest.raises(store.ProcessingLimitError):
        store.try_mark_job_processing("quota-2", max_processing=1)
    assert store.get_job("quota-2")["status"] == "done"


def test_background_reconcile_api_returns_pending_then_syncs(monkeypatch):
    _owner_id, paper_id, job_id = _paper_with_submission()
    store.replace_questions(job_id, [{**_question(), "student_answer": "A", "status": "correct"}])
    monkeypatch.setattr(workers, "enqueue_explanations", lambda *args, **kwargs: [])

    response = papers_router.patch_question(
        "q1", PaperQuestionPatchRequest(stem="后台同步题干"), paper=store.get_paper(paper_id),
    )

    assert response["regrade_pending"] is True
    assert response["pending_sync"] == 1
    assert response["regraded"] == 1
    assert store.get_job(job_id)["sync_pending"] is True
    run = next(run for run in run_store.list_active_runs() if run["operation"] == "reconcile")
    workers._execute_run_id(run["id"])
    assert store.get_question(job_id, "q1")["stem"] == "后台同步题干"
    assert store.get_job(job_id)["sync_pending"] is False


def test_startup_enqueues_outdated_reconcile():
    _owner_id, paper_id, job_id = _paper_with_submission()
    store.replace_questions(job_id, [{**_question(), "status": "correct"}])
    store.update_paper_question(paper_id, "q1", stem="落后版本")

    REAL_RESUME_PENDING()

    assert any(run["operation"] == "reconcile" for run in run_store.list_active_runs())
    assert store.get_job(job_id)["sync_pending"] is True


def test_bounded_memory_queue_does_not_drop_persistent_runs(monkeypatch):
    owner_id = store.create_user("bounded-owner", "hash")
    pending_queue = queue.Queue(maxsize=1)
    monkeypatch.setattr(workers, "_job_q", pending_queue)
    monkeypatch.setattr(workers, "_last_due_scan", 0.0)
    first, _ = run_store.enqueue_run("paper", "bounded-1", "process", owner_id)
    second, _ = run_store.enqueue_run("paper", "bounded-2", "process", owner_id)

    workers._offer(first["id"])
    workers._offer(second["id"])

    assert pending_queue.qsize() == 1
    assert len(run_store.list_active_runs()) == 2
    assert pending_queue.get() == first["id"]
    claimed = run_store.claim_run(first["id"])
    assert run_store.mark_done(first["id"], claimed["generation"]) is True
    monkeypatch.setattr(workers, "_last_due_scan", 0.0)
    workers._offer_due_runs()
    assert pending_queue.get() == second["id"]


def test_recovered_attempt_cannot_write_stale_submission(monkeypatch):
    owner_id, _paper_id, job_id = _paper_with_submission()
    store.replace_questions(job_id, [{**_question(), "student_answer": "A", "status": "correct"}])
    store.update_job(job_id, status="processing")
    before = store.get_questions(job_id)
    store.save_job_files(job_id, [{"id": "f1", "filename": "one.jpg", "sha256": "sha-one"}])
    monkeypatch.setattr(
        workers.pipeline, "_render_files",
        lambda owner_dir, files, path_of: [(files[0], 0, 1)],
    )
    run, _ = run_store.enqueue_run("job", job_id, "process_submission", owner_id)

    def recover_during_ocr(*args, **kwargs):
        assert run_store.recover_running() == 1
        reclaimed = run_store.claim_run(run["id"])
        assert reclaimed["attempt"] == 2
        return [{"page": 1, "answers": [{"number": "1", "answer": "B", "confidence": "high"}]}]

    monkeypatch.setattr(workers.pipeline, "_vision_file_pages", recover_during_ocr)
    workers._execute_run_id(run["id"])

    assert store.get_questions(job_id) == before
    current = run_store.get_run(run["id"])
    assert current["status"] == "running" and current["attempt"] == 2
    assert store.get_job(job_id)["status"] == "processing"


def test_stop_recovers_unfinished_running_run():
    owner_id = store.create_user("stop-owner", "hash")
    run, _ = run_store.enqueue_run("paper", "stop-paper", "process", owner_id)
    run_store.claim_run(run["id"])

    workers.stop()

    assert run_store.get_run(run["id"])["status"] == "queued"
