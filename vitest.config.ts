import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    environment: "node",
    // Tests must never reach the network. A test that needs an API response
    // uses a recorded fixture from fixtures/ instead — CI never spends credits.
    testTimeout: 5_000,
  },
});
