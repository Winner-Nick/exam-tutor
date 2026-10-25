#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

.venv/bin/python -m compileall -q backend
.venv/bin/python -m pip check
.venv/bin/python -m pytest
npm --prefix frontend test
npm --prefix frontend run build
git diff --check
