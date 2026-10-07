import { existsSync } from "node:fs";
import { reportAnalysisPython, resolveAnalysisPython } from "./analysis-venv.js";

/** Runs once per vitest run, so the skip reason prints once, not per file. */
export default function setup(): void {
  reportAnalysisPython(resolveAnalysisPython(process.env, existsSync), process.env, (message) =>
    console.warn(message),
  );
}
