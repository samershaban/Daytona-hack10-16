// Storage interface. The API's rules live in service.ts; a Store only persists documents, so the
// memory, JSONL and SurrealDB backends stay interchangeable.
import type { AgentMessage, Approval, Candidate, Evidence, Finding, Run, RunEvent, Verdict } from "@restorelab/contracts";

export type Docs = {
  finding: Finding; message: AgentMessage; candidate: Candidate;
  verdict: Verdict; approval: Approval; evidence: Evidence;
};
export type Kind = keyof Docs;
export const KINDS: Kind[] = ["finding", "message", "candidate", "verdict", "approval", "evidence"];

/** A verdict is keyed by its candidate (one immutable verdict per candidate); everything else by id. */
export const keyOf = <K extends Kind>(kind: K, doc: Docs[K]): string =>
  kind === "verdict" ? (doc as Verdict).candidateId : (doc as { id: string }).id;

export type NewEvent = Omit<RunEvent, "id" | "seq" | "createdAt">;

export interface Store {
  readonly name: string;
  createRun(run: Run): Promise<Run>;
  getRun(id: string): Promise<Run | undefined>;
  listRuns(): Promise<Run[]>;
  updateRun(id: string, patch: Partial<Run>): Promise<Run>;
  /** Assigns a per-run, gap-free seq starting at 1. */
  appendEvent(e: NewEvent): Promise<RunEvent>;
  listEvents(runId: string, afterSeq?: number): Promise<RunEvent[]>;
  insert<K extends Kind>(kind: K, doc: Docs[K]): Promise<Docs[K]>;
  get<K extends Kind>(kind: K, id: string): Promise<Docs[K] | undefined>;
  /** All docs of a kind for a run, oldest first. */
  list<K extends Kind>(kind: K, runId: string): Promise<Docs[K][]>;
  update<K extends Kind>(kind: K, id: string, patch: Partial<Docs[K]>): Promise<Docs[K]>;
  close(): Promise<void>;
}
