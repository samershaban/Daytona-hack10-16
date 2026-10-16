#!/usr/bin/env bash
# Reset VAmPI to the canonical BOLA baseline. GET /createdb alone reseeds 3 users but ZERO
# books, so the scenario book must be re-seeded too — delegate to seed-vampi.sh, the single
# deterministic reset+seed procedure. Usage: scripts/reset-vampi.sh [TARGET_URL]
set -euo pipefail
exec "$(dirname "$0")/seed-vampi.sh" "$@"
