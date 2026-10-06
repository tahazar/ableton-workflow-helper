/**
 * One git worktree per task, branched from the integration branch, so
 * parallel workers never see each other's files.
 */

import { join } from "node:path";
import { git } from "./exec.js";

export interface Worktree {
  path: string;
  branch: string;
}

/** `.claude/worktrees/` is already ignored by the repository. */
export function worktreeFor(repoRoot: string, taskId: string): Worktree {
  const slug = taskId.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-");
  return { path: join(repoRoot, ".claude", "worktrees", `orch-${slug}`), branch: `orch/${slug}` };
}

export async function createWorktree(repoRoot: string, wt: Worktree, base: string): Promise<void> {
  await git(["worktree", "add", "-B", wt.branch, wt.path, base], repoRoot);
}

export async function removeWorktree(repoRoot: string, wt: Worktree): Promise<void> {
  await git(["worktree", "remove", "--force", wt.path], repoRoot);
  await git(["branch", "-D", wt.branch], repoRoot);
}

/** Repo-relative paths changed in the worktree, including untracked files. */
export async function changedFiles(cwd: string): Promise<string[]> {
  const out = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd);
  const files: string[] = [];
  const entries = out.split("\0").filter(Boolean);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    files.push(entry.slice(3));
    // A rename's original path follows as its own entry; it changed too.
    if (entry[0] === "R" || entry[0] === "C") files.push(entries[++i]!);
  }
  return files.toSorted();
}

/** Full diff of the working tree against HEAD, new files included. */
export async function workingDiff(cwd: string): Promise<string> {
  await git(["add", "--intent-to-add", "--all"], cwd);
  return git(["diff", "HEAD"], cwd);
}

export async function commitAll(cwd: string, message: string): Promise<string> {
  await git(["add", "--all"], cwd);
  await git(["commit", "--quiet", "--message", message], cwd);
  return (await git(["rev-parse", "HEAD"], cwd)).trim();
}
