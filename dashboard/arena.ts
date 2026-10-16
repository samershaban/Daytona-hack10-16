/**
 * Alternate "fight card" view of the same run. Reads the same getRunData() and
 * the same contract check names as the default dashboard; only the visual
 * treatment changes. The default dashboard (index.html / main.ts) is untouched.
 */
import "./arena.css";
import { CHECKS } from "../tests/acceptance/contract.ts";
import { approveScope, getRunData, replayMode } from "./data.ts";
import type { AgentMessage, Candidate, Finding, RunData, RunStatus, Verdict } from "./types.ts";

const CORNER: Record<string, { corner: string; label: string }> = {
  "candidate-a": { corner: "blue", label: "Blue corner" },
  "candidate-b": { corner: "red", label: "Red corner" },
};

const STATUS_LABEL: Record<RunStatus, string> = {
  created: "Created",
  awaiting_scope_approval: "Awaiting scope approval",
  investigating: "Investigating",
  experimenting: "In the ring",
  verifying: "Judging",
  completed: "Bout over",
  failed: "Failed",
  unknown: "Unknown",
};

type View = {
  status: RunStatus;
  feedShown: number;
  /** Revealed scorecard cells, keyed `${candidateId}|${checkName}`. */
  cells: Set<string>;
  decided: boolean;
  approved: boolean;
};

type FeedItem = { kind: "finding"; at: string; finding: Finding } | { kind: "message"; at: string; message: AgentMessage };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const data = await getRunData().catch((error: unknown) => {
  $("app").textContent = `RestoreLab live arena: ${String(error)}`;
  throw error;
});
data.candidates.slice(0, 2).forEach((candidate, index) => {
  CORNER[candidate.id] = index === 0
    ? { corner: "blue", label: "Blue corner" }
    : { corner: "red", label: "Red corner" };
});
$("mode").textContent = replayMode ? "SAMPLE REPLAY · SIMULATED" : "LIVE API";
if (!replayMode) {
  $<HTMLButtonElement>("replay").hidden = true;
  const lastSeq = data.events?.at(-1)?.seq ?? 0;
  setInterval(async () => {
    try { if (((await getRunData(data.runId)).events?.at(-1)?.seq ?? 0) !== lastSeq) location.reload(); }
    catch (error) { $("mode").textContent = `LIVE API ERROR: ${String(error)}`; }
  }, 3000);
}
const feedItems: FeedItem[] = [
  ...data.findings.map((f): FeedItem => ({ kind: "finding", at: f.createdAt, finding: f })),
  ...data.messages.map((m): FeedItem => ({ kind: "message", at: m.createdAt, message: m })),
].sort((a, b) => a.at.localeCompare(b.at));
const verdictOf = new Map(data.verdicts.map((v) => [v.candidateId, v]));
const outcome = rank(data);

let view = fullView();
build();
apply();

// ---- build (once) ----

function build(): void {
  $("run-id").textContent = data.runId;

  for (const [index, c] of data.candidates.slice(0, 2).entries()) {
    document.querySelectorAll<HTMLElement>(".fighter")[index]!.id = `fighter-${c.id}`;
    buildFighter(c);
  }

  const head = `<thead><tr><th class="round-col">Round</th>${data.candidates
    .map((c) => {
      const lost = verdictOf.get(c.id)?.decision === "fail";
      return `<th class="corner-${CORNER[c.id]?.corner ?? "blue"}${lost ? " lost" : ""}">${esc(c.id)}${
        lost ? `<span class="ko-tag">KO</span>` : ""
      }</th>`;
    })
    .join("")}</tr></thead>`;

  const rows = CHECKS.map((check, i) => {
    const cells = data.candidates
      .map((c) => {
        const r = verdictOf.get(c.id)?.checks.find((x) => x.name === check.name);
        const state = r ? (r.passed === true ? "win" : r.passed === false ? "ko" : "unknown") : "unknown";
        const decisive = state === "ko" && check.required && outcome.loserIds.has(c.id) ? " decisive" : "";
        const lostCol = verdictOf.get(c.id)?.decision === "fail";
        const glyph = state === "win" ? "✓" : state === "ko" ? "✕" : "?";
        return `<td class="pt${lostCol ? " lost-col" : ""}" data-key="${esc(c.id)}|${check.name}"
          data-state="${state}${decisive}" data-tip="${esc(r?.evidenceId ?? "no evidence")}"><span>${glyph}</span></td>`;
      })
      .join("");
    return `<tr><th class="round" title="${esc(check.description)}"><span class="rnum">R${i + 1}</span>${esc(check.name)}${
      check.required ? "" : `<small>bonus</small>`
    }</th>${cells}</tr>`;
  }).join("");

  const tally = `<tr class="tally"><th class="round">Rounds won</th>${data.candidates
    .map((c) => `<td class="score">${pointsFor(c.id)}<span>/${CHECKS.length}</span></td>`)
    .join("")}</tr>`;

  $("scorecard").innerHTML = head + `<tbody>${rows}${tally}</tbody>`;
  $("feed").innerHTML = feedItems.map(feedItemHtml).join("");
  $("decision").innerHTML = outcome.html;
}

function buildFighter(c: Candidate): void {
  const el = $(`fighter-${c.id}`);
  const v = verdictOf.get(c.id);
  const corner = CORNER[c.id] ?? { corner: "blue", label: "Corner" };
  const champion = outcome.winnerId === c.id;
  const defeated = v?.decision === "fail";
  el.classList.toggle("champion", champion);
  el.classList.toggle("defeated", defeated);
  el.innerHTML = `
    <div class="corner-label">${esc(corner.label)}</div>
    <div class="fighter-name">${esc(c.id)}</div>
    <div class="style"><span class="k">Style</span>${esc(c.strategy)}</div>
    <div class="tag"><code>${esc(c.sandboxId)}</code></div>
    <div class="result">
      ${champion ? `<span class="belt">★ CHAMPION</span><span class="finish">finish ${secs(v?.recoveryMs)}</span>` : ""}
      ${defeated ? `<span class="stamp">DEFEATED</span>` : ""}
    </div>`;
}

function feedItemHtml(item: FeedItem, i: number): string {
  if (item.kind === "finding") {
    const f = item.finding;
    return `<li class="msg kind-finding" data-i="${i}">
      <div class="meta"><span class="badge b-finding">finding</span><span class="from">${esc(f.author)}</span>
        <span class="ref">${esc(f.id)}</span><time>${clock(f.createdAt)}</time></div>
      <p class="body">${esc(f.observation)}</p></li>`;
  }
  const m = item.message;
  return `<li class="msg kind-${m.type}" data-i="${i}">
    <div class="meta"><span class="badge b-${m.type}">${m.type}</span><span class="from">${esc(m.from)}</span>
      <span class="to">→ ${esc(m.to)}</span><time>${clock(m.createdAt)}</time></div>
    <p class="body">${esc(m.body)}</p></li>`;
}

// ---- apply ----

function apply(): void {
  const status = $("status");
  status.textContent = STATUS_LABEL[view.status];
  status.dataset.status = view.status;

  const approve = $<HTMLButtonElement>("approve");
  const gateOpen = view.status === "awaiting_scope_approval";
  approve.disabled = !gateOpen;
  approve.classList.toggle("pulse", gateOpen);
  approve.textContent = view.approved ? "Scope approved ✓" : "Approve scope";

  const feed = $("feed");
  feed.querySelectorAll<HTMLElement>(".msg").forEach((el) => {
    el.classList.toggle("shown", Number(el.dataset.i) < view.feedShown);
  });
  // Scroll only the feed, never the window (which would hide the header).
  feed.scrollTop = view.feedShown >= feedItems.length ? 0 : feed.scrollHeight;

  document.querySelectorAll<HTMLElement>(".pt").forEach((el) => {
    el.classList.toggle("revealed", view.cells.has(el.dataset.key!));
  });

  for (const c of data.candidates.slice(0, 2)) {
    const lit = view.decided && outcome.winnerId === c.id;
    const out = view.decided && verdictOf.get(c.id)?.decision === "fail";
    const el = $(`fighter-${c.id}`);
    el.classList.toggle("lit", lit);
    el.classList.toggle("out", out);
  }
  $("decision").classList.toggle("shown", view.decided);
  document.querySelectorAll<HTMLElement>(".tally .score").forEach((el) => el.classList.toggle("shown", view.decided));
}

// ---- views ----

function fullView(): View {
  return {
    status: data.status,
    feedShown: feedItems.length,
    cells: new Set(data.candidates.flatMap((c) => CHECKS.map((k) => `${c.id}|${k.name}`))),
    decided: true,
    approved: data.approved ?? false,
  };
}

function emptyView(): View {
  return { status: "created", feedShown: 0, cells: new Set(), decided: false, approved: false };
}

// ---- replay the bout (~20s) ----

const CANCELLED = Symbol("cancelled");
let token = 0;
let releaseGate: (() => void) | undefined;

async function replay(): Promise<void> {
  const mine = ++token;
  const sleep = (ms: number) =>
    new Promise<void>((res, rej) => setTimeout(() => (mine === token ? res() : rej(CANCELLED)), ms));
  const step = (fn: (v: View) => void) => {
    if (mine !== token) throw CANCELLED;
    fn(view);
    apply();
  };

  view = emptyView();
  apply();
  try {
    await sleep(800);
    step((v) => (v.status = "awaiting_scope_approval"));
    await new Promise<void>((resolve) => {
      releaseGate = resolve;
      if (params.has("autoapprove")) setTimeout(() => $("approve").click(), 2_000);
    });
    step((v) => {
      v.approved = true;
      v.status = "investigating";
    });

    for (let i = 0; i < feedItems.length; i++) {
      await sleep(1_200);
      step((v) => (v.feedShown = i + 1));
    }

    await sleep(900);
    step((v) => (v.status = "experimenting"));
    await sleep(1_200);
    step((v) => (v.status = "verifying"));

    for (const check of CHECKS) {
      for (const c of data.candidates) {
        await sleep(320);
        step((v) => v.cells.add(`${c.id}|${check.name}`));
      }
    }

    await sleep(900);
    step((v) => {
      v.status = data.status;
      v.decided = true;
    });
  } catch (err) {
    if (err !== CANCELLED) throw err;
  }
}

$("replay").addEventListener("click", () => { if (replayMode) void replay(); });
$("approve").addEventListener("click", async () => {
  if (view.status !== "awaiting_scope_approval") return;
  if (!replayMode) {
    const approver = prompt("Your name for the scope approval audit record:")?.trim();
    if (!approver) return;
    try { await approveScope(data.runId, approver); location.reload(); }
    catch (error) { alert(String(error)); }
    return;
  }
  const r = releaseGate;
  releaseGate = undefined;
  r?.();
});

const params = new URLSearchParams(location.search);
if (replayMode && params.has("replay")) void replay();

// ---- ranking (fastest passing candidate wins; mirrors the verifier's rule) ----

function rank(run: RunData): { html: string; winnerId?: string; loserIds: Set<string> } {
  if (run.mode === "live" && !["completed", "failed", "unknown"].includes(run.status))
    return { html: `<div class="headline none">${run.recommendedCandidateId ? `Verified recommendation: ${esc(run.recommendedCandidateId)}. Awaiting completion.` : "Verification pending; no candidate selected."}</div>`, loserIds: new Set() };
  const passing = run.verdicts
    .filter((v) => v.decision === "pass")
    .sort((a, b) => (a.recoveryMs ?? Infinity) - (b.recoveryMs ?? Infinity));
  const winner = run.mode === "live" ? passing.find((v) => v.candidateId === run.selectedCandidateId) : passing[0];
  const losers = run.verdicts.filter((v) => v !== winner);
  const loserIds = new Set(losers.filter((v) => v.decision !== "pass").map((v) => v.candidateId));

  const why = losers
    .map((v) => {
      if (v.decision === "pass") return `<li><b>${esc(v.candidateId)}</b> also went the distance, but was slower (${secs(v.recoveryMs)}).</li>`;
      const failed = v.checks.filter((c) => c.passed === false && CHECKS.find((k) => k.name === c.name)?.required);
      if (!failed.length) return `<li><b>${esc(v.candidateId)}</b> no decision: some rounds could not be judged.</li>`;
      const reasons = failed
        .map((c) => `KO on <code>${c.name}</code> — ${esc(lowerFirst(CHECKS.find((k) => k.name === c.name)?.guardsAgainst ?? ""))}`)
        .join("; ");
      return `<li><b>${esc(v.candidateId)}</b> eliminated: ${reasons}</li>`;
    })
    .join("");

  const headline = winner
    ? `<div class="headline win"><span class="belt-big">★</span><span><b>${esc(winner.candidateId)}</b> wins the bout — all ${CHECKS.length} gates, finish ${secs(winner.recoveryMs)}</span></div>`
    : `<div class="headline none"><span class="belt-big">✕</span><span>No verified recovery: no fighter won every round</span></div>`;
  return { html: `${headline}<ul class="why">${why}</ul>`, winnerId: winner?.candidateId, loserIds };
}

// ---- helpers ----

function pointsFor(candidateId: string): number {
  return verdictOf.get(candidateId)?.checks.filter((c) => c.passed === true).length ?? 0;
}

function secs(ms: number | undefined): string {
  return ms === undefined ? "n/a" : `${(ms / 1000).toFixed(1)}s`;
}

function clock(iso: string): string {
  return new Date(iso).toISOString().slice(11, 19);
}

function lowerFirst(s: string): string {
  return s ? s[0]!.toLowerCase() + s.slice(1) : s;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
