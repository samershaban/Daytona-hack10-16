import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { JsonlStore } from "./store/jsonl.ts";
import { MemoryStore } from "./store/memory.ts";
import type { Store } from "./store/store.ts";

async function openStore(): Promise<Store> {
  const kind = process.env.STORE ?? "memory";
  if (kind === "memory") return new MemoryStore();
  if (kind === "jsonl")
    return JsonlStore.open(process.env.JSONL_PATH ?? fileURLToPath(new URL("../../../.data/api.jsonl", import.meta.url)));
  throw new Error(`unknown STORE=${kind} (expected memory | jsonl)`);
}

const store = await openStore();
const port = Number(process.env.PORT ?? 4000);
const server = serve({ fetch: createApp(store).fetch, port, hostname: process.env.HOST ?? "0.0.0.0" }, (info) =>
  console.log(`RestoreLab API on http://localhost:${info.port} (store: ${store.name})`),
);

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => server.close(async () => { await store.close(); process.exit(0); }));
