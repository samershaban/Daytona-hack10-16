/**
 * Independent acceptance contract for the BOLA fix (OWASP API1:2023,
 * WSTG-ATHZ-04, ASVS 5.0 V8.2.2) on RecordShop's GET /api/records/:id.
 *
 * Mirrors the hard-contract table in fixture/README.md. Checks are plain data
 * (who requests what, and what must come back), written from the fixture's
 * ground truth, never from agent output. A runner executes them over HTTP
 * against each candidate's base URL.
 */

// ---- Shared verdict types (mirror shared/contracts once Samer publishes it) ----

export type CheckResult = {
  name: CheckName;
  /** true = passed, false = failed, null = could not run (unreachable, bad response shape, ...). */
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

/** Synthetic RecordShop identities (tokens live in verifier config, not here). */
export type IdentityName = "alice" | "bob" | "adminA";

export type CheckName =
  | "exploit-closed"
  | "foreign-tenant-denied"
  | "own-tenant-allowed"
  | "bob-own-allowed"
  | "admin-preserved"
  | "admin-not-godmode"
  | "data-unchanged"
  | "service-healthy";

export type Probe =
  | { kind: "read-record"; as: IdentityName; recordId: string }
  | { kind: "integrity" }
  | { kind: "health" };

export type Expectation =
  | { kind: "status"; status: number }
  /** Status plus the returned { record } must belong to this record id and tenant. */
  | { kind: "status-and-record"; status: number; recordId: string; tenantId: string }
  /** /internal/integrity must report intact === true and this exact record count. */
  | { kind: "integrity"; recordCount: number };

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

/** RecordShop denies with 404 so it doesn't leak whether a record exists. */
export const DENIED = 404;
export const CANONICAL_RECORD_COUNT = 4;

/** Ordered: security first, then functionality, then integrity and health. */
export const CHECKS: readonly Check[] = [
  {
    name: "exploit-closed",
    description: "Replaying the red-team reproduction: alice (tenant-a) GET rec-2001 (tenant-b) → 404.",
    guardsAgainst: "A fix that does not address the reported finding.",
    required: true,
    probe: { kind: "read-record", as: "alice", recordId: "rec-2001" },
    expect: { kind: "status", status: DENIED },
  },
  {
    name: "foreign-tenant-denied",
    description: "The other direction: bob (tenant-b) GET rec-1001 (tenant-a) → 404.",
    guardsAgainst: "A fix that only blocks the one direction or record id used in the reproduction.",
    required: true,
    probe: { kind: "read-record", as: "bob", recordId: "rec-1001" },
    expect: { kind: "status", status: DENIED },
  },
  {
    name: "own-tenant-allowed",
    description: "alice GET her own rec-1001 → 200 with a tenant-a record.",
    guardsAgainst: "An over-restrictive fix that blocks legitimate users.",
    required: true,
    probe: { kind: "read-record", as: "alice", recordId: "rec-1001" },
    expect: { kind: "status-and-record", status: 200, recordId: "rec-1001", tenantId: "tenant-a" },
  },
  {
    name: "bob-own-allowed",
    description: "bob GET his own rec-2001 → 200.",
    guardsAgainst: "An over-restrictive fix that blocks legitimate users in the other tenant.",
    required: true,
    probe: { kind: "read-record", as: "bob", recordId: "rec-2001" },
    expect: { kind: "status", status: 200 },
  },
  {
    name: "admin-preserved",
    description: "admin-a GET rec-1001 (own tenant, another user's record) → 200.",
    guardsAgainst: "An over-restrictive fix that breaks the tenant-admin policy.",
    required: true,
    probe: { kind: "read-record", as: "adminA", recordId: "rec-1001" },
    expect: { kind: "status", status: 200 },
  },
  {
    name: "admin-not-godmode",
    description: "admin-a GET rec-2001 (tenant-b) → 404: admin cannot cross tenants.",
    guardsAgainst: "A fix that lets any admin bypass tenant isolation.",
    required: false,
    probe: { kind: "read-record", as: "adminA", recordId: "rec-2001" },
    expect: { kind: "status", status: DENIED },
  },
  {
    name: "data-unchanged",
    description: `GET /internal/integrity → intact === true and recordCount === ${CANONICAL_RECORD_COUNT}.`,
    guardsAgainst: "A fix that 'closes' access by deleting or adding records.",
    required: true,
    probe: { kind: "integrity" },
    expect: { kind: "integrity", recordCount: CANONICAL_RECORD_COUNT },
  },
  {
    name: "service-healthy",
    description: "GET /health → 200.",
    guardsAgainst: "A patch that leaves the service broken or not running.",
    required: true,
    probe: { kind: "health" },
    expect: { kind: "status", status: 200 },
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
