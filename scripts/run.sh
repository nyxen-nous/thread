#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -f dist/index.html ]; then
  echo 'Build the frontend first: npm ci && npm run build' >&2
  exit 1
fi
if [ -x .venv/bin/python ]; then PYTHON=.venv/bin/python; else PYTHON=python3; fi
if [ -f .env ]; then set -- --env-file .env; else set --; fi
exec "$PYTHON" -m uvicorn backend.app:app --host 127.0.0.1 --port 8787 --workers 1 --no-access-log --ws-max-size 32768 --ws-max-queue 16 "$@"
