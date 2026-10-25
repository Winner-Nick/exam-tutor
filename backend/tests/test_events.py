from __future__ import annotations

import asyncio

from app import events


def test_snapshot_is_read_after_subscription(monkeypatch):
    monkeypatch.setattr(events, "_subs", {})
    monkeypatch.setattr(events, "_loop", None)

    async def run():
        events.set_loop(asyncio.get_running_loop())

        def snapshot():
            events.publish("job-1", "job_done", {"status": "done"})
            return {"status": "done"}

        stream = events.sse_stream("job-1", snapshot)
        first = await anext(stream)
        second = await anext(stream)
        await stream.aclose()
        return first, second

    first, second = asyncio.run(run())
    assert "event: snapshot" in first
    assert '"status": "done"' in first
    assert "event: job_done" in second


def test_bounded_queue_preserves_completion_event():
    queue = asyncio.Queue(maxsize=3)
    for index in range(20):
        events._offer(queue, "progress", {"done": index})
    assert queue.qsize() == 3
    events._offer(queue, "job_done", {"status": "done"})
    items = []
    while not queue.empty():
        items.append(queue.get_nowait())
    assert len(items) == 3
    assert items[-1] == ("job_done", {"status": "done"})
