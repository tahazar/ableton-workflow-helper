# Lessons learned (in-Live verification, M0–M6)

Distilled from the owner's validation sessions — every bug found so far was
at the **integration/discoverability layer** (skill docs, edge-case targets,
guard placement), never in the core mechanics (ops, notation, transforms,
sections math, drum grammars, alc round-trip — those held essentially every
time). These lessons are the "definition of done" for future milestones.

## Definition of done — every new `awh` command ships with:

1. **A "Typical Flows" entry in `.claude/skills/awh/SKILL.md`.** A dedicated
   docs section is NOT enough: fresh agents answer "how do I do X" from the
   flows playbook, and three separate times (vary, sections, lib place) a
   new tool with good docs was bypassed for hand-composition with older
   general tools because the flow for its natural request didn't name it.
   Not polish — part of done.
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
4. **Zero items is a state, not an error.** `export-alc`'s
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

## What's working (keep doing it)

- Milestone-by-milestone ship → verify-in-Live → fix → ship, with fixes
  committed from the validation session itself.
- Verified-reference discipline (api.md; never drift from it) — zero core
  logic failures across six milestones.
- Fresh-agent skill tests as an exit criterion: they find discoverability
  gaps no self-review does, and they honor "never invent a number" when the
  data genuinely doesn't fit.
