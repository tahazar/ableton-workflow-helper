/** Process helpers for git and the repository's check commands. */

import { spawn } from "node:child_process";

export interface ExecResult {
  code: number;
  output: string;
}

/** Runs a shell command and returns its exit code and combined output. */
export function sh(command: string, cwd: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", (error) => reject(new Error(`could not run: ${command}`, { cause: error })));
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

/** Runs git with arguments (no shell) and returns stdout; throws on failure. */
export function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error) => reject(new Error("could not start git", { cause: error })));
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`git ${args.join(" ")} failed (${code}): ${stderr.trim()}`));
    });
  });
}

/** Keeps the end of long output, where test runners print their failures. */
export function tail(output: string, maxChars = 8000): string {
  return output.length <= maxChars
    ? output
    : `[... ${output.length - maxChars} chars cut]\n${output.slice(-maxChars)}`;
}

export interface CheckFailure {
  command: string;
  output: string;
}

/** Runs commands in order and stops at the first failure. */
export async function runChecks(
  commands: string[],
  cwd: string,
): Promise<CheckFailure | undefined> {
  for (const command of commands) {
    const { code, output } = await sh(command, cwd);
    if (code !== 0) return { command, output: tail(output) };
  }
  return undefined;
}
