# Lessons learned (in-Live verification, M0–M6)

Distilled from the owner's validation sessions — every bug found so far was
at the **integration/discoverability layer** (skill docs, edge-case targets,
guard placement), never in the core mechanics (ops, notation, transforms,
sections math, drum grammars, alc round-trip — those held essentially every
time). These lessons are the "definition of done" for future milestones.

## Definition of done — every new `awh` command ships with:

1. **A "Typical Flows" entry in `.claude/skills/awh/SKILL.md` — now a
   MECHANIZED gate.** A dedicated docs section is NOT enough: FIVE separate
   times (vary/M3, sections/M4, lib place/B3, ref/M8, kb/B4) a new tool with
   good docs shipped without a flows entry and fresh agents bypassed it.
   The written rule did not stop occurrences 4 and 5, so it is now a test:
   `packages/core/test/skill-flows.test.ts` fails the suite when a feature
   section's commands are missing from the flows region. Lesson inside the
   lesson: a process rule that keeps recurring needs to become a check the
   build runs, not better prose.
2. **A negative-control test.** If the checklist says "break X → report
   reflects it", the builder runs that inversion against synthetic fixtures
   BEFORE shipping. M6's pump detector shipped without one and its real flaw
   (RMS periodicity can't distinguish sidechain ducking from natural note
   decay) was found live instead of in a 10-line pytest. Positive detection
   passing is half a test.
3. **An answer to "the target already holds something empty".** Real Live
   projects are full of pre-blocked placeholder clips — present but
   noteless. `lib place` only handled genuinely-empty targets and two
   independent agents hand-worked around it identically. Every "write X
   into Y" tool must decide (and document) its behavior for occupied-but-
   trivial targets.
4. **Typed wrappers for repeat-use gateway ops.** `op(name, args)` takes
   `unknown`, so a wrong field name compiles clean and fails only at
   runtime inside Live — the duck toolchain shipped five `device.param`
   calls with `{name}` instead of `{param}` and every one failed live.
   Any op called from more than one CLI site gets a typed wrapper
   (`setDeviceParam(...)`), and new call sites use the wrapper, not raw
   `op()`.
5. **Zero items is a state, not an error.** `export-alc`'s
   `if (entries.length === 0) throw` guard sat in front of the
   wipe-stale-content logic it should have protected — so emptying the
   library silently stopped syncing the mirror. Ask of every early guard:
   what cleanup/sync path does this skip when it fires?

## Operational

- **Restarting Live requires restarting `extensions-cli` too.** A stale
  extension-host connection keeps answering `ping` while every real op
  hangs or fails generically — this cost more time than any actual bug.
  (Noted in dev-loop troubleshooting.)
- Utility gain plugins (clip-style limiters, GClip etc.) sitting before the
  capture tap can mask small gain changes during A/B tests — bypass them or
  place the tap after.
- **A tool that accepts positions/times must sanity-check them against the
  audio.** `duck fit` fed guessed trigger times produced a plausible-looking
  but nonsensical envelope (peak mid-window, 174 dB over floor) with no
  flag — dangerous precisely because the output looked normal. Fits now
  warn on misaligned peaks and silence-floor readings; the general rule:
  when garbage-in can look like signal-out, detect the garbage.
- **Recheck "impossible" manual steps.** "Sidechain On" was documented as a
  manual touch alongside Audio From routing — but it's an ordinary
  automatable device.param; only the routing is genuinely outside the SDK.
  When declaring something unautomatable, verify each item separately.
- **Destructive commands must refuse universal matchers.** `awh sweep
  --prefix ""` matched every clip name and deleted a project's original
  placeholder clip during a validation pass. Any delete/overwrite command
  whose filter can degenerate to match-everything needs that case to be an
  explicit opt-in flag (`--all`), never a silent default.
- SDK limitations worth escalating to Ableton are collected in
  `docs/sdk-feedback.md` — add to it when a new one is hit.

## What's working (keep doing it)

- Milestone-by-milestone ship → verify-in-Live → fix → ship, with fixes
  committed from the validation session itself.
- Verified-reference discipline (api.md; never drift from it) — zero core
  logic failures across six milestones.
- Fresh-agent skill tests as an exit criterion: they find discoverability
  gaps no self-review does, and they honor "never invent a number" when the
  data genuinely doesn't fit.
