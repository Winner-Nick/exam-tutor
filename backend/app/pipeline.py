"""核心处理流水线：渲染 -> 视觉识别 -> 汇总判分 -> 错题讲解。"""
from __future__ import annotations

import json
import re

from . import llm, pdf_utils, prompts, store

EXPLAIN_CHUNK = 6  # 每批讲解的题目数
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
        # 1) 渲染 PDF
        _set_progress(job_id, "render", 0, 1, "正在渲染试卷页面…")
        imgs = pdf_utils.render_pdf_to_images(pdf_path, jd / "pages")
        store.update_job(job_id, page_count=len(imgs))

        # 2) 逐页视觉识别（结果缓存，便于重跑）
        pages_cache = jd / "pages_raw.json"
        if pages_cache.exists():
            pages = json.loads(pages_cache.read_text(encoding="utf-8"))
        else:
            payload = [(i + 1, pdf_utils.image_to_data_url(p)) for i, p in enumerate(imgs)]
            _set_progress(job_id, "vision", 0, len(payload), "正在识别试卷内容…")

            def prog(done: int, total: int) -> None:
                _set_progress(job_id, "vision", done, total, f"正在识别第 {done}/{total} 页…")

            pages = llm.vision_extract_pages(payload, on_progress=prog)
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

        # 4) 讲解做错/不确定的题
        targets = [q for q in questions if q.get("status") in ("wrong", "unknown")]
        if targets:
            done = 0
            by_id: dict[str, dict] = {}
            _set_progress(job_id, "explain", 0, len(targets), "正在讲解错题…")
            for i in range(0, len(targets), EXPLAIN_CHUNK):
                chunk = targets[i : i + EXPLAIN_CHUNK]
                try:
                    res = llm.deepseek_json(prompts.EXPLAIN_SYSTEM, prompts.explain_user(chunk))
                    by_id.update(res.get("explanations", {}) or {})
                except Exception:  # noqa: BLE001 - 单批失败不影响整体
                    pass
                done += len(chunk)
                _set_progress(job_id, "explain", done, len(targets), f"正在讲解错题 {done}/{len(targets)}…")
            for q in questions:
                exp = by_id.get(q.get("id"))
                if exp:
                    q["explanation"] = exp
                    if exp.get("knowledge_point") and not q.get("knowledge_point"):
                        q["knowledge_point"] = exp["knowledge_point"]

        # 5) 完成
        store.replace_questions(job_id, questions)
        store.update_job(
            job_id, status="done", stage="done", meta=meta,
            title=meta.get("title"), stats=_stats(questions),
            progress_done=1, progress_total=1, progress_label="完成",
        )

    except Exception as exc:  # noqa: BLE001
        store.update_job(job_id, status="error", error=f"{type(exc).__name__}: {exc}")
        raise
