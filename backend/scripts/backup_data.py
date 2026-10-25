"""创建并校验 ExamTutor 数据备份；SQLite 使用在线 backup API。"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
import tempfile
import time
import uuid
from pathlib import Path

from backend.app import __version__
from backend.app.config import DATA_DIR, JOBS_DIR, PAPERS_DIR, VISION_CACHE_DIR
from backend.app.db import DB_PATH, get_conn, init_db


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def _entry(root: Path, path: Path) -> dict:
    return {
        "path": path.relative_to(root).as_posix(),
        "size": path.stat().st_size,
        "sha256": _sha256(path),
    }


def verify_backup(path: Path) -> None:
    path = path.resolve()
    manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("format") != 1:
        raise ValueError("不支持的备份格式")
    for item in manifest["files"]:
        target = (path / item["path"]).resolve()
        if not target.is_relative_to(path) or not target.is_file():
            raise ValueError(f"备份文件缺失：{item['path']}")
        if target.stat().st_size != item["size"] or _sha256(target) != item["sha256"]:
            raise ValueError(f"备份文件校验失败：{item['path']}")
    conn = sqlite3.connect(f"file:{path / 'app.db'}?mode=ro", uri=True)
    try:
        result = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if result != "ok":
            raise ValueError(f"SQLite 完整性检查失败：{result}")
    finally:
        conn.close()


def create_backup(output_root: Path, keep: int = 7, include_cache: bool = True) -> Path:
    init_db()
    output_root.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".tmp-examtutor-", dir=output_root))
    final = output_root / f"examtutor-{time.strftime('%Y%m%d-%H%M%S')}-{time.time_ns()}-{uuid.uuid4().hex[:6]}"
    try:
        target = sqlite3.connect(staging / "app.db")
        try:
            get_conn().backup(target)
        finally:
            target.close()
        sources = [(JOBS_DIR, "jobs"), (PAPERS_DIR, "papers")]
        if include_cache:
            sources.append((VISION_CACHE_DIR, "vision_cache"))
        for source, name in sources:
            if source.exists():
                shutil.copytree(source, staging / name)
        files = [_entry(staging, path) for path in staging.rglob("*") if path.is_file()]
        manifest = {
            "format": 1,
            "app_version": __version__,
            "created_at": time.time(),
            "source_db": DB_PATH.name,
            "files": sorted(files, key=lambda item: item["path"]),
        }
        (staging / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8",
        )
        verify_backup(staging)
        staging.replace(final)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise

    backups = sorted(
        (path for path in output_root.iterdir() if path.is_dir() and path.name.startswith("examtutor-")),
        key=lambda path: path.name,
        reverse=True,
    )
    for old in backups[max(1, keep):]:
        shutil.rmtree(old)
    return final


def main() -> None:
    parser = argparse.ArgumentParser(description="备份或校验 ExamTutor 数据")
    parser.add_argument("--verify", type=Path, help="校验已有备份目录")
    parser.add_argument("--output-dir", type=Path, default=DATA_DIR / "backups")
    parser.add_argument("--keep", type=int, default=7, help="保留最近 N 份，至少 1 份")
    parser.add_argument("--skip-cache", action="store_true", help="不备份可重新生成的视觉缓存")
    args = parser.parse_args()
    if args.verify:
        verify_backup(args.verify)
        print(f"备份校验通过：{args.verify}")
        return
    if args.keep < 1:
        parser.error("--keep 至少为 1")
    path = create_backup(args.output_dir, args.keep, not args.skip_cache)
    print(f"备份完成并通过校验：{path}")


if __name__ == "__main__":
    main()
