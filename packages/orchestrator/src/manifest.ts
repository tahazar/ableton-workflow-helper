/**
 * Task manifest: the machine-readable half of docs/quality-plan.md. The plan
 * stays the source of truth for what an item means; the manifest adds what
 * the scheduler needs (dependencies, files written, who can do it).
 */

export type Gate = "agent" | "human";

export interface Task {
  /** Unique task id; equals the plan item id unless the item is split. */
  id: string;
  /** Plan item id as it starts its line in the plan, e.g. "L10" or "5". */
  item: string;
  /** Conventional-commit subject for the item's single commit. */
  subject: string;
  dependsOn: string[];
  /**
   * Paths the item may change: exact files, or directories ending in "/".
   * Two tasks whose write sets overlap never run in the same wave, and a
   * worker that changes anything else fails the scope check.
   */
  writes: string[];
  /** "human" items need repository settings, secrets, or a decision. */
  gate: Gate;
  /** Commands run in the worktree after the manifest's setup. */
  setup: string[];
  /** Commands run in the worktree on top of the manifest's default checks. */
  extraChecks: string[];
  /**
   * For a split item, which part this commit covers; for a human-gated one,
   * why an agent cannot do it. Workers and the evaluator see it.
   */
  note?: string;
}

export interface Manifest {
  /** Commands that prepare a fresh worktree (dependencies, venv). */
  setup: string[];
  /** Commands every task must pass, run in order from the worktree root. */
  checks: string[];
  tasks: Task[];
}

function fail(message: string): never {
  throw new Error(`invalid manifest: ${message}`);
}

function stringArray(value: unknown, where: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    fail(`${where} must be an array of strings`);
  }
  return value;
}

function parseTask(raw: unknown, index: number): Task {
  if (typeof raw !== "object" || raw === null) fail(`tasks[${index}] must be an object`);
  const t = raw as Record<string, unknown>;
  const known = new Set([
    "id",
    "item",
    "subject",
    "dependsOn",
    "writes",
    "gate",
    "setup",
    "extraChecks",
    "note",
  ]);
  for (const key of Object.keys(t)) {
    if (!known.has(key)) fail(`tasks[${index}] has unknown key "${key}"`);
  }
  if (typeof t.id !== "string" || t.id === "")
    fail(`tasks[${index}].id must be a non-empty string`);
  const where = `task ${t.id}`;
  if (typeof t.subject !== "string" || t.subject === "") fail(`${where}: subject is required`);
  const gate = t.gate ?? "agent";
  if (gate !== "agent" && gate !== "human") fail(`${where}: gate must be "agent" or "human"`);
  if (t.note !== undefined && typeof t.note !== "string") fail(`${where}: note must be a string`);
  if (t.item !== undefined && (typeof t.item !== "string" || t.item === "")) {
    fail(`${where}: item must be a non-empty string`);
  }
  const task: Task = {
    id: t.id,
    item: typeof t.item === "string" ? t.item : t.id,
    subject: t.subject,
    dependsOn: stringArray(t.dependsOn, `${where}.dependsOn`),
    writes: stringArray(t.writes, `${where}.writes`),
    gate,
    setup: stringArray(t.setup, `${where}.setup`),
    extraChecks: stringArray(t.extraChecks, `${where}.extraChecks`),
  };
  if (typeof t.note === "string") task.note = t.note;
  if (task.gate === "agent" && task.writes.length === 0) {
    fail(`${where}: an agent task must declare the paths it writes`);
  }
  return task;
}

export function parseManifest(raw: unknown): Manifest {
  if (typeof raw !== "object" || raw === null) fail("root must be an object");
  const m = raw as Record<string, unknown>;
  if (!Array.isArray(m.tasks)) fail("tasks must be an array");
  const checks = stringArray(m.checks, "checks");
  if (checks.length === 0) fail("checks must list at least one command");
  const setup = stringArray(m.setup, "setup");
  const tasks = m.tasks.map((t, i) => parseTask(t, i));

  const ids = new Set<string>();
  for (const t of tasks) {
    if (ids.has(t.id)) fail(`duplicate task id ${t.id}`);
    ids.add(t.id);
  }
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (!ids.has(dep)) fail(`task ${t.id} depends on unknown task ${dep}`);
    }
  }
  return { setup, checks, tasks };
}

/** True when two write sets can touch the same file. */
export function writesOverlap(a: string[], b: string[]): boolean {
  const covers = (x: string, y: string) => x === y || (x.endsWith("/") && y.startsWith(x));
  return a.some((x) => b.some((y) => covers(x, y) || covers(y, x)));
}

/** True when `file` (repo-relative) is inside the write set. */
export function isWritable(file: string, writes: string[]): boolean {
  return writes.some((w) => w === file || (w.endsWith("/") && file.startsWith(w)));
}

/**
 * Orders agent tasks into waves. A task joins the earliest wave after all its
 * dependencies, unless its write set overlaps a task already in that wave, in
 * which case it moves to a later one. Manifest order breaks ties, so the
 * schedule is deterministic. Human-gated tasks, and everything that depends
 * on one, are returned separately and never scheduled.
 */
export function scheduleWaves(tasks: Task[]): { waves: Task[][]; blocked: Task[] } {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const blockedIds = new Set<string>();
  const isBlocked = (t: Task, seen: Set<string>): boolean => {
    if (t.gate === "human" || blockedIds.has(t.id)) return true;
    if (seen.has(t.id)) throw new Error(`dependency cycle through task ${t.id}`);
    seen.add(t.id);
    const blocked = t.dependsOn.some((d) => isBlocked(byId.get(d)!, seen));
    seen.delete(t.id);
    return blocked;
  };
  for (const t of tasks) if (isBlocked(t, new Set())) blockedIds.add(t.id);

  const waveOf = new Map<string, number>();
  const waves: Task[][] = [];
  const pending = tasks.filter((t) => !blockedIds.has(t.id));
  while (waveOf.size < pending.length) {
    const before = waveOf.size;
    for (const t of pending) {
      if (waveOf.has(t.id) || !t.dependsOn.every((d) => waveOf.has(d))) continue;
      let wave = Math.max(-1, ...t.dependsOn.map((d) => waveOf.get(d)!)) + 1;
      while (waves[wave]?.some((other) => writesOverlap(other.writes, t.writes))) wave++;
      (waves[wave] ??= []).push(t);
      waveOf.set(t.id, wave);
    }
    if (waveOf.size === before) throw new Error("dependency cycle among agent tasks");
  }
  return { waves, blocked: tasks.filter((t) => blockedIds.has(t.id)) };
}

/**
 * True when no other task for the same plan item depends on this one, so its
 * record may mark the item done. Earlier parts of a split item leave the plan
 * alone, otherwise the item would read as done before its last commit lands.
 */
export function isFinalPart(task: Task, tasks: Task[]): boolean {
  return !tasks.some(
    (t) => t.id !== task.id && t.item === task.item && t.dependsOn.includes(task.id),
  );
}
