from __future__ import annotations

import pytest

from app import llm, llm_schemas, store, workers

REAL_VISION_PAGES = llm.vision_extract_pages


def test_schema_normalizes_compatible_values_and_preserves_notes():
    page = llm_schemas.validate_vision_page({
        "page": 1,
        "questions": [{
            "number": 1, "section": "第一节", "stem": "题",
            "continuation": {"target_page": 1, "target_question_index": 1},
        }],
        "answer_occurrences": [{"number": 1, "answer": "A", "page": 1}],
        "notes": "保留备注",
    }, "paper")

    assert page["questions"][0]["number"] == "1"
    assert page["answer_occurrences"][0]["local_number"] == "1"
    assert page["notes"] == "保留备注"
    assert "error" not in page
    explanation = llm_schemas.validate_explanations({
        "explanations": {"q1": {"answer_analysis": "解析", "examples": "例子"}},
    })
    assert explanation["q1"]["examples"] == ["例子"]


def test_invalid_page_becomes_page_error_instead_of_batch_failure(monkeypatch):
    def invalid_page(*args, **kwargs):
        raise llm_schemas.LLMSchemaError("bad confidence")

    monkeypatch.setattr(llm, "vision_extract_page", invalid_page)
    monkeypatch.setattr(llm, "vision_extract_pages", REAL_VISION_PAGES)

    results = REAL_VISION_PAGES([(1, "data"), (2, "data")], stage_timeout=1)

    assert len(results) == 2
    assert all("bad confidence" in result["error"] for result in results)


def test_invalid_confidence_is_rejected():
    with pytest.raises(llm_schemas.LLMSchemaError):
        llm_schemas.validate_vision_page({
            "page": 1,
            "answers": [{"number": "1", "answer": "A", "confidence": "certain"}],
        }, "submission")


def test_invalid_explanation_never_stays_generating(monkeypatch):
    owner_id = store.create_user("schema-explain-owner", "hash")
    store.create_job("schema-explain-job", owner_id, "paper.pdf")
    store.replace_questions("schema-explain-job", [{
        "id": "q1", "number": "1", "status": "wrong",
        "student_answer": "B", "correct_answer": "A",
    }])
    store.mark_explain_queued("schema-explain-job", ["q1"])
    monkeypatch.setattr(llm, "deepseek_json", lambda *args, **kwargs: {
        "explanations": {"q1": {"answer_analysis": 123}},
    })

    workers._process_explain_batch("schema-explain-job", ["q1"])

    assert store.get_question("schema-explain-job", "q1")["explain_state"] == "failed"


def test_invalid_knowledge_points_are_rejected():
    with pytest.raises(llm_schemas.LLMSchemaError):
        llm_schemas.validate_knowledge_points({"knowledge_points": []})
    with pytest.raises(llm_schemas.LLMSchemaError):
        llm_schemas.validate_knowledge_points({"knowledge_points": {"q1": 42}})
