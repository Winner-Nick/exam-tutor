"""一次性迁移：data/jobs/*/job.json -> SQLite（归属指定的 admin 账号）。

用法：
    .venv/bin/python -m backend.scripts.migrate_json_jobs \
        --admin-user admin --admin-password '...'

幂等：已存在的 job id 跳过；admin 已存在则复用。
迁移后 job.json 重命名为 job.json.bak 留档，文件目录（source.pdf、pages/、
pages_raw.json）原地不动。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys

from backend.app import auth, store
from backend.app.config import JOBS_DIR
from backend.app.db import init_db


def _sha256(path) -> str | None:
    if not path.exists():
        return None
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--admin-user", required=True)
    ap.add_argument("--admin-password", required=True)
    args = ap.parse_args()

    init_db()

    user = store.get_user_by_username(args.admin_user)
    if user:
        admin_id = user["id"]
        print(f"复用已有用户 {args.admin_user} (id={admin_id})")
    else:
        admin_id = store.create_user(
            args.admin_user, auth.hash_password(args.admin_password), role="admin"
        )
        print(f"已创建 admin 用户 {args.admin_user} (id={admin_id})")

    migrated = skipped = 0
    for jf in sorted(JOBS_DIR.glob("*/job.json")):
        job_id = jf.parent.name
        try:
            j = json.loads(jf.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            print(f"  跳过 {job_id}: job.json 解析失败 ({exc})")
            continue
        if store.get_job(job_id):
            skipped += 1
            continue

        store.create_job(
            job_id, admin_id, j.get("filename"),
            pdf_sha256=_sha256(jf.parent / "source.pdf"),
            created_at=j.get("created_at"),
        )
        meta = j.get("meta") or {}
        store.update_job(
            job_id,
            status=j.get("status") or "error",
            stage=j.get("stage"),
            error=j.get("error"),
            page_count=j.get("page_count"),
            meta=meta,
            title=meta.get("title"),
            stats=j.get("stats") or {},
            progress_done=(j.get("progress") or {}).get("done", 1),
            progress_total=(j.get("progress") or {}).get("total", 1),
            progress_label=(j.get("progress") or {}).get("label"),
        )
        store.replace_questions(job_id, j.get("questions") or [])
        for key, msgs in (j.get("chat") or {}).items():
            qid = None if key == "general" else key
            for m in msgs:
                store.add_chat_message(job_id, qid, m.get("role") or "user", m.get("content") or "")

        jf.rename(jf.with_suffix(".json.bak"))
        migrated += 1
        print(f"  已迁移 {job_id}: {len(j.get('questions') or [])} 题")

    print(f"完成：迁移 {migrated} 个作业，跳过 {skipped} 个。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
