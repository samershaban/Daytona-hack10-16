# Red-team targets

Owner: **Mahmoud**. Both targets are team-owned/synthetic; probes are scope-guarded to
owned URLs only. The loop scopes to **one vuln class: BOLA (OWASP API1:2023 / WSTG-ATHZ-04)**.

## Primary target — VAmPI

[VAmPI](https://github.com/erev0s/VAmPI) (`erev0s/vampi`), an OWASP-catalogued vulnerable
Flask API. Its `GET /books/v1/{title}` returns another user's book secret with no owner
check. We use it as the primary target because it's a recognized real-world app and ships a
built-in `vulnerable=0` reference build.

```bash
scripts/vampi-up.sh                                  # docker: :5002 vulnerable=1, :5001 vulnerable=0 (reference fix)
scripts/seed-vampi.sh http://127.0.0.1:5002          # deterministic reset + seed (createdb + canonical book)
TARGET_URL=http://127.0.0.1:5002 npm run redteam:vampi -w @restorelab/fixture   # prove BOLA
```

**Full pinned execution contract (for Belal): [`vampi-contract.md`](./vampi-contract.md)** —
pinned commit, baseline image/hash, source workspace, startup/readiness, reset/seed,
synthetic identities, and the cross-user evidence shape.

**Auth:** `Authorization: Bearer <auth_token>` from `POST /users/v1/login`.

**Hard contract (for Hamza's verifier):**

| Check | vulnerable=1 | fixed |
| --- | --- | --- |
| owner reads own book (`GET /books/v1/{t}`) | 200 + secret | 200 + secret |
| other user reads that book | **200 + secret (bug)** | **404** |
| `GET /users/v1` after reset | seeded users present | unchanged |
| service healthy (`GET /`) | 200 | 200 |

**Handoff to Belal (Daytona):**
- Baseline image: `erev0s/vampi:latest` with `vulnerable=1` (the broken baseline all candidates fork from).
- To let recovery agents produce a *real* code patch (not just flip a flag), clone the VAmPI
  repo into the sandbox and build from source; the BOLA fix is the ownership filter in
  `api_views/books.py` (`Book.query.filter_by(user=user, book_title=...)`).
- `vulnerable=0` is the author's **reference** recovery only. VAmPI warns some other vulns stay
  on at `vulnerable=0`; that's fine — we only verify BOLA.
- Reset between runs: `scripts/reset-vampi.sh` (GET /createdb), or a fresh container.

VAmPI's 9 intentional vulns (only #3 BOLA is in scope): SQLi; unauthorized password change;
**BOLA**; mass assignment; excessive data exposure (`/users/v1/_debug`); user/password
enumeration; RegexDoS; no rate limiting; JWT bypass (weak key).

## Fallback target — RecordShop

Our own Node/TS fixture in [`fixture/`](../fixture/README.md). Same BOLA shape, tailored
contract, language-matched to the team. Kept as the fallback if VAmPI's container/Daytona
path stalls, per the plan's kill/fallback rules. Probe: `npm run redteam -w @restorelab/fixture`.
