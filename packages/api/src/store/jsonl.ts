// BUILD_PLAN.md fallback ledger: MemoryStore plus an append-only JSONL file replayed on start.
// Each write logs the full resulting record, so replay is a plain upsert in file order.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Run, RunEvent } from "@restorelab/contracts";
import { MemoryStore } from "./memory.ts";
import { keyOf, type Docs, type Kind, type NewEvent } from "./store.ts";

type Op =
  | { op: "run"; run: Run }
  | { op: "event"; event: RunEvent }
  | { op: "doc"; kind: Kind; doc: Docs[Kind] };

export class JsonlStore extends MemoryStore {
  override readonly name = "jsonl";

  private constructor(readonly path: string) {
    super();
  }

  static open(path: string): JsonlStore {
    mkdirSync(dirname(path), { recursive: true });
    const s = new JsonlStore(path);
    if (existsSync(path)) {
      const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
      lines.forEach((line, i) => {
        try {
          s.apply(JSON.parse(line));
        } catch (err) {
          // A torn final line from a crash mid-write is skipped; anything earlier is corruption.
          if (i < lines.length - 1) throw new Error(`${path}:${i + 1}: ${(err as Error).message}`);
          console.warn(`${path}: ignoring unparsable last line`);
        }
      });
    }
    return s;
  }

  private apply(o: Op) {
    if (o.op === "run") {
      this.runs.set(o.run.id, o.run);
      if (!this.events.has(o.run.id)) this.events.set(o.run.id, []);
    } else if (o.op === "event") {
      this.events.get(o.event.runId)?.push(o.event);
    } else {
      (this.docs[o.kind] as Map<string, Docs[Kind]>).set(keyOf(o.kind, o.doc), o.doc);
    }
  }

  private log(o: Op) {
    appendFileSync(this.path, JSON.stringify(o) + "\n");
  }

  override async createRun(run: Run) {
    const r = await super.createRun(run);
    this.log({ op: "run", run: r });
    return r;
  }

  override async updateRun(id: string, patch: Partial<Run>) {
    const r = await super.updateRun(id, patch);
    this.log({ op: "run", run: r });
    return r;
  }

  override async appendEvent(e: NewEvent) {
    const ev = await super.appendEvent(e);
    this.log({ op: "event", event: ev });
    return ev;
  }

  override async insert<K extends Kind>(kind: K, doc: Docs[K]) {
    const d = await super.insert(kind, doc);
    this.log({ op: "doc", kind, doc: d });
    return d;
  }

  override async update<K extends Kind>(kind: K, id: string, patch: Partial<Docs[K]>) {
    const d = await super.update(kind, id, patch);
    this.log({ op: "doc", kind, doc: d });
    return d;
  }
}
