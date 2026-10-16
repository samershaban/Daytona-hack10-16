#!/usr/bin/env bash
# Deterministic VAmPI reset + seed for the book-access BOLA scenario.
# NOT a container restart and NOT 'latest': this re-creates the SQLite DB from scratch
# (GET /createdb -> drop_all + create_all + init_db_users) and then seeds exactly one
# canonical book owned by name1. Every candidate must start from this exact state.
#
# Usage: scripts/seed-vampi.sh [TARGET_URL]
set -euo pipefail

TARGET="${1:-${TARGET_URL:-http://127.0.0.1:5002}}"

# Canonical identities come from VAmPI's init_db_users() at the pinned commit.
OWNER_USER="name1"; OWNER_PASS="pass1"      # owns the secret book
ATTACKER_USER="name2"; ATTACKER_PASS="pass2" # foreign user used by the red-team probe
BOOK_TITLE="restorelab-bola-book"
BOOK_SECRET="S3CR3T-name1-canonical"

jqget() { sed -n "s/.*\"$1\"[^\"]*\"\([^\"]*\)\".*/\1/p"; }

# 1) Recreate + reseed users (0 books after this step).
createdb="$(curl -fsS "$TARGET/createdb")"
echo "createdb: $createdb"

# 2) Log in as the owner and create the one canonical book.
tok="$(curl -fsS -X POST "$TARGET/users/v1/login" -H 'content-type: application/json' \
  -d "{\"username\":\"$OWNER_USER\",\"password\":\"$OWNER_PASS\"}" | jqget auth_token)"
[ -n "$tok" ] || { echo "FAIL: could not log in as $OWNER_USER" >&2; exit 1; }

add="$(curl -fsS -X POST "$TARGET/books/v1" -H "authorization: Bearer $tok" -H 'content-type: application/json' \
  -d "{\"book_title\":\"$BOOK_TITLE\",\"secret\":\"$BOOK_SECRET\"}")"
echo "seed book: $add"

# 3) Verify canonical state: 3 users present and the book readable by its owner.
users="$(curl -fsS "$TARGET/users/v1")"
echo "$users" | grep -q "$OWNER_USER" && echo "$users" | grep -q "$ATTACKER_USER" \
  || { echo "FAIL: seeded users missing" >&2; exit 1; }
own="$(curl -fsS "$TARGET/books/v1/$BOOK_TITLE" -H "authorization: Bearer $tok" | jqget secret)"
[ "$own" = "$BOOK_SECRET" ] || { echo "FAIL: canonical book not seeded (got '$own')" >&2; exit 1; }

echo "OK: VAmPI at canonical baseline (3 users, 1 book '$BOOK_TITLE' owned by $OWNER_USER)"
