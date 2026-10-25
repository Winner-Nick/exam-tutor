from __future__ import annotations

import re
import unicodedata
from decimal import Decimal, InvalidOperation

from .shared import _SUBJECTIVE_HINT

def _answer_text(value) -> str:
    return unicodedata.normalize("NFKC", "" if value is None else str(value)).strip()


def _choice_labels(value, legal: set[str]) -> list[str] | None:
    text = _answer_text(value).upper().strip("()[]（）【】")
    compact = re.sub(r"[\s,，、;；/\\|.．]+", "", text)
    if not compact or any(not c.isascii() or not c.isalnum() for c in compact):
        return None
    labels = list(compact)
    if len(labels) != len(set(labels)) or any(label not in legal for label in labels):
        return None
    return labels


def _numeric_value(value) -> Decimal | None:
    text = _answer_text(value).replace("−", "-")
    if not re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", text):
        return None
    try:
        number = Decimal(text)
    except InvalidOperation:
        return None
    return number if number.is_finite() else None


def _unreliable_reference(value: str) -> bool:
    normalized = re.sub(r"\s+", "", _answer_text(value)).casefold().rstrip("。.!")
    if normalized in {"略", "答案略", "参考答案略", "合理即可", "答案不唯一", "见解析", "待定", "unknown", "n/a"}:
        return True
    return "或" in normalized and len(normalized) <= 50


def _compare_fill(student, correct) -> str:
    sa, ca = _answer_text(student), _answer_text(correct)
    if not sa or not ca or _unreliable_reference(ca):
        return "unknown"
    sa_num, ca_num = _numeric_value(sa), _numeric_value(ca)
    if sa_num is not None and ca_num is not None:
        return "correct" if sa_num == ca_num else "wrong"
    normalize = lambda value: re.sub(r"\s+", "", value).casefold()
    return "correct" if normalize(sa) == normalize(ca) else "wrong"


def _grade_one(q: dict) -> None:
    """按题型选择可解释的 comparator；无法可靠比较时不猜测对错。"""
    opts = q.get("options") or {}
    ca, sa = q.get("correct_answer"), q.get("student_answer")
    hint = f"{q.get('type') or ''} {q.get('section') or ''}".casefold()
    if any(h in hint for h in _SUBJECTIVE_HINT):
        q["status"] = "subjective"
        return

    choice_hint = any(h in hint for h in ("选择", "单选", "多选", "choice", "select"))
    if opts or choice_hint:
        legal = {_answer_text(key).upper() for key in opts}
        if not legal or any(len(label) != 1 for label in legal):
            q["status"] = "unknown"
            return
        ca_labels, sa_labels = _choice_labels(ca, legal), _choice_labels(sa, legal)
        if ca_labels is None or sa_labels is None:
            q["status"] = "unknown"
            return
        single = "单选" in hint or "single" in hint
        multiple = not single and (
            "多选" in hint or "multi" in hint or len(ca_labels) > 1
        )
        if (single and (len(ca_labels) != 1 or len(sa_labels) != 1)) or (
                not multiple and (len(ca_labels) != 1 or len(sa_labels) != 1)):
            q["status"] = "unknown"
        else:
            q["status"] = "correct" if set(ca_labels) == set(sa_labels) else "wrong"
        return

    if any(h in hint for h in ("数值", "数字题", "numeric", "number")):
        sa_num, ca_num = _numeric_value(sa), _numeric_value(ca)
        q["status"] = (
            "unknown" if sa_num is None or ca_num is None
            else "correct" if sa_num == ca_num else "wrong"
        )
        return

    fill_hint = any(h in hint for h in ("填空", "fill", "blank"))
    if fill_hint:
        q["status"] = _compare_fill(sa, ca)
        return

    sa_text, ca_text = _answer_text(sa), _answer_text(ca)
    if not sa_text or not ca_text or _unreliable_reference(ca_text):
        q["status"] = "unknown"
    elif _compare_fill(sa_text, ca_text) == "correct":
        q["status"] = "correct"
    elif _numeric_value(sa_text) is not None and _numeric_value(ca_text) is not None:
        q["status"] = "wrong"
    elif len(ca_text) == 1 and ca_text.isalpha():
        q["status"] = "wrong"
    else:
        q["status"] = "unknown"


def _grade_all(questions: list[dict]) -> None:
    for q in questions:
        _grade_one(q)
