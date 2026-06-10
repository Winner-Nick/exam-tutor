"""API 请求体模型。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class AskRequest(BaseModel):
    question: str
    qid: str | None = None  # 针对某道题提问时带上题目 id；否则为整卷答疑


class OverrideRequest(BaseModel):
    student_answer: str | None = None  # 用户手动指定/修正自己的答案
    status: str | None = None  # 主观/简答题可由用户直接标记 correct/wrong/unknown


class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=32, pattern=r"^[^\s]+$")
    password: str = Field(min_length=8, max_length=128)
    invite_code: str | None = None


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=8, max_length=128)


class InviteCreateRequest(BaseModel):
    max_uses: int = Field(default=1, ge=1, le=100)
    ttl_days: float | None = Field(default=30, gt=0, le=365)
