"""FastAPI 应用入口：组装中间件、路由与静态前端。"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, events, workers
from .config import FRONTEND_DIST, settings
from .db import get_conn, init_db
from .routers import auth as auth_router
from .routers import chat as chat_router
from .routers import feedback as feedback_router
from .routers import insights as insights_router
from .routers import jobs as jobs_router
from .routers import papers as papers_router
from .routers import questions as questions_router
from .routers import releases as releases_router
from .routers import students as students_router
from .security import OriginCheckMiddleware, SecurityHeadersMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    problems = settings.validate()
    if problems:
        # 缺密钥（尤其 JWT_SECRET）时拒绝启动，避免空密钥签发的会话可被伪造
        raise RuntimeError("配置不完整，拒绝启动：\n- " + "\n- ".join(problems))
    init_db()
    events.set_loop(asyncio.get_running_loop())
    workers.start()
    workers.resume_pending()  # 重启续跑：持久任务、旧处理记录与中断的讲解
    try:
        yield
    finally:
        workers.stop()


app = FastAPI(title="ExamTutor", version=__version__, lifespan=lifespan,
              docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(OriginCheckMiddleware)

app.include_router(auth_router.router)
app.include_router(auth_router.admin_router)
app.include_router(jobs_router.router)
app.include_router(papers_router.router)
app.include_router(students_router.router)
app.include_router(releases_router.router)
app.include_router(feedback_router.router)
app.include_router(questions_router.router)
app.include_router(chat_router.router)
app.include_router(insights_router.router)


@app.get("/api/health")
def health():
    return JSONResponse({"ok": True})


@app.get("/api/health/ready")
def ready():
    try:
        get_conn().execute("SELECT 1").fetchone()
    except Exception:
        return JSONResponse({"ok": False, "version": __version__, "database": "unavailable"}, status_code=503)
    return JSONResponse({"ok": True, "version": __version__, "database": "ok"})


@app.api_route(
    "/api/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    include_in_schema=False,
)
def unknown_api(path: str):
    return JSONResponse({"detail": "接口不存在"}, status_code=404)


# ---------------------------------------------------------------------------
# React 构建产物（SPA：未知路径一律回 index.html，由前端路由接管）
# ---------------------------------------------------------------------------

if (FRONTEND_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    # dist 根下的真实静态文件（manifest、图标等）直接返回；其余走 SPA fallback
    # 安全：path 以 "/" 开头时 Path 拼接会坍缩成绝对路径（如 //etc/passwd），
    # 必须 lstrip 后再 resolve 并校验仍在 dist 内
    if path:
        f = (FRONTEND_DIST / path.lstrip("/")).resolve()
        if f.is_file() and f.is_relative_to(FRONTEND_DIST.resolve()):
            return FileResponse(f)
    index = FRONTEND_DIST / "index.html"
    if not index.exists():
        return JSONResponse({"detail": "前端未构建：请先在 frontend/ 运行 npm run build"}, status_code=503)
    return FileResponse(index)
