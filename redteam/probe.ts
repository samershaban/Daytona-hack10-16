// Red-team probe: proves the BOLA bug behaviorally against the OWNED fixture only.
// Logs in as tenant A (alice) and reads a tenant B record. On the vulnerable baseline
// this returns 200 with B's data (the finding). On a fixed build it must return 404.
//
// Scope guard: refuses to run against anything but an explicitly allowed owned target.
// Emits a Finding JSON (matches shared/contracts Finding shape) to stdout for Samer's API.
import { postFinding } from "./post.ts";

const TARGET = process.env.TARGET_URL ?? "http://127.0.0.1:3000";
const ALLOWED = (process.env.ALLOWED_TARGETS ?? "http://127.0.0.1:3000,http://localhost:3000").split(",");

const FOREIGN_RECORD = "rec-2001"; // belongs to tenant-b / bob
const ALICE = "tok-alice";         // tenant-a user
const BOB = "tok-bob";             // tenant-b user (control)

function assertScope() {
  if (!ALLOWED.some((a) => TARGET.startsWith(a.trim()))) {
    console.error(`refusing: ${TARGET} is not in ALLOWED_TARGETS. This probe runs only against owned fixtures.`);
    process.exit(2);
  }
}

async function get(path: string, token: string) {
  const res = await fetch(`${TARGET}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  assertScope();

  // Control: alice reads her own tenant's record -> should always be 200.
  const own = await get("/api/records/rec-1001", ALICE);
  // Control: bob legitimately reads the foreign record -> establishes it exists and its true owner.
  const legit = await get(`/api/records/${FOREIGN_RECORD}`, BOB);
  // Attack: alice (tenant A) reads a tenant B record.
  const attack = await get(`/api/records/${FOREIGN_RECORD}`, ALICE);

  const reproduced = attack.status === 200 && attack.body?.record?.tenantId === "tenant-b";

  const finding = {
    category: "OWASP-API1-2023" as const,
    title: "Broken Object Level Authorization: cross-tenant record read",
    classification: { owasp: "API1:2023", wstg: "WSTG-ATHZ-04", asvs: "ASVS 5.0 V8.2.2" },
    targetScope: TARGET,
    operation: `GET /api/records/${FOREIGN_RECORD}`,
    reproduced,
    evidence: {
      ownTenantRead: { request: "alice GET rec-1001", status: own.status },
      legitimateOwnerRead: { request: "bob GET " + FOREIGN_RECORD, status: legit.status, owner: legit.body?.record?.ownerId },
      crossTenantRead: { request: "alice GET " + FOREIGN_RECORD, status: attack.status, leaked: attack.body?.record ?? null },
    },
    reproductionSteps: [
      `Authenticate as a tenant-a user (${ALICE}).`,
      `GET /api/records/${FOREIGN_RECORD} (a tenant-b object).`,
      "Vulnerable baseline returns 200 with tenant-b data; a correct build returns 404.",
    ],
    observedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(finding, null, 2));
  if (reproduced) console.error("\nBOLA REPRODUCED: tenant A read tenant B's record.");
  else console.error("\nNot reproduced: cross-tenant read was denied (target appears fixed).");
  // Exit 0 = ran cleanly. `reproduced` is in the JSON; callers key off that, not the exit code.

  await postFinding(finding, { baseFixtureId: "recordshop", targetVersion: "fixture-local" });
}

main().catch((e) => { console.error(e); process.exit(1); });
