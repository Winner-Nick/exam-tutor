"""核心处理流水线：渲染 -> 视觉识别 -> 汇总判分 -> 错题讲解。"""
from __future__ import annotations

import json
import re
import shutil
import threading

from . import events, llm, pdf_utils, prompts, store

_CONF = {"high": 3, "medium": 2, "low": 1}
_SUBJECTIVE_HINT = ("文段表达", "作文", "写作", "writing", "范文")


def _num_key(num: str):
    digits = re.sub(r"\D", "", str(num))
    return int(digits) if digits else 10**9


def _merge_pages(pages: list[dict]) -> tuple[list[str], dict[str, dict], dict[str, str]]:
    """把各页视觉识别结果合并为 题号->题目 与 题号->正确答案。

    相比让 DeepSeek 重新生成全部题目 JSON（易超长截断），直接合并更稳健、可控。
    """
    qmap: dict[str, dict] = {}
    order: list[str] = []
    for p in pages:
        for q in p.get("questions") or []:
            num = str(q.get("number") or "").strip()
            if not num:
                continue
            if num not in qmap:
                qmap[num] = {
                    "number": num, "section": q.get("section"), "type": q.get("type"),
                    "stem": q.get("stem") or "", "options": q.get("options"),
                    "passage": q.get("passage"), "_sa": None, "_saconf": -1,
                    "needs_review": bool(q.get("needs_review")),
                }
                order.append(num)
            cur = qmap[num]
            if q.get("needs_review"):
                cur["needs_review"] = True
            for f in ("section", "type", "passage"):
                if not cur.get(f) and q.get(f):
                    cur[f] = q.get(f)
            stem = q.get("stem") or ""
            if len(stem) > len(cur.get("stem") or ""):
                cur["stem"] = stem
            opt = q.get("options")
            if opt and (not cur.get("options") or len(opt) > len(cur.get("options") or {})):
                cur["options"] = opt
            sm = q.get("student_marked")
            conf = _CONF.get(str(q.get("student_marked_confidence") or "").lower(), 0)
            if sm and conf > cur["_saconf"]:
                cur["_sa"] = str(sm).strip()
                cur["_saconf"] = conf

    answer_key: dict[str, str] = {}
    for p in pages:
        for k, v in (p.get("answer_key") or {}).items():
            kk = str(k).strip()
            if kk and v:
                answer_key[kk] = str(v).strip()
    return order, qmap, answer_key


def build_questions(pages: list[dict]) -> tuple[list[dict], dict]:
    """旧版/单文件全流程：合并题目 + 学生作答并判分。"""
    order, qmap, answer_key = _merge_pages(pages)
    questions: list[dict] = []
    for num in sorted(order, key=_num_key):
        c = qmap[num]
        questions.append({
            "id": "q" + num, "number": num, "section": c.get("section"),
            "type": c.get("type"), "stem": c.get("stem"),
            "options": c.get("options") or None, "passage": c.get("passage"),
            "student_answer": c["_sa"], "correct_answer": answer_key.get(num),
            "knowledge_point": None, "status": "unknown",
        })
    _grade_all(questions)
    return questions, answer_key


def build_paper_questions(pages: list[dict]) -> list[dict]:
    """试卷入库：合并题目与标准答案，不含学生作答。

    只传了答案（没有题目页）时，按 answer_key 的题号生成"题干为空"的存根题，
    照样可以批改判分；题干等信息老师可后续补充或忽略。
    """
    order, qmap, answer_key = _merge_pages(pages)
    questions: list[dict] = []
    for num in sorted(order, key=_num_key):
        c = qmap[num]
        questions.append({
            "id": "q" + num, "number": num, "section": c.get("section"),
            "type": c.get("type"), "stem": c.get("stem"),
            "options": c.get("options") or None, "passage": c.get("passage"),
            "correct_answer": answer_key.get(num), "knowledge_point": None,
            "needs_review": bool(c.get("needs_review")),
        })
    known = set(order)
    ambiguous = {
        q["_original_number"]
        for p in pages for q in (p.get("questions") or [])
        if q.get("needs_review") and q.get("_original_number")
    }
    for num, ans in answer_key.items():
        # 重号未解决的答案不生成存根，避免把不确定答案硬套到另一道题。
        if num not in known and num not in ambiguous and ans.strip().rstrip("。.") != "略":
            questions.append({
                "id": "q" + num, "number": num, "section": None, "type": None,
                "stem": None, "options": None, "passage": None,
                "correct_answer": ans, "knowledge_point": None,
            })
    questions.sort(key=lambda q: _num_key(q["number"]))
    return questions


def _global_numbering_ok(pages: list[dict]) -> bool:
    """题号已全局唯一且为纯数字时，无需归一化。"""
    seen: set[str] = set()
    for p in pages:
        for q in p.get("questions") or []:
            num = str(q.get("number") or "").strip()
            if not num:
                continue
            if num in seen or not num.isdigit():
                return False
            seen.add(num)
    return True


def _ensure_unique_numbers(pages: list[dict]) -> None:
    counts: dict[str, int] = {}
    for p in pages:
        for q in p.get("questions") or []:
            number = str(q.get("number") or "").strip()
            if number:
                counts[number] = counts.get(number, 0) + 1
    used: set[str] = set()
    for p in pages:
        occurrence = 0
        for q in p.get("questions") or []:
            original = str(q.get("number") or "").strip()
            if not original:
                continue
            occurrence += 1
            number = original
            if counts[original] > 1:
                q["_original_number"] = original
                base = f"{original}-U{p.get('page', 0)}-{occurrence}"
                number = base
                serial = 2
                while number in used:
                    number = f"{base}-{serial}"
                    serial += 1
                q["needs_review"] = True
            q["number"] = number
            used.add(number)


def _renumber_pages(pages: list[dict]) -> None:
    """按每道题的 occurrence ID 归一化题号，避免同页同号互相覆盖。"""
    compact: list[dict] = []
    for p in pages:
        for q in p.get("questions") or []:
            num = str(q.get("number") or "").strip()
            if not num:
                continue
            uid = f"p{p.get('page', 0)}-q{len(compact) + 1}"
            q["_renumber_uid"] = uid
            compact.append({
                "uid": uid, "page": p.get("page"), "number": num,
                "section": q.get("section"), "type": q.get("type"),
                "stem": (q.get("stem") or "")[:120],
            })
    if not compact:
        return
    answer_key: dict[str, str] = {}
    for p in pages:
        for k, v in (p.get("answer_key") or {}).items():
            answer_key[str(k).strip()] = str(v)[:40]
    data = llm.deepseek_json(
        prompts.RENUMBER_SYSTEM, prompts.renumber_user(compact, answer_key),
        max_tokens=16000,
    )
    mapping = {
        str(m.get("uid")): str(m.get("global")).strip()
        for m in data.get("mapping") or []
        if m.get("uid") and m.get("global") is not None and str(m.get("global")).strip()
    }
    for p in pages:
        for q in p.get("questions") or []:
            uid = q.pop("_renumber_uid", None)
            if uid and mapping.get(uid):
                q["number"] = mapping[uid]
            else:
                q.pop("_renumber_uid", None)


def _grade_one(q: dict) -> None:
    """主观题明确识别；其他缺答案或无法可靠比较的一律待确认。"""
    opts = q.get("options")
    ca = q.get("correct_answer")
    sa = q.get("student_answer")
    hint = f"{q.get('type') or ''}{q.get('section') or ''}"
    explicit_subjective = str(q.get("type") or "").strip().lower() == "subjective"
    if any(h in hint for h in _SUBJECTIVE_HINT) or explicit_subjective:
        q["status"] = "subjective"
    elif opts:
        if not sa:
            q["status"] = "unknown"
        elif ca and sa.strip().upper() == ca.strip().upper():
            q["status"] = "correct"
        elif ca:
            q["status"] = "wrong"
        else:
            q["status"] = "unknown"
    else:
        sa_s, ca_s = (sa or "").strip(), (ca or "").strip()
        if sa_s and ca_s and sa_s.lower() == ca_s.lower():
            q["status"] = "correct"
        elif sa_s and len(ca_s) == 1 and ca_s.isalpha():
            q["status"] = "wrong"
        else:
            q["status"] = "unknown"


def _grade_all(questions: list[dict]) -> None:
    for q in questions:
        _grade_one(q)


_TITLE_BAD = ("满分", "考试时间", "考生须知", "注意事项", "本试卷共", "答题卡", "请将", "填涂",
              "参考答案", "评分标准")
_PAGE_FOOTER = re.compile(r"第\s*\d+\s*页")


def build_meta(pages: list[dict], questions: list[dict], filename: str) -> dict:
    # 标题取自封面/题目页：照片乱序时第一页可能是答案页，其页脚"英语试卷 第X页"会被误当标题
    src = next(
        (p for p in pages
         if "cover" in (p.get("page_role") or []) or p.get("questions")),
        pages[0] if pages else None,
    )
    raw = ((src or {}).get("raw_text")) or ""
    title = None
    for line in raw.splitlines():
        s = line.strip()
        if (6 <= len(s) <= 40 and not s[0].isdigit()
                and any(w in s for w in ("试卷", "练习", "考试", "中考", "模拟", "测试", "单元", "月考", "期中", "期末"))
                and not any(b in s for b in _TITLE_BAD)
                and not _PAGE_FOOTER.search(s)):
            title = s
            break
    if not title:
        for line in raw.splitlines():
            s = line.strip()
            if s and not any(b in s for b in _TITLE_BAD) and not _PAGE_FOOTER.search(s):
                title = s[:40]
                break
    return {"title": title or filename or "试卷", "total_questions": len(questions)}


def _set_progress(job_id: str, stage: str, done: int, total: int, label: str) -> None:
    store.set_progress(job_id, stage, done, total, label)
    events.publish(job_id, "progress", {"stage": stage, "done": done, "total": total, "label": label})


def _stats(questions: list[dict]) -> dict:
    s = {"total": len(questions), "correct": 0, "wrong": 0, "unknown": 0, "subjective": 0}
    for q in questions:
        st = q.get("status")
        if st in s:
            s[st] += 1
    return s


def regrade(questions: list[dict]) -> None:
    """根据 student_answer 与 correct_answer 重新判定 status（用户改答案后调用）。
    与初判完全同一套规则（_grade_one），避免两条路径判定不一致。"""
    for q in questions:
        _grade_one(q)


def process_job(job_id: str) -> None:
    job = store.get_job(job_id)
    if not job:
        return
    pdf_path = store.pdf_path(job_id)
    jd = store.job_dir(job_id)

    try:
        pages_cache = jd / "pages_raw.json"
        pages_dir = jd / "pages"

        # 0) 同内容 PDF 去重：直接复用旧作业的页面图与视觉识别结果（DeepSeek 成本为 0）
        if not pages_cache.exists() and job.get("pdf_sha256"):
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
        if pages_cache.exists():
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

        # 3) 汇总 + 判分（代码合并各页结果，稳健可控）
        _set_progress(job_id, "consolidate", 0, 1, "正在汇总题目并对照答案判分…")
        questions, answer_key = build_questions(pages)
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
            from . import workers
            targets = [q["id"] for q in questions if q.get("status") in ("wrong", "unknown")]
            if targets:
                workers.enqueue_explanations(job_id, targets, priority=1)

    except Exception as exc:  # noqa: BLE001
        store.update_job(job_id, status="error", error=f"{type(exc).__name__}: {exc}")
        events.publish(job_id, "job_error", {"error": f"{type(exc).__name__}: {exc}"})
        raise


# ---------------------------------------------------------------------------
# 新流程：试卷入库（识别一次，所有学生复用）
# ---------------------------------------------------------------------------

def _render_files(owner_dir, files: list[dict], path_of) -> list[tuple[dict, int, int]]:
    """把多个文件（PDF/照片）按上传顺序渲染为连续编号的页面图。

    返回 [(file, page_start_offset, page_count)]。渲染是本地操作无 API 成本，
    每次处理都重建，保证补传文件后页码连续。
    """
    pages_dir = owner_dir / "pages"
    shutil.rmtree(pages_dir, ignore_errors=True)
    plans: list[tuple[dict, int, int]] = []
    page_no = 0
    for f in files:
        fpath = path_of(f["id"])
        if not fpath:
            continue
        if fpath.suffix.lower() == ".pdf":
            n = len(pdf_utils.render_pdf_to_images(fpath, pages_dir, start_index=page_no))
        else:
            pdf_utils.photo_to_page(fpath, pages_dir, page_no + 1)
            n = 1
        plans.append((f, page_no, n))
        page_no += n
        from .config import settings
        if page_no > settings.max_pages:
            raise ValueError(f"累计 {page_no} 页，超过每次任务 {settings.max_pages} 页上限；请减少文件后重试")
    return plans


# 视觉缓存按 (sha, mode) 加进程内锁：两个 worker 处理含相同文件的不同提交时，
# 串行化读-判-算-写，既防并发写坏缓存，也省双倍 LLM 费用
_cache_locks: dict[str, threading.Lock] = {}
_cache_locks_guard = threading.Lock()


def _cache_lock_for(key: str) -> threading.Lock:
    with _cache_locks_guard:
        return _cache_locks.setdefault(key, threading.Lock())


def _is_blank_entry(p: dict) -> bool:
    return bool(p.get("blank")) or "blank" in (p.get("page_role") or [])


def _vision_file_pages(pages_dir, start: int, n: int, sha256: str | None,
                       mode: str, vision_call, blank_result) -> list[dict]:
    """对一个文件的 n 页做视觉识别，按文件 sha 缓存（页码为文件内局部 1..n）。

    缓存校验规则：
    - "空白页"结论存疑则重识（阈值修正后曾被误判跳过的页可自愈）；
    - 含 error 的占位条目视同未识别（瞬时故障不得变成永久缓存）；
    - error 条目永不写回缓存。
    """
    cache = store.vision_cache_path(sha256, mode) if sha256 else None
    lock = _cache_lock_for(f"{sha256}:{mode}") if sha256 else threading.Lock()
    with lock:
        by_idx: dict[int, dict] = {}
        if cache and cache.exists():
            try:
                cached = json.loads(cache.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                cached = None  # 缓存损坏：整体重识并覆写
            if cached is not None:
                have = {p["page"] for p in cached if isinstance(p.get("page"), int)}
                stale = [
                    p["page"] for p in cached
                    if p.get("error")
                    or (
                        _is_blank_entry(p)
                        and (pages_dir / f"page_{start + p['page']:02d}.jpg").exists()
                        and not pdf_utils.is_blank_page(pages_dir / f"page_{start + p['page']:02d}.jpg")
                    )
                ]
                # error 条目不落缓存 → 对应页在缓存里整个缺失，也要重识
                missing = [li for li in range(1, n + 1) if li not in have]
                if not stale and not missing:
                    return cached
                by_idx = {p["page"]: p for p in cached if p["page"] not in stale}

        payload = []
        for li in range(1, n + 1):
            if li in by_idx:
                continue
            img = pages_dir / f"page_{start + li:02d}.jpg"
            if pdf_utils.is_blank_page(img):
                r = blank_result(li)
                r["blank"] = True
                by_idx[li] = r
            else:
                payload.append((li, pdf_utils.image_to_data_url(img)))
        for r in vision_call(payload):
            by_idx[r["page"]] = r
        results = [by_idx[i] for i in sorted(by_idx)]
        if cache:
            # error 占位不入缓存：下次处理自动重试失败页
            store.write_json_atomic(cache, [p for p in results if not p.get("error")])
        return results


def _set_paper_progress(paper_id: str, stage: str, done: int, total: int, label: str) -> None:
    store.set_paper_progress(paper_id, stage, done, total, label)
    events.publish(paper_id, "progress", {"stage": stage, "done": done, "total": total, "label": label})


def process_paper(paper_id: str) -> None:
    with store.paper_lock(paper_id):
        paper = store.get_paper(paper_id)
        if not paper:
            return
        pd = store.paper_dir(paper_id)
        try:
            files = store.list_paper_files(paper_id)
            if not files:
                raise RuntimeError("试卷没有任何文件")
            _set_paper_progress(paper_id, "render", 0, 1, "正在渲染试卷页面…")
            plans = _render_files(pd, files, lambda fid: store.paper_file_path(paper_id, fid))
            page_count = sum(n for _, _, n in plans)
            store.update_paper(paper_id, page_count=page_count)
            for f, start, n in plans:
                store.update_paper_file(f["id"], start + 1, n)

            _set_paper_progress(paper_id, "vision", 0, page_count, "正在识别试卷内容…")
            done_pages = 0
            all_pages: list[dict] = []

            def blank(li: int) -> dict:
                return {"page": li, "page_role": ["blank"], "raw_text": "",
                        "questions": [], "answer_key": {}}

            for f, start, n in plans:
                def prog(done: int, total: int) -> None:
                    _set_paper_progress(paper_id, "vision", done_pages + done, page_count,
                                        f"正在识别第 {done_pages + done}/{page_count} 页…")
                results = _vision_file_pages(
                    pd / "pages", start, n, f.get("sha256"), "full",
                    lambda payload: llm.vision_extract_pages(payload, on_progress=prog), blank,
                )
                done_pages += n
                for p in results:
                    gp = dict(p)
                    gp["page"] = start + p["page"]
                    all_pages.append(gp)
            all_pages.sort(key=lambda p: p["page"])
            failed_pages = [p["page"] for p in all_pages if p.get("error")]

            _set_paper_progress(paper_id, "consolidate", 0, 1, "正在汇总题目与标准答案…")
            if not _global_numbering_ok(all_pages):
                try:
                    _renumber_pages(all_pages)
                except Exception:  # noqa: BLE001
                    pass
            _ensure_unique_numbers(all_pages)
            store.write_json_atomic(pd / "pages_raw.json", all_pages, indent=2)
            questions = build_paper_questions(all_pages)
            review_numbers = {
                q.get("number") for p in all_pages for q in (p.get("questions") or [])
                if q.get("needs_review")
            }
            for q in questions:
                if q.get("number") in review_numbers:
                    q["needs_review"] = True

            old = {q["id"]: q for q in store.get_paper_questions(paper_id)}
            tombstones = {item["qid"] for item in store.list_paper_question_tombstones(paper_id)}
            questions = [q for q in questions if q["id"] not in tombstones]
            for q in questions:
                previous = old.get(q["id"])
                if not previous:
                    continue
                if previous.get("edited"):
                    q["correct_answer"] = previous.get("correct_answer")
                    q["edited"] = True
                elif not q.get("correct_answer") and previous.get("correct_answer"):
                    q["correct_answer"] = previous["correct_answer"]
                if previous.get("content_edited"):
                    for field in ("number", "section", "type", "stem", "options", "passage"):
                        q[field] = previous.get(field)
                    q["content_edited"] = True
                if previous.get("knowledge_point"):
                    q["knowledge_point"] = previous["knowledge_point"]
            recognized = {q["id"] for q in questions}
            questions.extend(
                q for qid, q in old.items()
                if q.get("manual_created") and qid not in recognized and qid not in tombstones
            )
            questions.sort(key=lambda q: _num_key(q["number"]))

            meta = build_meta(all_pages, questions, files[0].get("filename") or "")
            numbering_review = any(q.get("needs_review") for q in questions)
            meta.update({
                "failed_pages": failed_pages,
                "numbering_needs_review": numbering_review,
                "accepted_partial": False,
            })
            store.replace_paper_questions(paper_id, questions)
            if questions and not failed_pages:
                try:
                    complete_knowledge_points(paper_id)
                except Exception:  # noqa: BLE001
                    meta["knowledge_warning"] = "部分知识点暂未自动补全，可稍后重试"
            regrade_paper_submissions(paper_id)
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
            store.update_paper(paper_id, **fields)
            events.publish(paper_id, "paper_done", {"status": fields["status"]})
        except Exception as exc:  # noqa: BLE001
            store.update_paper(paper_id, status="error", error=f"{type(exc).__name__}: {exc}")
            events.publish(paper_id, "paper_error", {"error": f"{type(exc).__name__}: {exc}"})
            raise


def regrade_paper_submissions(paper_id: str) -> int:
    """把当前试卷内容同步到非在途提交；在途提交在最终判分锁内会重读。"""
    paper_questions = {q["id"]: q for q in store.get_paper_questions(paper_id)}
    changed_submissions = 0
    with store.paper_lock(paper_id):
        for job_id in store.list_submission_ids_for_paper(paper_id):
            with store.job_lock(job_id):
                job = store.get_job(job_id)
                if not job or job["status"] == "processing":
                    continue
                changed = False
                explain_targets = []
                for q in store.get_questions(job_id):
                    pq = paper_questions.get(q["id"])
                    if not pq:
                        continue
                    fields = {
                        key: pq.get(key) for key in
                        ("number", "section", "type", "stem", "options", "passage",
                         "correct_answer", "knowledge_point")
                        if q.get(key) != pq.get(key)
                    }
                    if not fields:
                        continue
                    candidate = dict(q)
                    candidate.update(fields)
                    if not q.get("overridden"):
                        regrade([candidate])
                        fields["status"] = candidate["status"]
                    store.update_question(job_id, q["id"], **fields)
                    changed = True
                    updated = store.get_question(job_id, q["id"])
                    if updated["status"] in ("wrong", "unknown"):
                        explain_targets.append(q["id"])
                if changed:
                    store.refresh_stats(job_id)
                    changed_submissions += 1
                    if explain_targets:
                        from . import workers
                        workers.enqueue_explanations(job_id, explain_targets, priority=1)
                    events.publish(job_id, "job_done", {"status": job["status"], "regraded": True})
    return changed_submissions


def complete_knowledge_points(paper_id: str, overwrite: bool = False) -> int:
    paper = store.get_paper(paper_id) or {}
    questions = [
        q for q in store.get_paper_questions(paper_id)
        if (overwrite or not q.get("knowledge_point")) and (q.get("stem") or q.get("options"))
    ]
    updated = 0
    for start in range(0, len(questions), 20):
        batch = questions[start:start + 20]
        result = llm.deepseek_json(
            prompts.KNOWLEDGE_SYSTEM + "\n" + prompts.tutor_context(paper),
            prompts.knowledge_user(batch), max_tokens=4000,
        )
        mapping = result.get("knowledge_points") or {}
        for q in batch:
            value = mapping.get(q["id"])
            if value and str(value).strip():
                store.update_paper_question(paper_id, q["id"], knowledge_point=str(value).strip()[:200])
                updated += 1
    if updated:
        regrade_paper_submissions(paper_id)
    return updated


# ---------------------------------------------------------------------------
# 新流程：作答判分（DeepSeek 只输出 题号->学生答案，token 极小）
# ---------------------------------------------------------------------------

def grade_submission_questions(paper_questions: list[dict],
                               answers: dict[str, str]) -> list[dict]:
    """用试卷题目 + 学生答案组装提交的题目列表并判分（纯代码，无 LLM）。"""
    questions = []
    for pq in paper_questions:
        questions.append({
            "id": pq["id"], "number": pq["number"], "section": pq.get("section"),
            "type": pq.get("type"), "stem": pq.get("stem"),
            "options": pq.get("options"), "passage": pq.get("passage"),
            "student_answer": answers.get(str(pq["number"])),
            "correct_answer": pq.get("correct_answer"),
            "knowledge_point": pq.get("knowledge_point"), "status": "unknown",
        })
    _grade_all(questions)
    return questions


def process_submission(job_id: str) -> None:
    job = store.get_job(job_id)
    if not job:
        return
    jd = store.job_dir(job_id)
    try:
        paper_qs = store.get_paper_questions(job["paper_id"])
        if not paper_qs:
            raise RuntimeError("试卷尚未识别完成，请稍后重试")
        files = store.job_files(job_id)
        if not files:
            raise RuntimeError("提交没有任何文件")

        _set_progress(job_id, "render", 0, 1, "正在处理上传的页面…")
        plans = _render_files(jd, files, lambda fid: store.job_file_path(job_id, fid))
        page_count = sum(n for _, _, n in plans)
        store.update_job(job_id, page_count=page_count)

        ctx = prompts.paper_context_summary(paper_qs)
        answers: dict[str, tuple[str, int]] = {}  # 题号 -> (答案, 置信度)

        def put(num, ans, conf) -> None:
            n, a = str(num or "").strip(), str(ans or "").strip()
            if not n or not a:
                return
            # 未给置信度按 medium 算；显式 low（涂改/模糊）后面不直接判对错
            c = _CONF.get(str(conf or "").lower(), 2)
            if n not in answers or c > answers[n][1]:
                answers[n] = (a, c)

        _set_progress(job_id, "vision", 0, page_count, "正在识别学生作答…")
        done_pages = 0
        failed_pages: set[int] = set()

        def blank(li: int) -> dict:
            return {"page": li, "answers": []}

        paper_files_by_sha = {
            pf.get("sha256"): pf for pf in store.list_paper_files(job["paper_id"])
            if pf.get("sha256")
        }
        paper_raw_path = store.paper_dir(job["paper_id"]) / "pages_raw.json"
        paper_raw = (json.loads(paper_raw_path.read_text(encoding="utf-8"))
                     if paper_raw_path.exists() else None)

        for f, start, n in plans:
            sha = f.get("sha256")
            full_cache = store.vision_cache_path(sha, "full") if sha else None
            pf = paper_files_by_sha.get(sha)
            if pf and paper_raw is not None:
                ps, pc = pf.get("page_start") or 1, pf.get("page_count") or 0
                for p in paper_raw:
                    if ps <= (p.get("page") or 0) < ps + pc:
                        if p.get("error"):
                            failed_pages.add(p["page"])
                            continue
                        for q in p.get("questions") or []:
                            put(q.get("number"), q.get("student_marked"),
                                q.get("student_marked_confidence"))
            elif full_cache and full_cache.exists():
                for p in json.loads(full_cache.read_text(encoding="utf-8")):
                    if p.get("error"):
                        failed_pages.add(start + p["page"])
                        continue
                    for q in p.get("questions") or []:
                        put(q.get("number"), q.get("student_marked"),
                            q.get("student_marked_confidence"))
            else:
                def prog(done: int, total: int) -> None:
                    _set_progress(job_id, "vision", done_pages + done, page_count,
                                  f"正在识别第 {done_pages + done}/{page_count} 页…")
                results = _vision_file_pages(
                    jd / "pages", start, n, sha, f"ans-{job['paper_id']}",
                    lambda payload: llm.vision_extract_pages(
                        payload, on_progress=prog,
                        system=prompts.SUBMISSION_VISION_SYSTEM,
                        user_builder=lambda i: prompts.submission_vision_user(i, ctx),
                        max_tokens=2500,
                    ), blank,
                )
                for p in results:
                    if p.get("error"):
                        failed_pages.add(start + p["page"])
                        continue
                    for a in p.get("answers") or []:
                        put(a.get("number"), a.get("answer"), a.get("confidence"))
            done_pages += n

        _set_progress(job_id, "consolidate", 0, 1, "正在对照标准答案判分…")
        with store.paper_lock(job["paper_id"]), store.job_lock(job_id):
            paper = store.get_paper(job["paper_id"])
            if not paper or paper["status"] != "ready":
                raise RuntimeError("试卷尚未确认完整，请先处理失败页或明确接受部分结果")
            paper_qs = store.get_paper_questions(job["paper_id"])
            if not paper_qs:
                raise RuntimeError("试卷没有题目，无法判分")
            questions = grade_submission_questions(paper_qs, {k: v[0] for k, v in answers.items()})
            low_nums = {k for k, v in answers.items() if v[1] <= _CONF["low"]}
            for q in questions:
                if str(q["number"]) in low_nums and q["status"] in ("correct", "wrong"):
                    q["status"] = "unknown"

            old_qs = {q["id"]: q for q in store.get_questions(job_id)}
            for q in questions:
                previous = old_qs.get(q["id"])
                if not previous:
                    continue
                if previous.get("overridden"):
                    q["student_answer"] = previous.get("student_answer")
                    q["status"] = previous["status"]
                    q["overridden"] = True
                elif not q.get("student_answer") and previous.get("student_answer"):
                    q["student_answer"] = previous["student_answer"]
                    q["status"] = previous["status"]
                if previous.get("knowledge_point") and not q.get("knowledge_point"):
                    q["knowledge_point"] = previous["knowledge_point"]

            failed = sorted(failed_pages)
            meta = {
                "title": job.get("paper_title") or "试卷",
                "total_questions": len(questions), "failed_pages": failed,
                "accepted_partial": False,
            }
            status = "partial" if failed else "done"
            error = f"第 {', '.join(map(str, failed))} 页识别失败；当前结果未完整，请重试或接受" if failed else None
            store.replace_questions(job_id, questions)
            store.update_job(
                job_id, status=status, stage="done", meta=meta, error=error,
                title=job.get("paper_title"), stats=_stats(questions),
                progress_done=1, progress_total=1,
                progress_label="部分完成" if failed else "完成",
            )
            events.publish(job_id, "job_done", {"status": status})
            if not failed:
                from . import workers
                targets = [q["id"] for q in questions if q.get("status") in ("wrong", "unknown")]
                if targets:
                    workers.enqueue_explanations(job_id, targets, priority=1)

    except Exception as exc:  # noqa: BLE001
        store.update_job(job_id, status="error", error=f"{type(exc).__name__}: {exc}")
        events.publish(job_id, "job_error", {"error": f"{type(exc).__name__}: {exc}"})
        raise
