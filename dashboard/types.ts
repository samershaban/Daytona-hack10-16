/**
 * Shared contract shapes (120-minute plan) as the dashboard consumes them.
 * Check names come from tests/acceptance/contract.ts so they can't drift from the verifier.
 */
import type { CheckName } from "../tests/acceptance/contract.ts";

export type RunStatus =
  | "created"
  | "awaiting_scope_approval"
  | "investigating"
  | "experimenting"
  | "verifying"
  | "completed"
  | "failed"
  | "unknown";

export type Finding = {
  id: string;
  runId: string;
  author: string;
  category: "OWASP-API1-2023" | "OTHER";
  observation: string;
  evidenceIds: string[];
  targetScope: string;
  createdAt: string;
};

export type AgentMessage = {
  id: string;
  runId: string;
  from: string;
  to: string | "room";
  type: "finding" | "hypothesis" | "request" | "response" | "decision";
  findingIds: string[];
  body: string;
  createdAt: string;
};

export type Candidate = {
  id: string;
  runId: string;
  sandboxId: string;
  baseFixtureId: string;
  strategy: string;
  status: string;
  patchRef?: string;
};

export type Verdict = {
  candidateId: string;
  checks: { name: CheckName; passed: boolean | null; evidenceId: string }[];
  decision: "pass" | "fail" | "unknown";
  recoveryMs?: number;
};

// ---- Dashboard-only (until Samer's GET /runs/:id/events provides these) ----

export type Stage = "created" | "experimenting" | "verifying" | "verdict";
export type StageEvent = { stage: Stage; at: string; detail: string };

/** Everything the screen needs for one run. Returned by getRunData(). */
export type RunData = {
  runId: string;
  status: RunStatus;
  baseFixtureId: string;
  findings: Finding[];
  messages: AgentMessage[];
  candidates: Candidate[];
  verdicts: Verdict[];
  /** Per-candidate stage timestamps, keyed by candidate id. */
  timelines: Record<string, StageEvent[]>;
};
