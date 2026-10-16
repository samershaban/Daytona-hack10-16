# Acceptance contract: BOLA fix

This is the independent definition of what counts as a successful fix for the broken object-level authorization flaw on RecordShop's `GET /api/records/:id` (OWASP API1:2023, WSTG-ATHZ-04, ASVS 5.0 V8.2.2). It lives in [`contract.ts`](./contract.ts) and mirrors the hard-contract table in [`fixture/README.md`](../../fixture/README.md).

The checks are written from the fixture's known identities and records, not from anything a recovery agent says or produces. An agent cannot mark its own fix as passing; only these checks, run against the candidate's running service, can.

## The checks (in order)

| # | Check | Gate | Passes when | Catches |
|---|---|---|---|---|
| 1 | `exploit-closed` | required | alice (tenant-a) GET `rec-2001` → **404** | A fix that doesn't address the red-team finding |
| 2 | `foreign-tenant-denied` | required | bob (tenant-b) GET `rec-1001` → **404** | A fix that only blocks the one direction in the reproduction |
| 3 | `own-tenant-allowed` | required | alice GET her own `rec-1001` → 200, `body.record` is `rec-1001` in `tenant-a` | A fix that is too strict and blocks legitimate users |
| 4 | `bob-own-allowed` | required | bob GET his own `rec-2001` → 200 | Same, in the other tenant |
| 5 | `admin-preserved` | required | admin-a GET `rec-1001` (own tenant, another user's record) → 200 | A fix that is too strict and breaks the tenant-admin policy |
| 6 | `admin-not-godmode` | optional | admin-a GET `rec-2001` (other tenant) → 404 | A fix that lets admins bypass tenant isolation |
| 7 | `data-unchanged` | required | `GET /internal/integrity` → `intact: true`, `recordCount: 4` | "Fixing" access by deleting or adding records |
| 8 | `service-healthy` | required | `GET /health` → 200 | A patch that leaves the service broken |

Denials must be **404**, so the API doesn't reveal whether a record exists.

## Over-restrictive fixes MUST fail

Blocking every request would pass checks 1 and 2. That is not a fix. **A candidate that breaks own-tenant reads (checks 3–4) or tenant-admin access (check 5) MUST fail**, even if it closes the exploit and even if the agent reports it as fixed.

## Verdict rules

Each check returns `passed: true`, `false`, or `null` (it could not run: service unreachable, malformed integrity response, etc.), plus an `evidenceId` pointing at the captured request and response. The decision considers **required** checks only:

- **pass**: every required check ran and passed.
- **fail**: at least one required check failed. A failure outranks unknowns.
- **unknown**: nothing failed, but at least one required check could not run or is missing.

`admin-not-godmode` is reported but never changes the decision, because it isn't in the fixture's hard-contract table. Only `pass` candidates are ranked; if none pass, there is no winner.

## Runner

[`verifier/`](../../verifier) executes this contract. It only sends GET requests, never calls `/internal/reset` (a reset would hide the data mutations check 7 is there to catch), and refuses any target not in `ALLOWED_TARGETS`.
