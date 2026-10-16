/**
 * Sends one fake candidate run to Arize: agent span → tool span → verifier span.
 * No LLM call unless SMOKE_LLM=1 (then one Claude call, needs ANTHROPIC_API_KEY).
 * Run: npm run smoke
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const { initTracing, shutdownTracing, traceAgent, traceTool, traceCheck, currentTraceId } = await import(
  "./index.js"
);

initTracing({ serviceName: "evals-smoke" });

const ctx = { runId: `smoke-${Date.now()}`, candidateId: "A", agentId: "backup-first" };

const traceId = await traceAgent("recover", ctx, { hypothesis: "newest backup is corrupt" }, async () => {
  await traceTool("checkBackup", ctx, { file: "backup-latest.dump" }, async () => ({
    ok: false,
    reason: "pg_restore: unsupported version 1.15 in file header",
  }));

  if (process.env.SMOKE_LLM === "1") {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const msg = await new Anthropic().messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 60,
      messages: [{ role: "user", content: "In one sentence: what does a pg_restore version mismatch mean?" }],
    });
    console.log("Claude:", msg.content[0]?.type === "text" ? msg.content[0].text : msg.content[0]);
  }

  await traceCheck("api", ctx, { url: "/api/orders" }, async () => ({ verdict: "FAIL", observed: "500" }));
  return currentTraceId();
});

await shutdownTracing();
console.log(`Sent run ${ctx.runId}, trace ${traceId} — check project "${process.env.ARIZE_PROJECT_NAME ?? "restorelab"}" in app.arize.com`);
