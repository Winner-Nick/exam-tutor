from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

import dotenv
import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
TEST_TMP_ROOT = BACKEND_DIR.parent / "data" / "pytest-runtime"
TEST_TMP_ROOT.mkdir(parents=True, exist_ok=True)
TEST_DATA_DIR = Path(tempfile.mkdtemp(prefix="examtutor-pytest-", dir=TEST_TMP_ROOT)).resolve()

sys.path.insert(0, str(BACKEND_DIR))
dotenv.load_dotenv = lambda *args, **kwargs: False
os.environ.update({
    "EXAMTUTOR_DATA_DIR": str(TEST_DATA_DIR),
    "EXAMTUTOR_HOST": "127.0.0.1",
    "EXAMTUTOR_PORT": "8080",
    "DEEPSEEK_API_KEY": "test-deepseek-key",
    "DEEPSEEK_BASE_URL": "http://127.0.0.1:9",
    "JWT_SECRET": "test-only-jwt-secret-not-for-production",
    "ALLOW_OPEN_REGISTER": "0",
    "COOKIE_SECURE": "0",
})

from fastapi.testclient import TestClient

from app import config, db, llm, security, store, workers
from app.main import app


def _assert_isolated_data_dir() -> None:
    assert config.DATA_DIR.resolve() == TEST_DATA_DIR
    assert db.DB_PATH.resolve() == TEST_DATA_DIR / "app.db"
    for path in (store.JOBS_DIR, store.PAPERS_DIR, store.VISION_CACHE_DIR):
        assert path.resolve().is_relative_to(TEST_DATA_DIR)


def _reset_state() -> None:
    _assert_isolated_data_dir()
    db.init_db()
    conn = db.get_conn()
    if conn.in_transaction:
        conn.rollback()
    tables = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    conn.execute("PRAGMA foreign_keys=OFF")
    try:
        for table in tables:
            name = table[0].replace('"', '""')
            conn.execute(f'DELETE FROM "{name}"')
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.execute("PRAGMA foreign_keys=ON")

    for directory in (store.JOBS_DIR, store.PAPERS_DIR, store.VISION_CACHE_DIR):
        shutil.rmtree(directory, ignore_errors=True)
        directory.mkdir(parents=True, exist_ok=True)
    with security._buckets_lock:
        security._buckets.clear()


@pytest.fixture(autouse=True)
def isolated_state(monkeypatch):
    _reset_state()

    def reject_llm_call(*args, **kwargs):
        raise AssertionError("Tests must not call external LLM services")

    for name in ("vision_extract_page", "vision_extract_pages", "deepseek_json", "deepseek_chat"):
        monkeypatch.setattr(llm, name, reject_llm_call)
    monkeypatch.setattr(workers, "start", lambda: None)
    monkeypatch.setattr(workers, "resume_pending", lambda: None)
    yield
    _reset_state()


@pytest.fixture
def client(isolated_state):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def admin_credentials() -> dict[str, str]:
    return {"username": "test-admin", "password": "test-password-123"}


@pytest.fixture
def admin_client(client, admin_credentials):
    response = client.post("/api/auth/register", json=admin_credentials)
    assert response.status_code == 200, response.text
    return client


def pytest_sessionfinish(session, exitstatus):
    conn = getattr(db._local, "conn", None)
    if conn is not None:
        conn.close()
        del db._local.conn
    shutil.rmtree(TEST_DATA_DIR, ignore_errors=True)
