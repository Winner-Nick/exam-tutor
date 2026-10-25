from __future__ import annotations

import asyncio
import os
from pathlib import Path

import fitz
import pytest
from fastapi import HTTPException

from app import run_store, store, upload_utils, workers
from app.models import OverrideRequest
from app.routers import jobs as jobs_router
from app.routers import papers as papers_router
from app.routers import questions as questions_router


def _pdf_bytes(text: str = "Synthetic upload") -> bytes:
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), text)
    data = document.tobytes()
    document.close()
    return data


def _ready_paper_with_student(owner_id: int) -> tuple[str, dict]:
    paper_id = "upload-paper"
    store.create_paper(paper_id, owner_id, "上传测试")
    store.replace_paper_questions(paper_id, [{
        "id": "q_stable", "number": "1", "type": "single_choice",
        "options": {"A": "甲", "B": "乙"}, "correct_answer": "A",
    }])
    store.update_paper(paper_id, status="ready", stage="done")
    return paper_id, store.create_student(owner_id, "学生")


def _add_paper_source(paper_id: str, index: int, size: int = 20) -> str:
    file_id = store.add_paper_file(paper_id, "mixed", f"source-{index}.jpg", f"sha-{index}")
    path = store.paper_dir(paper_id) / "files" / f"{file_id}.jpg"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)
    store.update_paper_file(file_id, 1, 1)
    return file_id


def test_link_or_copy_prefers_hardlink_and_falls_back(tmp_path, monkeypatch):
    source = tmp_path / "source.bin"
    source.write_bytes(b"payload")
    linked = tmp_path / "linked.bin"

    asyncio.run(upload_utils.link_or_copy(source, linked))
    assert os.stat(source).st_ino == os.stat(linked).st_ino

    original_copy = upload_utils.shutil.copy2
    calls = []

    def cross_device(*args):
        raise OSError("cross device")

    def copied(*args):
        calls.append(args)
        return original_copy(*args)

    monkeypatch.setattr(upload_utils.os, "link", cross_device)
    monkeypatch.setattr(upload_utils.shutil, "copy2", copied)
    destination = tmp_path / "copied.bin"
    asyncio.run(upload_utils.link_or_copy(source, destination))
    assert destination.read_bytes() == b"payload"
    assert len(calls) == 1


def test_reuse_rejects_more_than_twelve_files(admin_client):
    owner_id = admin_client.get("/api/auth/me").json()["id"]
    paper_id, student = _ready_paper_with_student(owner_id)
    for index in range(13):
        _add_paper_source(paper_id, index)

    response = admin_client.post("/api/submissions", data={
        "paper_id": paper_id, "student_id": str(student["id"]), "use_paper_files": "true",
    })

    assert response.status_code == 400
    assert store.list_jobs(owner_id) == []


def test_reuse_enforces_total_byte_budget(admin_client, monkeypatch):
    owner_id = admin_client.get("/api/auth/me").json()["id"]
    paper_id, student = _ready_paper_with_student(owner_id)
    _add_paper_source(paper_id, 1, size=32)
    monkeypatch.setattr(upload_utils, "TOTAL_UPLOAD_BYTES", 8)

    response = admin_client.post("/api/submissions", data={
        "paper_id": paper_id, "student_id": str(student["id"]), "use_paper_files": "true",
    })

    assert response.status_code == 413
    assert store.list_jobs(owner_id) == []


def test_reuse_missing_source_is_explicit(admin_client):
    owner_id = admin_client.get("/api/auth/me").json()["id"]
    paper_id, student = _ready_paper_with_student(owner_id)
    file_id = _add_paper_source(paper_id, 1)
    store.paper_file_path(paper_id, file_id).unlink()

    response = admin_client.post("/api/submissions", data={
        "paper_id": paper_id, "student_id": str(student["id"]), "use_paper_files": "true",
    })

    assert response.status_code == 400
    assert "缺失" in response.text
    assert store.list_jobs(owner_id) == []


def test_add_files_enforces_total_count_before_writing(admin_client):
    owner_id = admin_client.get("/api/auth/me").json()["id"]
    paper_id, student = _ready_paper_with_student(owner_id)
    job_id = "upload-limit-job"
    store.create_job(
        job_id, owner_id, "answers.pdf", kind="submission",
        paper_id=paper_id, student_id=student["id"],
    )
    store.update_job(job_id, status="done")
    manifest = [{"id": f"f{index}", "filename": f"{index}.jpg", "sha256": f"sha-{index}"}
                for index in range(12)]
    store.save_job_files(job_id, manifest)

    response = admin_client.post(
        f"/api/jobs/{job_id}/files",
        files=[("files", ("new.pdf", _pdf_bytes(), "application/pdf"))],
    )

    assert response.status_code == 400
    assert len(store.job_files(job_id)) == 12
    assert run_store.list_active_runs() == []


def test_delete_file_and_retry_do_not_enqueue_when_placeholder_fails(monkeypatch):
    owner_id = store.create_user("race-owner", "hash")
    store.create_job("race-job", owner_id, "answers.pdf")
    store.update_job("race-job", status="done")
    store.pdf_path("race-job").write_bytes(b"%PDF-1.4")
    manifest = [{"id": "f1", "filename": "1.jpg"}, {"id": "f2", "filename": "2.jpg"}]
    store.save_job_files("race-job", manifest)
    monkeypatch.setattr(store, "try_mark_job_processing", lambda *args, **kwargs: False)
    enqueued = []
    monkeypatch.setattr(workers, "enqueue_job", lambda job_id: enqueued.append(job_id))
    job = store.get_job("race-job")

    with pytest.raises(HTTPException) as delete_error:
        jobs_router.delete_submission_file("f1", job=job, user={"role": "user"})
    with pytest.raises(HTTPException) as retry_error:
        jobs_router.retry_job(job)

    assert delete_error.value.status_code == 409
    assert retry_error.value.status_code == 409
    assert store.job_files("race-job") == manifest
    assert enqueued == []


def test_record_delete_uses_conditional_delete_and_tracked_cleanup():
    owner_id = store.create_user("cleanup-owner", "hash")
    job_id = "cleanup-job"
    store.create_job(job_id, owner_id, "answers.pdf")
    store.update_job(job_id, status="done")
    store.save_job_files(job_id, [{"id": "f1", "filename": "1.jpg", "sha256": "sha-1"}])
    directory = store.job_dir(job_id)
    (directory / "files").mkdir(parents=True, exist_ok=True)
    (directory / "files" / "f1.jpg").write_bytes(b"file")

    jobs_router.delete_job(store.get_job(job_id), user={"role": "user"})

    assert store.get_job(job_id) is None
    run = next(run for run in run_store.list_active_runs() if run["operation"] == "cleanup")
    workers._execute_run_id(run["id"])
    assert not directory.exists()
    assert run_store.get_run(run["id"])["status"] == "done"


def test_cleanup_failure_waits_and_retries(monkeypatch):
    owner_id = store.create_user("cleanup-retry-owner", "hash")
    run, _ = run_store.enqueue_run("job", "cleanup-retry", "cleanup", owner_id)
    original = store.cleanup_path
    calls = []

    def fail_once(path):
        calls.append(path)
        if len(calls) == 1:
            raise OSError("temporary")
        return original(path)

    monkeypatch.setattr(store, "cleanup_path", fail_once)
    workers._execute_run_id(run["id"])
    assert run_store.get_run(run["id"])["status"] == "waiting"
    with run_store.transaction():
        run_store.get_conn().execute("UPDATE task_runs SET available_at = 0 WHERE id = ?", (run["id"],))
    workers._execute_run_id(run["id"])
    assert run_store.get_run(run["id"])["status"] == "done"


def test_sse_routes_use_live_snapshot_factories(monkeypatch):
    owner_id = store.create_user("snapshot-owner", "hash")
    store.create_job("snapshot-job", owner_id, "answers.pdf")
    store.create_paper("snapshot-paper", owner_id, "old title")
    captured = {}

    def capture(resource_id, snapshot):
        captured[resource_id] = snapshot
        return snapshot

    monkeypatch.setattr(jobs_router.events, "sse_stream", capture)
    monkeypatch.setattr(papers_router.events, "sse_stream", capture)
    jobs_router.job_events(store.get_job("snapshot-job"))
    papers_router.paper_events(store.get_paper("snapshot-paper"))
    store.update_job("snapshot-job", title="new job title")
    store.update_paper("snapshot-paper", title="new paper title")

    assert callable(captured["snapshot-job"])
    assert callable(captured["snapshot-paper"])
    assert captured["snapshot-job"]()["title"] == "new job title"
    assert captured["snapshot-paper"]()["title"] == "new paper title"


def test_override_and_stats_roll_back_together(monkeypatch):
    owner_id = store.create_user("override-owner", "hash")
    store.create_job("override-job", owner_id, "answers.pdf")
    store.update_job("override-job", status="done")
    store.replace_questions("override-job", [{
        "id": "q1", "number": "1", "status": "correct", "student_answer": "A",
        "correct_answer": "A",
    }])
    store.refresh_stats("override-job")

    def fail_stats(job_id):
        raise RuntimeError("injected stats failure")

    monkeypatch.setattr(questions_router.store, "refresh_stats", fail_stats)
    with pytest.raises(RuntimeError, match="injected stats failure"):
        questions_router.override_answer(
            "q1", OverrideRequest(status="wrong"),
            job=store.get_job("override-job"), user={"role": "user"},
        )

    assert store.get_question("override-job", "q1")["status"] == "correct"
    assert store.get_job("override-job")["stats"]["correct"] == 1
