/**
 * Arize AX tracing for RestoreLab. Call initTracing() once at process startup
 * (control-plane, agent workers, verifier) before making any LLM calls.
 */
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicInstrumentation } from "@arizeai/openinference-instrumentation-anthropic";
import { SEMRESATTRS_PROJECT_NAME } from "@arizeai/openinference-semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const ARIZE_ENDPOINT = "https://otlp.arize.com/v1/traces";

let provider: NodeTracerProvider | undefined;

export type TracingOptions = {
  /** Shows up as service.name, e.g. "control-plane", "agents", "verifier". */
  serviceName: string;
  /** Arize project; defaults to ARIZE_PROJECT_NAME or "restorelab". */
  projectName?: string;
};

export function initTracing(opts: TracingOptions): NodeTracerProvider {
  if (provider) return provider;

  const spaceId = requireEnv("ARIZE_SPACE_ID");
  const apiKey = requireEnv("ARIZE_API_KEY");

  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: opts.serviceName,
      [SEMRESATTRS_PROJECT_NAME]: opts.projectName ?? process.env.ARIZE_PROJECT_NAME ?? "restorelab",
      // Arize AX routes spans by model_id (= project name).
      model_id: opts.projectName ?? process.env.ARIZE_PROJECT_NAME ?? "restorelab",
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: ARIZE_ENDPOINT,
          headers: { space_id: spaceId, api_key: apiKey },
        }),
      ),
    ],
  });
  provider.register();

  // Auto-trace every Anthropic SDK call (prompt, response, tokens, latency).
  const anthropicInstrumentation = new AnthropicInstrumentation({ tracerProvider: provider });
  anthropicInstrumentation.manuallyInstrument(Anthropic);

  return provider;
}

/** Flush pending spans; call before a short-lived process exits. */
export async function shutdownTracing(): Promise<void> {
  await provider?.forceFlush();
  await provider?.shutdown();
  provider = undefined;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name} (see repo .env)`);
  return value;
}
