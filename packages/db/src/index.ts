// @restorelab/db: SurrealDB persistence for runs, events, candidates, findings, approvals, recipes.
// Every function takes and returns plain string ids (the record key, e.g. "r1", not "run:r1").
// Rules from BUILD_PLAN.md enforced here: server-side scope approval before PREPARING, verifier-only
// verdicts, max 3 candidates, append-only events, fastest-verified ranking, NO_VERIFIED_RECOVERY.
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { DateTime, RecordId, Surreal } from "surrealdb";
import type {
  Approval, ApprovalKind, Candidate, CandidateResult, Finding, Ranking, RecoveryContract,
  RecoveryRecipe, Run, RunEvent, RunStatus, ToolAction, Verdict,
} from "./types.ts";

export type * from "./types.ts";

export const MAX_CANDIDATES = 3;

// ---------- connection ----------

let db: Promise<Surreal> | undefined;

export function connect(): Promise<Surreal> {
  db ??= (async () => {
    const s = new Surreal();
    await s.connect(process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc", {
      authentication: {
        username: process.env.SURREAL_USER ?? "root",
        password: process.env.SURREAL_PASS ?? "root",
      },
    });
    // SurrealDB 3 doesn't auto-create namespaces, so the schema (which DEFINEs them) runs before use().
    await s.query(await readFile(new URL("../schema.surql", import.meta.url), "utf8")).collect();
    await s.use({ namespace: "restorelab", database: "main" });
    return s;
  })();
  return db;
}

export async function close() {
  const s = await db;
  db = undefined;
  await s?.close();
}

// ---------- helpers ----------

const rid = (table: string, key: string) => new RecordId(table, key);

/** RecordId -> its key string, DateTime -> ISO string, recursively. */
function clean(v: any): any {
  if (v instanceof RecordId) return String(v.id);
  if (v instanceof DateTime) return v.toISOString();
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === "object" && v.constructor === Object)
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]));
  return v;
}

/** Runs a query and returns the last statement's result (first row if it's an array). Retries write conflicts. */
async function one<T>(sql: string, vars: Record<string, unknown> = {}): Promise<T> {
  const results = await (await connect()).query(sql, vars).retry().collect();
  const last = results[results.length - 1];
  return clean(Array.isArray(last) ? last[0] : last) as T;
}

async function many<T>(sql: string, vars: Record<string, unknown> = {}): Promise<T[]> {
  const results = await (await connect()).query(sql, vars).retry().collect();
  return clean(results[results.length - 1] ?? []) as T[];
}

const asCandidate = ({ id, ...rest }: any): Candidate => ({ ...rest, candidateId: id });

// ---------- setup (Owner 1 / orchestrator) ----------

export const createContract = ({ id = randomUUID(), ...c }: Omit<RecoveryContract, "id"> & { id?: string }) =>
  one<RecoveryContract>("CREATE ONLY $id CONTENT $c", { id: rid("recovery_contract", id), c });

export const getContract = (id: string) =>
  one<RecoveryContract>("SELECT * FROM ONLY $id", { id: rid("recovery_contract", id) });

export const createScenario = (s: { id?: string; name: string; failureModes: string[]; injectScript: string }) => {
  const { id = randomUUID(), ...rest } = s;
  return one<{ id: string }>("CREATE ONLY $id CONTENT $s", { id: rid("scenario", id), s: rest });
};

// ---------- runs + events ----------

const NEXT: Record<RunStatus, RunStatus[]> = {
  CREATED: ["INSPECTING"],
  INSPECTING: ["AWAITING_SCOPE_APPROVAL"],
  AWAITING_SCOPE_APPROVAL: ["PREPARING"],
  PREPARING: ["RUNNING"],
  RUNNING: ["VERIFYING"],
  VERIFYING: ["COMPLETE", "NO_VERIFIED_RECOVERY"],
  COMPLETE: [], NO_VERIFIED_RECOVERY: [], FAILED: [], CANCELLED: [],
};
const TERMINAL: RunStatus[] = ["COMPLETE", "NO_VERIFIED_RECOVERY", "FAILED", "CANCELLED"];

export async function createRun(r: { id?: string; scenarioId: string; contractId: string; appVersion: string; fixtureFingerprint: string }) {
  const { id = randomUUID(), scenarioId, contractId, ...rest } = r;
  const run = await one<Run>("CREATE ONLY $id CONTENT $r", {
    id: rid("run", id),
    r: { ...rest, scenarioId: rid("scenario", scenarioId), contractId: rid("recovery_contract", contractId) },
  });
  await appendEvent({ runId: id, type: "run.created", source: "orchestrator", payload: { status: run.status } });
  return run;
}

export const getRun = (id: string) => one<Run>("SELECT * OMIT eventSeq FROM ONLY $id", { id: rid("run", id) });

/**
 * Moves a run to `to`. Throws on an illegal transition. FAILED/CANCELLED are allowed from any
 * non-terminal state. PREPARING requires an APPROVED scope approval in the DB (not a UI flag).
 * COMPLETE/NO_VERIFIED_RECOVERY should come from rankCandidates(), not called directly.
 */
export async function setRunStatus(runId: string, to: RunStatus, opts: { winnerCandidateId?: string; reason?: string } = {}) {
  const from = TERMINAL.includes(to) && to !== "COMPLETE" && to !== "NO_VERIFIED_RECOVERY"
    ? (Object.keys(NEXT) as RunStatus[]).filter((s) => !TERMINAL.includes(s))
    : (Object.keys(NEXT) as RunStatus[]).filter((s) => NEXT[s].includes(to));
  const run = await one<Run | undefined>(
    // One IF/ELSE expression: a THROW in an earlier statement would not stop later ones.
    `IF $to = 'PREPARING' AND array::len(SELECT id FROM approval WHERE runId = $run AND kind = 'SCOPE' AND decision = 'APPROVED') = 0 {
       THROW 'scope not approved: run cannot enter PREPARING'
     } ELSE {
       UPDATE ONLY $run SET status = $to, winnerCandidateId = $winner WHERE status IN $from
     }`,
    { run: rid("run", runId), to, from, winner: opts.winnerCandidateId ? rid("candidate", opts.winnerCandidateId) : undefined },
  );
  if (!run) {
    const cur = await getRun(runId);
    throw new Error(`illegal run transition ${cur?.status ?? "missing run"} -> ${to}`);
  }
  await appendEvent({ runId, type: "run.status", source: "orchestrator", payload: { status: to, ...opts } });
  return run;
}

/** Append-only. seq is per-run, gap-free, assigned atomically. */
export async function appendEvent(e: Omit<RunEvent, "eventId" | "seq" | "at">): Promise<RunEvent> {
  const ev = await one<any>(
    `BEGIN;
     LET $seq = (UPDATE ONLY $run SET eventSeq += 1 RETURN VALUE eventSeq);
     LET $e = (CREATE ONLY run_event CONTENT { runId: $run, seq: $seq, type: $type, source: $source, candidateId: $cand, payload: $payload });
     COMMIT;
     RETURN $e;`,
    {
      run: rid("run", e.runId), type: e.type, source: e.source, payload: e.payload ?? null,
      cand: e.candidateId ? rid("candidate", e.candidateId) : undefined,
    },
  );
  const { id, ...rest } = ev;
  return { eventId: id, ...rest };
}

/** For polling / SSE: events after `afterSeq`, in order. */
export const listEvents = async (runId: string, afterSeq = 0): Promise<RunEvent[]> =>
  (await many<any>("SELECT * FROM run_event WHERE runId = $run AND seq > $after ORDER BY seq", { run: rid("run", runId), after: afterSeq }))
    .map(({ id, ...rest }) => ({ eventId: id, ...rest }));

// ---------- approvals (human gate) ----------

/**
 * Idempotent: a retry with the same decision returns the existing approval; a conflicting
 * second decision throws. Denying SCOPE cancels the run.
 */
export async function decide(a: { runId: string; kind: ApprovalKind; subject: string; approver: string; decision: "APPROVED" | "DENIED"; note?: string }): Promise<Approval> {
  const id = rid("approval", `${a.runId}:${a.kind}:${a.subject}`);
  const existing = await one<Approval | undefined>("SELECT * FROM ONLY $id", { id });
  if (existing) {
    if (existing.decision !== a.decision) throw new Error(`${a.kind} ${a.subject} already ${existing.decision}`);
    return existing;
  }
  const approval = await one<Approval>("CREATE ONLY $id CONTENT $a", { id, a: { ...a, runId: rid("run", a.runId) } });
  await appendEvent({ runId: a.runId, type: "approval", source: "orchestrator", payload: approval });
  if (a.kind === "SCOPE" && a.decision === "DENIED") await setRunStatus(a.runId, "CANCELLED", { reason: "scope denied" });
  return approval;
}

export const approveScope = (runId: string, approver: string, note?: string) =>
  decide({ runId, kind: "SCOPE", subject: "drill", approver, decision: "APPROVED", note });

// ---------- candidates (Owner 1 creates, Owner 2 acts, Owner 4 judges) ----------

/** Idempotent per (runId, label). Throws past MAX_CANDIDATES. Candidate id = `${runId}_${label}`. */
export async function createCandidate(c: { runId: string; label: string; strategy: string; sandboxId: string; baselineFingerprint: string }) {
  const id = rid("candidate", `${c.runId}_${c.label}`);
  const row = await one<any>(
    `LET $existing = SELECT * FROM ONLY $id;
     IF $existing { $existing }
     ELSE IF count(SELECT id FROM candidate WHERE runId = $run) >= $max { THROW 'candidate limit reached for run' }
     ELSE { CREATE ONLY $id CONTENT $c }`,
    { id, run: rid("run", c.runId), max: MAX_CANDIDATES, c: { ...c, runId: rid("run", c.runId) } },
  );
  await appendEvent({ runId: c.runId, candidateId: row.id, type: "candidate.created", source: "infra", payload: { label: c.label, sandboxId: c.sandboxId } });
  return asCandidate(row);
}

export const getCandidate = async (id: string) =>
  asCandidate(await one<any>("SELECT * OMIT actionSeq FROM ONLY $id", { id: rid("candidate", id) }));

export const listCandidates = async (runId: string) =>
  (await many<any>("SELECT * OMIT actionSeq FROM candidate WHERE runId = $run ORDER BY label", { run: rid("run", runId) })).map(asCandidate);

/** Audit log entry for every tool call, including refused ones (refused => forbiddenOpAttempted). */
export async function logToolAction(candidateId: string, t: { tool: string; command: string; exitCode?: number; output?: string; durationMs?: number; refused?: boolean }) {
  const action = await one<ToolAction>(
    `BEGIN;
     LET $c = (UPDATE ONLY $cand SET actionSeq += 1, forbiddenOpAttempted = forbiddenOpAttempted OR $refused);
     LET $a = (CREATE ONLY tool_action CONTENT object::extend($t, { candidateId: $cand, seq: $c.actionSeq }));
     COMMIT;
     RETURN $a;`,
    { cand: rid("candidate", candidateId), refused: t.refused ?? false, t: { ...t, refused: t.refused ?? false } },
  );
  const { runId } = await getCandidate(candidateId);
  await appendEvent({ runId, candidateId, type: "tool.action", source: "agents", payload: action });
  return action;
}

export const listToolActions = (candidateId: string) =>
  many<ToolAction>("SELECT * FROM tool_action WHERE candidateId = $c ORDER BY seq", { c: rid("candidate", candidateId) });

/** Agent's own "I'm done" message. Display only: never changes verdict or ranking. */
export async function recordAgentClaim(candidateId: string, claim: string) {
  await one("UPDATE ONLY $c SET agentClaim = $claim", { c: rid("candidate", candidateId), claim });
  const { runId } = await getCandidate(candidateId);
  await appendEvent({ runId, candidateId, type: "agent.claim", source: "agents", payload: { claim } });
}

/**
 * Verifier only (Owner 4). Stores the verdict and per-check results. Refuses a PASS that
 * doesn't have PASS for every contract check. elapsedMs defaults to verifiedAt - startedAt.
 */
export async function recordVerdict(candidateId: string, v: {
  checks: CandidateResult["checks"]; verdict: Verdict; rejectedReasons?: string[]; traceRefs?: string[];
  verifiedAt?: string; elapsedMs?: number; dataLossSeconds?: number; riskScore?: number; costUsd?: number;
}) {
  const cand = await getCandidate(candidateId);
  const run = await getRun(cand.runId);
  const contract = await getContract(run.contractId);
  if (v.verdict === "PASS") {
    const bad = contract.checks.filter((k) => v.checks[k]?.verdict !== "PASS");
    if (bad.length) throw new Error(`PASS refused: contract checks not PASS: ${bad.join(", ")}`);
  }
  const verifiedAt = v.verifiedAt ?? new Date().toISOString();
  const elapsedMs = v.elapsedMs ?? Date.parse(verifiedAt) - Date.parse(cand.startedAt);
  const row = await one<any>("UPDATE ONLY $c MERGE $v", {
    c: rid("candidate", candidateId),
    v: { ...v, rejectedReasons: v.rejectedReasons ?? [], traceRefs: v.traceRefs ?? [], verifiedAt: new Date(verifiedAt), elapsedMs },
  });
  await appendEvent({ runId: cand.runId, candidateId, type: "candidate.verdict", source: "verifier", payload: { verdict: v.verdict, rejectedReasons: v.rejectedReasons ?? [], elapsedMs } });
  return asCandidate(row);
}

/**
 * §7 decision rule. Eligible = verdict PASS, every contract check PASS, matching baseline
 * fingerprint, no forbidden op, data loss within contract. Rank by elapsedMs, then data loss,
 * risk, cost. Moves the run (must be VERIFYING) to COMPLETE or NO_VERIFIED_RECOVERY.
 */
export async function rankCandidates(runId: string): Promise<Ranking> {
  const run = await getRun(runId);
  const contract = await getContract(run.contractId);
  const ineligible: { candidateId: string; reasons: string[] }[] = [];
  const ranked: Candidate[] = [];
  for (const c of await listCandidates(runId)) {
    const reasons: string[] = [];
    if (c.verdict !== "PASS") reasons.push(`verdict ${c.verdict}`, ...c.rejectedReasons);
    for (const k of contract.checks) if (c.checks[k]?.verdict !== "PASS") reasons.push(`check ${k}: ${c.checks[k]?.verdict ?? "MISSING"}`);
    if (c.baselineFingerprint !== run.fixtureFingerprint) reasons.push("baseline fingerprint mismatch");
    if (c.forbiddenOpAttempted) reasons.push("forbidden operation attempted");
    if (c.elapsedMs == null) reasons.push("no verified elapsed time");
    if (c.dataLossSeconds != null && c.dataLossSeconds > contract.maxDataLossSeconds)
      reasons.push(`data loss ${c.dataLossSeconds}s > ${contract.maxDataLossSeconds}s`);
    if (reasons.length) ineligible.push({ candidateId: c.candidateId, reasons: [...new Set(reasons)] });
    else ranked.push(c);
  }
  const key = (c: Candidate) => [c.elapsedMs!, c.dataLossSeconds ?? 0, c.riskScore ?? 0, c.costUsd ?? 0];
  ranked.sort((a, b) => {
    const ka = key(a), kb = key(b);
    return ka.map((x, i) => x - kb[i]).find((d) => d !== 0) ?? 0;
  });
  if (!ranked.length) {
    await setRunStatus(runId, "NO_VERIFIED_RECOVERY");
    return { outcome: "NO_VERIFIED_RECOVERY", ranked: [], ineligible };
  }
  await setRunStatus(runId, "COMPLETE", { winnerCandidateId: ranked[0].candidateId });
  return { outcome: "COMPLETE", winner: ranked[0], ranked, ineligible };
}

// ---------- findings (Mesh sharing, Owner 2) ----------

/** Publish a factual finding. Must carry evidenceRefs. Starts OBSERVED. Never put secrets in `claim`. */
export async function publishFinding(f: Omit<Finding, "id" | "observedAt" | "status"> & { authorCandidateId?: string }) {
  const finding = await one<Finding>("CREATE ONLY finding CONTENT $f", {
    f: { ...f, runId: rid("run", f.runId), authorCandidateId: f.authorCandidateId ? rid("candidate", f.authorCandidateId) : undefined },
  });
  await appendEvent({ runId: f.runId, candidateId: f.authorCandidateId, type: "finding.published", source: "agents", payload: finding });
  return finding;
}

/**
 * Findings another agent may read: same run (scope 'run') or same appVersion (scope 'app_version'),
 * not REJECTED, not authored by the reader. Reader must still retest before relying on one.
 */
export const readSharedFindings = (runId: string, readerAgentId: string) =>
  many<Finding & { authorCandidateId?: string }>(
    `LET $r = (SELECT * FROM ONLY $run);
     SELECT * FROM finding WHERE status != 'REJECTED' AND authorAgentId != $reader
       AND ((scope = 'run' AND runId = $run) OR (scope = 'app_version' AND appVersion = $r.appVersion))
       ORDER BY observedAt;`,
    { run: rid("run", runId), reader: readerAgentId },
  );

/** Candidate used a finding (provenance edge). */
export const citeFinding = (candidateId: string, findingId: string) =>
  one("RELATE $c->cites->$f", { c: rid("candidate", candidateId), f: rid("finding", findingId) });

/** Candidate re-checked a finding in its own sandbox. Records the outcome; doesn't change status. */
export const recordRetest = (candidateId: string, findingId: string, held: boolean) =>
  one("RELATE $c->retested->$f SET held = $held", { c: rid("candidate", candidateId), f: rid("finding", findingId), held });

/** Verifier marks a finding VERIFIED or REJECTED after an independent check. */
export const setFindingStatus = (findingId: string, status: Finding["status"]) =>
  one<Finding>("UPDATE ONLY $f SET status = $status", { f: rid("finding", findingId), status });

/** Who cited / retested a finding. */
export const findingProvenance = (findingId: string) =>
  one<{ citedBy: string[]; retests: { candidate: string; held: boolean }[] }>(
    "SELECT <-cites<-candidate AS citedBy, (SELECT in AS candidate, held FROM <-retested) AS retests FROM ONLY $f",
    { f: rid("finding", findingId) },
  );

// ---------- recipes (runbooks) ----------

/** Only from a candidate with a PASS verdict. Version auto-increments per scenario. */
export async function proposeRecipe(r: { scenarioId: string; sourceCandidateId: string; steps: string[]; rollback: string[]; risks?: string[]; evidenceRefs?: string[] }) {
  const cand = await getCandidate(r.sourceCandidateId);
  if (cand.verdict !== "PASS") throw new Error(`recipe source ${r.sourceCandidateId} is ${cand.verdict}, not PASS`);
  const run = await getRun(cand.runId);
  const recipe = await one<RecoveryRecipe>(
    `LET $v = (SELECT VALUE version FROM recipe WHERE scenarioId = $s ORDER BY version DESC LIMIT 1)[0] ?? 0;
     RETURN CREATE ONLY recipe CONTENT object::extend($r, { version: $v + 1 });`,
    {
      s: rid("scenario", r.scenarioId),
      r: { ...r, appVersion: run.appVersion, scenarioId: rid("scenario", r.scenarioId), sourceCandidateId: rid("candidate", r.sourceCandidateId) },
    },
  );
  await appendEvent({ runId: cand.runId, type: "recipe.proposed", source: "orchestrator", payload: recipe });
  return recipe;
}

/** Human gate for a recipe. Approving supersedes the previously approved recipe for the scenario. */
export async function decideRecipe(recipeId: string, a: { runId: string; approver: string; decision: "APPROVED" | "DENIED"; note?: string }) {
  await decide({ ...a, kind: "RECIPE", subject: recipeId });
  const r = rid("recipe", recipeId);
  if (a.decision === "DENIED") return one<RecoveryRecipe>("UPDATE ONLY $r SET status = 'REJECTED'", { r });
  return one<RecoveryRecipe>(
    `LET $old = (SELECT VALUE id FROM recipe WHERE scenarioId = $r.scenarioId AND status = 'APPROVED' AND id != $r);
     IF array::len($old) > 0 { UPDATE $old SET status = 'SUPERSEDED'; RELATE $r->supersedes->$old; };
     RETURN UPDATE ONLY $r SET status = 'APPROVED';`,
    { r },
  );
}

export const approvedRecipe = (scenarioId: string) =>
  one<RecoveryRecipe | undefined>("SELECT * FROM recipe WHERE scenarioId = $s AND status = 'APPROVED' LIMIT 1", { s: rid("scenario", scenarioId) });

/** Replay: candidate started from an approved recipe. It is still verified like any other. */
export const markReused = (candidateId: string, recipeId: string) =>
  one("RELATE $c->reused->$r", { c: rid("candidate", candidateId), r: rid("recipe", recipeId) });

// ---------- report (GET /runs/:id/report) ----------

export async function getReport(runId: string) {
  const run = await getRun(runId);
  const [contract, candidates, findings, approvals, events] = await Promise.all([
    getContract(run.contractId),
    listCandidates(runId),
    many<Finding>("SELECT * FROM finding WHERE runId = $run ORDER BY observedAt", { run: rid("run", runId) }),
    many<Approval>("SELECT * FROM approval WHERE runId = $run ORDER BY at", { run: rid("run", runId) }),
    listEvents(runId),
  ]);
  const recipes = await many<RecoveryRecipe>(
    "SELECT * FROM recipe WHERE sourceCandidateId.runId = $run ORDER BY version", { run: rid("run", runId) },
  );
  return { run, contract, candidates, findings, approvals, recipes, events };
}
