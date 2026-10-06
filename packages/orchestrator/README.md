# @awh/orchestrator

Works through `docs/quality-plan.md` with stateless Claude Code workers. The
schedule is computed by code, not by a model: the manifest says what depends on
what and which files each item writes, and the script runs whatever is ready.

```sh
pnpm orchestrate run --dry-run            # print the waves; spends nothing
pnpm orchestrate run --only L10a,L10b     # run some tasks
pnpm orchestrate run --trailer "Co-Authored-By: ..."
pnpm orchestrate propose                  # draft manifest entries for new plan items
```

Requires the `claude` CLI on `PATH`, signed in. Nothing is pushed: finished
tasks land as local commits on the current branch, one per task, and the run
report goes to `.claude/orchestrator/`.

## Pipeline

For each wave (tasks whose dependencies are integrated and whose write sets do
not overlap), up to `--concurrency` tasks run in parallel, each in its own git
worktree under `.claude/worktrees/`:

1. **Implement.** A fresh `claude -p` call gets the plan's ground rules and
   status notes, the item's text, its writable paths, and, on a revision, the
   previous rejection. It edits files but cannot commit.
2. **Scope check.** Any changed file outside the task's `writes` rejects the
   attempt.
3. **Checks.** The manifest's commands (build, lint, format, typecheck, tests)
   plus the task's `extraChecks`. A failure goes back to step 1 with its output.
4. **Evaluate.** A separate `claude -p` call, with read-only tools, reviews
   the diff against the item and a rubric (objective, logic, tests, security,
   performance, repository rules). Only findings marked blocking, which must
   quote code, cause a revision.
5. **Integrate.** Passed tasks are cherry-picked onto the current branch in
   manifest order, each as one commit carrying the worker's plan record.

The loop stops after `--max-revisions` revisions (default 3), when the same
blocking findings come back twice, or when the worker reports the item
blocked (it needs settings, secrets, or a decision). Failed worktrees are kept
for inspection; tasks that depend on a failed one are skipped.

## Design choices

- **Deterministic gates before the model.** Checks are cheaper and certain, so
  the evaluator only sees changes that already pass them and is told not to
  repeat what tools enforce.
- **Structured output, not parsed XML.** Prompts use XML tags to separate
  repository text from instructions, but verdicts come back through
  `--json-schema`. Pass/fail is derived from the findings, not from the
  model's `pass` field.
- **Workers are agents, calls are stateless.** Each item needs to read code
  and run tests, so a worker is a Claude Code session with tools, not one
  completion. Each call is a new process with session persistence off; the
  worktree carries state between revisions.
- **Least privilege.** `--permission-mode dontAsk` denies every tool use not
  in the allowlist in `src/run.ts`. Workers get the repository's own tooling;
  the evaluator gets read-only git. Each call has its own budget, and the
  run stops starting tasks past `--budget-usd`.
- **Plan records apply at integration.** Workers return the plan update
  instead of editing their item, so parallel workers never conflict on the
  plan. For an item split into several commits, only the last part's record
  is applied.

## Manifest

`tasks/quality-plan.json`. Top level: `setup` (commands that prepare a new
worktree), `checks` (commands every task must pass), and `tasks`:

| Field                  | Meaning                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `id`                   | Unique task id                                                                                   |
| `item`                 | Plan item id, when it differs from `id` (split items)                                            |
| `subject`              | Commit subject                                                                                   |
| `dependsOn`            | Task ids that must be integrated first                                                           |
| `writes`               | Files, or directories ending in `/`, the task may change                                         |
| `gate`                 | `agent` (default) or `human` for items an agent cannot do                                        |
| `setup`, `extraChecks` | Per-task additions to the manifest's lists                                                       |
| `note`                 | Shown to the worker and evaluator: which part of a split item this is, or why a human must do it |

A task whose plan item is marked `(done)` is skipped, so a run can be repeated
after fixing a failure.
