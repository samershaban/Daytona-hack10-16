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

export type SurrealOptions = {
  url: string; username: string; password: string;
  namespace: string; database: string; authLevel: "root" | "namespace" | "database";
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

  /**
   * `authLevel` is the level the user is defined on: `root` (local default), or `namespace` /
   * `database` for a user scoped to one namespace or database (e.g. a Surreal Cloud system user).
   * Each level creates only what it is allowed to: root the namespace, namespace the database.
   */
  static async open(opts: SurrealOptions) {
    const { url, username, password, namespace, database, authLevel } = opts;
    for (const name of [namespace, database])
      if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`invalid SurrealDB namespace/database name: ${name}`);
    const authentication =
      authLevel === "root" ? { username, password }
      : authLevel === "namespace" ? { namespace, username, password }
      : { namespace, database, username, password };
    // Node < 22 has no global WebSocket; the SDK needs one for ws:// URLs.
    const db = new Surreal(globalThis.WebSocket ? {} : { websocketImpl: NodeWebSocket as unknown as typeof WebSocket });
    await db.connect(url, { authentication });
    // SurrealDB 3 doesn't auto-create namespaces or databases.
    if (authLevel === "root") await db.query(`DEFINE NAMESPACE IF NOT EXISTS ${namespace}`).collect();
    if (authLevel !== "database") {
      await db.use({ namespace });
      await db.query(`DEFINE DATABASE IF NOT EXISTS ${database}`).collect();
    }
    await db.use({ namespace, database });
    // schema.surql's own NS/DB preamble is for running it by hand; here the connection's NS/DB is used.
    const schema = (await readFile(new URL("../../schema.surql", import.meta.url), "utf8"))
      .split("\n").filter((l) => !/^\s*(DEFINE NAMESPACE|USE NS|DEFINE DATABASE|USE DB)\b/i.test(l)).join("\n");
    await db.query(schema).collect();
    return new SurrealStore(db);
  }

  /** Reads SURREAL_* env vars. Defaults match a local `surreal start --user root --pass root`. */
  static fromEnv() {
    const authLevel = process.env.SURREAL_AUTH_LEVEL ?? "root";
    if (authLevel !== "root" && authLevel !== "namespace" && authLevel !== "database")
      throw new Error(`SURREAL_AUTH_LEVEL=${authLevel} (expected root | namespace | database)`);
    return SurrealStore.open({
      url: process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc",
      username: process.env.SURREAL_USER ?? "root",
      password: process.env.SURREAL_PASS ?? "root",
      namespace: process.env.SURREAL_NS ?? "restorelab",
      database: process.env.SURREAL_DB ?? "api",
      authLevel,
    });
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
