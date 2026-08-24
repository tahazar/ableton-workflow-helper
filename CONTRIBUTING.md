# Contributing

This is a personal project, but issues and PRs are welcome. A few things
matter more here than in a typical repo.

## The Ableton Extensions SDK is not in this repo

The gateway extension builds against the [Ableton Extensions
SDK](https://ableton.github.io/extensions-sdk/), which ships with Live 12
Suite (currently beta) and is not redistributable. Obtain it from Ableton,
extract it to `vendor/ableton-sdk/`, and never commit it — the `.gitignore`
enforces this, and PRs that include SDK files, Ableton documentation, or the
Live manual will be closed. The same applies to audio from third-party
datasets: measurement records (derived JSON) are fine, source audio is not.

Because the SDK is beta software, its behavior changes between drops.
Observed limitations and bugs are tracked in `docs/sdk-feedback.md`; add to
it when you hit a new one, with a minimal reproduction.

## Development without Live

Almost everything is developed and tested against `awh serve-fake` (an
in-memory Live Set) — no Live installation needed:

```sh
pnpm install && pnpm build && pnpm test        # Node suites
python3 -m venv .venv && .venv/bin/pip install -e analysis
.venv/bin/python -m pytest analysis            # Python suite
```

Both suites must pass. Changes that touch real-Live behavior get an entry in
the relevant validation checklist in `docs/dev-loop.md`, to be checked off
in an actual Live session.

## House rules

The short version of `docs/lessons-learned.md`, which is binding:

- Every new CLI command needs a Typical Flows entry in the `awh` skill —
  `packages/core/test/skill-flows.test.ts` enforces this mechanically.
- Detectors and analyzers ship with a negative-control test (a case that
  must NOT trigger), not only happy paths.
- Zero items is a state, not an error. Destructive commands must refuse
  filters that degenerate to match-everything.
- Built-in generator styles are locked: refactors must produce byte-identical
  output, proven by the frozen-copy regression tests. New behavior ships as
  data (knowledge-entry specs), not edits to the built-ins.
- Raw SDK parameter values are unmapped. Anything claiming a display value
  (dB, ms, a ratio) must either cite an observed raw↔display pair recorded
  in `knowledge/` or say it is unverified.

## Knowledge base entries

Entries in `knowledge/` follow `knowledge/README.md`: tier discipline
(`verified` means checked against a real device or measurement, `sourced`
requires citations you actually read, `draft` is anything constructed),
no invented sources, and executable blocks must parse — run the relevant
command against `awh serve-fake` before submitting. Regenerate the index
with `awh kb index`; don't edit `INDEX.md` by hand.

## Licensing

MIT for everything in this repo. No GPL or AGPL dependencies in the
dependency tree (LGPL transitive dependencies are tolerated but must be
flagged in `analysis/README.md`). Data mined from external datasets keeps
its attribution embedded in the measurement records.
