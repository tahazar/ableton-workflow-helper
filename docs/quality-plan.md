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

## Phase 0: tooling

1. `build: Add vitest coverage with v8 provider`
   Add `@vitest/coverage-v8` (match vitest 2.1.x) as a root dev dependency,
   a `vitest.config.ts` per package with `include: ["src/**"]`, and a root
   `pnpm coverage` script. Done when `pnpm coverage` prints a table for
   core and cli.
2. `build: Add pytest-cov to analysis dev extras`
   Add a `dev` extras group with `pytest` and `pytest-cov` to
   `analysis/pyproject.toml` (none exists today), and
   `--cov=awh_analysis --cov-report=term-missing` to the pytest config (or
   a documented command). Done when the coverage table prints from
   `analysis/`.
3. `ci: Run build, typecheck, and tests on pull requests`
   No CI exists. Add `.github/workflows/ci.yml` triggered on `pull_request`
   and pushes to `main`, with a Node job (`pnpm install --frozen-lockfile`,
   `pnpm build`, `pnpm typecheck`, `pnpm coverage`) and a Python job (venv
   built per `analysis/README.md`, CLAP stubbed via `AWH_CLAP_STUB=1`).
   The extension cannot be bundled in CI because the Ableton SDK is not
   redistributable; its typecheck runs against
   `types/ableton-sdk-shim.d.ts`, so skip `build:extension`. Pin every
   action to a commit SHA. Then, in repository settings, protect `main`:
   require pull requests and require this workflow's jobs to pass.
4. `test: Enforce current coverage floors`
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
L6. `build: Warn on long functions`
    `max-lines-per-function` at warn with a generous limit, as a ratchet
    for the `index.ts` split (Phase 4). Lower the limit as groups move
    out. Leave the rest of `pedantic` and `perf` off: most
    `no-await-in-loop` hits are intentional sequential gateway calls into
    Live, which must stay ordered.
L7. `build: Add oxfmt pinned to 0.72.0`
    Config, `pnpm fmt` and `pnpm fmt:check`. Exact version pin, because a
    pre-1.0 minor release can change output and fail CI on untouched
    files. Exclude `packages/cli/assets/` unless the endless player
    template still builds and passes its tests after formatting.
L8. `style: Format codebase with oxfmt`
    Formatting only, no other changes.
L9. `chore: Ignore formatting commit in git blame`
    Add L8's hash to `.git-blame-ignore-revs`.
L10. `build(analysis): Add ruff lint and format`
     Ruff in the `dev` extras, config in `pyproject.toml`. Enable `F`
     (unused imports), `E`, `B`, and `BLE001` (blind `except Exception`,
     the pattern behind several Phase 2 findings). Format commit and
     blame-ignore entry as in L8 and L9.
L11. `ci: Add lint job`
     Runs `pnpm lint`, `pnpm fmt:check`, `ruff check`, and
     `ruff format --check`. Make it required.

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
G7. Optional: an LLM pull-request reviewer (Copilot code review or
    `anthropics/claude-code-action`). Advisory only, never a required
    check. The second needs an API key as a repository secret and is
    billed per run.

## Phase 1: make existing tests honest

5. `test: Resolve analysis venv relative to the repo`
   `MAIN_VENV_PYTHON` is hardcoded to `/home/user/ableton-workflow-helper/
   .venv/bin/python` in `packages/cli/test/{advise,breaks,samples}.test.ts`.
   On any other machine these integration tests skip without saying so.
   Move the lookup into one shared helper that resolves `<repo>/.venv`,
   honors `AWH_PYTHON`, and logs the skip reason once. Done when the 14
   skips drop to the tests that legitimately need missing models, each
   with a printed reason.
6. `test: Extract shared CLI test helpers`
   `runCli`, `startFakeGateway`, `makeTestLibrary`, and `writeWavMono16`
   are copied across 4 to 7 test files. Move them to
   `packages/cli/test/helpers.ts`. No behavior change.
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
