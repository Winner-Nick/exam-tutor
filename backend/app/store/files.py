from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path

from ..config import JOBS_DIR, PAPERS_DIR, VISION_CACHE_DIR, VISION_CACHE_VERSION
from .common import write_json_atomic

def new_job_id() -> str:
    return uuid.uuid4().hex[:12]


def new_question_id() -> str:
    return "q_" + uuid.uuid4().hex


def job_dir(job_id: str) -> Path:
    d = JOBS_DIR / job_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def pdf_path(job_id: str) -> Path:
    return job_dir(job_id) / "source.pdf"


def paper_dir(paper_id: str) -> Path:
    d = PAPERS_DIR / paper_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def vision_cache_path(sha256: str, mode: str) -> Path:
    """视觉缓存同时绑定模型与提取协议，升级后不会命中旧模型结果。"""
    return VISION_CACHE_DIR / f"{sha256}.{mode}.{VISION_CACHE_VERSION}.json"


def paper_file_path(paper_id: str, file_id: str) -> Path | None:
    for p in (paper_dir(paper_id) / "files").glob(f"{file_id}.*"):
        return p
    return None


def job_file_path(job_id: str, file_id: str) -> Path | None:
    for p in (job_dir(job_id) / "files").glob(f"{file_id}.*"):
        return p
    return None


def job_files(job_id: str) -> list[dict]:
    """作答提交的文件清单（files.json）。legacy 作业没有清单，返回 []。"""
    p = job_dir(job_id) / "files.json"
    if not p.exists():
        return []
    return json.loads(p.read_text(encoding="utf-8"))


def save_job_files(job_id: str, files: list[dict]) -> None:
    write_json_atomic(job_dir(job_id) / "files.json", files, indent=2)
def cleanup_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)


def cleanup_answer_cache(paper_id: str, sha256: str) -> None:
    from .papers import list_submission_ids_for_paper
    for other_id in list_submission_ids_for_paper(paper_id):
        if any(item.get("sha256") == sha256 for item in job_files(other_id)):
            return
    legacy = vision_cache_path(sha256, f"ans-{paper_id}")
    legacy.unlink(missing_ok=True)
    for path in legacy.parent.glob(f"{sha256}.ans-{paper_id}-r*"):
        if path.is_file():
            path.unlink()
