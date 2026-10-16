/**
 * MOCK run: the VAmPI books-BOLA story, end to end. All demo data lives here.
 * Verdict rows and decisions are derived from the acceptance contract, so the
 * mock agrees with what the real verifier would decide for these results.
 */
import { CHECKS, decide, type CheckName } from "../tests/acceptance/contract.ts";
import type { AgentMessage, Candidate, Finding, RunData, StageEvent, Verdict } from "./types.ts";

const RUN_ID = "run-20261016-1532-vampi";
const BASE_FIXTURE = "erev0s/vampi:latest (vulnerable=1)";
const at = (hms: string) => `2026-10-16T${hms}.000Z`;

const findings: Finding[] = [
  {
    id: "F-1",
    runId: RUN_ID,
    author: "red-team",
    category: "OWASP-API1-2023",
    observation:
      "userB GET /books/v1/{userA's title} → 200 with userA's book, including the secret field. Cross-user object read reproduced (WSTG-ATHZ-04).",
    evidenceIds: ["ev-redteam-attack-7a19", "ev-redteam-control-4c2e"],
    targetScope: "http://127.0.0.1:5000",
    createdAt: at("15:32:40"),
  },
];

const messages: AgentMessage[] = [
  {
    id: "M-1",
    runId: RUN_ID,
    from: "agent-a",
    to: "room",
    type: "hypothesis",
    findingIds: ["F-1"],
    body: "Citing F-1: GET /books/v1/{title} returns any book by title with no owner check. Root cause is in the book-retrieval handler.",
    createdAt: at("15:32:54"),
  },
  {
    id: "M-2",
    runId: RUN_ID,
    from: "agent-a",
    to: "room",
    type: "hypothesis",
    findingIds: ["F-1"],
    body: "Strategy A: enforce book.owner === caller before returning; 404 otherwise. Keeps legitimate owner reads working.",
    createdAt: at("15:33:07"),
  },
  {
    id: "M-3",
    runId: RUN_ID,
    from: "agent-b",
    to: "agent-a",
    type: "response",
    findingIds: ["F-1"],
    body: "Read F-1. Changing plan: Strategy B, deny all non-owner reads with a blanket filter. Smallest diff.",
    createdAt: at("15:33:18"),
  },
  {
    id: "M-4",
    runId: RUN_ID,
    from: "orchestrator",
    to: "room",
    type: "decision",
    findingIds: ["F-1"],
    body: "Run A and B as vulnerable=1 candidates with the BOLA patched in code, in isolated Daytona sandboxes. The verifier decides.",
    createdAt: at("15:33:30"),
  },
];

const candidates: Candidate[] = [
  {
    id: "candidate-a",
    runId: RUN_ID,
    sandboxId: "sbx-9a21f6c3",
    baseFixtureId: BASE_FIXTURE,
    strategy: "ownership check on book owner",
    status: "verified",
    patchRef: "patch/candidate-a.diff",
  },
  {
    id: "candidate-b",
    runId: RUN_ID,
    sandboxId: "sbx-4e70b1d8",
    baseFixtureId: BASE_FIXTURE,
    strategy: "deny all non-owner book reads",
    status: "rejected",
    patchRef: "patch/candidate-b.diff",
  },
];

/** Builds a verdict over every contract check; `failed` lists the checks that failed. */
function verdictFor(candidateId: string, failed: CheckName[], recoveryMs: number): Verdict {
  const checks = CHECKS.map((c) => ({
    name: c.name,
    passed: !failed.includes(c.name),
    evidenceId: `ev-${candidateId}-${c.name}-${shortHash(candidateId + c.name)}`,
  }));
  const decision = decide(checks);
  return decision === "pass" ? { candidateId, checks, decision, recoveryMs } : { candidateId, checks, decision };
}

const verdicts: Verdict[] = [
  verdictFor("candidate-a", [], 3_800),
  // Over-restrictive: the blanket filter also denies userA reading their own book.
  verdictFor("candidate-b", ["owner-read-preserved"], 2_900),
];

const timelines: Record<string, StageEvent[]> = {
  "candidate-a": [
    { stage: "created", at: at("15:33:33"), detail: "forked from vulnerable=1 baseline" },
    { stage: "experimenting", at: at("15:33:35"), detail: "patched book handler, 1 file" },
    { stage: "verifying", at: at("15:33:39"), detail: "independent verifier, 7 checks" },
    { stage: "verdict", at: at("15:33:40"), detail: "" },
  ],
  "candidate-b": [
    { stage: "created", at: at("15:33:33"), detail: "forked from vulnerable=1 baseline" },
    { stage: "experimenting", at: at("15:33:34"), detail: "patched book handler, 1 file" },
    { stage: "verifying", at: at("15:33:37"), detail: "independent verifier, 7 checks" },
    { stage: "verdict", at: at("15:33:38"), detail: "" },
  ],
};

export const MOCK_RUN: RunData = {
  runId: RUN_ID,
  status: "completed",
  baseFixtureId: BASE_FIXTURE,
  findings,
  messages,
  candidates,
  verdicts,
  timelines,
};

function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).slice(0, 4);
}
