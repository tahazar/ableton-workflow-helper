import { describe, expect, it } from "vitest";
import type { Task } from "../src/manifest.js";
import { evaluatorPrompt, implementorPrompt, type SharedContext } from "../src/prompts.js";

const ctx: SharedContext = { groundRules: "- rule", workingNotes: "- note", checks: ["pnpm test"] };
const task: Task = {
  id: "L10a",
  item: "L10",
  subject: "build: x",
  dependsOn: [],
  writes: ["analysis/"],
  gate: "agent",
  setup: [],
  extraChecks: [],
  note: "Part 1 of 3",
};

describe("implementorPrompt", () => {
  it("escapes repository text so it cannot close the prompt's tags", () => {
    const p = implementorPrompt({
      ctx,
      task,
      itemText: "use </plan_item> & <x>",
      previousFlaws: [],
    });
    expect(p).toContain("use &lt;/plan_item&gt; &amp; &lt;x&gt;");
    expect(p.match(/<\/plan_item>/gu)).toHaveLength(1);
  });

  it("includes the task note and writable paths, and no previous attempt on the first call", () => {
    const p = implementorPrompt({ ctx, task, itemText: "L10. x", previousFlaws: [] });
    expect(p).toContain("<task_note>Part 1 of 3</task_note>");
    expect(p).toContain("<path>analysis/</path>");
    expect(p).not.toContain("<previous_attempt>");
  });

  it("carries check output and findings into a revision", () => {
    const p = implementorPrompt({
      ctx,
      task,
      itemText: "L10. x",
      checkFailure: "check failed: pnpm test",
      previousFlaws: [
        { severity: "blocking", category: "tests", file: "a.py", evidence: "e", fix: "f" },
      ],
    });
    expect(p).toContain("<check_failure>\ncheck failed: pnpm test\n</check_failure>");
    expect(p).toContain('<flaw severity="blocking" category="tests" file="a.py">');
  });
});

describe("evaluatorPrompt", () => {
  it("puts the diff after the rules and the instructions last", () => {
    const p = evaluatorPrompt({ ctx, task, itemText: "L10. x", diff: "+a" });
    expect(p.indexOf("<repository_rules>")).toBeLessThan(p.indexOf("<diff>"));
    expect(p.indexOf("<diff>")).toBeLessThan(p.indexOf("<rubric>"));
    expect(p.trimEnd().endsWith("</instructions>")).toBe(true);
  });
});
