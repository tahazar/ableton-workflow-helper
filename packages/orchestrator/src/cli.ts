#!/usr/bin/env node
/**
 * awh-orchestrate: works through docs/quality-plan.md with stateless Claude
 * Code workers.
 *
 *   run      Implement open manifest tasks (use --dry-run to see the waves).
 *   propose  Ask the model for manifest entries for plan items the manifest
 *            lacks, written next to the manifest for a person to review.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runClaude } from "./claude.js";
import { git } from "./exec.js";
import { ORCHESTRATOR_SCHEMA, ORCHESTRATOR_SYSTEM, orchestratorPrompt } from "./prompts.js";
import { PLAN_PATH, runOrchestrator } from "./run.js";

const DEFAULT_MANIFEST = "packages/orchestrator/tasks/quality-plan.json";
const DEFAULT_MODEL = "claude-opus-5-5";

const USAGE = `usage: awh-orchestrate <run|propose> [options]

  --manifest <path>       task manifest (default ${DEFAULT_MANIFEST})
  --only <id,id>          run only these tasks
  --max-revisions <n>     revisions after the first attempt (default 3)
  --concurrency <n>       parallel workers per wave (default 2)
  --budget-usd <n>        stop starting tasks past this spend (default 50)
  --implementor-model <m> (default ${DEFAULT_MODEL})
  --evaluator-model <m>   (default ${DEFAULT_MODEL})
  --trailer <line>        append to every commit message (repeatable)
  --dry-run               print the schedule and exit`;

function positiveInt(value: string, name: string, min: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new Error(`--${name} must be an integer >= ${min}`);
  return n;
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      manifest: { type: "string", default: DEFAULT_MANIFEST },
      only: { type: "string" },
      "max-revisions": { type: "string", default: "3" },
      concurrency: { type: "string", default: "2" },
      "budget-usd": { type: "string", default: "50" },
      "implementor-model": { type: "string", default: DEFAULT_MODEL },
      "evaluator-model": { type: "string", default: DEFAULT_MODEL },
      trailer: { type: "string", multiple: true, default: [] },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  const command = positionals[0];
  if (values.help || (command !== "run" && command !== "propose")) {
    process.stdout.write(`${USAGE}\n`);
    return values.help ? 0 : 2;
  }
  const repoRoot = (await git(["rev-parse", "--show-toplevel"], process.cwd())).trim();
  const manifestPath = join(repoRoot, values.manifest);

  if (command === "propose") {
    const plan = await readFile(join(repoRoot, PLAN_PATH), "utf8");
    const result = await runClaude<{ tasks: unknown[] }>({
      cwd: repoRoot,
      prompt: orchestratorPrompt({ plan, manifestJson: await readFile(manifestPath, "utf8") }),
      systemPrompt: ORCHESTRATOR_SYSTEM,
      schema: ORCHESTRATOR_SCHEMA,
      model: values["implementor-model"],
      effort: "high",
      tools: [],
      allowedTools: [],
      maxBudgetUsd: 5,
    });
    const out = manifestPath.replace(/\.json$/u, ".proposed.json");
    await writeFile(out, `${JSON.stringify(result.output, null, 2)}\n`);
    process.stdout.write(
      `wrote ${out} ($${result.costUsd.toFixed(2)}); review it and merge entries by hand\n`,
    );
    return 0;
  }

  const budget = Number(values["budget-usd"]);
  if (!(budget > 0)) throw new Error("--budget-usd must be a positive number");
  const report = await runOrchestrator({
    repoRoot,
    manifestPath,
    ...(values.only ? { only: values.only.split(",").map((s) => s.trim()) } : {}),
    maxRevisions: positiveInt(values["max-revisions"], "max-revisions", 0),
    concurrency: positiveInt(values.concurrency, "concurrency", 1),
    budgetUsd: budget,
    implementorModel: values["implementor-model"],
    evaluatorModel: values["evaluator-model"],
    trailers: values.trailer,
    dryRun: values["dry-run"],
    log: (m) => process.stderr.write(`${m}\n`),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const ok = report.tasks.every((t) => t.status === "integrated" || t.status === "human-gated");
  return ok ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(
      `awh-orchestrate: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  },
);
