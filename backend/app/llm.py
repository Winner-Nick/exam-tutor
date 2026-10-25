"""DeepSeek 中转客户端：视觉识别、结构化讲解与实时答疑。"""
from __future__ import annotations

import json
import logging
import random
import re
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from typing import Any, Callable

from openai import APIConnectionError, APITimeoutError, InternalServerError, OpenAI, RateLimitError

from . import llm_schemas, prompts
from .config import settings

logger = logging.getLogger(__name__)

_deepseek_client = OpenAI(
    api_key=settings.deepseek_api_key,
    base_url=settings.deepseek_base_url,
    timeout=120,
    max_retries=0,
)
_vision_semaphore = threading.BoundedSemaphore(max(1, settings.vision_concurrency))
_text_semaphore = threading.BoundedSemaphore(4)


class ModelResponseError(RuntimeError):
    pass


class ModelDeadlineError(TimeoutError):
    pass


def _decode_object(text: str) -> dict:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ModelResponseError("模型返回的不是合法 JSON") from exc
    if not isinstance(data, dict):
        raise ModelResponseError("模型返回的 JSON 顶层不是对象")
    return data


def _extract_json(text: str) -> dict:
    if not text or not text.strip():
        raise ModelResponseError("模型返回为空")
    stripped = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", stripped, re.S)
    if fence:
        stripped = fence.group(1).strip()
    try:
        return _decode_object(stripped)
    except ModelResponseError:
        start, end = stripped.find("{"), stripped.rfind("}")
        if start != -1 and end != -1 and end > start:
            return _decode_object(stripped[start : end + 1])
        raise


def _response_content(kind: str, resp, started: float) -> str:
    choice = resp.choices[0] if resp.choices else None
    logger.info(
        "llm=%s model=%s finish=%s usage=%s elapsed=%.2fs",
        kind, getattr(resp, "model", settings.deepseek_model),
        getattr(choice, "finish_reason", None), getattr(resp, "usage", None), time.monotonic() - started,
    )
    if choice is None:
        raise ModelResponseError("模型没有返回候选结果")
    if choice.finish_reason == "length":
        raise ModelResponseError("模型输出达到 token 上限")
    return choice.message.content or ""


def _is_retryable(exc: Exception) -> bool:
    return isinstance(exc, (
        ModelResponseError, APIConnectionError, APITimeoutError, RateLimitError, InternalServerError,
    ))


def _retry(
    fn: Callable[[], Any], tries: int = 3, base_delay: float = 2.0,
    total_timeout: float = 180, deadline: float | None = None,
) -> Any:
    limit = deadline if deadline is not None else time.monotonic() + total_timeout
    for attempt in range(tries):
        if time.monotonic() >= limit:
            raise ModelDeadlineError("模型任务超过总时限")
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 - 仅重试瞬态及可重试响应错误
            if not _is_retryable(exc) or attempt == tries - 1:
                raise
            remaining = limit - time.monotonic()
            if remaining <= 0:
                raise ModelDeadlineError("模型任务超过总时限") from exc
            time.sleep(min(base_delay * (2 ** attempt) + random.uniform(0, 0.5), remaining))
    raise ModelDeadlineError("模型任务超过总时限")


# ---------------------------------------------------------------------------
# 视觉：单页识别
# ---------------------------------------------------------------------------

def vision_extract_page(
    data_url: str,
    page_index: int,
    system: str | None = None,
    user: str | None = None,
    max_tokens: int = 6000,
    deadline: float | None = None,
    schema_kind: str | None = None,
) -> dict:
    """用 DeepSeek 识别一页扫描图，返回结构化 dict。"""

    def call() -> dict:
        with _vision_semaphore:
            started = time.monotonic()
            resp = _deepseek_client.chat.completions.create(
                model=settings.deepseek_model,
                temperature=0,
                max_tokens=max_tokens,
                messages=[
                    {"role": "system", "content": system or prompts.VISION_SYSTEM},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": user or prompts.vision_user(page_index)},
                            {"type": "image_url", "image_url": {"url": data_url}},
                        ],
                    },
                ],
            )
        return _extract_json(_response_content("vision", resp, started))

    data = _retry(call, deadline=deadline)
    data["page"] = page_index
    kind = schema_kind or ("submission" if system == prompts.SUBMISSION_VISION_SYSTEM else "paper")
    return llm_schemas.validate_vision_page(data, kind)


def vision_extract_pages(
    pages: list[tuple[int, str]],
    on_progress: Callable[[int, int], None] | None = None,
    system: str | None = None,
    user_builder: Callable[[int], str] | None = None,
    max_tokens: int = 6000,
    on_page: Callable[[dict], None] | None = None,
    stage_timeout: float = 600,
    schema_kind: str | None = None,
) -> list[dict]:
    """有界并发识别多页，每页完成即可回调保存检查点。"""
    results: dict[int, dict] = {}
    done = 0
    total = len(pages)
    deadline = time.monotonic() + stage_timeout
    pending = {}
    page_iter = iter(pages)

    def submit_next(pool: ThreadPoolExecutor) -> bool:
        try:
            idx, url = next(page_iter)
        except StopIteration:
            return False
        kwargs = {"schema_kind": schema_kind} if schema_kind is not None else {}
        future = pool.submit(
            vision_extract_page, url, idx, system,
            user_builder(idx) if user_builder else None, max_tokens, deadline,
            **kwargs,
        )
        pending[future] = idx
        return True

    with ThreadPoolExecutor(max_workers=max(1, settings.vision_concurrency)) as pool:
        for _ in range(max(1, settings.vision_concurrency) * 2):
            if not submit_next(pool):
                break
        while pending:
            completed, _ = wait(pending, return_when=FIRST_COMPLETED)
            for future in completed:
                idx = pending.pop(future)
                try:
                    result = future.result()
                except Exception as exc:  # noqa: BLE001
                    result = {
                        "page": idx,
                        "page_role": ["other"],
                        "raw_text": "",
                        "questions": [],
                        "answers": [],
                        "answer_key": {},
                        "error": f"{type(exc).__name__}: {exc}",
                    }
                results[idx] = result
                if on_page:
                    on_page(result)
                done += 1
                if on_progress:
                    on_progress(done, total)
                submit_next(pool)
    return [results[i] for i in sorted(results)]


# ---------------------------------------------------------------------------
# 文本：DeepSeek
# ---------------------------------------------------------------------------

def _json_messages(system: str, user: str) -> list[dict]:
    return [
        {"role": "system", "content": "只输出合法 JSON，不要 Markdown 代码围栏。"},
        {"role": "user", "content": f"{system}\n\n{user}"},
    ]


def _chat_messages(messages: list[dict]) -> list[dict]:
    instructions = [str(message.get("content") or "") for message in messages
                    if message.get("role") == "system" and message.get("content")]
    if not instructions:
        return messages
    remaining = [dict(message) for message in messages if message.get("role") != "system"]
    combined = "\n\n".join(instructions)
    for message in remaining:
        if message.get("role") == "user" and isinstance(message.get("content"), str):
            message["content"] = combined + "\n\n" + message["content"]
            return remaining
    return [{"role": "user", "content": combined}, *remaining]


def deepseek_json(system: str, user: str, max_tokens: int = 8000,
                  deadline: float | None = None) -> dict:
    def call() -> dict:
        with _text_semaphore:
            started = time.monotonic()
            resp = _deepseek_client.chat.completions.create(
                model=settings.deepseek_model,
                temperature=0,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
                messages=_json_messages(system, user),
            )
        return _extract_json(_response_content("json", resp, started))

    return _retry(call, deadline=deadline)


def deepseek_chat(messages: list[dict], max_tokens: int = 1500,
                  deadline: float | None = None) -> str:
    def call() -> str:
        with _text_semaphore:
            started = time.monotonic()
            resp = _deepseek_client.chat.completions.create(
                model=settings.deepseek_model,
                temperature=0.4,
                max_tokens=max_tokens,
                messages=_chat_messages(messages),
            )
        content = _response_content("chat", resp, started)
        if not content.strip():
            raise ModelResponseError("模型返回为空")
        return content

    return _retry(call, deadline=deadline)
