#!/usr/bin/env bash
# 启动 ExamTutor 服务
cd "$(dirname "$0")" || exit 1
set -a; [ -f .env ] && . ./.env; set +a
exec .venv/bin/python -m uvicorn app.main:app \
  --host "${EXAMTUTOR_HOST:-0.0.0.0}" \
  --port "${EXAMTUTOR_PORT:-8080}"
