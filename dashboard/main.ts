/**
 * Single-screen run view. The DOM is built once from getRunData(); a View
 * object says how much of it is revealed, so the replay just steps the View.
 */
import "./style.css";
import { CHECKS } from "../tests/acceptance/contract.ts";
import { getRunData } from "./data.ts";
import type { AgentMessage, Finding, RunData, RunStatus, Stage, Verdict } from "./types.ts";

const STAGES: { stage: Stage; label: string }[] = [
  { stage: "created", label: "Created" },
  { stage: "experimenting", label: "Experimenting" },
  { stage: "verifying", label: "Verifying" },
  { stage: "verdict", label: "Verdict" },
];

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

type View = {
  status: RunStatus;
  /** Number of feed items revealed. */
  feedShown: number;
  /** Per candidate: number of timeline stages reached (0–4). */
  stage: Record<string, number>;
  /** Revealed matrix cells, keyed `${candidateId}|${checkName}`. */
  cells: Set<string>;
  winner: boolean;
  approved: boolean;
};

type FeedItem = { kind: "finding"; at: string; finding: Finding } | { kind: "message"; at: string; message: AgentMessage };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const data = await getRunData();
const feedItems: FeedItem[] = [
  ...data.findings.map((f): FeedItem => ({ kind: "finding", at: f.createdAt, finding: f })),
  ...data.messages.map((m): FeedItem => ({ kind: "message", at: m.createdAt, message: m })),
].sort((a, b) => a.at.localeCompare(b.at));
const verdictOf = new Map(data.verdicts.map((v) => [v.candidateId, v]));
const outcome = rankCandidates(data);

let view = fullView();
build();
apply();

// ---- build (once) ----

function build(): void {
  $("run-id").textContent = data.runId;
  $("baseline").textContent = `baseline ${data.baseFixtureId}`;

  $("feed").innerHTML = feedItems.map(feedItemHtml).join("");

  $("lanes").innerHTML = data.candidates
    .map((c) => {
      const v = verdictOf.get(c.id);
      const events = data.timelines[c.id] ?? [];
      const steps = STAGES.map(({ stage, label }, i) => {
        const ev = events.find((e) => e.stage === stage);
        const detail = stage === "verdict" ? verdictDetail(v) : (ev?.detail ?? "");
        const tone = stage === "verdict" ? `tone-${v?.decision ?? "unknown"}` : "";
        return `<li class="step ${tone}" data-cid="${esc(c.id)}" data-i="${i}">
          <span class="dot"></span>
          <div class="step-text">
            <div class="step-name"><span>${label}</span><time>${ev ? clock(ev.at) : ""}</time></div>
            <div class="step-detail">${esc(detail)}</div>
          </div>
        </li>`;
      }).join("");
      return `<div class="lane">
        <div class="lane-head">
          <div class="cid">${esc(c.id)}</div>
          <div class="strategy">${esc(c.strategy)}</div>
          <div class="ids"><code>sandbox ${esc(c.sandboxId)}</code>${c.patchRef ? `<code>${esc(c.patchRef)}</code>` : ""}</div>
        </div>
        <ol class="steps">${steps}</ol>
      </div>`;
    })
    .join("");

  const head = `<thead><tr><th class="check-col">Check</th>${data.candidates
    .map((c) => `<th>${esc(c.id)}</th>`)
    .join("")}</tr></thead>`;
  const rows = CHECKS.map((check) => {
    const cells = data.candidates
      .map((c) => {
        const r = verdictOf.get(c.id)?.checks.find((x) => x.name === check.name);
        const state = r ? (r.passed === true ? "pass" : r.passed === false ? "fail" : "unknown") : "unknown";
        const culprit = state === "fail" && check.required && outcome.loserIds.has(c.id) ? " culprit" : "";
        const glyph = state === "pass" ? "✓" : state === "fail" ? "✕" : "?";
        return `<td class="cell" data-key="${esc(c.id)}|${check.name}" data-state="${state}${culprit}"
          data-tip="${esc(r?.evidenceId ?? "no evidence")}"><span>${glyph}</span></td>`;
      })
      .join("");
    return `<tr><th class="check" title="${esc(check.description)}">
      <span>${check.name}</span>${check.required ? "" : `<small>optional</small>`}</th>${cells}</tr>`;
  }).join("");
  $("matrix").innerHTML = head + `<tbody>${rows}</tbody>`;

  $("winner").innerHTML = outcome.html;
}

function feedItemHtml(item: FeedItem, i: number): string {
  if (item.kind === "finding") {
    const f = item.finding;
    return `<li class="msg kind-finding" data-i="${i}">
      <div class="meta"><span class="badge b-finding">finding</span><span class="from">${esc(f.author)}</span>
        <span class="ref">${esc(f.id)}</span><time>${clock(f.createdAt)}</time></div>
      <p class="body">${esc(f.observation)}</p>
      <div class="refs">${esc(f.category)} · ${f.evidenceIds.map(esc).join(" · ")}</div>
    </li>`;
  }
  const m = item.message;
  return `<li class="msg kind-${m.type}" data-i="${i}">
    <div class="meta"><span class="badge b-${m.type}">${m.type}</span><span class="from">${esc(m.from)}</span>
      <span class="to">→ ${esc(m.to)}</span><time>${clock(m.createdAt)}</time></div>
    <p class="body">${esc(m.body)}</p>
    ${m.findingIds.length ? `<div class="refs">cites ${m.findingIds.map(esc).join(", ")}</div>` : ""}
  </li>`;
}

// ---- apply (every view change) ----

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
  let lastShown: Element | undefined;
  feed.querySelectorAll<HTMLElement>(".msg").forEach((el) => {
    const shown = Number(el.dataset.i) < view.feedShown;
    el.classList.toggle("shown", shown);
    if (shown) lastShown = el;
  });
  lastShown?.scrollIntoView({ block: "nearest", behavior: "smooth" });

  document.querySelectorAll<HTMLElement>(".step").forEach((el) => {
    const reached = view.stage[el.dataset.cid!] ?? 0;
    const i = Number(el.dataset.i);
    el.classList.toggle("done", i < reached);
    el.classList.toggle("current", i === reached - 1 && i < STAGES.length - 1);
  });

  document.querySelectorAll<HTMLElement>(".cell").forEach((el) => {
    el.classList.toggle("revealed", view.cells.has(el.dataset.key!));
  });

  $("winner").classList.toggle("shown", view.winner);
}

// ---- views ----

function fullView(): View {
  return {
    status: data.status,
    feedShown: feedItems.length,
    stage: Object.fromEntries(data.candidates.map((c) => [c.id, STAGES.length])),
    cells: new Set(data.candidates.flatMap((c) => CHECKS.map((k) => `${c.id}|${k.name}`))),
    winner: true,
    approved: true,
  };
}

function emptyView(): View {
  return {
    status: "created",
    feedShown: 0,
    stage: Object.fromEntries(data.candidates.map((c) => [c.id, 0])),
    cells: new Set(),
    winner: false,
    approved: false,
  };
}

// ---- replay (demo fallback, ~20 s after scope approval) ----

const CANCELLED = Symbol("cancelled");
let replayToken = 0;
let releaseGate: (() => void) | undefined;

async function replay(): Promise<void> {
  const token = ++replayToken;
  const sleep = (ms: number) =>
    new Promise<void>((resolve, reject) =>
      setTimeout(() => (token === replayToken ? resolve() : reject(CANCELLED)), ms),
    );
  const step = (mutate: (v: View) => void) => {
    if (token !== replayToken) throw CANCELLED;
    mutate(view);
    apply();
  };

  view = emptyView();
  apply();
  try {
    await sleep(900);
    step((v) => (v.status = "awaiting_scope_approval"));
    // Human gate: the run does not continue until the operator approves scope.
    // ?autoapprove clicks it after 2 s, for unattended backup recordings only.
    await new Promise<void>((resolve) => {
      releaseGate = resolve;
      if (params.has("autoapprove")) setTimeout(() => $("approve").click(), 2_000);
    });
    step((v) => {
      v.approved = true;
      v.status = "investigating";
    });

    for (let i = 0; i < feedItems.length; i++) {
      await sleep(1_300);
      step((v) => (v.feedShown = i + 1));
    }

    await sleep(1_100);
    step((v) => {
      v.status = "experimenting";
      for (const c of data.candidates) v.stage[c.id] = 1;
    });
    await sleep(1_400);
    step((v) => {
      for (const c of data.candidates) v.stage[c.id] = 2;
    });
    await sleep(2_000);
    step((v) => {
      v.status = "verifying";
      for (const c of data.candidates) v.stage[c.id] = 3;
    });

    for (const check of CHECKS) {
      for (const c of data.candidates) {
        await sleep(300);
        step((v) => v.cells.add(`${c.id}|${check.name}`));
      }
    }

    await sleep(900);
    step((v) => {
      for (const c of data.candidates) v.stage[c.id] = STAGES.length;
    });
    await sleep(900);
    step((v) => {
      v.status = data.status;
      v.winner = true;
    });
  } catch (err) {
    if (err !== CANCELLED) throw err;
  }
}

$("replay").addEventListener("click", () => void replay());
$("approve").addEventListener("click", () => {
  if (view.status !== "awaiting_scope_approval") return;
  const release = releaseGate;
  releaseGate = undefined;
  release?.();
});

// ?replay starts the replay on load (kiosk / recording).
const params = new URLSearchParams(location.search);
if (params.has("replay")) void replay();

// ---- ranking (fastest passing candidate; mirrors the verifier's rule) ----

function rankCandidates(run: RunData): { html: string; loserIds: Set<string> } {
  const passing = run.verdicts
    .filter((v) => v.decision === "pass")
    .sort((a, b) => (a.recoveryMs ?? Infinity) - (b.recoveryMs ?? Infinity));
  const winner = passing[0];
  const losers = run.verdicts.filter((v) => v !== winner);
  const loserIds = new Set(losers.filter((v) => v.decision !== "pass").map((v) => v.candidateId));

  const why = losers
    .map((v) => {
      if (v.decision === "pass") return `<li><b>${esc(v.candidateId)}</b> also passed, but was slower (${secs(v.recoveryMs)}).</li>`;
      const failed = v.checks.filter((c) => c.passed === false && CHECKS.find((k) => k.name === c.name)?.required);
      if (!failed.length) return `<li><b>${esc(v.candidateId)}</b> not verified: some gates could not run.</li>`;
      const reasons = failed
        .map((c) => {
          const guard = CHECKS.find((k) => k.name === c.name)?.guardsAgainst ?? "";
          return `failed <code>${c.name}</code>: ${esc(lowerFirst(guard))}`;
        })
        .join("; ");
      return `<li><b>${esc(v.candidateId)}</b> rejected, ${reasons}</li>`;
    })
    .join("");

  const headline = winner
    ? `<div class="headline win"><span class="trophy">✓</span><span><b>${esc(winner.candidateId)}</b> selected: passes all gates, ${secs(winner.recoveryMs)}</span></div>`
    : `<div class="headline none"><span class="trophy">✕</span><span>No verified recovery: no candidate passed every gate</span></div>`;
  return { html: `${headline}<ul class="why">${why}</ul>`, loserIds };
}

// ---- helpers ----

function verdictDetail(v: Verdict | undefined): string {
  if (!v) return "no verdict";
  if (v.decision === "pass") return `PASS · ${secs(v.recoveryMs)}`;
  if (v.decision === "unknown") return "UNKNOWN · gates could not run";
  const failed = v.checks.filter((c) => c.passed === false).map((c) => c.name);
  return `FAIL · ${failed.join(", ")}`;
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
