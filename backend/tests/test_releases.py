from __future__ import annotations

import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from app.routers import releases


def test_release_refresh_is_single_flight_and_disk_json_is_valid(monkeypatch):
    calls = 0
    lock = threading.Lock()

    def fetch():
        nonlocal calls
        with lock:
            calls += 1
        time.sleep(0.02)
        return [{"tag": "v1.0.0", "name": "test", "apk_url": None}]

    monkeypatch.setattr(releases, "_fetch_releases", fetch)
    monkeypatch.setattr(releases, "_cache", {"at": 0.0, "data": None})
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: releases.get_releases(), range(8)))
    assert calls == 1
    assert all(result == results[0] for result in results)
    assert json.loads(releases._disk_cache_path().read_text()) == results[0]


def test_apk_cache_is_bounded():
    for index in range(5):
        path = releases.RELEASES_DIR / f"v{index}.apk"
        path.write_bytes(bytes([index]))
        os.utime(path, (index, index))
    releases._prune_apk_cache(max_files=3)
    assert {path.name for path in releases.RELEASES_DIR.glob("*.apk")} == {
        "v2.apk", "v3.apk", "v4.apk",
    }
