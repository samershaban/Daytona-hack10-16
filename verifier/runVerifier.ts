/**
 * Executes the tests/acceptance contract over HTTP against one candidate.
 * Only these results decide the verdict; agent output is never an input.
 *
 * Read-only by design: every request is a GET. The verifier never calls
 * /internal/reset, because resetting would hide the data mutations that
 * data-unchanged exists to detect.
 */
import {
  CHECKS,
  buildVerdict,
  type Check,
  type CheckResult,
  type IdentityName,
  type Verdict,
} from "@restorelab/acceptance";
import { currentTraceId, traceCheck, withSpan, type RunContext } from "@restorelab/evals";
import { randomUUID } from "node:crypto";
import type { VerifierConfig } from "./identities.js";
import { assertInScope } from "./scope.js";

const REQUEST_TIMEOUT_MS = 5_000;
const BODY_PREVIEW_CHARS = 2_000;

/** Request/response captured for one check. Contains no credentials. */
export type Evidence = {
  evidenceId: string;
  check: string;
  required: boolean;
  request?: { method: "GET"; url: string; as?: IdentityName };
  response?: { status: number; body: string };
  expected: string;
  /** Why the check passed, failed or could not run. */
  reason: string;
  at: string;
};

export type VerifierResult = {
  verdict: Verdict;
  runId: string;
  /** Arize trace covering every check; undefined if tracing is not initialised. */
  traceId?: string;
  evidence: Evidence[];
};

export type RunOptions = { runId?: string; candidateId?: string; allowedTargets?: readonly string[] };

type Outcome = { passed: boolean | null; reason: string; request?: Evidence["request"]; response?: Evidence["response"] };

/** Throws OutOfScopeError (before any request) if candidateUrl is not an allowed target. */
export async function runVerifier(
  candidateUrl: string,
  config: VerifierConfig,
  opts: RunOptions = {},
): Promise<VerifierResult> {
  assertInScope(candidateUrl, opts.allowedTargets);

  const runId = opts.runId ?? `verify-${Date.now()}`;
  const candidateId = opts.candidateId ?? "local";
  const ctx: RunContext = { runId, candidateId, agentId: "verifier" };
  const baseUrl = candidateUrl.replace(/\/+$/, "");

  return withSpan("verify.candidate", "CHAIN", ctx, { candidateUrl: baseUrl }, async () => {
    const started = performance.now();
    const results: CheckResult[] = [];
    const evidence: Evidence[] = [];

    for (const check of CHECKS) {
      const evidenceId = `ev-${candidateId}-${check.name}-${randomUUID().slice(0, 8)}`;
      const outcome = await traceCheck(
        check.name,
        ctx,
        { probe: check.probe, expect: check.expect, required: check.required },
        () => runCheck(check, baseUrl, config),
      );
      results.push({ name: check.name, passed: outcome.passed, evidenceId });
      evidence.push({
        evidenceId,
        check: check.name,
        required: check.required,
        request: outcome.request,
        response: outcome.response,
        expected: describeExpectation(check),
        reason: outcome.reason,
        at: new Date().toISOString(),
      });
    }

    // Wall-clock time to run all checks (verification time, not time since candidate start).
    const recoveryMs = Math.round(performance.now() - started);
    return { verdict: buildVerdict(candidateId, results, recoveryMs), runId, traceId: validTraceId(), evidence };
  });
}

async function runCheck({ probe, expect }: Check, baseUrl: string, cfg: VerifierConfig): Promise<Outcome> {
  const res =
    probe.kind === "read-record"
      ? await get(`${baseUrl}${cfg.recordPath.replace(":id", encodeURIComponent(probe.recordId))}`, probe.as, cfg)
      : await get(`${baseUrl}${probe.kind === "health" ? cfg.healthPath : cfg.integrityPath}`);
  if ("error" in res) return { passed: null, reason: res.error, request: res.request };

  const { status } = res.response;
  switch (expect.kind) {
    case "status":
      return status === expect.status
        ? { ...res, passed: true, reason: `Got ${status}` }
        : { ...res, passed: false, reason: `Expected ${expect.status}, got ${status}` };

    case "status-and-record": {
      if (status !== expect.status) return { ...res, passed: false, reason: `Expected ${expect.status}, got ${status}` };
      const record = field(parseJson(res.response.body), "record");
      const id = field(record, "id");
      const tenantId = field(record, "tenantId");
      return id === expect.recordId && tenantId === expect.tenantId
        ? { ...res, passed: true, reason: `${status} with ${id} (${tenantId})` }
        : {
            ...res,
            passed: false,
            reason: `${status} but body.record is ${JSON.stringify({ id, tenantId })}, expected ${expect.recordId} (${expect.tenantId})`,
          };
    }

    case "integrity": {
      if (status !== 200) return { ...res, passed: null, reason: `Integrity endpoint returned ${status}` };
      const body = parseJson(res.response.body);
      const intact = field(body, "intact");
      const recordCount = field(body, "recordCount");
      if (typeof intact !== "boolean" || typeof recordCount !== "number")
        return { ...res, passed: null, reason: "Integrity response missing intact/recordCount" };
      return intact && recordCount === expect.recordCount
        ? { ...res, passed: true, reason: `intact, ${recordCount} records` }
        : { ...res, passed: false, reason: `intact=${intact}, recordCount=${recordCount} (expected ${expect.recordCount})` };
    }
  }
}

// ---- helpers ----

type GetResult =
  | { request: NonNullable<Evidence["request"]>; response: NonNullable<Evidence["response"]> }
  | { request: NonNullable<Evidence["request"]>; error: string };

/** The only way the verifier talks to a candidate: read-only GETs. */
async function get(url: string, as?: IdentityName, cfg?: VerifierConfig): Promise<GetResult> {
  const request = { method: "GET" as const, url, as };
  const headers: Record<string, string> = { accept: "application/json" };
  if (as && cfg) headers.authorization = cfg.identities[as].authHeader;
  try {
    const res = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const body = await res.text();
    return { request, response: { status: res.status, body: body.slice(0, BODY_PREVIEW_CHARS) } };
  } catch (err) {
    return { request, error: `Request failed: ${(err as Error).message}` };
  }
}

function describeExpectation({ expect }: Check): string {
  switch (expect.kind) {
    case "status":
      return `status ${expect.status}`;
    case "status-and-record":
      return `status ${expect.status}, body.record.id ${expect.recordId}, tenantId ${expect.tenantId}`;
    case "integrity":
      return `intact === true and recordCount === ${expect.recordCount}`;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function field(obj: unknown, key: string): unknown {
  return typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>)[key] : undefined;
}

/** The no-op tracer reports an all-zero trace id; treat that as "no trace". */
function validTraceId(): string | undefined {
  const id = currentTraceId();
  return id && !/^0+$/.test(id) ? id : undefined;
}
