// End-to-end check of the demo flow and the API's rules, in-process (no port needed).
//   npm run smoke -w @restorelab/api                       (memory)
//   STORE=surreal npm run smoke -w @restorelab/api         (needs SurrealDB running)
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { JsonlStore } from "./store/jsonl.ts";
import { MemoryStore } from "./store/memory.ts";
import type { Store } from "./store/store.ts";
import { SurrealStore } from "./store/surreal.ts";

const kind = process.env.STORE ?? "memory";
const store: Store =
  kind === "surreal" ? await SurrealStore.open({ url: process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc", username: process.env.SURREAL_USER ?? "root", password: process.env.SURREAL_PASS ?? "root" })
  : kind === "jsonl" ? JsonlStore.open(join(mkdtempSync(join(tmpdir(), "restorelab-")), "api.jsonl"))
  : new MemoryStore();
const app = createApp(store);

async function call(method: string, path: string, role: string, body?: unknown, expect = method === "POST" ? 201 : 200) {
  const res = await app.request(path, {
    method, headers: { "content-type": "application/json", "x-role": role }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await res.json();
  assert.equal(res.status, expect, `${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}
const step = (s: string) => console.log(`ok  ${s}`);

const run = await call("POST", "/runs", "orchestrator", { targetUrl: "http://127.0.0.1:3000", baseFixtureId: "fixture-v1", targetVersion: "v1" });
const R = `/runs/${run.id}`;
assert.equal(run.status, "awaiting_scope_approval");
step("run created, awaiting scope approval");

await call("POST", `${R}/evidence`, "redteam", { kind: "http", label: "x", content: "x", author: "redteam" }, 409);
await call("POST", `${R}/approve`, "agent", { kind: "scope", decision: "approved", approver: "samer" }, 403);
await call("POST", `${R}/approve`, "human", { kind: "scope", decision: "approved", approver: "samer" });
await call("POST", `${R}/approve`, "human", { kind: "scope", decision: "denied", approver: "samer" }, 409);
assert.equal((await call("GET", R, "orchestrator")).status, "investigating");
step("writes blocked until a human approves scope; approval starts the run");

const ev = await call("POST", `${R}/evidence`, "redteam", {
  kind: "http", label: "alice (tenant-a) reads tenant-b record", author: "redteam",
  content: "GET /api/records/rec-b1\nAuthorization: Bearer tok-alice\n\nHTTP/1.1 200\n{\"tenantId\":\"tenant-b\"}",
});
assert.equal(ev.redactions, 1);
assert.ok(!ev.content.includes("tok-alice"));
step("red-team evidence stored with the credential redacted");

await call("POST", `${R}/findings`, "redteam", { author: "redteam", category: "OWASP-API1-2023", observation: "used Bearer tok-alice", evidenceIds: [ev.id], targetScope: "GET /api/records/:id" }, 422);
await call("POST", `${R}/findings`, "redteam", { author: "redteam", category: "OWASP-API1-2023", observation: "x", evidenceIds: ["ev_missing"], targetScope: "GET /api/records/:id" }, 422);
const finding = await call("POST", `${R}/findings`, "redteam", {
  author: "redteam", category: "OWASP-API1-2023", evidenceIds: [ev.id], targetScope: "GET /api/records/:id",
  observation: "alice (tenant-a) received tenant-b record rec-b1 with 200: no object ownership check",
});
step("finding requires stored evidence and no credentials");

const fromA = await call("POST", `${R}/messages`, "agent", { from: "agentA", to: "room", type: "finding", findingIds: [finding.id], body: "root cause: records handler never compares tenantId" });
await call("POST", `${R}/messages`, "agent", { from: "agentB", to: "agentA", type: "decision", body: "changing plan" }, 422);
const decision = await call("POST", `${R}/messages`, "agent", { from: "agentB", to: "agentA", type: "decision", findingIds: [finding.id], body: `per ${fromA.id}: scope the query by tenant instead of a deny-all middleware` });
const inbox = await call("GET", `${R}/messages?for=agentB`, "agent");
assert.deepEqual(inbox.map((m: any) => m.id), [fromA.id]);
step("agent B reads A's finding message and records a decision citing it");

const [A, A2, B, C] = await Promise.all([
  call("POST", `${R}/candidates`, "agent", { label: "A", sandboxId: "sb-a", baseFixtureId: "fixture-v1", strategy: "deny-all middleware" }),
  call("POST", `${R}/candidates`, "agent", { label: "A", sandboxId: "sb-a", baseFixtureId: "fixture-v1", strategy: "deny-all middleware" }),
  call("POST", `${R}/candidates`, "agent", { label: "B", sandboxId: "sb-b", baseFixtureId: "fixture-v1", strategy: "tenant-scoped query" }),
  call("POST", `${R}/candidates`, "agent", { label: "C", sandboxId: "sb-c", baseFixtureId: "fixture-v1", strategy: "ownership guard" }),
]);
assert.equal(A.id, A2.id);
await call("POST", `${R}/candidates`, "agent", { label: "D", sandboxId: "sb-d", baseFixtureId: "fixture-v1", strategy: "x" }, 409);
await call("POST", `${R}/candidates`, "agent", { label: "E", sandboxId: "sb-e", baseFixtureId: "other", strategy: "x" }, 422);
await call("PATCH", `${R}/candidates/${A.id}`, "agent", { status: "verification_pending", patchRef: "sha-a", agentClaim: "fixed, all good" });
assert.equal((await call("GET", R, "orchestrator")).status, "experimenting");
step("3 candidates max, idempotent retry, equivalent baseline enforced");

const checks = await call("POST", `${R}/evidence`, "verifier", { kind: "test", label: "acceptance run", content: "foreign_read_denied ok\nown_read_ok ...", author: "verifier" });
const gate = (name: string, passed: boolean | null) => ({ name, passed, evidenceId: checks.id });
await call("POST", `${R}/verdicts`, "agent", { candidateId: A.id, checks: [gate("foreign_read_denied", true)], decision: "pass", verifier: "agentA" }, 403);
await call("POST", `${R}/verdicts`, "verifier", { candidateId: A.id, checks: [gate("foreign_read_denied", true), gate("own_read_ok", false)], decision: "pass", verifier: "hamza" }, 422);
await call("POST", `${R}/verdicts`, "verifier", { candidateId: A.id, checks: [gate("foreign_read_denied", true), gate("own_read_ok", false)], decision: "fail", recoveryMs: 1500, verifier: "hamza" });
await call("POST", `${R}/verdicts`, "verifier", { candidateId: A.id, checks: [gate("foreign_read_denied", true)], decision: "pass", verifier: "hamza" }, 409);
await call("PATCH", `${R}/candidates/${A.id}`, "agent", { patchRef: "sha-a2" }, 409);
await call("POST", `${R}/complete`, "orchestrator", undefined, 409);
await call("POST", `${R}/verdicts`, "verifier", { candidateId: B.id, checks: [gate("foreign_read_denied", true), gate("own_read_ok", true)], decision: "pass", recoveryMs: 4200, verifier: "hamza" });
await call("POST", `${R}/verdicts`, "verifier", { candidateId: C.id, checks: [gate("foreign_read_denied", true), gate("own_read_ok", true)], decision: "pass", recoveryMs: 6100, verifier: "hamza" });
step("verdicts: verifier only, immutable, no pass with a failed check");

const report = await call("POST", `${R}/complete`, "orchestrator", undefined, 200);
assert.equal(report.run.status, "completed");
assert.equal(report.outcome, "verified");
assert.equal(report.recommendation.candidateId, B.id); // A was fastest but blocked legitimate users
assert.deepEqual(report.candidates.map((a: any) => [a.candidate.id, a.eligible]), [[B.id, true], [C.id, true], [A.id, false]]);
assert.ok(report.citations.some((c: any) => c.messageId === decision.id && c.findingIds.includes(finding.id)));
step("fastest *verified* candidate selected; over-restrictive fast fix rejected");

await call("POST", `${R}/approve`, "human", { kind: "remediation", decision: "approved", approver: "samer", candidateId: C.id }, 422);
await call("POST", `${R}/approve`, "human", { kind: "remediation", decision: "approved", approver: "samer", candidateId: B.id });
await call("POST", `${R}/messages`, "agent", { from: "agentA", to: "room", type: "hypothesis", body: "late" }, 409);
step("remediation approval only for the selected candidate; closed run rejects writes");

const events = await call("GET", `${R}/events`, "orchestrator");
assert.deepEqual(events.map((e: any) => e.seq), events.map((_: unknown, i: number) => i + 1));
const tail = await call("GET", `${R}/events?after=${events.length - 2}`, "orchestrator");
assert.deepEqual(tail.map((e: any) => e.type), ["run.completed", "approval.recorded"]);
step(`${events.length} events, gap-free seq, ?after= polling`);

await store.close();
console.log(`\nsmoke passed (store: ${store.name})`);
