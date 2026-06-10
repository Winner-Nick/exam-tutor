"""安全：内存限流、上传内容校验、安全响应头与写请求 Origin 校验。

限流器为单进程内存态（run.sh 钉死 --workers 1），滑动窗口按 key 记录
时间戳，足以保护登录爆破与 LLM 接口滥用，无需引入外部依赖。
"""
from __future__ import annotations

import hashlib
import threading
import time
from collections import deque
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import HTTPException, Request, UploadFile
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import pdf_utils
from .config import settings

# ---------------------------------------------------------------------------
# 限流
# ---------------------------------------------------------------------------

_buckets: dict[str, deque] = {}
_buckets_lock = threading.Lock()


def hit(key: str, limit: int, window_seconds: float, message: str = "请求过于频繁，请稍后再试") -> None:
    """滑动窗口限流：window 内同一 key 超过 limit 次则抛 429。"""
    now = time.time()
    with _buckets_lock:
        dq = _buckets.setdefault(key, deque())
        while dq and dq[0] < now - window_seconds:
            dq.popleft()
        if len(dq) >= limit:
            raise HTTPException(429, message)
        dq.append(now)
        if len(_buckets) > 10000:  # 防 key 无限膨胀
            for k in [k for k, v in _buckets.items() if not v or v[-1] < now - 3600]:
                _buckets.pop(k, None)


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


# ---------------------------------------------------------------------------
# 上传校验
# ---------------------------------------------------------------------------

async def save_upload_pdf(file: UploadFile, dest: Path) -> str:
    """流式落盘并校验：magic bytes、大小上限、可解析、页数上限。返回 SHA-256。"""
    max_bytes = settings.max_upload_mb * 1024 * 1024
    head = await file.read(5)
    if head != b"%PDF-":
        raise HTTPException(400, "文件内容不是有效的 PDF")

    sha = hashlib.sha256(head)
    size = len(head)
    try:
        with dest.open("wb") as f:
            f.write(head)
            while chunk := await file.read(1 << 20):
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(413, f"文件超过 {settings.max_upload_mb}MB 上限")
                sha.update(chunk)
                f.write(chunk)
        try:
            n = pdf_utils.page_count(dest)
        except Exception:
            raise HTTPException(400, "PDF 文件损坏或无法解析") from None
        if n < 1 or n > settings.max_pages:
            raise HTTPException(400, f"PDF 页数需在 1-{settings.max_pages} 页之间")
    except HTTPException:
        dest.unlink(missing_ok=True)
        raise
    return sha.hexdigest()


# ---------------------------------------------------------------------------
# ASGI 中间件（不用 BaseHTTPMiddleware，避免干扰 SSE 流式响应）
# ---------------------------------------------------------------------------

class SecurityHeadersMiddleware:
    """统一安全响应头；HTML 加 CSP。"""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Content-Type-Options"] = "nosniff"
                headers["X-Frame-Options"] = "DENY"
                headers["Referrer-Policy"] = "same-origin"
                if headers.get("content-type", "").startswith("text/html"):
                    headers["Content-Security-Policy"] = (
                        "default-src 'self'; img-src 'self' data:; "
                        "style-src 'self' 'unsafe-inline'"
                    )
            await send(message)

        await self.app(scope, receive, send_with_headers)


class OriginCheckMiddleware:
    """CSRF 纵深防御：/api/ 的写请求若带 Origin/Referer，其 host 必须与 Host 一致。"""

    WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        if scope["method"] in self.WRITE_METHODS and scope["path"].startswith("/api/"):
            headers = {k.decode("latin1").lower(): v.decode("latin1")
                       for k, v in scope.get("headers", [])}
            origin = headers.get("origin") or headers.get("referer")
            host = headers.get("host", "")
            if origin and origin != "null":
                origin_host = urlsplit(origin).netloc
                if origin_host and origin_host != host:
                    await self._reject(send)
                    return
        await self.app(scope, receive, send)

    @staticmethod
    async def _reject(send: Send) -> None:
        body = b'{"detail":"\xe8\xb7\xa8\xe7\xab\x99\xe8\xaf\xb7\xe6\xb1\x82\xe8\xa2\xab\xe6\x8b\x92\xe7\xbb\x9d"}'
        await send({
            "type": "http.response.start", "status": 403,
            "headers": [(b"content-type", b"application/json; charset=utf-8"),
                        (b"content-length", str(len(body)).encode())],
        })
        await send({"type": "http.response.body", "body": body})
