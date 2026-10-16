// RecordShop — a deliberately vulnerable, team-owned multi-tenant demo API.
// The bug is BOLA (OWASP API1:2023): GET /api/records/:id returns any record by id,
// with NO check that the record belongs to the caller's tenant. Recovery agents fix
// exactly that, in the one marked spot. Everything else is here to make the fix provable.
import express, { type Request, type Response, type NextFunction } from "express";
import { CANONICAL_RECORD_COUNT, IDENTITIES, seedRecords, type DataRecord, type Identity } from "./data.ts";

// In-memory store, re-seeded on boot and via /internal/reset. Deterministic resets, no DB needed.
let records: DataRecord[] = seedRecords();

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { identity?: Identity } }
}

// Bearer-token auth: maps a static token to a synthetic identity. Unauthenticated -> 401.
function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const identity = IDENTITIES[token];
  if (!identity) return res.status(401).json({ error: "unauthenticated" });
  req.identity = identity;
  next();
}

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true }));

  // List only the caller's own-tenant records. (Not the vulnerable endpoint.)
  app.get("/api/records", authenticate, (req, res) => {
    const me = req.identity!;
    const visible = records.filter((r) => r.tenantId === me.tenantId);
    res.json({ records: visible });
  });

  app.get("/api/records/:id", authenticate, (req, res) => {
    const me = req.identity!;
    const record = records.find((r) => r.id === req.params.id);
    if (!record) return res.status(404).json({ error: "not found" });

    // >>> BOLA VULNERABILITY (OWASP API1:2023 / WSTG-ATHZ-04) <<<
    // The record is returned without verifying the caller is allowed to see it.
    // THE FIX GOES HERE: deny unless record.tenantId === me.tenantId
    //   and (record.ownerId === me.userId || me.role === "admin").
    // Deny with 404 (don't leak existence). Admin may read any record in its OWN tenant.
    return res.json({ record });
    // <<< END VULNERABILITY >>>
  });

  // Internal-only reset: re-seed to the canonical state. Guarded by a shared secret so it
  // isn't exposed in the demo. Used by scripts/reset-fixture.sh between runs.
  app.post("/internal/reset", (req, res) => {
    const secret = process.env.RESET_SECRET ?? "dev-reset";
    if (req.header("x-reset-secret") !== secret) return res.status(403).json({ error: "forbidden" });
    records = seedRecords();
    res.json({ ok: true, recordCount: records.length });
  });

  // Integrity probe for the verifier: canonical count unchanged?
  app.get("/internal/integrity", (_req, res) =>
    res.json({ recordCount: records.length, canonical: CANONICAL_RECORD_COUNT, intact: records.length === CANONICAL_RECORD_COUNT }));

  return app;
}

// Entry point (skipped when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => console.log(`RecordShop (vulnerable) listening on :${port}`));
}
