from __future__ import annotations

import threading
import time
from types import SimpleNamespace

import pytest

from app import llm


REAL_SLEEP = time.sleep
REAL_JSON = llm.deepseek_json
REAL_VISION_PAGE = llm.vision_extract_page
REAL_VISION_PAGES = llm.vision_extract_pages


@pytest.fixture(autouse=True)
def no_retry_sleep(monkeypatch):
    monkeypatch.setattr(llm.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(llm.random, "uniform", lambda _start, _end: 0)


def response(content: str, finish: str = "stop"):
    return SimpleNamespace(
        model="test-model",
        usage=None,
        choices=[SimpleNamespace(
            finish_reason=finish,
            message=SimpleNamespace(content=content),
        )],
    )


class FakeClient:
    def __init__(self, handler):
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=handler))


def test_json_response_retries_invalid_json(monkeypatch):
    monkeypatch.setattr(llm, "deepseek_json", REAL_JSON)
    calls = 0

    def create(**_kwargs):
        nonlocal calls
        calls += 1
        return response("not-json" if calls == 1 else '{"ok": true}')

    monkeypatch.setattr(llm, "_deepseek_client", FakeClient(create))
    assert REAL_JSON("system", "user") == {"ok": True}
    assert calls == 2


def test_non_retryable_error_stops_immediately(monkeypatch):
    monkeypatch.setattr(llm, "deepseek_json", REAL_JSON)
    calls = 0

    def create(**_kwargs):
        nonlocal calls
        calls += 1
        raise ValueError("invalid request")

    monkeypatch.setattr(llm, "_deepseek_client", FakeClient(create))
    with pytest.raises(ValueError, match="invalid request"):
        REAL_JSON("system", "user")
    assert calls == 1


def test_vision_pages_bound_concurrency_and_emit_checkpoints(monkeypatch):
    monkeypatch.setattr(llm, "vision_extract_page", REAL_VISION_PAGE)
    monkeypatch.setattr(llm, "vision_extract_pages", REAL_VISION_PAGES)
    active = 0
    maximum = 0
    lock = threading.Lock()

    def create(**_kwargs):
        nonlocal active, maximum
        with lock:
            active += 1
            maximum = max(maximum, active)
        REAL_SLEEP(0.02)
        with lock:
            active -= 1
        return response("{}")

    monkeypatch.setattr(llm, "_deepseek_client", FakeClient(create))
    checkpoints = []
    pages = [(index, "data:image/jpeg;base64,AA==") for index in range(1, 11)]
    result = REAL_VISION_PAGES(pages, on_page=checkpoints.append, stage_timeout=10)
    assert len(result) == 10
    assert len(checkpoints) == 10
    assert all("error" not in item for item in result)
    assert 0 < maximum <= 3


def test_length_response_becomes_page_error(monkeypatch):
    monkeypatch.setattr(llm, "vision_extract_page", REAL_VISION_PAGE)
    monkeypatch.setattr(llm, "vision_extract_pages", REAL_VISION_PAGES)
    monkeypatch.setattr(llm, "_deepseek_client", FakeClient(lambda **_kwargs: response("", "length")))
    result = REAL_VISION_PAGES([(1, "data:image/jpeg;base64,AA==")], stage_timeout=1)
    assert result[0]["page"] == 1
    assert "ModelResponseError" in result[0]["error"]


def test_expired_deadline_does_not_call_model():
    called = False

    def call():
        nonlocal called
        called = True

    with pytest.raises(llm.ModelDeadlineError):
        llm._retry(call, deadline=time.monotonic() - 1)
    assert called is False
