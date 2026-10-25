from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor

from app import chat_store, llm, store
from app.models import AskRequest
from app.routers.chat import ask


def test_chat_recent_and_cursor_pages():
    user_id = store.create_user("chat-owner", "hash")
    store.create_job("chat-job", user_id, "paper.pdf")
    for index in range(30):
        store.add_chat_message("chat-job", None, "user", f"m{index}")

    recent = chat_store.recent_chat("chat-job", None)
    assert [item["content"] for item in recent] == [f"m{index}" for index in range(18, 30)]

    page, has_more = chat_store.get_chat_page("chat-job", None, limit=10)
    assert has_more is True
    assert [item["content"] for item in page] == [f"m{index}" for index in range(20, 30)]
    previous, has_more = chat_store.get_chat_page("chat-job", None, limit=10, before_id=page[0]["id"])
    assert has_more is True
    assert [item["content"] for item in previous] == [f"m{index}" for index in range(10, 20)]


def test_concurrent_asks_keep_question_answer_pairs(monkeypatch):
    user_id = store.create_user("chat-owner", "hash")
    store.create_job("chat-job", user_id, "paper.pdf")
    job = store.get_job("chat-job")
    user = {"id": user_id, "role": "user"}

    def fake_chat(messages):
        time.sleep(0.02)
        return "reply:" + messages[-1]["content"]

    monkeypatch.setattr(llm, "deepseek_chat", fake_chat)
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda text: ask(AskRequest(question=text), job, user), ["A", "B"]))

    messages = chat_store.recent_chat("chat-job", None, limit=10)
    assert [item["role"] for item in messages] == ["user", "assistant", "user", "assistant"]
    for user_message, assistant_message in zip(messages[::2], messages[1::2]):
        assert assistant_message["content"] == "reply:" + user_message["content"]
