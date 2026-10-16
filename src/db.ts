// RestoreLab SurrealDB client. Schema lives in db/schema.surql.
// Every write the team needs goes through a function here, so the data model stays in one place.
import { readFile } from "node:fs/promises";
import { RecordId, StringRecordId, Surreal } from "surrealdb";

export type Id = RecordId | StringRecordId | string;
export type CheckKind = "sql" | "api" | "browser";
export type CandidateStatus = "running" | "claimed_done" | "passed" | "rejected" | "error";

const toId = (id: Id) => (typeof id === "string" ? new StringRecordId(id) : id);

let db: Surreal | undefined;

export async function connect(): Promise<Surreal> {
  if (db) return db;
  const s = new Surreal();
  await s.connect(process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc", {
    authentication: {
      username: process.env.SURREAL_USER ?? "root",
      password: process.env.SURREAL_PASS ?? "root",
    },
  });
  // SurrealDB 3 doesn't auto-create namespaces, so the schema (which DEFINEs them) runs before use().
  await s.query(await readFile(new URL("../db/schema.surql", import.meta.url), "utf8")).collect();
  await s.use({ namespace: "restorelab", database: "main" });
  db = s;
  return s;
}

export async function close() {
  await db?.close();
  db = undefined;
}

async function one<T = Record<string, unknown>>(sql: string, vars: Record<string, unknown> = {}): Promise<T> {
  // Use the last statement's result, so multi-statement queries can LET first and RETURN at the end.
  const results = await (await connect()).query(sql, vars).collect();
  const last = results[results.length - 1];
  return (Array.isArray(last) ? last[0] : last) as T;
}

// ---------- Setup (Infra, owner #1) ----------

export const createAppVersion = (v: { name: string; git_sha: string; components?: Record<string, string> }) =>
  one("CREATE app_version CONTENT $v", { v: { components: {}, ...v } });

export const createContract = (c: {
  app: Id; version: number; checks: { id: string; kind: CheckKind; spec?: unknown }[];
  rto_seconds: number; rpo_seconds: number; approved_by?: string;
}) => one("CREATE recovery_contract CONTENT $c", { c: { ...c, app: toId(c.app) } });

export const createScenario = (s: { name: string; failure_modes: string[]; inject_script: string }) =>
  one("CREATE scenario CONTENT $s", { s });

export const startRun = (r: { scenario: Id; contract: Id; base_snapshot: string }) =>
  one("CREATE experiment_run CONTENT $r", { r: { ...r, scenario: toId(r.scenario), contract: toId(r.contract) } });

// ---------- Recovery agents (owner #2) ----------

export const createCandidate = (c: { run: Id; label: string; strategy: string; sandbox_id: string; arize_trace?: string }) =>
  one("CREATE candidate CONTENT $c", { c: { ...c, run: toId(c.run) } });

/** Append one command to the candidate's audit log. seq is assigned automatically. */
export const logCommand = (candidate: Id, t: { command: string; exit_code?: number; output?: string; duration_ms?: number }) =>
  one(
    `LET $n = (SELECT VALUE seq FROM tool_trace WHERE candidate = $cand ORDER BY seq DESC LIMIT 1)[0] ?? 0;
     RETURN (CREATE ONLY tool_trace CONTENT object::extend($t, { candidate: $cand, seq: $n + 1 }));`,
    { cand: toId(candidate), t },
  );

/** Agent reports it's finished. This is a claim only; the verifier decides passed/rejected. */
export const claimDone = (candidate: Id, metrics: { recovery_seconds?: number; rows_lost?: number; cost_usd?: number } = {}) =>
  one("UPDATE $cand MERGE { status: 'claimed_done', metrics: $m }", { cand: toId(candidate), m: metrics });

// ---------- Verifier (owners #3/#4) ----------

export const addEvidence = (candidate: Id, e: { check_id: string; kind: CheckKind; passed: boolean; detail?: string; artifact_url?: string }) =>
  one("CREATE evidence CONTENT $e", { e: { ...e, candidate: toId(candidate) } });

/**
 * Deterministic gate: passed only if every contract check has evidence and all of it passed,
 * and recovery time is within the contract's RTO. Never trusts the agent's own status.
 */
export async function judgeCandidate(candidate: Id) {
  const c = await one<any>(
    `SELECT *, run.contract.checks.id AS check_ids, run.contract.rto_seconds AS rto,
       (SELECT check_id, passed FROM evidence WHERE candidate = $parent.id) AS ev
     FROM ONLY $cand`,
    { cand: toId(candidate) },
  );
  const reasons: string[] = [];
  for (const id of c.check_ids as string[]) {
    const ev = (c.ev as { check_id: string; passed: boolean }[]).filter((e) => e.check_id === id);
    if (ev.length === 0) reasons.push(`missing evidence: ${id}`);
    else if (ev.some((e) => !e.passed)) reasons.push(`check failed: ${id}`);
  }
  if (c.metrics?.recovery_seconds == null) reasons.push("missing recovery time");
  else if (c.metrics.recovery_seconds > c.rto) reasons.push(`over RTO: ${c.metrics.recovery_seconds}s > ${c.rto}s`);
  const status: CandidateStatus = reasons.length ? "rejected" : "passed";
  await one("UPDATE $cand MERGE { status: $status, reject_reasons: $reasons }", { cand: toId(candidate), status, reasons });
  return { status, reasons };
}

/** Among passed candidates: least data lost, then fastest. Returns null if none passed. */
export async function pickWinner(run: Id) {
  const w = await one<any>(
    `SELECT * FROM candidate WHERE run = $run AND status = 'passed'
     ORDER BY metrics.rows_lost ASC, metrics.recovery_seconds ASC LIMIT 1`,
    { run: toId(run) },
  );
  await one("UPDATE $run MERGE { status: 'done', winner: $w, finished_at: time::now() }", { run: toId(run), w: w?.id ?? null });
  return w ?? null;
}

// ---------- Knowledge + runbooks (owner #3) ----------

export const addObservation = (o: { kind: "finding" | "failed_attempt" | "compat"; text: string; source: Id; verified?: boolean; tags?: string[] }) =>
  one("CREATE observation CONTENT $o", { o: { ...o, source: toId(o.source) } });

/** Candidate used someone else's finding. Provenance is kept as a graph edge. */
export const cite = (candidate: Id, observation: Id) =>
  one("RELATE $c->cites->$o", { c: toId(candidate), o: toId(observation) });

/** Findings other agents can reuse for a scenario: verified only, with where they came from. */
export const findingsFor = async (scenario: Id) => {
  const [rows] = await (await connect())
    .query<[any[]]>(
      `SELECT *, source.label AS from_label, source.run AS from_run FROM observation
       WHERE verified = true AND source.run.scenario = $s ORDER BY at DESC`,
      { s: toId(scenario) },
    )
    .collect();
  return rows;
};

export const proposeRecipe = (r: { scenario: Id; source: Id; steps: string[]; rollback: string[]; risks?: string[] }) =>
  one(
    `LET $v = (SELECT VALUE version FROM recipe WHERE scenario = $r.scenario ORDER BY version DESC LIMIT 1)[0] ?? 0;
     RETURN (CREATE ONLY recipe CONTENT object::extend($r, { version: $v + 1 }));`,
    { r: { ...r, scenario: toId(r.scenario), source: toId(r.source) } },
  );

/** Human gate. Approving supersedes any earlier approved recipe for the same scenario. */
export async function decideRecipe(recipe: Id, a: { approver: string; decision: "approved" | "rejected"; note?: string }) {
  const r = toId(recipe);
  await one("CREATE approval CONTENT $a", { a: { ...a, recipe: r } });
  if (a.decision === "rejected") return one("UPDATE $r SET status = 'rejected'", { r });
  return one(
    `LET $old = (SELECT VALUE id FROM recipe WHERE scenario = $r.scenario AND status = 'approved' AND id != $r);
     IF array::len($old) > 0 {
       UPDATE $old SET status = 'superseded';
       RELATE $r->supersedes->$old;
     };
     RETURN (UPDATE ONLY $r SET status = 'approved');`,
    { r },
  );
}

export const approvedRecipe = (scenario: Id) =>
  one("SELECT * FROM recipe WHERE scenario = $s AND status = 'approved' LIMIT 1", { s: toId(scenario) });

/** Replay: a new candidate re-ran an approved recipe (it still goes through judgeCandidate). */
export const markReused = (candidate: Id, recipe: Id) =>
  one("RELATE $c->reused->$r", { c: toId(candidate), r: toId(recipe) });
