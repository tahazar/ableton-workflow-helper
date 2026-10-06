import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { ClaudeCall, ClaudeRunner } from "../src/claude.js";
import { parseManifest } from "../src/manifest.js";
import { extractItem } from "../src/plan.js";
import {
  IMPLEMENTOR_SCHEMA,
  type EvaluatorOutput,
  type ImplementorOutput,
} from "../src/prompts.js";
import { openTasks, runOrchestrator, type RunOptions } from "../src/run.js";

const PLAN = `# Plan

## Status and handoff

- notes

## Ground rules for every commit

- rules

## Items

A. \`chore: Add a\`
   Create a.txt.
B. \`chore: Add b\`
   Create b.txt.
C. \`chore: Add c\`
   Create c.txt.
H. \`Settings\`
   Needs the owner.
`;

const MANIFEST = {
  setup: [],
  checks: ["true"],
  tasks: [
    { id: "A", subject: "chore: Add a", writes: ["a.txt"] },
    { id: "B", subject: "chore: Add b", writes: ["b.txt"], dependsOn: ["A"] },
    { id: "C", subject: "chore: Add c", writes: ["c.txt"] },
    { id: "H", subject: "Settings", gate: "human", note: "owner only" },
  ],
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "orch-"));
  git(repo, "init", "--quiet", "--initial-branch=main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "commit.gpgsign", "false");
  mkdirSync(join(repo, "docs"));
  writeFileSync(join(repo, "docs", "quality-plan.md"), PLAN);
  writeFileSync(join(repo, "manifest.json"), JSON.stringify(MANIFEST));
  writeFileSync(join(repo, ".gitignore"), ".claude/\n");
  git(repo, "add", "--all");
  git(repo, "commit", "--quiet", "--message", "init");
});

function options(over: Partial<RunOptions> = {}): RunOptions {
  return {
    repoRoot: repo,
    manifestPath: join(repo, "manifest.json"),
    maxRevisions: 1,
    concurrency: 2,
    budgetUsd: 10,
    implementorModel: "m",
    evaluatorModel: "m",
    trailers: ["Co-Authored-By: Test <t@example.com>"],
    dryRun: false,
    ...over,
  };
}

/** A fake model: the implementor writes the task's file, the evaluator decides via `review`. */
function fakeClaude(review: (call: ClaudeCall) => EvaluatorOutput): ClaudeRunner {
  const runner = (call: ClaudeCall): Promise<{ output: unknown; costUsd: number }> => {
    if (call.schema === IMPLEMENTOR_SCHEMA) {
      const id = /<objective id="([^"]+)">/u.exec(call.prompt)![1]!;
      writeFileSync(join(call.cwd, `${id.toLowerCase()}.txt`), `${id}\n`);
      const output: ImplementorOutput = {
        blocked: false,
        blocked_reason: "",
        summary: "",
        commit_body: `Adds ${id}.`,
        plan_record: `${id}. \`done\` (done)\n   Recorded ${id}.`,
      };
      return Promise.resolve({ output, costUsd: 1 });
    }
    return Promise.resolve({ output: review(call), costUsd: 0.5 });
  };
  // Callers pick T; this fake returns the shape the schema asks for.
  return runner as ClaudeRunner;
}

const pass = (): EvaluatorOutput => ({ analysis: "", flaws: [], pass: true });

describe("runOrchestrator", () => {
  it("dry run reports the schedule and changes nothing", async () => {
    const report = await runOrchestrator(options({ dryRun: true }), fakeClaude(pass));
    expect(report.waves).toEqual([["A", "C"], ["B"]]);
    expect(report.tasks).toEqual([{ id: "H", status: "human-gated", detail: "owner only" }]);
    expect(git(repo, "log", "--format=%s")).toBe("init\n");
  });

  it("integrates each task as one commit with its plan record and trailers", async () => {
    const report = await runOrchestrator(options(), fakeClaude(pass));
    expect(report.tasks.map((t) => [t.id, t.status])).toEqual([
      ["H", "human-gated"],
      ["A", "integrated"],
      ["C", "integrated"],
      ["B", "integrated"],
    ]);
    expect(report.costUsd).toBe(4.5);
    expect(git(repo, "log", "--format=%s", "-3")).toBe(
      "chore: Add b\nchore: Add c\nchore: Add a\n",
    );
    const head = git(repo, "log", "-1", "--format=%B");
    expect(head).toBe("chore: Add b\n\nAdds B.\n\nCo-Authored-By: Test <t@example.com>\n\n");
    expect(
      git(repo, "show", "--name-only", "--format=", "HEAD").trim().split("\n").toSorted(),
    ).toEqual(["b.txt", "docs/quality-plan.md"]);
    const plan = readFileSync(join(repo, "docs", "quality-plan.md"), "utf8");
    expect(extractItem(plan, "B")).toBe("B. `done` (done)\n   Recorded B.");
    expect(extractItem(plan, "H")).toBe("H. `Settings`\n   Needs the owner.");
    expect(existsSync(join(repo, ".claude", "worktrees", "orch-a"))).toBe(false);
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  it("keeps a failed task's worktree and skips what depends on it", async () => {
    const reject = (call: ClaudeCall): EvaluatorOutput =>
      call.cwd.endsWith("orch-a")
        ? {
            analysis: "",
            pass: false,
            flaws: [
              { severity: "blocking", category: "tests", file: "a.txt", evidence: "e", fix: "f" },
            ],
          }
        : pass();
    const report = await runOrchestrator(options(), fakeClaude(reject));
    const byId = Object.fromEntries(report.tasks.map((t) => [t.id, t]));
    expect(byId.A).toMatchObject({ status: "stalled", attempts: 2 });
    expect(existsSync(byId.A!.worktree!)).toBe(true);
    expect(byId.B).toEqual({ id: "B", status: "skipped-dependency" });
    expect(byId.C!.status).toBe("integrated");
  });

  it("refuses to start on a dirty working tree", async () => {
    writeFileSync(join(repo, "stray.txt"), "x");
    await expect(runOrchestrator(options(), fakeClaude(pass))).rejects.toThrow(
      /uncommitted changes/,
    );
  });
});

describe("openTasks", () => {
  it("drops done items and dependencies on them", () => {
    const plan = PLAN.replace("A. `chore: Add a`", "A. `chore: Add a` (done)");
    const tasks = openTasks(parseManifest(MANIFEST), plan);
    expect(tasks.map((t) => t.id)).toEqual(["B", "C", "H"]);
    expect(tasks[0]!.dependsOn).toEqual([]);
  });

  it("refuses a selection whose dependencies are neither done nor selected", () => {
    expect(() => openTasks(parseManifest(MANIFEST), PLAN, ["B"])).toThrow(/depends on A/);
  });
});
