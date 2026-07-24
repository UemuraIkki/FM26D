import { defineConfig } from "vitest/config";

// Vite 5.4's builtin-module allowlist predates node:sqlite (Node 22.5+), so
// it tries to resolve it as an npm package instead of leaving it external.
// Tell both the dep optimizer and the SSR/test runtime to pass it straight
// through to Node.
export default defineConfig({
  optimizeDeps: {
    exclude: ["node:sqlite", "sqlite"],
  },
  ssr: {
    external: ["node:sqlite", "sqlite"],
  },
  test: {
    server: {
      deps: {
        external: [/^(node:)?sqlite$/],
      },
    },
  },
});
