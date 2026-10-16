// Shared contracts copied verbatim from BUILD_PLAN.md §4.
// TODO: replace with `@restorelab/contracts` once Owner 3 publishes packages/contracts.
export type Verdict = 'PASS' | 'FAIL' | 'INCOMPLETE';
export type RunStatus = 'CREATED' | 'INSPECTING' | 'AWAITING_SCOPE_APPROVAL'
  | 'PREPARING' | 'RUNNING' | 'VERIFYING' | 'COMPLETE'
  | 'NO_VERIFIED_RECOVERY' | 'FAILED' | 'CANCELLED';

export type RecoveryContract = {
  id: string; appVersion: string; approvedBy: string;
  requiredOrderIds: string[]; minLatestOrderMarker: string;
  expectedSchemaVersion: string; maxDataLossSeconds: number;
  checks: Array<'db_integrity' | 'data_freshness' | 'api' | 'login' | 'browser'>;
};

export type Finding = {
  id: string; runId: string; authorAgentId: string;
  appVersion: string; environmentFingerprint: string;
  claim: string; evidenceRefs: string[]; observedAt: string;
  scope: 'run' | 'app_version'; status: 'OBSERVED' | 'VERIFIED' | 'REJECTED';
};

export type CandidateResult = {
  candidateId: string; sandboxId: string; baselineFingerprint: string;
  startedAt: string; verifiedAt?: string; elapsedMs?: number;
  checks: Record<string, { verdict: Verdict; observed?: string; evidenceRefs: string[] }>;
  verdict: Verdict; rejectedReasons: string[]; traceRefs: string[];
};

export type RunEvent = {
  eventId: string; runId: string; seq: number; at: string;
  type: string; source: 'infra' | 'agents' | 'orchestrator' | 'verifier';
  candidateId?: string; payload: unknown;
};

// ---- DB-layer types (not in §4; proposed, need sign-off) ----

export type Run = {
  id: string; status: RunStatus; scenarioId: string; contractId: string;
  appVersion: string; fixtureFingerprint: string;
  winnerCandidateId?: string; createdAt: string; updatedAt: string;
};

/** A candidate row = CandidateResult plus what the DB needs to know about it. */
export type Candidate = CandidateResult & {
  runId: string; label: string; strategy: string;
  /** What the agent said. Stored for display; never affects verdict or ranking. */
  agentClaim?: string;
  forbiddenOpAttempted: boolean;
  dataLossSeconds?: number; riskScore?: number; costUsd?: number;
};

export type ToolAction = {
  id: string; candidateId: string; seq: number; tool: string; command: string;
  exitCode?: number; output?: string; durationMs?: number; refused: boolean; at: string;
};

export type ApprovalKind = 'SCOPE' | 'RECIPE' | 'ACTION';
export type Approval = {
  id: string; runId: string; kind: ApprovalKind; subject: string;
  approver: string; decision: 'APPROVED' | 'DENIED'; note?: string; at: string;
};

export type RecoveryRecipe = {
  id: string; scenarioId: string; appVersion: string; sourceCandidateId: string;
  version: number; steps: string[]; rollback: string[]; risks: string[];
  evidenceRefs: string[]; status: 'PROPOSED' | 'APPROVED' | 'SUPERSEDED' | 'REJECTED';
  createdAt: string;
};

export type Ranking =
  | { outcome: 'COMPLETE'; winner: Candidate; ranked: Candidate[]; ineligible: { candidateId: string; reasons: string[] }[] }
  | { outcome: 'NO_VERIFIED_RECOVERY'; ranked: []; ineligible: { candidateId: string; reasons: string[] }[] };
