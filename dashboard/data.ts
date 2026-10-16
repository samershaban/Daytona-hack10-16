/**
 * The dashboard's only data entry point. Live wiring (Samer's GET /runs/:id and
 * /runs/:id/events) replaces fetchLiveRun() and nothing else.
 *
 * Demo default: USE_MOCK is true, so the dashboard serves the seeded mock run —
 * reliable for the judged demo. Set VITE_USE_MOCK=false (with a live
 * control-plane) to pull a real run instead.
 */
import { MOCK_RUN } from "./mock.ts";
import type { RunData } from "./types.ts";

export const USE_MOCK = (import.meta.env.VITE_USE_MOCK ?? "true") !== "false";

export async function getRunData(runId?: string): Promise<RunData> {
  if (USE_MOCK) return structuredClone(MOCK_RUN);
  return fetchLiveRun(runId);
}

// TODO(live): fetch from Samer's control-plane (GET /runs/:id) and map to RunData.
async function fetchLiveRun(_runId?: string): Promise<RunData> {
  throw new Error("Live mode is not wired yet. Run with USE_MOCK (the default), or set VITE_USE_MOCK=false once the control-plane is up.");
}
