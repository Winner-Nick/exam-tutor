"""清理无引用的私有作答视觉缓存；共享试卷 full 缓存一律保留。

预览：.venv/bin/python -m backend.scripts.cleanup_vision_cache --days 30
执行：在命令后加 --apply
"""
from __future__ import annotations

import argparse
import time

from backend.app import store
from backend.app.db import get_conn, init_db


def main() -> None:
    parser = argparse.ArgumentParser(description="清理不再被任何提交引用的作答识别缓存")
    parser.add_argument("--days", type=int, default=30, help="只处理至少 N 天未修改的缓存，默认 30")
    parser.add_argument("--apply", action="store_true", help="实际删除；默认仅预览")
    args = parser.parse_args()
    init_db()
    referenced: set[str] = set()
    rows = get_conn().execute("SELECT id, paper_id FROM jobs WHERE paper_id IS NOT NULL").fetchall()
    for row in rows:
        for file in store.job_files(row["id"]):
            sha = file.get("sha256")
            if sha:
                referenced.add(str(store.vision_cache_path(sha, f"ans-{row['paper_id']}").resolve()))
    cutoff = time.time() - max(0, args.days) * 86400
    candidates = [
        path for path in store.VISION_CACHE_DIR.glob("*.ans-*.json")
        if path.stat().st_mtime <= cutoff and str(path.resolve()) not in referenced
    ]
    for path in candidates:
        print(f"{'删除' if args.apply else '待清理'}: {path.name}")
        if args.apply:
            path.unlink(missing_ok=True)
    print(f"共 {len(candidates)} 个无引用缓存；共享试卷缓存未处理。")


if __name__ == "__main__":
    main()
