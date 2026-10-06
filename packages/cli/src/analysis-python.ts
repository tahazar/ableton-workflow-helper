/**
 * Locate the Python interpreter and working directory for
 * `python -m awh_analysis <cmd>` (the venv at `<repo root>/.venv`,
 * overridable via `AWH_PYTHON`; see analysis/README.md). Every analysis-
 * engine call site uses this (mix/duck/ref/opmatch/drums mine in
 * src/index.ts, and `awh samples` in src/samples.ts). It lives in its own
 * module so samples.ts doesn't import the CLI entry point.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { findLibraryRoot } from "@awh/core";

export function analysisPython(): { python: string; cwd: string } {
  const root = dirname(findLibraryRoot());
  const venv = join(root, ".venv", "bin", "python");
  const python = process.env.AWH_PYTHON ?? (existsSync(venv) ? venv : "python3");
  return { python, cwd: join(root, "analysis") };
}
