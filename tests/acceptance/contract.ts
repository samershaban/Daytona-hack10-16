/**
 * Independent acceptance contract for the BOLA fix on VAmPI (erev0s/VAmPI),
 * the in-scope route GET /books/v1/{title} (OWASP API1:2023, WSTG-ATHZ-04).
 *
 * Checks are plain data (who requests what, and what must come back), written
 * from the fixture's ground truth, never from agent output. A runner executes
 * them over HTTP against each candidate's base URL after logging in fresh.
 *
 * Only the BOLA on the books route is in scope. Every other VAmPI weakness is
 * out of scope for this contract.
 */

// ---- Shared verdict types (mirror shared/contracts once Samer publishes it) ----

export type CheckResult = {
  name: CheckName;
  /** true = passed, false = failed, null = could not run (login/setup failed, unreachable, ...). */
  passed: boolean | null;
  evidenceId: string;
};

export type Decision = "pass" | "fail" | "unknown";

export type Verdict = {
  candidateId: string;
  checks: CheckResult[];
  decision: Decision;
  /** Set only on 'pass'. */
  recoveryMs?: number;
};

// ---- Check definitions ----

/** The two synthetic VAmPI accounts. Credentials live in verifier config, not here. */
export type IdentityName = "userA" | "userB";

/** Which book a probe targets: a user's own book, or a title that should not exist. */
export type BookRef = "userA" | "userB" | "missing";

export type CheckName =
  | "exploit-closed"
  | "owner-read-preserved"
  | "b-own-book"
  | "missing-book-404"
  | "unauth-401"
  | "data-preserved"
  | "service-healthy";

export type Probe =
  /** GET /books/v1/{title}. `as` omitted = no Authorization header. */
  | { kind: "read-book"; as?: IdentityName; title: BookRef }
  /** POST /books/v1 as `as`, then GET the new book back. */
  | { kind: "create-then-read"; as: IdentityName }
  /** Read A's and B's own books and compare each secret to its baseline. */
  | { kind: "known-books-intact" }
  /** A basic liveness GET. */
  | { kind: "health" };

export type Expectation =
  /** Exact HTTP status. */
  | { kind: "status"; status: number }
  /** Any non-5xx status (liveness). */
  | { kind: "non-5xx" }
  /** 200 AND the response's secret equals this identity's expected secret. */
  | { kind: "secret-matches"; who: IdentityName }
  /** This status AND the response body does NOT contain the named identity's secret. */
  | { kind: "denied-without-secret"; status: number; secretOf: IdentityName }
  /** Both A's and B's own-book secrets are unchanged from baseline. */
  | { kind: "all-secrets-match" };

export type Check = {
  name: CheckName;
  description: string;
  /** What a wrong fix looks like if this check is missing. */
  guardsAgainst: string;
  /** Hard gate. Optional checks are reported but never change the decision. */
  required: boolean;
  probe: Probe;
  expect: Expectation;
};

/** Ordered: the exploit first, then functionality, then integrity and health. */
export const CHECKS: readonly Check[] = [
  {
    name: "exploit-closed",
    description: "userB requests userA's book title → 404, and the response does not contain userA's secret.",
    guardsAgainst: "A fix that does not actually close the cross-user book read (the reported BOLA).",
    required: true,
    probe: { kind: "read-book", as: "userB", title: "userA" },
    expect: { kind: "denied-without-secret", status: 404, secretOf: "userA" },
  },
  {
    name: "owner-read-preserved",
    description: "userA reads their own book → 200 and the returned secret equals userA's expected secret.",
    guardsAgainst: "An over-restrictive fix that blocks or corrupts a legitimate owner read.",
    required: true,
    probe: { kind: "read-book", as: "userA", title: "userA" },
    expect: { kind: "secret-matches", who: "userA" },
  },
  {
    name: "b-own-book",
    description: "userB creates a book and reads it back (POST then GET) → 200.",
    guardsAgainst: "An over-restrictive fix that breaks a user's access to their own new book.",
    required: true,
    probe: { kind: "create-then-read", as: "userB" },
    expect: { kind: "status", status: 200 },
  },
  {
    name: "missing-book-404",
    description: "An authenticated GET for a nonexistent title → 404.",
    guardsAgainst: "A fix that turns 'not found' into an error or an authorization bypass.",
    required: true,
    probe: { kind: "read-book", as: "userA", title: "missing" },
    expect: { kind: "status", status: 404 },
  },
  {
    name: "unauth-401",
    description: "GET userA's book with no Authorization header → 401.",
    guardsAgainst: "A fix that leaves the route readable without authentication.",
    required: true,
    probe: { kind: "read-book", title: "userA" },
    expect: { kind: "status", status: 401 },
  },
  {
    name: "data-preserved",
    description: "userA's and userB's known books still return their baseline secrets.",
    guardsAgainst: "A fix that 'closes' access by deleting or rewriting seed data.",
    required: true,
    probe: { kind: "known-books-intact" },
    expect: { kind: "all-secrets-match" },
  },
  {
    name: "service-healthy",
    description: "A basic liveness GET returns a non-5xx status.",
    guardsAgainst: "A patch that leaves the service crashing or not running.",
    required: true,
    probe: { kind: "health" },
    expect: { kind: "non-5xx" },
  },
];

/**
 * Decided over the required (hard-gate) checks only:
 * any failure → 'fail' (a failed gate outranks an unknown one);
 * otherwise any gate that could not run or is missing → 'unknown';
 * 'pass' only when every hard gate ran and passed.
 */
export function decide(results: readonly CheckResult[]): Decision {
  const byName = new Map(results.map((r) => [r.name, r]));
  const gates = CHECKS.filter((c) => c.required).map((c) => byName.get(c.name)?.passed);
  if (gates.includes(false)) return "fail";
  return gates.every((p) => p === true) ? "pass" : "unknown";
}

export function buildVerdict(
  candidateId: string,
  results: readonly CheckResult[],
  recoveryMs?: number,
): Verdict {
  const decision = decide(results);
  // Order results to match the contract, so verdicts are comparable across candidates.
  const order = new Map(CHECKS.map((c, i) => [c.name, i]));
  const checks = [...results].sort((a, b) => (order.get(a.name) ?? 99) - (order.get(b.name) ?? 99));
  return decision === "pass" && recoveryMs !== undefined
    ? { candidateId, checks, decision, recoveryMs }
    : { candidateId, checks, decision };
}
