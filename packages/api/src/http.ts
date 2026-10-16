import type { Context } from "hono";
import type { EventSource } from "@restorelab/contracts";
import type { Service } from "./service.ts";

export type Env = { Variables: { svc: Service } };

const SOURCES: EventSource[] = ["orchestrator", "redteam", "agent", "verifier", "human", "api"];

/**
 * Caller role from the `x-role` header, recorded as the event source. Honor system for the
 * hackathon: it labels who wrote what and gates verdicts, it is not authentication.
 */
export function source(c: Context): EventSource {
  const r = c.req.header("x-role") as EventSource | undefined;
  return r && SOURCES.includes(r) ? r : "api";
}
