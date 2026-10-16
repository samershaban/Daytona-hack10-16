# Local proof targets (VAmPI)

VAmPI (erev0s/VAmPI) is a Python/Flask app, so candidates run as containers, not
Node servers. Each candidate is a VAmPI instance on an **allowed** port (`:5000`);
the **reference** oracle lives on `:5001` and the verifier refuses to test it.

> Confirm the exact image tag and the name of the `vulnerable` flag with Belal/Mahmoud
> (they own the fixture). The commands below use the documented `vulnerable` env var.
> After starting any instance, call `GET /createdb` once to seed users and books —
> logins fail until you do.

Set the real seed credentials/books/secrets in [`../identities.ts`](../identities.ts)
(replace the `MOCK_*` values) before expecting meaningful results.

## (a) Vulnerable candidate — expect FAIL on `exploit-closed`

The unpatched BOLA: userB can read userA's book (and its secret) by title.

```bash
docker run --rm -p 5000:5000 -e vulnerable=1 erev0s/vampi:latest
curl -s http://127.0.0.1:5000/createdb        # seed users + books (once)

npm run verify -- --url http://127.0.0.1:5000 --candidate vuln
# DECISION: FAIL   (exploit-closed fails: userB gets 200 + userA's secret)
```

## (b) Reference behavior as the correct oracle — expect PASS

Run a `vulnerable=0` instance **on an allowed candidate port** (`:5000`), not on
`:5001`. This uses the reference's correct behavior as a stand-in for a correctly
patched candidate, which is what a good fix must match.

```bash
docker run --rm -p 5000:5000 -e vulnerable=0 erev0s/vampi:latest
curl -s http://127.0.0.1:5000/createdb

npm run verify -- --url http://127.0.0.1:5000 --candidate oracle
# DECISION: PASS   (cross-user read denied, owner reads preserved, data intact)
```

## Scope guard — the reference instance is always refused

The designated comparator runs on `:5001`. The verifier refuses it so a
known-good instance can never be mistaken for a verified candidate.

```bash
docker run --rm -p 5001:5000 -e vulnerable=0 erev0s/vampi:latest   # the oracle

npm run verify -- --url http://127.0.0.1:5001 --candidate oracle
# refusing: ... is on the reference port :5001 (the vulnerable=0 oracle). ...
# exit code 4   (hard error — the run does not proceed)
```

The guard keys off the port, so `:5001` is refused even if it is added to
`ALLOWED_TARGETS`. A target that is neither allowed nor the reference exits 3.

## Running two candidates at once

Put the second candidate on `:5002` (also allowed) and verify each by URL:

```bash
docker run --rm -p 5000:5000 -e vulnerable=1 erev0s/vampi:latest   # candidate A
docker run --rm -p 5002:5000 -e vulnerable=1 erev0s/vampi:latest   # candidate B (patched in code)
npm run verify -- --url http://127.0.0.1:5000 --candidate A
npm run verify -- --url http://127.0.0.1:5002 --candidate B
```
