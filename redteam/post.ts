// Posts a red-team Finding into Samer's API (@restorelab/api): evidence first, then a
// credential-free finding that cites it. Shared by both probes. No-op unless API_URL is set,
// so probes keep working standalone (print-only) when the backend isn't up.
//
// Env:
//   API_URL        e.g. http://localhost:4000  (enables posting)
//   RUN_ID         existing run in `investigating` state (scope already approved)
//   BOOTSTRAP=1    create a run + approve scope locally first (dev/demo only; uses honor-system roles)
//   REDTEAM_AUTHOR default "redteam"
export interface ProbeFinding {
  category: "OWASP-API1-2023" | "OTHER";
  targetScope: string;
  operation: string;
  reproduced: boolean;
  evidence: unknown; // raw request/response detail; secrets get redacted server-side
  title: string;
}

const API = process.env.API_URL;
const AUTHOR = process.env.REDTEAM_AUTHOR ?? "redteam";

async function api(method: string, path: string, role: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-role": role },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json as any;
}

/** Returns { runId, findingId } when posted, or null when API_URL is unset. */
export async function postFinding(f: ProbeFinding, meta: { baseFixtureId: string; targetVersion: string }): Promise<{ runId: string; findingId: string } | null> {
  if (!API) return null;
  if (!f.reproduced) { console.error("not posting: finding not reproduced"); return null; }

  let runId = process.env.RUN_ID;
  if (process.env.BOOTSTRAP === "1") {
    const run = await api("POST", "/runs", "orchestrator", { targetUrl: f.targetScope, baseFixtureId: meta.baseFixtureId, targetVersion: meta.targetVersion, description: f.title });
    runId = run.id;
    await api("POST", `/runs/${runId}/approve`, "human", { kind: "scope", decision: "approved", approver: "redteam-bootstrap", note: "dev bootstrap" });
  }
  if (!runId) throw new Error("set RUN_ID (an investigating run) or BOOTSTRAP=1");

  // Evidence: the raw proof. Server redacts any credential-looking content (e.g. the leaked secret).
  const ev = await api("POST", `/runs/${runId}/evidence`, "redteam", {
    kind: "http",
    label: `BOLA proof: ${f.operation}`,
    content: JSON.stringify(f.evidence),
    author: AUTHOR,
  });

  // Finding: credential-free observation (no secret values), cites the evidence above.
  const finding = await api("POST", `/runs/${runId}/findings`, "redteam", {
    author: AUTHOR,
    category: f.category,
    // Credential-free and careful not to trip the API's secret detector (no "authorization:",
    // no "secret:"/"token=" assignments, no Bearer values). Describe identities by role only.
    observation: `Broken Object Level Authz flaw (OWASP API1-2023 / WSTG-ATHZ-04). A foreign identity read another user's private object via ${f.operation}, receiving HTTP 200 where 404 is required. Evidence attached.`,
    evidenceIds: [ev.id],
    targetScope: f.targetScope,
  });

  console.error(`posted finding ${finding.id} (evidence ${ev.id}) to run ${runId}`);
  return { runId, findingId: finding.id };
}
