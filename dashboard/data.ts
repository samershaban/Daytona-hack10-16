/**
 * The dashboard's only data entry point. Live wiring (Samer's GET /runs/:id and
 * /runs/:id/events) replaces the body of this function and nothing else.
 */
import { MOCK_RUN } from "./mock.ts";
import type { RunData } from "./types.ts";

export async function getRunData(_runId?: string): Promise<RunData> {
  return structuredClone(MOCK_RUN);
}
