"""LLM 客户端封装：Gemini 视觉（OpenRouter）+ DeepSeek 文本。"""
from __future__ import annotations

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable

from openai import OpenAI

from . import prompts
from .config import settings

_vision_client = OpenAI(
    api_key=settings.openrouter_api_key,
    base_url=settings.openrouter_base_url,
)
_deepseek_client = OpenAI(
    api_key=settings.deepseek_api_key,
    base_url=settings.deepseek_base_url,
)


# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------

def _extract_json(text: str) -> dict:
    """从模型输出中稳健地解析 JSON（容忍 ``` 包裹或前后多余文字）。"""
    if not text or not text.strip():
        raise ValueError("模型返回为空")
    t = text.strip()
    # 去掉 ```json ... ``` 包裹
    fence = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if fence:
        t = fence.group(1).strip()
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        # 退而求其次：截取第一个 { 到最后一个 }
        start, end = t.find("{"), t.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(t[start : end + 1])
        raise


def _retry(fn: Callable[[], Any], tries: int = 3, base_delay: float = 2.0) -> Any:
    last: Exception | None = None
    for attempt in range(tries):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 - 透传最后一次错误
            last = exc
            if attempt < tries - 1:
                time.sleep(base_delay * (attempt + 1))
    assert last is not None
    raise last


# ---------------------------------------------------------------------------
# 视觉：单页识别
# ---------------------------------------------------------------------------

def vision_extract_page(data_url: str, page_index: int) -> dict:
    """用 Gemini 识别一页扫描图，返回结构化 dict。"""

    def call() -> str:
        resp = _vision_client.chat.completions.create(
            model=settings.vision_model,
            temperature=0,
            max_tokens=6000,
            messages=[
                {"role": "system", "content": prompts.VISION_SYSTEM},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompts.vision_user(page_index)},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                },
            ],
        )
        return resp.choices[0].message.content or ""

    raw = _retry(call)
    data = _extract_json(raw)
    data.setdefault("page", page_index)
    data["page"] = page_index
    return data


def vision_extract_pages(
    pages: list[tuple[int, str]],
    on_progress: Callable[[int, int], None] | None = None,
) -> list[dict]:
    """并发识别多页。pages 为 [(page_index, data_url), ...]，返回按页序排列的结果。"""
    results: dict[int, dict] = {}
    done = 0
    total = len(pages)
    with ThreadPoolExecutor(max_workers=settings.vision_concurrency) as pool:
        futures = {
            pool.submit(vision_extract_page, url, idx): idx for idx, url in pages
        }
        for fut in as_completed(futures):
            idx = futures[fut]
            try:
                results[idx] = fut.result()
            except Exception as exc:  # noqa: BLE001
                results[idx] = {
                    "page": idx,
                    "page_role": ["other"],
                    "raw_text": "",
                    "questions": [],
                    "answer_key": {},
                    "error": f"{type(exc).__name__}: {exc}",
                }
            done += 1
            if on_progress:
                on_progress(done, total)
    return [results[i] for i in sorted(results)]


# ---------------------------------------------------------------------------
# 文本：DeepSeek
# ---------------------------------------------------------------------------

def deepseek_json(system: str, user: str, max_tokens: int = 8000) -> dict:
    def call() -> str:
        resp = _deepseek_client.chat.completions.create(
            model=settings.deepseek_model,
            temperature=0,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        return resp.choices[0].message.content or ""

    raw = _retry(call)
    return _extract_json(raw)


def deepseek_chat(messages: list[dict], max_tokens: int = 1500) -> str:
    def call() -> str:
        resp = _deepseek_client.chat.completions.create(
            model=settings.deepseek_model,
            temperature=0.4,
            max_tokens=max_tokens,
            messages=messages,
        )
        return resp.choices[0].message.content or ""

    return _retry(call)
