import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Prints once per run why the "integ:" tests skip; see test/analysis-venv.ts.
    globalSetup: ["test/global-setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text", "json-summary"],
      // Floors only go up; see docs/quality-plan.md. Re-based when tests
      // started running index.ts in-process (quality plan item 7): its
      // functions and branches had not been counted at all before.
      thresholds: { lines: 51, branches: 78, functions: 80, statements: 51 }, // groundwork-allow: re-based on the true index.ts measurement
    },
  },
});
