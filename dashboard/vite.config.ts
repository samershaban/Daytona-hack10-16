import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// main.ts uses top-level await; contract.ts is imported from ../tests/acceptance.
export default defineConfig({
  build: { target: "es2022", rollupOptions: { input: {
    index: fileURLToPath(new URL("./index.html", import.meta.url)),
    arena: fileURLToPath(new URL("./arena.html", import.meta.url)),
  } } },
  server: { fs: { allow: [".."] }, proxy: { "/api": { target: process.env.RESTORELAB_API_ORIGIN ?? "http://127.0.0.1:4000", rewrite: (path: string) => path.replace(/^\/api/, "") } } },
});
