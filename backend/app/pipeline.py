"""核心处理流水线：渲染 -> 视觉识别 -> 汇总判分 -> 错题讲解。"""
from __future__ import annotations

import json
import re
import shutil

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
                }
                order.append(num)
            cur = qmap[num]
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
        })
    known = set(order)
    for num, ans in answer_key.items():
        # "五: 略。" 之类的占位条目不是题目，跳过
        if num not in known and ans.strip().rstrip("。.") != "略":
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


def _renumber_pages(pages: list[dict]) -> None:
    """节内编号 -> 全卷统一题号（原地改写 question["number"]）。

    很多试卷每个大题从 1 重新计数，而答案页用全卷题号；裸题号跨页合并会让
    不同大题的同号题互相覆盖。交给 DeepSeek 对照答案推断全局题号——输入是
    紧凑结构、输出只有几十对映射，成本可忽略。
    """
    compact: list[dict] = []
    for p in pages:
        for q in p.get("questions") or []:
            num = str(q.get("number") or "").strip()
            if not num:
                continue
            compact.append({
                "page": p.get("page"), "number": num,
                "section": q.get("section"), "type": q.get("type"),
                "stem": (q.get("stem") or "")[:80],
            })
    if not compact:
        return
    answer_key: dict[str, str] = {}
    for p in pages:
        for k, v in (p.get("answer_key") or {}).items():
            answer_key[str(k).strip()] = str(v)[:40]
    # 推理模型的思维链也消耗 max_tokens，给足额度防止正文被截断
    data = llm.deepseek_json(
        prompts.RENUMBER_SYSTEM, prompts.renumber_user(compact, answer_key),
        max_tokens=16000,
    )
    mapping: dict[tuple, str] = {}
    for m in data.get("mapping") or []:
        g = m.get("global")
        if g is None or str(g).strip() == "":
            continue
        mapping[(m.get("page"), str(m.get("number")).strip())] = str(g).strip()
    if not mapping:
        return
    for p in pages:
        for q in p.get("questions") or []:
            num = str(q.get("number") or "").strip()
            g = mapping.get((p.get("page"), num))
            if g:
                q["number"] = g


def _grade_all(questions: list[dict]) -> None:
    for q in questions:
        opts = q.get("options")
        ca = q.get("correct_answer")
        sa = q.get("student_answer")
        hint = f"{q.get('type') or ''}{q.get('section') or ''}"
        if any(h in hint for h in _SUBJECTIVE_HINT) or (not opts and not ca):
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
            # 无选项信息（如仅答案建卷的存根题）：答案若是单个字母按选择题严判；
            # 其他填空/简答完全一致判对，不一致不轻易判错（手写转写有误差）
            sa_s, ca_s = (sa or "").strip(), (ca or "").strip()
            if sa_s and ca_s and sa_s.lower() == ca_s.lower():
                q["status"] = "correct"
            elif sa_s and len(ca_s) == 1 and ca_s.isalpha():
                q["status"] = "wrong"
            else:
                q["status"] = "unknown"


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
    """根据 student_answer 与 correct_answer 重新判定 status（用户改答案后调用）。"""
    for q in questions:
        if q.get("status") == "subjective":
            continue
        sa, ca = q.get("student_answer"), q.get("correct_answer")
        if not sa:
            q["status"] = "unknown"
        elif ca and str(sa).strip().upper() == str(ca).strip().upper():
            q["status"] = "correct"
        elif ca:
            q["status"] = "wrong"
        else:
            q["status"] = "unknown"


def process_job(job_id: str) -> None:
    job = store.get_job(job_id)
    if not job:
        return
    pdf_path = store.pdf_path(job_id)
    jd = store.job_dir(job_id)

    try:
        pages_cache = jd / "pages_raw.json"
        pages_dir = jd / "pages"

        # 0) 同内容 PDF 去重：直接复用旧作业的页面图与视觉识别结果（Gemini 成本为 0）
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
            pages_cache.write_text(json.dumps(pages, ensure_ascii=False, indent=2), encoding="utf-8")

        # 3) 汇总 + 判分（代码合并各页结果，稳健可控）
        _set_progress(job_id, "consolidate", 0, 1, "正在汇总题目并对照答案判分…")
        questions, answer_key = build_questions(pages)
        meta = build_meta(pages, questions, job.get("filename", ""))
        (jd / "consolidated.json").write_text(
            json.dumps({"meta": meta, "answer_key": answer_key, "questions": questions},
                       ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        # 4) 判分即完成；错题讲解交给后台队列预生成（用户点开可插队）
        store.replace_questions(job_id, questions)
        store.update_job(
            job_id, status="done", stage="done", meta=meta,
            title=meta.get("title"), stats=_stats(questions),
            progress_done=1, progress_total=1, progress_label="完成",
        )
        events.publish(job_id, "job_done", {"status": "done"})

        from . import workers  # 局部导入，避免与 workers -> pipeline 形成环

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
    return plans


def _is_blank_entry(p: dict) -> bool:
    return bool(p.get("blank")) or "blank" in (p.get("page_role") or [])


def _vision_file_pages(pages_dir, start: int, n: int, sha256: str | None,
                       mode: str, vision_call, blank_result) -> list[dict]:
    """对一个文件的 n 页做视觉识别，按文件 sha 缓存（页码为文件内局部 1..n）。

    缓存命中时校验其中的"空白页"结论：空白判定阈值修正后，曾被误判跳过的页
    （如内容稀疏的答案页）会被重新识别并回写缓存，其余页继续复用。
    """
    cache = store.vision_cache_path(sha256, mode) if sha256 else None
    by_idx: dict[int, dict] = {}
    if cache and cache.exists():
        cached = json.loads(cache.read_text(encoding="utf-8"))
        stale = [
            p["page"] for p in cached
            if _is_blank_entry(p)
            and (pages_dir / f"page_{start + p['page']:02d}.jpg").exists()
            and not pdf_utils.is_blank_page(pages_dir / f"page_{start + p['page']:02d}.jpg")
        ]
        if not stale:
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
        cache.write_text(json.dumps(results, ensure_ascii=False), encoding="utf-8")
    return results


def _set_paper_progress(paper_id: str, stage: str, done: int, total: int, label: str) -> None:
    store.set_paper_progress(paper_id, stage, done, total, label)
    events.publish(paper_id, "progress", {"stage": stage, "done": done, "total": total, "label": label})


def process_paper(paper_id: str) -> None:
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
                lambda payload: llm.vision_extract_pages(payload, on_progress=prog),
                blank,
            )
            done_pages += n
            for p in results:
                gp = dict(p)
                gp["page"] = start + p["page"]
                all_pages.append(gp)

        all_pages.sort(key=lambda p: p["page"])

        _set_paper_progress(paper_id, "consolidate", 0, 1, "正在汇总题目与标准答案…")
        if not _global_numbering_ok(all_pages):
            _set_paper_progress(paper_id, "consolidate", 0, 1, "正在对照答案归一化题号…")
            try:
                _renumber_pages(all_pages)
            except Exception:  # noqa: BLE001
                # 归一化失败退回原始题号：宁可部分题缺答案，也不张冠李戴
                pass
        # 归一化之后落盘：提交"学生答在试卷上"的零成本路径靠这份数据按全卷题号取手写答案
        (pd / "pages_raw.json").write_text(
            json.dumps(all_pages, ensure_ascii=False, indent=2), encoding="utf-8")
        questions = build_paper_questions(all_pages)

        # 补传答案/重新识别时，保留老师手工核对过的答案与已有考点
        old = {q["id"]: q for q in store.get_paper_questions(paper_id)}
        for q in questions:
            o = old.get(q["id"])
            if o:
                if not q.get("correct_answer") and o.get("correct_answer"):
                    q["correct_answer"] = o["correct_answer"]
                if o.get("knowledge_point"):
                    q["knowledge_point"] = o["knowledge_point"]

        meta = build_meta(all_pages, questions, files[0].get("filename") or "")
        store.replace_paper_questions(paper_id, questions)
        fields = {"status": "ready", "stage": "done", "meta": meta,
                  "progress_done": 1, "progress_total": 1, "progress_label": "完成"}
        if not paper.get("title"):
            fields["title"] = meta.get("title")
        store.update_paper(paper_id, **fields)
        events.publish(paper_id, "paper_done", {"status": "ready"})

    except Exception as exc:  # noqa: BLE001
        store.update_paper(paper_id, status="error", error=f"{type(exc).__name__}: {exc}")
        events.publish(paper_id, "paper_error", {"error": f"{type(exc).__name__}: {exc}"})
        raise


# ---------------------------------------------------------------------------
# 新流程：作答判分（Gemini 只输出 题号->学生答案，token 极小）
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

        def blank(li: int) -> dict:
            return {"page": li, "answers": []}

        # 试卷自己的 pages_raw.json 是题号归一化后的版本；共享 sha 缓存是原始
        # 节内编号（跨试卷复用，不能按某张卷改写），优先用前者取手写答案
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
                        for q in p.get("questions") or []:
                            put(q.get("number"), q.get("student_marked"),
                                q.get("student_marked_confidence"))
            elif full_cache and full_cache.exists():
                # 同一文件做过试卷全量识别（学生答在试卷上的场景）：直接取
                # 其中的 student_marked，零 Gemini 成本
                for p in json.loads(full_cache.read_text(encoding="utf-8")):
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
                    ),
                    blank,
                )
                for p in results:
                    for a in p.get("answers") or []:
                        put(a.get("number"), a.get("answer"), a.get("confidence"))
            done_pages += n

        _set_progress(job_id, "consolidate", 0, 1, "正在对照标准答案判分…")
        questions = grade_submission_questions(paper_qs, {k: v[0] for k, v in answers.items()})

        # 低置信度识别（涂改、字迹模糊）不可信：即便恰好与标准答案一致也不判对，
        # 标为"待确认"交老师在结果页核对修正
        low_nums = {k for k, v in answers.items() if v[1] <= _CONF["low"]}
        for q in questions:
            if str(q["number"]) in low_nums and q["status"] in ("correct", "wrong"):
                q["status"] = "unknown"

        # 补拍重跑：与上次结果合并——老师人工修正过的题（overridden）原样保留；
        # 新照片没拍到的题保留旧答案与判定；答案与判定未变的题保留已生成的讲解
        old_qs = {q["id"]: q for q in store.get_questions(job_id)}
        for q in questions:
            o = old_qs.get(q["id"])
            if not o:
                continue
            if o.get("overridden"):
                q["student_answer"] = o.get("student_answer")
                q["status"] = o["status"]
                q["overridden"] = True
            elif not q.get("student_answer") and o.get("student_answer"):
                q["student_answer"] = o["student_answer"]
                q["status"] = o["status"]
            if (q.get("student_answer") == o.get("student_answer")
                    and q.get("status") == o.get("status")):
                q["explanation"] = o.get("explanation")
                q["explain_state"] = o.get("explain_state") or "none"
                if o.get("knowledge_point"):
                    q["knowledge_point"] = o["knowledge_point"]
        meta = {"title": job.get("paper_title") or "试卷",
                "total_questions": len(questions)}

        store.replace_questions(job_id, questions)
        store.update_job(
            job_id, status="done", stage="done", meta=meta,
            title=job.get("paper_title"), stats=_stats(questions),
            progress_done=1, progress_total=1, progress_label="完成",
        )
        events.publish(job_id, "job_done", {"status": "done"})

        from . import workers  # 局部导入，避免与 workers -> pipeline 形成环

        targets = [q["id"] for q in questions if q.get("status") in ("wrong", "unknown")]
        if targets:
            workers.enqueue_explanations(job_id, targets, priority=1)

    except Exception as exc:  # noqa: BLE001
        store.update_job(job_id, status="error", error=f"{type(exc).__name__}: {exc}")
        events.publish(job_id, "job_error", {"error": f"{type(exc).__name__}: {exc}"})
        raise
