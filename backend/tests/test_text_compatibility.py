from __future__ import annotations

from types import SimpleNamespace

from app import llm, prompts


REAL_JSON = llm.deepseek_json
REAL_CHAT = llm.deepseek_chat


def response(content: str):
    return SimpleNamespace(
        model="test-model", usage=None,
        choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content=content))],
    )


class FakeClient:
    def __init__(self, handler):
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=handler))


def test_json_instructions_are_merged_into_user_for_relay(monkeypatch):
    monkeypatch.setattr(llm, "deepseek_json", REAL_JSON)
    captured = {}

    def create(**kwargs):
        captured.update(kwargs)
        return response('{"ok": true}')

    monkeypatch.setattr(llm, "_deepseek_client", FakeClient(create))
    assert REAL_JSON("原始系统指令", "原始用户输入") == {"ok": True}
    messages = captured["messages"]
    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"
    assert "原始系统指令" in messages[1]["content"]
    assert "原始用户输入" in messages[1]["content"]


def test_chat_system_instructions_are_preserved_without_system_role(monkeypatch):
    monkeypatch.setattr(llm, "deepseek_chat", REAL_CHAT)
    captured = {}

    def create(**kwargs):
        captured.update(kwargs)
        return response("回答")

    monkeypatch.setattr(llm, "_deepseek_client", FakeClient(create))
    result = REAL_CHAT([
        {"role": "system", "content": "指令一"},
        {"role": "user", "content": "问题一"},
        {"role": "assistant", "content": "旧回答"},
        {"role": "system", "content": "指令二"},
        {"role": "user", "content": "问题二"},
    ])
    assert result == "回答"
    messages = captured["messages"]
    assert all(message["role"] != "system" for message in messages)
    assert "指令一" in messages[0]["content"] and "指令二" in messages[0]["content"]
    assert "问题一" in messages[0]["content"]


def test_renumber_prompt_has_deterministic_section_example():
    assert "Section A" in prompts.RENUMBER_SYSTEM
    assert "依次是1和2" in prompts.RENUMBER_SYSTEM
