import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text", "json-summary"],
      // Floors only go up; see docs/quality-plan.md.
      thresholds: { lines: 24, branches: 83, functions: 96, statements: 24 },
    },
  },
});
