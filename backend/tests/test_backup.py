from __future__ import annotations

import shutil
import sqlite3

import pytest

from backend.app import store
from backend.app.config import DATA_DIR
from backend.app.db import init_db
from backend.scripts.backup_data import create_backup, verify_backup


def test_backup_contains_wal_data_files_and_retains_latest():
    root = DATA_DIR / "test-backups"
    shutil.rmtree(root, ignore_errors=True)
    init_db()
    user_id = store.create_user("backup-user", "hash")
    payload = store.job_dir("backup-job") / "files" / "answer.txt"
    payload.parent.mkdir(parents=True, exist_ok=True)
    payload.write_text("backup-payload", encoding="utf-8")

    created = [create_backup(root, keep=2) for _ in range(3)]
    assert not created[0].exists()
    assert all(path.exists() for path in created[1:])
    assert len(list(root.glob("examtutor-*"))) == 2
    latest = created[-1]
    verify_backup(latest)
    conn = sqlite3.connect(latest / "app.db")
    try:
        assert conn.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()[0] == "backup-user"
    finally:
        conn.close()
    assert (latest / "jobs" / "backup-job" / "files" / "answer.txt").read_text() == "backup-payload"

    payload_in_backup = latest / "jobs" / "backup-job" / "files" / "answer.txt"
    payload_in_backup.write_text("corrupted", encoding="utf-8")
    with pytest.raises(ValueError, match="校验失败"):
        verify_backup(latest)
    shutil.rmtree(root, ignore_errors=True)
