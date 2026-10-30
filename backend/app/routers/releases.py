"""App 安装包发布页接口：代理 GitHub Releases（无需登录）。

- 版本列表带 10 分钟内存缓存 + 磁盘兜底（GitHub 偶尔不可达时仍能展示）。
- APK 首次下载时从 GitHub 拉取并缓存到 data/releases/，之后直接由本机
  高速分发（国内访客直连 GitHub 慢）。
"""
from __future__ import annotations

import json
import re
import threading
import time
import weakref
from urllib.parse import quote

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from .. import security, store
from ..config import DATA_DIR

router = APIRouter(prefix="/api/releases", tags=["releases"])

REPO = "Winner-Nick/exam-tutor"
RELEASES_DIR = DATA_DIR / "releases"
CACHE_TTL = 600  # 版本列表缓存 10 分钟

_cache: dict = {"at": 0.0, "data": None}
_cache_lock = threading.Lock()
_TAG_RE = re.compile(r"^[A-Za-z0-9._-]{1,50}$")

# 按 tag 串行化 APK 首下：并发写同一 .part 会字节交错，rename 出损坏包被长期分发
_apk_locks = weakref.WeakValueDictionary()
_apk_locks_guard = threading.Lock()


def _apk_lock(tag: str) -> threading.Lock:
    with _apk_locks_guard:
        return _apk_locks.setdefault(tag, threading.Lock())


def _disk_cache_path():
    RELEASES_DIR.mkdir(parents=True, exist_ok=True)
    return RELEASES_DIR / "releases.json"


def _fetch_releases() -> list[dict]:
    resp = httpx.get(
        f"https://api.github.com/repos/{REPO}/releases",
        headers={"Accept": "application/vnd.github+json"},
        timeout=15,
    )
    resp.raise_for_status()
    out = []
    for r in resp.json():
        if r.get("draft"):
            continue
        apk = next((a for a in r.get("assets") or [] if a["name"].endswith(".apk")), None)
        out.append({
            "tag": r["tag_name"],
            "name": r.get("name") or r["tag_name"],
            "body": r.get("body") or "",
            "published_at": r.get("published_at"),
            "prerelease": r.get("prerelease", False),
            "apk_size": apk["size"] if apk else None,
            "apk_url": apk["browser_download_url"] if apk else None,
        })
    return out


def get_releases() -> list[dict]:
    with _cache_lock:
        if _cache["data"] is not None and time.time() - _cache["at"] < CACHE_TTL:
            return _cache["data"]
        try:
            data = _fetch_releases()
            _cache.update(at=time.time(), data=data)
            store.write_json_atomic(_disk_cache_path(), data)
            return data
        except Exception:  # noqa: BLE001 - GitHub 不可达时用磁盘兜底
            p = _disk_cache_path()
            if p.exists():
                try:
                    return json.loads(p.read_text(encoding="utf-8"))
                except (json.JSONDecodeError, OSError):
                    pass
            raise HTTPException(503, "暂时无法获取版本列表，请稍后再试") from None


def _prune_apk_cache(max_files: int = 3) -> None:
    apks = sorted(RELEASES_DIR.glob("*.apk"), key=lambda path: path.stat().st_mtime, reverse=True)
    for path in apks[max_files:]:
        path.unlink(missing_ok=True)


@router.get("")
def list_releases(request: Request):
    security.hit(f"releases:{security.client_ip(request)}", 30, 60)
    releases = [
        {k: v for k, v in r.items() if k != "apk_url"}
        for r in get_releases()
    ]
    return {"releases": releases}


@router.get("/{tag}/apk")
def download_apk(tag: str, request: Request):
    security.hit(f"apk:{security.client_ip(request)}", 10, 600, "下载过于频繁，请稍后再试")
    if not _TAG_RE.match(tag):
        raise HTTPException(404, "版本不存在")
    rel = next((r for r in get_releases() if r["tag"] == tag), None)
    if not rel or not rel.get("apk_url"):
        raise HTTPException(404, "该版本没有安装包")

    RELEASES_DIR.mkdir(parents=True, exist_ok=True)
    cached = RELEASES_DIR / f"{tag}.apk"
    if not cached.exists():
        with _apk_lock(tag):
            if not cached.exists():  # 等锁期间可能已被其他请求下载好
                tmp = RELEASES_DIR / f"{tag}.{threading.get_ident()}.part"
                try:
                    with httpx.stream("GET", rel["apk_url"], follow_redirects=True, timeout=120) as r:
                        r.raise_for_status()
                        with tmp.open("wb") as f:
                            for chunk in r.iter_bytes(1 << 20):
                                f.write(chunk)
                    tmp.replace(cached)
                    _prune_apk_cache()
                except Exception:  # noqa: BLE001
                    tmp.unlink(missing_ok=True)
                    raise HTTPException(502, "安装包拉取失败，请稍后再试") from None

    filename = f"错题小方-{tag}.apk"
    return FileResponse(
        cached,
        media_type="application/vnd.android.package-archive",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )
