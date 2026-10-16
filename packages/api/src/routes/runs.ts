import { Hono } from "hono";
import { z } from "zod";
import { parse } from "../errors.ts";
import { source, type Env } from "../http.ts";

const CreateRun = z.object({
  targetUrl: z.string().url(),
  baseFixtureId: z.string().min(1),
  targetVersion: z.string().min(1),
  description: z.string().max(2000).optional(),
});

const SetStatus = z.object({
  status: z.enum(["investigating", "experimenting", "verifying", "failed"]),
  reason: z.string().max(2000).optional(),
});

export const runs = new Hono<Env>()
  .post("/", async (c) => {
    const run = await c.var.svc.createRun(parse(CreateRun, await c.req.json()), source(c));
    return c.json(run, 201);
  })
  .get("/", async (c) => c.json(await c.var.svc.listRuns()))
  .get("/:id", async (c) => c.json(await c.var.svc.getRun(c.req.param("id"))))
  // Manual status moves. Most moves happen automatically (approval, first candidate, first verdict, complete).
  .patch("/:id", async (c) => {
    const { status, reason } = parse(SetStatus, await c.req.json());
    return c.json(await c.var.svc.setStatus(c.req.param("id"), status, source(c), reason));
  })
  // Polling feed: GET /runs/:id/events?after=<last seq seen>
  .get("/:id/events", async (c) => {
    const after = Number(c.req.query("after") ?? 0);
    return c.json(await c.var.svc.listEvents(c.req.param("id"), Number.isFinite(after) ? after : 0));
  })
  // Live view of the decision so far; safe to poll.
  .get("/:id/report", async (c) => c.json(await c.var.svc.report(c.req.param("id"))))
  // Select the fastest verified candidate and close the run. Needs a verdict for every candidate.
  .post("/:id/complete", async (c) => c.json(await c.var.svc.complete(c.req.param("id"), source(c))));
