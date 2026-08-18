---
slug: drum-style-dubstep
topic: rhythm
tier: draft
tags: [dubstep, trap, drums, style-spec, 140bpm]
sources: []
related: [rhythm/dubstep-drum-pattern, rhythm/burial-2step-skeleton, rhythm/drum-style-hybrid-trap, arrangement/phrase-style-dubstep-cr]
---
# Drum style: dubstep

`awh drums gen <track> --style dubstep` reads the spec below. Draft until
the owner auditions and tunes it — the kick cells and density knobs are an
authored proposal built ON `rhythm/dubstep-drum-pattern` [sourced], not a
further-sourced fact themselves.

## Why the TRAP family fits dubstep at 140

The trap family (`family: trap` in `packages/core/src/drums/styleSpec.ts`)
was built around exactly the mechanics `rhythm/dubstep-drum-pattern`
documents as dubstep's actual skeleton: a half-time backbeat at a single
fixed beat (`snareBeat`), a kick pattern drawn from a small set of curated
CELLS and then LOCKED for the whole loop rather than re-randomized bar to
bar (`trapFamilyPlan` in `grammars.ts` — "kick: the cell, placement LOCKED —
only velocities breathe"), and a hat layer that is a supporting grid rather
than the rhythmic focus. That is a structural match, not a coincidence: both
genres share the same half-time-with-locked-backbeat DNA (dubstep is
frequently described alongside trap and hip-hop as half-time-family
percussion). The house family, by contrast, is four-on-the-floor — wrong
mechanism entirely for a genre whose one sourced constant is a single kick
on beat 1, not four evenly-spaced kicks per bar.

## What each field encodes, and which sourced claim it's answering

- **`snareBeat: 3`** — the one backbeat position every tutorial/thread
  checked in `rhythm/dubstep-drum-pattern` agrees on. Not a free choice.
- **`clapWithSnare: true`** — layering a clap under the snare on the
  backbeat is common practice in bass-music production generally (it's the
  built-in trap default), but nothing in this session's dubstep-specific
  research singles out clap-layering as a genre trait — this is an
  unsourced convenience default, kept because dropping it would need its
  own justification the research doesn't supply either way.
- **`kickCells`** — four cells spanning the "kick placement is a freedom"
  finding from `rhythm/dubstep-drum-pattern`: the sourced constant (a
  downbeat kick) plus a spread of plausible extra-hit positions, from
  riddim-minimal (nothing but the downbeat, echoing riddim's described
  "repetitive and minimalist" loop character) to a busier double-pickup
  (closer to tearout's more active percussion under the aggression). None
  of the specific extra offsets are themselves sourced — see the "kick
  placement is a freedom" section of that entry for why several cells are
  offered instead of one.
- **`hatBases: [straight-8ths, 16th-run]`** — swung-16ths is deliberately
  EXCLUDED. Nothing in this session's dubstep research describes a shuffle/
  swing feel the way `rhythm/burial-swing-feel` [sourced] documents for
  Burial's garage-adjacent tracks; dubstep's own sourced character is
  "impact and space," not shuffle. Keeping hats straight is an interpretive
  choice reflecting that absence, not a sourced rule of its own.
- **`rollDensity: 0.35`, `openHatChance: 0.25`** — both turned down from the
  trap-family defaults (1.0 / 0.5) to reflect the sourced "space is the
  groove" / "sparse... shakers, rimshots, and occasional ghost hits" finding
  — fewer hat rolls, rarer open-hat events, because the sourced material
  says percussion should support rather than compete with the bass.
- **`swingDelay: 0.04`** — slightly tighter than the trap default (0.06);
  since 16th-run stays available (unswung), this mostly affects nothing in
  practice at this hat-base restriction — kept low rather than removed so a
  future tuning pass that re-enables `swung-16ths` doesn't inherit an
  unconsidered value.

## Executable

```awh-style-spec
name: dubstep
family: trap
snareBeat: 3
clapWithSnare: true
kickCells:
  - name: riddim-minimal
    offsets: [0]
  - name: pickup-into-3
    offsets: [0, 1.75]
  - name: double-pickup
    offsets: [0, 1.75, 3.5]
  - name: post-snare-weight
    offsets: [0, 2.5]
hatBases: [straight-8ths, 16th-run]
rollDensity: 0.35
openHatChance: 0.25
swingDelay: 0.04
```

## The rule

Half-time backbeat on 3 (clap layered), one of four kick cells held for the
whole loop like all trap-family grooves — `riddim-minimal` (downbeat only),
`pickup-into-3` (adds a syncopated pickup at beat 2.75, pushing into the
backbeat), `double-pickup` (adds a second pickup at beat 4.5, busier), and
`post-snare-weight` (adds a hit at beat 3.5, right after the backbeat).
Compared to the built-in `trap` style: hats never fall back to swung-16ths,
roll events at 35% of normal probability, open hats rarer (0.25). Variants:
`riddim-minimal`, `pickup-into-3`, `double-pickup`, `post-snare-weight` —
`--variant <name>` pins one. `--density` still drives the hat-base weighting
and roll/ghost probabilities exactly as it does for the built-in trap style;
low density leans toward `riddim-minimal`'s bare-bones feel, high density
toward `double-pickup`.
