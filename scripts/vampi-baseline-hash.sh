#!/usr/bin/env bash
# Baseline-equality check: hash the NORMALIZED observable state of a VAmPI instance so every
# candidate sandbox can be proven to start from the identical seeded baseline. We hash the
# KNOWN state (seeded users + the canonical book + the vuln flag) and deliberately EXCLUDE the
# 3 random auto-books from init_db_users() (titles are random per /createdb, can't be deleted,
# and are irrelevant to the scenario). We hash API state, not the raw SQLite file, because the
# .db byte layout isn't guaranteed reproducible while this observable state is.
# Note: GET /books/v1 (list-all) is intentionally NOT hashed, as it includes the random books.
#
# Run this against each candidate right after seed-vampi.sh; the hashes must match.
# Usage: scripts/vampi-baseline-hash.sh [TARGET_URL]
set -euo pipefail

TARGET="${1:-${TARGET_URL:-http://127.0.0.1:5002}}"
BOOK_TITLE="restorelab-bola-book"

tok="$(curl -fsS -X POST "$TARGET/users/v1/login" -H 'content-type: application/json' \
  -d '{"username":"name1","password":"pass1"}' | sed -n 's/.*"auth_token"[^"]*"\([^"]*\)".*/\1/p')"

{
  curl -fsS "$TARGET/"                                        # basic info incl. "vulnerable":N
  curl -fsS "$TARGET/users/v1"                                # seeded users (sorted by id, deterministic)
  curl -fsS "$TARGET/books/v1/$BOOK_TITLE" -H "authorization: Bearer $tok"  # canonical book + secret + owner
} | shasum -a 256 | awk '{print $1}'
