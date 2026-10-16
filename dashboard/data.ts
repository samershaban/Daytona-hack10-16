/** API-backed run view. Replay is explicit: ?mode=replay. */
import { MOCK_RUN } from "./mock.ts";
import type { RunData, StageEvent } from "./types.ts";

const params = new URLSearchParams(location.search);
export const replayMode = params.get("mode") === "replay";
export const runId = params.get("run") ?? params.get("runId");

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`API ${path}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export async function approveScope(id: string, approver: string): Promise<void> {
  const response = await fetch(`/api/runs/${encodeURIComponent(id)}/approve`, {
    method: "POST", headers: { "content-type": "application/json", "x-role": "human" },
    body: JSON.stringify({ kind: "scope", decision: "approved", approver }),
  });
  if (!response.ok) throw new Error(`Scope approval failed: HTTP ${response.status}: ${await response.text()}`);
}

export async function getRunData(id = runId): Promise<RunData> {
  if (replayMode) return { ...structuredClone(MOCK_RUN), mode: "replay", approved: true };
  const selectedId = id ?? (await api<{ id: string }[]>("/runs"))[0]?.id;
  if (!selectedId) throw new Error("No API runs exist yet. Create an authorized run or use ?mode=replay for sample data.");
  const key = encodeURIComponent(selectedId);
  type Report = {
    run: { id: string; status: RunData["status"]; baseFixtureId: string; selectedCandidateId?: string };
    outcome: "verified" | "no_verified_candidate" | "pending";
    recommendation?: { candidateId: string };
    findings: RunData["findings"];
    messages: RunData["messages"];
    candidates: { candidate: RunData["candidates"][number]; verdict?: RunData["verdicts"][number] }[];
    approvals: { kind: string; decision: string }[];
  };
  type Event = { seq: number; type: string; candidateId?: string; createdAt: string; payload: unknown };
  const [report, events] = await Promise.all([
    api<Report>(`/runs/${key}/report`), api<Event[]>(`/runs/${key}/events`),
  ]);
  const timelines: Record<string, StageEvent[]> = {};
  for (const item of report.candidates) timelines[item.candidate.id] = [];
  for (const event of events) {
    const id = event.candidateId ?? (event.payload as { id?: string } | null)?.id;
    if (!id || !timelines[id]) continue;
    const stage = event.type === "candidate.created" ? "created"
      : event.type === "verdict.recorded" ? "verdict"
      : event.type === "candidate.updated" && (event.payload as { status?: string })?.status === "verification_pending" ? "verifying"
      : event.type === "candidate.updated" ? "experimenting" : undefined;
    if (stage) timelines[id].push({ stage, at: event.createdAt, detail: event.type });
  }
  return {
    mode: "live", runId: report.run.id, status: report.run.status,
    baseFixtureId: report.run.baseFixtureId, findings: report.findings, messages: report.messages,
    candidates: report.candidates.map((x) => x.candidate),
    verdicts: report.candidates.flatMap((x) => x.verdict ? [x.verdict] : []),
    timelines, events, outcome: report.outcome,
    selectedCandidateId: report.run.selectedCandidateId,
    recommendedCandidateId: report.recommendation?.candidateId,
    approved: report.approvals.some((a) => a.kind === "scope" && a.decision === "approved"),
  };
}
