#!/usr/bin/env bash
# Reset VAmPI to the canonical BOLA baseline. GET /createdb reseeds 3 users + 3 random auto-books
# (and can collide/500), and doesn't add our scenario book — so delegate to seed-vampi.sh, the
# single collision-safe reset+seed procedure. For identical candidate baselines, prefer forking
# a snapshot taken after seed-vampi.sh (see redteam/vampi-contract.md §5).
# Usage: scripts/reset-vampi.sh [TARGET_URL]
set -euo pipefail
exec "$(dirname "$0")/seed-vampi.sh" "$@"
