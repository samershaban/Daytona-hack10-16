// End-to-end check of @restorelab/db against a running SurrealDB: `npm run smoke -w @restorelab/db`.
// Covers the BUILD_PLAN acceptance rules that live in the DB layer. Exits non-zero on any failure.
import assert from "node:assert/strict";
import * as db from "./index.ts";

const t = Date.now().toString(36);
const fp = "fixture-sha-1";
const ALL_PASS = Object.fromEntries(
  (["db_integrity", "data_freshness", "api", "login", "browser"] as const).map((k) => [k, { verdict: "PASS" as const, evidenceRefs: [`ev:${k}`] }]),
);
const rejects = async (p: Promise<unknown>, re: RegExp, what: string) => {
  await assert.rejects(p, re);
  console.log("ok  ", what);
};

const contract = await db.createContract({
  id: `c-${t}`, appVersion: "shop-1.0", approvedBy: "dev", requiredOrderIds: ["o1", "o2"], minLatestOrderMarker: "o2",
  expectedSchemaVersion: "7", maxDataLossSeconds: 300, checks: ["db_integrity", "data_freshness", "api", "login", "browser"],
});
const scenario = await db.createScenario({ id: `s-${t}`, name: "pg_dump mismatch", failureModes: ["bad_newest_backup", "stale_backup"], injectScript: "fixtures/inject.sh" });
const runId = `r-${t}`;
await db.createRun({ id: runId, scenarioId: scenario.id, contractId: contract.id, appVersion: "shop-1.0", fixtureFingerprint: fp });
await db.setRunStatus(runId, "INSPECTING");
await db.setRunStatus(runId, "AWAITING_SCOPE_APPROVAL");

await rejects(db.setRunStatus(runId, "PREPARING"), /scope not approved/, "no PREPARING without scope approval");
await rejects(db.setRunStatus(runId, "COMPLETE"), /illegal run transition/, "illegal transition refused");
assert.equal((await db.getRun(runId)).status, "AWAITING_SCOPE_APPROVAL", "refused transitions must not change status");
const a1 = await db.approveScope(runId, "operator");
const a2 = await db.approveScope(runId, "operator");
assert.equal(a1.id, a2.id); console.log("ok   scope approval is idempotent");
await db.setRunStatus(runId, "PREPARING");

const [A, B, C] = await Promise.all(["A", "B", "C"].map((label) =>
  db.createCandidate({ runId, label, strategy: `hypothesis ${label}`, sandboxId: `sb-${label}`, baselineFingerprint: fp })));
assert.equal((await db.createCandidate({ runId, label: "A", strategy: "x", sandboxId: "x", baselineFingerprint: fp })).candidateId, A.candidateId);
console.log("ok   candidate create is idempotent");
await rejects(db.createCandidate({ runId, label: "D", strategy: "x", sandboxId: "x", baselineFingerprint: fp }), /candidate limit/, "max 3 candidates");
assert.equal((await db.listCandidates(runId)).length, 3, "refused candidate must not be created");
await db.setRunStatus(runId, "RUNNING");

// Concurrent tool calls from three agents: seqs stay gap-free per candidate and per run.
await Promise.all([A, B, C].flatMap((c) => [1, 2, 3].map((i) => db.logToolAction(c.candidateId, { tool: "runAllowedCommand", command: `step ${i}` }))));
for (const c of [A, B, C]) assert.deepEqual((await db.listToolActions(c.candidateId)).map((x) => x.seq), [1, 2, 3]);
const seqs = (await db.listEvents(runId)).map((e) => e.seq);
assert.deepEqual(seqs, seqs.map((_, i) => i + 1)); console.log("ok   concurrent seqs gap-free (", seqs.length, "events )");

const f = await db.publishFinding({
  runId, authorAgentId: "agent-A", authorCandidateId: A.candidateId, appVersion: "shop-1.0", environmentFingerprint: fp,
  claim: "newest dump is pg_dump 15 format; pg 16 restore fails", evidenceRefs: ["tool_action:A#2"], scope: "run",
});
assert.equal(f.status, "OBSERVED");
assert.equal((await db.readSharedFindings(runId, "agent-A")).length, 0, "author doesn't see own finding");
assert.equal((await db.readSharedFindings(runId, "agent-B")).length, 1);
await db.citeFinding(B.candidateId, f.id);
await db.recordRetest(B.candidateId, f.id, true);
assert.deepEqual((await db.findingProvenance(f.id)).citedBy, [B.candidateId]); console.log("ok   finding shared with provenance");

await db.recordAgentClaim(A.candidateId, "Recovery complete! All systems green.");
await db.setRunStatus(runId, "VERIFYING");
await rejects(
  db.recordVerdict(A.candidateId, { verdict: "PASS", checks: { ...ALL_PASS, login: { verdict: "FAIL", evidenceRefs: ["shot:A"] } } }),
  /PASS refused/, "verifier can't PASS with a failing check",
);
// A: process up, login broken. B: good but slower. C: fast but stale data.
await db.recordVerdict(A.candidateId, { verdict: "FAIL", checks: { ...ALL_PASS, login: { verdict: "FAIL", evidenceRefs: ["shot:A"] } }, rejectedReasons: ["login 500"], elapsedMs: 90_000 });
await db.recordVerdict(B.candidateId, { verdict: "PASS", checks: ALL_PASS, elapsedMs: 240_000, dataLossSeconds: 0 });
await db.recordVerdict(C.candidateId, { verdict: "FAIL", checks: { ...ALL_PASS, data_freshness: { verdict: "FAIL", evidenceRefs: ["sql:C"] } }, rejectedReasons: ["newest order o1 < o2"], elapsedMs: 60_000, dataLossSeconds: 3600 });
assert.equal((await db.getCandidate(A.candidateId)).agentClaim?.startsWith("Recovery complete"), true);

const ranking = await db.rankCandidates(runId);
assert.equal(ranking.outcome, "COMPLETE");
assert.equal(ranking.outcome === "COMPLETE" && ranking.winner.candidateId, B.candidateId);
assert.equal((await db.getRun(runId)).status, "COMPLETE");
assert.equal((await db.getRun(runId)).winnerCandidateId, B.candidateId);
console.log("ok   A (false green) + C (stale) rejected, B wins:", ranking.ineligible.map((i) => `${i.candidateId}: ${i.reasons.join("; ")}`));

await rejects(db.proposeRecipe({ scenarioId: scenario.id, sourceCandidateId: A.candidateId, steps: ["x"], rollback: ["x"] }), /not PASS/, "no recipe from a failed candidate");
const r1 = await db.proposeRecipe({ scenarioId: scenario.id, sourceCandidateId: B.candidateId, steps: ["restore older dump", "apply schema 7 fix"], rollback: ["drop restored db"] });
await db.decideRecipe(r1.id, { runId, approver: "operator", decision: "APPROVED" });
const r2 = await db.proposeRecipe({ scenarioId: scenario.id, sourceCandidateId: B.candidateId, steps: ["v2"], rollback: ["drop restored db"] });
await db.decideRecipe(r2.id, { runId, approver: "operator", decision: "APPROVED" });
assert.equal((await db.approvedRecipe(scenario.id))?.version, 2);
console.log("ok   recipe v2 supersedes v1");

// Second run where nothing passes -> NO_VERIFIED_RECOVERY, never a fake winner.
const run2 = `r2-${t}`;
await db.createRun({ id: run2, scenarioId: scenario.id, contractId: contract.id, appVersion: "shop-1.0", fixtureFingerprint: fp });
for (const s of ["INSPECTING", "AWAITING_SCOPE_APPROVAL"] as const) await db.setRunStatus(run2, s);
await db.approveScope(run2, "operator");
for (const s of ["PREPARING", "RUNNING"] as const) await db.setRunStatus(run2, s);
const X = await db.createCandidate({ runId: run2, label: "A", strategy: "x", sandboxId: "sb", baselineFingerprint: "WRONG" });
await db.setRunStatus(run2, "VERIFYING");
await db.recordVerdict(X.candidateId, { verdict: "PASS", checks: ALL_PASS, elapsedMs: 1000 });
const r = await db.rankCandidates(run2);
assert.equal(r.outcome, "NO_VERIFIED_RECOVERY");
console.log("ok   fingerprint mismatch -> NO_VERIFIED_RECOVERY:", r.ineligible[0].reasons);

// Denied scope cancels.
const run3 = `r3-${t}`;
await db.createRun({ id: run3, scenarioId: scenario.id, contractId: contract.id, appVersion: "shop-1.0", fixtureFingerprint: fp });
await db.decide({ runId: run3, kind: "SCOPE", subject: "drill", approver: "operator", decision: "DENIED" });
assert.equal((await db.getRun(run3)).status, "CANCELLED"); console.log("ok   denied scope cancels run");

const report = await db.getReport(runId);
console.log("ok   report:", { candidates: report.candidates.length, findings: report.findings.length, approvals: report.approvals.length, recipes: report.recipes.length, events: report.events.length });
await db.close();
console.log("\nALL PASS");
