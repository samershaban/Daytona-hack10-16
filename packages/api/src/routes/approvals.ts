import { Hono } from "hono";
import { z } from "zod";
import { parse } from "../errors.ts";
import { source, type Env } from "../http.ts";

const Approve = z.object({
  kind: z.enum(["scope", "remediation"]),
  decision: z.enum(["approved", "denied"]),
  approver: z.string().min(1),
  note: z.string().max(2000).optional(),
  candidateId: z.string().optional(),
}).refine((b) => b.kind !== "remediation" || b.candidateId, { message: "candidateId is required for remediation", path: ["candidateId"] });

export const approvals = new Hono<Env>()
  .post("/:id/approve", async (c) =>
    c.json(await c.var.svc.approve(c.req.param("id"), parse(Approve, await c.req.json()), source(c)), 201))
  .get("/:id/approvals", async (c) => c.json(await c.var.svc.listApprovals(c.req.param("id"))));
