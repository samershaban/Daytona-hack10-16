#!/usr/bin/env bash
# Deterministically reset a VAmPI instance to its canonical seed via GET /createdb,
# which recreates and repopulates the SQLite database. Usage: scripts/reset-vampi.sh [TARGET_URL]
set -euo pipefail

TARGET="${1:-${TARGET_URL:-http://127.0.0.1:5002}}"

resp="$(curl -fsS "$TARGET/createdb")"
echo "createdb: $resp"

# Canonical seed includes users; confirm the users table is populated after reset.
users="$(curl -fsS "$TARGET/users/v1")"
echo "$users" | grep -q '"username"' || { echo "FAIL: VAmPI not at canonical state (no seeded users)" >&2; exit 1; }
echo "OK: VAmPI reset to canonical state"
