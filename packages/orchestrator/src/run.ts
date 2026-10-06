/**
 * Runs the open manifest tasks wave by wave. Within a wave, tasks run in
 * parallel in their own worktrees; finished tasks are then integrated onto
 * the current branch one at a time, in manifest order, each as one commit
 * that also carries its plan record. Nothing is pushed.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runClaude, type ClaudeRunner } from "./claude.js";
import { git, runChecks, sh, tail } from "./exec.js";
import { runTaskLoop, type LoopOutcome } from "./loop.js";
import { isFinalPart, parseManifest, scheduleWaves, type Manifest, type Task } from "./manifest.js";
import { applyRecord, extractItem, extractSection } from "./plan.js";
import {
  EVALUATOR_SCHEMA,
  EVALUATOR_SYSTEM,
  evaluatorPrompt,
  IMPLEMENTOR_SCHEMA,
  IMPLEMENTOR_SYSTEM,
  implementorPrompt,
  type EvaluatorOutput,
  type ImplementorOutput,
  type SharedContext,
} from "./prompts.js";
import {
  changedFiles,
  commitAll,
  createWorktree,
  removeWorktree,
  worktreeFor,
  workingDiff,
} from "./worktree.js";

export const PLAN_PATH = "docs/quality-plan.md";

export interface RunOptions {
  repoRoot: string;
  manifestPath: string;
  only?: string[];
  maxRevisions: number;
  concurrency: number;
  /** Stop starting new tasks once this much has been spent. */
  budgetUsd: number;
  implementorModel: string;
  evaluatorModel: string;
  /** Lines appended to every commit message, e.g. a Co-Authored-By trailer. */
  trailers: string[];
  dryRun: boolean;
  log?: (message: string) => void;
}

export type TaskStatus =
  | LoopOutcome["status"]
  | "integrated"
  | "conflict"
  | "skipped-dependency"
  | "skipped-budget"
  | "human-gated"
  | "error";

export interface TaskReport {
  id: string;
  status: TaskStatus;
  attempts?: number;
  detail?: string;
  commit?: string;
  costUsd?: number;
  worktree?: string;
}

export interface RunReport {
  startedAt: string;
  base: string;
  waves: string[][];
  tasks: TaskReport[];
  costUsd: number;
}

// Workers may edit files and run the repository's own tooling; everything
// else is denied because no one is there to approve it.
const IMPLEMENTOR_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash"];
const IMPLEMENTOR_ALLOWED = [
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "Bash(pnpm *)",
  "Bash(npx oxlint *)",
  "Bash(npx oxfmt *)",
  "Bash(cd *)",
  "Bash(.venv/bin/*)",
  "Bash(../.venv/bin/*)",
  "Bash(git diff *)",
  "Bash(git status *)",
  "Bash(git log *)",
  "Bash(git show *)",
  "Bash(ls *)",
  "Bash(wc *)",
];
const EVALUATOR_TOOLS = ["Read", "Glob", "Grep", "Bash"];
const EVALUATOR_ALLOWED = [
  "Read",
  "Glob",
  "Grep",
  "Bash(git diff *)",
  "Bash(git log *)",
  "Bash(git show *)",
  "Bash(git status *)",
];

const IMPLEMENTOR_CALL_BUDGET_USD = 10;
const EVALUATOR_CALL_BUDGET_USD = 3;

function isDone(plan: string, item: string): boolean {
  return extractItem(plan, item)?.split("\n")[0]?.includes("(done)") ?? false;
}

/** Drops finished items and dependencies on them, so the schedule covers open work only. */
export function openTasks(manifest: Manifest, plan: string, only?: string[]): Task[] {
  const byId = new Map(manifest.tasks.map((t) => [t.id, t]));
  const open = manifest.tasks.filter((t) => !isDone(plan, t.item));
  const selected = only ? open.filter((t) => only.includes(t.id)) : open;
  const selectedIds = new Set(selected.map((t) => t.id));
  for (const t of selected) {
    for (const dep of t.dependsOn) {
      if (!selectedIds.has(dep) && !isDone(plan, byId.get(dep)!.item)) {
        throw new Error(`task ${t.id} depends on ${dep}, which is neither done nor selected`);
      }
    }
  }
  return selected.map((t) => ({ ...t, dependsOn: t.dependsOn.filter((d) => selectedIds.has(d)) }));
}

export function sharedContext(plan: string, checks: string[]): SharedContext {
  const groundRules = extractSection(plan, "Ground rules for every commit");
  const workingNotes = extractSection(plan, "Status and handoff");
  if (groundRules === undefined || workingNotes === undefined) {
    throw new Error(`${PLAN_PATH} is missing its ground rules or status section`);
  }
  return { groundRules, workingNotes, checks };
}

interface Finished {
  task: Task;
  outcome: LoopOutcome;
  costUsd: number;
  commit?: string;
}

/** Spend for one task, kept outside it so a task that throws still reports its cost. */
interface Spend {
  usd: number;
}

async function runOneTask(
  task: Task,
  ctx: { opts: RunOptions; manifest: Manifest; plan: string; shared: SharedContext; base: string },
  claude: ClaudeRunner,
  spend: Spend,
): Promise<Finished> {
  const { opts, manifest, plan, shared, base } = ctx;
  const log = (m: string) => opts.log?.(`[${task.id}] ${m}`);
  const itemText = extractItem(plan, task.item);
  if (itemText === undefined)
    throw new Error(`task ${task.id}: item ${task.item} is not in ${PLAN_PATH}`);
  const wt = worktreeFor(opts.repoRoot, task.id);
  await createWorktree(opts.repoRoot, wt, base);
  const setupFailure = await runChecks([...manifest.setup, ...task.setup], wt.path);
  if (setupFailure)
    throw new Error(`worktree setup failed: ${setupFailure.command}\n${setupFailure.output}`);

  const checks = [...manifest.checks, ...task.extraChecks];
  const outcome = await runTaskLoop(
    task,
    {
      implement: async ({ previousFlaws, checkFailure }) => {
        const r = await claude<ImplementorOutput>({
          cwd: wt.path,
          prompt: implementorPrompt({ ctx: shared, task, itemText, previousFlaws, checkFailure }),
          systemPrompt: IMPLEMENTOR_SYSTEM,
          schema: IMPLEMENTOR_SCHEMA,
          model: opts.implementorModel,
          effort: "high",
          tools: IMPLEMENTOR_TOOLS,
          allowedTools: IMPLEMENTOR_ALLOWED,
          maxBudgetUsd: IMPLEMENTOR_CALL_BUDGET_USD,
        });
        spend.usd += r.costUsd;
        return r.output;
      },
      changedFiles: () => changedFiles(wt.path),
      runChecks: () => runChecks(checks, wt.path),
      evaluate: async () => {
        const r = await claude<EvaluatorOutput>({
          cwd: wt.path,
          prompt: evaluatorPrompt({
            ctx: shared,
            task,
            itemText,
            diff: await workingDiff(wt.path),
          }),
          systemPrompt: EVALUATOR_SYSTEM,
          schema: EVALUATOR_SCHEMA,
          model: opts.evaluatorModel,
          effort: "high",
          tools: EVALUATOR_TOOLS,
          allowedTools: EVALUATOR_ALLOWED,
          maxBudgetUsd: EVALUATOR_CALL_BUDGET_USD,
        });
        spend.usd += r.costUsd;
        return r.output;
      },
      log,
    },
    opts.maxRevisions,
  );
  if (outcome.status !== "passed") return { task, outcome, costUsd: spend.usd };
  const commit = await commitAll(
    wt.path,
    `${task.subject}\n\nworktree commit, replaced on integration`,
  );
  return { task, outcome, costUsd: spend.usd, commit };
}

/** Applies a passed task to the current branch as one commit with its plan record. */
async function integrate(f: Finished, opts: RunOptions, manifest: Manifest): Promise<TaskReport> {
  if (f.outcome.status !== "passed" || f.commit === undefined)
    throw new Error("integrate needs a passed task");
  const root = opts.repoRoot;
  const picked = await sh(`git cherry-pick --no-commit ${f.commit}`, root);
  if (picked.code !== 0) {
    await sh("git reset --merge", root);
    return {
      id: f.task.id,
      status: "conflict",
      detail: tail(picked.output, 2000),
      costUsd: f.costUsd,
    };
  }
  if (isFinalPart(f.task, manifest.tasks)) {
    const planPath = join(root, PLAN_PATH);
    const plan = await readFile(planPath, "utf8");
    await writeFile(planPath, applyRecord(plan, f.task.item, f.outcome.result.plan_record));
  }
  const message = [f.task.subject, "", f.outcome.result.commit_body.trim(), "", ...opts.trailers]
    .join("\n")
    .trim();
  const commit = await commitAll(root, message);
  await removeWorktree(root, worktreeFor(root, f.task.id));
  return {
    id: f.task.id,
    status: "integrated",
    attempts: f.outcome.attempts,
    commit,
    costUsd: f.costUsd,
  };
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

function failureReport(f: Finished, root: string): TaskReport {
  const o = f.outcome;
  const detail =
    o.status === "blocked" ? o.reason : o.status === "passed" ? undefined : o.lastFailure;
  const report: TaskReport = {
    id: f.task.id,
    status: o.status,
    attempts: o.attempts,
    costUsd: f.costUsd,
  };
  if (detail !== undefined) report.detail = detail;
  report.worktree = worktreeFor(root, f.task.id).path;
  return report;
}

export async function runOrchestrator(
  opts: RunOptions,
  claude: ClaudeRunner = runClaude,
): Promise<RunReport> {
  const log = opts.log ?? (() => {});
  const manifest = parseManifest(JSON.parse(await readFile(opts.manifestPath, "utf8")));
  const plan = await readFile(join(opts.repoRoot, PLAN_PATH), "utf8");
  const tasks = openTasks(manifest, plan, opts.only);
  const { waves, blocked } = scheduleWaves(tasks);
  const report: RunReport = {
    startedAt: new Date().toISOString(),
    base: (await git(["rev-parse", "HEAD"], opts.repoRoot)).trim(),
    waves: waves.map((w) => w.map((t) => t.id)),
    tasks: blocked.map((t) => ({
      id: t.id,
      status: "human-gated",
      detail: t.note ?? "depends on a human-gated task",
    })),
    costUsd: 0,
  };
  if (opts.dryRun) return report;
  if ((await git(["status", "--porcelain"], opts.repoRoot)).trim() !== "") {
    throw new Error("the working tree has uncommitted changes; commit or stash them first");
  }

  const shared = sharedContext(plan, manifest.checks);
  const failed = new Set<string>();
  for (const [i, wave] of waves.entries()) {
    log(`wave ${i + 1}: ${wave.map((t) => t.id).join(", ")}`);
    const runnable: Task[] = [];
    for (const t of wave) {
      if (t.dependsOn.some((d) => failed.has(d))) {
        failed.add(t.id);
        report.tasks.push({ id: t.id, status: "skipped-dependency" });
      } else if (report.costUsd >= opts.budgetUsd) {
        failed.add(t.id);
        report.tasks.push({ id: t.id, status: "skipped-budget" });
      } else runnable.push(t);
    }
    const base = (await git(["rev-parse", "HEAD"], opts.repoRoot)).trim();
    // Each task re-reads the plan at the wave's base so records from earlier waves are visible.
    const basePlan = await readFile(join(opts.repoRoot, PLAN_PATH), "utf8");
    const finished = await pool(runnable, opts.concurrency, async (t) => {
      const spend: Spend = { usd: 0 };
      try {
        return await runOneTask(t, { opts, manifest, plan: basePlan, shared, base }, claude, spend);
      } catch (error) {
        return { task: t, error, costUsd: spend.usd };
      }
    });
    for (const f of finished) {
      report.costUsd += f.costUsd;
      if ("error" in f) {
        failed.add(f.task.id);
        const detail = f.error instanceof Error ? f.error.message : String(f.error);
        log(`${f.task.id}: error (${detail.split("\n")[0]})`);
        const worktree = worktreeFor(opts.repoRoot, f.task.id).path;
        report.tasks.push({ id: f.task.id, status: "error", detail, costUsd: f.costUsd, worktree });
        continue;
      }
      const r =
        f.outcome.status === "passed"
          ? await integrate(f, opts, manifest)
          : failureReport(f, opts.repoRoot);
      if (r.status !== "integrated") failed.add(f.task.id);
      log(`${r.id}: ${r.status}${r.detail ? ` (${r.detail.split("\n")[0]})` : ""}`);
      report.tasks.push(r);
    }
  }

  const dir = join(opts.repoRoot, ".claude", "orchestrator");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `run-${report.startedAt.replaceAll(":", "-")}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}
