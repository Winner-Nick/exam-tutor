"""进程内事件总线 + SSE 流。

worker 线程 publish() -> 主事件循环的 asyncio.Queue -> SSE 异步生成器。
单进程内存态（run.sh 钉死 --workers 1）。
"""
from __future__ import annotations

import asyncio
import json
import threading
from typing import AsyncIterator, Callable

_loop: asyncio.AbstractEventLoop | None = None
_subs: dict[str, set[asyncio.Queue]] = {}
_lock = threading.Lock()

PING_INTERVAL = 15
QUEUE_SIZE = 128


def set_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def _offer(q: asyncio.Queue, event: str, data: dict) -> None:
    if q.full():
        if event == "progress":
            return
        try:
            q.get_nowait()
        except asyncio.QueueEmpty:
            pass
    try:
        q.put_nowait((event, data))
    except asyncio.QueueFull:
        pass


def publish(job_id: str, event: str, data: dict) -> None:
    """线程安全：可从任意 worker 线程调用。进程关停窗口内静默丢弃。"""
    if _loop is None:
        return
    with _lock:
        queues = list(_subs.get(job_id, ()))
    for q in queues:
        try:
            _loop.call_soon_threadsafe(_offer, q, event, data)
        except RuntimeError:
            return


def _subscribe(job_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_SIZE)
    with _lock:
        _subs.setdefault(job_id, set()).add(q)
    return q


def _unsubscribe(job_id: str, q: asyncio.Queue) -> None:
    with _lock:
        subs = _subs.get(job_id)
        if subs:
            subs.discard(q)
            if not subs:
                _subs.pop(job_id, None)


def _fmt(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def sse_stream(job_id: str, snapshot: dict | Callable[[], dict]) -> AsyncIterator[str]:
    """先订阅再读取快照；连接期间保留完成事件并限制待发送事件数。"""
    q = _subscribe(job_id)
    try:
        current = snapshot() if callable(snapshot) else snapshot
        yield _fmt("snapshot", current)
        while True:
            try:
                event, data = await asyncio.wait_for(q.get(), timeout=PING_INTERVAL)
            except asyncio.TimeoutError:
                yield ": ping\n\n"
                continue
            yield _fmt(event, data)
    finally:
        _unsubscribe(job_id, q)
