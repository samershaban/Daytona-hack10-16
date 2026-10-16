import { Hono } from "hono";
import { ApiError } from "../errors.ts";
import type { Env } from "../http.ts";

export const memory = new Hono<Env>()
  // GET /memory?q=<question>&run=<runId>&kind=finding|decision&k=10
  .get("/", async (c) => {
    const q = c.req.query("q");
    if (!q) throw new ApiError(400, "invalid_query", "q is required");
    const k = c.req.query("k") ? Math.min(50, Math.max(1, Number(c.req.query("k")) || 10)) : undefined;
    return c.json(await c.var.svc.recallMemory(q, { runId: c.req.query("run"), kind: c.req.query("kind"), k }));
  });
