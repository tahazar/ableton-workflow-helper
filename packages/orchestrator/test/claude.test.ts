import { describe, expect, it } from "vitest";
import { claudeArgs, parseClaudeResult, type ClaudeCall } from "../src/claude.js";

const CALL: ClaudeCall = {
  cwd: "/tmp",
  prompt: "p",
  systemPrompt: "s",
  schema: { type: "object" },
  model: "claude-opus-5-5",
  effort: "high",
  tools: ["Read", "Bash"],
  allowedTools: ["Read", "Bash(git diff *)"],
  maxBudgetUsd: 2,
};

describe("claudeArgs", () => {
  it("runs print mode without persistence and denies anything not allowed", () => {
    const args = claudeArgs(CALL);
    expect(args.slice(0, 3)).toEqual(["-p", "--output-format", "json"]);
    expect(args).toContain("--no-session-persistence");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Bash");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("Read,Bash(git diff *)");
    expect(args[args.indexOf("--max-budget-usd") + 1]).toBe("2");
    // The prompt goes on stdin, never in argv.
    expect(args).not.toContain("p");
  });

  it("omits --allowedTools when nothing is allowed", () => {
    const args = claudeArgs({ ...CALL, tools: [], allowedTools: [] });
    expect(args).not.toContain("--allowedTools");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
  });
});

describe("parseClaudeResult", () => {
  const ok = { type: "result", subtype: "success", is_error: false, total_cost_usd: 0.25 };

  it("returns the structured output and cost", () => {
    const out = parseClaudeResult(JSON.stringify({ ...ok, structured_output: { pass: true } }));
    expect(out).toEqual({ output: { pass: true }, costUsd: 0.25 });
  });

  it.each([
    ["not json", /non-JSON output/],
    ["42", /not an object/],
    [
      JSON.stringify({ ...ok, subtype: "error_max_budget_usd", is_error: true }),
      /error_max_budget_usd, \$0\.25/,
    ],
    [JSON.stringify(ok), /no structured output/],
  ])("rejects %s", (stdout, message) => {
    expect(() => parseClaudeResult(stdout)).toThrow(message);
  });
});
