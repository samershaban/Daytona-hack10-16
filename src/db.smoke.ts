// Runs the PRD demo flow end to end against a local SurrealDB: `npm run db:smoke`.
import * as db from "./db.ts";

const app = await db.createAppVersion({ name: "sample-saas", git_sha: "dev", components: { postgres: "16", pg_dump: "15" } });
const contract = await db.createContract({
  app: app.id as any, version: Date.now(), rto_seconds: 600, rpo_seconds: 300,
  checks: [{ id: "rows_consistent", kind: "sql" }, { id: "api_users", kind: "api" }, { id: "login", kind: "browser" }],
});
const scenario = await db.createScenario({ name: "pg_dump mismatch + dropped table", failure_modes: ["dump_version_mismatch", "dropped_table"], inject_script: "scenarios/pgdump.sh" });
const run = await db.startRun({ scenario: scenario.id as any, contract: contract.id as any, base_snapshot: "snap-demo" });

const [a, b, c] = await Promise.all(
  ["A", "B", "C"].map((label) => db.createCandidate({ run: run.id as any, label, strategy: `strategy ${label}`, sandbox_id: `sb-${label}` })),
);
await db.logCommand(a.id as any, { command: "pg_restore latest.dump", exit_code: 1 });
await db.logCommand(a.id as any, { command: "pg_restore --no-owner latest.dump", exit_code: 0 });
const obs = await db.addObservation({ kind: "compat", text: "pg_dump 15 output unusable for pg 16", source: a.id as any, verified: true });
await db.cite(b.id as any, obs.id as any);

for (const [cand, results, m] of [
  [a, [true, true, false], { recovery_seconds: 120, rows_lost: 0 }],  // A: login broken
  [b, [true, true, true], { recovery_seconds: 300, rows_lost: 0 }],   // B: good
  [c, [false, true, true], { recovery_seconds: 90, rows_lost: 40 }],  // C: data integrity fail
] as const) {
  await db.claimDone(cand.id as any, m);
  for (const [i, check] of ["rows_consistent", "api_users", "login"].entries())
    await db.addEvidence(cand.id as any, { check_id: check, kind: (["sql", "api", "browser"] as const)[i], passed: results[i] });
  console.log(cand.label, await db.judgeCandidate(cand.id as any));
}

const winner = await db.pickWinner(run.id as any);
console.log("winner:", winner?.label);
const r1 = await db.proposeRecipe({ scenario: scenario.id as any, source: winner.id, steps: ["restore staging copy"], rollback: ["drop restored db"] });
await db.decideRecipe(r1.id as any, { approver: "demo", decision: "approved" });
const r2 = await db.proposeRecipe({ scenario: scenario.id as any, source: winner.id, steps: ["restore staging copy v2"], rollback: ["drop restored db"] });
await db.decideRecipe(r2.id as any, { approver: "demo", decision: "approved" });
console.log("approved recipe version:", (await db.approvedRecipe(scenario.id as any)).version);
console.log("trace seqs:", (await (await db.connect()).query("SELECT VALUE seq FROM tool_trace WHERE candidate = $c ORDER BY seq", { c: a.id }).collect())[0]);
console.log("findings:", (await db.findingsFor(scenario.id as any)).map((f: any) => `${f.from_label}: ${f.text}`));
await db.close();
