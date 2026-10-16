import { randomUUID } from "node:crypto";
import type { Run, RunEvent } from "@restorelab/contracts";
import { KINDS, keyOf, type Docs, type Kind, type NewEvent, type Store } from "./store.ts";

/** Process-local store. Lost on restart; used for tests and as the base of the JSONL store. */
export class MemoryStore implements Store {
  readonly name: string = "memory";
  protected runs = new Map<string, Run>();
  protected events = new Map<string, RunEvent[]>();
  protected docs = Object.fromEntries(KINDS.map((k) => [k, new Map()])) as { [K in Kind]: Map<string, Docs[K]> };

  async createRun(run: Run) {
    if (this.runs.has(run.id)) throw new Error(`run ${run.id} exists`);
    this.runs.set(run.id, structuredClone(run));
    this.events.set(run.id, []);
    return structuredClone(run);
  }

  async getRun(id: string) {
    const r = this.runs.get(id);
    return r && structuredClone(r);
  }

  async listRuns() {
    return [...this.runs.values()].map((r) => structuredClone(r)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateRun(id: string, patch: Partial<Run>) {
    const r = this.runs.get(id);
    if (!r) throw new Error(`run ${id} not found`);
    Object.assign(r, patch);
    return structuredClone(r);
  }

  async appendEvent(e: NewEvent) {
    const list = this.events.get(e.runId);
    if (!list) throw new Error(`run ${e.runId} not found`);
    const ev: RunEvent = { ...e, id: `evt_${randomUUID()}`, seq: list.length + 1, createdAt: new Date().toISOString() };
    list.push(ev);
    return structuredClone(ev);
  }

  async listEvents(runId: string, afterSeq = 0) {
    return (this.events.get(runId) ?? []).filter((e) => e.seq > afterSeq).map((e) => structuredClone(e));
  }

  async insert<K extends Kind>(kind: K, doc: Docs[K]) {
    const key = keyOf(kind, doc);
    if (this.docs[kind].has(key)) throw new Error(`${kind} ${key} exists`);
    this.docs[kind].set(key, structuredClone(doc));
    return structuredClone(doc);
  }

  async get<K extends Kind>(kind: K, id: string) {
    const d = this.docs[kind].get(id);
    return d && structuredClone(d);
  }

  async list<K extends Kind>(kind: K, runId: string) {
    return [...this.docs[kind].values()].filter((d) => d.runId === runId).map((d) => structuredClone(d));
  }

  async update<K extends Kind>(kind: K, id: string, patch: Partial<Docs[K]>) {
    const d = this.docs[kind].get(id);
    if (!d) throw new Error(`${kind} ${id} not found`);
    Object.assign(d, patch);
    return structuredClone(d);
  }

  async close() {}
}
