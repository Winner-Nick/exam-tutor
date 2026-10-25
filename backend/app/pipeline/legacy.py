from __future__ import annotations

import json
import shutil

from ..db import transaction
from .. import events, llm, pdf_utils, run_store, store
from .grading import _grade_all
from .identity import _answer_for, _merge_pages
from .shared import _assert_run, _num_key, _set_progress, _stats, build_meta

def build_questions(pages: list[dict]) -> tuple[list[dict], dict]:
    """旧版/单文件全流程：合并题目 + 学生作答并判分。"""
    order, qmap, answer_key = _merge_pages(pages)
    questions: list[dict] = []
    for num in sorted(order, key=_num_key):
        c = qmap[num]
        conflict = bool(c.get("_answer_conflict"))
        questions.append({
            "id": "q" + num, "number": num, "section": c.get("section"),
            "type": c.get("type"), "stem": c.get("stem"),
            "options": c.get("options") or None, "passage": c.get("passage"),
            "student_answer": c["_sa"],
            "correct_answer": None if conflict else _answer_for(answer_key, num),
            "knowledge_point": None, "status": "unknown",
            "needs_review": bool(c.get("needs_review") or conflict),
        })
    _grade_all(questions)
    return questions, answer_key

def _preserve_overrides(job_id: str, questions: list[dict]) -> None:
    previous = store.get_questions(job_id)
    old = {q["id"]: q for q in previous}
    recognized = {q["id"] for q in questions}
    for q in questions:
        old_q = old.get(q["id"])
        if old_q and old_q.get("overridden"):
            q["student_answer"] = old_q.get("student_answer")
            q["status"] = old_q["status"]
            q["overridden"] = True
    questions.extend(
        q for q in previous
        if q.get("overridden") and q["id"] not in recognized
    )
    questions.sort(key=lambda q: _num_key(q.get("number")))


def process_job(job_id: str, run: dict | None = None, force: bool = False) -> None:
    job = store.get_job(job_id)
    if not job:
        return
    pdf_path = store.pdf_path(job_id)
    jd = store.job_dir(job_id)

    try:
        _assert_run(run)
        pages_cache = jd / "pages_raw.json"
        pages_dir = jd / "pages"

        # 0) 同内容 PDF 去重：直接复用旧作业的页面图与视觉识别结果（DeepSeek 成本为 0）
        if not force and not pages_cache.exists() and job.get("pdf_sha256"):
            donor = store.find_reusable_job_by_sha(job["pdf_sha256"], job_id)
            if donor:
                donor_dir = store.job_dir(donor)
                if (donor_dir / "pages").exists():
                    shutil.copytree(donor_dir / "pages", pages_dir, dirs_exist_ok=True)
                shutil.copy2(donor_dir / "pages_raw.json", pages_cache)

        # 1) 渲染 PDF（去重命中时页面图已就位，跳过）
        imgs = sorted(pages_dir.glob("page_*.jpg")) if pages_dir.exists() else []
        if not imgs:
            _set_progress(job_id, "render", 0, 1, "正在渲染试卷页面…")
            imgs = pdf_utils.render_pdf_to_images(pdf_path, pages_dir)
        store.update_job(job_id, page_count=len(imgs))

        # 2) 逐页视觉识别（空白页直接跳过；结果缓存，便于重跑与跨作业复用）
        if pages_cache.exists() and not force:
            pages = json.loads(pages_cache.read_text(encoding="utf-8"))
            # 含 error 的占位页是瞬时故障留下的；缺页（失败页不落缓存）同样需要重识
            have = {p.get("page") for p in pages}
            err_pages = [p["page"] for p in pages if p.get("error")]
            err_pages += [i for i in range(1, len(imgs) + 1) if i not in have]
            if err_pages:
                payload = []
                for i in err_pages:
                    if 1 <= i <= len(imgs):
                        payload.append((i, pdf_utils.image_to_data_url(imgs[i - 1])))
                if payload:
                    _set_progress(job_id, "vision", 0, len(payload), "正在重试识别失败的页面…")
                    by_page = {p["page"]: p for p in pages}
                    for r in llm.vision_extract_pages(payload):
                        by_page[r["page"]] = r
                    pages = [by_page[i] for i in sorted(by_page)]
                    store.write_json_atomic(pages_cache,
                                            [p for p in pages if not p.get("error")], indent=2)
        else:
            by_idx: dict[int, dict] = {}
            payload = []
            for i, p in enumerate(imgs):
                idx = i + 1
                if pdf_utils.is_blank_page(p):
                    by_idx[idx] = {"page": idx, "page_role": ["blank"], "raw_text": "",
                                   "questions": [], "answer_key": {}}
                else:
                    payload.append((idx, pdf_utils.image_to_data_url(p)))
            _set_progress(job_id, "vision", 0, len(payload), "正在识别试卷内容…")

            def prog(done: int, total: int) -> None:
                _set_progress(job_id, "vision", done, total, f"正在识别第 {done}/{total} 页…")

            for r in llm.vision_extract_pages(payload, on_progress=prog):
                by_idx[r["page"]] = r
            pages = [by_idx[i] for i in sorted(by_idx)]
            store.write_json_atomic(pages_cache,
                                    [p for p in pages if not p.get("error")], indent=2)

        by_page = {
            p["page"]: p for p in pages
            if isinstance(p, dict) and type(p.get("page")) is int
            and 1 <= p["page"] <= len(imgs)
        }
        pages = [by_page.get(i) or {
            "page": i, "error": "视觉识别未返回该页结果", "raw_text": "",
            "questions": [], "answer_key": {},
        } for i in range(1, len(imgs) + 1)]
        store.write_json_atomic(
            pages_cache, [p for p in pages if not p.get("error")], indent=2,
        )

        # 3) 汇总 + 判分（代码合并各页结果，稳健可控）
        _set_progress(job_id, "consolidate", 0, 1, "正在汇总题目并对照答案判分…")
        questions, answer_key = build_questions(pages)
        _preserve_overrides(job_id, questions)
        meta = build_meta(pages, questions, job.get("filename", ""))
        store.write_json_atomic(
            jd / "consolidated.json",
            {"meta": meta, "answer_key": answer_key, "questions": questions},
            indent=2,
        )

        failed_pages = [p["page"] for p in pages if p.get("error")]
        meta["failed_pages"] = failed_pages
        meta["accepted_partial"] = False
        status = "partial" if failed_pages else "done"
        with transaction():
            _assert_run(run)
            store.replace_questions(job_id, questions)
            store.update_job(
                job_id, status=status, stage="done", meta=meta,
                error="部分页面识别失败，请重试或接受" if failed_pages else None,
                title=meta.get("title"), stats=_stats(questions),
                progress_done=1, progress_total=1,
                progress_label="部分完成" if failed_pages else "完成",
            )
        events.publish(job_id, "job_done", {"status": status})

        if not failed_pages:
            from .. import workers
            targets = [q["id"] for q in questions if q.get("status") in ("wrong", "unknown")]
            if targets:
                workers.enqueue_explanations(job_id, targets, priority=1)

    except run_store.StaleRun:
        raise
    except Exception as exc:  # noqa: BLE001
        store.update_job(job_id, status="error", error=f"{type(exc).__name__}: {exc}")
        events.publish(job_id, "job_error", {"error": f"{type(exc).__name__}: {exc}"})
        raise
