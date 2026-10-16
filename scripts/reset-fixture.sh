#!/usr/bin/env bash
# Deterministically reset the fixture to its canonical seed state.
# Usage: scripts/reset-fixture.sh [TARGET_URL]
set -euo pipefail

TARGET="${1:-${TARGET_URL:-http://127.0.0.1:3000}}"
SECRET="${RESET_SECRET:-dev-reset}"

resp="$(curl -fsS -X POST "$TARGET/internal/reset" -H "x-reset-secret: $SECRET")"
echo "reset: $resp"

integrity="$(curl -fsS "$TARGET/internal/integrity")"
echo "integrity: $integrity"

echo "$integrity" | grep -q '"intact":true' || { echo "FAIL: fixture not at canonical state" >&2; exit 1; }
echo "OK: fixture at canonical state"
