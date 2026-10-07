# Quality plan: CI, linting, and test coverage

Goal: every line of first-party code is exercised by a test that would fail
if the behavior changed, and every pull request is checked automatically
for build, test, coverage, lint, format, security, and risky-change
problems before it can merge. This document breaks the work into small
commits. Each item names its commit subject, scope, and the check that
proves it is done.

The test phases (0 to 6) build on each other. The CI tracks (L, S, G)
depend only on Phase 0 item 3 and can land in parallel with the test
phases.

## Status and handoff

Read this section first when starting a session. Update it in the same
commit that finishes an item.

- **Branch and PR:** merged to `main`: PR #13 (Phase 0, L1 to L10) on
  2026-10-06; PR #16 (dev-groundwork setup, G8), PR #15 (L11), PR #17
  (L16, G9 and G10 added to this plan), PR #18 (L12) and PR #19 (L16) on
  2026-10-07; PR #20 (L6b). Open: item 5 on branch
  `overnight/p1-05-venv-path` (#22), the first of an overnight stacked
  chain whose later PRs build on it; item 6 on
  `overnight/p1-06-cli-test-helpers`, stacked on #22. Start new work on a branch from the latest
  `main` and open a new pull request; one commit per item, pushed after
  each. CI must be green before merging. Check for open PRs on a branch
  before pushing to it; another session may be using it.
- **Commits:** authored as the owner, with no AI attribution or
  co-author trailers. Set `git config user.name`/`user.email` in a fresh
  clone before the first commit. Pull request descriptions, comments and
  reviews carry no AI attribution or session links either.
- **Pipeline:** new features go through the dev-groundwork plugin
  (`CLAUDE.md`, `.groundwork/`). Quality-plan items keep the loop below;
  they are small enough that the plan item is the spec. Install it once
  per machine with `claude plugin install dev-groundwork@dev-groundwork
  --scope project`. Its hooks run the checks before each commit and lock
  test files during implementation. Cloud sessions do not load it, so
  there the CI jobs, including "Groundwork checks", are the only gate.
  The workaround check flags new suppressions; an intended one carries
  `groundwork-allow: <reason>` on the same line.
- **Done:** Phase 0 items 1 to 4, Phase 1 items 5 and 6, L1 to L12, L6b, L16, G8.
- **Next:** Phase 1 item 7. L14, L15 and Phase 7 were added on 2026-10-06 from
  a review of agent-guardrail suggestions; L16, G9 and G10 on 2026-10-07
  from a review of sdras/awesome-actions.
- **Loop:** one session per item: do the item, run the checks below,
  commit, review the commit in a fresh context (below), fix blocking
  findings in a follow-up commit, update this section, push.
- **Orchestrator (parked):** `packages/orchestrator` can run batches of
  small, independent items (Phase 3 test files, Phase 6 coverage gaps)
  unattended. Not used for judgment-heavy items; its manifest is not kept
  in sync with this plan.
- **Merging:** use a merge commit, not squash or rebase, for any PR that
  adds a hash to `.git-blame-ignore-revs`; squash or rebase gives the
  commit a new hash and blame stops skipping it. The hashes listed today
  are the ones on `main`.
- **Not verified:** the repository-settings half of Phase 0 item 3 (branch
  protection on `main`), making L12's "Lint (oxlint, oxfmt, ruff,
  pyright)" job a required check, and S1 cannot be checked from a
  session; ask the owner.

Checks to run before every commit (all must pass):

```sh
pnpm build         # first: lint and typecheck resolve @awh/core via its dist/*.d.ts
pnpm lint          # oxlint --type-aware --deny-warnings
pnpm fmt:check     # oxfmt; run pnpm fmt to fix
pnpm typecheck     # src and test tsconfigs for core and cli; extension via the SDK shim
pnpm test
cd analysis && ../.venv/bin/ruff check . && ../.venv/bin/ruff format --check . \
  && ../.venv/bin/pytest -q --cov             # when analysis/ changes; ruff format . to fix
```

Review after every commit, in a fresh context so the reviewer is not
anchored on the author's reasoning: `/code-review high` on the new commit
(it runs as a subagent), or a new session given only the commit and
`REVIEW.md`. `REVIEW.md` holds the severity rules and repository checks.
Fix blocking findings before moving on; record nits that are not fixed.

Working notes from earlier items:

- Mark an item `(done)` in place and rewrite its text as a record of what
  was found and decided (counts, rules turned off and why). Put follow-ups
  that fall out of an item under "Cleanup found along the way".
- Before enabling a lint rule, measure it in isolation:
  `npx oxlint --type-aware -A all -W <plugin>/<rule> packages scripts`.
  After enabling one, prove it fires with a throwaway probe file and
  delete the probe before committing.
- Type-aware lint depends on `"types": ["node"]` in `tsconfig.base.json`
  and on `packages/{core,cli}/test/tsconfig.json`. Without them most types
  resolve to `error` and `no-unsafe-*` counts are noise. It also needs a
  built `packages/core/dist`: run `pnpm build` first, locally and in CI.
- `oxlint --fix` for `no-unnecessary-type-assertion` can leave unused type
  imports and redundant parentheses; lint again and tidy by hand.
- `packages/cli/assets/endless/player.js` is untyped browser JS shipped as
  a template; keep changes to it minimal and run the endless tests.

## Baseline (2026-10-06)

Measured with `@vitest/coverage-v8@2.1.9` (installed temporarily, not
committed) and `pytest-cov` against commit `54f1df7`:

| Package | Lines | Branches | Notes |
|---|---|---|---|
| `packages/core` | 90.7% | 83.8% | 450 tests |
| `packages/cli` | 22.5% | 83.9% | 176 pass, 14 skip; `index.ts` 0% |
| `analysis` | 75% | not measured | 189 tests; `__main__.py` 0% |
| `packages/extension` | none | none | no test suite |

The two 0% entry points are misleading. CLI tests spawn `dist/index.js` and
Python CLI tests call `subprocess.run`, so coverage never sees the child
process. Some of that code is exercised; none of it is measured. Phase 1
fixes the measurement before any coverage number is trusted.

Of the 79 `awh` commands, 69 have no test that invokes the command itself.
The logic behind some of them (endless, op, duck, layers, remote, samples)
is tested by importing modules directly, but argument parsing, output
formatting, and error paths in `index.ts` are not.

## Ground rules for every commit

- One logical change per commit, conventional-commit subject.
- A test added for a bug fix must fail before the fix and pass after.
- A fallback that stays gets a comment saying when it fires, a warn-level
  log, and tests pinning the trigger in both directions (fires on the
  failure signal, does not fire on an empty-but-valid result).
- Coverage thresholds only go up. Each phase ends by raising them to the
  new floor.
- No commented-out code, unreachable code, or hard-coded machine paths.
- A fixed delay (`setTimeout` sleep, `time.sleep`) carries a comment saying
  what it waits for and why there is no signal to wait on instead.
- A rethrown or wrapped error says which action failed and keeps the
  original as `cause`. A specific failure (not found, already exists) is
  told apart from a generic one before anything treats it as normal.

## Phase 0: tooling

1. `build: Add vitest coverage with v8 provider` (done)
   Add `@vitest/coverage-v8` (match vitest 2.1.x) as a root dev dependency,
   a `vitest.config.ts` per package with `include: ["src/**"]`, and a root
   `pnpm coverage` script. Done when `pnpm coverage` prints a table for
   core and cli.
2. `build: Add pytest-cov to analysis dev extras` (done)
   Add a `dev` extras group with `pytest` and `pytest-cov` to
   `analysis/pyproject.toml` (none exists today), and
   `--cov=awh_analysis --cov-report=term-missing` to the pytest config (or
   a documented command). Done when the coverage table prints from
   `analysis/`.
3. `ci: Run build, typecheck, and tests on pull requests` (done)
   No CI exists. Add `.github/workflows/ci.yml` triggered on `pull_request`
   and pushes to `main`, with a Node job (`pnpm install --frozen-lockfile`,
   `pnpm build`, `pnpm typecheck`, `pnpm coverage`) and a Python job (venv
   built per `analysis/README.md`, CLAP stubbed via `AWH_CLAP_STUB=1`).
   The extension cannot be bundled in CI because the Ableton SDK is not
   redistributable; its typecheck runs against
   `types/ableton-sdk-shim.d.ts`, so skip `build:extension`. Pin every
   action to a commit SHA. Then, in repository settings, protect `main`:
   require pull requests and require this workflow's jobs to pass.
4. `test: Enforce current coverage floors` (done)
   Set thresholds at the baseline (rounded down) so regressions fail the
   run. Raised at the end of each later phase.

## Track L: lint and format

Neither JavaScript nor Python has a linter or formatter today, so there is
nothing to migrate. Tools: oxlint (stable 1.x), oxfmt (pre-1.0, so pinned
exactly), and Ruff for Python.

Trial on 2026-10-06 with oxlint 1.87.0 over `packages/` and `scripts/`
(`dist/` excluded), findings per configuration:

| Configuration | Findings | Main rules hit |
|---|---|---|
| defaults (`correctness`) | 17 | `no-new-array` 12, `no-unused-vars` 2 |
| `-D suspicious` | 118 | `no-array-sort` 51, `consistent-function-scoping` 22, `no-shadow` 15, `preserve-caught-error` 8 |
| `--vitest-plugin` | 51 | `vitest/valid-expect` 27, `require-to-throw-message` 5, `no-conditional-expect` 2 |
| `-D perf` | 80 | `no-await-in-loop` 52 |
| `-D pedantic` | 1,020 | `require-unicode-regexp` 360, `no-inline-comments` 174, `max-lines-per-function` 128 |
| `--import-plugin -D import/no-cycle` | 0 new | |
| `--node-plugin`, `--promise-plugin`, `--jsdoc-plugin` | 0 or 1 new | |

oxfmt 0.72.0 with defaults reformats 77 of 106 files (about 4,000 changed
lines).

L1. `build: Add oxlint with default rules` (done)
    Add `oxlint` (exact version) as a root dev dependency, `.oxlintrc.json`,
    and `pnpm lint`. Fix the 17 default findings in the same commit. Done
    when `pnpm lint` exits 0.
L2. `build: Enable oxlint vitest plugin` (done)
    All 27 `valid-expect` findings were `expect(value, message)`, which
    vitest supports, so the rule is set to `maxArgs: 2` rather than
    rewriting the calls. The 5 `require-to-throw-message` findings now pin
    the expected error, and the 2 `no-conditional-expect` findings assert
    unconditionally.
L3. `build: Enable oxlint suspicious category` (done)
    Every flagged `.sort()` ran on a fresh copy, so the switch to
    `toSorted()` (TypeScript target raised to ES2023) changed no behavior.
    The 8 rethrows now pass the original error as `cause`, and the 15
    `no-shadow` hits were renamed (top-level commander groups gained the
    existing `Cmd` suffix). `consistent-function-scoping` (22 hits, all
    local helpers) and `no-underscore-dangle` (the deliberate
    `window.__endlessEngine` debug hook) are off.
L4. `build: Enforce SDK import boundary with oxlint` (done)
    ADR-001 says only `packages/extension` may import
    `@ableton-extensions/sdk`. `no-restricted-imports` blocks the package
    and its subpaths everywhere except `packages/extension/**`, and the
    `import` plugin now runs with `import/no-cycle` on. Both had 0
    findings; probe files confirmed each rule fires.
L5. `build: Add type-aware oxlint rules` (done)
    `oxlint-tsgolint` is pinned and `pnpm lint` runs `--type-aware`. The
    `npx` trial's `no-unsafe-*` noise had two causes: tsgolint follows
    TypeScript 7 and no longer loads `@types/*` implicitly (fixed with
    `"types": ["node"]` in `tsconfig.base.json`), and test files were in
    no tsconfig (fixed by the preceding `build: Typecheck test files`,
    which also found 16 real test type errors). Re-measured counts and
    outcomes:
    - `no-floating-promises`, `switch-exhaustiveness-check`: 0, on.
    - `await-thenable`: 1, a sync `initialize()` call. `no-misused-promises`:
      1, the endless player's async click handler, which left the button
      stuck on "Loading..." when start failed. Both fixed, both on.
    - `no-unnecessary-type-assertion`: 22, autofixed, on.
    - `no-unsafe-*`: 8 in `src/` (untyped `parseYaml` results, now
      `unknown`), on for `packages/*/src/**/*.ts`. Off elsewhere: tests
      use `JSON.parse` freely, and `cli/assets/` is untyped browser JS.
    - `no-unsafe-type-assertion` (283, the `JSON.parse(...) as T` and
      `catch` idiom), `restrict-template-expressions` (13, unvalidated
      values in error messages), and `consistent-return` (2, false
      positives after `never` and exhaustive switches): off.
    - `no-base-to-string`: 9, off for now; see the frontmatter item under
      "Cleanup found along the way".
L6. `build: Warn on long functions` (done)
    `pnpm lint` runs with `--deny-warnings`, so a warn-level rule is a
    hard limit, and the limit works as a ceiling that only goes down.
    `max-lines-per-function` is set to 150 (blank lines and comments not
    counted) for everything outside `packages/*/test/`. Test files are
    exempt because their long functions are `describe` callbacks.
    Measured in source: 42 functions over 60 lines, 21 over 80, 11 over
    100, 6 over 120, 2 over 150. The two over 150 carry an inline disable
    with a reason. `buildOpRegistry` in `core/src/bridge/ops.ts` (266) is
    a flat table of op definitions. The `mix records` action in
    `cli/src/index.ts` (188) is for Phase 4. Most of `index.ts` is
    module-level command registration, which this rule does not see, so
    each Phase 4 move should also lower the limit toward 100. The rest of
    `pedantic` and `perf` stays off. Most `no-await-in-loop` hits are
    intentional sequential gateway calls into Live, which must stay
    ordered.
L6b. `build: Ban any, ts-comments, TODOs, and unnecessary conditions` (done)
     Turn agent-prompt bans into lint rules, which bind where prose does
     not. Measured on 2026-10-06: `typescript/no-explicit-any` 10 (all in
     `cli/test/endless.test.ts`; type them), `typescript/ban-ts-comment` 0
     (allow `@ts-expect-error` with a description), `no-warning-comments`
     0 (TODO, FIXME), `no-empty` 0, and
     `typescript/no-unnecessary-condition` 11 (8 in `src/`; fix each, since
     a condition the types already decide is a defensive check that hides
     intent). `no-magic-numbers` (3,741) stays off: velocities, PPQ and
     beat counts are the domain, not magic.
     Counts matched on 2026-10-07. Four commits. Most of the 11 flagged
     conditions guarded values from outside the program (JSON, YAML
     frontmatter, gateway replies) whose casts dropped `null` or
     `undefined`, so the casts now say so and the checks stay; the samples
     index is parsed as `unknown` and narrowed. `applyResponseRecipe` is
     exported from `@awh/core`, so its unknown-name check stays, now as
     `Object.hasOwn`: the old lookup let `"constructor"` resolve to
     `Object.prototype.constructor` (a fix with a test). In `player.js` the
     `webkitAudioContext` fallback (Safari before 14.1, 2021) and the
     `crypto.getRandomValues` existence check went. The test file's `any`
     casts were not needed (the spec literal already types them) except
     the browser hook, now typed as `EndlessWindow`. Review nits not
     taken, both Phase 2 material: `loadSamplesIndex` rethrows bad JSON
     without `cause`, and `readMasterChainDevices` ends the walk on any
     error, not only "not found".
L7. `build: Add oxfmt pinned to 0.72.0` (done)
    `.oxfmtrc.json`, `pnpm fmt` and `pnpm fmt:check`, over `packages` and
    `scripts` (the same paths as lint). Exact version pin, because a
    pre-1.0 minor release can change output and fail CI on untouched
    files. Default options: print width 100 changes 81 files (+3,000
    / -1,281 lines), against 86 files at 90 and 97 files at 80. Markdown
    elsewhere is out of scope: `knowledge/` and `library/` hold
    executable `awh-*` blocks and generated `INDEX.md` files. The endless
    assets are formatted: all three template placeholders in `index.html`
    survive (the spec JSON gains surrounding whitespace, which
    `JSON.parse` ignores) and the 32 endless tests pass.
L8. `style: Format codebase with oxfmt` (done)
    79 files, +2,777 / -1,278 lines, formatting only. It needed a
    preceding `build: Prepare for oxfmt formatting`: wrapping moved one
    `@ts-expect-error` off the call it targets, and two functions grew
    past the 150-line limit (`parseHouseFamilySpec` to 160,
    `createEngine` in the endless player to 158), so each now carries an
    inline disable with a reason. `pnpm fmt:check` is not in CI until
    L12.
L9. `chore: Ignore formatting commit in git blame` (done)
    `.git-blame-ignore-revs` lists L8. GitHub applies it automatically;
    locally, run `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
L10. `build(analysis): Add ruff lint and format` (done)
     Three commits plus one review fix. Ruff 0.16.10 is pinned exactly in
     the `dev` extras (pre-1.0, like oxfmt), with `line-length = 100` to
     match oxfmt. Rules `E`, `F`, `B`, `BLE001`, `ERA001`, `T201`; `print`
     allowed only in `__main__.py` (all 28 calls). `E501` is off: at 100
     columns it found 109 lines before formatting and 14 after, all long
     strings and comments the formatter leaves alone. The other 28
     findings were fixed: 15 `zip()` calls (`strict=True` where both sides
     are built to the same length, `itertools.pairwise` for two shifted
     self-pairs, explicit `strict=False` where truncation is intended:
     loudness channel gains, now a cleanup item, and `compare_to_target`,
     whose spectra come from saved records), 5 ambiguous `l` names, 3
     unused variables, 2 placeholder-free f-strings, 1 unused loop index,
     1 false-positive `ERA001` (a tuple-layout comment, reworded). The one
     `BLE001` (`clapembed` batch fallback) carries a noqa pointing to item
     20. `ruff format` reformatted 26 files; that commit is in
     `.git-blame-ignore-revs`. CI's Python job runs `ruff check` and
     `ruff format --check` until L12 moves them to the lint job. 182 tests,
     same count before and after.
L11. `build(analysis): Typecheck with pyright` (done)
     Pyright 1.1.414 is pinned exactly in the `dev` extras (with its
     `nodejs` extra, so Node comes as a wheel rather than a first-run
     download) and configured under `[tool.pyright]`, over `awh_analysis`
     and `tests`, against the repo-root `.venv` and Python 3.11, the
     `requires-python` floor. It resolves the numpy, scipy and librosa types, so
     Ruff's `ANN` rules were not needed. Measured on 2026-10-07: `basic`
     and `standard` both report the same 18 findings (6 in source, 12 in
     tests), `strict` about 2,500 (mostly untyped numpy/scipy/librosa
     values), so the mode is `standard`. Fixed:
     - Two test `_burst` helpers returned `(None, None)` for a hit that
       does not fit in the signal (12 findings). Both now raise, since no
       fixture places a hit there, and the callers' `None` checks went.
     - `pumpcheck._fit_dip_model` started `best_rss` at `None`; it now
       starts at infinity, which also keeps a NaN residual from becoming
       the best fit.
     - Inline ignores with a reason: two optional imports
       (`basic_pitch`, installed by hand; `laion_clap`, the `clap` extra)
       and two scipy arguments its stubs type too narrowly (`stft`
       `boundary=None`, `welch` `detrend=False`, both documented values).
     - `audio.sanitize_json` was the one source function without
       annotations; it now takes and returns `object`. Ruff's `ANN` rules
       find 336 missing annotations in tests, which stay unannotated.
     Pyright runs in the Python CI job until L12; the test step now runs
     even when a lint or type step fails. Review nit not taken: the config
     assumes the repo-root `.venv` that `analysis/README.md` documents.
L12. `ci: Add lint job` (done)
     `pnpm lint` already runs in the Node CI job (added with L1). Move it
     into its own job with `pnpm fmt:check`, `ruff check`,
     `ruff format --check`, and pyright, so lint failures report
     separately from test failures. Make it required.
     The "Lint (oxlint, oxfmt, ruff, pyright)" job in `ci.yml` builds the
     Node packages (type-aware lint needs the `.d.ts` files) and the full
     analysis venv (pyright resolves numpy, scipy and librosa from it).
     Each check runs when its own setup step succeeded, so a failed Node
     build still lets the Python checks report. `pnpm fmt:check` was not
     in CI before this. The Node and Python jobs no longer lint. Making the
     job required is a repository setting; see "Not verified".
L13. Optional: `build: Add pre-commit hook`
     A checked-in hook (for example `lefthook` or a plain script wired by
     `git config core.hooksPath`) that runs `oxlint`, `oxfmt --check`, and
     Ruff on staged files only, so it stays fast. CI remains the gate; the
     hook only shortens the loop.

L14. `ci: Flag swallowed errors with semgrep`
     One custom rule: a `catch` that neither rethrows, logs, nor returns a
     flagged result. oxlint cannot express it. 23 bare `catch {` blocks in
     `src/` today, the pattern behind Phase 2, so land it as a ratchet
     (baseline file or per-site ignores with a reason) and shrink it as
     Phase 2 items close. Ruff `BLE001` (L10) covers Python.
L15. `ci: Cap code duplication with jscpd`
     jscpd 4 over `packages/*/src` (assets excluded, min 70 tokens) found
     16 clones, 1.36% of lines. Set the threshold at today's level and
     lower it as the shared-helper cleanup items land.
L16. `ci: Lint workflow files with actionlint`
     Four jobs (lint, Node and Python in `ci.yml`, and `groundwork.yml`)
     gate every merge, and a mistake in one can skip its checks
     without failing. Run `rhysd/actionlint`, pinned to a commit SHA, in
     the lint job on changes under `.github/workflows/`. Fix its findings
     in the same commit. Found on 2026-10-07 while reviewing
     sdras/awesome-actions; actionlint is not on that list.
     Done as the last step of the lint job. actionlint is a binary, not an
     action, so the step downloads release 1.7.12 and checks its SHA-256
     from the release's checksums file instead of pinning a commit. It
     runs on every pull request, not only on workflow changes: it takes
     about a second, and a path filter would be one more condition that
     could skip it. It runs shellcheck over each `run:` script and fails
     if the runner has no shellcheck, since actionlint would skip that
     rule without saying so. One finding, fixed: `groundwork.yml` passed
     the changed `research.md` paths unquoted, so a path with a space
     split in two; they are now read NUL-separated into an array, which
     also keeps git from quoting non-ASCII paths. The job keeps its
     name, which the required check matches.

## Track S: security and supply chain

The repository is public, so CodeQL, secret scanning, and dependency
review are free.

S1. Repository settings, no commit: enable Dependabot alerts, secret
    scanning, and push protection.
S2. `ci: Add CodeQL analysis`
    JavaScript/TypeScript and Python, on pull requests and weekly. The
    localhost gateway in `packages/core/src/bridge/server.ts` is the main
    surface it checks.
S3. `ci: Add Dependabot version updates`
    `.github/dependabot.yml` for npm, pip (`analysis/`), and
    `github-actions`, weekly and grouped to limit PR noise.
S4. `ci: Add dependency review on pull requests`
    `actions/dependency-review-action`, failing on high-severity
    advisories and on licenses incompatible with ADR-002.
S5. `ci: Add OpenSSF Scorecard`
    Weekly, results uploaded to code scanning.

## Track G: change guardrails and review

G1. `ci: Upload coverage to Codecov`
    After Phase 0. Upload TypeScript and Python reports, comment on pull
    requests with coverage for changed lines, and set a patch target so
    new code arrives tested.
G2. `chore: Add CODEOWNERS`
    Require owner review for `packages/core/src/bridge/`,
    `packages/extension/`, `.gitignore`, `.github/`, `LICENSE`, and
    `docs/decisions/`.
G3. `ci: Block non-redistributable content`
    Fail if a pull request adds anything under `vendor/ableton-sdk/`,
    `docs/Live 12 Manual/`, an `@ableton-extensions` tarball, or an
    `.ablx`. `.gitignore` alone does not stop `git add -f`.
G4. `ci: Flag gateway security changes`
    When `bridge/server.ts` changes, label the pull request and post a
    sticky comment asking the reviewer to check the loopback bind and
    Origin check.
G5. `ci: Check knowledge executable blocks still parse`
    When `knowledge/**` changes, parse every fenced `awh-*` block with the
    core parsers and post the parsed-result diff, so prose edits that
    change executable content are visible.
G6. `test(core): Check knowledge INDEX.md matches generator`
    `library/clips/INDEX.md` already has this test; `knowledge/INDEX.md`
    does not.
G7. LLM review (local half done)
    `REVIEW.md` at the repository root defines severity, what to skip
    (anything CI enforces), and the repository checks; each item is now
    reviewed with `/code-review` in a fresh context before the next one
    starts (see "Status and handoff"). Remaining, optional, owner's call:
    Claude Code Review on pull requests (enabled per repository in Claude
    admin settings; it reads `REVIEW.md`), or
    `anthropics/claude-code-action` (needs an API key as a repository
    secret, billed per run). Advisory only, never a required check.

G8. `docs: Add CLAUDE.md with agent rules` (done)
    `CLAUDE.md` holds the ground rules, fakes-not-mocks, the commit rules
    and the pre-commit checks, and points at the dev-groundwork pipeline.
    The ground rules above stay as the plan's record; when they change,
    change `CLAUDE.md` too.
G9. `ci: Lint commit messages with commitlint`
    `CLAUDE.md` requires conventional-commit subjects, and nothing checks
    it. Run `wagoid/commitlint-github-action`, pinned to a commit SHA, on
    pull requests with `@commitlint/config-conventional`. It skips merge
    commits by default, which this repository's merge-commit policy needs.
    The latest 40 subjects on `main` (checked 2026-10-07) conform, so it
    starts green; older milestone-style subjects (`M16: ...`) predate the
    rule and are outside any PR range.
G10. `ci: Label pull requests by size`
    Small, frequent pull requests are the goal, so make size visible.
    `pascalgn/size-label-action`, pinned to a commit SHA, labels each pull
    request from XS to XL by changed lines, ignoring `pnpm-lock.yaml` and
    generated `INDEX.md` files. Advisory only: never a required check.

## Phase 1: make existing tests honest

5. `test: Resolve analysis venv relative to the repo` (done)
   `MAIN_VENV_PYTHON` is hardcoded to `/home/user/ableton-workflow-helper/
   .venv/bin/python` in `packages/cli/test/{advise,breaks,samples}.test.ts`.
   On any other machine these integration tests skip without saying so.
   Move the lookup into one shared helper that resolves `<repo>/.venv`,
   honors `AWH_PYTHON`, and logs the skip reason once. Done when the 14
   skips drop to the tests that legitimately need missing models, each
   with a printed reason.
   Make the split explicit rather than environmental: tag tests that need
   the venv or real models as integration tests (a `describe` name
   prefix or separate `*.integ.test.ts` files in vitest, and a registered
   `integ` marker with `--strict-markers` in pytest). CI runs the
   integration set as its own step, or deselects it by name, so a skipped
   test is a visible choice instead of a side effect of the machine.
   Done: the absolute path had already become repo-relative in 526a93c,
   but each file still derived it and skipped silently.
   `packages/cli/test/analysis-venv.ts` resolves `AWH_PYTHON` (taken as
   given, as `src/analysis-python.ts` does) then `<repo>/.venv`; the five
   venv-backed `describe` blocks carry an `integ:` prefix; a vitest global
   setup warns with the reason once per run, and throws instead when
   `AWH_REQUIRE_INTEG=1`, which CI's Node job sets. pytest registers
   `integ` under `--strict-markers` with `-rs`; `test_a2m.py` (needs
   basic-pitch) is marked, its importorskip moved into an autouse fixture
   so `-m "not integ"` deselects rather than skips, and CI deselects by
   name. Measured: CLI 197 tests, 0 skipped with the venv, 14 skipped with
   the printed reason without it; analysis 182 passed, 7 deselected in CI
   (coverage 74.5%), 7 skipped with reason locally. The `hasBuiltCli`
   skips (no `pnpm build`) are a separate condition, left as they are.
   Review nits not taken: `AWH_PYTHON=""` counts as set, mirroring
   `src/analysis-python.ts`'s `??`, so the integ tests fail rather than
   skip; and an exported `AWH_PYTHON` now wins over the repo venv in
   these tests, as the plan asks.
6. `test: Extract shared CLI test helpers` (done)
   `runCli`, `startFakeGateway`, `makeTestLibrary`, and `writeWavMono16`
   are copied across 4 to 7 test files. Move them to
   `packages/cli/test/helpers.ts`. No behavior change.
   Done: eight files (advise, arp, bass, breaks, layers, op, remote,
   samples) now import from `helpers.ts`; net -306 lines. The two
   `startFakeGateway` shapes (an `OpCaller`, or `{ base }` plus a
   module-level `port` and an `opCall` wrapper) became one returning
   `{ port, caller }`, stopped through vitest's `onTestFinished` instead
   of a per-file `afterEach`. `makeTestLibrary(name, { linkAnalysis })`
   keeps each file's tmp prefix and the `analysis/` symlink where it was
   used; advise keeps a `runAdviseCli` wrapper that pins `AWH_PYTHON`.
   advise's `--set` test lost its inline gateway too. Measured: CLI 197
   tests, 0 skipped with the venv, same as before; per-file `it`/`expect`
   counts unchanged. Behavior differences, all deliberate: a failed op
   call's message no longer ends in `": "` when the gateway sends no
   message, the `--set` test's device insert now fails loudly instead of
   ignoring the response, and the gateway stops after `afterEach` hooks
   rather than inside one. Left: `sineSamples` stays in advise and
   samples (defaults differ, 0.3 vs 0.6, and the plan did not list it);
   the advise integ tests remove their tmp dir at the end of the test
   body, so a failing test leaks it (pre-existing; `makeTestLibrary`
   could register the cleanup with `onTestFinished`).
7. `refactor(cli): Export program for in-process tests`
   `index.ts` ends in `program.parseAsync()` at module scope. Export a
   `run(argv, io)` that builds the program, takes injectable stdout/stderr,
   and returns an exit code; keep a thin bin entry that calls it. Point the
   shared `runCli` helper at `run()` so command tests count toward
   coverage. Keep one spawn-based smoke test for the real binary.
8. `test(analysis): Call main() in-process in CLI tests`
   `awh_analysis.__main__.main(argv)` already exists. Switch
   `tests/test_cli.py` from `subprocess.run` to calling it with captured
   stdout, keeping one subprocess smoke test.
9. `test: Record true baseline and raise floors`
   Re-measure after items 7 and 8 and update the baseline table above.
   Land L2 first so tests that assert nothing do not inflate the
   numbers.

## Phase 2: fix silent failures, with tests

Each item is one commit: failing test first, then the fix.

10. `fix(cli): Distinguish missing clip from clip.get failure`
    Bare `catch` at `index.ts` (search `clip.get` near the "slot empty"
    paths; four call sites) treats any gateway or path error as an empty
    slot and creates a clip. Only the gateway's not-found error should mean
    empty. Extract one helper used by all four sites.
11. `fix(cli): Surface knowledge-entry parse errors in style lookup`
    The five `resolve*Spec` functions and two similar sites wrap `loadEntry`
    in a bare `catch` and report "unknown style", hiding malformed entries.
    Extract one `resolveStyleSpec(kind, name)` helper; not-found stays
    "unknown style", parse errors propagate with the file path.
12. `fix(cli): Warn on corrupt audition and mirror state`
    `readAuditionState` and `loadMirrorConfig` reset silently on unreadable
    JSON. Missing file stays a normal default; unreadable file warns.
13. `fix(extension): Stop overwriting an unreadable capture outbox`
    `sdkLiveBridge.ts` `appendOutboxEntry` overwrites an outbox it cannot
    parse, losing earlier captures, and the drain path returns `[]`. Fail
    loudly or move the bad file aside and warn. Extract the outbox logic
    into a pure module so it is testable without the SDK (see item 30).
14. `fix(cli): Report device-probe errors in mix advise`
    `advise.ts` `readMasterChainDevices` treats any error as end of chain,
    so the `try/catch` around it in `index.ts` is dead. Distinguish
    end-of-chain from gateway failure; delete the dead catch.
15. `fix(cli): Reject samples index without files array`
    `samples.ts` loads valid JSON lacking `files` as an empty index, and the
    next run overwrites it.
16. `fix(core): Validate chop-map required fields`
    `breaks/chopmap.ts` defaults missing `file`, `bpm_confidence`,
    `grid_steps_per_bar`, `beats_per_bar`. Decide per field: required
    fields fail with a message, defaulted ones get a comment and a test.
17. `fix(core): Make snare-rush slice fallback explicit`
    `breaks/engine.ts` snare-rush silently uses a non-snare slice when the
    map has no snare. Either refuse or warn through the result's notes
    array, with tests for both map shapes.
18. `fix(core): Report notes dropped by clampNotesToLength`
    `a2m/quantize.ts` drops or trims notes without telling the caller.
    Return the counts and print them in `clip from-audio`.
19. `test(core): Pin empty-role fallback in drum fills`
    `drums/fills.ts` falls back to original hits when a varied role comes
    out empty. Keep it, add the warn-level signal and both-direction tests.
20. `fix(analysis): Log and test decode and embed fallbacks`
    `clapembed.py` batch-to-per-file fallback, the ffmpeg decode fallback
    in `drumstats.load_loop` and `samplescan.load_for_scan`, and the
    onset `ValueError` to empty-list conversion in `pitch.py` and
    `drumstats.py`. Narrow each `except`, log at warning, test both sides.
    The narrowed `clapembed` clause must still catch `ValueError`: since
    L10, a batch that returns fewer vectors than paths raises it from
    `zip(strict=True)` and should fall back to per-file embedding.
    Split into one commit per module if the diffs are large.
21. `fix(analysis): Flag too-short input in duck band measurement`
    `duck._calibrated_band_dbfs` returns -120 dBFS when there is no PSD.
    Raise or return a flagged result instead of a plausible-looking number.

## Phase 3: command-level tests for the CLI

With item 7 in place, add one test file per command group. Each covers:
happy path against the fake gateway, `--help` renders, each validation
error, and JSON output where the command has it. One commit per group.

22. `test(cli): Cover clip commands` (`clip create/read/write/from-audio`)
23. `test(cli): Cover drums commands` (`gen/fill/vary/humanize/mine/detect-onsets`)
24. `test(cli): Cover drop and call commands` (`drop phrase/respond`, `call`)
25. `test(cli): Cover kb and lib commands` (`kb *`, `lib *`)
26. `test(cli): Cover mix commands` (`mix report/target/ab/bands/capture/layers/pitch/pump-check`, `mix duck *`)
27. `test(cli): Cover op, ref, sections, and endless commands`
28. `test(cli): Cover samples commands` (`index/search/similar/stats/embed/pitch-tag`)
29. `test(cli): Cover top-level commands` (`ping/status/ops/transforms/vary/sweep/chords/render/save/new/distill/serve-fake`)

End the phase by raising the cli floor.

## Phase 4: split index.ts

`packages/cli/src/index.ts` is about 6,200 lines. Phase 3 tests are the
safety net for moving each command group into its own module, the way
`duck.ts`, `op.ts`, `layers.ts`, and `remote.ts` already are. One commit
per group, tests unchanged and green after each:
`refactor(cli): Move <group> commands into <group>.ts`.

## Phase 5: extension

30. `refactor(extension): Extract pure logic from sdkLiveBridge`
    Pull everything that does not touch the SDK object model (outbox
    handling, request validation, value mapping) into modules with no SDK
    import.
31. `test(extension): Add vitest suite for extracted modules`
    Add a `test` script so the root `pnpm test` includes the extension.
32. `test(extension): Cover bridge against a mocked SDK surface`
    Build a minimal fake of the SDK objects the bridge uses, typed against
    `types/ableton-sdk-shim.d.ts`. Done when `sdkLiveBridge.ts` is covered
    except the code that can only run inside Live, which is listed in the
    coverage config with a reason.

## Phase 6: close remaining gaps

One commit per module, lowest coverage first. Current gaps (lines):

- core: `endless/spec.ts` 78%, `fake/fakeLiveBridge.ts` 78%,
  `library/store.ts` 81%, `arp/engine.ts` 81%, `drums/styleSpec.ts` 83%,
  `drums/fills.ts` 84%, `arp/spec.ts` 86%, `phrase/spec.ts` 86%,
  `breaks/chopmap.ts` 87%, `bridge/paths.ts` 88%, `bass/spec.ts` 89%,
  `knowledge/entry.ts` 90%. Branch coverage is lowest in `alc/parse.ts`
  (36%) and `knowledge/entry.ts` (64%).
- cli (module-level): `samples.ts` 68%, `analysis-python.ts` 29%.
- analysis: `clapembed.py` 73%, `report.py` 74%, `samplescan.py` 80%,
  `drumstats.py` 82%.

Most uncovered spec-parser lines are validation errors; table-driven
"rejects X" tests cover them cheaply.

Final item: `test: Require 100% line coverage` with an explicit, commented
exclusion list (type-only files such as `drums/types.ts`, code reachable
only inside Live, real-model paths behind `AWH_CLAP_STUB`).

## Phase 7: mutation testing

Line coverage shows a line ran, not that a test would notice it change.
After Phase 6 reaches 100%, mutation testing is what keeps that number
honest.

33. `test: Add Stryker mutation testing for core`
    `@stryker-mutator/core` with the vitest runner over `packages/core`,
    incremental mode. On pull requests, mutate changed files only; run
    the full package weekly. Advisory first.
34. `test: Enforce a mutation score floor`
    After the first full run, record the score per module here and fail
    below it. Raise it like the coverage floors. Extend to `cli` once
    Phase 4 has split `index.ts`. Python (mutmut) is deferred: runs that
    load librosa are slow; revisit if analysis tests stay fast enough.

## Cleanup found along the way

Small, independent commits; take them whenever convenient.

- `refactor(core): Remove unused exports` (`phrase/util.ts`
  `callStartBeat`, the five unused exports in `phrase/recipes.ts`,
  `transposeScale`). Confirm nothing outside the package imports them.
- `refactor(core): Share clampVelocity` (copies in `arp/engine.ts`,
  `bass/engine.ts`, `harmony/voicing.ts`).
- `refactor(core): Share spec-parser validation helpers` (the
  `fail`/unknown-key/range checks repeated across six spec parsers).
- `refactor(core): Parse knowledge files once in buildIndex`
  (`knowledge/store.ts` reads and parses each measurement file three
  times).
- `fix(core): Validate frontmatter string fields` (`library/entry.ts`,
  `knowledge/entry.ts`, and the gateway error body in `cli/src/index.ts`
  call `String()` on unvalidated YAML/JSON values, so an object becomes
  `[object Object]`). Then turn `typescript/no-base-to-string` back on.
- `refactor(core): Reuse variantSeed for break seed mixing`.
- `fix(core): Buffer gateway request body without quadratic concat`
  (`bridge/server.ts`).
- `refactor(analysis): Share ffmpeg decode between drumstats and
  samplescan`, and make `_band_split` public or move it.
- `refactor(analysis): Merge samplescan and samplepitch CLI handlers`.
- `fix(analysis): Reject or weight loudness input past five channels`
  (`loudness.py` has BS.1770 gains for L, R, C, Ls, Rs only, and the
  weighted sum drops any further channels without a word; found by
  Ruff's `B905` in L10).
- `chore(m4l): Remove diagnostic tap from AWH Ducker` (comment box marked
  "remove before shipping").
- `docs: Drop milestone tags from test titles` (`ops.test.ts`,
  `drums.test.ts`, `samples.test.ts`).
- `style(cli): Remove em-dashes from help and output strings` (about 176
  in `index.ts`; check test assertions on output first).
- `fix(core): Generate index files without em-dashes`
  (`library/store.ts` and the `awh kb index` generator; regenerate both
  `INDEX.md` files).

## Open decision

The gateway has no auth token; it checks only for a loopback address and
the Origin header, so any local process can drive Live. Whether that is
acceptable is a product call, not a coverage item. If a token is added, it
needs its own design note and tests.
