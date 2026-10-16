# RestoreLab — 120-minute MVP execution plan

**Build objective:** Demonstrate an authorized, autonomous adversarial engineering loop on an OWNED synthetic multi-tenant SaaS fixture: discover a real behavioral weakness, prove it in a live test environment, exchange consequential agent findings, independently test two remediation candidates in isolated execution environments, verify the winning fix against security and functionality contracts, and generate an evidence-backed recommendation. Do not claim this two-hour MVP is comprehensive pentesting or disaster recovery.

**Product line:** A code-review agent predicts a vulnerability. RestoreLab tests a running system, coordinates competing investigations, and proves whether the recovery fixes the weakness *without breaking the product*.

## One scenario, not five

Hero fixture: a small Node/TypeScript service with two synthetic tenants (A and B), two test users, an admin role, and a `GET /api/records/:id` endpoint. Intentionally omit the record ownership check in the VULNERABLE fixture. The red-team agent uses synthetic identities to establish that tenant A can read a record belonging to tenant B. It records the status and response, classifies the finding as **OWASP API1:2023 Broken Object Level Authorization (BOLA)** and **WSTG-ATHZ-04 (IDOR testing)**, and cites **ASVS 5.0 V8.2.2** as the verification requirement. All test endpoints, identities, records, and credentials are owned by the team; make no requests to unrelated targets.

Recovery candidates from the SAME vulnerable baseline:

- Candidate A: controller/service authorization guard tied to record ownership and explicit admin policy.
- Candidate B: scoped data-access/tenant filter with equivalent intended semantics. If the fixture does not permit two genuinely distinct implementation approaches within time, substitute an intentionally over-restrictive guard as a *negative comparator*, and label it honestly as a baseline rather than pretending three autonomous fixes succeeded.

Hard contract: foreign-tenant read denied (403 or 404 as documented), own-tenant read 200 with expected record, authorized admin behavior preserved, record count/data unchanged, service responds, and the original test no longer reproduces. Verify against candidate execution environments, not agent text. Rank speed ONLY after all hard gates pass. Capture complete baseline/candidate/environment IDs.

This MVP proves adversarial *remediation* and operational functionality, not a full database-loss restore. Keep database deletion, corrupt backup, dependency outages, cloud IAM review and comprehensive pentesting for the next milestone.

## Four owners and non-overlapping file boundaries (confirmed team assignment)

**Ownership rule:** Mahmoud owns the **target application and red-team testing infrastructure**; Belal owns **execution infrastructure** (AWS/Daytona lifecycle) and autonomous recovery agents. Mahmoud hands Belal a reproducible container image, reset command and target contract. Belal does not edit Mahmoud's vulnerable app or red-test fixtures; Mahmoud does not modify Belal's AWS/Daytona provisioning. Samer owns the authoritative run/event/knowledge API, and Hamza owns independently computed verdicts and presentation. Agree on shared contracts by minute 10.

### Belal — Autonomous agents, AWS and Daytona execution
**Owns** `agents/`, `runtime/daytona/`, `infra/aws/`, `scripts/run-tournament*` (not `fixture/` or red-team probes).

- **0–15:** define recovery-agent roles, allowlisted tools, research/discovery inputs and two distinct remediation approaches. Receive Mahmoud's fixture contract and image/build command; align with Samer's event schema.
- **15–35:** bring up a Daytona experiment from the same vulnerable baseline and run one actual candidate via a tool call. Use existing CrewAI familiarity; do not switch agent frameworks mid-sprint.
- **35–55:** recovery Agent A consumes Mahmoud's real finding, publishes a scoped evidence-linked observation through Samer; Agent B cites the finding and demonstrably alters its plan. Evidence sharing does not collapse independent execution.
- **55–85:** run two competing candidate approaches in isolated Daytona workspaces from an equivalent base, using bounded patch/test tools. Capture sandbox IDs and tool outputs; avoid unrestricted cloud/destructive commands.
- **85–100:** consume Hamza's independent verdicts and produce an evidence-backed proposed remediation/runbook. If AWS hosting is already simple and available, deploy target/demo there; **AWS must never block Daytona + local fixture.**
- **100–120:** run a clean reset/replay, verify sandbox cleanup, and help rehearse agent communication and execution traces.

**Done:** two genuine recovery investigations, one meaningful agent-to-agent handoff, at least one real Daytona execution, equivalent candidate baselines, and visible proposed fix grounded in actual verdicts.

### Mahmoud — Red team, target application and test infrastructure
**Owns** `fixture/`, `redteam/`, `infra/fixture/`, `scripts/reset-fixture*`, synthetic identities and attack evidence (not AWS/Daytona lifecycle).

- **0–15:** build the small owned multi-tenant TypeScript/Node target with two synthetic tenants and a deliberately missing object-ownership check; publish routes, synthetic credentials, test contract and a one-command reset.
- **15–35:** package the fixture with Docker or a reproducible startup; prove both the baseline authorized success and the **unauthorized cross-tenant read** using scoped HTTP requests. Hand Belal a ready image/build command and seed/reset instructions.
- **35–55:** implement bounded red-team reconnaissance and active behavioral proof, classifying the demonstrated finding as **OWASP API1:2023 / WSTG-ATHZ-04**. Send real response artifacts, target version, reproduction steps and finding ID to Samer's API; do not treat an unverified scanner alert as a proven flaw.
- **55–85:** make fixture resets deterministic; provide two safe, distinct candidate starting points or ensure both can fork from the same vulnerable version. Supply configuration/log observations that recovery agents may research and validate.
- **85–100:** support the failure demonstration; ensure the original attack repro is rerunnable on demand and that only owned URLs, identities and synthetic data are tested.
- **100–120:** reset fixture twice and verify demo targets are clean. If time remains, run a *supporting* Semgrep/Trivy scan; do not add another OWASP class before the full loop works.

**Done:** reproducible owned vulnerable target + actual behavioral red-team finding + stable reset/image handoff. No testing of unrelated public targets.

### Samer — SurrealDB backend and collective intelligence
**Owns** `api/`, `shared/contracts/`, `knowledge/`, durable run state, approvals and agent message/event transport.

- **0–15:** publish typed API/event schema and return in-memory fixtures immediately so Belal, Mahmoud and Hamza can implement in parallel.
- **15–35:** implement `POST /runs`, `GET /runs/:id`, `GET /runs/:id/events`, `POST /runs/:id/approve`, `POST /runs/:id/findings`, `POST /runs/:id/messages`, `POST /runs/:id/candidates`, `POST /runs/:id/verdicts`; simple polling is acceptable.
- **35–65:** connect SurrealDB: persist provenance-linked findings, messages, evidence pointers, target/candidate IDs, approval history and versioned knowledge. Findings must include scope and sources; credentials must never enter shared messages. If setup stalls beyond ten minutes, use durable JSONL as a fallback while continuing SurrealDB integration.
- **65–95:** support **consequential** agent communication: A publishes evidence; B subscribes/queries and cites A's finding in a changed decision. Record planned/executing/verification-pending/checkpoint states; do not claim exactly-once side effects.
- **95–120:** enforce scope/approval policy at API boundary; assemble the final report from authoritative evidence and Hamza's verdicts, not agent self-reports.

**Done:** one real source of truth; visibly traceable inter-agent collaboration; data persists where implemented; no fabricated success or shared secrets.

### Hamza — Independent verification, Arize and UI/demo
**Owns** `verifier/`, `dashboard/`, `tests/acceptance/`, `demo/` and Arize/Anchor presentation integration.

- **0–15:** write the acceptance contract independently of agent outputs and a one-screen mock dashboard consuming Samer's schema.
- **15–40:** implement deterministic tests against target URL and synthetic identities: foreign-tenant read denied, own-tenant read preserved, admin policy maintained, record counts/data unchanged, service healthy.
- **40–65:** connect actual Daytona candidate URLs/artifacts to verifier; return PASS/FAIL/UNKNOWN with evidence. Ensure an over-restrictive repair fails legitimate functionality even if the agent reports it as fixed.
- **65–90:** replace mock events with Samer's real events: visible shared findings/agent room, two candidate timelines, independent gate matrix, selected plan and human approval control. Add Arize traces/evaluations if credentials are ready; traces do not replace deterministic tests.
- **90–105:** add one Anchor browser login/record journey if integration is ready. If not, retain verified API checks and accurately label Anchor as planned. Take responsibility for one clean end-to-end operator path.
- **105–120:** run two full rehearsals, record backup demonstration, ensure citations/claims and sponsor integrations match what truly works, and verify submission readiness.

**Done:** only independent test evidence can mark verified recovery; the dashboard reflects live tools/events; one bad fix is rejected; complete judge narrative is reproducible.

### Hand-off matrix

| Producer | Consumer | Interface / artifact | Must be ready |
|---|---|---|---|
| Mahmoud | Belal, Hamza | Target URL, Docker image/build, synthetic identity fixture, reset command, baseline ID | Minute 15–25 |
| Samer | Everyone | Shared TypeScript contracts, endpoint stubs, event names, run ID | Minute 10–15 |
| Mahmoud | Belal, Samer | Reproduced security finding with HTTP evidence and OWASP mapping | Minute 35–45 |
| Belal | Samer, Hamza | Candidate IDs, Daytona sandbox IDs, strategy, target URL and tool evidence | Minute 55–65 |
| Hamza | Samer, Belal | Immutable candidate verdicts, failed gates and evidence IDs | Minute 65–85 |
| Samer | Hamza | Live event feed, verified report/approval state | Minute 85–100 |

## Shared contracts — copy into code before parallel work

```ts
type RunStatus = 'created'|'awaiting_scope_approval'|'investigating'|'experimenting'|'verifying'|'completed'|'failed'|'unknown';
type Finding = { id:string; runId:string; author:string; category:'OWASP-API1-2023'|'OTHER'; observation:string; evidenceIds:string[]; targetScope:string; createdAt:string };
type AgentMessage = { id:string; runId:string; from:string; to:string|'room'; type:'finding'|'hypothesis'|'request'|'response'|'decision'; findingIds:string[]; body:string; createdAt:string };
type Candidate = { id:string; runId:string; sandboxId:string; baseFixtureId:string; strategy:string; status:string; patchRef?:string };
type Verdict = { candidateId:string; checks:{name:string; passed:boolean|null; evidenceId:string}[]; decision:'pass'|'fail'|'unknown'; recoveryMs?:number };
```

**Control flow:** approved scope -> agent reconnaissance and owned-target red test -> evidence posted -> recovery plans, sharing findings -> Daytona candidate execution -> **separate** verifier -> backend filters hard failures -> fastest valid candidate -> recommendation/approval -> versioned evidence. Agent messages must reference findings and affect subsequent agent action. Candidate workspaces must originate from equivalent fixtures.

## Minute-by-minute integration gates (team clock)

| Time | Mandatory checkpoint | Kill / fallback rule |
|---|---|---|
| 0–10 | Agree fixture, OWASP scope, contracts, owners, env vars. Everyone writes in own directory. | No architecture redesign after minute 10. |
| 10–25 | Mahmoud demonstrates bad unauthorized access; Hamza’s verifier contract fails baseline; dashboard shows mock run. | If target not ready: simplify to in-memory records and HTTP service. |
| 25–45 | Mahmoud’s real red-team evidence enters Samer’s backend and is visible in Hamza’s UI. | Drop extra scanner installs and extra vulnerability classes. |
| 45–65 | Belal’s recovery Agent A publishes/cites Mahmoud’s finding; B changes course; first Daytona candidate starts. | If Daytona setup stalls, run local clone while continuing one small sponsor sandbox integration. |
| 65–85 | Belal runs two candidate attempts; Hamza returns independent gate verdicts. | Cut third agent and research/search adapter. |
| 85–100 | Samer assembles evidence-backed report; Hamza shows Arize and Samer shows SurrealDB if stable. | Use JSONL fallback for ledger; traces never determine app correctness. |
| 100–110 | Two cold-reset rehearsals. | Stop adding new integrations. |
| 110–120 | Backup recording, verify repository/attribution, test submission links. | Demo known-good run, clearly declare missing pieces. |

## Suggested three-minute judge narrative

0:00–0:25: "Code scanning can warn you. RestoreLab proves whether the weakness actually exists in a running, owned application." Show two synthetic tenants and approved scope.

0:25–0:55: Red-team agent discovers cross-tenant record exposure and proves it using two synthetic test users; show OWASP API1/WSTG source mapping.

0:55–1:30: Agent A publishes root-cause evidence. B consumes Finding #ID and changes its plan. Two recovery agents execute in isolated Daytona candidates. Show actual communication tied to tool steps.

1:30–2:15: One superficially protective fix blocks legitimate users and is rejected; another closes cross-tenant access while preserving allowed access. Verifier decides, not the agent.

2:15–2:45: Show evidence report and proposed patch; human approval required to propagate consequential changes. SurrealDB knowledge and Arize traces where genuinely integrated.

2:45–3:00: Reset and replay test (or show recorded repeat). "It doesn't just find a bug; it learns and proves how to recover without breaking users."

## Explicit cuts and truthful claims

**P0:** owned behavioral red-test; at least one real Daytona experiment; two recovery hypotheses (one verified candidate minimum); structured consequential inter-agent message; independent security + functional tests; evidence report; one-screen UI; approval gate for non-sandbox change.

**P1 only after P0:** second Daytona branch; SurrealDB versioned knowledge; Arize comparison/evals; Anchor browser read-back; checkpoint/resume an interrupted agent; Semgrep/Trivy supporting scan; You.com evidence retrieval; third agent/third candidate.

**Not in two hours:** arbitrary repo/cloud intake, real pentest of third-party sites, full OWASP scan coverage, actual production modifications, real backup/restore simulation, PR automation, AWS account-wide recon, unrestricted lateral movement, general purpose Mesh replica, guaranteed recovery-time improvement. If not implemented, label as planned.

## Reuse research — projects with >1,000 stars (approximate, verify version/license before copying)

| Public project | Stars observed | License | Borrow/use in MVP | Decision |
|---|---:|---|---|---|
| [CrewAI](https://github.com/crewAIInc/crewAI) | ~59k | MIT | Role-based cooperating red/recovery agents + flows | Use if team knows it; do not reinvent orchestration. |
| [LangGraph](https://github.com/langchain-ai/langgraph) | ~43k | MIT | Durable graph/checkpoint/human oversight patterns | **Alternative** to CrewAI, not both in 2 hours. |
| [OWASP Juice Shop](https://github.com/juice-shop/juice-shop) | ~14k | MIT | Existing deliberately vulnerable demo app and testing ideas | Good later benchmark; too broad for a fast custom remediation demo. |
| [OWASP crAPI](https://github.com/OWASP/crAPI) | ~1.6k | Apache-2.0 | API-security training environment with Docker Compose and API specification | Good next benchmark, but multi-service setup is heavier than owned fixture. |
| [OWASP NodeGoat](https://github.com/OWASP/NodeGoat) | ~2.1k | Apache-2.0 | Node security training reference | Useful patterns, but legacy stack distracts from two-hour core. |
| [Trivy](https://github.com/aquasecurity/trivy) | ~38k | Apache-2.0 | Dependency, filesystem, IaC and secret findings via CLI/JSON | Optional evidence enhancer; not proof of cross-tenant authorization defect. |
| [Semgrep](https://github.com/semgrep/semgrep) | ~17k | LGPL-2.1 | Fast static-pattern findings / custom rule, subject to edition limits | Optional; do not claim scanner alone proves exploitability. |
| [ZAP](https://github.com/zaproxy/zaproxy) | ~16k | Apache-2.0 | Automated web scanner / API for scoped DAST | Better stretch; startup/scan overhead and auth workflows may hurt 2h. |

**Reuse policy:** invoke packages or run existing official containers; copy only appropriately licensed, attributed components. Pin versions/commits when selected. Star threshold is for evaluated external repos; new team's custom fixture and the unverified Mesh project are separate.

### Mesh evaluation

I could verify public descriptions of Rho LOCK IN's Mesh project (Tarush Garg, Dev Gadde, Abhiviraj Goel): a shared agent room for live context/messages/files and permissioned remote-tool use, with credentials retained on the tool owner's machine. **I could not verify a public canonical GitHub repository or license**, so do NOT claim to clone or reuse its code. Reproduce only the architecture concepts needed here: scoped, evidence-linked communication; visible changes to agent behavior; explicit tool access approval; no credential exchange. Do not implement remote laptop tool borrowing in this MVP.

## OWASP framework mapping, exact MVP scope

- **API1:2023 BOLA:** ordinary user can access another synthetic tenant's object using an object identifier; test ownership enforcement before and after fix. [Official API1](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/).
- **WSTG-ATHZ-04 IDOR:** authorization test design for object references. [Official WSTG](https://owasp.github.io/www-project-web-security-testing-guide/stable/4-Web_Application_Security_Testing/05-Authorization_Testing/04-Testing_for_Insecure_Direct_Object_References).
- **ASVS 5.0 V8.2.2:** explicit permission to specific data items. [Official ASVS 5.0 JSON](https://github.com/OWASP/ASVS/blob/master/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.json).
- **API5:2023 BFLA:** a *separate P1 scenario* where non-admin reaches an admin function. [Official API5](https://api-security.owasp.org/editions/2023/en/0xa5-broken-function-level-authorization/).
- **API8:2023 Security Misconfiguration:** a *separate P1 scenario* involving misconfigured test infrastructure, not something proven by the API1 case. [OWASP list](https://api-security.owasp.org/editions/2023/en/0x11-t10/).

Keep all active probes inside explicitly allowed owned application URLs using synthetic identities/data, tight limits and no broad network discovery. This is a controlled adversarial functional test, not a blanket pentest certification.

## Ready-to-run acceptance checklist

- [ ] A healthy legitimate tenant-user journey works before fault/testing.
- [ ] Red agent produces reproducible foreign-tenant exposure evidence against the vulnerable fixture.
- [ ] Evidence has OWASP reference, scope, target version and operation ID.
- [ ] A recovery agent acts on another agent's referenced finding, with visible provenance.
- [ ] At least one real Daytona experiment, with equivalent base fixture for comparisons.
- [ ] Verifier rejects false success; verified winner passes unauthorized AND legitimate read tests plus data integrity.
- [ ] No agent can declare its own recovery as passing; approval stops out-of-scope changes.
- [ ] Runbook/report includes commands/patch refs, tests, timing, residual risk and evidence.
- [ ] Two cold resets complete without hand-edited data or fake statuses.
- [ ] Claims and sponsor integrations reflect only what actually shipped.

