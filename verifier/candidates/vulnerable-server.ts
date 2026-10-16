/**
 * Mahmoud's as-shipped vulnerable server, unmodified: imports his createApp()
 * and listens. (His own entry-point check compares import.meta.url with
 * `file://${process.argv[1]}`, which never matches on Windows, so this
 * launcher is also the way to start it there.)
 * Expected verdict: FAIL (exploit-closed, foreign-tenant-denied).
 */
import { createApp } from "../../fixture/src/server.js";

const port = Number(process.env.PORT ?? 3000);
createApp().listen(port, "127.0.0.1", () =>
  console.log(`RecordShop (vulnerable, as shipped) listening on http://127.0.0.1:${port}`),
);
