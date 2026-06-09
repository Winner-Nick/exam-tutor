"""作业（一次试卷处理）的持久化。每个作业一个目录，状态存 job.json。"""
from __future__ import annotations

import contextlib
import json
import threading
import uuid
from pathlib import Path

from .config import JOBS_DIR

# 单进程、低并发场景：用一把可重入锁保护所有作业读写即可。
_IO = threading.RLock()


def new_job_id() -> str:
    return uuid.uuid4().hex[:12]


def job_dir(job_id: str) -> Path:
    d = JOBS_DIR / job_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _job_file(job_id: str) -> Path:
    return job_dir(job_id) / "job.json"


def save_job(job: dict) -> None:
    with _IO:
        f = _job_file(job["id"])
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(f)


def load_job(job_id: str) -> dict | None:
    with _IO:
        f = _job_file(job_id)
        if not f.exists():
            return None
        return json.loads(f.read_text(encoding="utf-8"))


@contextlib.contextmanager
def editing(job_id: str):
    """读-改-写并发安全：在锁内拿到 job，修改后自动落盘。"""
    with _IO:
        job = load_job(job_id)
        yield job
        if job is not None:
            save_job(job)
