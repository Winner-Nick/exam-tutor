from __future__ import annotations

import json
from collections import Counter

from ..db import transaction
from .. import events, llm, prompts, run_store, store
from .artifacts import _render_files, _vision_file_pages
from .grading import _grade_one
from .shared import _CONF, _assert_run, _set_progress, _stats

def _normalized_observations(answers: dict[str, str]) -> dict[str, str | None]:
    normalized: dict[str, str | None] = {}
    for number, answer in answers.items():
        key = store.normalize_number_key(number)
        if not key:
            continue
        if key in normalized and _answer_text(normalized[key]) != _answer_text(answer):
            normalized[key] = None
        else:
            normalized[key] = answer
    return normalized


def _assemble_submission_questions(paper_questions: list[dict], old_questions: list[dict],
                                   answers: dict[str, str] | None) -> list[dict]:
    old = {q["id"]: q for q in old_questions}
    observations = _normalized_observations(answers) if answers is not None else None
    number_counts = Counter(
        store.normalize_number_key(pq.get("number")) for pq in paper_questions
        if store.normalize_number_key(pq.get("number"))
    )
    questions = []
    for pq in paper_questions:
        key = store.normalize_number_key(pq.get("number"))
        previous = old.get(pq["id"])
        overridden = bool(previous and previous.get("overridden"))
        ambiguous = bool(key) and number_counts[key] > 1
        if overridden:
            student_answer = previous.get("student_answer")
        elif observations is not None:
            student_answer = observations.get(key)
        else:
            student_answer = previous.get("student_answer") if previous else None
        if ambiguous and not overridden:
            student_answer = None
        question = {
            "id": pq["id"], "number": pq["number"], "section": pq.get("section"),
            "type": pq.get("type"), "stem": pq.get("stem"),
            "options": pq.get("options"), "passage": pq.get("passage"),
            "student_answer": student_answer,
            "correct_answer": pq.get("correct_answer") if overridden or not ambiguous else None,
            "knowledge_point": pq.get("knowledge_point"), "status": "unknown",
            "needs_review": bool(pq.get("needs_review") or ambiguous),
        }
        if overridden:
            question["status"] = previous["status"]
            question["overridden"] = True
        elif ambiguous:
            question["status"] = "unknown"
        else:
            _grade_one(question)
        questions.append(question)
    return questions


def _paper_source_quality(paper: dict, paper_questions: list[dict]) -> dict:
    meta = paper.get("meta") or {}
    accepted = bool(meta.get("accepted_partial"))
    needs_review = bool(
        meta.get("numbering_needs_review") or any(q.get("needs_review") for q in paper_questions)
    )
    failed = list(meta.get("failed_pages") or [])
    return {
        "accepted_partial": accepted, "needs_review": needs_review, "failed_pages": failed,
        "partial": bool(paper["status"] == "partial" or accepted or needs_review or failed),
    }


def _submission_snapshot(job: dict, paper: dict, paper_questions: list[dict],
                         questions: list[dict], base_meta: dict | None = None) -> tuple[dict, str, str | None]:
    meta = dict(base_meta if base_meta is not None else (job.get("meta") or {}))
    quality = dict(meta.get("quality") or {})
    unmatched = list(quality.get("unmatched_answers") or [])
    failed = list(meta.get("failed_pages") or [])
    accepted = bool(meta.get("accepted_partial"))
    source = _paper_source_quality(paper, paper_questions)
    meta.update({
        "total_questions": len(questions),
        "source_accepted_partial": source["accepted_partial"],
        "source_needs_review": source["needs_review"],
        "source_failed_pages": source["failed_pages"],
        "quality": quality,
    })
    errors = []
    if failed and not accepted:
        errors.append(f"第 {', '.join(map(str, failed))} 页识别失败")
    if source["needs_review"]:
        errors.append("来源试卷仍有题目需要核对")
    if source["accepted_partial"]:
        errors.append("来源试卷为已接受的部分识别结果")
    elif source["failed_pages"]:
        errors.append("来源试卷存在识别失败页")
    if unmatched and not accepted:
        errors.append("存在未匹配的学生作答")
    partial = bool(source["partial"] or ((failed or unmatched) and not accepted))
    return meta, "partial" if partial else "done", "；".join(errors) or None

def grade_submission_questions(paper_questions: list[dict],
                               answers: dict[str, str]) -> list[dict]:
    """用试卷题目 + 学生答案组装提交；重号 occurrence 不共享作答或答案。"""
    return _assemble_submission_questions(paper_questions, [], answers)


def _answer_cache_mode(paper_id: str, revision: int) -> str:
    return f"ans-{paper_id}-r{revision}"


def process_submission(job_id: str, run: dict | None = None, force: bool = False) -> None:
    from . import _render_files as render_files, _vision_file_pages as vision_file_pages
    job = store.get_job(job_id)
    if not job:
        return
    jd = store.job_dir(job_id)
    try:
        _assert_run(run)
        paper = store.get_paper(job["paper_id"])
        if not paper:
            raise RuntimeError("试卷不存在")
        if paper["status"] != "ready":
            raise run_store.RetryLater("试卷尚未准备完成，将延迟重试", delay=3.0)
        paper_revision = paper["revision"]
        paper_qs = store.get_paper_questions(job["paper_id"])
        if not paper_qs:
            raise run_store.RetryLater("试卷尚未识别完成，将延迟重试", delay=2.0)
        store.update_job(job_id, paper_revision=paper_revision)
        files = store.job_files(job_id)
        if not files:
            raise RuntimeError("提交没有任何文件")

        _set_progress(job_id, "render", 0, 1, "正在处理上传的页面…")
        plans = render_files(jd, files, lambda fid: store.job_file_path(job_id, fid))
        page_count = sum(n for _, _, n in plans)
        store.update_job(job_id, page_count=page_count)

        ctx = prompts.paper_context_summary(paper_qs)
        answers: dict[str, tuple[str, int]] = {}
        answer_pages: dict[str, int | None] = {}
        quality_notes: list[dict] = []

        def put(num, ans, conf, page: int | None = None) -> None:
            n, a = store.normalize_number_key(num), str(ans or "").strip()
            if not n or not a:
                return
            confidence = _CONF.get(str(conf or "").lower(), 2)
            if n not in answers or confidence > answers[n][1]:
                answers[n] = (a, confidence)
                answer_pages[n] = page

        _set_progress(job_id, "vision", 0, page_count, "正在识别学生作答…")
        done_pages = 0
        failed_pages: set[int] = set()

        def blank(li: int) -> dict:
            return {"page": li, "answers": []}

        paper_files_by_sha = {
            pf.get("sha256"): pf for pf in store.list_paper_files(job["paper_id"])
            if pf.get("sha256")
        }
        source_meta_path = store.paper_dir(job["paper_id"]) / "source_meta.json"
        try:
            source_meta = (json.loads(source_meta_path.read_text(encoding="utf-8"))
                           if source_meta_path.exists() else {})
            source_revision = source_meta.get("paper_revision") or 1
        except (OSError, json.JSONDecodeError):
            source_revision = None
        paper_raw_path = store.paper_dir(job["paper_id"]) / "pages_raw.json"
        try:
            paper_raw = (
                json.loads(paper_raw_path.read_text(encoding="utf-8"))
                if paper_raw_path.exists() and source_revision == paper_revision else None
            )
        except (OSError, json.JSONDecodeError):
            paper_raw = None

        for f, start, n in plans:
            sha = f.get("sha256")
            pf = paper_files_by_sha.get(sha)
            if pf and paper_raw is not None and not force:
                ps, pc = pf.get("page_start") or 1, pf.get("page_count") or 0
                raw_by_page = {
                    p["page"]: p for p in paper_raw
                    if isinstance(p, dict) and type(p.get("page")) is int
                }
                for li in range(1, n + 1):
                    p = raw_by_page.get(ps + li - 1) if li <= pc else None
                    if p is None or p.get("error"):
                        failed_pages.add(start + li)
                        continue
                    if p.get("notes"):
                        quality_notes.append({"page": start + li, "notes": str(p["notes"])})
                    for q in p.get("questions") or []:
                        put(q.get("number"), q.get("student_marked"),
                            q.get("student_marked_confidence"), start + li)
            else:
                def prog(done: int, total: int) -> None:
                    _set_progress(job_id, "vision", done_pages + done, page_count,
                                  f"正在识别第 {done_pages + done}/{page_count} 页…")
                if sha and paper_revision == 1 and not force:
                    legacy_cache = store.vision_cache_path(sha, f"ans-{job['paper_id']}")
                    revision_cache = store.vision_cache_path(
                        sha, _answer_cache_mode(job["paper_id"], paper_revision),
                    )
                    if legacy_cache.exists() and not revision_cache.exists():
                        try:
                            legacy_data = json.loads(legacy_cache.read_text(encoding="utf-8"))
                            if isinstance(legacy_data, list):
                                store.write_json_atomic(revision_cache, legacy_data)
                        except (OSError, json.JSONDecodeError):
                            pass
                results = vision_file_pages(
                    jd / "pages", start, n, sha,
                    _answer_cache_mode(job["paper_id"], paper_revision),
                    lambda payload, on_page=None: llm.vision_extract_pages(
                        payload, on_progress=prog, on_page=on_page,
                        system=prompts.SUBMISSION_VISION_SYSTEM,
                        user_builder=lambda i: prompts.submission_vision_user(i, ctx),
                        max_tokens=2500,
                    ), blank, force=force,
                )
                for p in results:
                    if p.get("error"):
                        failed_pages.add(start + p["page"])
                        continue
                    if p.get("notes"):
                        quality_notes.append({"page": start + p["page"], "notes": str(p["notes"])})
                    for a in p.get("answers") or []:
                        put(a.get("number"), a.get("answer"), a.get("confidence"), start + p["page"])
            done_pages += n

        _set_progress(job_id, "consolidate", 0, 1, "正在对照标准答案判分…")
        with store.paper_lock(job["paper_id"]), store.job_lock(job_id):
            paper = store.get_paper(job["paper_id"])
            if not paper:
                raise RuntimeError("试卷不存在")
            if paper["revision"] != paper_revision:
                raise run_store.RetryLater("试卷结构版本已变化，将重新识别并重试", delay=2.0)
            if paper["status"] != "ready":
                raise run_store.RetryLater("试卷尚未确认完整，将延迟重试", delay=3.0)
            paper_qs = store.get_paper_questions(job["paper_id"])
            if not paper_qs:
                raise run_store.RetryLater("试卷没有题目，将延迟重试", delay=2.0)
            old_questions = store.get_questions(job_id)
            questions = _assemble_submission_questions(
                paper_qs, old_questions, {k: v[0] for k, v in answers.items()},
            )
            low_nums = {k for k, v in answers.items() if v[1] <= _CONF["low"]}
            for question in questions:
                if (store.normalize_number_key(question["number"]) in low_nums
                        and question["status"] in ("correct", "wrong")):
                    question["status"] = "unknown"

            number_counts = Counter(
                store.normalize_number_key(q.get("number")) for q in paper_qs
                if store.normalize_number_key(q.get("number"))
            )
            unmatched = [{
                "number": number, "answer": answer,
                "confidence": confidence, "page": answer_pages.get(number),
            } for number, (answer, confidence) in answers.items()
                if number_counts[number] != 1]
            base_meta = {
                "title": job.get("paper_title") or "试卷",
                "failed_pages": sorted(failed_pages), "accepted_partial": False,
                "quality": {"unmatched_answers": unmatched, "notes": quality_notes},
            }
            meta, status, error = _submission_snapshot(
                job, paper, paper_qs, questions, base_meta,
            )
            with transaction():
                _assert_run(run)
                store.replace_questions(job_id, questions)
                stats = store.refresh_stats(job_id)
                store.update_job(
                    job_id, status=status, stage="done", meta=meta, error=error,
                    title=job.get("paper_title"), applied_paper_revision=paper_revision,
                    progress_done=1, progress_total=1,
                    progress_label="部分完成" if status == "partial" else "完成",
                )
            events.publish(job_id, "job_done", {"status": status, "stats": stats})
            if status == "done":
                from .. import workers
                targets = [q["id"] for q in questions if q.get("status") in ("wrong", "unknown")]
                if targets:
                    workers.enqueue_explanations(job_id, targets, priority=1)

    except run_store.StaleRun:
        raise
    except run_store.RetryLater:
        store.update_job(job_id, status="processing", stage="waiting", error=None)
        events.publish(job_id, "progress", {
            "stage": "waiting", "done": 0, "total": 1, "label": "等待依赖就绪后重试",
        })
        raise
    except Exception as exc:  # noqa: BLE001
        store.update_job(job_id, status="error", error=f"{type(exc).__name__}: {exc}")
        events.publish(job_id, "job_error", {"error": f"{type(exc).__name__}: {exc}"})
        raise
