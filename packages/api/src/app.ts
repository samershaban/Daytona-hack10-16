import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { ApiError } from "./errors.ts";
import type { Env } from "./http.ts";
import { runs } from "./routes/runs.ts";
import { Service } from "./service.ts";
import type { Store } from "./store/store.ts";

export function createApp(store: Store) {
  const svc = new Service(store);
  return new Hono<Env>()
    .use(cors())
    .use(async (c, next) => { c.set("svc", svc); await next(); })
    .get("/health", (c) => c.json({ ok: true, store: store.name }))
    .route("/runs", runs)
    .notFound((c) => c.json({ error: "not_found", message: `${c.req.method} ${c.req.path} is not an endpoint` }, 404))
    .onError((err, c) => {
      if (err instanceof ApiError) return c.json({ error: err.code, message: err.message }, err.status);
      if (err instanceof SyntaxError) return c.json({ error: "invalid_json", message: err.message }, 400);
      if (err instanceof HTTPException) return err.getResponse();
      console.error(err);
      return c.json({ error: "internal", message: "internal error" }, 500);
    });
}
