import { Hono } from "hono";
import { z } from "zod";
import { parse } from "../errors.ts";
import { source, type Env } from "../http.ts";

const MAX_EVIDENCE_BYTES = 256 * 1024;

const CreateEvidence = z.object({
  kind: z.enum(["http", "log", "patch", "test", "other"]),
  label: z.string().min(1).max(200),
  content: z.string().refine((s) => Buffer.byteLength(s) <= MAX_EVIDENCE_BYTES, "content is over 256KB; store it elsewhere and pass uri").optional(),
  uri: z.string().min(1).optional(),
  candidateId: z.string().optional(),
  author: z.string().min(1),
}).refine((b) => b.content != null || b.uri != null, { message: "content or uri is required", path: ["content"] });

const CreateFinding = z.object({
  author: z.string().min(1),
  category: z.enum(["OWASP-API1-2023", "OTHER"]),
  observation: z.string().min(1).max(4000),
  evidenceIds: z.array(z.string()).min(1, "a finding needs at least one evidence id"),
  targetScope: z.string().min(1),
});

const CreateMessage = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum(["finding", "hypothesis", "request", "response", "decision"]),
  findingIds: z.array(z.string()).optional(),
  body: z.string().min(1).max(4000),
});

export const knowledge = new Hono<Env>()
  .post("/:id/evidence", async (c) =>
    c.json(await c.var.svc.addEvidence(c.req.param("id"), parse(CreateEvidence, await c.req.json()), source(c)), 201))
  .get("/:id/evidence", async (c) => c.json(await c.var.svc.listEvidence(c.req.param("id"))))
  .get("/:id/evidence/:eid", async (c) => c.json(await c.var.svc.getEvidence(c.req.param("id"), c.req.param("eid"))))

  .post("/:id/findings", async (c) =>
    c.json(await c.var.svc.publishFinding(c.req.param("id"), parse(CreateFinding, await c.req.json()), source(c)), 201))
  // ?author=x or ?excludeAuthor=x (an agent reading what the others found)
  .get("/:id/findings", async (c) =>
    c.json(await c.var.svc.listFindings(c.req.param("id"), { author: c.req.query("author"), excludeAuthor: c.req.query("excludeAuthor") })))

  .post("/:id/messages", async (c) =>
    c.json(await c.var.svc.postMessage(c.req.param("id"), parse(CreateMessage, await c.req.json()), source(c)), 201))
  // ?for=agentB returns messages to agentB or the room, not written by agentB
  .get("/:id/messages", async (c) => c.json(await c.var.svc.listMessages(c.req.param("id"), { forAgent: c.req.query("for") })));
