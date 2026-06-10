"""FastAPI 应用入口：组装中间件、路由与静态前端。"""
from __future__ import annotations

import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import pipeline, store
from .config import STATIC_DIR, settings
from .db import init_db
from .routers import auth as auth_router
from .routers import chat as chat_router
from .routers import jobs as jobs_router
from .routers import questions as questions_router
from .security import OriginCheckMiddleware, SecurityHeadersMiddleware


def _resume_interrupted_jobs() -> None:
    """服务重启后自动续跑仍处于 processing 的作业（视觉结果有缓存，续跑很快）。"""
    for job_id in store.list_processing_job_ids():
        threading.Thread(target=pipeline.process_job, args=(job_id,), daemon=True).start()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    _resume_interrupted_jobs()
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


@app.get("/api/health")
def health():
    problems = settings.validate()
    return JSONResponse({"ok": not problems, "problems": problems})


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
