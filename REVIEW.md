# Review guide

Instructions for reviewing a change to this repository, whether the reviewer
is a person, `/code-review`, or Claude Code Review on a pull request. Review
the diff against what it claims to do; the author's reasoning is not part of
the input.

## Severity

- **Blocking:** a behavior bug, a test that would not catch the regression it
  claims to cover, a security problem, or a broken repository rule below.
  Quote the code that shows it. A suspicion you cannot support from the code
  is not blocking.
- **Nit:** naming, wording, small simplifications. At most five per review.
- Pre-existing problems the diff does not touch: mention once, never
  blocking.

## Skip

CI already enforces formatting (oxfmt), lint (oxlint, type-aware), types,
tests and coverage floors; do not re-report what those tools check. Skip
`pnpm-lock.yaml`, `dist/`, generated `INDEX.md` files, and commits whose
subject starts with `style:` beyond confirming they change formatting only.

## Repository checks

Tests:

- A bug fix comes with a test that fails before the fix. An existing
  assertion loosened in the same change as a fix is blocking unless the
  commit message explains why the old assertion was wrong.
- Tests use the fake gateway (`awh serve-fake`, `fakeLiveBridge`) and real
  module code. Mocking the unit under test is blocking; mocking a process
  boundary or environment variable is fine.
- Detectors and analyzers include a negative-control case.

Errors and fallbacks (`docs/quality-plan.md`, ground rules):

- A `catch` that swallows an error, or treats any failure as "not found" or
  "empty", is blocking. Specific failures are told apart from generic ones.
- A rethrown error says which action failed and keeps the original as
  `cause`.
- A fallback that stays logs at warn level and is tested both ways.
- A fixed delay says what it waits for and why there is no signal.

Boundaries:

- Only `packages/extension` imports the Ableton SDK (ADR-001).
- The gateway (`packages/core/src/bridge/server.ts`) keeps its loopback bind
  and Origin check. Any change there gets a security look.
- Nothing non-redistributable lands: SDK files, Ableton docs or manual,
  third-party audio, `.ablx` builds.
- No GPL or AGPL dependencies (ADR-002).

Behavior locks (`CONTRIBUTING.md`, house rules):

- Built-in generator styles produce byte-identical output; new behavior ships
  as knowledge-entry data.
- New CLI commands have a Typical Flows entry in the `awh` skill.
- A claimed display value (dB, ms, ratio) cites an observed raw-to-display
  pair or says it is unverified.

Not findings: musical constants (velocities, PPQ, beat counts, MIDI ranges)
are domain values, not magic numbers.

## Output

Lead with blocking findings, each with file, line, quoted code, and the fix.
Then nits. If nothing is blocking, say so in one line.
