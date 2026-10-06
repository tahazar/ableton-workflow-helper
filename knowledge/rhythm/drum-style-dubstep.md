---
slug: drum-style-dubstep
topic: rhythm
tier: draft
tags: [dubstep, trap, drums, style-spec, 140bpm]
sources: []
related: [rhythm/dubstep-drum-pattern, rhythm/burial-2step-skeleton, rhythm/drum-style-hybrid-trap, arrangement/phrase-style-dubstep-cr]
---
# Drum style: dubstep

`awh drums gen <track> --style dubstep` reads the spec below. It stays
draft until auditioned and tuned. The kick cells and density knobs are an
authored proposal built on `rhythm/dubstep-drum-pattern` [sourced], not
further-sourced fact.

## Why the trap family fits dubstep at 140

The trap family (`family: trap` in `packages/core/src/drums/styleSpec.ts`)
implements the mechanics `rhythm/dubstep-drum-pattern` documents as
dubstep's skeleton: a half-time backbeat at one fixed beat (`snareBeat`), a
kick pattern drawn from a small set of curated cells and locked for the
whole loop instead of re-randomized per bar (`trapFamilyPlan` in
`grammars.ts`: "kick: the cell, placement LOCKED — only velocities
breathe"), and a hat layer that supports rather than leads. Both genres
share half-time-with-locked-backbeat DNA (dubstep is often described
alongside trap and hip-hop as half-time-family percussion). The house family
is four-on-the-floor, the wrong mechanism for a genre whose one sourced
constant is a single kick on beat 1.

## What each field encodes, and which sourced claim it answers

- **`snareBeat: 3`**: the one backbeat position every tutorial and thread
  in `rhythm/dubstep-drum-pattern` agrees on. Not a free choice.
- **`clapWithSnare: true`**: a clap under the backbeat snare is common in
  bass music generally (and the built-in trap default), but the
  dubstep-specific research does not single it out as a genre trait. It is
  an unsourced convenience default, kept because the research gives no
  reason either way.
- **`kickCells`**: four cells covering the "kick placement is a freedom"
  finding in `rhythm/dubstep-drum-pattern`: the sourced constant (a
  downbeat kick) plus a spread of extra-hit positions, from riddim-minimal
  (downbeat only, echoing riddim's "repetitive and minimalist" loop) to a
  busier double-pickup (closer to tearout's more active percussion). None
  of the extra offsets are sourced; see that entry's "kick placement is a
  freedom" section for why several cells are offered.
- **`hatBases: [straight-8ths, 16th-run]`**: swung-16ths is deliberately
  excluded. The dubstep research describes no shuffle feel of the kind
  `rhythm/burial-swing-feel` [sourced] documents for Burial's
  garage-adjacent tracks; dubstep's sourced character is "impact and
  space". Straight hats are an interpretive choice reflecting that absence,
  not a sourced rule.
- **`rollDensity: 0.35`, `openHatChance: 0.25`**: both lowered from the
  trap-family defaults (1.0 / 0.5) to reflect the sourced "space is the
  groove" / "sparse... shakers, rimshots, and occasional ghost hits"
  finding. Fewer rolls and rarer open hats, so percussion supports the bass
  instead of competing.
- **`swingDelay: 0.04`**: slightly tighter than the trap default (0.06).
  With swung-16ths excluded it has almost no effect. It is kept low rather
  than removed so a later tuning pass that re-enables `swung-16ths` does
  not inherit an unconsidered value.

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

Half-time backbeat on 3 (clap layered), with one of four kick cells held for
the whole loop like all trap-family grooves: `riddim-minimal` (downbeat
only), `pickup-into-3` (adds a syncopated pickup at beat 2.75, pushing into
the backbeat), `double-pickup` (adds a second pickup at beat 4.5, busier),
and `post-snare-weight` (adds a hit at beat 3.5, right after the backbeat).
Compared with the built-in `trap` style, hats never fall back to
swung-16ths, rolls fire at 35% of normal probability, and open hats are
rarer (0.25). Variants: `riddim-minimal`, `pickup-into-3`, `double-pickup`,
`post-snare-weight`; `--variant <name>` pins one. `--density` drives the
hat-base weighting and roll/ghost probabilities as it does for the built-in
trap style. Low density leans toward `riddim-minimal`'s bare-bones feel,
high density toward `double-pickup`.
