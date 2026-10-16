# RestoreLab hackathon recovery runtime

VAmPI is the sole demo target. Scope: book BOLA at `GET /books/v1/{title}`.
Candidate A adds an explicit ownership guard; candidate B uses an owner-scoped
lookup. CrewAI must apply actual Python edits through bounded tools. Only the
vulnerable `get_by_title` branch in `api_views/books.py` may change. The existing
token validator, other routes, reference branch and global `vulnerable=1` remain protected.

## Offline checks

Use the existing Python 3.12 environment (CrewAI 1.15.28, Daytona 0.198.0):

```sh
agents/.venv/bin/python -m unittest discover -s agents/tests -v
agents/.venv/bin/python -m agents plan --target agents/targets/vampi.template.json
```

The template intentionally fails validation until measured inputs are supplied.
Nulls are missing values, not runnable defaults. See [handoff](targets/VAMPI_HANDOFF.md).
Offline doubles and constructing a CrewAI object do not establish live LLM or Daytona success.

## First live candidate

Fill an ignored `.data/vampi.json` from the template. Set `DAYTONA_API_KEY`,
`RESTORELAB_API_URL`, `RESTORELAB_MODEL` and its provider credential locally.
Credentials are not forwarded to the sandbox. The model provider must be configured
before running; a provider configuration error is a failed attempt, not a repair.

```sh
agents/.venv/bin/python -m agents create-run --target .data/vampi.json --target-url BASELINE_URL
# Samer's human approval interface approves scope; Mahmoud publishes the real finding/evidence.
agents/.venv/bin/python -m agents run --target .data/vampi.json --run-id RUN_ID --finding-id FINDING_ID --strategy guard
```

The runtime reads Samer's existing scope approval. It cannot manufacture approvals
or verifier verdicts. The HTTP adapter follows the current main-branch API
contract. It publishes candidates, evidence, findings and messages.
Its reported backend store comes from `/health`; a local JSONL ledger is debug-only.
The adapter still requires validation against Samer's running service.

After A publishes its handoff, run B from a second terminal, using A's printed
baseline evidence ID. B receives a new sandbox from the same snapshot and must
retrieve A's finding from the backend, cite it in a decision, then make its own patch:

```sh
agents/.venv/bin/python -m agents run --target .data/vampi.json --run-id RUN_ID --finding-id FINDING_ID --strategy scoped-query --previous-baseline-evidence BASELINE_EVIDENCE_ID
```

Hash equality covers measured artifacts only. Source/config, stopped SQLite bytes,
reset reproducibility, snapshot identity, separate sandbox IDs and absence of shared
volumes are checked. A failed invariant aborts the comparison. The snapshot needs
installed dependencies, Python, realpath and a `.pinned_sha` marker; no Git binary is
required. Named commands are trusted operator configuration, not model-provided shell.
The check action must be offline/read-only with the service stopped. Reset must restore
the canonical DB bytes and leave the service stopped. Readiness must check the running
service's JSON flag equals 1, not merely HTTP 200. Source AST restrictions are guardrails,
not a security boundary against arbitrary hostile Python.

## Hamza handoff and retention

The actual patch, baseline report, tool commands/results, evidence IDs, communication
references and deadline are published to the backend and `.data/agent-runtime/`.
Status remains `VERIFICATION_PENDING`; structural strategy checks and startup success
never establish PASS. Hamza uses authorized Daytona SDK access to the private sandbox
ID and port 5000. No signed preview tokens are put into messages.

Keep each CLI supervisor running until Hamza posts a verdict or the stated deadline
(default 60 minutes). It then requests deletion. Interrupted/failed invocations also
request deletion; coordinate inspection before stopping the CLI. Provider auto-stop
and auto-delete are fallback inactivity controls, not an absolute TTL if the supervisor
is killed. Cleanup requests are logged; deletion is not claimed confirmed without a
provider result. Hamza must finish inspection before posting any verdict, including
UNKNOWN. No automatic deployment or run completion occurs.
