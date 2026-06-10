"""核心处理流水线：渲染 -> 视觉识别 -> 汇总判分 -> 错题讲解。"""
from __future__ import annotations

import json
import re
import shutil

from . import events, llm, pdf_utils, store

_CONF = {"high": 3, "medium": 2, "low": 1}
_SUBJECTIVE_HINT = ("文段表达", "作文", "写作", "writing", "范文")


def _num_key(num: str):
    digits = re.sub(r"\D", "", str(num))
    return int(digits) if digits else 10**9


def build_questions(pages: list[dict]) -> tuple[list[dict], dict]:
    """把各页视觉识别结果在代码里合并为题目列表并判分。

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
            # 非选择题（简答/翻译）：有参考答案但难以自动比对手写文本，交用户自评
            q["status"] = "unknown"


def build_meta(pages: list[dict], questions: list[dict], filename: str) -> dict:
    raw = (pages[0].get("raw_text") if pages else "") or ""
    title = None
    for line in raw.splitlines():
        s = line.strip()
        if len(s) >= 6 and any(w in s for w in ("试卷", "练习", "考试", "中考", "模拟", "测试")):
            title = s
            break
    if not title:
        for line in raw.splitlines():
            if line.strip():
                title = line.strip()[:40]
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
