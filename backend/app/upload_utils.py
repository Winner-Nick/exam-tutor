"""上传文件预算与同文件系统复用工具。"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from . import pdf_utils
from .config import settings

TOTAL_UPLOAD_BYTES = 120 * 1024 * 1024


def check_file_budget(file_count: int, total_bytes: int, total_pages: int,
                      *, max_files: int) -> None:
    if file_count > max_files:
        raise HTTPException(400, f"文件总数不能超过 {max_files} 个")
    if total_pages > settings.max_pages:
        raise HTTPException(400, f"累计页数不能超过 {settings.max_pages} 页")
    if total_bytes > TOTAL_UPLOAD_BYTES:
        raise HTTPException(413, "累计上传文件不能超过 120MB")


def inspect_source(path: Path, known_pages: int | None = None) -> tuple[int, int]:
    if not path.is_file():
        raise HTTPException(400, f"复用的源文件缺失: {path.name}")
    size = path.stat().st_size
    pages = known_pages or (pdf_utils.page_count(path) if path.suffix.lower() == ".pdf" else 1)
    if pages < 1:
        raise HTTPException(400, f"源文件没有可用页面: {path.name}")
    return size, pages


async def inspect_source_async(path: Path, known_pages: int | None = None) -> tuple[int, int]:
    return await run_in_threadpool(inspect_source, path, known_pages)


def _link_or_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, destination)
    except OSError:
        shutil.copy2(source, destination)


async def link_or_copy(source: Path, destination: Path) -> None:
    await run_in_threadpool(_link_or_copy, source, destination)
