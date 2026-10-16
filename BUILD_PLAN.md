# RestoreLab — HackSprint Build Plan

> **Status:** Implementation plan, not evidence that functionality has shipped.  
> **Event:** Daytona HackSprint NYC, October 16, 2026. Published submission window: **9:30 a.m.–3:30 p.m. EDT**.  
> **Team:** Four developers, working concurrently. Set `H0` to the team's actual kickoff and move the final feature freeze earlier if less than six hours remain. Submit before 3:30 p.m.; do not treat 3:30 as a development milestone.  
> **Baseline:** The agreed [README](./README.md) and RestoreLab final PRD.  
> **Goal:** Demonstrate real **autonomous recovery discovery**—not just scripted recovery recipes, monitoring, or successful agent narration.

## 1. The promise and acceptance bar

**Demo promise:** RestoreLab inspects an owned sample app, detects an unreliable recovery assumption, recommends an authorized disaster drill, executes *three distinct autonomous recovery investigations* from equivalent broken baselines in Daytona, independently validates actual product and data recovery, ranks qualifying candidates by measured verified recovery time, and saves a reviewable recovery plan. Agents share scoped, evidence-backed findings while retaining independent experiment branches. A consequential real-world change never occurs without approval.

**Definition of a working MVP (all required):**

1. A real small app has a UI, API and Postgres data; its healthy baseline passes a published `RecoveryContract`.
2. A real, reproducible, **owned/synthetic** failure breaks that app. The expected/latest backup is unusable; alternate options require investigation and may lose data or need a compatibility fix.
3. RestoreLab performs some real autonomous intake/risk assessment from manifest, logs, backup metadata and/or a test restore, then proposes a drill for approval.
4. Three Daytona-backed candidates use actual tools against independent equivalent failure baselines. An agent cannot declare its own attempt verified. Agents may share factual evidence with provenance, not privileged secrets or untested claims.
5. A separate verifier checks DB integrity and freshness, API response, configuration/schema compatibility and a user journey. A process being `UP` is not sufficient.
6. Only candidates passing all hard gates are ranked; among those, default to the **fastest time until verified recovery**. No passing candidate means `NO_VERIFIED_RECOVERY`—never fabricate a winner.
7. UI displays candidate states and the *reason* each passed or failed, relevant evidence, proposed runbook and the explicit human approval boundary.
8. A real Arize trace covers investigation and evaluation; SurrealDB persists scoped observations, results and provenance. Record measured results honestly; no invented learning improvements.
9. One uninterrupted, rehearseable **three-minute** demo and recorded backup exist before submission.

### Product positioning

Gremlin/AWS/Veeam already provide important resilience and backup-testing capabilities. RestoreLab's testable proposed differentiator is the combination of autonomous *discovery*, equivalent parallel experimental recovery branches, independent **application-level** verification, and reuse of verified findings. Do not claim those primitives are unprecedented or that the project prevented GitLab's real 2017 incident. The historical incident illustrates the consequences of discovering broken recovery paths too late.

## 2. Ruthlessly scoped demonstration fixture

**Sample application:** `RecoveryShop`, a tiny synthetic order-management SaaS. An `api` service (Node/TypeScript), Postgres DB, and a minimal HTML/browser UI. It exposes `GET /health` (process-level), `GET /ready` (dependency-level), `POST /api/login` for a synthetic demo account, `GET /api/orders`, and `GET /api/recovery-proof` (server-side view of version/records). Synthetic seed includes order IDs, timestamps, a canonical row count/checksum, a newest order marker, and a test user. No genuine customer data or payments.

**Failure story:** A database/data or migration failure makes the business API unusable while a naive process health check may remain green. The nominal newest backup cannot restore (explicit controlled corruption/format or version mismatch). An older restore can bring up a service but breaches an agreed freshness/data-loss gate. A valid alternative exists but requires discovering the right restore source *and* correcting a compatibility/configuration problem. Fixture author must prove that at least one feasible solution exists by a deterministic reference recovery before agents run; that reference implementation is not available to agents or verifier as a hidden answer key.

**Agent diversity is real, not precomputed winners:** Give candidates different investigation approaches or initial hypotheses (e.g. backup-first, schema/config-first, evidence-first), common allowlisted capabilities, and the same starting failure. Do **not** hardcode their command sequences or fake their outcomes. A genuine run may have a different winner or no verified winner; test the proposed stage scenario in rehearsals. Candidate A/B/C labels refer to branches, not predetermined grades.

**Equivalent baselines:** Create a prepared failed image/snapshot or deterministic seeded copy with identical app version, DB fixture, failure parameters, backup artifacts and contract for all candidates. Daytona supports independent sandbox runtime and fork/snapshot options, but only use a fork API once tested with the allocated account/runtime. A prebuilt OCI image or repeatable reset is an acceptable fallback. Do not let shared mutable DB/storage contaminate branches.

**AWS role:** Prefer one low-complexity EC2 deployment of the same healthy synthetic sample application (Docker Compose), showing realistic cloud provenance/read-only inspection. Run all destructive experiments on disposable **Daytona replicas**, not production or the EC2 demonstration instance. If AWS deployment blocks the critical path, retain a real locally/Daytona hosted sample and add AWS after the end-to-end loop is green. Never use live customer resources.

## 3. Four workstreams and ownership

The four workstreams are intentionally different and have equal stakes in the demo. Each owner must supply a real independently testable artifact and must provide a stub contract to downstream teammates before the first hour is over.

### Owner 1 — Infrastructure, AWS & Daytona Fault Lab

**Owns:** `sample-app/`, `infra/`, `fixtures/`, `packages/sandbox-adapter/`, sandbox lifecycle and fault scripts. Sole owner of application/backup fixture truth, environment reproducibility and sandbox credentials.

**P0 tasks (in order):**
- Create RecoveryShop with `api + postgres + UI`, deterministic seed, test credentials, process and readiness probes; document expected record IDs and freshness marker.
- Build a healthy Docker Compose baseline plus a deterministic controlled failure. Prove the initial recovery contract passes while healthy and fails after fault injection.
- Generate three real candidate restore artifacts/options: defective newest backup, stale but runnable backup, and viable alternative requiring investigated compatibility correction. Provide clear logs/metadata for agents to examine; don't expose the correct choice directly.
- Package the **same failed state** into three independently writable Daytona candidates. Return stable IDs, command execution capability, log/artifact retrieval and candidate preview URLs. Verify each is actually isolated with a marker-write test.
- Implement command/tool adapter with budgets (wall-clock, CPU if feasible), timeout, allowlist and per-candidate output capture. Clean up abandoned sandboxes.
- If on schedule, host a clean/reference RecoveryShop environment on AWS EC2 with restricted SGs, no embedded cloud keys, documented teardown and bounded spend. AWS is not required to execute the disaster.

**Deliverables:** `docker compose up` healthy fixture; `inject-failure` script; `reset/seed` or immutable image; backup metadata and reference proof; `createCandidate(runId, candidateId)` and `execCandidate(...)` with real Daytona IDs; URLs or an in-sandbox verifier endpoint.

**Acceptance tests:** healthy → failure → reset reproducible twice; three candidate branches have matching fixture fingerprint; modification in one branch is absent from the other two; stale/defective backups fail the intended separate gates; no production host is altered by fault injection.

**Fallback:** OCI-image-based independent sandboxes instead of fork/snapshot; Daytona-hosted sample instead of EC2; one compelling failure instead of five scenario types. Never fall back to fake tool results.

### Owner 2 — Autonomous Discovery, Recovery Agents & Mesh Research

**Owns:** `packages/agents/`, `packages/research/`, agent prompts/tools, candidate planning/execution, scoped collaboration protocol. Consumes Owner 1's tool adapter and Owner 3's run/event contracts.

**P0 tasks (in order):**
- Implement `Inspector` that receives *real* app manifest, logs, backup metadata and contract; emits evidence-backed risks, a proposed failure drill and risk rationale. A deterministic risk heuristic may complement AI, but don't portray a hardcoded scenario as fully autonomous discovery.
- Implement `ScenarioPlanner` that operates **only after** approved scope is received. Provide candidate agents distinct strategic hypotheses rather than prescribed recovery scripts.
- Build a bounded recovery toolbox: `inspectFiles`, `readLogs`, `inspectDbMetadata`, `checkBackup`, `runAllowedCommand`, `applyCandidatePatch`, `requestVerification`, `publishFinding`, `readSharedFindings`. Commands must be restricted by Owner 3's policy and enforced by Owner 1's adapter.
- Execute three genuine Daytona investigations concurrently with independent working state and capped attempts. Require structured plan/action/rationale/outcome; capture tool outputs and trace IDs.
- Mesh-inspired collaboration: publish factual `Finding` items (what happened, evidence, environment/version, confidence, scope) to Owner 3's shared store. Other agents may subscribe to findings; they must check applicability and test any reused hypothesis locally. No raw credentials; no cross-tenant sharing.
- Generate evidence-linked proposed runbook and suggested config/code changes **after** independent verification, not from an unverified agent self-report.
- Plug in external document research **only if** execution, evaluation and demo already work. A You.com adapter is worthwhile for a specific discovered error; cite URL, retrieval time and snippets and verify claims by sandbox execution. Never let retrieved page text override tool/safety policy.

**Deliverables:** `inspectApp(input) -> RiskProposal[]`, `planCandidates(...)`, `runCandidate(...)`, `Finding` messages, actual tool traces, `proposeRunbook(verifiedResult)`.

**Acceptance tests:** changing input logs changes risk analysis; an agent reads actual candidate state, calls real tools, and can correct its hypothesis; three branch executions are independent; one agent can see and cite another's factual finding without copying credentials; an unsafe command request is refused.

**Fallback:** 2 LLM-generated autonomous candidates plus 1 alternative heuristic/tool-supported agent, **only if** all are genuine independent investigations and the distinction is disclosed. Drop external web research before cutting independent execution.

### Owner 3 — Backend Orchestration, SurrealDB & Product UI

**Owns:** `apps/control-plane/`, `apps/web/`, `packages/contracts/`, `packages/db/`; team-wide API/event schema and integration branch. This owner must use a single-screen UI, not a full SaaS onboarding flow.

**P0 tasks (in order):**
- Freeze TypeScript contracts by the first integration checkpoint. Central `Run`, `RiskProposal`, `RecoveryContract`, `Scenario`, `Candidate`, `Evidence`, `Finding`, `Approval`, `RecoveryRecipe`, `RunEvent` schemas. Define IDs, statuses, timestamps and exact error semantics.
- Orchestrate lifecycle: `CREATED → INSPECTING → AWAITING_SCOPE_APPROVAL → PREPARING → RUNNING → VERIFYING → COMPLETE | NO_VERIFIED_RECOVERY | FAILED | CANCELLED`. Persist state and append-only event trail outside candidate sandboxes.
- Enforce human approval server-side *before* destructive drill scope, and before any non-sandbox/consequential suggested action. Denial cancels or retains report; browser UI button state alone is not an authorization mechanism.
- Build minimal SurrealDB persistence for runs, findings, candidate evidence, approvals, recipe provenance and compatibility. If native Agent Memory APIs prove time-consuming, use explicit records and document the limitation, rather than claiming implemented memory features.
- Provide REST endpoints for `POST /runs`, `GET /runs/:id`, `POST /runs/:id/approve-scope`, `POST /runs/:id/cancel`, `GET /runs/:id/events`, `GET /runs/:id/report`; use SSE for live updates if ready, otherwise polling every ~1s.
- Deliver a polished Next.js **single-page incident command center**: real app baseline → risk proposal/approval → injected disaster → parallel candidate lanes with real actions/logs → verification evidence/results → fastest passing winner → runbook and approval. Unknown or incomplete is visibly not `SUCCESS`.
- Implement idempotent orchestration: retries must not duplicate scope approvals, launch extra candidate sandboxes or lose run history; enforce max three candidates and budget caps.

**Deliverables:** `packages/contracts` available to all owners; end-to-end API with mock adapters by first milestone; SurrealDB records with explicit provenance; live demo page and printable report.

**Acceptance tests:** fresh user session can trigger a full mock flow; an unapproved drill does not create destructive candidate runs; malformed/eventual failures remain visible; restart of control plane retains run state and prior evidence; frontend uses actual API events, not a separate fabricated results array.

**Fallback:** Polling instead of SSE; one-page UI with basic styling instead of a multipage design; store raw trace/evidence references if rich SurrealDB graph relationships slow delivery. Prioritize correctness and visibility over polish that obscures the product.

### Owner 4 — Independent Verification, Arize & Anchor / Demo Quality

**Owns:** `packages/verifier/`, `packages/evals/`, `tests/e2e/`, demo script/recording. This owner must *not* accept the recovery agent's own claim as proof and should not know or rely on the pre-scripted identity of the expected winner.

**P0 tasks (in order):**
- Define developer-approved `RecoveryContract` fixtures: sample test user can login, orders endpoint returns exact canonical records, newest marker meets agreed RPO, DB integrity/checksum passes, config/schema version is compatible, service readiness is green, and a browser journey succeeds.
- Independently test healthy/faulted/reference-restored instances before agent integration; demonstrate both false-positive and data-loss rejection with actual assertions.
- Build `verifyCandidate(runId, candidateId, target)`: run DB/API assertions, then an Anchor Browser login→orders user journey if accessible; attach screenshots/step evidence and trace IDs. A Playwright/browser fallback may preserve functional truth if Anchor connectivity blocks access, but do not claim Anchor integration unless actually running.
- Enforce **hard gates**: reject missing evidence, wrong version, failed auth/API, inconsistent records, unacceptable data loss or unauthorized commands. `GET /health = 200` by itself never suffices.
- Rank qualifying candidates by **verified elapsed recovery time**; allow user-configurable safety/RTO/RPO/cost preferences. No passing candidates → `NO_VERIFIED_RECOVERY`.
- Add Arize tracing/evaluation for inspector/recovery/verifier decisions and compare at least one actual run to its measured baseline. Arize observes/scores; deterministic app checks remain the authority. Wire evidence and scores to Owner 3's report.
- Own adversarial tests and complete 3-minute demo rehearsal: restore process is green but login broken; stale backup serves UI but fails RPO; agent hallucinates success; timeout/cancellation; scope denied.

**Deliverables:** contract fixture and runner; candidate verdict JSON, exact reason per failed gate, objective metric comparator, Arize trace URL/IDs, Anchor proof when feasible, screencast backup and judge script.

**Acceptance tests:** known bad restore rejected even if server is running; known stale restore rejected; a good candidate passes; no agent self-report can modify verdict; candidate ranking is reproducible from evidence; demo can be replayed on synthetic fixture.

**Fallback:** Keep DB+API truth gates even if Anchor is unavailable; keep one real Arize traced execution even if custom dashboards are not ready; demo logs and screenshots can be simple but must show actual evidence.

## 4. Freeze these shared contracts early (Owner 3 publishes; all four sign off)

Use a small common TypeScript package and versioned JSON event envelope. Do not allow each owner to invent incompatible states or names.

```ts
type Verdict = 'PASS' | 'FAIL' | 'INCOMPLETE';
type RunStatus = 'CREATED' | 'INSPECTING' | 'AWAITING_SCOPE_APPROVAL'
  | 'PREPARING' | 'RUNNING' | 'VERIFYING' | 'COMPLETE'
  | 'NO_VERIFIED_RECOVERY' | 'FAILED' | 'CANCELLED';

type RecoveryContract = {
  id: string; appVersion: string; approvedBy: string;
  requiredOrderIds: string[]; minLatestOrderMarker: string;
  expectedSchemaVersion: string; maxDataLossSeconds: number;
  checks: Array<'db_integrity' | 'data_freshness' | 'api' | 'login' | 'browser'>;
};

type Finding = {
  id: string; runId: string; authorAgentId: string;
  appVersion: string; environmentFingerprint: string;
  claim: string; evidenceRefs: string[]; observedAt: string;
  scope: 'run' | 'app_version'; status: 'OBSERVED' | 'VERIFIED' | 'REJECTED';
};

type CandidateResult = {
  candidateId: string; sandboxId: string; baselineFingerprint: string;
  startedAt: string; verifiedAt?: string; elapsedMs?: number;
  checks: Record<string, { verdict: Verdict; observed?: string; evidenceRefs: string[] }>;
  verdict: Verdict; rejectedReasons: string[]; traceRefs: string[];
};

type RunEvent = {
  eventId: string; runId: string; seq: number; at: string;
  type: string; source: 'infra' | 'agents' | 'orchestrator' | 'verifier';
  candidateId?: string; payload: unknown;
};
```

**Interface map:**

| Producer → Consumer | Handoff | Non-negotiable contract |
| --- | --- | --- |
| 1 → 2/3/4 | `ScenarioFixture`, candidate sandbox IDs, actual tool adapter, URLs | Branches share fingerprint, not mutable runtime state |
| 2 → 3 | risk proposal; candidate plan; action/finding events | Evidence refs for factual assertions; bounded commands |
| 3 → 1 | approved run/scope and baseline fan-out request | No fault injection before server-side approval |
| 3 → 2 | candidate IDs and tool capabilities | No unrestricted tokens or shell outside adapter |
| 1 → 4 | independent candidate targets and synthetic ground truth contract | No judge-specific winner hardcoding |
| 4 → 3 | candidate verdict, checks, trace/evidence, ranked winner | Verifier is only authority for passing recovery |
| 3 → UI | run and append-only events | UI cannot overwrite verdict or invent status |

**Suggested repository structure (proposed, adjust to existing project):**

```text
apps/
  web/                       # Owner 3: one-page dashboard
  control-plane/             # Owner 3: REST/events/approvals
sample-app/                  # Owner 1: RecoveryShop app + DB + minimal UI
infra/                       # Owner 1: Docker/AWS/Daytona provisioning
fixtures/                    # Owner 1 + Owner 4: synthetic data, approved contract, faults
packages/
  contracts/                 # Owner 3: types/schemas/events
  sandbox-adapter/           # Owner 1: Daytona lifecycle/toolbox
  agents/                    # Owner 2: inspector/planner/recovery workers
  research/                  # Owner 2: optional docs/You.com adapter
  db/                        # Owner 3: SurrealDB access and persistence
  verifier/                  # Owner 4: independent DB/API/browser assertions
  evals/                     # Owner 4: Arize tracing/metrics
scripts/                     # smoke-demo, reset-fixture, teardown
docs/                        # demo script, architecture, acceptance checklist
```

## 5. Six-hour execution clock (relative to actual kickoff)

This is a deadline-driven *integration* schedule. A local completed feature that is not integrated is not a milestone. Each owner posts its endpoint/test/result at every checkpoint. **Move all clock targets earlier if starting after the official event opening.**

| Time | Owner 1 — Infra/AWS/Daytona | Owner 2 — Agents/Mesh | Owner 3 — Backend/UI | Owner 4 — Verifier/Arize/Anchor | Mandatory gate |
| --- | --- | --- | --- | --- | --- |
| H0–0:20 | Fixture skeleton + expected broken behavior | Agent/tool input-output draft | Publish schemas, endpoints, repo structure | Write exact acceptance assertions | Contract freeze; pairwise interfaces agreed |
| 0:20–1:00 | Healthy app + seeded DB; fixture reset | Inspector reads sample manifest/logs; candidate prompts | API + stub end-to-end states; basic UI lanes | Healthy and deliberately bad fixture tests | **G1:** healthy→faulted real app, frontend renders mock run |
| 1:00–2:00 | Broken backup paths + 3 independent Daytona candidates | Real agent tool calls for 1 candidate; scoped finding events | Scope approval enforced; persistent run/event store; first real integration | DB/API checker; first Arize trace | **G2:** 1 agent attempts recovery, 1 independent real verdict |
| 2:00–3:00 | Repeatable fan-out, candidate access, optional AWS healthy host | Three parallel strategies + real shared finding | Live candidate lanes + report state | Reject false-green and stale restore; candidate ranking | **G3:** three actual branches with evidence; no UI simulation |
| 3:00–4:00 | Stabilize/isolation/cleanup, assist Anchor candidate access | Generate verified runbook; optional grounded research | Winner/approval/report and error states | Anchor browser journey + Arize side-by-side evaluations | **G4:** full autonomous happy path end to end |
| 4:00–4:45 | Optional AWS deployment/infrastructure screenshot only after G4 | Verified reuse/replay if stable | Visual polish, downloadable report | Negative tests, capture screenshots | **G5:** full system run twice, with clean reset |
| 4:45–5:15 | Freeze environment/build & teardown proof | Freeze prompts/tools | Freeze API/UI; submission documentation | Full three-minute presentation rehearsal and recording | **RC1:** no new major features |
| 5:15–5:40 | Standby/rollback | Standby/rollback | Final README/screenshots/links | Final demo run + video backup | **SUBMIT BEFORE DEADLINE** with buffer |

If less than six hours remain, preserve G1→G2→G3→G4→RC1; cut all P1 work before eliminating recovery correctness or independent verification.

### Go/no-go deadlines

- **No real fixture by H1:** stop building cloud extras; all hands get one broken app working.
- **No Daytona execution + verifier by H2:** pair Owner 1 with 2 and Owner 3 with 4; cut You.com, AWS hosting, second scenario and fancy UI.
- **No three genuine runs by H3:** keep two real independent LLM branches plus a third bounded heuristic recovery worker; label truthfully and preserve real evidence.
- **No full end-to-end run by H4:** stop building new features; fix integration only.
- **No verified demo by H4:45:** capture a real run with fallback recording; keep the actual functional product ahead of slides.

## 6. P0 versus stretch priority

| Priority | Feature | Rationale |
| --- | --- | --- |
| P0 | Healthy/faulted sample, reproducible fixture, Daytona branches | Without this there is no genuine experiment |
| P0 | Real autonomous inspection + three bounded candidate investigations | Core product and Daytona differentiation |
| P0 | Approved drill scope, independent contract checks, hard gate + fastest passing winner | Correctness, human control and credibility |
| P0 | Real SurrealDB evidence, real Arize trace, live status dashboard, runbook | Meaningful sponsor usage and visible outcome |
| P1 | Anchor browser journey against recovered candidate | Valuable application-level evidence; prioritize after API/DB verifier |
| P1 | Shared finding reused/retested across agents in the same tournament | Mesh distinction; minimally publish/subscribe in MVP |
| P1 | Comparable second run and actual measured improvement or no improvement | Makes learning claim credible |
| P1 | AWS EC2 healthy/reference sample + read-only context | Useful realism, never holds core experiment hostage |
| P2 | You.com targeted research with citations | Grounded recovery assistance, not required for P0 |
| P2 | GitHub PR for proposed config fix | Strong delivery, but only after a proven runbook exists |
| P2 | Second distinct scenario (dependency failure) and security/config hardening | Future roadmap, not a reason to miss submission |
| OUT | Unrestricted shell, live-production fault injection, real customer data, cross-tenant memory, live automated deployment | Outside safe and feasible hackathon scope |

**Integration honesty:** Do not place a sponsor logo on the demo claims page until its integration is running in the actual product. A grounded five-tool demo is better than a superficial six-tool demo. ElevenLabs is intentionally excluded.

## 7. Recovery decision rules and measurable outcomes

The verifier reports its own status from deterministic checks, not the recovery agent's final message. A candidate is ineligible if any required gate is `FAIL` or `INCOMPLETE`, if provenance is missing, if a forbidden operation occurred, or if the baseline fingerprint does not match the authorized experiment. For qualifying candidates: honor explicit user constraints, then choose the lowest measured time from run start to independent verification; show tie-breakers (less data loss, lower risk, then cost). If the fastest candidate has unacceptable loss, it never enters the ranking. If none pass, report that plainly and retain all evidence.

Capture for every run: incident/scenario ID, app version, fixture fingerprint, approved contract/version, candidate sandbox IDs, tool actions, source references, DB checksums/marker, API/login/browser check results, elapsed time, estimated costs if reliable, Arize trace, SurrealDB provenance and approval identity. Secrets are never persisted into findings or screenshots.

**Learning measurement:** Store knowledge as `OBSERVED` until independently checked. When reused, compare a matched seeded scenario against a baseline using verified recovery time, action count, invalid-plan count, safety violations and pass rate. A one-off quicker replay is an observation, not proof of universal improvement. Arize scores/evaluates traces; RestoreLab implements memory applicability, versioning, reuse and retesting.

## 8. Three-minute judged demonstration

| Time | Screen / live action | Claim supported |
| --- | --- | --- |
| 0:00–0:25 | Healthy RecoveryShop, GitLab-inspired motivation, approved recovery contract | Real impact; clear user-facing success criteria |
| 0:25–0:55 | Inspector reads real evidence, flags bad recovery assumption, requests drill approval; operator clicks approve | Autonomy with human scope gate |
| 0:55–1:35 | Controlled disaster and three isolated Daytona agents; actual logs and evidence-backed shared finding appears | Core technical differentiation; sponsor use |
| 1:35–2:15 | Independent verifier rejects a superficially healthy/failed-login attempt and a stale-data attempt; identifies passing recovery | Proof, not agent assertion |
| 2:15–2:40 | Fastest passing candidate, evidence comparison, Arize trace, SurrealDB shared finding and runbook | Traceability and product value |
| 2:40–3:00 | Human gate for suggested change; optional measured replay result if built | Safe operationalization and learning |

**Demo recording:** Record one real clean run, not slides masquerading as execution. Keep scripted narration separate from agent tool activity. If judges inject unexpected changes, show explicit `NO_VERIFIED_RECOVERY` where appropriate rather than falsely claiming correctness.

## 9. Integration workflow and merge discipline

- Use `main` as the protected integration target and short owner branches (`feat/fault-lab`, `feat/agents`, `feat/control-plane`, `feat/verifier`). For the hackathon, a designated integration owner (Owner 3) merges each vertical slice after a smoke test, not a large final-hour merge.
- **First 20 minutes:** commit shared schemas, fixture ID/contract and stub adapters. No owner edits another owner's implementation files without a quick agreement; schemas require all four to acknowledge changes.
- Each workstream has a runnable mocked test independent of external provider credentials; switch its adapter to real service as soon as available. The final demo must use actual Daytona, Arize and SurrealDB integrations to claim them.
- Exchange sample JSON outputs early. Emit stable event sequences and persist evidence outside ephemeral sandboxes. Record candidate errors rather than swallowing them.
- An approved run can be cancelled. All sandbox sessions have run IDs, lifetime caps and a teardown script. Secrets stay in server-side env/config, never API payloads or shared memory.
- Integration commands, required `.env.example` keys, deployment links and real screenshot paths should be added only when implemented; do not invent setup documentation ahead of code.

## 10. Final submission checklist

- [ ] README matches actual working capability; explicitly label planned/partial work.
- [ ] Healthy fixture, fault injection and reset are reproducible.
- [ ] Daytona candidate execution and isolation verified with real IDs.
- [ ] At least one meaningful Arize trace and SurrealDB persistence read-back demonstrated.
- [ ] A passing candidate has independently checked DB/API/browser proof; a false-positive candidate is demonstrably rejected.
- [ ] Real tool actions, evidence and timings are shown rather than pasted/static outputs.
- [ ] Human approval prevents an unapproved disaster or consequential proposal.
- [ ] Screen recording of a successful full end-to-end run stored; presentation is timed to three minutes.
- [ ] AWS and Anchor are presented accurately: implemented only if actually connected and executed.
- [ ] No leaked keys, live customer data, public dangerous demo endpoints or uncontrolled running cloud/sandbox costs.
- [ ] Submission link, code link, teammate roles, and teardown/rollback notes are complete before the published deadline.

## 11. Source/context notes

The product decisions and P0/P1 framing are from the team's approved RestoreLab README and final PRD. The six-hour execution design, RecoveryShop fixture, interfaces, repo structure, proposed role ownership and timeboxes are recommendations for implementation—not prior product decisions or claims of existing code.

- [Daytona HackSprint dates](https://daytona-hacksprint-nyc.devpost.com/details/dates) and [rules/judging](https://daytona-hacksprint-nyc.devpost.com/rules)
- [GitLab 2017 official postmortem](https://about.gitlab.com/blog/postmortem-of-database-outage-of-january-31/)
- [Daytona sandboxes](https://www.daytona.io/docs/en/sandboxes/) and [TypeScript SDK fork method](https://www.daytona.io/docs/en/typescript-sdk/sandbox/)
- [Arize AX tracing/evaluations](https://arize.com/docs/ax/observe)
- [SurrealDB Agent Memory](https://surrealdb.com/docs/agent-memory)
- [You.com Search API](https://you.com/docs/guides/search)
