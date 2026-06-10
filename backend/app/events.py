"""进程内事件总线 + SSE 流。

worker 线程 publish() -> 主事件循环的 asyncio.Queue -> SSE 异步生成器。
单进程内存态（run.sh 钉死 --workers 1）。
"""
from __future__ import annotations

import asyncio
import json
import threading
from typing import AsyncIterator

_loop: asyncio.AbstractEventLoop | None = None
_subs: dict[str, set[asyncio.Queue]] = {}
_lock = threading.Lock()

PING_INTERVAL = 15  # 秒；无事件时的心跳，防代理断开空闲连接


def set_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def publish(job_id: str, event: str, data: dict) -> None:
    """线程安全：可从任意 worker 线程调用。"""
    if _loop is None:
        return
    with _lock:
        queues = list(_subs.get(job_id, ()))
    for q in queues:
        _loop.call_soon_threadsafe(q.put_nowait, (event, data))


def _subscribe(job_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
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


async def sse_stream(job_id: str, snapshot: dict) -> AsyncIterator[str]:
    """先推完整当前状态（解决连接建立前错过的事件），随后持续转发新事件。"""
    q = _subscribe(job_id)
    try:
        yield _fmt("snapshot", snapshot)
        while True:
            try:
                event, data = await asyncio.wait_for(q.get(), timeout=PING_INTERVAL)
            except asyncio.TimeoutError:
                yield ": ping\n\n"
                continue
            yield _fmt(event, data)
    finally:
        _unsubscribe(job_id, q)
