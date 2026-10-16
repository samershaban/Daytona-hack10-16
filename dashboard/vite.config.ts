import { defineConfig } from "vite";

// Single-screen dashboard. main.ts uses top-level await; contract.ts is imported from
// ../tests/acceptance, so allow fs access to the parent. /api proxies to the RestoreLab API.
export default defineConfig({
  build: { target: "es2022" },
  server: {
    fs: { allow: [".."] },
    proxy: { "/api": { target: process.env.RESTORELAB_API_ORIGIN ?? "http://127.0.0.1:4000", rewrite: (p: string) => p.replace(/^\/api/, "") } },
  },
});
