# @restorelab/api

The single source of truth for a RestoreLab run: approvals, evidence, findings, agent messages, candidates, verifier verdicts, the event feed and the final report. Types live in `@restorelab/contracts`.

```bash
npm i                                    # repo root
npm run dev -w @restorelab/api           # http://localhost:4000, in-memory
STORE=jsonl   npm run start -w @restorelab/api    # durable fallback: .data/api.jsonl
STORE=surreal npm run start -w @restorelab/api    # SurrealDB (start it first: npm run start -w @restorelab/db)
npm run smoke -w @restorelab/api         # end-to-end check; add STORE=jsonl|surreal to test those
```

Env: `PORT` (4000), `HOST` (0.0.0.0), `STORE` (`memory` | `jsonl` | `surreal`), `JSONL_PATH`, `SURREAL_URL` (`ws://127.0.0.1:8000/rpc`), `SURREAL_USER` / `SURREAL_PASS` (root/root), `SURREAL_AUTH_LEVEL` (`root` | `namespace` | `database`), `SURREAL_NS` (restorelab), `SURREAL_DB` (api).

### Surreal Cloud

1. In Surrealist, connect to your Cloud instance and create a user for the API, e.g. `DEFINE USER restorelab_api ON ROOT PASSWORD '...' ROLES OWNER;` (or `ON NAMESPACE` / `ON DATABASE` with `USE NS restorelab` / `USE NS restorelab DB api` first, and set `SURREAL_AUTH_LEVEL` to match).
2. `cp .env.example .env` at the repo root and set `SURREAL_URL=wss://<instance>.surreal.cloud/rpc`, `SURREAL_USER`, `SURREAL_PASS`, `SURREAL_AUTH_LEVEL`. `.env` is git-ignored.
3. `npm run smoke:env -w @restorelab/api` to check, then `npm run start:env -w @restorelab/api`.

The API creates whatever its user is allowed to (root: namespace + database; namespace user: database) and applies `schema.surql` on connect.

Send `content-type: application/json` and an `x-role` header: `orchestrator`, `redteam`, `agent`, `verifier` or `human`. The role is recorded as the event source and gates approvals and verdicts. It is an honor system, not authentication. Errors are `{ error, message }` with status 400 (bad body), 403 (wrong role), 404, 409 (state conflict) or 422 (rule violated).

## Endpoints

| Method + path | Who | Notes |
| --- | --- | --- |
| `GET /health` | anyone | `{ ok, store }` |
| `POST /runs` | orchestrator | `{ targetUrl, baseFixtureId, targetVersion, description? }`, starts `awaiting_scope_approval` |
| `GET /runs`, `GET /runs/:id` | anyone | |
| `PATCH /runs/:id` | orchestrator | `{ status, reason? }` manual move (`failed` from anywhere); most moves are automatic |
| `GET /runs/:id/events?after=<seq>` | dashboard, agents | poll with the last `seq` you saw |
| `POST /runs/:id/approve` | **human** | `{ kind: 'scope'\|'remediation', decision: 'approved'\|'denied', approver, note?, candidateId? }` |
| `GET /runs/:id/approvals` | anyone | |
| `POST /runs/:id/evidence` | red-team, agents, verifier | `{ kind, label, content?\|uri?, candidateId?, author }`; credentials in `content` are redacted |
| `GET /runs/:id/evidence[/:eid]` | anyone | list omits `content` |
| `POST /runs/:id/findings` | red-team, agents | `{ author, category, observation, evidenceIds, targetScope }` |
| `GET /runs/:id/findings?excludeAuthor=` | agents | read what others found |
| `POST /runs/:id/messages` | agents | `{ from, to: 'room'\|agent, type, findingIds?, body }` |
| `GET /runs/:id/messages?for=<agent>` | agents | messages to that agent or the room, not its own |
| `POST /runs/:id/candidates` | agents/infra | `{ sandboxId, baseFixtureId, strategy, label?, agentId?, targetUrl?, patchRef? }` |
| `GET /runs/:id/candidates[/:cid]` | anyone | includes `verdict` when present |
| `PATCH /runs/:id/candidates/:cid` | agents | `{ status?, patchRef?, targetUrl?, agentClaim? }` |
| `POST /runs/:id/verdicts` | **verifier** | `{ candidateId, checks: [{ name, passed, evidenceId }], decision, recoveryMs?, verifier }` |
| `GET /runs/:id/verdicts` | anyone | |
| `GET /runs/:id/report` | dashboard | live assessment, safe to poll |
| `POST /runs/:id/complete` | orchestrator | selects the winner and closes the run |
| `GET /memory?q=&run=&kind=&k=` | agents | search Agent Memory across runs (`kind`: `finding` / `decision`); 503 if not configured |

## Rules enforced here

- Nothing but approvals can be written until a human approves the scope. Approval moves the run to `investigating`; denial fails it. Closed runs (`completed`, `failed`, `unknown`) reject writes.
- Runs move automatically: first candidate → `experimenting`, first verdict → `verifying`, `complete` → `completed` / `unknown` / `failed`.
- Findings must cite evidence stored in this run. `finding` and `decision` messages must cite findings in this run. Findings and messages that look like they contain a credential are rejected (refer to identities by name, e.g. "alice").
- At most 3 candidates per run, all on the run's `baseFixtureId`. Re-posting the same `label` and `sandboxId` returns the existing candidate.
- Verdicts come only from `x-role: verifier`, are immutable, must cite stored evidence for every check, and cannot be `pass` with any check not passed. `agentClaim` is display only.
- Selection: a candidate is eligible only with a `pass` verdict, all checks passed, the run's baseline and a measured `recoveryMs`. The fastest eligible candidate wins. `complete` requires a verdict for every candidate.
- Remediation approval is accepted only for the selected candidate.
- Event `seq` is per run, gap-free and ordered.

## Agent Memory (SurrealDB Agent Memory / Spectron Cloud)

Optional cross-run memory for the agents. Set `AGENT_MEMORY_URL` and `AGENT_MEMORY_API_KEY` (a `sp-...` key from SurrealDB Studio > API keys; no username/password) and start with `npm run start:env`. `/health` shows `agentMemory: enabled`.

- Every published finding and every `finding` / `decision` message is copied into Agent Memory in the background via the MCP `remember` tool, labelled `app=restorelab`, `run=<runId>`, `kind=...`, `ref=<id>`, `author=...` (findings also `category`, `target_version`).
- Writes never block or fail the API call. Each one produces a `memory.stored` or `memory.failed` event in the run's feed.
- `GET /memory?q=...` searches with MCP `recall`, filtered to `app=restorelab` (and `run` / `kind` if given). Leave out `run` to get what earlier runs learned.
- `AGENT_MEMORY_INFER=none` stores raw text without LLM extraction.
- The API's own store stays the source of truth; Agent Memory is a recall aid and is never used for verdicts or selection.

## SurrealDB

`schema.surql` (namespace `restorelab`, database `api`) is applied on connect. Besides the documents, inserts write a provenance graph you can query in Surrealist or `surreal sql`:

```sql
-- which evidence backs agent B's decision
SELECT body, ->cites->finding->supported_by->evidence.label AS evidence FROM message WHERE from = 'agentB' AND type = 'decision';
-- what each verdict was checked against
SELECT id, ->judged_by->verdict.decision AS decision, ->judged_by->verdict->checked_with->evidence.label AS evidence FROM candidate;
```

`packages/db` holds the earlier disaster-recovery schema and is not used by this API.
