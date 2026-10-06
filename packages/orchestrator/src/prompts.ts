/**
 * Prompt templates and output schemas for the three model calls. Every call
 * is stateless: it gets the shared context and its own objective, nothing
 * from earlier calls except the evaluator's findings on a revision.
 *
 * Conventions: long reference material first, the task last; XML tags
 * delimit inputs so the model can tell repository text from instructions;
 * each rule says why it exists so the model can apply it to cases the rule
 * does not name. Outputs are constrained by JSON Schema (`claude -p
 * --json-schema`), so there is no free-text verdict to parse.
 */

import type { Task } from "./manifest.js";

export interface SharedContext {
  /** Plan sections every worker needs: ground rules, working notes, checks. */
  groundRules: string;
  workingNotes: string;
  checks: string[];
}

export interface Flaw {
  severity: "blocking" | "minor";
  category: "objective" | "logic" | "tests" | "security" | "performance" | "rules" | "scope";
  file: string;
  evidence: string;
  fix: string;
}

const xmlEscape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function sharedContextXml(ctx: SharedContext): string {
  return [
    "<repository_rules>",
    "<ground_rules>",
    xmlEscape(ctx.groundRules),
    "</ground_rules>",
    "<working_notes>",
    xmlEscape(ctx.workingNotes),
    "</working_notes>",
    "<required_checks>",
    ...ctx.checks.map((c) => `<command>${xmlEscape(c)}</command>`),
    "</required_checks>",
    "</repository_rules>",
  ].join("\n");
}

/** The manifest's note: for a split item, which part this commit covers. */
function partXml(task: Task): string[] {
  return task.note === undefined ? [] : [`<task_note>${xmlEscape(task.note)}</task_note>`];
}

function flawsXml(flaws: Flaw[]): string {
  return flaws
    .map(
      (f) =>
        `<flaw severity="${f.severity}" category="${f.category}" file="${xmlEscape(f.file)}">\n` +
        `<evidence>${xmlEscape(f.evidence)}</evidence>\n<fix>${xmlEscape(f.fix)}</fix>\n</flaw>`,
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// Implementor

export const IMPLEMENTOR_SYSTEM = `You are running non-interactively inside a git worktree of this repository, started by a script. No person will read your messages or answer questions while you work, so make reasonable decisions yourself and report them in your structured output.

Your job is to complete exactly one item from the repository's quality plan, leaving the change uncommitted in the working tree. The script reviews the diff, runs the checks itself, and makes the commit; that is why you must not run git commit, git push, git stash, git checkout, or git reset. Do not rewrite your own item in docs/quality-plan.md either: return the record in plan_record and the script applies it, so parallel workers do not conflict on that file.

Stay inside the paths the task declares. The script rejects a diff that touches anything else, because other workers may be changing those files in parallel.

If the item cannot be completed from inside the repository (it needs repository settings, a secret, a paid service, or a decision the plan leaves open), set blocked to true, explain why in blocked_reason, and leave the working tree unchanged. A blocked report is a correct outcome; a change that only looks complete is not.`;

export function implementorPrompt(input: {
  ctx: SharedContext;
  task: Task;
  itemText: string;
  previousFlaws: Flaw[];
  checkFailure?: string;
}): string {
  const { ctx, task, itemText, previousFlaws, checkFailure } = input;
  const parts = [
    sharedContextXml(ctx),
    `<objective id="${xmlEscape(task.id)}">`,
    `<commit_subject>${xmlEscape(task.subject)}</commit_subject>`,
    `<plan_item>\n${xmlEscape(itemText)}\n</plan_item>`,
    ...partXml(task),
    `<writable_paths>\n${task.writes.map((w) => `<path>${xmlEscape(w)}</path>`).join("\n")}\n</writable_paths>`,
    "</objective>",
  ];
  if (checkFailure !== undefined || previousFlaws.length > 0) {
    parts.push(
      "<previous_attempt>",
      "The working tree holds your previous attempt. It was rejected for the reasons below. Fix every blocking item; address minor items only where the fix is small and inside the writable paths.",
    );
    if (checkFailure !== undefined) {
      parts.push(`<check_failure>\n${xmlEscape(checkFailure)}\n</check_failure>`);
    }
    if (previousFlaws.length > 0)
      parts.push(`<review_findings>\n${flawsXml(previousFlaws)}\n</review_findings>`);
    parts.push("</previous_attempt>");
  }
  parts.push(
    "<instructions>",
    "Follow task_note when present. If it says this commit covers one part of the item, do only that part; other commits do the rest.",
    "1. Read the plan item and the code it names before changing anything. Where the item gives counts or file names, re-measure them: the plan was written earlier and the code may have moved.",
    "2. Make the change the item describes, following the ground rules. A bug fix gets a test that fails before the fix and passes after it.",
    "3. Run every command in required_checks, plus any the item names, and fix what fails. Do not finish with a failing check.",
    "4. Write plan_record: the item rewritten as a record of what was found and decided, starting with the item id followed by a period and a space, marked (done) after the subject, in the plan's existing style and indentation.",
    "5. Write commit_body: two to five plain sentences on what changed and why, for the commit message.",
    "</instructions>",
  );
  return parts.join("\n");
}

export const IMPLEMENTOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["blocked", "blocked_reason", "summary", "commit_body", "plan_record"],
  properties: {
    blocked: { type: "boolean" },
    blocked_reason: { type: "string", description: "Empty unless blocked is true." },
    summary: { type: "string", description: "What changed and what the checks reported." },
    commit_body: { type: "string" },
    plan_record: {
      type: "string",
      description: "Ignored for every part of a split item except the last.",
    },
  },
} as const;

export interface ImplementorOutput {
  blocked: boolean;
  blocked_reason: string;
  summary: string;
  commit_body: string;
  plan_record: string;
}

// ---------------------------------------------------------------------------
// Evaluator

export const EVALUATOR_SYSTEM = `You are reviewing an uncommitted change in a git worktree, started by a script. You did not write the change and you have no stake in it passing. You can read files and run read-only git commands; you cannot edit anything.

The script has already run the build, lint, format, typecheck and test commands and they passed, so do not report anything those tools enforce. Your value is what they cannot see: whether the change does what its objective says, whether its tests would catch a regression, and whether it introduces a security or correctness problem.

Report a finding as blocking only when you can point to the file and quote the code that shows it. A suspicion you cannot support from the code is at most minor. The change passes when there are no blocking findings; minor findings are recorded but do not cause a revision.`;

export function evaluatorPrompt(input: {
  ctx: SharedContext;
  task: Task;
  itemText: string;
  diff: string;
}): string {
  const { ctx, task, itemText, diff } = input;
  return [
    sharedContextXml(ctx),
    `<objective id="${xmlEscape(task.id)}">`,
    `<commit_subject>${xmlEscape(task.subject)}</commit_subject>`,
    `<plan_item>\n${xmlEscape(itemText)}\n</plan_item>`,
    ...partXml(task),
    "</objective>",
    `<diff>\n${xmlEscape(diff)}\n</diff>`,
    "<rubric>",
    '<criterion name="objective">Every outcome the plan item requires is present, or, when task_note limits this commit to one part of the item, every outcome of that part. Something required and missing is blocking.</criterion>',
    '<criterion name="logic">The changed code is correct on its edge cases: empty input, missing files, error paths, and the failure signals the ground rules name. Read the surrounding code, not just the diff.</criterion>',
    '<criterion name="tests">New or changed tests assert behavior and would fail if that behavior changed. A test that asserts nothing meaningful, mocks the unit under test, or was weakened to make the change pass is blocking.</criterion>',
    '<criterion name="security">No new path lets untrusted input reach a shell, the filesystem outside the repository, or the network, and the localhost gateway keeps its loopback bind and Origin check. No secret or machine-specific path is committed.</criterion>',
    '<criterion name="performance">Only where it matters here: no quadratic work over audio buffers, sample libraries, or note lists, and no blocking calls added to the gateway request path.</criterion>',
    '<criterion name="rules">The ground rules and working notes are followed: fallbacks are logged and tested both ways, rethrown errors keep their cause, fixed delays carry a reason.</criterion>',
    "</rubric>",
    "<instructions>",
    "Work through each criterion, reading files as needed, and write your reasoning in analysis before the findings. Then list findings, most severe first. Set pass to true only when no finding is blocking.",
    "</instructions>",
  ].join("\n");
}

export const EVALUATOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["analysis", "flaws", "pass"],
  properties: {
    analysis: { type: "string" },
    flaws: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "category", "file", "evidence", "fix"],
        properties: {
          severity: { type: "string", enum: ["blocking", "minor"] },
          category: {
            type: "string",
            enum: ["objective", "logic", "tests", "security", "performance", "rules", "scope"],
          },
          file: { type: "string" },
          evidence: { type: "string", description: "Quoted code and the line it is on." },
          fix: { type: "string" },
        },
      },
    },
    pass: { type: "boolean" },
  },
} as const;

export interface EvaluatorOutput {
  analysis: string;
  flaws: Flaw[];
  pass: boolean;
}

// ---------------------------------------------------------------------------
// Orchestrator (manifest proposal)

export const ORCHESTRATOR_SYSTEM = `You turn the open items of a repository's quality plan into scheduling entries for a script. You do not implement anything. A person reviews your output before the script uses it, so mark uncertainty in the note field rather than guessing.`;

export function orchestratorPrompt(input: { plan: string; manifestJson: string }): string {
  return [
    `<quality_plan>\n${xmlEscape(input.plan)}\n</quality_plan>`,
    `<current_manifest>\n${xmlEscape(input.manifestJson)}\n</current_manifest>`,
    "<instructions>",
    "Propose one task entry for each open item (not marked done) that the current manifest lacks.",
    "- id: the item id exactly as it starts its line in the plan.",
    "- subject: the commit subject the plan gives. An item the plan says needs several commits becomes several entries with ids suffixed a, b, c, chained by dependsOn.",
    "- dependsOn: items that must land first, because the plan orders them or because the later item builds on files the earlier one creates.",
    "- writes: the smallest set of paths the item changes, as files or directories ending in a slash. Over-declaring serializes work; under-declaring makes the worker fail its scope check.",
    '- gate: "human" when the item needs repository settings, secrets, paid services, or an open decision; otherwise "agent". Give the reason in note.',
    "</instructions>",
  ].join("\n");
}

export const ORCHESTRATOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tasks"],
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "subject", "dependsOn", "writes", "gate", "note"],
        properties: {
          id: { type: "string" },
          subject: { type: "string" },
          dependsOn: { type: "array", items: { type: "string" } },
          writes: { type: "array", items: { type: "string" } },
          gate: { type: "string", enum: ["agent", "human"] },
          note: { type: "string" },
        },
      },
    },
  },
} as const;
