/**
 * Verifier configuration for Mahmoud's RecordShop fixture. Tokens and owned
 * record ids come from fixture/src/data.ts so they stay canonical.
 */
import type { IdentityName } from "@restorelab/acceptance";
import { IDENTITIES, seedRecords } from "../fixture/src/data.js";

export type Identity = {
  /** Full Authorization header value. Never logged or stored in evidence. */
  authHeader: string;
  userId: string;
  tenantId: string;
  role: "user" | "admin";
  /** A record this identity owns. */
  ownedRecordId: string;
};

export type VerifierConfig = {
  healthPath: string;
  /** ":id" is replaced with the record id. */
  recordPath: string;
  integrityPath: string;
  identities: Record<IdentityName, Identity>;
};

function identity(token: string): Identity {
  const id = IDENTITIES[token];
  if (!id) throw new Error(`Token ${token} not found in fixture/src/data.ts`);
  const owned = seedRecords().find((r) => r.ownerId === id.userId);
  if (!owned) throw new Error(`No seed record owned by ${id.userId}`);
  return { authHeader: `Bearer ${token}`, ...id, ownedRecordId: owned.id };
}

export const RECORDSHOP_CONFIG: VerifierConfig = {
  healthPath: "/health",
  recordPath: "/api/records/:id",
  integrityPath: "/internal/integrity",
  identities: {
    alice: identity("tok-alice"), // tenant-a user, owns rec-1001
    bob: identity("tok-bob"), // tenant-b user, owns rec-2001
    adminA: identity("tok-admin-a"), // tenant-a ADMIN, owns rec-1002
  },
};
