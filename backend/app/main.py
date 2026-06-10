"""FastAPI 应用入口：组装中间件、路由与静态前端。"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import events, workers
from .config import FRONTEND_DIST, settings
from .db import init_db
from .routers import auth as auth_router
from .routers import chat as chat_router
from .routers import insights as insights_router
from .routers import jobs as jobs_router
from .routers import questions as questions_router
from .security import OriginCheckMiddleware, SecurityHeadersMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    events.set_loop(asyncio.get_running_loop())
    workers.start()
    workers.resume_pending()  # 重启续跑：处理中的作业与中断的讲解
    yield


app = FastAPI(title="ExamTutor", version="0.2.0", lifespan=lifespan,
              docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(OriginCheckMiddleware)

app.include_router(auth_router.router)
app.include_router(auth_router.admin_router)
app.include_router(jobs_router.router)
app.include_router(questions_router.router)
app.include_router(chat_router.router)
app.include_router(insights_router.router)


@app.get("/api/health")
def health():
    problems = settings.validate()
    return JSONResponse({"ok": not problems, "problems": problems})


# ---------------------------------------------------------------------------
# React 构建产物（SPA：未知路径一律回 index.html，由前端路由接管）
# ---------------------------------------------------------------------------

if (FRONTEND_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    index = FRONTEND_DIST / "index.html"
    if not index.exists():
        return JSONResponse({"detail": "前端未构建：请先在 frontend/ 运行 npm run build"}, status_code=503)
    return FileResponse(index)
