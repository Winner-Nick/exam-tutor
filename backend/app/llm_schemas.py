"""LLM 结构化输出的边界校验与兼容归一化。"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator


class LLMSchemaError(ValueError):
    pass


def _schema_error(exc: ValidationError) -> LLMSchemaError:
    return LLMSchemaError(f"LLM 输出 schema 不合法: {exc}")


def _number_text(value) -> str:
    if isinstance(value, bool):
        raise ValueError("题号不能为布尔值")
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, str):
        return value
    raise ValueError("题号必须是字符串或整数")


def _optional_number_text(value) -> str:
    if value is None:
        return ""
    return _number_text(value)


def _positive_int(value) -> int:
    if isinstance(value, bool):
        raise ValueError("页码不能为布尔值")
    number = int(value)
    if number < 1:
        raise ValueError("页码必须大于 0")
    return number


class _Model(BaseModel):
    model_config = ConfigDict(extra="allow", str_strip_whitespace=False)


class ContinuationSchema(_Model):
    target_page: int
    target_question_index: int

    _positive = field_validator("target_page", "target_question_index", mode="before")(_positive_int)


class QuestionSchema(_Model):
    number: str = Field(min_length=1, max_length=20)
    section: str | None = Field(default=None, max_length=200)
    type: str | None = Field(default=None, max_length=100)
    stem: str | None = Field(default="", max_length=30000)
    options: dict[str, str] | None = None
    passage: str | None = Field(default=None, max_length=60000)
    continuation: ContinuationSchema | None = None
    needs_review: bool = False
    student_marked: str | None = Field(default=None, max_length=6000)
    student_marked_confidence: Literal["high", "medium", "low"] | None = None

    _number = field_validator("number", mode="before")(_number_text)

    @field_validator("options", mode="before")
    @classmethod
    def validate_options(cls, value):
        if value is None:
            return None
        if not isinstance(value, dict) or len(value) > 40:
            raise ValueError("options 必须是不超过 40 项的对象")
        normalized = {}
        for key, text in value.items():
            key_text = _number_text(key)
            if not key_text or len(key_text) > 10 or not isinstance(text, str) or len(text) > 6000:
                raise ValueError("选项标签或内容不合法")
            normalized[key_text] = text
        return normalized

    @field_validator("continuation", mode="before")
    @classmethod
    def allow_false_continuation(cls, value):
        return None if value is False else value


class AnswerOccurrenceSchema(_Model):
    section: str | None = Field(default=None, max_length=200)
    local_number: str = Field(min_length=1, max_length=20)
    page: int | None = None
    answer: str = Field(min_length=1, max_length=6000)

    _number = field_validator("local_number", mode="before")(_number_text)
    _positive = field_validator("page", mode="before")(_positive_int)

    @model_validator(mode="before")
    @classmethod
    def accept_number_alias(cls, value):
        if isinstance(value, dict) and not value.get("local_number") and value.get("number") is not None:
            return {**value, "local_number": value["number"]}
        return value


class SubmissionAnswerSchema(_Model):
    number: str = Field(min_length=1, max_length=20)
    answer: str = Field(min_length=1, max_length=6000)
    confidence: Literal["high", "medium", "low"] | None = None

    _number = field_validator("number", mode="before")(_number_text)


class PageSchema(_Model):
    page: int
    page_role: list[str] = Field(default_factory=list, max_length=12)
    raw_text: str = Field(default="", max_length=120000)
    questions: list[QuestionSchema] = Field(default_factory=list, max_length=250)
    answer_occurrences: list[AnswerOccurrenceSchema] = Field(default_factory=list, max_length=500)
    answers: list[SubmissionAnswerSchema] = Field(default_factory=list, max_length=500)
    answer_key: dict[str, str] = Field(default_factory=dict)
    notes: str = Field(default="", max_length=12000)
    error: str | None = Field(default=None, max_length=6000)

    _positive = field_validator("page", mode="before")(_positive_int)

    @field_validator("page_role", mode="before")
    @classmethod
    def validate_page_role(cls, value):
        if value is None:
            return []
        if not isinstance(value, list) or any(not isinstance(item, str) or len(item) > 40 for item in value):
            raise ValueError("page_role 必须是字符串数组")
        return value

    @field_validator("answer_key", mode="before")
    @classmethod
    def validate_legacy_answer_key(cls, value):
        if value is None:
            return {}
        if not isinstance(value, dict) or len(value) > 500:
            raise ValueError("answer_key 必须是不超过 500 项的对象")
        normalized = {}
        for number, answer in value.items():
            key = _number_text(number)
            if not key or len(key) > 20 or not isinstance(answer, str) or not answer or len(answer) > 6000:
                raise ValueError("answer_key 的题号或答案不合法")
            normalized[key] = answer
        return normalized


class KnowledgeSchema(_Model):
    knowledge_points: dict[str, str | None]

    @field_validator("knowledge_points", mode="before")
    @classmethod
    def validate_mapping(cls, value):
        if not isinstance(value, dict) or len(value) > 250:
            raise ValueError("knowledge_points 必须是不超过 250 项的对象")
        normalized = {}
        for qid, point in value.items():
            if not isinstance(qid, str) or not qid or len(qid) > 64:
                raise ValueError("知识点题目 ID 不合法")
            if point is not None and (not isinstance(point, str) or len(point) > 200):
                raise ValueError("知识点名称不合法")
            normalized[qid] = point
        return normalized


class ExplanationSchema(_Model):
    knowledge_point: str = Field(default="", max_length=200)
    answer_analysis: str = Field(default="", max_length=6000)
    why_wrong: str = Field(default="", max_length=4000)
    tips: str = Field(default="", max_length=4000)
    examples: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("examples", mode="before")
    @classmethod
    def validate_examples(cls, value):
        if value is None:
            return []
        if isinstance(value, str):
            value = [value]
        if not isinstance(value, list):
            raise ValueError("examples 必须是字符串数组")
        if any(not isinstance(item, str) or len(item) > 3000 for item in value):
            raise ValueError("examples 内容不合法")
        return value


class ExplanationResultSchema(_Model):
    explanations: dict[str, ExplanationSchema]

    @field_validator("explanations", mode="before")
    @classmethod
    def validate_mapping(cls, value):
        if not isinstance(value, dict) or len(value) > 50:
            raise ValueError("explanations 必须是不超过 50 项的对象")
        for qid in value:
            if not isinstance(qid, str) or not qid or len(qid) > 64:
                raise ValueError("讲解题目 ID 不合法")
        return value


def validate_vision_page(data: dict, kind: str) -> dict:
    if kind not in ("paper", "submission"):
        raise LLMSchemaError(f"未知视觉输出类型: {kind}")
    if not isinstance(data, dict):
        raise LLMSchemaError("视觉输出必须是 JSON 对象")
    try:
        normalized = PageSchema.model_validate(data).model_dump()
        if normalized.get("error") is None:
            normalized.pop("error", None)
        return normalized
    except ValidationError as exc:
        raise _schema_error(exc) from exc


def validate_knowledge_points(data: dict) -> dict[str, str | None]:
    if not isinstance(data, dict):
        raise LLMSchemaError("知识点输出必须是 JSON 对象")
    try:
        return KnowledgeSchema.model_validate(data).knowledge_points
    except ValidationError as exc:
        raise _schema_error(exc) from exc


def validate_explanations(data: dict) -> dict[str, dict]:
    if not isinstance(data, dict):
        raise LLMSchemaError("讲解输出必须是 JSON 对象")
    try:
        return ExplanationResultSchema.model_validate(data).model_dump()["explanations"]
    except ValidationError as exc:
        raise _schema_error(exc) from exc
