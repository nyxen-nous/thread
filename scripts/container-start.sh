#!/bin/sh
set -eu
: "${ALLOWED_ORIGINS:?Set ALLOWED_ORIGINS to your exact HTTPS site origin}"
exec python -m uvicorn backend.app:app --host 0.0.0.0 --port "${PORT:-10000}" --workers 1 --no-access-log --ws-max-size 32768 --ws-max-queue 16
