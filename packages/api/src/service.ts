// RestoreLab run/event/knowledge rules. Routes stay thin; every rule from BUILD_PLAN.md that the
// backend owns is enforced here, so it holds no matter which Store is behind it.
import { createHash, randomUUID } from "node:crypto";
import type {
  AgentMessage, Approval, ApproveBody, CreateEvidenceBody, CreateFindingBody, CreateMessageBody,
  EventSource, Evidence, Finding, Run, RunEvent, RunStatus,
} from "@restorelab/contracts";
import { ApiError, conflict, notFound, unprocessable } from "./errors.ts";
import { findSecret, redact } from "./secrets.ts";
import type { NewEvent, Store } from "./store/store.ts";

export const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const now = () => new Date().toISOString();

const NEXT: Record<RunStatus, RunStatus[]> = {
  created: ["awaiting_scope_approval"],
  awaiting_scope_approval: ["investigating"],
  investigating: ["experimenting"],
  experimenting: ["verifying"],
  verifying: ["completed", "unknown"],
  completed: [], failed: [], unknown: [],
};
export const TERMINAL: RunStatus[] = ["completed", "failed", "unknown"];

export class Service {
  private locks = new Map<string, Promise<unknown>>();

  constructor(readonly store: Store) {}

  /**
   * Serializes writes per run so check-then-write rules (candidate cap, idempotent retries,
   * one verdict per candidate) hold under concurrent requests to this process.
   */
  protected withRunLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(runId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => {});
    this.locks.set(runId, tail);
    tail.then(() => { if (this.locks.get(runId) === tail) this.locks.delete(runId); });
    return next;
  }

  protected event(e: NewEvent): Promise<RunEvent> {
    return this.store.appendEvent(e);
  }

  // ---------- runs ----------

  async createRun(body: { targetUrl: string; baseFixtureId: string; targetVersion: string; description?: string }, source: EventSource) {
    const t = now();
    const run = await this.store.createRun({
      id: newId("run"), status: "awaiting_scope_approval", ...body, createdAt: t, updatedAt: t,
    });
    await this.event({ runId: run.id, type: "run.created", source, payload: run });
    return run;
  }

  async getRun(id: string): Promise<Run> {
    const run = await this.store.getRun(id);
    if (!run) throw notFound("run", id);
    return run;
  }

  listRuns() {
    return this.store.listRuns();
  }

  setStatus(runId: string, to: RunStatus, source: EventSource, reason?: string) {
    return this.withRunLock(runId, () => this.transition(runId, to, source, reason));
  }

  /** Caller must hold the run lock. `failed` is reachable from any non-terminal state. */
  protected async transition(runId: string, to: RunStatus, source: EventSource, reason?: string, patch: Partial<Run> = {}) {
    const run = await this.getRun(runId);
    const legal = to === "failed" ? !TERMINAL.includes(run.status) : NEXT[run.status].includes(to);
    if (!legal) throw conflict("illegal_transition", `run ${runId} cannot go ${run.status} -> ${to}`);
    if (to === "investigating" && !(await this.scopeApproved(runId)))
      throw conflict("scope_not_approved", "a human must approve the scope before the run can start");
    const updated = await this.store.updateRun(runId, { ...patch, status: to, statusReason: reason, updatedAt: now() });
    await this.event({ runId, type: "run.status", source, payload: { from: run.status, to, reason } });
    return updated;
  }

  /** Moves the run forward to `to` if it is currently at `from`; otherwise leaves it alone. */
  protected async advance(runId: string, from: RunStatus, to: RunStatus, source: EventSource) {
    const run = await this.getRun(runId);
    if (run.status === from) await this.transition(runId, to, source, "automatic");
  }

  protected async scopeApproved(runId: string): Promise<boolean> {
    return (await this.store.list("approval", runId)).some((a) => a.kind === "scope" && a.decision === "approved");
  }

  /** Gate for every agent/red-team/verifier write: scope approved and run not finished. */
  protected async requireOpen(runId: string): Promise<Run> {
    const run = await this.getRun(runId);
    if (!(await this.scopeApproved(runId)))
      throw conflict("scope_not_approved", `run ${runId} has no approved scope; nothing may act on the target yet`);
    if (TERMINAL.includes(run.status)) throw conflict("run_closed", `run ${runId} is ${run.status}`);
    return run;
  }

  async listEvents(runId: string, afterSeq = 0) {
    await this.getRun(runId);
    return this.store.listEvents(runId, afterSeq);
  }

  // ---------- approvals (human gate) ----------

  /**
   * Records a human decision. Idempotent: repeating the same decision returns the stored one; a
   * conflicting second decision is refused. Scope approval starts the run; scope denial fails it.
   * Remediation approval is only for the candidate the backend selected after verification.
   */
  approve(runId: string, body: ApproveBody, source: EventSource): Promise<Approval> {
    return this.withRunLock(runId, async () => {
      if (source !== "human") throw new ApiError(403, "human_only", "approvals must come from a human (x-role: human)");
      const run = await this.getRun(runId);
      const prior = (await this.store.list("approval", runId)).find((a) =>
        a.kind === body.kind && (body.kind === "scope" || a.candidateId === body.candidateId));
      if (prior) {
        if (prior.decision !== body.decision) throw conflict("already_decided", `${body.kind} was already ${prior.decision}`);
        return prior;
      }
      if (body.kind === "scope" && run.status !== "awaiting_scope_approval")
        throw conflict("illegal_transition", `run ${runId} is ${run.status}, not awaiting scope approval`);
      if (body.kind === "remediation") {
        if (run.status !== "completed" || !run.selectedCandidateId)
          throw conflict("nothing_to_approve", `run ${runId} has no verified, selected candidate yet`);
        if (body.candidateId !== run.selectedCandidateId)
          throw unprocessable("not_selected", `only the selected candidate ${run.selectedCandidateId} can be approved for remediation`);
      }
      const approval = await this.store.insert("approval", { id: newId("apr"), runId, ...body, createdAt: now() });
      await this.event({ runId, type: "approval.recorded", source, candidateId: body.candidateId, payload: approval });
      if (body.kind === "scope")
        await this.transition(runId, body.decision === "approved" ? "investigating" : "failed", source,
          body.decision === "approved" ? "scope approved" : "scope denied");
      return approval;
    });
  }

  async listApprovals(runId: string) {
    await this.getRun(runId);
    return this.store.list("approval", runId);
  }

  // ---------- evidence ----------

  /** Stores a raw artifact. Credentials in `content` are redacted before storage and hashing. */
  addEvidence(runId: string, body: CreateEvidenceBody, source: EventSource): Promise<Evidence> {
    return this.withRunLock(runId, async () => {
      await this.requireOpen(runId);
      if (body.candidateId) await this.getCandidateIn(runId, body.candidateId);
      const { text, redactions } = body.content != null ? redact(body.content) : { text: undefined, redactions: 0 };
      const evidence = await this.store.insert("evidence", {
        id: newId("ev"), runId, ...body, content: text,
        sha256: text != null ? createHash("sha256").update(text).digest("hex") : undefined,
        redactions, createdAt: now(),
      });
      const { content: _, ...summary } = evidence;
      await this.event({ runId, type: "evidence.added", source, candidateId: body.candidateId, payload: summary });
      return evidence;
    });
  }

  async getEvidence(runId: string, id: string) {
    const ev = await this.store.get("evidence", id);
    if (!ev || ev.runId !== runId) throw notFound("evidence", id);
    return ev;
  }

  async listEvidence(runId: string) {
    await this.getRun(runId);
    return (await this.store.list("evidence", runId)).map(({ content: _, ...summary }) => summary);
  }

  // ---------- findings + agent messages (collective intelligence) ----------

  /** A finding must point at stored evidence from this run and must not contain credentials. */
  publishFinding(runId: string, body: CreateFindingBody, source: EventSource): Promise<Finding> {
    return this.withRunLock(runId, async () => {
      await this.requireOpen(runId);
      rejectSecrets({ observation: body.observation, targetScope: body.targetScope });
      for (const id of body.evidenceIds) await this.getEvidence(runId, id).catch(() => {
        throw unprocessable("unknown_evidence", `evidence ${id} is not stored for run ${runId}; POST it to /runs/${runId}/evidence first`);
      });
      const finding = await this.store.insert("finding", { id: newId("fnd"), runId, ...body, createdAt: now() });
      await this.event({ runId, type: "finding.published", source, payload: finding });
      return finding;
    });
  }

  /** `excludeAuthor` lets an agent read only what other agents found. */
  async listFindings(runId: string, opts: { author?: string; excludeAuthor?: string } = {}) {
    await this.getRun(runId);
    return (await this.store.list("finding", runId)).filter((f) =>
      (!opts.author || f.author === opts.author) && (!opts.excludeAuthor || f.author !== opts.excludeAuthor));
  }

  /**
   * Agent-to-agent message. `finding` and `decision` messages must cite at least one finding, and
   * every cited finding must exist in this run, so each decision is traceable to evidence.
   */
  postMessage(runId: string, body: CreateMessageBody, source: EventSource): Promise<AgentMessage> {
    return this.withRunLock(runId, async () => {
      await this.requireOpen(runId);
      rejectSecrets({ body: body.body });
      const findingIds = [...new Set(body.findingIds ?? [])];
      if ((body.type === "finding" || body.type === "decision") && findingIds.length === 0)
        throw unprocessable("missing_citation", `a ${body.type} message must cite at least one finding in findingIds`);
      const known = new Set((await this.store.list("finding", runId)).map((f) => f.id));
      const unknown = findingIds.filter((id) => !known.has(id));
      if (unknown.length) throw unprocessable("unknown_finding", `findings not in run ${runId}: ${unknown.join(", ")}`);
      const msg = await this.store.insert("message", { id: newId("msg"), runId, ...body, findingIds, createdAt: now() });
      await this.event({ runId, type: "message.posted", source, payload: msg });
      return msg;
    });
  }

  /** `forAgent` returns messages addressed to that agent or to the room, excluding its own. */
  async listMessages(runId: string, opts: { forAgent?: string } = {}) {
    await this.getRun(runId);
    return (await this.store.list("message", runId)).filter((m) =>
      !opts.forAgent || (m.from !== opts.forAgent && (m.to === "room" || m.to === opts.forAgent)));
  }

  // ---------- candidates ----------

  protected async getCandidateIn(runId: string, id: string) {
    const cand = await this.store.get("candidate", id);
    if (!cand || cand.runId !== runId) throw notFound("candidate", id);
    return cand;
  }
}

function rejectSecrets(fields: Record<string, string>) {
  for (const [field, text] of Object.entries(fields)) {
    const kind = findSecret(text);
    if (kind) throw unprocessable("secret_detected", `${field} looks like it contains a ${kind}; refer to identities by name, never share credentials`);
  }
}
