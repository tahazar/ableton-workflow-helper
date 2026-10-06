import { describe, expect, it } from "vitest";
import { runTaskLoop, type LoopDeps } from "../src/loop.js";
import type { Task } from "../src/manifest.js";
import type { EvaluatorOutput, Flaw, ImplementorOutput } from "../src/prompts.js";

const TASK: Task = {
  id: "L10",
  item: "L10",
  subject: "build: x",
  dependsOn: [],
  writes: ["analysis/"],
  gate: "agent",
  setup: [],
  extraChecks: [],
};

const done: ImplementorOutput = {
  blocked: false,
  blocked_reason: "",
  summary: "did it",
  commit_body: "Body.",
  plan_record: "L10. x (done)",
};

const flaw = (severity: Flaw["severity"], file = "analysis/a.py"): Flaw => ({
  severity,
  category: "tests",
  file,
  evidence: "assert True",
  fix: "assert the value",
});

const verdict = (
  flaws: Flaw[],
  pass = flaws.every((f) => f.severity !== "blocking"),
): EvaluatorOutput => ({
  analysis: "",
  flaws,
  pass,
});

/** Scripted deps: each call takes the next scripted value. */
function fakeDeps(script: {
  implement?: ImplementorOutput[];
  files?: string[][];
  checks?: ({ command: string; output: string } | undefined)[];
  reviews?: EvaluatorOutput[];
}) {
  const calls: Parameters<LoopDeps["implement"]>[0][] = [];
  const next = <T>(list: T[] | undefined, fallback: T): T => list?.shift() ?? fallback;
  const deps: LoopDeps = {
    implement: (input) => {
      calls.push(input);
      return Promise.resolve(next(script.implement, done));
    },
    changedFiles: () => Promise.resolve(next(script.files, ["analysis/a.py"])),
    runChecks: () => Promise.resolve(script.checks?.shift()),
    evaluate: () => Promise.resolve(next(script.reviews, verdict([]))),
    log: () => {},
  };
  return { deps, calls };
}

describe("runTaskLoop", () => {
  it("passes on the first attempt and keeps minor findings", async () => {
    const { deps } = fakeDeps({ reviews: [verdict([flaw("minor")])] });
    const out = await runTaskLoop(TASK, deps, 3);
    expect(out).toMatchObject({ status: "passed", attempts: 1, minorFlaws: [flaw("minor")] });
  });

  it("feeds a failing check back and does not call the evaluator for it", async () => {
    let reviews = 0;
    const { deps, calls } = fakeDeps({ checks: [{ command: "pnpm test", output: "1 failed" }] });
    deps.evaluate = () => {
      reviews++;
      return Promise.resolve(verdict([]));
    };
    const out = await runTaskLoop(TASK, deps, 3);
    expect(out).toMatchObject({ status: "passed", attempts: 2 });
    expect(reviews).toBe(1);
    expect(calls[1]!.checkFailure).toBe("check failed: pnpm test\n1 failed");
  });

  it("rejects changes outside the writable paths before running checks", async () => {
    const { deps, calls } = fakeDeps({ files: [["analysis/a.py", "package.json"]] });
    deps.runChecks = () => Promise.reject(new Error("checks must not run on an out-of-scope diff"));
    const out = await runTaskLoop(TASK, deps, 0);
    expect(out).toEqual({
      status: "exhausted",
      attempts: 1,
      lastFailure: "scope check: changed files outside the writable paths: package.json",
    });
    expect(calls).toHaveLength(1);
  });

  it("routes blocking findings to the next attempt", async () => {
    const { deps, calls } = fakeDeps({ reviews: [verdict([flaw("blocking")]), verdict([])] });
    const out = await runTaskLoop(TASK, deps, 3);
    expect(out).toMatchObject({ status: "passed", attempts: 2 });
    expect(calls[0]!.previousFlaws).toEqual([]);
    expect(calls[1]!.previousFlaws).toEqual([flaw("blocking")]);
  });

  it("ignores pass=false when no finding is blocking", async () => {
    const { deps } = fakeDeps({ reviews: [verdict([flaw("minor")], false)] });
    expect((await runTaskLoop(TASK, deps, 3)).status).toBe("passed");
  });

  it("stops at once when the worker reports the item blocked", async () => {
    const { deps, calls } = fakeDeps({
      implement: [{ ...done, blocked: true, blocked_reason: "needs a secret" }],
    });
    expect(await runTaskLoop(TASK, deps, 3)).toEqual({
      status: "blocked",
      attempts: 1,
      reason: "needs a secret",
    });
    expect(calls).toHaveLength(1);
  });

  it("stops when the same blocking findings come back twice", async () => {
    const { deps, calls } = fakeDeps({
      reviews: [verdict([flaw("blocking")]), verdict([flaw("blocking")]), verdict([])],
    });
    const out = await runTaskLoop(TASK, deps, 5);
    expect(out).toMatchObject({ status: "stalled", attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it("gives up after the revision limit", async () => {
    const { deps, calls } = fakeDeps({
      reviews: [
        verdict([flaw("blocking", "a")]),
        verdict([flaw("blocking", "b")]),
        verdict([flaw("blocking", "c")]),
      ],
    });
    const out = await runTaskLoop(TASK, deps, 2);
    expect(out).toMatchObject({ status: "exhausted", attempts: 3 });
    expect(calls).toHaveLength(3);
  });
});
