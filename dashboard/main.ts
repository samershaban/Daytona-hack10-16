/**
 * RestoreLab proof sheet — single screen, built once from getRunData().
 * A View object says how much is revealed so the replay can step through it.
 * Live mode polls and re-renders; the gate matrix is the only source of truth on screen.
 */
import "@fontsource/spline-sans/400.css";
import "@fontsource/spline-sans/500.css";
import "@fontsource/spline-sans/600.css";
import "@fontsource/spline-sans/700.css";
import "@fontsource/spline-sans-mono/400.css";
import "@fontsource/spline-sans-mono/500.css";
import "./style.css";
import { CHECKS } from "../tests/acceptance/contract.ts";
import { approveScope, getRunData, replayMode, runId as queryRunId } from "./data.ts";
import type { AgentMessage, Candidate, Finding, RunData, RunStatus, Verdict } from "./types.ts";

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const STATUS_LABEL: Record<RunStatus, string> = {
  created: "Created",
  awaiting_scope_approval: "Awaiting scope approval",
  investigating: "Investigating",
  experimenting: "Experimenting",
  verifying: "Verifying",
  completed: "Completed",
  failed: "Failed",
  unknown: "Unknown",
};

/** Agent identities are named by role, never personas. */
const ROLE: Record<string, string> = {
  "red-team": "Red team", "agent-a": "Recovery A", "agent-b": "Recovery B",
  orchestrator: "Orchestrator", verifier: "Verifier", room: "room",
};

/** Cell/candidate state → glyph + human label. Encoded by shape, label and color. */
const MARK: Record<string, { glyph: string; label: string }> = {
  pass: { glyph: "✓", label: "PASS" },
  fail: { glyph: "✕", label: "FAIL" },
  unknown: { glyph: "—", label: "UNKNOWN" },
  running: { glyph: "◴", label: "RUNNING" },
};

type View = {
  status: RunStatus;
  feedShown: number;
  cells: Set<string>;   // `${candidateId}|${checkName}`
  verdict: boolean;     // verdict + selected revealed
  approvedScope: boolean;
};

const CHECK_BY = new Map(CHECKS.map((c) => [c.name, c]));
let data: RunData;
let feedItems: ReturnType<typeof buildFeed> = [];
let verdictOf = new Map<string, Verdict>();
let outcome: ReturnType<typeof rankCandidates> = { html: "", loserIds: new Set(), pending: true };
let view: View = emptyView();
let polling = false;

function recompute(): void {
  feedItems = buildFeed(data);
  verdictOf = new Map(data.verdicts.map((v) => [v.candidateId, v]));
  outcome = rankCandidates(data);
  view = fullView();
}

/** First load, with retry: if the API is unreachable at start, show the banner and keep trying. */
async function boot(): Promise<void> {
  try {
    data = await getRunData(data?.runId);
    clearApiError();
  } catch (error) {
    showApiError(error);
    setTimeout(boot, 3000);
    return;
  }
  recompute();
  build();
  apply();
  wireControls();
  if (replayMode) {
    $("replay-hint").textContent = "Steps through this recorded run. Pauses for the human scope approval.";
    if (params.has("replay")) void replay();
  } else {
    $<HTMLButtonElement>("replay").hidden = true;
    $("replay-hint").textContent = "Live run. Open with ?mode=replay for the recorded walkthrough.";
    if (!polling) { polling = true; startPolling(); }
  }
}
void boot();

// ---------------- build (once / on live refresh) ----------------

function buildFeed(run: RunData) {
  return [
    ...run.findings.map((f) => ({ kind: "finding" as const, at: f.createdAt, finding: f })),
    ...run.messages.map((m) => ({ kind: "message" as const, at: m.createdAt, message: m })),
  ].sort((a, b) => a.at.localeCompare(b.at));
}

function build(): void {
  $("mode").textContent = replayMode ? "Replay" : "Live API";
  $("mode").dataset.mode = replayMode ? "replay" : "live";
  if (replayMode) $("mode").textContent = `Replay of ${data.runId}`;
  $("run-id").textContent = shortId(data.runId);
  mountCopy($("run-id").parentElement!, data.runId);
  $("baseline").textContent = "";

  buildScope();
  buildFinding();
  buildRoom();
  buildLanes();
  buildMatrix();
  buildVerdict();
  buildSelected();
  buildLegend();
  document.querySelectorAll<HTMLElement>(".idtag").forEach(wireCopyEl);
}

function buildScope(): void {
  const scope = $("scope");
  const route = "GET /books/v1/{title}";
  scope.innerHTML = `
    <div class="target mono">${esc(route)}</div>
    <dl>
      <dt>baseline</dt><dd class="mono">${esc(data.baseFixtureId || "—")}</dd>
      <dt>identities</dt><dd>userA (owner), userB (foreign), admin — synthetic</dd>
      <dt>contract</dt><dd>${CHECKS.filter((c) => c.required).length} hard gates · OWASP API1:2023 / WSTG-ATHZ-04</dd>
      <dt>scope sign-off</dt><dd id="scope-approval"></dd>
    </dl>`;
  renderScopeApproval();
}

function renderScopeApproval(): void {
  const el = document.getElementById("scope-approval");
  if (!el) return;
  if (view.approvedScope || (data.approved && !replayMode)) {
    el.innerHTML = `<span class="mark pass"><span class="box">✓</span>approved</span>`;
    return;
  }
  if (view.status === "awaiting_scope_approval") {
    el.innerHTML = `<button id="approve-scope" type="button" class="btn">Approve scope</button>`;
    document.getElementById("approve-scope")?.addEventListener("click", onApproveScope);
  } else {
    el.textContent = "pending";
  }
}

function buildFinding(): void {
  const f = data.findings[0];
  const el = $("finding");
  if (!f) { el.innerHTML = `<p class="empty">No finding yet.</p>`; return; }
  el.innerHTML = `
    <span class="map">${esc(f.category)} · BOLA</span>
    <p class="obs">${esc(f.observation)}</p>
    <div class="http">
      <div class="req">target ${esc(f.targetScope)}</div>
      <div class="resp">reproduced: cross-user read returned 200 + secret</div>
      <div class="expected">expected for a safe service: 404 without the secret</div>
    </div>
    <div class="evlist">finding ${idTag(f.id)} · evidence ${f.evidenceIds.map((e) => `<span class="mono">${esc(shortId(e))}</span>`).join(" · ")}</div>`;
}

function buildRoom(): void {
  $("feed").innerHTML = feedItems.map(feedItemHtml).join("");
  // wire citation links to scroll + flash the finding block
  $("feed").querySelectorAll<HTMLButtonElement>(".cite").forEach((btn) =>
    btn.addEventListener("click", () => {
      const fb = $("finding");
      fb.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
      fb.classList.remove("finding-flash");
      void fb.offsetWidth;
      if (!reduceMotion()) fb.classList.add("finding-flash");
    }),
  );
}

function feedItemHtml(item: ReturnType<typeof buildFeed>[number], i: number): string {
  if (item.kind === "finding") {
    const f = item.finding;
    return `<li class="msg kind-finding shown" data-i="${i}">
      <div class="meta"><span class="badge">finding</span><span class="from">${esc(f.author)}</span>
        <span class="mono">${esc(f.id)}</span><time>${clock(f.createdAt)}</time></div>
      <p class="body">${esc(f.observation)}</p></li>`;
  }
  const m = item.message;
  const changedPlan = m.from === "agent-b" && /chang/i.test(m.body);
  const cites = m.findingIds.length
    ? `<div class="refs">cites ${m.findingIds.map((id) => `<button type="button" class="cite">${esc(id)}</button>`).join(", ")}${changedPlan ? ` <span class="changed-plan">changed plan</span>` : ""}</div>`
    : "";
  return `<li class="msg kind-${m.type} shown" data-i="${i}">
    <div class="meta"><span class="badge">${esc(m.type)}</span><span class="from">${esc(roleName(m.from))}</span>
      <span class="to">→ ${esc(roleName(m.to))}</span><time>${clock(m.createdAt)}</time></div>
    <p class="body">${esc(m.body)}</p>${cites}</li>`;
}

function buildLanes(): void {
  $("lanes").innerHTML = data.candidates.map((c) => {
    const state = candidateState(c);
    const m = MARK[state];
    return `<div class="lane">
      <div class="cid" title="${esc(c.id)}">${esc(shortId(c.id))}</div>
      <div class="strategy">${esc(c.strategy)}</div>
      <div class="ids"><span class="mono">sandbox ${idTag(c.sandboxId)}</span>${c.patchRef ? `<span class="mono">${esc(c.patchRef)}</span>` : ""}</div>
      <div class="outcome"><span class="mark ${state}"><span class="box">${m.glyph}</span>${m.label === "PASS" ? "verified" : m.label === "FAIL" ? "rejected" : m.label.toLowerCase()}</span></div>
    </div>`;
  }).join("");
}

function buildMatrix(): void {
  const head = `<thead><tr><th class="check-col">Check</th>${data.candidates.map((c) => {
    const failed = verdictOf.get(c.id)?.decision === "fail";
    return `<th class="cand-head${failed ? " failed" : ""}"><span class="cand-id" title="${esc(c.id)}">${esc(shortId(c.id))}</span><span class="cand-strat">${esc(c.strategy)}</span></th>`;
  }).join("")}</tr></thead>`;

  const rows = CHECKS.map((check) => {
    const cells = data.candidates.map((c) => {
      const r = verdictOf.get(c.id)?.checks.find((x) => x.name === check.name);
      const state = r ? (r.passed === true ? "pass" : r.passed === false ? "fail" : "unknown") : "running";
      const culprit = state === "fail" && check.required && outcome.loserIds.has(c.id);
      const m = MARK[state];
      return `<td class="cell${culprit ? " culprit" : ""}" data-key="${esc(c.id)}|${check.name}">
        <span class="mark ${state}" title="evidence ${esc(r?.evidenceId ?? "pending")}">
          <span class="box">${m.glyph}</span><span class="label-full">${m.label}</span></span></td>`;
    }).join("");
    return `<tr><th class="check" scope="row" title="${esc(check.description)}">
      ${esc(humanCheck(check.name))}<span class="cname">${check.name}${check.required ? "" : " · optional"}</span></th>${cells}</tr>`;
  }).join("");

  $("matrix").innerHTML = head + `<tbody>${rows}</tbody>`;
}

function buildLegend(): void {
  $("legend").innerHTML = (["pass", "fail", "unknown", "running"] as const)
    .map((s) => `<span class="mark ${s}"><span class="box">${MARK[s].glyph}</span>${MARK[s].label}</span>`)
    .join("");
}

function buildVerdict(): void {
  $("verdict").innerHTML = outcome.html;
}

function buildSelected(): void {
  const el = $("selected");
  const w = outcome.winner;
  if (!w) {
    el.className = "selected none";
    el.innerHTML = outcome.pending
      ? `Verification in progress — no fix selected yet.`
      : `No verified recovery: no candidate passed every hard gate. Nothing to approve.`;
    renderFixButton(null);
    return;
  }
  const c = data.candidates.find((x) => x.id === w.candidateId);
  el.className = "selected";
  el.innerHTML = `
    <div class="sel-head"><span class="mark pass"><span class="box">✓</span></span>
      <span class="cand">${esc(w.candidateId)}</span><span>${esc(c?.strategy ?? "")}</span></div>
    <div class="ev"><span>${CHECKS.filter((k) => k.required).length}/${CHECKS.filter((k) => k.required).length} hard gates passed</span>
      <span class="mono">${secs(w.recoveryMs)}</span>${c?.patchRef ? `<span class="mono">${esc(c.patchRef)}</span>` : ""}</div>`;
  renderFixButton(w.candidateId);
}

function renderFixButton(candidateId: string | null): void {
  const btn = $<HTMLButtonElement>("approve");
  btn.disabled = !candidateId;
  btn.textContent = candidateId ? `Approve fix from ${candidateId}` : "Approve fix (awaiting a verified candidate)";
}

// ---------------- apply (view reveal) ----------------

function apply(): void {
  const s = $("status");
  s.textContent = STATUS_LABEL[view.status];
  s.dataset.status = view.status;

  renderScopeApproval();

  $("feed").querySelectorAll<HTMLElement>(".msg").forEach((el) => {
    el.classList.toggle("shown", Number(el.dataset.i) < view.feedShown);
  });

  let landed = false;
  document.querySelectorAll<HTMLElement>(".cell").forEach((el) => {
    const on = view.cells.has(el.dataset.key!);
    el.classList.toggle("revealed", on);
    if (on && el.classList.contains("culprit") && !el.classList.contains("land") && !reduceMotion()) {
      el.classList.add("land");
      landed = true;
    }
  });
  void landed;

  $("verdict").classList.toggle("shown", view.verdict);
  $("selected").classList.toggle("shown", view.verdict);
}

// ---------------- views ----------------

function fullView(): View {
  // Every cell is revealed: cells without a verdict render as RUNNING, never blank.
  // The replay starts from emptyView() and reveals progressively instead.
  return {
    status: data.status,
    feedShown: feedItems.length,
    cells: new Set(data.candidates.flatMap((c) => CHECKS.map((k) => `${c.id}|${k.name}`))),
    verdict: true,
    approvedScope: data.approved ?? false,
  };
}

function emptyView(): View {
  return { status: "created", feedShown: 0, cells: new Set(), verdict: false, approvedScope: false };
}

// ---------------- live polling ----------------

function startPolling(): void {
  let lastSeq = data.events?.at(-1)?.seq ?? 0;
  let delay = 3000;
  const tick = async () => {
    try {
      const fresh = await getRunData(data.runId);
      clearApiError();
      delay = 3000;
      const seq = fresh.events?.at(-1)?.seq ?? 0;
      if (seq !== lastSeq || fresh.status !== data.status) {
        lastSeq = seq;
        data = fresh;
        feedItems = buildFeed(data);
        verdictOf = new Map(data.verdicts.map((v) => [v.candidateId, v]));
        outcome = rankCandidates(data);
        view = fullView();
        build();
        apply();
        wireControls();
      }
    } catch (error) {
      showApiError(error);
      delay = Math.min(delay * 2, 15000); // back off, don't stack
    } finally {
      setTimeout(tick, delay);
    }
  };
  setTimeout(tick, delay);
}

function showApiError(error: unknown): void {
  const el = $("api-error");
  el.hidden = false;
  el.textContent = `Can't reach the RestoreLab API at /api (localhost:4000): ${String((error as Error)?.message ?? error)}. Check that the api service is running. Retrying…`;
}
function clearApiError(): void { $("api-error").hidden = true; }

// ---------------- controls ----------------

function wireControls(): void {
  const replayBtn = $<HTMLButtonElement>("replay");
  replayBtn.onclick = () => { if (replayMode) void replay(); };
  $<HTMLButtonElement>("approve").onclick = onApproveFix;
  renderScopeApproval();
}

async function onApproveScope(): Promise<void> {
  if (!replayMode) {
    const approver = prompt("Your name for the scope approval audit record:")?.trim();
    if (!approver) return;
    try { await approveScope(data.runId, approver); clearApiError(); }
    catch (error) { showApiError(error); }
    return;
  }
  const release = releaseGate; releaseGate = undefined; release?.();
}

function onApproveFix(): void {
  const w = outcome.winner;
  if (!w) return;
  if (!confirm(`Approve the fix from ${w.candidateId} for rollout? This records a human sign-off; it does not deploy anything in this demo.`)) return;
  const btn = $<HTMLButtonElement>("approve");
  btn.disabled = true;
  btn.textContent = `Fix from ${w.candidateId} approved ✓`;
}

// ---------------- replay (recorded walkthrough) ----------------

const CANCELLED = Symbol("cancelled");
let replayToken = 0;
let releaseGate: (() => void) | undefined;

async function replay(): Promise<void> {
  const token = ++replayToken;
  const sleep = (ms: number) => new Promise<void>((res, rej) =>
    setTimeout(() => (token === replayToken ? res() : rej(CANCELLED)), reduceMotion() ? Math.min(ms, 120) : ms));
  const step = (mut: (v: View) => void) => { if (token !== replayToken) throw CANCELLED; mut(view); apply(); };

  view = emptyView(); apply();
  try {
    await sleep(700);
    step((v) => (v.status = "awaiting_scope_approval"));
    await new Promise<void>((resolve) => {
      releaseGate = resolve;
      if (params.has("autoapprove")) setTimeout(() => document.getElementById("approve-scope")?.dispatchEvent(new Event("click")), 1500);
    });
    step((v) => { v.approvedScope = true; v.status = "investigating"; });

    for (let i = 0; i < feedItems.length; i++) { await sleep(1100); step((v) => (v.feedShown = i + 1)); }

    await sleep(900); step((v) => (v.status = "experimenting"));
    await sleep(1400); step((v) => (v.status = "verifying"));

    // reveal column by column; the lone FAIL cell is the one deliberate motion moment
    for (const check of CHECKS) for (const c of data.candidates) {
      await sleep(260); step((v) => v.cells.add(`${c.id}|${check.name}`));
    }
    await sleep(700); step((v) => { v.status = data.status; v.verdict = true; });
  } catch (err) { if (err !== CANCELLED) throw err; }
}

// ---------------- ranking (fastest passing candidate; mirrors the verifier) ----------------

function rankCandidates(run: RunData): { html: string; winner?: Verdict; loserIds: Set<string>; pending: boolean } {
  const live = run.mode === "live";
  const settled = ["completed", "failed", "unknown"].includes(run.status);
  if (live && !settled) {
    return { html: `<div class="line"><span>Verification in progress.</span></div>`, loserIds: new Set(), pending: true };
  }
  const passing = run.verdicts.filter((v) => v.decision === "pass")
    .sort((a, b) => (a.recoveryMs ?? Infinity) - (b.recoveryMs ?? Infinity));
  const winner = live ? passing.find((v) => v.candidateId === run.selectedCandidateId) ?? passing[0] : passing[0];
  const losers = run.verdicts.filter((v) => v !== winner);
  const loserIds = new Set(losers.filter((v) => v.decision !== "pass").map((v) => v.candidateId));

  const head = winner
    ? `<div class="line"><span class="mark pass"><span class="box">✓</span></span><span class="cand">${esc(winner.candidateId)}</span><span>verified — passes every hard gate</span><span class="time">${secs(winner.recoveryMs)}</span></div>`
    : `<div class="line"><span class="mark fail"><span class="box">✕</span></span><span>No verified recovery — no candidate passed every hard gate</span></div>`;

  const rejects = losers.map((v) => {
    if (v.decision === "pass") return `<div class="reject"><b>${esc(v.candidateId)}</b> also passed but was slower (${secs(v.recoveryMs)}).</div>`;
    const failed = v.checks.filter((c) => c.passed === false && CHECK_BY.get(c.name)?.required);
    if (!failed.length) return `<div class="reject"><b>${esc(v.candidateId)}</b> not verified — some gates could not run.</div>`;
    return failed.map((c) => {
      const chk = CHECK_BY.get(c.name)!;
      return `<div class="reject"><b>${esc(v.candidateId)}</b> rejected — failed <b>${esc(c.name)}</b>.
        <span class="expvsgot">expected: ${esc(chk.description)}</span>
        <span class="expvsgot">guards against: ${esc(chk.guardsAgainst)}</span>
        <span class="expvsgot">evidence: ${esc(c.evidenceId)}</span></div>`;
    }).join("");
  }).join("");

  return { html: head + rejects, winner, loserIds, pending: false };
}

// ---------------- helpers ----------------

function candidateState(c: Candidate): "pass" | "fail" | "unknown" | "running" {
  const v = verdictOf.get(c.id);
  if (v) return v.decision === "pass" ? "pass" : v.decision === "fail" ? "fail" : "unknown";
  return /reject|fail/i.test(c.status) ? "fail" : /verif|pass/i.test(c.status) ? "pass" : "running";
}

function roleName(x: string): string { return ROLE[x] ?? x; }

function humanCheck(name: string): string {
  return ({
    "exploit-closed": "Cross-user read denied",
    "owner-read-preserved": "Owner reads own book",
    "b-own-book": "User reads own new book",
    "missing-book-404": "Missing title is 404",
    "unauth-401": "No auth is 401",
    "data-preserved": "Seed data unchanged",
    "service-healthy": "Service healthy",
  } as Record<string, string>)[name] ?? name;
}

function shortId(s: string): string {
  return s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-5)}` : s;
}
function idTag(id: string): string {
  return `<span class="idtag" data-full="${esc(id)}"><span class="mono">${esc(shortId(id))}</span><button type="button" class="copy" title="Copy ${esc(id)}" aria-label="Copy ${esc(id)}">copy</button></span>`;
}
function mountCopy(container: HTMLElement, full: string): void {
  // run-id in the masthead gets a copy affordance too
  if (container.querySelector(".copy")) return;
  const b = document.createElement("button");
  b.className = "copy"; b.type = "button"; b.textContent = "copy";
  b.title = `Copy ${full}`; b.setAttribute("aria-label", `Copy ${full}`);
  b.style.marginLeft = "4px";
  b.addEventListener("click", () => void navigator.clipboard?.writeText(full));
  container.appendChild(b);
}
function wireCopyEl(el: HTMLElement): void {
  const full = el.dataset.full ?? "";
  el.querySelector(".copy")?.addEventListener("click", () => void navigator.clipboard?.writeText(full));
  el.title = full;
}

function secs(ms: number | undefined): string { return ms === undefined ? "n/a" : `${(ms / 1000).toFixed(1)} s`; }
function clock(iso: string): string { return new Date(iso).toISOString().slice(11, 19); }
function reduceMotion(): boolean { return matchMedia("(prefers-reduced-motion: reduce)").matches; }
function esc(s: string): string { return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`); }
