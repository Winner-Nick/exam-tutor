#!/usr/bin/env bash
# 启动 ExamTutor 服务
cd "$(dirname "$0")" || exit 1
# 外部显式传入的 HOST/PORT 优先于 .env（便于临时换端口调试）
_HOST="${EXAMTUTOR_HOST:-}"; _PORT="${EXAMTUTOR_PORT:-}"
set -a; [ -f .env ] && . ./.env; set +a
# --workers 1 不可改：限流器、SSE 订阅、后台队列均为进程内存态，多进程会失效
exec .venv/bin/python -m uvicorn backend.app.main:app \
  --host "${_HOST:-${EXAMTUTOR_HOST:-0.0.0.0}}" \
  --port "${_PORT:-${EXAMTUTOR_PORT:-8080}}" \
  --workers 1
