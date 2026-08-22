import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Two patterns because this one config is loaded from two working
    // directories. `vitest run` at the repo root resolves the second; a
    // per-package run (`pnpm --filter @directory/core test`) has its cwd inside
    // the package, where only the first matches. Without the first, a filtered
    // run finds zero test files and exits 1 — the package scripts look broken
    // to anyone who runs one.
    include: ["src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    environment: "node",
    // Tests must never reach the network. A test that needs an API response
    // uses a recorded fixture from fixtures/ instead — CI never spends credits.
    testTimeout: 5_000,
  },
});
