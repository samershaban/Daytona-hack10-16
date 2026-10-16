/**
 * Incident command center view of the same run. Reads the same getRunData() and
 * the same contract check names as the default dashboard; only the visual
 * treatment changes. The default dashboard (index.html / main.ts) is untouched.
 */
import "./incident.css";
import { CHECKS } from "../tests/acceptance/contract.ts";
import { getRunData } from "./data.ts";
import type { AgentMessage, Candidate, Finding, RunData, RunStatus, Verdict } from "./types.ts";

const STAGES: { stage: string; label: string }[] = [
  { stage: "created", label: "Forked" },
  { stage: "experimenting", label: "Patching" },
  { stage: "verifying", label: "Validating" },
  { stage: "verdict", label: "Verdict" },
];

const STATUS_LABEL: Record<RunStatus, string> = {
  created: "Triaging",
  awaiting_scope_approval: "Awaiting authorization",
  investigating: "Investigating",
  experimenting: "Remediating",
  verifying: "Validating",
  completed: "Resolved",
  failed: "Failed",
  unknown: "Unknown",
};

type View = {
  status: RunStatus;
  feedShown: number;
  stage: Record<string, number>;
  cells: Set<string>;
  resolved: boolean;
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
const outcome = rank(data);

let view = fullView();
build();
apply();

// ---- build (once) ----

function build(): void {
  $("run-id").textContent = data.runId;
  $("incident").innerHTML = incidentHtml(data.findings[0]);

  $("tracks").innerHTML = data.candidates.map(trackHtml).join("");
  $("feed").innerHTML = feedItems.map(feedItemHtml).join("");

  const head = `<thead><tr><th class="gate-col">Gate</th>${data.candidates
    .map((c) => {
      const rejected = verdictOf.get(c.id)?.decision === "fail";
      return `<th class="track-head${rejected ? " rejected" : ""}">${esc(c.id)}${
        rejected ? `<span class="rej-tag">REJECTED</span>` : ""
      }</th>`;
    })
    .join("")}</tr></thead>`;
  const rows = CHECKS.map((check) => {
    const cells = data.candidates
      .map((c) => {
        const r = verdictOf.get(c.id)?.checks.find((x) => x.name === check.name);
        const state = r ? (r.passed === true ? "pass" : r.passed === false ? "fail" : "unknown") : "unknown";
        const culprit = state === "fail" && check.required && outcome.loserIds.has(c.id) ? " culprit" : "";
        const rejCol = verdictOf.get(c.id)?.decision === "fail";
        const glyph = state === "pass" ? "✓" : state === "fail" ? "✕" : "?";
        return `<td class="cell${rejCol ? " rej-col" : ""}" data-key="${esc(c.id)}|${check.name}"
          data-state="${state}${culprit}" data-tip="${esc(r?.evidenceId ?? "no evidence")}"><span>${glyph}</span></td>`;
      })
      .join("");
    return `<tr><th class="gate" title="${esc(check.description)}"><span>${esc(check.name)}</span>${
      check.required ? `<small class="req">required</small>` : `<small>advisory</small>`
    }</th>${cells}</tr>`;
  }).join("");
  $("gates").innerHTML = head + `<tbody>${rows}</tbody>`;

  $("resolution").innerHTML = outcome.html;
}

function incidentHtml(f: Finding | undefined): string {
  if (!f) return "";
  return `<div class="inc-left">
      <span class="sev-dot"></span>
      <div>
        <div class="inc-title">ACTIVE · Broken Object Level Authorization</div>
        <div class="inc-sub">${esc(f.observation)}</div>
      </div>
    </div>
    <div class="inc-meta">
      <div><span class="k">Class</span>${esc(f.category)} · WSTG-ATHZ-04</div>
      <div><span class="k">Target</span><code>${esc(f.targetScope)}</code></div>
      <div><span class="k">Detected</span>${clock(f.createdAt)} · by ${esc(f.author)}</div>
    </div>`;
}

function trackHtml(c: Candidate): string {
  const v = verdictOf.get(c.id);
  const events = data.timelines[c.id] ?? [];
  const steps = STAGES.map(({ stage, label }, i) => {
    const ev = events.find((e) => e.stage === stage);
    const tone = stage === "verdict" ? `tone-${v?.decision ?? "unknown"}` : "";
    const text = stage === "verdict" ? verdictDetail(v) : label;
    return `<li class="stp ${tone}" data-cid="${esc(c.id)}" data-i="${i}">
      <span class="node"></span><span class="stp-label">${esc(text)}</span>
      <time>${ev ? clock(ev.at) : ""}</time></li>`;
  }).join("");
  return `<div class="track" id="track-${esc(c.id)}">
    <div class="track-head">
      <span class="track-id">${esc(c.id)}</span>
      <span class="track-tag" data-decision="${v?.decision ?? "unknown"}"></span>
    </div>
    <div class="track-strategy">${esc(c.strategy)}</div>
    <div class="track-sandbox"><code>${esc(c.sandboxId)}</code>${c.patchRef ? ` · <code>${esc(c.patchRef)}</code>` : ""}</div>
    <ol class="stages">${steps}</ol>
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
  approve.textContent = view.approved ? "Containment authorized ✓" : "Authorize containment";

  const feed = $("feed");
  feed.querySelectorAll<HTMLElement>(".msg").forEach((el) => {
    el.classList.toggle("shown", Number(el.dataset.i) < view.feedShown);
  });
  feed.scrollTop = view.feedShown >= feedItems.length ? 0 : feed.scrollHeight;

  document.querySelectorAll<HTMLElement>(".stp").forEach((el) => {
    const reached = view.stage[el.dataset.cid!] ?? 0;
    const i = Number(el.dataset.i);
    el.classList.toggle("done", i < reached);
    el.classList.toggle("active", i === reached - 1 && i < STAGES.length - 1);
  });

  document.querySelectorAll<HTMLElement>(".cell").forEach((el) => {
    el.classList.toggle("revealed", view.cells.has(el.dataset.key!));
  });

  for (const c of data.candidates) {
    const decided = view.resolved;
    const tag = $(`track-${c.id}`).querySelector<HTMLElement>(".track-tag")!;
    const track = $(`track-${c.id}`);
    const v = verdictOf.get(c.id);
    const promoted = decided && outcome.winnerId === c.id;
    const rejected = decided && v?.decision === "fail";
    track.classList.toggle("promoted", promoted);
    track.classList.toggle("rejected", rejected);
    tag.textContent = promoted ? "PROMOTED" : rejected ? "REJECTED" : decided && v ? v.decision.toUpperCase() : "";
  }

  $("resolution").classList.toggle("shown", view.resolved);
}

// ---- views ----

function fullView(): View {
  return {
    status: data.status,
    feedShown: feedItems.length,
    stage: Object.fromEntries(data.candidates.map((c) => [c.id, STAGES.length])),
    cells: new Set(data.candidates.flatMap((c) => CHECKS.map((k) => `${c.id}|${k.name}`))),
    resolved: true,
    approved: true,
  };
}

function emptyView(): View {
  return {
    status: "created",
    feedShown: 0,
    stage: Object.fromEntries(data.candidates.map((c) => [c.id, 0])),
    cells: new Set(),
    resolved: false,
    approved: false,
  };
}

// ---- replay (~20s) ----

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
    step((v) => {
      v.status = "experimenting";
      for (const c of data.candidates) v.stage[c.id] = 1;
    });
    await sleep(1_300);
    step((v) => {
      for (const c of data.candidates) v.stage[c.id] = 2;
    });
    await sleep(1_600);
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

    await sleep(800);
    step((v) => {
      for (const c of data.candidates) v.stage[c.id] = STAGES.length;
    });
    await sleep(800);
    step((v) => {
      v.status = data.status;
      v.resolved = true;
    });
  } catch (err) {
    if (err !== CANCELLED) throw err;
  }
}

$("replay").addEventListener("click", () => void replay());
$("approve").addEventListener("click", () => {
  if (view.status !== "awaiting_scope_approval") return;
  const r = releaseGate;
  releaseGate = undefined;
  r?.();
});

const params = new URLSearchParams(location.search);
if (params.has("replay")) void replay();

// ---- resolution (fastest verified candidate is promoted; mirrors the verifier) ----

function rank(run: RunData): { html: string; winnerId?: string; loserIds: Set<string> } {
  const passing = run.verdicts
    .filter((v) => v.decision === "pass")
    .sort((a, b) => (a.recoveryMs ?? Infinity) - (b.recoveryMs ?? Infinity));
  const winner = passing[0];
  const losers = run.verdicts.filter((v) => v !== winner);
  const loserIds = new Set(losers.filter((v) => v.decision !== "pass").map((v) => v.candidateId));

  const why = losers
    .map((v) => {
      if (v.decision === "pass") return `<li><b>${esc(v.candidateId)}</b> also verified, but slower (${secs(v.recoveryMs)}).</li>`;
      const failed = v.checks.filter((c) => c.passed === false && CHECKS.find((k) => k.name === c.name)?.required);
      if (!failed.length) return `<li><b>${esc(v.candidateId)}</b> not verified: some gates could not run.</li>`;
      const reasons = failed
        .map((c) => `failed <code>${c.name}</code> — ${esc(lowerFirst(CHECKS.find((k) => k.name === c.name)?.guardsAgainst ?? ""))}`)
        .join("; ");
      return `<li><b>${esc(v.candidateId)}</b> rejected: ${reasons}</li>`;
    })
    .join("");

  const headline = winner
    ? `<div class="headline ok"><span class="rz">RESOLVED</span><span><b>${esc(winner.candidateId)}</b> promoted — verified fix, all ${CHECKS.length} gates · time-to-verified ${secs(winner.recoveryMs)}</span></div>`
    : `<div class="headline bad"><span class="rz bad">UNRESOLVED</span><span>No verified recovery — no track passed every gate</span></div>`;
  return { html: `${headline}<ul class="why">${why}</ul>`, winnerId: winner?.candidateId, loserIds };
}

// ---- helpers ----

function verdictDetail(v: Verdict | undefined): string {
  if (!v) return "no verdict";
  if (v.decision === "pass") return `VERIFIED · ${secs(v.recoveryMs)}`;
  if (v.decision === "unknown") return "UNKNOWN · gates could not run";
  const failed = v.checks.filter((c) => c.passed === false).map((c) => c.name);
  return `REJECTED · ${failed.join(", ")}`;
}

function secs(ms: number | undefined): string {
  return ms === undefined ? "n/a" : `${(ms / 1000).toFixed(1)}s`;
}

function clock(iso: string): string {
  return new Date(iso).toISOString().slice(11, 19) + "Z";
}

function lowerFirst(s: string): string {
  return s ? s[0]!.toLowerCase() + s.slice(1) : s;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
