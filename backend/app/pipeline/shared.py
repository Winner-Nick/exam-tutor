from __future__ import annotations

import re

from .. import events, run_store, store

_CONF = {"high": 3, "medium": 2, "low": 1}
_SUBJECTIVE_HINT = (
    "主观", "简答", "解答", "论述", "文段表达", "作文", "写作", "范文",
    "subjective", "essay", "writing", "short_answer", "short answer",
)


def _num_key(num: str):
    digits = re.sub(r"\D", "", str(num))
    return int(digits) if digits else 10**9

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


def _assert_run(run: dict | None) -> None:
    if run is not None:
        run_store.assert_current(run["id"], run["generation"], run["attempt"])


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
    from .grading import _grade_one
    for q in questions:
        _grade_one(q)
