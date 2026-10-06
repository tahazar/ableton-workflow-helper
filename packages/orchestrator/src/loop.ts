/**
 * The evaluator-optimizer loop for one task: implement, gate on the
 * repository's own checks, then on an independent review, and feed whatever
 * failed back into a fresh implementor call until it passes or the revision
 * limit is reached.
 *
 * Deterministic gates run before the evaluator because they are cheaper and
 * certain; the evaluator only sees changes that already build, lint and pass
 * their tests, and is told so.
 */

import { isWritable, type Task } from "./manifest.js";
import type { EvaluatorOutput, Flaw, ImplementorOutput } from "./prompts.js";

export interface LoopDeps {
  implement(input: { previousFlaws: Flaw[]; checkFailure?: string }): Promise<ImplementorOutput>;
  changedFiles(): Promise<string[]>;
  runChecks(): Promise<{ command: string; output: string } | undefined>;
  evaluate(): Promise<EvaluatorOutput>;
  log(message: string): void;
}

export type LoopOutcome =
  | { status: "passed"; attempts: number; result: ImplementorOutput; minorFlaws: Flaw[] }
  | { status: "blocked"; attempts: number; reason: string }
  | { status: "exhausted"; attempts: number; lastFailure: string }
  | { status: "stalled"; attempts: number; lastFailure: string };

/** Same blocking findings twice in a row means another round will not help. */
function fingerprint(flaws: Flaw[], checkFailure?: string): string {
  const blocking = flaws
    .filter((f) => f.severity === "blocking")
    .map((f) => `${f.category}|${f.file}`)
    .toSorted();
  return JSON.stringify({ blocking, check: checkFailure?.split("\n")[0] ?? null });
}

function describe(flaws: Flaw[], checkFailure?: string): string {
  if (checkFailure !== undefined) return checkFailure.split("\n")[0]!;
  return flaws
    .filter((f) => f.severity === "blocking")
    .map((f) => `${f.category} in ${f.file}: ${f.fix}`)
    .join("; ");
}

export async function runTaskLoop(
  task: Task,
  deps: LoopDeps,
  maxRevisions: number,
): Promise<LoopOutcome> {
  let flaws: Flaw[] = [];
  let checkFailure: string | undefined;
  let previous: string | undefined;

  for (let attempt = 1; attempt <= maxRevisions + 1; attempt++) {
    deps.log(attempt === 1 ? "implementing" : `revision ${attempt - 1} of ${maxRevisions}`);
    const result = await deps.implement({ previousFlaws: flaws, checkFailure });
    if (result.blocked)
      return { status: "blocked", attempts: attempt, reason: result.blocked_reason };

    flaws = [];
    checkFailure = undefined;
    const outside = (await deps.changedFiles()).filter((f) => !isWritable(f, task.writes));
    const failure = outside.length === 0 ? await deps.runChecks() : undefined;
    if (outside.length > 0) {
      checkFailure = `scope check: changed files outside the writable paths: ${outside.join(", ")}`;
    } else if (failure) {
      checkFailure = `check failed: ${failure.command}\n${failure.output}`;
    } else {
      const review = await deps.evaluate();
      // The schema cannot tie pass to the findings, so derive it here rather
      // than trust a pass that contradicts a blocking finding.
      const blocking = review.flaws.filter((f) => f.severity === "blocking");
      if (blocking.length === 0) {
        if (!review.pass)
          deps.log("evaluator reported pass=false with no blocking findings; treating as pass");
        return {
          status: "passed",
          attempts: attempt,
          result,
          minorFlaws: review.flaws.filter((f) => f.severity === "minor"),
        };
      }
      flaws = review.flaws;
    }

    deps.log(`rejected: ${describe(flaws, checkFailure)}`);
    const current = fingerprint(flaws, checkFailure);
    if (current === previous) {
      return { status: "stalled", attempts: attempt, lastFailure: describe(flaws, checkFailure) };
    }
    previous = current;
  }
  return {
    status: "exhausted",
    attempts: maxRevisions + 1,
    lastFailure: describe(flaws, checkFailure),
  };
}
