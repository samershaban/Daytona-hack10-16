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

Baseline **must** be built from this commit, not `:latest`. Verify in any sandbox:
```bash
cat /vampi/.pinned_sha   # must equal the commit above
shasum -a 256 /vampi/api_views/books.py   # must equal the sha256 above (before any candidate edit)
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

`GET /createdb` runs `drop_all() + create_all() + init_db_users()` — 3 users, **0 books**. The
scenario needs a seeded book, so the full procedure is `scripts/seed-vampi.sh`:

```bash
scripts/seed-vampi.sh http://127.0.0.1:<port>
```
It: (1) `GET /createdb`; (2) logs in as `name1`; (3) creates the canonical book; (4) verifies.
Use this between every run. **Not** container-restart-alone (the SQLite file persists in the
layer) and **not** `:latest`.

**Baseline-equality gate** — run against each candidate right after seeding; hashes must match:
```bash
scripts/vampi-baseline-hash.sh http://127.0.0.1:<port>   # sha256 of normalized API state
```
> Expected seeded-state hash: `__FILL_ON_FIRST_RUN__` (deterministic; capture once, reuse to assert equal baselines)

## 6. Synthetic identities & canonical object

From VAmPI's `init_db_users()` at the pinned commit (passwords are fixed seed values):

| Role | username | password | note |
|---|---|---|---|
| Owner | `name1` | `pass1` | owns the secret book |
| Attacker | `name2` | `pass2` | foreign user, no rights to the book |
| Admin | `admin` | `pass1` | not used by this scenario |

Canonical object (seeded by `seed-vampi.sh`): `book_title = restorelab-bola-book`,
`secret = S3CR3T-name1-canonical`, owner `name1`. Auth: `Authorization: Bearer <auth_token>`
from `POST /users/v1/login`.

## 7. Cross-user evidence (red-team proof)

```bash
TARGET_URL=http://127.0.0.1:<port> npm run redteam:vampi -w @restorelab/fixture
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
- [ ] Captured red-team evidence JSON (§7)
- [ ] Prepared Daytona snapshot id from the pinned image (Belal's `runtime/daytona/`)
