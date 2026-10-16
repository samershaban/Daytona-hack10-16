// SurrealDB-backed Store. Documents keep their contract ids as record keys, and inserts also write
// provenance edges (see schema.surql) so the evidence chain is queryable as a graph.
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { RecordId, Surreal } from "surrealdb";
import { WebSocket as NodeWebSocket } from "ws";
import type { AgentMessage, Finding, Run, RunEvent, Verdict } from "@restorelab/contracts";
import { keyOf, type Docs, type Kind, type NewEvent, type Store } from "./store.ts";

const TABLE: Record<Kind, string> = {
  finding: "finding", message: "message", candidate: "candidate",
  verdict: "verdict", approval: "approval", evidence: "evidence",
};

/** Record id -> contract `id` (verdicts have none), drops internal fields. */
function fromRow<T>(row: any, kind?: Kind): T {
  if (!row) return row;
  const { id, _ord, eventSeq, ...rest } = row;
  return (kind === "verdict" ? rest : { id: String((id as RecordId).id), ...rest }) as T;
}

export class SurrealStore implements Store {
  readonly name = "surreal";
  /** Insertion order within this process, so same-millisecond docs list in the order they were written. */
  private ord = Date.now() * 1000;

  private constructor(private db: Surreal) {}

  static async open(opts: { url: string; username: string; password: string }) {
    // Node < 22 has no global WebSocket; the SDK needs one for ws:// URLs.
    const db = new Surreal(globalThis.WebSocket ? {} : { websocketImpl: NodeWebSocket as unknown as typeof WebSocket });
    await db.connect(opts.url, { authentication: { username: opts.username, password: opts.password } });
    // SurrealDB 3 doesn't auto-create namespaces, so the schema (which DEFINEs them) runs before use().
    await db.query(await readFile(new URL("../../schema.surql", import.meta.url), "utf8")).collect();
    await db.use({ namespace: "restorelab", database: "api" });
    return new SurrealStore(db);
  }

  private async q<T = any>(sql: string, vars: Record<string, unknown> = {}): Promise<T> {
    const results = await this.db.query(sql, vars).retry().collect();
    return results[results.length - 1] as T;
  }

  async createRun(run: Run) {
    const { id, ...rest } = run;
    return fromRow<Run>(await this.q("CREATE ONLY $id CONTENT $r", { id: new RecordId("run", id), r: rest }));
  }

  async getRun(id: string) {
    return fromRow<Run | undefined>(await this.q("SELECT * FROM ONLY $id", { id: new RecordId("run", id) }));
  }

  async listRuns() {
    return (await this.q<any[]>("SELECT * FROM run ORDER BY createdAt DESC")).map((r) => fromRow<Run>(r));
  }

  async updateRun(id: string, patch: Partial<Run>) {
    const { id: _, ...rest } = patch;
    const row = await this.q("UPDATE ONLY $id MERGE $p", { id: new RecordId("run", id), p: rest });
    if (!row) throw new Error(`run ${id} not found`);
    return fromRow<Run>(row);
  }

  /** seq comes from an atomic counter on the run, so it is gap-free across concurrent writers. */
  async appendEvent(e: NewEvent) {
    const row = await this.q(
      `BEGIN;
       LET $seq = (UPDATE ONLY $run SET eventSeq += 1 RETURN VALUE eventSeq);
       IF $seq = NONE { THROW 'run not found' };
       LET $ev = (CREATE ONLY $id CONTENT object::extend($e, { seq: $seq }));
       COMMIT;
       RETURN $ev;`,
      {
        run: new RecordId("run", e.runId),
        id: new RecordId("run_event", `evt_${randomUUID()}`),
        e: { ...e, payload: e.payload ?? null, createdAt: new Date().toISOString() },
      },
    );
    return fromRow<RunEvent>(row);
  }

  async listEvents(runId: string, afterSeq = 0) {
    return (await this.q<any[]>("SELECT * FROM run_event WHERE runId = $runId AND seq > $after ORDER BY seq", { runId, after: afterSeq }))
      .map((r) => fromRow<RunEvent>(r));
  }

  async insert<K extends Kind>(kind: K, doc: Docs[K]) {
    const { id: _, ...content } = doc as any;
    const rec = new RecordId(TABLE[kind], keyOf(kind, doc));
    const row = await this.q(
      `BEGIN;
       LET $row = (CREATE ONLY $rec CONTENT $content);
       ${edgesFor(kind)}
       COMMIT;
       RETURN $row;`,
      { rec, content: { ...content, _ord: this.ord++ }, ...edgeVars(kind, doc) },
    );
    return fromRow<Docs[K]>(row, kind);
  }

  async get<K extends Kind>(kind: K, id: string) {
    return fromRow<Docs[K] | undefined>(await this.q("SELECT * FROM ONLY $rec", { rec: new RecordId(TABLE[kind], id) }), kind);
  }

  async list<K extends Kind>(kind: K, runId: string) {
    return (await this.q<any[]>(`SELECT * FROM type::table($t) WHERE runId = $runId ORDER BY _ord`, { t: TABLE[kind], runId }))
      .map((r) => fromRow<Docs[K]>(r, kind));
  }

  async update<K extends Kind>(kind: K, id: string, patch: Partial<Docs[K]>) {
    const { id: _, ...rest } = patch as any;
    const row = await this.q("UPDATE ONLY $rec MERGE $p", { rec: new RecordId(TABLE[kind], id), p: rest });
    if (!row) throw new Error(`${kind} ${id} not found`);
    return fromRow<Docs[K]>(row, kind);
  }

  async close() {
    await this.db.close();
  }
}

/** Provenance edges written in the same transaction as the document. */
function edgesFor(kind: Kind): string {
  switch (kind) {
    case "finding": return "FOR $ev IN $evidence { RELATE $rec->supported_by->$ev; };";
    case "message": return "FOR $f IN $findings { RELATE $rec->cites->$f; };";
    case "verdict": return "RELATE $cand->judged_by->$rec; FOR $ev IN $evidence { RELATE $rec->checked_with->$ev; };";
    default: return "";
  }
}

function edgeVars(kind: Kind, doc: Docs[Kind]): Record<string, unknown> {
  const ids = (t: string, xs: string[]) => [...new Set(xs)].map((x) => new RecordId(t, x));
  if (kind === "finding") return { evidence: ids("evidence", (doc as Finding).evidenceIds) };
  if (kind === "message") return { findings: ids("finding", (doc as AgentMessage).findingIds) };
  if (kind === "verdict") {
    const v = doc as Verdict;
    return { cand: new RecordId("candidate", v.candidateId), evidence: ids("evidence", v.checks.map((c) => c.evidenceId)) };
  }
  return {};
}
