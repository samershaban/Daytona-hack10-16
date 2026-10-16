/** Publish only measured verifier evidence and its immutable verdict. */
import type { VerifierResult } from "./runVerifier.js";

export async function publishResult(apiOrigin: string, result: VerifierResult): Promise<void> {
  const base = `${apiOrigin.replace(/\/+$/, "")}/runs/${encodeURIComponent(result.runId)}`;
  const request = async <T>(path: string, body: unknown): Promise<T> => {
    const response = await fetch(`${base}${path}`, {
      method: "POST", headers: { "content-type": "application/json", "x-role": "verifier" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`API ${path}: HTTP ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  };
  const ids = new Map<string, string>();
  for (const evidence of result.evidence) {
    const stored = await request<{ id: string }>("/evidence", {
      kind: "test", label: `Independent verifier: ${evidence.check}`,
      content: JSON.stringify(evidence), author: "Hamza-verifier", candidateId: result.verdict.candidateId,
    });
    ids.set(evidence.evidenceId, stored.id);
  }
  await request("/verdicts", {
    candidateId: result.verdict.candidateId, verifier: "Hamza-verifier",
    checks: result.verdict.checks.map((c) => ({ ...c, evidenceId: ids.get(c.evidenceId) })),
    decision: result.verdict.decision, recoveryMs: result.verdict.recoveryMs,
  });
}
