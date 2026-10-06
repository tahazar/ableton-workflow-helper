import { describe, expect, it } from "vitest";
import {
  isFinalPart,
  isWritable,
  parseManifest,
  scheduleWaves,
  writesOverlap,
  type Task,
} from "../src/manifest.js";

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  item: id,
  subject: `chore: ${id}`,
  dependsOn: [],
  writes: [`${id}.txt`],
  gate: "agent",
  setup: [],
  extraChecks: [],
  ...over,
});

const ids = (waves: Task[][]) => waves.map((w) => w.map((t) => t.id));

describe("parseManifest", () => {
  const base = { checks: ["true"], tasks: [{ id: "A", subject: "chore: a", writes: ["a"] }] };

  it("fills defaults", () => {
    const m = parseManifest(base);
    expect(m.setup).toEqual([]);
    expect(m.tasks[0]).toEqual({
      id: "A",
      item: "A",
      subject: "chore: a",
      dependsOn: [],
      writes: ["a"],
      gate: "agent",
      setup: [],
      extraChecks: [],
    });
  });

  it.each([
    [{ ...base, checks: [] }, /checks must list/],
    [
      { ...base, tasks: [{ id: "A", subject: "s", writes: ["a"], extra: 1 }] },
      /unknown key "extra"/,
    ],
    [{ ...base, tasks: [{ id: "A", subject: "s" }] }, /must declare the paths/],
    [{ ...base, tasks: [{ id: "A", subject: "s", writes: ["a"], gate: "robot" }] }, /gate must be/],
    [
      { ...base, tasks: [{ id: "A", subject: "s", writes: ["a"], dependsOn: ["B"] }] },
      /unknown task B/,
    ],
    [{ ...base, tasks: [...base.tasks, ...base.tasks] }, /duplicate task id A/],
    [{ ...base, tasks: [{ id: "A", subject: "s", writes: "a" }] }, /writes must be an array/],
  ])("rejects %j", (raw, message) => {
    expect(() => parseManifest(raw)).toThrow(message);
  });

  it("lets a human-gated task omit writes", () => {
    const m = parseManifest({
      checks: ["true"],
      tasks: [{ id: "S1", subject: "s", gate: "human" }],
    });
    expect(m.tasks[0]!.gate).toBe("human");
  });
});

describe("write sets", () => {
  it("treats a trailing slash as a directory", () => {
    expect(isWritable("analysis/x.py", ["analysis/"])).toBe(true);
    expect(isWritable("analysis.py", ["analysis/"])).toBe(false);
    expect(isWritable("a/b", ["a/b"])).toBe(true);
    expect(writesOverlap(["analysis/"], ["analysis/pyproject.toml"])).toBe(true);
    expect(writesOverlap(["analysis/pyproject.toml"], ["analysis/"])).toBe(true);
    expect(writesOverlap(["a/"], ["ab/"])).toBe(false);
  });
});

describe("scheduleWaves", () => {
  it("runs independent tasks together and dependents after", () => {
    const { waves } = scheduleWaves([task("A"), task("B"), task("C", { dependsOn: ["A"] })]);
    expect(ids(waves)).toEqual([["A", "B"], ["C"]]);
  });

  it("separates tasks whose write sets overlap", () => {
    const { waves } = scheduleWaves([
      task("A", { writes: ["x/"] }),
      task("B", { writes: ["x/y"] }),
      task("C"),
    ]);
    expect(ids(waves)).toEqual([["A", "C"], ["B"]]);
  });

  it("holds back human-gated tasks and everything after them", () => {
    const { waves, blocked } = scheduleWaves([
      task("H", { gate: "human" }),
      task("A", { dependsOn: ["H"] }),
      task("B", { dependsOn: ["A"] }),
      task("C"),
    ]);
    expect(ids(waves)).toEqual([["C"]]);
    expect(blocked.map((t) => t.id)).toEqual(["H", "A", "B"]);
  });

  it("rejects a dependency cycle", () => {
    expect(() =>
      scheduleWaves([task("A", { dependsOn: ["B"] }), task("B", { dependsOn: ["A"] })]),
    ).toThrow(/dependency cycle/);
  });
});

describe("isFinalPart", () => {
  it("is false only for parts another part of the same item depends on", () => {
    const a = task("L10a", { item: "L10" });
    const b = task("L10b", { item: "L10", dependsOn: ["L10a"] });
    const other = task("L11", { dependsOn: ["L10b"] });
    expect(isFinalPart(a, [a, b, other])).toBe(false);
    expect(isFinalPart(b, [a, b, other])).toBe(true);
    expect(isFinalPart(other, [a, b, other])).toBe(true);
  });
});
