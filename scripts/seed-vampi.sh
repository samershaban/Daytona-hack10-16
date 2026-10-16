#!/usr/bin/env bash
# Deterministic VAmPI reset + seed for the book-access BOLA scenario, used ONCE to prepare the
# baseline before snapshotting. NOT a container restart and NOT ':latest'.
#
# IMPORTANT (pinned commit f16052d): /createdb runs init_db_users(), which registers name1,
# name2, admin — and register_user() gives EACH a random auto-book "bookTitle<0-99>". So after
# /createdb there are 3 users and 3 RANDOM-titled books (not zero). randrange(100) can collide
# on the UNIQUE book_title and 500 the call, so we retry /createdb until all 3 users exist.
# The random auto-books can't be deleted (no delete-book endpoint); they are per-run noise and
# are excluded from the baseline hash. The scenario's ONLY authoritative book is the canonical
# one we add below. For identical candidate baselines, snapshot AFTER this seed and fork the
# snapshot (do not re-run /createdb per candidate).
#
# Usage: scripts/seed-vampi.sh [TARGET_URL]
set -euo pipefail

TARGET="${1:-${TARGET_URL:-http://127.0.0.1:5002}}"

OWNER_USER="name1"; OWNER_PASS="pass1"       # owns the canonical secret book
ATTACKER_USER="name2"; ATTACKER_PASS="pass2" # foreign user used by the red-team probe
BOOK_TITLE="restorelab-bola-book"
BOOK_SECRET="S3CR3T-name1-canonical"

jqget() { sed -n "s/.*\"$1\"[^\"]*\"\([^\"]*\)\".*/\1/p"; }

# 1) Recreate + reseed, retrying past the rare unique-title collision in init_db_users().
seeded=0
for attempt in 1 2 3 4 5 6 7 8; do
  curl -fsS "$TARGET/createdb" >/dev/null 2>&1 || true
  users="$(curl -fsS "$TARGET/users/v1" 2>/dev/null || echo '')"
  if echo "$users" | grep -q "$OWNER_USER" && echo "$users" | grep -q "$ATTACKER_USER" && echo "$users" | grep -q '"admin"'; then
    seeded=1; echo "createdb OK (attempt $attempt): 3 users seeded (+3 random auto-books, ignored)"; break
  fi
  echo "createdb attempt $attempt incomplete (auto-book title collision); retrying"
done
[ "$seeded" = 1 ] || { echo "FAIL: /createdb did not seed 3 users after retries" >&2; exit 1; }

# 2) Log in as the owner and create the one canonical book (unique title, never collides).
tok="$(curl -fsS -X POST "$TARGET/users/v1/login" -H 'content-type: application/json' \
  -d "{\"username\":\"$OWNER_USER\",\"password\":\"$OWNER_PASS\"}" | jqget auth_token)"
[ -n "$tok" ] || { echo "FAIL: could not log in as $OWNER_USER" >&2; exit 1; }

add="$(curl -fsS -X POST "$TARGET/books/v1" -H "authorization: Bearer $tok" -H 'content-type: application/json' \
  -d "{\"book_title\":\"$BOOK_TITLE\",\"secret\":\"$BOOK_SECRET\"}")"
echo "seed book: $add"

# 3) Verify canonical state: the canonical book is readable by its owner with the expected secret.
own="$(curl -fsS "$TARGET/books/v1/$BOOK_TITLE" -H "authorization: Bearer $tok" | jqget secret)"
[ "$own" = "$BOOK_SECRET" ] || { echo "FAIL: canonical book not seeded (got '$own')" >&2; exit 1; }

echo "OK: VAmPI at canonical baseline — 3 users + canonical book '$BOOK_TITLE' (name1); 3 random auto-books ignored"
