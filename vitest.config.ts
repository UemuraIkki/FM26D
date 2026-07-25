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
    // Excludes worktrees Claude Code agents create under .claude/ (e.g. for
    // isolated background tasks) — without this, a leftover worktree's own
    // copy of tests/ gets picked up and every test runs twice.
    exclude: ["**/node_modules/**", "**/.claude/**"],
    server: {
      deps: {
        external: [/^(node:)?sqlite$/],
      },
    },
  },
});
