# Ableton Workflow Helper

CLI-first Ableton Live workflow tools: TypeScript packages in `packages/`
(core, cli, extension, orchestrator), a Python analysis engine in
`analysis/`, and a knowledge base in `knowledge/`. `CONTRIBUTING.md` covers
setup; `docs/quality-plan.md` is the current work queue, and its "Status and
handoff" section is the place to start a session.

## Development pipeline

Features go through the dev-groundwork pipeline (plugin
`dev-groundwork@dev-groundwork`): requirements, research, design, acceptance
tests, implementation, review. Specs live in `docs/specs/<feature>/`; older
designs in `docs/design/` predate the pipeline. Skip the first three stages
only when the change fits in one sentence. Project rules for design review:
`.groundwork/project-rules.md`.

## Rules

- One logical change per commit, conventional-commit subject. Commits are
  authored as the owner, with no AI attribution or co-author trailers.
- Pull request descriptions, comments and reviews carry no AI attribution,
  session links or "Generated with" footers either. The repository is
  public, and GitHub keeps every edit of a description visible.
- A bug fix comes with a test that fails before the fix. A fix never
  loosens an existing assertion unless the commit says why it was wrong.
- Tests use fakes, not mocks: `awh serve-fake` and `fakeLiveBridge` for
  Live, real module code everywhere else. Mock only process boundaries and
  environment variables.
- Errors are specific. A rethrown error says which action failed and keeps
  the original as `cause`; "not found" and "already exists" are told apart
  from generic failures before anything treats them as normal.
- A fallback that stays gets a comment saying when it fires, a warn-level
  log, and tests for both directions.
- A fixed delay says what it waits for and why there is no signal instead.
- Comments explain why, not what. No commented-out code, unreachable code,
  or machine-specific paths.
- Coverage floors only go up.
- Only `packages/extension` imports the Ableton SDK. Nothing
  non-redistributable is committed (SDK files, Ableton docs, `.ablx`).

## Checks before every commit

```sh
pnpm build         # first: lint and typecheck resolve @awh/core via dist/*.d.ts
pnpm lint          # oxlint --type-aware --deny-warnings
pnpm fmt:check     # oxfmt; pnpm fmt to fix
pnpm typecheck
pnpm test
# when analysis/ changes:
cd analysis && ../.venv/bin/ruff check . && ../.venv/bin/ruff format --check . && ../.venv/bin/pytest -q
```

Review each commit in a fresh context (`/code-review high`, or
`/dev-groundwork:review` for a pipeline feature) against `REVIEW.md`.
