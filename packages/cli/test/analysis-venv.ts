import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The Python that the CLI's integration tests run the analysis engine with.
 * Tests that need it carry the `integ:` name prefix and skip when it is
 * missing; `global-setup.ts` prints why once per run, and CI sets
 * `AWH_REQUIRE_INTEG=1` so a missing interpreter fails there instead of
 * skipping.
 */

/** The repo-root venv that CONTRIBUTING.md builds. */
export const REPO_VENV_PYTHON = fileURLToPath(
  new URL("../../../.venv/bin/python", import.meta.url),
);

export type AnalysisPythonLookup =
  | { python: string; skipReason?: undefined }
  | { python?: undefined; skipReason: string };

/**
 * `AWH_PYTHON` wins, as it does in `src/analysis-python.ts`, and is taken as
 * given: a command name such as `python3` is valid there, so it is not
 * checked for existence. Otherwise the repo venv, if it has been built.
 */
export function resolveAnalysisPython(
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean,
): AnalysisPythonLookup {
  const override = env.AWH_PYTHON;
  if (override !== undefined) return { python: override };
  if (exists(REPO_VENV_PYTHON)) return { python: REPO_VENV_PYTHON };
  return {
    skipReason:
      `AWH_PYTHON is unset and ${REPO_VENV_PYTHON} does not exist; ` +
      "build the venv per CONTRIBUTING.md or set AWH_PYTHON",
  };
}

/**
 * The once-per-run report: silent when a Python was found, a warning when
 * the `integ:` tests will skip, and an error when `AWH_REQUIRE_INTEG=1`
 * says they must run.
 */
export function reportAnalysisPython(
  lookup: AnalysisPythonLookup,
  env: NodeJS.ProcessEnv,
  warn: (message: string) => void,
): void {
  if (lookup.skipReason === undefined) return;
  if (env.AWH_REQUIRE_INTEG === "1") {
    throw new Error(`AWH_REQUIRE_INTEG=1 but no analysis Python: ${lookup.skipReason}`);
  }
  warn(`Skipping "integ:" tests: ${lookup.skipReason}`);
}

const lookup = resolveAnalysisPython(process.env, existsSync);

export const hasAnalysisPython = lookup.python !== undefined;

/** For use inside `integ:` tests and hooks, which only run when it exists. */
export function analysisPythonPath(): string {
  if (lookup.python === undefined) {
    throw new Error(`no analysis Python: ${lookup.skipReason}`);
  }
  return lookup.python;
}
