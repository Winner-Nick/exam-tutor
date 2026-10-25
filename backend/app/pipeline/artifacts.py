from __future__ import annotations

import inspect
import json
import os
import threading
import uuid
import weakref

from .. import pdf_utils, store
from .identity import _normalize_full_page

def _render_files(owner_dir, files: list[dict], path_of) -> list[tuple[dict, int, int]]:
    """在 staging 完成全部渲染后切换正式 pages，失败保留上一份。"""
    pages_dir = owner_dir / "pages"
    token = uuid.uuid4().hex[:12]
    staging = owner_dir / f"pages.staging-{token}"
    backup = owner_dir / f"pages.backup-{token}"
    plans: list[tuple[dict, int, int]] = []
    page_no = 0
    try:
        for f in files:
            fpath = path_of(f["id"])
            if fpath is None or not fpath.is_file():
                raise FileNotFoundError(f"清单源文件缺失: {f.get('filename') or f['id']}")
            if fpath.suffix.lower() == ".pdf":
                n = len(pdf_utils.render_pdf_to_images(fpath, staging, start_index=page_no))
            else:
                pdf_utils.photo_to_page(fpath, staging, page_no + 1)
                n = 1
            plans.append((f, page_no, n))
            page_no += n
            from ..config import settings
            if page_no > settings.max_pages:
                raise ValueError(f"累计 {page_no} 页，超过每次任务 {settings.max_pages} 页上限；请减少文件后重试")
        if pages_dir.exists():
            os.replace(pages_dir, backup)
        try:
            os.replace(staging, pages_dir)
        except Exception:
            if backup.exists() and not pages_dir.exists():
                os.replace(backup, pages_dir)
            raise
        if backup.exists():
            store.cleanup_path(backup)
        return plans
    except Exception:
        if staging.exists():
            store.cleanup_path(staging)
        if backup.exists() and not pages_dir.exists():
            os.replace(backup, pages_dir)
        raise


# 视觉缓存按 (sha, mode) 加进程内锁：两个 worker 处理含相同文件的不同提交时，
# 串行化读-判-算-写，既防并发写坏缓存，也省双倍 LLM 费用
_cache_locks: weakref.WeakValueDictionary[str, threading.Lock] = weakref.WeakValueDictionary()
_cache_locks_guard = threading.Lock()


def _cache_lock_for(key: str) -> threading.Lock:
    with _cache_locks_guard:
        lock = _cache_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _cache_locks[key] = lock
        return lock


def _is_blank_entry(p: dict) -> bool:
    return bool(p.get("blank")) or "blank" in (p.get("page_role") or [])


def _supports_on_page(vision_call) -> bool:
    try:
        parameters = inspect.signature(vision_call).parameters.values()
    except (TypeError, ValueError):
        return False
    return any(
        parameter.name == "on_page" or parameter.kind == inspect.Parameter.VAR_KEYWORD
        for parameter in parameters
    )


def _vision_file_pages(pages_dir, start: int, n: int, sha256: str | None,
                       mode: str, vision_call, blank_result,
                       force: bool = False) -> list[dict]:
    """识别局部 1..n 页；每页完成即写缓存检查点，force 仅跳过读取。"""
    cache = store.vision_cache_path(sha256, mode) if sha256 else None
    lock = _cache_lock_for(f"{sha256}:{mode}") if sha256 else threading.Lock()
    expected = set(range(1, n + 1))
    with lock:
        by_idx: dict[int, dict] = {}
        previous_by_idx: dict[int, dict] = {}
        if cache and cache.exists():
            try:
                cached = json.loads(cache.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                cached = None
            if isinstance(cached, list):
                if force:
                    for raw_page in cached:
                        if not isinstance(raw_page, dict) or type(raw_page.get("page")) is not int:
                            continue
                        if raw_page["page"] in expected and not raw_page.get("error"):
                            previous_by_idx[raw_page["page"]] = (
                                _normalize_full_page(raw_page) if mode == "full" else raw_page
                            )
                else:
                    duplicates: set[int] = set()
                    for raw_page in cached:
                        if not isinstance(raw_page, dict) or type(raw_page.get("page")) is not int:
                            continue
                        p = _normalize_full_page(raw_page) if mode == "full" else raw_page
                        page = p["page"]
                        if page not in expected:
                            continue
                        if page in by_idx:
                            duplicates.add(page)
                        else:
                            by_idx[page] = p
                    for page in duplicates:
                        del by_idx[page]
                    stale = set()
                    for page, p in by_idx.items():
                        img = pages_dir / f"page_{start + page:02d}.jpg"
                        if p.get("error") or (
                                _is_blank_entry(p) and img.exists()
                                and not pdf_utils.is_blank_page(img)):
                            stale.add(page)
                    for page in stale:
                        del by_idx[page]
                    if expected <= set(by_idx):
                        return [by_idx[i] for i in range(1, n + 1)]

        def checkpoint() -> None:
            if not cache:
                return
            cached_pages_by_idx = dict(previous_by_idx)
            for page, result in by_idx.items():
                if result.get("error"):
                    continue
                if mode == "full":
                    result = _normalize_full_page(result)
                    result.pop("answer_key", None)
                    by_idx[page] = result
                cached_pages_by_idx[page] = result
            if cached_pages_by_idx:
                store.write_json_atomic(
                    cache, [cached_pages_by_idx[page] for page in sorted(cached_pages_by_idx)],
                )

        payload = []
        for li in range(1, n + 1):
            if li in by_idx:
                continue
            img = pages_dir / f"page_{start + li:02d}.jpg"
            if pdf_utils.is_blank_page(img):
                result = blank_result(li)
                result["page"] = li
                result["blank"] = True
                by_idx[li] = result
            else:
                payload.append((li, pdf_utils.image_to_data_url(img)))
        checkpoint()
        requested = {li for li, _ in payload}
        reported: set[int] = set()

        def accept_result(result: dict) -> None:
            if not isinstance(result, dict) or type(result.get("page")) is not int:
                return
            page = result["page"]
            if page not in requested or page in reported:
                return
            by_idx[page] = result
            reported.add(page)
            checkpoint()

        if payload:
            if _supports_on_page(vision_call):
                returned = vision_call(payload, on_page=accept_result)
            else:
                returned = vision_call(payload)
            for result in returned:
                accept_result(result)
        for li in expected - set(by_idx):
            by_idx[li] = {
                "page": li, "error": "视觉识别未返回该页结果", "raw_text": "",
                "questions": [], "answer_occurrences": [], "answers": [],
            }
        results = [by_idx[i] for i in range(1, n + 1)]
        if mode == "full":
            normalized_results = []
            for result in results:
                normalized = _normalize_full_page(result)
                normalized.pop("answer_key", None)
                normalized_results.append(normalized)
            results = normalized_results
        checkpoint()
        return results
