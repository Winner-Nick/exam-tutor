"""核心处理流水线：渲染 -> 视觉识别 -> 汇总判分 -> 错题讲解。"""
from __future__ import annotations

import json
import re
import shutil
import threading
import unicodedata
import weakref
from collections import Counter
from decimal import Decimal, InvalidOperation

from . import events, llm, pdf_utils, prompts, store
from .db import transaction

_CONF = {"high": 3, "medium": 2, "low": 1}
_SUBJECTIVE_HINT = (
    "主观", "简答", "解答", "论述", "文段表达", "作文", "写作", "范文",
    "subjective", "essay", "writing", "short_answer", "short answer",
)


def _num_key(num: str):
    digits = re.sub(r"\D", "", str(num))
    return int(digits) if digits else 10**9


def _number_conflicts(pages: list[dict]) -> set[str]:
    counts: dict[str, int] = {}
    answer_values: dict[str, set[str]] = {}
    conflicts: set[str] = set()
    for p in pages:
        for q in p.get("questions") or []:
            number = str(q.get("number") or "").strip()
            original = str(q.get("_original_number") or number).strip()
            key = store.normalize_number_key(original)
            if key:
                counts[key] = counts.get(key, 0) + 1
            if q.get("_number_conflict") and key:
                conflicts.add(key)
        for number, value in (p.get("answer_key") or {}).items():
            key = store.normalize_number_key(number)
            answer = str(value or "").strip()
            if key and answer:
                answer_values.setdefault(key, set()).add(answer)
    conflicts.update(key for key, count in counts.items() if count > 1)
    conflicts.update(key for key, values in answer_values.items() if len(values) > 1)
    return conflicts


def _mark_number_conflicts(pages: list[dict]) -> None:
    conflicts = _number_conflicts(pages)
    for p in pages:
        for q in p.get("questions") or []:
            original = str(q.get("_original_number") or q.get("number") or "").strip()
            if store.normalize_number_key(original) in conflicts:
                q["_original_number"] = original
                q["_number_conflict"] = True
                q["needs_review"] = True


def _answer_for(answer_key: dict[str, str], number: str) -> str | None:
    key = store.normalize_number_key(number)
    return next(
        (value for answer_number, value in answer_key.items()
         if store.normalize_number_key(answer_number) == key),
        None,
    )


def _merge_pages(pages: list[dict]) -> tuple[list[str], dict[str, dict], dict[str, str]]:
    """合并页面结果；原始重号或冲突答案绝不按后写覆盖套题。"""
    conflicts = _number_conflicts(pages)
    qmap: dict[str, dict] = {}
    order: list[str] = []
    for p in pages:
        for q in p.get("questions") or []:
            num = str(q.get("number") or "").strip()
            if not num:
                continue
            original = str(q.get("_original_number") or num).strip()
            answer_conflict = (
                store.normalize_number_key(num) in conflicts
                or store.normalize_number_key(original) in conflicts
                or bool(q.get("_number_conflict"))
            )
            if num not in qmap:
                qmap[num] = {
                    "number": num, "section": q.get("section"), "type": q.get("type"),
                    "stem": q.get("stem") or "", "options": q.get("options"),
                    "passage": q.get("passage"), "_sa": None, "_saconf": -1,
                    "needs_review": bool(q.get("needs_review")),
                    "_answer_conflict": answer_conflict,
                }
                order.append(num)
            cur = qmap[num]
            if q.get("needs_review") or answer_conflict:
                cur["needs_review"] = True
            if answer_conflict:
                cur["_answer_conflict"] = True
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
    seen: set[str] = set()
    for p in pages:
        for k, v in (p.get("answer_key") or {}).items():
            kk, key = str(k).strip(), store.normalize_number_key(k)
            if kk and key not in conflicts and key not in seen and str(v or "").strip():
                answer_key[kk] = str(v).strip()
                seen.add(key)
    return order, qmap, answer_key


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


def _normalize_full_page(page: dict) -> dict:
    normalized = dict(page)
    occurrences: list[dict] = []
    raw_occurrences = page.get("answer_occurrences")
    if isinstance(raw_occurrences, list):
        for item in raw_occurrences:
            if not isinstance(item, dict) or not str(item.get("answer") or "").strip():
                continue
            occurrence = dict(item)
            occurrence["section"] = item.get("section")
            occurrence["local_number"] = str(
                item.get("local_number") or item.get("number") or ""
            ).strip()
            occurrence["page"] = item.get("page") or page.get("_file_page") or page.get("page")
            occurrence["answer"] = str(item["answer"]).strip()
            occurrences.append(occurrence)
    for number, answer in (page.get("answer_key") or {}).items():
        if not str(answer or "").strip():
            continue
        occurrences.append({
            "section": None, "local_number": str(number).strip(),
            "page": page.get("_file_page") or page.get("page"),
            "answer": str(answer).strip(), "_legacy": True,
        })
    normalized["answer_occurrences"] = occurrences
    return normalized


def _prepare_source_occurrences(pages: list[dict]) -> None:
    for page in pages:
        normalized = _normalize_full_page(page)
        page.clear()
        page.update(normalized)
        file_page = page.get("_file_page") or page.get("page")
        file_sha = page.get("_file_sha") or page.get("file_sha256")
        for index, question in enumerate(page.get("questions") or [], start=1):
            local_number = str(question.get("_original_number") or question.get("number") or "").strip()
            source_key = (
                f"{file_sha}:{file_page}:q:{index}" if file_sha and file_page is not None else None
            )
            question["_source_key"] = source_key
            question["_source_uid"] = source_key or f"page:{page.get('page', 0)}:q:{index}"
            question["_source_occurrence"] = {
                "file_sha256": file_sha, "page": file_page, "index": index,
                "local_number": local_number, "section": question.get("section"),
                "continuation": question.get("continuation"),
            }
            question.setdefault("_original_number", local_number)
        for index, answer in enumerate(page.get("answer_occurrences") or [], start=1):
            source_key = (
                f"{file_sha}:{file_page}:a:{index}" if file_sha and file_page is not None else None
            )
            answer["file_sha256"] = file_sha
            answer["_source_key"] = source_key
            answer["_answer_uid"] = source_key or f"page:{page.get('page', 0)}:a:{index}"
            answer["_original_number"] = str(
                answer.get("local_number") or answer.get("number") or ""
            ).strip()


def _new_paper_occurrence(question: dict) -> dict:
    source = dict(question["_source_occurrence"])
    source_key = question.get("_source_key")
    return {
        "id": store.new_question_id(), "number": str(question.get("number") or "").strip() or None,
        "section": question.get("section"), "type": question.get("type"),
        "stem": question.get("stem") or "", "options": question.get("options") or None,
        "passage": question.get("passage"), "correct_answer": None, "knowledge_point": None,
        "needs_review": bool(question.get("needs_review") or not source_key),
        "source_key": source_key, "source_occurrence": source,
        "source_occurrences": [source], "aliases": [source_key] if source_key else [],
        "_source_uid": question["_source_uid"],
        "_original_numbers": {store.normalize_number_key(question.get("_original_number"))},
        "_answer_values": [], "_answer_conflict": False,
    }


def _merge_paper_continuation(target: dict, question: dict) -> None:
    source = dict(question["_source_occurrence"])
    target["source_occurrences"].append(source)
    if question.get("_source_key"):
        target["aliases"] = sorted(set(target["aliases"]) | {question["_source_key"]})
    target["_original_numbers"].add(store.normalize_number_key(question.get("_original_number")))
    target["needs_review"] = bool(target["needs_review"] or question.get("needs_review"))
    for field in ("section", "type", "passage"):
        if not target.get(field) and question.get(field):
            target[field] = question[field]
    if len(question.get("stem") or "") > len(target.get("stem") or ""):
        target["stem"] = question["stem"]
    options = question.get("options")
    if options and len(options) > len(target.get("options") or {}):
        target["options"] = options


def _answer_stub(answer: dict, *, legacy: bool) -> dict:
    number = str(answer.get("_global") or answer.get("_original_number") or "").strip() or None
    source = {
        "file_sha256": answer.get("file_sha256"),
        "page": answer.get("page"), "local_number": answer.get("_original_number"),
        "section": answer.get("section"), "kind": "answer",
        "observed_answer": answer.get("answer"),
    }
    return {
        "id": store.new_question_id(), "number": number, "section": answer.get("section"),
        "type": None, "stem": None, "options": None, "passage": None,
        "correct_answer": answer.get("answer") if legacy else None,
        "knowledge_point": None, "needs_review": not legacy or not answer.get("_source_key"),
        "source_key": answer.get("_source_key"), "source_occurrence": source,
        "source_occurrences": [source],
        "aliases": [answer["_source_key"]] if answer.get("_source_key") else [],
    }


def build_paper_questions(pages: list[dict]) -> list[dict]:
    """按 source occurrence 合并试卷题目，并逐条关联标准答案。"""
    _prepare_source_occurrences(pages)
    questions: list[dict] = []
    question_targets: dict[str, dict] = {}
    continuation_targets: dict[tuple[str, int, int], str] = {}
    for page in pages:
        file_sha = page.get("_file_sha") or page.get("file_sha256")
        for index, question in enumerate(page.get("questions") or [], start=1):
            if file_sha:
                continuation_targets[(file_sha, page.get("_file_page") or page.get("page"), index)] = (
                    question["_source_uid"]
                )
    for page in pages:
        for question in page.get("questions") or []:
            continuation = question.get("continuation")
            target = None
            if isinstance(continuation, dict):
                file_sha = page.get("_file_sha") or page.get("file_sha256")
                key = (
                    file_sha,
                    continuation.get("target_page"),
                    continuation.get("target_question_index"),
                )
                target_uid = continuation_targets.get(key) if file_sha else None
                target = question_targets.get(target_uid) if target_uid else None
            if target is not None:
                _merge_paper_continuation(target, question)
                question_targets[question["_source_uid"]] = target
                continue
            current = _new_paper_occurrence(question)
            if continuation:
                current["needs_review"] = True
            questions.append(current)
            question_targets[question["_source_uid"]] = current

    unmatched: list[tuple[dict, list[dict]]] = []
    for page in pages:
        for answer in page.get("answer_occurrences") or []:
            explicit_target = bool(answer.get("_question_uid"))
            target = question_targets.get(answer.get("_question_uid"))
            candidates = [target] if target is not None else []
            if not candidates and not explicit_target and answer.get("_global"):
                key = store.normalize_number_key(answer["_global"])
                candidates = [q for q in questions if store.normalize_number_key(q["number"]) == key]
            if not candidates and not explicit_target and not answer.get("_global"):
                key = store.normalize_number_key(answer.get("_original_number"))
                candidates = [q for q in questions if key in q["_original_numbers"]]
                section = answer.get("section")
                section_key = store.normalize_number_key(section)
                if (section and candidates and section_key not in
                        {"参考答案", "答案", "answer key", "answer_key", "answers", "answer"}):
                    candidates = [
                        q for q in candidates if any(
                            store.normalize_number_key(source.get("section")) == section_key
                            for source in q["source_occurrences"]
                        )
                    ]
            if len(candidates) == 1:
                candidates[0]["_answer_values"].append(str(answer.get("answer") or "").strip())
            else:
                if candidates:
                    for candidate in candidates:
                        candidate["_answer_conflict"] = True
                        candidate["needs_review"] = True
                elif explicit_target or answer.get("_global"):
                    original_key = store.normalize_number_key(answer.get("_original_number"))
                    for candidate in questions:
                        if original_key in candidate["_original_numbers"]:
                            candidate["needs_review"] = True
                unmatched.append((answer, candidates))

    for question in questions:
        values = {
            unicodedata.normalize("NFKC", value).strip().casefold(): value
            for value in question.pop("_answer_values") if value
        }
        if len(values) == 1 and not question.pop("_answer_conflict"):
            question["correct_answer"] = next(iter(values.values()))
        else:
            question.pop("_answer_conflict", None)
            if values or question.get("_answer_conflict"):
                question["needs_review"] = True
            question["correct_answer"] = None
        question.pop("_source_uid", None)
        question.pop("_original_numbers", None)

    legacy_stubs: dict[str, list[dict]] = {}
    for answer, candidates in unmatched:
        if candidates:
            continue
        if answer.get("_legacy"):
            legacy_stubs.setdefault(store.normalize_number_key(answer.get("_original_number")), []).append(answer)
        else:
            questions.append(_answer_stub(answer, legacy=False))
    for group in legacy_stubs.values():
        values = {item["answer"] for item in group}
        if len(values) == 1 and next(iter(values)).rstrip("。.") == "略":
            continue
        stub = _answer_stub(group[0], legacy=True)
        stub["source_occurrences"] = [item_source for item in group for item_source in [{
            "file_sha256": item.get("file_sha256"), "page": item.get("page"),
            "local_number": item.get("_original_number"), "section": item.get("section"),
            "kind": "answer", "observed_answer": item.get("answer"),
        }]]
        stub["aliases"] = sorted({item["_source_key"] for item in group if item.get("_source_key")})
        if len(values) > 1:
            stub["correct_answer"] = None
            stub["needs_review"] = True
        questions.append(stub)
    questions.sort(key=lambda q: _num_key(q.get("number")))
    return questions


def _global_numbering_ok(pages: list[dict]) -> bool:
    """题号已全局唯一且为纯数字时，无需归一化。"""
    seen: set[str] = set()
    for p in pages:
        for q in p.get("questions") or []:
            num = str(q.get("number") or "").strip()
            key = store.normalize_number_key(num)
            if not key:
                continue
            if key in seen or not num.isdigit():
                return False
            seen.add(key)
    return True


def _ensure_unique_numbers(pages: list[dict]) -> None:
    counts: dict[str, int] = {}
    for p in pages:
        for q in p.get("questions") or []:
            key = store.normalize_number_key(str(q.get("number") or "").strip())
            if key:
                counts[key] = counts.get(key, 0) + 1
    used: set[str] = set()
    for p in pages:
        occurrence = 0
        for q in p.get("questions") or []:
            original = str(q.get("number") or "").strip()
            original_key = store.normalize_number_key(original)
            if not original_key:
                continue
            occurrence += 1
            number = original
            if counts[original_key] > 1:
                q.setdefault("_original_number", original)
                base = f"{original}-U{p.get('page', 0)}-{occurrence}"
                number = base
                serial = 2
                while store.normalize_number_key(number) in used:
                    number = f"{base}-{serial}"
                    serial += 1
                q["needs_review"] = True
            q["number"] = number
            used.add(store.normalize_number_key(number))


def _renumber_pages(pages: list[dict]) -> None:
    """同时重编号题目 occurrence，并把答案 occurrence 映射到目标题。"""
    _prepare_source_occurrences(pages)
    compact: list[dict] = []
    answers: list[dict] = []
    for page in pages:
        for question in page.get("questions") or []:
            number = str(question.get("number") or "").strip()
            if not number:
                continue
            compact.append({
                "uid": question["_source_uid"], "page": question["_source_occurrence"]["page"],
                "number": number, "section": question.get("section"),
                "type": question.get("type"), "stem": (question.get("stem") or "")[:120],
            })
        for answer in page.get("answer_occurrences") or []:
            answers.append({
                "uid": answer["_answer_uid"], "section": answer.get("section"),
                "local_number": answer.get("_original_number"), "page": answer.get("page"),
                "answer": str(answer.get("answer") or "")[:40],
            })
    if not compact:
        return
    data = llm.deepseek_json(
        prompts.RENUMBER_SYSTEM, prompts.renumber_user(compact, answers), max_tokens=16000,
    )
    mapping = {
        str(item.get("uid")): str(item.get("global")).strip()
        for item in data.get("mapping") or []
        if item.get("uid") and item.get("global") is not None and str(item.get("global")).strip()
    }
    answer_mapping = {
        str(item.get("uid")): item
        for item in data.get("answer_mapping") or []
        if isinstance(item, dict) and item.get("uid")
    }
    for page in pages:
        for question in page.get("questions") or []:
            number = mapping.get(question["_source_uid"])
            if number:
                question["number"] = number
        for answer in page.get("answer_occurrences") or []:
            item = answer_mapping.get(answer["_answer_uid"]) or {}
            question_uid = str(item.get("question_uid") or "").strip()
            global_number = str(item.get("global") or "").strip()
            if question_uid:
                answer["_question_uid"] = question_uid
            if global_number:
                answer["_global"] = global_number


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
        if fpath is None or not fpath.is_file():
            raise FileNotFoundError(f"清单源文件缺失: {f.get('filename') or f['id']}")
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
_cache_locks: weakref.WeakValueDictionary[str, threading.Lock] = weakref.WeakValueDictionary()
_cache_locks_guard = threading.Lock()


def _cache_lock_for(key: str) -> threading.Lock:
    with _cache_locks_guard:
        lock = _cache_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _cache_locks[key] = lock
        return lock


def _is_blank_entry(p: dict) -> bool:
    return bool(p.get("blank")) or "blank" in (p.get("page_role") or [])


def _vision_file_pages(pages_dir, start: int, n: int, sha256: str | None,
                       mode: str, vision_call, blank_result) -> list[dict]:
    """识别文件的局部 1..n 页；缓存或模型缺页都会重识或返回 error 占位。"""
    cache = store.vision_cache_path(sha256, mode) if sha256 else None
    lock = _cache_lock_for(f"{sha256}:{mode}") if sha256 else threading.Lock()
    expected = set(range(1, n + 1))
    with lock:
        by_idx: dict[int, dict] = {}
        if cache and cache.exists():
            try:
                cached = json.loads(cache.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                cached = None
            if isinstance(cached, list):
                duplicates: set[int] = set()
                for raw_page in cached:
                    if not isinstance(raw_page, dict) or type(raw_page.get("page")) is not int:
                        continue
                    p = _normalize_full_page(raw_page) if mode == "full" else raw_page
                    page = p["page"]
                    if page not in expected:
                        continue
                    if page in by_idx:
                        duplicates.add(page)
                    else:
                        by_idx[page] = p
                for page in duplicates:
                    del by_idx[page]
                stale = set()
                for page, p in by_idx.items():
                    img = pages_dir / f"page_{start + page:02d}.jpg"
                    if p.get("error") or (
                            _is_blank_entry(p) and img.exists()
                            and not pdf_utils.is_blank_page(img)):
                        stale.add(page)
                for page in stale:
                    del by_idx[page]
                if expected <= set(by_idx):
                    return [by_idx[i] for i in range(1, n + 1)]

        payload = []
        for li in range(1, n + 1):
            if li in by_idx:
                continue
            img = pages_dir / f"page_{start + li:02d}.jpg"
            if pdf_utils.is_blank_page(img):
                r = blank_result(li)
                r["page"] = li
                r["blank"] = True
                by_idx[li] = r
            else:
                payload.append((li, pdf_utils.image_to_data_url(img)))
        requested = {li for li, _ in payload}
        if payload:
            for r in vision_call(payload):
                if (isinstance(r, dict) and type(r.get("page")) is int
                        and r["page"] in requested):
                    by_idx[r["page"]] = r
        for li in expected - set(by_idx):
            by_idx[li] = {
                "page": li, "error": "视觉识别未返回该页结果", "raw_text": "",
                "questions": [], "answer_occurrences": [], "answers": [],
            }
        results = [by_idx[i] for i in range(1, n + 1)]
        if mode == "full":
            normalized_results = []
            for result in results:
                normalized = _normalize_full_page(result)
                normalized.pop("answer_key", None)
                normalized_results.append(normalized)
            results = normalized_results
        if cache:
            store.write_json_atomic(cache, [p for p in results if not p.get("error")])
        return results


def _identity_aliases(question: dict) -> set[str]:
    aliases = {str(alias) for alias in (question.get("aliases") or []) if alias}
    if question.get("source_key"):
        aliases.add(question["source_key"])
    return aliases


def _legacy_identity_match(question: dict, previous: dict) -> bool:
    if previous.get("source_key") or previous.get("manual_created"):
        return False
    legacy_qid = "q" + str(question.get("number") or "")
    return previous["id"] == legacy_qid or legacy_qid in (previous.get("aliases") or [])


def _reconcile_paper_identity(paper_id: str, questions: list[dict]) -> list[dict]:
    previous = store.get_paper_questions(paper_id)
    tombstones = store.list_paper_question_tombstones(paper_id, full=True)
    used: set[str] = set()
    reconciled: list[dict] = []
    for question in questions:
        aliases = _identity_aliases(question)
        tomb_matches = [
            item for item in tombstones
            if aliases & _identity_aliases({"source_key": item.get("source_key"),
                                           "aliases": item.get("aliases")})
        ]
        if not tomb_matches:
            tomb_matches = [
                item for item in tombstones if _legacy_identity_match(question, {
                    "id": item["qid"], "source_key": item.get("source_key"),
                    "aliases": item.get("aliases"), "manual_created": False,
                })
            ]
        if len(tomb_matches) == 1:
            continue
        if len(tomb_matches) > 1:
            question["needs_review"] = True
            reconciled.append(question)
            continue

        matches = [
            old for old in previous if old["id"] not in used
            and aliases & _identity_aliases(old)
        ]
        if not matches:
            matches = [
                old for old in previous if old["id"] not in used
                and _legacy_identity_match(question, old)
            ]
        if len(matches) > 1:
            question["needs_review"] = True
            reconciled.append(question)
            continue
        if matches:
            old = matches[0]
            used.add(old["id"])
            question["id"] = old["id"]
            question["aliases"] = sorted(
                _identity_aliases(question) | _identity_aliases(old)
            )
            if old.get("edited"):
                question["correct_answer"] = old.get("correct_answer")
                question["edited"] = True
            elif not question.get("needs_review") and not question.get("correct_answer"):
                question["correct_answer"] = old.get("correct_answer")
            if old.get("content_edited"):
                for field in ("number", "section", "type", "stem", "options", "passage"):
                    question[field] = old.get(field)
                question["content_edited"] = True
            if old.get("knowledge_point"):
                question["knowledge_point"] = old["knowledge_point"]
        reconciled.append(question)

    recognized = {q["id"] for q in reconciled}
    for old in previous:
        if old["id"] in used or old["id"] in recognized:
            continue
        if old.get("manual_created"):
            reconciled.append(old)
        elif not old.get("source_key"):
            old["needs_review"] = True
            reconciled.append(old)
    reconciled.sort(key=lambda q: _num_key(q.get("number")))
    return reconciled


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
                        "questions": [], "answer_occurrences": [], "answers": []}

            for f, start, n in plans:
                def prog(done: int, total: int) -> None:
                    _set_paper_progress(paper_id, "vision", done_pages + done, page_count,
                                        f"正在识别第 {done_pages + done}/{page_count} 页…")
                results = _vision_file_pages(
                    pd / "pages", start, n, f.get("sha256"), "full",
                    lambda payload: llm.vision_extract_pages(payload, on_progress=prog), blank,
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
                    pass
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
            store.replace_paper_questions(paper_id, questions)
            if questions and not failed_pages:
                try:
                    complete_knowledge_points(paper_id, sync=False)
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
            store.update_paper(paper_id, **fields)
            paper_revision = store.get_paper(paper_id)["revision"]
            store.write_json_atomic(pd / "source_meta.json", {"paper_revision": paper_revision})
            regrade_paper_submissions(paper_id, force=True)
            events.publish(paper_id, "paper_done", {"status": fields["status"]})
        except Exception as exc:  # noqa: BLE001
            store.update_paper(paper_id, status="error", error=f"{type(exc).__name__}: {exc}")
            events.publish(paper_id, "paper_error", {"error": f"{type(exc).__name__}: {exc}"})
            raise


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


def regrade_paper_submissions(paper_id: str, *, force: bool = False) -> int:
    """按稳定 qid 全集 reconcile；每个提交独立在一个 DB 事务内落盘。"""
    changed_submissions = 0
    with store.paper_lock(paper_id):
        paper = store.get_paper(paper_id)
        if not paper:
            return 0
        paper_questions = store.get_paper_questions(paper_id)
        for job_id in store.list_submission_ids_for_paper(paper_id):
            with store.job_lock(job_id):
                job = store.get_job(job_id)
                if not job or job["status"] == "processing":
                    continue
                if not force and job.get("applied_paper_revision") == paper["revision"]:
                    continue
                old_questions = store.get_questions(job_id)
                questions = _assemble_submission_questions(paper_questions, old_questions, None)
                meta, status, error = _submission_snapshot(job, paper, paper_questions, questions)
                with transaction():
                    store.replace_questions(job_id, questions)
                    stats = store.refresh_stats(job_id)
                    store.update_job(
                        job_id, status=status, meta=meta, error=error,
                        applied_paper_revision=paper["revision"],
                    )
                changed_submissions += 1
                explain_targets = [
                    q["id"] for q in store.get_questions(job_id)
                    if q["status"] in ("wrong", "unknown") and not q.get("explanation")
                ]
                if explain_targets:
                    from . import workers
                    workers.enqueue_explanations(job_id, explain_targets, priority=1)
                events.publish(job_id, "job_done", {
                    "status": status, "regraded": True, "stats": stats,
                    "applied_paper_revision": paper["revision"],
                })
    return changed_submissions


def complete_knowledge_points(paper_id: str, overwrite: bool = False, *,
                              sync: bool = True) -> int:
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
        mapping = result.get("knowledge_points") or {}
        for q in batch:
            value = mapping.get(q["id"])
            if value and str(value).strip():
                pending[q["id"]] = str(value).strip()[:200]
    updated = store.update_paper_knowledge_points(
        paper_id, pending, mark_content_edited=False,
    ) if pending else 0
    if updated and sync:
        regrade_paper_submissions(paper_id)
    return updated


# ---------------------------------------------------------------------------
# 新流程：作答判分（DeepSeek 只输出 题号->学生答案，token 极小）
# ---------------------------------------------------------------------------

def grade_submission_questions(paper_questions: list[dict],
                               answers: dict[str, str]) -> list[dict]:
    """用试卷题目 + 学生答案组装提交；重号 occurrence 不共享作答或答案。"""
    return _assemble_submission_questions(paper_questions, [], answers)


def _answer_cache_mode(paper_id: str, revision: int) -> str:
    return f"ans-{paper_id}-r{revision}"


def process_submission(job_id: str) -> None:
    job = store.get_job(job_id)
    if not job:
        return
    jd = store.job_dir(job_id)
    try:
        paper = store.get_paper(job["paper_id"])
        if not paper:
            raise RuntimeError("试卷不存在")
        paper_revision = paper["revision"]
        paper_qs = store.get_paper_questions(job["paper_id"])
        if not paper_qs:
            raise RuntimeError("试卷尚未识别完成，请稍后重试")
        store.update_job(job_id, paper_revision=paper_revision)
        files = store.job_files(job_id)
        if not files:
            raise RuntimeError("提交没有任何文件")

        _set_progress(job_id, "render", 0, 1, "正在处理上传的页面…")
        plans = _render_files(jd, files, lambda fid: store.job_file_path(job_id, fid))
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
            if pf and paper_raw is not None:
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
                if sha and paper_revision == 1:
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
                results = _vision_file_pages(
                    jd / "pages", start, n, sha,
                    _answer_cache_mode(job["paper_id"], paper_revision),
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
                raise RuntimeError("试卷结构版本已变化，请重试本次提交")
            if paper["status"] != "ready":
                raise RuntimeError("试卷尚未确认完整，请先处理失败页或明确接受部分结果")
            paper_qs = store.get_paper_questions(job["paper_id"])
            if not paper_qs:
                raise RuntimeError("试卷没有题目，无法判分")
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
                from . import workers
                targets = [q["id"] for q in questions if q.get("status") in ("wrong", "unknown")]
                if targets:
                    workers.enqueue_explanations(job_id, targets, priority=1)

    except Exception as exc:  # noqa: BLE001
        store.update_job(job_id, status="error", error=f"{type(exc).__name__}: {exc}")
        events.publish(job_id, "job_error", {"error": f"{type(exc).__name__}: {exc}"})
        raise
