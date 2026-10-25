"""API 请求体模型。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    qid: str | None = Field(default=None, max_length=64)  # 针对某道题提问时带上题目 id；否则为整卷答疑


class OverrideRequest(BaseModel):
    student_answer: str | None = Field(default=None, max_length=2000)  # 用户手动指定/修正自己的答案
    status: str | None = Field(default=None, max_length=20)  # 主观/简答题可由用户直接标记 correct/wrong/unknown


class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=32, pattern=r"^[^\s]+$")
    password: str = Field(min_length=8, max_length=128)
    invite_code: str | None = None


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=128)


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class InviteCreateRequest(BaseModel):
    max_uses: int = Field(default=1, ge=1, le=100)
    ttl_days: float | None = Field(default=30, gt=0, le=365)


class StudentRequest(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    grade: str | None = Field(default=None, max_length=30)


class PaperUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=80)
    subject: str | None = Field(default=None, max_length=30)
    grade: str | None = Field(default=None, max_length=30)


class PaperAnswerRequest(BaseModel):
    correct_answer: str | None = Field(default=None, max_length=500)


class PaperQuestionPatchRequest(BaseModel):
    number: str | None = Field(default=None, min_length=1, max_length=20)
    type: str | None = Field(default=None, max_length=30)
    stem: str | None = Field(default=None, max_length=10000)
    options: dict[str, str] | None = None
    passage: str | None = Field(default=None, max_length=20000)
    correct_answer: str | None = Field(default=None, max_length=500)
    knowledge_point: str | None = Field(default=None, max_length=200)


class KnowledgePointsRequest(BaseModel):
    items: dict[str, str | None] | None = None
    overwrite: bool = False


class ReviewRequest(BaseModel):
    action: str = Field(pattern=r"^(attempt|mastered|reopen)$")
    answer: str | None = Field(default=None, max_length=2000)
    result: str | None = Field(default=None, pattern=r"^(correct|wrong)$")


class FeedbackRequest(BaseModel):
    message: str = Field(default="", max_length=2000)
    page: str = Field(default="", max_length=200)
    diag: dict = Field(default_factory=dict)


class PaperQuestionCreateRequest(BaseModel):
    number: str = Field(min_length=1, max_length=20)
    correct_answer: str | None = Field(default=None, max_length=500)
    type: str | None = Field(default=None, max_length=30)
    section: str | None = Field(default=None, max_length=100)
    stem: str | None = Field(default=None, max_length=10000)
    options: dict[str, str] | None = None
    passage: str | None = Field(default=None, max_length=20000)
    knowledge_point: str | None = Field(default=None, max_length=200)


class StudentAccountRequest(BaseModel):
    username: str = Field(min_length=2, max_length=32, pattern=r"^[^\s]+$")
    password: str = Field(min_length=8, max_length=128)


class StudentAccountPasswordRequest(BaseModel):
    password: str = Field(min_length=8, max_length=128)


class AdminPasswordRequest(BaseModel):
    password: str = Field(min_length=8, max_length=128)
