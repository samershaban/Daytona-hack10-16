// SurrealDB Agent Memory (Spectron) client: cross-run memory for the agents. Talks to the hosted
// MCP endpoint with JSON-RPC tools/call (the server is stateless, so no session handshake).
// The API's own store stays the source of truth; memory is best-effort and never blocks a write.

export type MemoryHit = Record<string, unknown>;

export interface AgentMemory {
  remember(text: string, labels: string[]): Promise<unknown>;
  recall(query: string, opts?: { labels?: string[]; k?: number }): Promise<unknown>;
}

export class AgentMemoryError extends Error {}

export class McpAgentMemory implements AgentMemory {
  private nextId = 1;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly infer: "full" | "none" = "full",
    private readonly timeoutMs = 30_000,
  ) {}

  /** null when AGENT_MEMORY_URL or AGENT_MEMORY_API_KEY is unset: memory is then disabled. */
  static fromEnv(): McpAgentMemory | null {
    const url = process.env.AGENT_MEMORY_URL, key = process.env.AGENT_MEMORY_API_KEY;
    if (!url || !key) return null;
    const infer = process.env.AGENT_MEMORY_INFER === "none" ? "none" : "full";
    return new McpAgentMemory(url.replace(/\/+(mcp)?\/?$/, ""), key, infer);
  }

  remember(text: string, labels: string[]) {
    return this.call("remember", { text, labels, infer: this.infer });
  }

  recall(query: string, opts: { labels?: string[]; k?: number } = {}) {
    return this.call("recall", { query, k: opts.k ?? 10, ...(opts.labels?.length && { labels: opts.labels }) });
  }

  private async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method: "tools/call", params: { name: tool, arguments: args } }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const raw = await res.text();
    if (!res.ok) throw new AgentMemoryError(`${tool}: HTTP ${res.status} ${raw.slice(0, 300)}`);
    // Streamable HTTP may answer as JSON or as an SSE stream carrying the JSON-RPC response.
    const json = raw.trimStart().startsWith("{") ? raw
      : raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).find((l) => l.includes('"jsonrpc"'));
    if (!json) throw new AgentMemoryError(`${tool}: empty response`);
    const msg = JSON.parse(json);
    if (msg.error) throw new AgentMemoryError(`${tool}: ${msg.error.message ?? JSON.stringify(msg.error)}`);
    const result = msg.result ?? {};
    if (result.isError) {
      const e = result.structuredContent?.error;
      throw new AgentMemoryError(`${tool}: ${e?.status ?? ""} ${e?.message ?? textOf(result) ?? "tool error"}`.trim());
    }
    if (result.structuredContent !== undefined) return result.structuredContent;
    const text = textOf(result);
    try { return text != null ? JSON.parse(text) : result; } catch { return text; }
  }
}

function textOf(result: any): string | undefined {
  return result?.content?.find?.((c: any) => c.type === "text")?.text;
}
