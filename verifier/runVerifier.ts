/**
 * Executes the tests/acceptance contract over HTTP against one VAmPI candidate.
 * Only these results decide the verdict; agent output is never an input.
 *
 * Fresh auth each run: userA and userB log in at the start of every run to get
 * new auth_tokens. Tokens are never cached across runs, so an expired token
 * (401) can never be mistaken for a working fix — a failed login makes the
 * dependent checks UNKNOWN, never pass.
 *
 * Writes are limited to logging in (POST /users/v1/login) and creating a book
 * the verifier owns (POST /books/v1) on the CANDIDATE only. It never touches the
 * reference instance, and never calls VAmPI's admin/debug/db endpoints.
 */
import {
  CHECKS,
  buildVerdict,
  type BookRef,
  type Check,
  type CheckResult,
  type IdentityName,
  type Verdict,
} from "@restorelab/acceptance";
import { currentTraceId, traceCheck, traceTool, withSpan, type RunContext } from "@restorelab/evals";
import { randomUUID } from "node:crypto";
import type { VerifierConfig } from "./identities.js";
import { assertInScope } from "./scope.js";

const REQUEST_TIMEOUT_MS = 8_000;
const BODY_PREVIEW_CHARS = 2_000;

const IDENTITIES: readonly IdentityName[] = ["userA", "userB"];

/** Request/response captured for one check. Contains no credentials or secrets. */
export type Evidence = {
  evidenceId: string;
  check: string;
  required: boolean;
  request?: { method: "GET" | "POST"; url: string; as?: IdentityName; auth: boolean };
  /** Body is redacted: secrets, passwords and tokens are stripped before storage. */
  response?: { status: number; body: string };
  expected: string;
  /** Why the check passed, failed or could not run. */
  reason: string;
  at: string;
};

export type VerifierResult = {
  verdict: Verdict;
  runId: string;
  /** Arize trace covering login + every check; undefined if tracing is not initialised. */
  traceId?: string;
  evidence: Evidence[];
};

export type RunOptions = { runId?: string; candidateId?: string; allowedTargets?: readonly string[] };

type Req = NonNullable<Evidence["request"]>;
type Outcome = { passed: boolean | null; reason: string; request?: Req; response?: { status: number; body: string } };
type Http = { status: number; body: string } | { error: string };
type Tokens = Partial<Record<IdentityName, string>>;

/**
 * Throws ReferenceTargetError or OutOfScopeError (before any request) if the
 * target is the reference instance or not an allowed candidate.
 */
export async function runVerifier(
  candidateUrl: string,
  cfg: VerifierConfig,
  opts: RunOptions = {},
): Promise<VerifierResult> {
  assertInScope(candidateUrl, opts.allowedTargets);

  const runId = opts.runId ?? `verify-${Date.now()}`;
  const candidateId = opts.candidateId ?? "local";
  const ctx: RunContext = { runId, candidateId, agentId: "verifier" };
  const baseUrl = candidateUrl.replace(/\/+$/, "");

  return withSpan("verify.candidate", "CHAIN", ctx, { candidateUrl: baseUrl }, async () => {
    const started = performance.now();

    // Fresh login per identity, every run.
    const tokens: Tokens = {};
    const loginErrors: Partial<Record<IdentityName, string>> = {};
    for (const who of IDENTITIES) {
      const r = await traceTool(`login.${who}`, ctx, { who }, () => login(baseUrl, cfg, who));
      if ("token" in r) tokens[who] = r.token;
      else loginErrors[who] = r.error;
    }

    const redact = makeRedactor(cfg, tokens);
    const results: CheckResult[] = [];
    const evidence: Evidence[] = [];

    for (const check of CHECKS) {
      const evidenceId = `ev-${candidateId}-${check.name}-${randomUUID().slice(0, 8)}`;
      const outcome = await traceCheck(
        check.name,
        ctx,
        { probe: check.probe, expect: check.expect, required: check.required },
        () => runCheck(check, baseUrl, cfg, tokens, loginErrors),
      );
      results.push({ name: check.name, passed: outcome.passed, evidenceId });
      evidence.push({
        evidenceId,
        check: check.name,
        required: check.required,
        request: outcome.request,
        response: outcome.response
          ? { status: outcome.response.status, body: redact(outcome.response.body) }
          : undefined,
        expected: describeExpectation(check),
        reason: outcome.reason,
        at: new Date().toISOString(),
      });
    }

    const recoveryMs = Math.round(performance.now() - started);
    return { verdict: buildVerdict(candidateId, results, recoveryMs), runId, traceId: validTraceId(), evidence };
  });
}

// ---- checks ----

async function runCheck(
  { probe, expect }: Check,
  baseUrl: string,
  cfg: VerifierConfig,
  tokens: Tokens,
  loginErrors: Partial<Record<IdentityName, string>>,
): Promise<Outcome> {
  const bookUrl = (title: string) => `${baseUrl}${cfg.bookPath.replace(":title", encodeURIComponent(title))}`;
  const titleOf = (ref: BookRef) => (ref === "missing" ? cfg.missingTitle : cfg.identities[ref].bookTitle);
  const needToken = (who: IdentityName): string | { blocked: Outcome } => {
    const token = tokens[who];
    if (token) return token;
    const req = { method: "GET" as const, url: baseUrl, as: who, auth: true };
    return { blocked: { passed: null, reason: `cannot run: login failed for ${who} (${loginErrors[who] ?? "no token"})`, request: req } };
  };

  switch (probe.kind) {
    case "health": {
      const url = `${baseUrl}${cfg.healthPath}`;
      const req: Req = { method: "GET", url, auth: false };
      const r = await http("GET", url, {});
      if ("error" in r) return { passed: null, reason: r.error, request: req };
      const ok = r.status < 500;
      return { passed: ok, reason: ok ? `liveness ${r.status}` : `liveness ${r.status} (5xx)`, request: req, response: r };
    }

    case "read-book": {
      const url = bookUrl(titleOf(probe.title));
      const who = probe.as;
      const req: Req = { method: "GET", url, as: who, auth: Boolean(who) };
      let token: string | undefined;
      if (who) {
        const t = needToken(who);
        if (typeof t !== "string") return { ...t.blocked, request: req };
        token = t;
      }
      const r = await http("GET", url, { token });
      if ("error" in r) return { passed: null, reason: r.error, request: req };
      return judge(expect, r, cfg, req);
    }

    case "create-then-read": {
      const who = probe.as;
      const createUrl = `${baseUrl}${cfg.bookCreatePath}`;
      const createReq: Req = { method: "POST", url: createUrl, as: who, auth: true };
      const t = needToken(who);
      if (typeof t !== "string") return { ...t.blocked, request: createReq };

      const title = `restorelab-${who}-${Date.now().toString(36)}`;
      const secret = `restorelab-secret-${randomUUID().slice(0, 8)}`;
      const created = await http("POST", createUrl, { token: t, json: { book_title: title, secret } });
      if ("error" in created) return { passed: null, reason: `create failed: ${created.error}`, request: createReq };
      if (created.status >= 400)
        return { passed: false, reason: `create returned ${created.status}`, request: createReq, response: created };

      const readUrl = bookUrl(title);
      const readReq: Req = { method: "GET", url: readUrl, as: who, auth: true };
      const read = await http("GET", readUrl, { token: t });
      if ("error" in read) return { passed: null, reason: `readback failed: ${read.error}`, request: readReq };
      return judge(expect, read, cfg, readReq);
    }

    case "known-books-intact": {
      for (const who of IDENTITIES) {
        const url = bookUrl(cfg.identities[who].bookTitle);
        const req: Req = { method: "GET", url, as: who, auth: true };
        const t = needToken(who);
        if (typeof t !== "string") return { ...t.blocked, request: req };
        const r = await http("GET", url, { token: t });
        if ("error" in r) return { passed: null, reason: `${who} book read failed: ${r.error}`, request: req };
        if (r.status !== 200)
          return { passed: false, reason: `${who} own book returned ${r.status}`, request: req, response: r };
        if (field(parseJson(r.body), "secret") !== cfg.identities[who].expectedSecret)
          return { passed: false, reason: `${who} book secret changed from baseline`, request: req, response: r };
      }
      return { passed: true, reason: "userA and userB known books intact (secrets match baseline)" };
    }
  }
}

/** Expectations that judge a single response. */
function judge(expect: Check["expect"], r: { status: number; body: string }, cfg: VerifierConfig, request: Req): Outcome {
  const base = { request, response: r };
  switch (expect.kind) {
    case "status":
      return { ...base, passed: r.status === expect.status, reason: statusReason(r.status, expect.status) };
    case "non-5xx":
      return { ...base, passed: r.status < 500, reason: `status ${r.status}` };
    case "secret-matches": {
      if (r.status !== 200) return { ...base, passed: false, reason: `expected 200, got ${r.status}` };
      const ok = field(parseJson(r.body), "secret") === cfg.identities[expect.who].expectedSecret;
      return { ...base, passed: ok, reason: ok ? "200, secret matches baseline" : "200 but secret does not match expected" };
    }
    case "denied-without-secret": {
      const statusOk = r.status === expect.status;
      const leaked = r.body.includes(cfg.identities[expect.secretOf].expectedSecret);
      const passed = statusOk && !leaked;
      const reason = !statusOk
        ? `expected ${expect.status}, got ${r.status}`
        : leaked
          ? `status ${r.status} but the response leaked ${expect.secretOf}'s secret`
          : `denied (${r.status}), no secret leaked`;
      return { ...base, passed, reason };
    }
    case "all-secrets-match":
      // Handled inside known-books-intact; never reached via a single-response probe.
      return { ...base, passed: null, reason: "contract error: all-secrets-match is only for known-books-intact" };
  }
}

// ---- http ----

async function login(baseUrl: string, cfg: VerifierConfig, who: IdentityName): Promise<{ token: string } | { error: string }> {
  const { username, password } = cfg.identities[who];
  const r = await http("POST", `${baseUrl}${cfg.loginPath}`, { json: { username, password } });
  if ("error" in r) return { error: r.error };
  if (r.status !== 200) return { error: `login ${who} returned ${r.status}` };
  const token = field(parseJson(r.body), "auth_token");
  return typeof token === "string" && token ? { token } : { error: `login ${who}: no auth_token in response` };
}

async function http(method: "GET" | "POST", url: string, opts: { token?: string; json?: unknown }): Promise<Http> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.json !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return { status: res.status, body: await res.text() };
  } catch (err) {
    return { error: `Request failed: ${(err as Error).message}` };
  }
}

// ---- helpers ----

/** Strips every secret, password and live token from a body before it is stored as evidence. */
function makeRedactor(cfg: VerifierConfig, tokens: Tokens): (body: string) => string {
  const sensitive = [
    ...Object.values(cfg.identities).flatMap((i) => [i.expectedSecret, i.password]),
    ...Object.values(tokens),
  ].filter((s): s is string => Boolean(s));
  return (body) => {
    let out = body;
    for (const s of sensitive) out = out.split(s).join("«redacted»");
    return out.slice(0, BODY_PREVIEW_CHARS);
  };
}

function statusReason(got: number, want: number): string {
  return got === want ? `got ${got}` : `expected ${want}, got ${got}`;
}

function describeExpectation({ expect }: Check): string {
  switch (expect.kind) {
    case "status":
      return `status ${expect.status}`;
    case "non-5xx":
      return "status < 500";
    case "secret-matches":
      return `200 and secret matches ${expect.who}'s baseline`;
    case "denied-without-secret":
      return `status ${expect.status} and no ${expect.secretOf} secret in body`;
    case "all-secrets-match":
      return "userA and userB own-book secrets unchanged";
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
