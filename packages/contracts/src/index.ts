// RestoreLab shared contracts. The first five types are copied from BUILD_PLAN.md "Shared contracts";
// everything below them is what the API adds around them. Import from "@restorelab/contracts".

// ---------- BUILD_PLAN.md shared contracts ----------

export type RunStatus = 'created' | 'awaiting_scope_approval' | 'investigating' | 'experimenting' | 'verifying' | 'completed' | 'failed' | 'unknown';

export type Finding = {
  id: string; runId: string; author: string; category: 'OWASP-API1-2023' | 'OTHER';
  observation: string; evidenceIds: string[]; targetScope: string; createdAt: string;
};

export type AgentMessage = {
  id: string; runId: string; from: string; to: string | 'room';
  type: 'finding' | 'hypothesis' | 'request' | 'response' | 'decision';
  findingIds: string[]; body: string; createdAt: string;
};

export type Candidate = {
  id: string; runId: string; sandboxId: string; baseFixtureId: string; strategy: string;
  status: CandidateStatus; patchRef?: string;
  // API additions
  label?: string; agentId?: string; targetUrl?: string;
  /** What the agent says about its own fix. Display only: never affects verdicts or ranking. */
  agentClaim?: string;
  createdAt: string; updatedAt: string;
};

export type Verdict = {
  candidateId: string; checks: { name: string; passed: boolean | null; evidenceId: string }[];
  decision: 'pass' | 'fail' | 'unknown'; recoveryMs?: number;
  // API additions
  runId: string; verifier: string; createdAt: string;
};

// ---------- API additions ----------

export type CandidateStatus = 'planned' | 'executing' | 'checkpoint' | 'verification_pending' | 'done' | 'failed';

export type Run = {
  id: string; status: RunStatus; targetUrl: string; baseFixtureId: string; targetVersion: string;
  description?: string; selectedCandidateId?: string; statusReason?: string;
  createdAt: string; updatedAt: string;
};

export type ApprovalKind = 'scope' | 'remediation';
export type Approval = {
  id: string; runId: string; kind: ApprovalKind; decision: 'approved' | 'denied';
  approver: string; note?: string; candidateId?: string; createdAt: string;
};

/** Raw artifact (HTTP exchange, log, patch, test output) that findings and verdicts point at. */
export type Evidence = {
  id: string; runId: string; kind: 'http' | 'log' | 'patch' | 'test' | 'other'; label: string;
  content?: string; uri?: string; sha256?: string; candidateId?: string; author: string; createdAt: string;
};

export type EventSource = 'orchestrator' | 'redteam' | 'agent' | 'verifier' | 'human' | 'api';

export type RunEvent = {
  id: string; runId: string; seq: number; type: EventType; source: EventSource;
  candidateId?: string; payload: unknown; createdAt: string;
};

export type EventType =
  | 'run.created' | 'run.status' | 'approval.recorded' | 'evidence.added' | 'finding.published'
  | 'message.posted' | 'candidate.created' | 'candidate.updated' | 'verdict.recorded' | 'run.completed';

export type CandidateAssessment = {
  candidate: Candidate; verdict?: Verdict; eligible: boolean; reasons: string[];
};

export type Report = {
  run: Run;
  outcome: 'verified' | 'no_verified_candidate' | 'pending';
  recommendation?: { candidateId: string; strategy: string; recoveryMs: number; patchRef?: string };
  candidates: CandidateAssessment[];
  findings: Finding[];
  messages: AgentMessage[];
  /** Which messages cited which findings: the inter-agent collaboration trail. */
  citations: { messageId: string; from: string; type: AgentMessage['type']; findingIds: string[] }[];
  approvals: Approval[];
  evidence: Omit<Evidence, 'content'>[];
  generatedAt: string;
};

// ---------- request bodies ----------

export type CreateRunBody = { targetUrl: string; baseFixtureId: string; targetVersion: string; description?: string };
export type ApproveBody = { kind: ApprovalKind; decision: Approval['decision']; approver: string; note?: string; candidateId?: string };
export type CreateEvidenceBody = Pick<Evidence, 'kind' | 'label'> & Partial<Pick<Evidence, 'content' | 'uri' | 'candidateId'>> & { author: string };
export type CreateFindingBody = Pick<Finding, 'author' | 'category' | 'observation' | 'evidenceIds' | 'targetScope'>;
export type CreateMessageBody = Pick<AgentMessage, 'from' | 'to' | 'type' | 'body'> & { findingIds?: string[] };
export type CreateCandidateBody = Pick<Candidate, 'sandboxId' | 'baseFixtureId' | 'strategy'> & Partial<Pick<Candidate, 'label' | 'agentId' | 'targetUrl' | 'patchRef'>>;
export type UpdateCandidateBody = Partial<Pick<Candidate, 'status' | 'patchRef' | 'targetUrl' | 'agentClaim'>>;
export type CreateVerdictBody = Pick<Verdict, 'candidateId' | 'checks' | 'decision' | 'recoveryMs' | 'verifier'>;
