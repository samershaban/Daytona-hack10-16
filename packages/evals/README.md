# @restorelab/evals

Arize AX tracing for RestoreLab (Owner 4). Arize observes and scores; the verifier's deterministic checks remain the authority on pass/fail.

Needs `ARIZE_SPACE_ID`, `ARIZE_API_KEY` (and optionally `ARIZE_PROJECT_NAME`) in the environment.

```ts
import { initTracing, traceAgent, traceTool, traceCheck, currentTraceId } from "@restorelab/evals";

initTracing({ serviceName: "agents" }); // once, at startup, before creating Anthropic clients

const ctx = { runId, candidateId: "A", agentId: "backup-first", sandboxId };

await traceAgent("recover", ctx, { hypothesis }, async () => {
  await traceTool("checkBackup", ctx, { file }, () => checkBackup(file));
  // Anthropic SDK calls made here are traced automatically as child LLM spans.
  traceRefs.push(currentTraceId()!); // -> CandidateResult.traceRefs
});

await traceCheck("api", ctx, { url }, () => checkOrdersApi(url)); // verifier gates
```

All spans of a run share `session.id = runId`, so one run shows up as one session in Arize.

- `npm run smoke`: sends a fake agent → tool → verifier trace (no LLM call).
- `SMOKE_LLM=1 npm run smoke`: also makes one Claude call (needs `ANTHROPIC_API_KEY`).
- `npm run typecheck`
