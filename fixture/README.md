# @restorelab/fixture — RecordShop (vulnerable target)

A small, **team-owned, synthetic** multi-tenant API with a deliberate **BOLA** bug
(OWASP API1:2023 / WSTG-ATHZ-04). This is the target for the whole RestoreLab loop:
red-team proves the bug, recovery agents fix it, verifier proves the fix.

Owner: **Mahmoud**. Scope: only this app, with the synthetic identities below. No real targets.

## Run

```bash
npm i                              # repo root (workspaces)
npm run start -w @restorelab/fixture   # http://127.0.0.1:3000
# or containerized (what Belal forks in Daytona):
docker build -f fixture/Dockerfile -t restorelab-fixture .
docker run -p 3000:3000 restorelab-fixture
```

## Synthetic identities (static bearer tokens)

| Token | user | tenant | role |
| --- | --- | --- | --- |
| `tok-alice` | alice | tenant-a | user |
| `tok-bob` | bob | tenant-b | user |
| `tok-admin-a` | admin-a | tenant-a | admin |

Send as `Authorization: Bearer <token>`.

## Routes

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | liveness |
| GET | `/api/records` | caller's own-tenant records |
| GET | `/api/records/:id` | **vulnerable**: returns any record by id, no ownership check |
| POST | `/internal/reset` | re-seed to canonical state; header `x-reset-secret` (default `dev-reset`) |
| GET | `/internal/integrity` | `{ recordCount, canonical, intact }` |

Records: `rec-1001`, `rec-1002` (tenant-a); `rec-2001`, `rec-2002` (tenant-b). Count = 4.

## The bug and the fix

In `src/server.ts`, `GET /api/records/:id` returns the record with no authorization
check (marked `BOLA VULNERABILITY`). A correct fix denies with **404** unless
`record.tenantId === caller.tenantId && (record.ownerId === caller.userId || caller.role === "admin")`.
Admin may read any record in its **own** tenant.

## Hard contract (what the verifier, Hamza, checks a fix against)

| Check | Vulnerable baseline | Correct fix |
| --- | --- | --- |
| alice GET `rec-1001` (own) | 200 | 200 |
| alice GET `rec-2001` (foreign tenant) | **200 (bug)** | **404** |
| admin-a GET `rec-1001` (own tenant, other user) | 200 | 200 |
| bob GET `rec-2001` (own) | 200 | 200 |
| `/internal/integrity` → `intact` | true | true (data unchanged) |
| `/health` | 200 | 200 |

A good fix flips the foreign-tenant read to 404 **without** breaking the other rows.
An over-restrictive fix (e.g. also blocking admin or own-tenant reads) fails this contract.

## Red-team proof

```bash
TARGET_URL=http://127.0.0.1:3000 npm run redteam -w @restorelab/fixture
```

Prints a `Finding` JSON (OWASP mapping, evidence, reproduction steps) and reports whether
the cross-tenant read was reproduced. Runs only against `ALLOWED_TARGETS`
(default localhost). Reset between runs with `scripts/reset-fixture.sh`.

## Real-world analog & stretch target: VAmPI

Our RecordShop bug is the same class as the BOLA in [VAmPI](https://github.com/erev0s/VAmPI),
an OWASP-catalogued vulnerable API. VAmPI's `GET /books/v1/{title}` returns another user's
book secret with no owner check — identical shape to our `GET /api/records/:id`. We keep
RecordShop as the **primary** target (Node/TS, tailored contract) and offer VAmPI as a P1
**stretch** target to show the loop generalizes to a third-party app.

```bash
scripts/vampi-up.sh                 # needs docker: :5002 vulnerable=1, :5001 vulnerable=0 (reference fix)
TARGET_URL=http://127.0.0.1:5002 npm run redteam:vampi -w @restorelab/fixture
```

The probe (`redteam/vampi.ts`) registers two synthetic users, has one store a secret, and
proves the other can read it — emitting the same `Finding` JSON as RecordShop. `vulnerable=0`
on :5001 is the deterministic reference recovery the plan requires.

**VAmPI's 9 intentional vulns** (we scope the loop to #3 only; the rest are out of scope):
SQLi; unauthorized password change; **BOLA (`GET /books/v1/{title}`)**; mass assignment
(register as admin); excessive data exposure (`/users/v1/_debug`); user/password enumeration;
RegexDoS; no rate limiting; JWT bypass (weak signing key). Auth: `Authorization: Bearer <auth_token>`
from `POST /users/v1/login`.

## Handoff to Belal

- Image: `docker build -f fixture/Dockerfile -t restorelab-fixture .`
- Baseline id: the image tag above (vulnerable). Every candidate forks from it.
- Reset: `scripts/reset-fixture.sh [TARGET_URL]` → canonical state, exits non-zero if not intact.
