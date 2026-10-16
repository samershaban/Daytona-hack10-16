/**
 * Helpers for wrapping RestoreLab steps (inspector, recovery agents, verifier)
 * in OpenInference spans so Arize can group and evaluate them.
 */
import {
  OpenInferenceSpanKind,
  SemanticConventions,
} from "@arizeai/openinference-semantic-conventions";
import { context, SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";

const tracer = () => trace.getTracer("restorelab");

/** Correlation IDs attached to every span so traces join up with Run/Candidate records. */
export type RunContext = {
  runId: string;
  candidateId?: string;
  agentId?: string;
  sandboxId?: string;
};

export type SpanKind = "AGENT" | "CHAIN" | "TOOL" | "EVALUATOR";

/**
 * Run `fn` inside a span. Input/output are recorded as JSON so they show up in
 * Arize's span view. Errors mark the span failed and are re-thrown.
 */
export async function withSpan<T>(
  name: string,
  kind: SpanKind,
  ctx: RunContext,
  input: unknown,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer().startActiveSpan(name, async (span) => {
    span.setAttributes({
      [SemanticConventions.OPENINFERENCE_SPAN_KIND]: OpenInferenceSpanKind[kind],
      [SemanticConventions.INPUT_VALUE]: toJson(input),
      [SemanticConventions.INPUT_MIME_TYPE]: "application/json",
      ...runAttributes(ctx),
    });
    try {
      const result = await fn(span);
      span.setAttributes({
        [SemanticConventions.OUTPUT_VALUE]: toJson(result),
        [SemanticConventions.OUTPUT_MIME_TYPE]: "application/json",
      });
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Wrap one recovery-agent investigation (one candidate branch). */
export const traceAgent = <T>(name: string, ctx: RunContext, input: unknown, fn: (s: Span) => Promise<T>) =>
  withSpan(`agent.${name}`, "AGENT", ctx, input, fn);

/** Wrap one allowlisted tool call (inspectFiles, checkBackup, runAllowedCommand, ...). */
export const traceTool = <T>(name: string, ctx: RunContext, input: unknown, fn: (s: Span) => Promise<T>) =>
  withSpan(`tool.${name}`, "TOOL", ctx, input, fn);

/** Wrap one verifier gate (db_integrity, data_freshness, api, login, browser). */
export const traceCheck = <T>(name: string, ctx: RunContext, input: unknown, fn: (s: Span) => Promise<T>) =>
  withSpan(`verify.${name}`, "EVALUATOR", ctx, input, fn);

/** Trace ID of the active span — store it in CandidateResult.traceRefs. */
export function currentTraceId(): string | undefined {
  return trace.getSpan(context.active())?.spanContext().traceId;
}

function runAttributes(ctx: RunContext): Attributes {
  const attrs: Attributes = { "restorelab.run_id": ctx.runId };
  if (ctx.candidateId) attrs["restorelab.candidate_id"] = ctx.candidateId;
  if (ctx.agentId) attrs["restorelab.agent_id"] = ctx.agentId;
  if (ctx.sandboxId) attrs["restorelab.sandbox_id"] = ctx.sandboxId;
  // session.id groups every span of one run together in Arize's Sessions view.
  attrs[SemanticConventions.SESSION_ID] = ctx.runId;
  return attrs;
}

function toJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return String(value);
  }
}
