from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import fitz

from app import run_store, security, store


def _pdf_bytes(text: str = "Synthetic idempotency") -> bytes:
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), text)
    data = document.tobytes()
    document.close()
    return data


def _owner_id(client) -> int:
    return client.get("/api/auth/me").json()["id"]


def _post_paper(client, key: str, content: bytes | None = None):
    return client.post(
        "/api/papers", data={"kind": "mixed"},
        files=[("files", ("one.pdf", content or _pdf_bytes(), "application/pdf"))],
        headers={"Idempotency-Key": key},
    )


def _post_submission(client, paper_id: str, student_id: int, key: str):
    return client.post(
        "/api/submissions", data={"paper_id": paper_id, "student_id": str(student_id)},
        files=[("files", ("answer.pdf", _pdf_bytes("Student answer"), "application/pdf"))],
        headers={"Idempotency-Key": key},
    )


def test_concurrent_create_paper_same_key_and_response_retry(admin_client, monkeypatch):
    owner_id = _owner_id(admin_client)
    calls = []
    original = security.save_upload

    async def counted(*args, **kwargs):
        calls.append(args[1])
        return await original(*args, **kwargs)

    monkeypatch.setattr(security, "save_upload", counted)
    key = "paper-concurrent-key"
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: _post_paper(admin_client, key), range(2)))

    assert [response.status_code for response in responses] == [201, 201]
    paper_id = responses[0].json()["paper_id"]
    assert responses[1].json() == {"paper_id": paper_id}
    assert len(store.list_papers(owner_id)) == 1
    assert len(store.list_paper_files(paper_id)) == 1
    assert len(calls) == 1
    assert len(run_store.list_active_runs()) == 1

    retried = _post_paper(admin_client, key)
    assert retried.status_code == 201
    assert retried.json() == {"paper_id": paper_id}
    assert len(store.list_paper_files(paper_id)) == 1
    assert len(calls) == 1
    assert len(run_store.list_active_runs()) == 1


def test_concurrent_create_submission_same_key_and_lost_run_retry(admin_client, monkeypatch):
    owner_id = _owner_id(admin_client)
    paper_id = "idem-submission-paper"
    store.create_paper(paper_id, owner_id, "幂等提交")
    store.replace_paper_questions(paper_id, [{
        "id": "q_stable", "number": "1", "type": "single_choice",
        "options": {"A": "甲", "B": "乙"}, "correct_answer": "A",
    }])
    store.update_paper(paper_id, status="ready", stage="done")
    student = store.create_student(owner_id, "学生")
    calls = []
    original = security.save_upload

    async def counted(*args, **kwargs):
        calls.append(args[1])
        return await original(*args, **kwargs)

    monkeypatch.setattr(security, "save_upload", counted)
    key = "submission-concurrent-key"
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(
            lambda _: _post_submission(admin_client, paper_id, student["id"], key), range(2),
        ))

    assert [response.status_code for response in responses] == [201, 201]
    job_id = responses[0].json()["job_id"]
    assert responses[1].json() == {"job_id": job_id}
    assert len(store.list_jobs(owner_id)) == 1
    assert len(store.job_files(job_id)) == 1
    assert len(calls) == 1
    assert len(run_store.list_active_runs()) == 1

    with run_store.transaction():
        run_store.get_conn().execute("DELETE FROM task_runs")
        run_store.get_conn().execute(
            "UPDATE idempotency_keys SET status = 'files_ready' WHERE operation = 'create_submission'"
        )
    retried = _post_submission(admin_client, paper_id, student["id"], key)
    assert retried.status_code == 201
    assert retried.json() == {"job_id": job_id}
    assert len(store.job_files(job_id)) == 1
    assert len(calls) == 1
    assert len(run_store.list_active_runs()) == 1


def test_failed_creation_can_retry_same_key(admin_client):
    owner_id = _owner_id(admin_client)
    key = "retry-after-failure"
    failed = _post_paper(admin_client, key, b"not-a-pdf")
    assert failed.status_code == 400
    assert run_store.get_idempotency(owner_id, "create_paper", key)["status"] == "failed"

    created = _post_paper(admin_client, key)

    assert created.status_code == 201
    paper_id = created.json()["paper_id"]
    assert len(store.list_papers(owner_id)) == 1
    assert len(store.list_paper_files(paper_id)) == 1
    assert run_store.get_idempotency(owner_id, "create_paper", key)["status"] == "created"


def test_idempotency_key_length_is_enforced_before_upload(admin_client):
    response = _post_paper(admin_client, "x" * 129)
    assert response.status_code == 422
    assert store.list_papers(_owner_id(admin_client)) == []
