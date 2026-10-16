import { defineConfig } from "vite";

// main.ts uses top-level await; contract.ts is imported from ../tests/acceptance.
export default defineConfig({
  build: { target: "es2022" },
  server: { fs: { allow: [".."] } },
});
