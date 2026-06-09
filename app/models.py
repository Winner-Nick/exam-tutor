"""API 请求体模型。"""
from __future__ import annotations

from pydantic import BaseModel


class AskRequest(BaseModel):
    question: str
    qid: str | None = None  # 针对某道题提问时带上题目 id；否则为整卷答疑


class OverrideRequest(BaseModel):
    student_answer: str | None = None  # 用户手动指定/修正自己的答案
    status: str | None = None  # 主观/简答题可由用户直接标记 correct/wrong/unknown
