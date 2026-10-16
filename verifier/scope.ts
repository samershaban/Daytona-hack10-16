/**
 * Scope guard, mirroring redteam/probe.ts: the verifier only talks to
 * explicitly allowed, team-owned targets (ALLOWED_TARGETS, comma-separated).
 * Matches on exact origin (scheme + host + port), so look-alike hosts such as
 * http://localhost:3000.example.com are rejected.
 */
export const DEFAULT_ALLOWED_TARGETS = [
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  "http://127.0.0.1:3001",
  "http://localhost:3001",
  "http://127.0.0.1:3002",
  "http://localhost:3002",
];

export class OutOfScopeError extends Error {}

export function allowedTargets(env: string | undefined = process.env.ALLOWED_TARGETS): string[] {
  const list = env ? env.split(",") : DEFAULT_ALLOWED_TARGETS;
  return list.map((t) => t.trim()).filter(Boolean);
}

export function assertInScope(candidateUrl: string, allowed: readonly string[] = allowedTargets()): void {
  const origin = originOf(candidateUrl);
  if (!origin || !allowed.some((a) => originOf(a) === origin)) {
    throw new OutOfScopeError(
      `refusing: ${candidateUrl} is not in ALLOWED_TARGETS (${allowed.join(", ")}). ` +
        "The verifier runs only against owned fixtures.",
    );
  }
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
