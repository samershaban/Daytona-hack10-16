/**
 * Usage: npm run verify -- --url http://127.0.0.1:5000 [--candidate A] [--run <runId>] [--no-trace]
 * Targets must be in ALLOWED_TARGETS (comma-separated; defaults to localhost:5000/5002).
 * The reference instance (:5001, vulnerable=0 oracle) is always refused.
 * Exit code: 0 pass, 1 fail, 2 unknown, 3 refused (out of scope), 4 refused (reference oracle), 64 bad usage.
 */
import { initTracing, shutdownTracing } from "@restorelab/evals";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { VAMPI_CONFIG } from "./identities.js";
import { runVerifier } from "./runVerifier.js";
import { publishResult } from "./publish.js";
import { assertInScope, OutOfScopeError, ReferenceTargetError } from "./scope.js";

loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    candidate: { type: "string", default: "local" },
    run: { type: "string" },
    api: { type: "string" },
    "no-trace": { type: "boolean", default: false },
  },
});

if (!values.url) {
  console.error("Usage: npm run verify -- --url <candidate base URL> [--candidate A] [--run <runId>] [--no-trace]");
  process.exit(64);
}
if (values.api && (!values.run || !values.candidate || values.candidate === "local")) {
  console.error("API publication requires --run and a real --candidate id");
  process.exit(64);
}

// Refuse before doing anything else (including starting tracing).
try {
  assertInScope(values.url);
} catch (err) {
  if (err instanceof ReferenceTargetError) {
    console.error(err.message);
    process.exit(4);
  }
  if (err instanceof OutOfScopeError) {
    console.error(err.message);
    process.exit(3);
  }
  throw err;
}

const tracing = !values["no-trace"] && Boolean(process.env.ARIZE_SPACE_ID && process.env.ARIZE_API_KEY);
if (tracing) initTracing({ serviceName: "verifier" });
else console.warn("Arize tracing off (--no-trace or ARIZE_* env vars missing).\n");

const result = await runVerifier(values.url, VAMPI_CONFIG, { candidateId: values.candidate, runId: values.run });
if (tracing) await shutdownTracing();
if (values.api) {
  await publishResult(values.api, result);
}

const { verdict, evidence } = result;
const byId = new Map(evidence.map((e) => [e.evidenceId, e]));
const label = (p: boolean | null) => (p === true ? "PASS" : p === false ? "FAIL" : "UNKNOWN");

console.log(`Candidate ${verdict.candidateId} @ ${values.url}  (run ${result.runId})\n`);
console.table(
  verdict.checks.map((c) => ({
    check: c.name,
    gate: byId.get(c.evidenceId)?.required ? "required" : "optional",
    result: label(c.passed),
    reason: byId.get(c.evidenceId)?.reason,
  })),
);
console.log(`\nDECISION: ${verdict.decision.toUpperCase()}`);
if (verdict.recoveryMs !== undefined) console.log(`recoveryMs: ${verdict.recoveryMs} (time to run all checks)`);
console.log(`Arize trace: ${result.traceId ?? "(none)"}`);
console.log("\nRaw JSON:");
console.log(JSON.stringify(result, null, 2));

process.exit(verdict.decision === "pass" ? 0 : verdict.decision === "fail" ? 1 : 2);
