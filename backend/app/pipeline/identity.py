from __future__ import annotations

import unicodedata

from .. import llm, prompts, store
from .shared import _CONF, _num_key

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
