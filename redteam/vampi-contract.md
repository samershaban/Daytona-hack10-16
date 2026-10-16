# VAmPI execution contract — book-access BOLA scenario

Owner: **Mahmoud**. Consumer: **Belal** (Daytona execution). Scenario: **OWASP API1:2023
BOLA** on `GET /books/v1/{title}`. This is the single authorized scenario; all targets are
team-owned/synthetic. Keep `vulnerable=1`; restrict candidate edits to `api_views/books.py`.

## 1. Pinned source

| Field | Value |
|---|---|
| Repo | `https://github.com/erev0s/VAmPI` |
| Pinned commit | **`f16052dce83f05847133ec98f01c5193a41de7d8`** (master @ 2026-10-16) |
| Vulnerable file | `api_views/books.py` |
| sha256 of vulnerable `books.py` @ pinned commit | **`78e2eb77d655573f03b7a4d0bca73dc27383b0c5ec7882a5aa8608caa52828e8`** |
| Reference copy in repo | `infra/fixture/vampi/reference/books.vulnerable.py` |

**Full manifest hashes** (all deterministic from the pin) are in
`infra/fixture/vampi/baseline.sha256`:

| File | sha256 |
|---|---|
| `app.py` | `ad26b12cfbdaab311bea86942f5ebd368dca331a0f4cdba803393739baadf42e` |
| `config.py` | `42912b0b70d6f47bdb85a7f13f48c3750c16a87fb62d99ef512a8fbafd566b97` |
| `api_views/books.py` | `78e2eb77d655573f03b7a4d0bca73dc27383b0c5ec7882a5aa8608caa52828e8` |
| `api_views/users.py` | `46006eb7207ebbae163f5320b13e3bf0ec464cef201a51fb2cd43b5cfdb4116c` |
| `models/books_model.py` | `b41a7b806416e2938cb4423d7652cd3c8dda7260d47f8edbbfd8078dca74b7af` |
| `models/user_model.py` | `4ce47b9850812e47140b2d2f2e20c08ae4b5338d168ce72f23e3127986ef6e1b` |
| `requirements.txt` | `c748738940589a5c431281c8ad983942dec24080450d733c69038121a93e8aca` |
| `openapi_specs/openapi3.yml` | `35200f354f9c9968182fc19458295ed45bb4c368150348c46d5146a7e40a61c9` |
| `.pinned_sha` (content = commit + `\n`) | `11d72399af93eb631ad518ec665a29c5c7b12b2d8161fb8db31cd35610c1f218` |

Baseline **must** be built from this commit, not `:latest`. The Dockerfile runs
`sha256sum -c` against these at build time, so a drifted source fails the build. Verify in any
sandbox before any candidate edit:
```bash
cat /vampi/.pinned_sha                        # must equal the commit above
cd /vampi && sha256sum -c .baseline.sha256    # all files OK
```

## 2. Baseline image

Built by `infra/fixture/vampi/Dockerfile` (clones the pinned commit, `vulnerable=1`):
```bash
docker build -f infra/fixture/vampi/Dockerfile -t restorelab-vampi:pinned infra/fixture/vampi
```
**Belal records the resulting local image id as the baseline digest** (I can't produce it —
no Docker on the authoring machine; the value is deterministic from the pinned source):
```bash
docker inspect --format '{{.Id}}' restorelab-vampi:pinned   # -> sha256:...  (record here)
```
> Baseline image id: `__FILL_ON_BUILD__`

Both recovery candidates fork from this one image/snapshot.

## 3. Source workspace (what agents may touch)

- Workspace root in sandbox: `/vampi` (the pinned checkout).
- **Only editable file for candidates:** `/vampi/api_views/books.py`.
- The BOLA + its fix live in `get_by_title(book_title)`:
  - Vulnerable: `Book.query.filter_by(book_title=str(book_title)).first()` (no owner check).
  - Correct fix: scope to the caller — `user = User.query.filter_by(username=resp['sub']).first()`
    then `Book.query.filter_by(user=user, book_title=str(book_title)).first()`, returning 404
    when it doesn't match. (`vulnerable=0` is a REFERENCE only — VAmPI leaves other vulns on
    at 0, so agents must patch the code path, not flip the env var.)

## 4. Startup / readiness

```bash
docker run -d --name <cand> -e vulnerable=1 -e tokentimetolive=300 -p <port>:5000 restorelab-vampi:pinned
# readiness: poll until the basic endpoint reports the vuln flag
curl -fsS http://127.0.0.1:<port>/   # {"message":"VAmPI ...","vulnerable":1}
```
After a candidate edits `books.py`, restart the process (`docker restart <cand>` or re-run
`python app.py`) and re-check readiness before verifying.

## 5. Deterministic reset / seed (SQLite)

`GET /createdb` runs `drop_all() + create_all() + init_db_users()`. **Correction (verified in
source):** `init_db_users()` registers name1/name2/admin, and `register_user()` gives **each a
random auto-book** `bookTitle<0-99>` with secret `secret for bookTitle<n>`. So `/createdb`
produces **3 users + 3 random-titled books**, not zero. `randrange(100)` can collide on the
UNIQUE `book_title` and **500 the call**, and there is **no delete-book endpoint** to remove
them. They are per-run noise, excluded from the baseline hash and ignored by the scenario.

`scripts/seed-vampi.sh`: (1) retries `/createdb` until all 3 users exist (past the rare
collision); (2) logs in as `name1` and `name2`; (3) creates one stable book per owner; (4) verifies both.

```bash
scripts/seed-vampi.sh http://127.0.0.1:<port>
```

**Reset model for identical candidate baselines (recommended):** run `seed-vampi.sh` **once**,
then **snapshot** the instance; every candidate **forks the snapshot**, so the random auto-books
are frozen and identical across candidates. Do **not** re-run `/createdb` per candidate (it
re-rolls the random books). Container-restart-alone and `:latest` are both insufficient.

**Baseline-equality gate** — hashes the KNOWN state (users + both canonical books + vuln flag),
excluding the random auto-books; run against each fork, they must match:
```bash
scripts/vampi-baseline-hash.sh http://127.0.0.1:<port>
```
> Expected seeded-state hash: `__FILL_ON_FIRST_RUN__` (deterministic over the known state)

## 6. Synthetic identities & canonical object

From VAmPI's `init_db_users()` at the pinned commit (passwords are fixed seed values):

| Role | username | password | note |
|---|---|---|---|
| Owner | `name1` | `pass1` | owns the secret book |
| Attacker | `name2` | `pass2` | foreign user, no rights to the book |
| Admin | `admin` | `pass1` | not used by this scenario |

**Expected-book list after seed:**
- **Authoritative (the scenario's object):** `restorelab-bola-book`, secret `S3CR3T-name1-canonical`, owner `name1`.
- **Second-owner preservation object:** `restorelab-name2-book`, secret `S3CR3T-name2-canonical`, owner `name2`.
- **Ignored noise:** one random `bookTitle<0-99>` per seeded user (name1, name2, admin) from
  `init_db_users()`. Titles are random per `/createdb` but frozen once snapshotted. Record the
  3 actual titles when you build the snapshot (open item below); the verifier must not depend on them.

Auth: `Authorization: Bearer <auth_token>` from `POST /users/v1/login`.

## 7. Cross-user evidence (red-team proof)

```bash
# standalone read-only reproduction (prints the finding; does not create a run)
TARGET_URL=http://127.0.0.1:<port> npm run redteam:vampi -w @restorelab/fixture

# orchestrated demo: the orchestrator creates the run and a human approves scope
API_URL=http://127.0.0.1:4000 RUN_ID=<run id> \
  TARGET_URL=http://127.0.0.1:<port> REDTEAM_AUTHOR=mahmoud-redteam \
  npm run redteam:vampi -w @restorelab/fixture
```
`redteam/vampi.ts` emits the shared `Finding` JSON. Expected shape on the vulnerable baseline:

```jsonc
{
  "category": "OWASP-API1-2023",
  "operation": "GET /books/v1/restorelab-bola-book",
  "reproduced": true,
  "evidence": {
    "ownerRead":     { "request": "name1 GET own book",        "status": 200, "owner": "name1" },
    "crossUserRead": { "request": "name2 GET name1's book",    "status": 200, "leakedSecret": "S3CR3T-name1-canonical", "owner": "name1" }
  }
}
```
> **Captured evidence (first run):** attach the real JSON from the pinned baseline here. I could
> not execute it on the authoring machine (no Docker); the request/response shapes above are from
> VAmPI's verified source, and the probe produces the live artifact in Daytona.

## Hard verifier contract (for Hamza)

| Check | vulnerable=1 | PASS (fixed) |
|---|---|---|
| `name1` GET own book | 200 + secret | 200 + secret |
| `name2` GET name1's book | **200 + secret (bug)** | **404** |
| `admin` GET any own-tenant book (if used) | 200 | 200 |
| `GET /users/v1` after seed | 3 seeded users | unchanged |
| `GET /` readiness | 200 | 200 |
| source: only `api_views/books.py` changed | — | required |

## Open items Belal fills on first build (deterministic from the above)
- [ ] Baseline image id (§2)
- [ ] Seeded-state baseline hash (§5)
- [ ] The 3 actual `bookTitle<n>` auto-book titles, frozen at snapshot time (§6, informational)
- [ ] Captured red-team evidence JSON (§7)
- [ ] Prepared Daytona snapshot id, taken AFTER `seed-vampi.sh` (§5 reset model)
