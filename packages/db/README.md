# @restorelab/db

SurrealDB persistence for RestoreLab: runs, the append-only event trail, candidates, tool actions, findings, approvals and recipes. Types follow `BUILD_PLAN.md` §4. They're copied into `src/types.ts` until `packages/contracts` exists.

```bash
npm i                                # from repo root (workspaces)
npm run start -w @restorelab/db      # local SurrealDB, persisted to .data/
npm run smoke -w @restorelab/db      # end-to-end check of the rules below
```

Env: `SURREAL_URL` (default `ws://127.0.0.1:8000/rpc`), `SURREAL_USER`, `SURREAL_PASS`. The schema is applied on connect.

```ts
import * as db from "@restorelab/db";
```

| Who | Calls |
| --- | --- |
| Orchestrator (Owner 3) | `createContract`, `createScenario`, `createRun`, `setRunStatus`, `approveScope` / `decide`, `listEvents`, `getReport` |
| Infra (Owner 1) | `createCandidate` |
| Agents (Owner 2) | `logToolAction`, `recordAgentClaim`, `publishFinding`, `readSharedFindings`, `citeFinding`, `recordRetest` |
| Verifier (Owner 4) | `recordVerdict`, `setFindingStatus`, `rankCandidates` |
| Runbooks | `proposeRecipe`, `decideRecipe`, `approvedRecipe`, `markReused` |

All ids are plain strings. A candidate's id is `${runId}_${label}`.

## Rules enforced here

- A run can't enter `PREPARING` until an `APPROVED` SCOPE approval is stored. Denying scope cancels the run.
- Run statuses can only change along legal transitions. `FAILED` and `CANCELLED` are reachable from any non-terminal state.
- At most 3 candidates per run. `createCandidate` and approvals are idempotent on retry.
- `recordVerdict` won't store a `PASS` unless every check in the contract is `PASS`. `recordAgentClaim` is display-only.
- `rankCandidates` (§7): a candidate is eligible only if its verdict and every check are PASS, its baseline fingerprint matches, it attempted no forbidden op, and its data loss is within the contract. Eligible candidates are ranked by `elapsedMs`, then data loss, risk and cost. If none qualify, the result is `NO_VERIFIED_RECOVERY`.
- Event and tool-action `seq` numbers are gap-free and stay ordered even when calls run concurrently.
- Findings must have `evidenceRefs` and start as `OBSERVED`. Readers don't see their own findings. Provenance is stored as `cites` / `retested` graph edges.
- Recipes can only be made from a `PASS` candidate. Approving a recipe supersedes the previously approved one.
