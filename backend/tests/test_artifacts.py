from __future__ import annotations

import json
import sqlite3

import pytest

from app import db, pdf_utils, pipeline, run_store, store, workers
from app.routers import papers as papers_router


def test_render_failure_preserves_previous_pages_and_success_swaps(tmp_path, monkeypatch):
    owner = tmp_path / "owner"
    pages = owner / "pages"
    pages.mkdir(parents=True)
    (pages / "page_01.jpg").write_bytes(b"old")
    source_a = tmp_path / "a.jpg"
    source_b = tmp_path / "b.jpg"
    source_a.write_bytes(b"a")
    source_b.write_bytes(b"b")
    sources = {"a": source_a, "b": source_b}

    def render(source, output, index):
        output.mkdir(parents=True, exist_ok=True)
        (output / f"page_{index:02d}.jpg").write_bytes(b"new")
        if source == source_b:
            raise RuntimeError("injected render failure")

    monkeypatch.setattr(pdf_utils, "photo_to_page", render)
    with pytest.raises(RuntimeError, match="injected render failure"):
        pipeline._render_files(owner, [{"id": "a"}, {"id": "b"}], sources.get)

    assert (pages / "page_01.jpg").read_bytes() == b"old"
    plans = pipeline._render_files(owner, [{"id": "a"}], sources.get)
    assert len(plans) == 1
    assert (pages / "page_01.jpg").read_bytes() == b"new"


def test_page_checkpoint_survives_crash_and_retries_only_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(pdf_utils, "is_blank_page", lambda path: False)
    monkeypatch.setattr(pdf_utils, "image_to_data_url", lambda path: "data")
    cache = store.vision_cache_path("checkpoint-sha", "ans-checkpoint")

    def crash_after_first(payload, on_page=None):
        on_page({"page": 1, "answers": [{"number": "1", "answer": "A"}]})
        raise RuntimeError("injected worker crash")

    with pytest.raises(RuntimeError, match="injected worker crash"):
        pipeline._vision_file_pages(
            tmp_path, 0, 2, "checkpoint-sha", "ans-checkpoint", crash_after_first,
            lambda page: {"page": page, "answers": []},
        )

    cached = json.loads(cache.read_text(encoding="utf-8"))
    assert [item["page"] for item in cached] == [1]
    payloads = []

    def finish_second(payload, on_page=None):
        payloads.append([page for page, _ in payload])
        on_page({"page": 2, "answers": [{"number": "2", "answer": "B"}]})
        return []

    results = pipeline._vision_file_pages(
        tmp_path, 0, 2, "checkpoint-sha", "ans-checkpoint", finish_second,
        lambda page: {"page": page, "answers": []},
    )
    assert payloads == [[2]]
    assert [item["page"] for item in results] == [1, 2]
    assert [item["page"] for item in json.loads(cache.read_text(encoding="utf-8"))] == [1, 2]


def test_force_bypasses_complete_cache_and_replaces_it(tmp_path, monkeypatch):
    monkeypatch.setattr(pdf_utils, "is_blank_page", lambda path: False)
    monkeypatch.setattr(pdf_utils, "image_to_data_url", lambda path: "data")
    cache = store.vision_cache_path("force-sha", "ans-force")
    store.write_json_atomic(cache, [{"page": 1, "answers": [{"number": "1", "answer": "OLD"}]}])
    calls = []

    def refreshed(payload, on_page=None):
        calls.append([page for page, _ in payload])
        on_page({"page": 1, "answers": [{"number": "1", "answer": "NEW"}]})
        return []

    result = pipeline._vision_file_pages(
        tmp_path, 0, 1, "force-sha", "ans-force", refreshed,
        lambda page: {"page": page, "answers": []}, force=True,
    )
    assert result[0]["answers"][0]["answer"] == "NEW"
    assert calls == [[1]]
    cached = json.loads(cache.read_text(encoding="utf-8"))
    assert cached[0]["answers"][0]["answer"] == "NEW"

    pipeline._vision_file_pages(
        tmp_path, 0, 1, "force-sha", "ans-force", refreshed,
        lambda page: {"page": page, "answers": []},
    )
    assert calls == [[1]]


def test_force_checkpoint_preserves_previous_paid_pages(tmp_path, monkeypatch):
    monkeypatch.setattr(pdf_utils, "is_blank_page", lambda path: False)
    monkeypatch.setattr(pdf_utils, "image_to_data_url", lambda path: "data")
    cache = store.vision_cache_path("force-crash-sha", "ans-force-crash")
    store.write_json_atomic(cache, [
        {"page": 1, "answers": [{"number": "1", "answer": "OLD-1"}]},
        {"page": 2, "answers": [{"number": "2", "answer": "OLD-2"}]},
    ])

    def crash(payload, on_page=None):
        on_page({"page": 1, "answers": [{"number": "1", "answer": "NEW-1"}]})
        raise RuntimeError("force crash")

    with pytest.raises(RuntimeError, match="force crash"):
        pipeline._vision_file_pages(
            tmp_path, 0, 2, "force-crash-sha", "ans-force-crash", crash,
            lambda page: {"page": page, "answers": []}, force=True,
        )

    cached = json.loads(cache.read_text(encoding="utf-8"))
    assert [item["page"] for item in cached] == [1, 2]
    assert cached[0]["answers"][0]["answer"] == "NEW-1"
    assert cached[1]["answers"][0]["answer"] == "OLD-2"


def test_reprocess_persists_force_option(monkeypatch):
    owner_id = store.create_user("force-owner", "hash")
    store.create_paper("force-paper", owner_id, "force")
    file_id = store.add_paper_file("force-paper", "mixed", "paper.jpg", "sha")
    path = store.paper_dir("force-paper") / "files" / f"{file_id}.jpg"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"source")
    store.update_paper("force-paper", status="ready")
    captured = {}
    monkeypatch.setattr(workers, "enqueue_paper", lambda paper_id, force=False: captured.update(force=force))

    papers_router.reprocess_paper(store.get_paper("force-paper"))

    assert captured["force"] is True


def _insert_after_count(store_module, marker: str, insert_sql: str):
    original = store_module.get_conn()
    state = {"inserted": False}

    def insert() -> None:
        if state["inserted"]:
            return
        state["inserted"] = True
        conn = sqlite3.connect(db.DB_PATH)
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute(insert_sql)
        conn.commit()
        conn.close()

    class CursorWrapper:
        def __init__(self, cursor):
            self.cursor = cursor

        def __getattr__(self, name):
            return getattr(self.cursor, name)

        def fetchone(self):
            row = self.cursor.fetchone()
            insert()
            return row

    class ConnectionWrapper:
        def __getattr__(self, name):
            return getattr(original, name)

        def execute(self, sql, parameters=()):
            cursor = original.execute(sql, parameters)
            if "COUNT(*)" in sql and marker in sql:
                return CursorWrapper(cursor)
            return cursor

    return ConnectionWrapper()


def test_jobs_count_and_page_share_snapshot(monkeypatch):
    owner_id = store.create_user("snapshot-jobs", "hash")
    store.create_job("old-job", owner_id, "old.pdf", created_at=1)
    wrapper = _insert_after_count(
        store, "jobs j",
        "INSERT INTO jobs (id, user_id, status, created_at, kind) "
        "VALUES ('new-job', 1, 'done', 999, 'legacy')",
    )
    monkeypatch.setattr(store, "get_conn", lambda: wrapper)

    jobs, total = store.list_jobs_page(owner_id, limit=20, offset=0)

    assert total == 1
    assert [job["id"] for job in jobs] == ["old-job"]


def test_papers_count_and_page_share_snapshot(monkeypatch):
    owner_id = store.create_user("snapshot-papers", "hash")
    store.create_paper("old-paper", owner_id, "old")
    wrapper = _insert_after_count(
        store, "papers p",
        "INSERT INTO papers (id, user_id, status, created_at) VALUES ('new-paper', 1, 'ready', 999)",
    )
    monkeypatch.setattr(store, "get_conn", lambda: wrapper)

    papers, total = store.list_papers_page(owner_id, limit=20, offset=0)

    assert total == 1
    assert [paper["id"] for paper in papers] == ["old-paper"]


def test_ready_reports_run_counts(client):
    owner_id = store.create_user("health-owner", "hash")
    run, _ = run_store.enqueue_run("paper", "health-paper", "process", owner_id)
    run_store.claim_run(run["id"])
    waiting, _ = run_store.enqueue_run("paper", "health-waiting", "process", owner_id)
    run_store.claim_run(waiting["id"])
    run_store.mark_retry(waiting["id"], waiting["generation"], "waiting", 2)

    response = client.get("/api/health/ready")

    assert response.status_code == 200
    payload = response.json()
    assert payload["version"]
    assert payload["database"] == "ok"
    assert payload["runs"] == {"queued": 0, "running": 1, "waiting": 1}
