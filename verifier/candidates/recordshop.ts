/**
 * Copy of Mahmoud's fixture/src/server.ts createApp() for local verifier
 * candidates, with the marked BOLA spot replaced by a pluggable `authorize`
 * policy. Data and identities are imported from his fixture/src/data.ts so
 * they stay canonical. His files are not modified.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import {
  CANONICAL_RECORD_COUNT,
  IDENTITIES,
  seedRecords,
  type DataRecord,
  type Identity,
} from "../../fixture/src/data.js";

/** Returns true if `me` may read `record`. */
export type Authorize = (record: DataRecord, me: Identity) => boolean;

type AuthedRequest = Request & { identity?: Identity };

export function createCandidateApp(authorize: Authorize) {
  let records: DataRecord[] = seedRecords();

  function authenticate(req: AuthedRequest, res: Response, next: NextFunction) {
    const token = (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const identity = IDENTITIES[token];
    if (!identity) return res.status(401).json({ error: "unauthenticated" });
    req.identity = identity;
    next();
  }

  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.get("/api/records", authenticate, (req: AuthedRequest, res) => {
    const me = req.identity!;
    res.json({ records: records.filter((r) => r.tenantId === me.tenantId) });
  });

  app.get("/api/records/:id", authenticate, (req: AuthedRequest, res) => {
    const me = req.identity!;
    const record = records.find((r) => r.id === req.params.id);
    if (!record) return res.status(404).json({ error: "not found" });

    // >>> Mahmoud's marked BOLA spot: candidate policy applied here. Deny with 404. <<<
    if (!authorize(record, me)) return res.status(404).json({ error: "not found" });
    return res.json({ record });
  });

  app.post("/internal/reset", (req, res) => {
    const secret = process.env.RESET_SECRET ?? "dev-reset";
    if (req.header("x-reset-secret") !== secret) return res.status(403).json({ error: "forbidden" });
    records = seedRecords();
    res.json({ ok: true, recordCount: records.length });
  });

  app.get("/internal/integrity", (_req, res) =>
    res.json({ recordCount: records.length, canonical: CANONICAL_RECORD_COUNT, intact: records.length === CANONICAL_RECORD_COUNT }),
  );

  return app;
}

export function listen(app: ReturnType<typeof express>, name: string, defaultPort: number): void {
  const port = Number(process.env.PORT ?? defaultPort);
  app.listen(port, "127.0.0.1", () => console.log(`RecordShop (${name}) listening on http://127.0.0.1:${port}`));
}
