from __future__ import annotations

import gc

from app import chat_store
from app.routers import releases


def test_unused_locks_are_not_retained_forever():
    chat_lock = chat_store.chat_lock("lock-cleanup-job", "q1")
    apk_lock = releases._apk_lock("v-lock-cleanup")
    assert "lock-cleanup-job:q1" in chat_store._locks
    assert "v-lock-cleanup" in releases._apk_locks

    del chat_lock
    del apk_lock
    gc.collect()

    assert "lock-cleanup-job:q1" not in chat_store._locks
    assert "v-lock-cleanup" not in releases._apk_locks
