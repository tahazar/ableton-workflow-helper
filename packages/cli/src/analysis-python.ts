/**
 * Shared helper: locate the Python interpreter + working directory for
 * `python -m awh_analysis <cmd>` (the venv at `<repo root>/.venv`,
 * overridable via `AWH_PYTHON` — see analysis/README.md). Every analysis-
 * engine call site uses this (mix/duck/ref/opmatch/drums mine in
 * src/index.ts, and M11's `awh samples` in src/samples.ts) — split out so
 * samples.ts doesn't need to import the CLI entry point just for this.
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
