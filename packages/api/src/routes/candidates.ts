import { Hono } from "hono";
import { z } from "zod";
import { parse } from "../errors.ts";
import { source, type Env } from "../http.ts";

const CreateCandidate = z.object({
  sandboxId: z.string().min(1),
  baseFixtureId: z.string().min(1),
  strategy: z.string().min(1).max(2000),
  label: z.string().min(1).max(40).optional(),
  agentId: z.string().min(1).optional(),
  targetUrl: z.string().url().optional(),
  patchRef: z.string().min(1).optional(),
});

const UpdateCandidate = z.object({
  status: z.enum(["planned", "executing", "checkpoint", "verification_pending", "done", "failed"]).optional(),
  patchRef: z.string().min(1).optional(),
  targetUrl: z.string().url().optional(),
  agentClaim: z.string().max(4000).optional(),
}).refine((b) => Object.keys(b).length > 0, "nothing to update");

const CreateVerdict = z.object({
  candidateId: z.string().min(1),
  checks: z.array(z.object({ name: z.string().min(1), passed: z.boolean().nullable(), evidenceId: z.string().min(1) })).min(1),
  decision: z.enum(["pass", "fail", "unknown"]),
  recoveryMs: z.number().int().nonnegative().optional(),
  verifier: z.string().min(1),
});

export const candidates = new Hono<Env>()
  .post("/:id/candidates", async (c) =>
    c.json(await c.var.svc.createCandidate(c.req.param("id"), parse(CreateCandidate, await c.req.json()), source(c)), 201))
  .get("/:id/candidates", async (c) => c.json(await c.var.svc.listCandidates(c.req.param("id"))))
  .get("/:id/candidates/:cid", async (c) => c.json(await c.var.svc.getCandidate(c.req.param("id"), c.req.param("cid"))))
  .patch("/:id/candidates/:cid", async (c) =>
    c.json(await c.var.svc.updateCandidate(c.req.param("id"), c.req.param("cid"), parse(UpdateCandidate, await c.req.json()), source(c))))

  .post("/:id/verdicts", async (c) =>
    c.json(await c.var.svc.recordVerdict(c.req.param("id"), parse(CreateVerdict, await c.req.json()), source(c)), 201))
  .get("/:id/verdicts", async (c) => c.json(await c.var.svc.listVerdicts(c.req.param("id"))));
