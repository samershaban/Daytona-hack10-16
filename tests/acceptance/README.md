# Acceptance contract: BOLA fix (VAmPI)

This is the independent definition of a successful fix for the broken object-level
authorization flaw on VAmPI's `GET /books/v1/{title}` (OWASP API1:2023,
WSTG-ATHZ-04). It lives in [`contract.ts`](./contract.ts). Only that books-route
BOLA is in scope; every other VAmPI weakness is out of scope here.

The checks are written from the fixture's known identities and books, not from
anything a recovery agent says. An agent cannot mark its own fix as passing; only
these checks, run against the candidate's running service, can.

## The checks (all required)

| # | Check | Passes when | Catches |
|---|---|---|---|
| 1 | `exploit-closed` | userB requesting userA's book title → **404**, and the body does **not** contain userA's secret | A fix that doesn't actually close the cross-user read |
| 2 | `owner-read-preserved` | userA reads their own book → 200 and the secret equals the expected value | An over-restrictive fix that blocks the real owner |
| 3 | `b-own-book` | userB creates a book and reads it back (POST then GET) → 200 | An over-restrictive fix that breaks access to a user's own new book |
| 4 | `missing-book-404` | authenticated GET of a nonexistent title → 404 | A fix that turns "not found" into an error or a bypass |
| 5 | `unauth-401` | GET userA's book with no `Authorization` header → 401 | A fix that leaves the route readable without auth |
| 6 | `data-preserved` | userA's and userB's known books still return their baseline secrets | "Closing" access by deleting or rewriting seed data |
| 7 | `service-healthy` | a basic liveness GET returns a non-5xx status | A patch that leaves the service crashing |

## Fresh auth, never a cached token

The runner logs in userA and userB at the start of **every** run and uses only
those fresh tokens. A cached or expired token (401) must never be read as a
working fix, so a login failure makes the dependent checks UNKNOWN — never pass.

## Verdict rules

Each check returns `passed: true`, `false`, or `null` (it could not run: login
failed, service unreachable, bad response), plus an `evidenceId`. The decision
considers the required checks (all of them here):

- **pass**: every required check ran and passed.
- **fail**: at least one required check failed. A failure outranks unknowns.
- **unknown**: nothing failed, but at least one required check could not run.

Any setup failure, login failure, service error, or missing evidence yields
FAIL or UNKNOWN — never pass.

## Secrets never land in evidence

Secrets, passwords and live tokens are stripped from every stored response body.
`exploit-closed` checks the raw body for the secret (to prove it did not leak)
and then stores the redacted body.

## Runner and scope

[`verifier/`](../../verifier) executes this contract. It talks only to targets in
`ALLOWED_TARGETS` and hard-refuses the `vulnerable=0` reference oracle on `:5001`
(see [`verifier/candidates/README.md`](../../verifier/candidates/README.md)).
