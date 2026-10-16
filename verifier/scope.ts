/**
 * Scope guard. The verifier only talks to explicitly allowed, team-owned
 * candidate targets (ALLOWED_TARGETS, comma-separated), and it hard-refuses the
 * vulnerable=0 REFERENCE instance.
 *
 * The reference (the oracle, by convention on :5001) is a comparator only.
 * Verifying it instead of the candidate would be a silent lie — a known-good
 * instance would always "pass" — so pointing the verifier at it is a hard
 * error, enforced here regardless of what ALLOWED_TARGETS contains.
 *
 * Matching is on exact origin (scheme + host + port), so a look-alike host such
 * as http://localhost:5000.example.com is rejected.
 */
export const DEFAULT_ALLOWED_TARGETS = [
  "http://127.0.0.1:5000",
  "http://localhost:5000",
  "http://127.0.0.1:5002",
  "http://localhost:5002",
];

/** The reference/oracle lives here by convention. Never verify it. */
export const REFERENCE_PORT = "5001";

export class OutOfScopeError extends Error {}
/** Distinct from OutOfScopeError: the target is the vulnerable=0 oracle. */
export class ReferenceTargetError extends Error {}

export function allowedTargets(env: string | undefined = process.env.ALLOWED_TARGETS): string[] {
  const list = env ? env.split(",") : DEFAULT_ALLOWED_TARGETS;
  return list.map((t) => t.trim()).filter(Boolean);
}

export function assertInScope(candidateUrl: string, allowed: readonly string[] = allowedTargets()): void {
  const url = parse(candidateUrl);

  // Hard rule first: never verify the reference instance, whatever ALLOWED_TARGETS says.
  if (url && url.port === REFERENCE_PORT) {
    throw new ReferenceTargetError(
      `refusing: ${candidateUrl} is on the reference port :${REFERENCE_PORT} (the vulnerable=0 oracle). ` +
        "The verifier must test the candidate, never the oracle. Run the candidate on an allowed port.",
    );
  }

  if (!url || !allowed.some((a) => parse(a)?.origin === url.origin)) {
    throw new OutOfScopeError(
      `refusing: ${candidateUrl} is not in ALLOWED_TARGETS (${allowed.join(", ")}). ` +
        "The verifier runs only against owned candidate targets.",
    );
  }
}

function parse(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}
