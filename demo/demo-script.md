# RestoreLab — 60–90s demo script

Talk track for presenting on the dashboard replay. Spoken lines are plain text;
**[stage directions]** are for the presenter. Total ≈ 75s.

Before you start: dashboard open at `http://localhost:5173/`, full screen (F11),
run showing the resting end state. Don't hit Replay until line 1 lands.

---

### 1 · The problem (~10s)

> "Autonomous agents can now patch security bugs on their own. The catch:
> you can't trust an agent to grade its own work. An agent that says 'fixed'
> is still just a claim."

**[click: Replay]** — the board resets to an empty, awaiting-approval run.

---

### 2 · The setup (~15s)

> "Our target is VAmPI, a real API with a real BOLA flaw: user B can read
> user A's private book — secret and all — just by asking for it by title.
> Our red-team agent reproduces it live and files the finding with the actual
> HTTP evidence."

**[point to: agent room, the red FINDING card as it appears]**
**[click: Approve scope]** when the button pulses amber — "An operator approves the drill. Humans stay in the loop."

---

### 3 · The core idea (~20s)

> "Two recovery agents each propose a fix, and each runs in its own isolated
> Daytona sandbox — same broken baseline, no shared state."

**[point to: the two candidate lanes advancing — Created → Experimenting → Verifying]**

> "Then the part that matters: an independent verifier runs seven acceptance
> checks against each candidate and decides pass or fail. The agents never
> touch the verdict — they cannot mark themselves verified."

**[point to: gate matrix cells filling in]**

---

### 4 · The money moment (~20s)

> "Watch candidate-b. It closed the exploit —"

**[point to: candidate-b's exploit-closed cell, green]**

> "— but it failed owner-read-preserved. Its fix was over-restrictive: it also
> blocked user A from reading their own book. A broken product, not a fix."

**[point to: candidate-b's red owner-read-preserved cell and the FAIL column header]**

> "The verifier caught it. A self-report never would have. candidate-a passes
> all seven gates in 3.8 seconds, so it wins."

**[point to: green winner banner — "candidate-a selected: passes all gates, 3.8s"]**

---

### 5 · Close (~10s)

> "Every check is traced in Arize, and every verdict is backed by the exact
> request and response. The decision is evidence, not vibes — proof that a fix
> actually works before it ever reaches production."

**[hold on the final board]**

---

## If asked

**How does the verifier stay independent, and is this live?** The verifier is a
separate service that only talks to a candidate over HTTP — it logs in fresh each
run, runs fixed acceptance checks, and computes pass/fail/unknown purely from the
responses; an agent's own claim is never an input, and a login or service failure
yields unknown, never pass. Live Daytona execution is wired end to end, but for a
reliable 75-second demo we present a seeded run so timing and network can't derail
it; we can trigger a live run on request, and the dashboard reads the same
`getRunData()` path either way.
