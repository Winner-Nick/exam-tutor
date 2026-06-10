"""旧版 jobs（kind=legacy）→ 老师-学生-试卷模型 迁移。

每个用户：
1. 确保有"我自己"学生；
2. 把 legacy 作业按 pdf_sha256 分组（同一份 PDF 共用一个试卷）；
3. 每组建一个 paper：题目与正确答案取自组内题目最多的作业；复制源 PDF、
   页面图与 pages_raw.json；pages_raw 同时写入全局视觉缓存（后续提交/补传
   命中缓存，零 Gemini 成本）；
4. 组内每个作业改为 kind=submission，挂到该 paper 与"我自己"名下。

没有任何题目的 legacy 作业（识别失败的旧记录）保持 legacy 不动，可手动删除。
幂等：已是 submission 的作业不再处理。运行前自动备份 app.db。

用法：cd 项目根目录 && .venv/bin/python backend/scripts/migrate_to_papers.py
"""
from __future__ import annotations

import json
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.app import store  # noqa: E402
from backend.app.config import DATA_DIR, JOBS_DIR  # noqa: E402
from backend.app.db import get_conn, init_db  # noqa: E402


def backup_db() -> None:
    src = DATA_DIR / "app.db"
    if src.exists():
        dst = DATA_DIR / f"app.db.bak-{time.strftime('%Y%m%d-%H%M%S')}"
        shutil.copy2(src, dst)
        print(f"已备份数据库 -> {dst}")


def migrate() -> None:
    init_db()
    conn = get_conn()
    users = conn.execute("SELECT id, username FROM users").fetchall()
    total_papers = total_subs = 0

    for u in users:
        uid = u["id"]
        self_student = store.ensure_self_student(uid)
        legacy = conn.execute(
            "SELECT * FROM jobs WHERE user_id = ? AND kind = 'legacy' ORDER BY created_at",
            (uid,),
        ).fetchall()
        if not legacy:
            continue

        # 按 sha 分组；无 sha 的各自一组
        groups: dict[str, list] = {}
        for j in legacy:
            key = j["pdf_sha256"] or f"nosha-{j['id']}"
            groups.setdefault(key, []).append(j)

        for key, jobs in groups.items():
            # 选题目最多的作业作为试卷数据来源
            counted = []
            for j in jobs:
                n = conn.execute(
                    "SELECT COUNT(*) FROM questions WHERE job_id = ?", (j["id"],)
                ).fetchone()[0]
                counted.append((n, j))
            counted.sort(key=lambda t: (t[0], t[1]["created_at"]))
            best_n, best = counted[-1]
            if best_n == 0:
                print(f"  [跳过] 用户 {u['username']} 作业 {best['id']}（无题目，保持 legacy）")
                continue

            paper_id = store.new_job_id()
            title = best["title"] or best["filename"] or "试卷"
            store.create_paper(paper_id, uid, title)

            # 题目：去掉学生作答维度
            qrows = conn.execute(
                "SELECT * FROM questions WHERE job_id = ? ORDER BY id", (best["id"],)
            ).fetchall()
            store.replace_paper_questions(paper_id, [
                {
                    "id": r["qid"], "number": r["number"], "section": r["section"],
                    "type": r["type"], "stem": r["stem"],
                    "options": json.loads(r["options_json"]) if r["options_json"] else None,
                    "passage": r["passage"], "correct_answer": r["correct_answer"],
                    "knowledge_point": r["knowledge_point"],
                }
                for r in qrows
            ])

            # 文件与页面图
            pd = store.paper_dir(paper_id)
            src_pdf = JOBS_DIR / best["id"] / "source.pdf"
            sha = best["pdf_sha256"]
            if src_pdf.exists():
                fid = store.add_paper_file(paper_id, "mixed", best["filename"], sha)
                (pd / "files").mkdir(parents=True, exist_ok=True)
                shutil.copy2(src_pdf, pd / "files" / f"{fid}.pdf")
                store.update_paper_file(fid, 1, best["page_count"] or 0)
            src_pages = JOBS_DIR / best["id"] / "pages"
            if src_pages.exists():
                shutil.copytree(src_pages, pd / "pages", dirs_exist_ok=True)
            src_raw = JOBS_DIR / best["id"] / "pages_raw.json"
            if src_raw.exists():
                shutil.copy2(src_raw, pd / "pages_raw.json")
                if sha:  # 写入全局视觉缓存：同文件再提交/补传零成本
                    cache = store.vision_cache_path(sha, "full")
                    if not cache.exists():
                        shutil.copy2(src_raw, cache)

            store.update_paper(
                paper_id, status="ready", stage="done",
                page_count=best["page_count"],
                meta=json.loads(best["meta_json"]) if best["meta_json"] else {},
                progress_done=1, progress_total=1, progress_label="完成",
            )
            total_papers += 1

            # 组内全部作业 -> submission
            with conn:
                for j in jobs:
                    n = conn.execute(
                        "SELECT COUNT(*) FROM questions WHERE job_id = ?", (j["id"],)
                    ).fetchone()[0]
                    if n == 0:
                        continue
                    conn.execute(
                        "UPDATE jobs SET kind = 'submission', paper_id = ?, student_id = ? "
                        "WHERE id = ?",
                        (paper_id, self_student["id"], j["id"]),
                    )
                    total_subs += 1
            print(f"  用户 {u['username']}: paper {paper_id} «{title}» <- {len(jobs)} 份作答")

    print(f"完成：新建试卷 {total_papers} 份，转换批改记录 {total_subs} 条。")


if __name__ == "__main__":
    backup_db()
    migrate()
