// Synthetic, team-owned seed data. No real users, tenants, or secrets.
// Everything here is fake and exists only to demonstrate the BOLA bug and its fix.

export type Role = "user" | "admin";
export interface Identity { userId: string; tenantId: string; role: Role; }
export interface DataRecord { id: string; tenantId: string; ownerId: string; label: string; balanceCents: number; }

// Static bearer tokens -> identity. Fine for a synthetic demo; not how you'd ship auth.
export const IDENTITIES: Record<string, Identity> = {
  "tok-alice": { userId: "alice", tenantId: "tenant-a", role: "user" },
  "tok-bob": { userId: "bob", tenantId: "tenant-b", role: "user" },
  "tok-admin-a": { userId: "admin-a", tenantId: "tenant-a", role: "admin" },
};

// Canonical records. Count and contents are part of the verifier contract: a fix must not change them.
export function seedRecords(): DataRecord[] {
  return [
    { id: "rec-1001", tenantId: "tenant-a", ownerId: "alice", label: "A: invoice #1", balanceCents: 1500 },
    { id: "rec-1002", tenantId: "tenant-a", ownerId: "admin-a", label: "A: invoice #2", balanceCents: 9900 },
    { id: "rec-2001", tenantId: "tenant-b", ownerId: "bob", label: "B: invoice #1", balanceCents: 4200 },
    { id: "rec-2002", tenantId: "tenant-b", ownerId: "bob", label: "B: invoice #2", balanceCents: 7700 },
  ];
}

export const CANONICAL_RECORD_COUNT = seedRecords().length;
