/**
 * One stateless model call through the Claude Code CLI in print mode. Each
 * call is a fresh process with session persistence off, so nothing carries
 * over between calls except what the prompt contains.
 */

import { spawn } from "node:child_process";

export interface ClaudeCall {
  cwd: string;
  prompt: string;
  systemPrompt: string;
  schema: object;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  /** Built-in tools the model can see, e.g. ["Read", "Edit", "Bash"]. */
  tools: string[];
  /** Permission rules that run without asking, e.g. "Bash(pnpm test)". */
  allowedTools: string[];
  maxBudgetUsd: number;
}

export interface ClaudeResult<T> {
  output: T;
  costUsd: number;
}

export type ClaudeRunner = <T>(call: ClaudeCall) => Promise<ClaudeResult<T>>;

export function claudeArgs(call: ClaudeCall): string[] {
  return [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(call.schema),
    "--model",
    call.model,
    "--effort",
    call.effort,
    "--append-system-prompt",
    call.systemPrompt,
    "--no-session-persistence",
    // Anything not in allowedTools is denied rather than prompted for, since
    // no one is there to answer.
    "--permission-mode",
    "dontAsk",
    "--tools",
    call.tools.join(","),
    ...(call.allowedTools.length > 0 ? ["--allowedTools", call.allowedTools.join(",")] : []),
    "--max-budget-usd",
    String(call.maxBudgetUsd),
  ];
}

/** Parses the CLI's JSON result and returns the structured output. */
export function parseClaudeResult<T>(stdout: string): ClaudeResult<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`claude returned non-JSON output: ${stdout.slice(0, 500)}`, { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("claude returned a JSON value that is not an object");
  }
  const r = parsed as Record<string, unknown>;
  const cost = typeof r.total_cost_usd === "number" ? r.total_cost_usd : 0;
  if (r.is_error === true || r.subtype !== "success") {
    const detail = typeof r.result === "string" ? r.result : JSON.stringify(r.subtype);
    throw new Error(`claude call failed (${String(r.subtype)}, $${cost.toFixed(2)}): ${detail}`);
  }
  if (r.structured_output === undefined || r.structured_output === null) {
    throw new Error("claude call succeeded but returned no structured output");
  }
  return { output: r.structured_output as T, costUsd: cost };
}

/** Runs `claude -p`, passing the prompt on stdin to avoid argv size limits. */
export const runClaude: ClaudeRunner = <T>(call: ClaudeCall) =>
  new Promise<ClaudeResult<T>>((resolve, reject) => {
    const child = spawn("claude", claudeArgs(call), {
      cwd: call.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error) => reject(new Error("could not start claude", { cause: error })));
    child.on("close", (code) => {
      try {
        resolve(parseClaudeResult<T>(stdout));
      } catch (error) {
        const tail = stderr.trim().slice(-2000);
        reject(
          new Error(`claude exited with code ${code}${tail ? `: ${tail}` : ""}`, { cause: error }),
        );
      }
    });
    child.stdin.end(call.prompt);
  });
