from __future__ import annotations

import queue
import threading

import pytest

from app import llm, store, workers


def make_wrong_question():
    user_id = store.create_user("worker-owner", "hash")
    store.create_job("worker-job", user_id, "paper.pdf")
    store.replace_questions("worker-job", [{
        "id": "q1", "number": "1", "status": "wrong",
        "student_answer": "B", "correct_answer": "A",
    }])
    store.mark_explain_queued("worker-job", ["q1"])


@pytest.mark.parametrize("payload", [
    {"explanations": []},
    {"explanations": {"q1": "not-an-object"}},
])
def test_invalid_explanation_shape_never_stays_generating(monkeypatch, payload):
    make_wrong_question()
    monkeypatch.setattr(llm, "deepseek_json", lambda *_args, **_kwargs: payload)

    workers._process_explain_batch("worker-job", ["q1"])

    assert store.get_question("worker-job", "q1")["explain_state"] == "failed"


def test_explain_queue_accounts_for_batched_and_deferred_items(monkeypatch):
    pending = queue.PriorityQueue()
    monkeypatch.setattr(workers, "_explain_q", pending)
    monkeypatch.setattr(workers, "_process_explain_batch", lambda _job, _qids: None)
    pending.put((0, 0, "job-a", "q1"))
    pending.put((0, 1, "job-b", "q2"))
    pending.put((0, 2, "job-a", "q3"))
    threading.Thread(target=workers._explain_worker, daemon=True).start()

    joined = threading.Event()
    threading.Thread(target=lambda: (pending.join(), joined.set()), daemon=True).start()
    assert joined.wait(2), "队列 task_done 计数不平衡"
