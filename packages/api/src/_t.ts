import { createApp } from "./app.ts";
import { MemoryStore } from "./store/memory.ts";
const app = createApp(new MemoryStore());
const call = async (m: string, p: string, b?: unknown, role = "orchestrator") => {
  const r = await app.request(p, { method: m, headers: { "content-type": "application/json", "x-role": role }, body: b ? JSON.stringify(b) : undefined });
  const j: any = await r.json(); console.log(m, p.split("/").slice(3).join("/"), r.status, JSON.stringify(j).slice(0, 170)); return j;
};
const run = await call("POST", "/runs", { targetUrl: "http://127.0.0.1:3000", baseFixtureId: "fx", targetVersion: "v1" });
const R = `/runs/${run.id}`;
await call("POST", `${R}/candidates`, { sandboxId: "sb1", baseFixtureId: "fx", strategy: "guard" }, "agent");
await call("POST", `${R}/approve`, { kind: "scope", decision: "approved", approver: "samer" }, "human");
await call("POST", `${R}/candidates`, { sandboxId: "sb1", baseFixtureId: "other", strategy: "guard" }, "agent");
// concurrent creation: same label twice + 3 others => 3 total
const rs = await Promise.all([
  call("POST", `${R}/candidates`, { label: "A", sandboxId: "sbA", baseFixtureId: "fx", strategy: "guard" }, "agent"),
  call("POST", `${R}/candidates`, { label: "A", sandboxId: "sbA", baseFixtureId: "fx", strategy: "guard" }, "agent"),
  call("POST", `${R}/candidates`, { label: "B", sandboxId: "sbB", baseFixtureId: "fx", strategy: "query scope" }, "agent"),
  call("POST", `${R}/candidates`, { label: "C", sandboxId: "sbC", baseFixtureId: "fx", strategy: "deny all" }, "agent"),
  call("POST", `${R}/candidates`, { label: "D", sandboxId: "sbD", baseFixtureId: "fx", strategy: "x" }, "agent"),
]);
const A = rs[0].id;
await call("GET", R);
const ev = await call("POST", `${R}/evidence`, { kind: "test", label: "checks", content: "ok", author: "verifier" }, "verifier");
const checks = [{ name: "foreign_read_denied", passed: true, evidenceId: ev.id }, { name: "own_read_ok", passed: false, evidenceId: ev.id }];
await call("POST", `${R}/verdicts`, { candidateId: A, checks, decision: "pass", verifier: "hamza" }, "agent");
await call("POST", `${R}/verdicts`, { candidateId: A, checks, decision: "pass", verifier: "hamza" }, "verifier");
await call("POST", `${R}/verdicts`, { candidateId: A, checks: [{ name: "x", passed: true, evidenceId: "ev_no" }], decision: "pass", verifier: "hamza" }, "verifier");
await call("POST", `${R}/verdicts`, { candidateId: A, checks, decision: "fail", verifier: "hamza" }, "verifier");
await call("POST", `${R}/verdicts`, { candidateId: A, checks, decision: "fail", verifier: "hamza" }, "verifier");
await call("PATCH", `${R}/candidates/${A}`, { patchRef: "abc" }, "agent");
await call("PATCH", `${R}/candidates/${A}`, { agentClaim: "fixed!" }, "agent");
await call("GET", `${R}/candidates/${A}`);
await call("GET", R);
