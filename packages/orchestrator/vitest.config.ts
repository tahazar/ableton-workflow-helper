import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text", "json-summary"],
      // Floors only go up; see docs/quality-plan.md.
      thresholds: { lines: 82, branches: 87, functions: 92, statements: 82 },
    },
  },
});
