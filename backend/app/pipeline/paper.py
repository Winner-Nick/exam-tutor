from __future__ import annotations

import json
import logging

from ..db import transaction
from .. import events, llm, llm_schemas, prompts, run_store, store
from .artifacts import _render_files, _vision_file_pages
from .identity import (
    _ensure_unique_numbers,
    _global_numbering_ok,
    _normalize_full_page,
    _reconcile_paper_identity,
    _renumber_pages,
    build_paper_questions,
)
from .shared import _assert_run, _set_progress, build_meta

logger = logging.getLogger(__name__)


def _set_paper_progress(paper_id: str, stage: str, done: int, total: int, label: str) -> None:
    store.set_paper_progress(paper_id, stage, done, total, label)
    events.publish(paper_id, "progress", {"stage": stage, "done": done, "total": total, "label": label})


def process_paper(paper_id: str, run: dict | None = None, force: bool = False) -> None:
    from . import _render_files as render_files, _vision_file_pages as vision_file_pages
    with store.paper_lock(paper_id):
        paper = store.get_paper(paper_id)
        if not paper:
            return
        pd = store.paper_dir(paper_id)
        try:
            _assert_run(run)
            files = store.list_paper_files(paper_id)
            if not files:
                raise RuntimeError("试卷没有任何文件")
            _set_paper_progress(paper_id, "render", 0, 1, "正在渲染试卷页面…")
            plans = render_files(pd, files, lambda fid: store.paper_file_path(paper_id, fid))
            page_count = sum(n for _, _, n in plans)
            store.update_paper(paper_id, page_count=page_count)
            for f, start, n in plans:
                store.update_paper_file(f["id"], start + 1, n)

            _set_paper_progress(paper_id, "vision", 0, page_count, "正在识别试卷内容…")
            done_pages = 0
            all_pages: list[dict] = []

            def blank(li: int) -> dict:
                return {"page": li, "page_role": ["blank"], "raw_text": "",
                        "questions": [], "answer_occurrences": [], "answers": []}

            for f, start, n in plans:
                def prog(done: int, total: int) -> None:
                    _set_paper_progress(paper_id, "vision", done_pages + done, page_count,
                                        f"正在识别第 {done_pages + done}/{page_count} 页…")
                results = vision_file_pages(
                    pd / "pages", start, n, f.get("sha256"), "full",
                    lambda payload, on_page=None: llm.vision_extract_pages(
                        payload, on_progress=prog, on_page=on_page,
                    ), blank, force=force,
                )
                done_pages += n
                for result in results:
                    gp = _normalize_full_page(result)
                    gp.pop("answer_key", None)
                    gp["page"] = start + result["page"]
                    gp["_file_sha"] = f.get("sha256")
                    gp["_file_page"] = result["page"]
                    all_pages.append(gp)
            all_pages.sort(key=lambda p: p["page"])
            failed_pages = [p["page"] for p in all_pages if p.get("error")]

            _set_paper_progress(paper_id, "consolidate", 0, 1, "正在汇总题目与标准答案…")
            if not _global_numbering_ok(all_pages):
                try:
                    _renumber_pages(all_pages)
                except Exception:  # noqa: BLE001
                    logger.exception("试卷题号归一化失败 paper_id=%s", paper_id)
            _ensure_unique_numbers(all_pages)
            store.write_json_atomic(pd / "pages_raw.json", all_pages, indent=2)
            questions = _reconcile_paper_identity(paper_id, build_paper_questions(all_pages))

            meta = build_meta(all_pages, questions, files[0].get("filename") or "")
            numbering_review = any(q.get("needs_review") for q in questions)
            meta.update({
                "failed_pages": failed_pages,
                "numbering_needs_review": numbering_review,
                "accepted_partial": False,
            })
            with transaction():
                _assert_run(run)
                store.replace_paper_questions(paper_id, questions)
            if questions and not failed_pages:
                from . import complete_knowledge_points as complete_knowledge
                try:
                    complete_knowledge(paper_id, sync=False, run=run)
                except Exception:  # noqa: BLE001
                    meta["knowledge_warning"] = "部分知识点暂未自动补全，可稍后重试"
            partial = bool(failed_pages or numbering_review or not questions)
            if not questions:
                error = "没有可用题目，请重试识别或手动补题"
            elif failed_pages:
                error = f"第 {', '.join(map(str, failed_pages))} 页识别失败，请重试或明确接受部分结果"
            elif numbering_review:
                error = "部分题号需要人工核对，系统没有合并或套用不确定答案"
            else:
                error = None
            fields = {
                "status": "partial" if partial else "ready", "stage": "done", "meta": meta,
                "error": error, "progress_done": 1, "progress_total": 1,
                "progress_label": "部分完成" if partial else "完成",
            }
            if not paper.get("title"):
                fields["title"] = meta.get("title")
            with transaction():
                _assert_run(run)
                store.update_paper(paper_id, **fields)
            paper_revision = store.get_paper(paper_id)["revision"]
            store.write_json_atomic(pd / "source_meta.json", {"paper_revision": paper_revision})
            from .. import workers
            workers.enqueue_paper_reconcile(paper_id, force=True)
            events.publish(paper_id, "paper_done", {"status": fields["status"]})
        except run_store.StaleRun:
            raise
        except Exception as exc:  # noqa: BLE001
            store.update_paper(paper_id, status="error", error=f"{type(exc).__name__}: {exc}")
            events.publish(paper_id, "paper_error", {"error": f"{type(exc).__name__}: {exc}"})
            raise

def complete_knowledge_points(paper_id: str, overwrite: bool = False, *,
                              sync: bool = True, run: dict | None = None) -> int:
    paper = store.get_paper(paper_id) or {}
    questions = [
        q for q in store.get_paper_questions(paper_id)
        if (overwrite or not q.get("knowledge_point")) and (q.get("stem") or q.get("options"))
    ]
    pending: dict[str, str] = {}
    for start in range(0, len(questions), 20):
        batch = questions[start:start + 20]
        result = llm.deepseek_json(
            prompts.KNOWLEDGE_SYSTEM + "\n" + prompts.tutor_context(paper),
            prompts.knowledge_user(batch), max_tokens=4000,
        )
        mapping = llm_schemas.validate_knowledge_points(result)
        for q in batch:
            value = mapping.get(q["id"])
            if value and str(value).strip():
                pending[q["id"]] = str(value).strip()[:200]
    _assert_run(run)
    updated = store.update_paper_knowledge_points(
        paper_id, pending, mark_content_edited=False,
    ) if pending else 0
    if updated and sync:
        from .. import workers
        workers.enqueue_paper_reconcile(paper_id)
    return updated
