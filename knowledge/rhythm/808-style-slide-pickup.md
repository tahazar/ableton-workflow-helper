---
slug: 808-style-slide-pickup
topic: rhythm
tier: draft
tags: [trap, hip-hop, 808, bass, slide, style-spec]
sources: ["https://create.routenote.com/blog/how-to-make-trap-beats-pt-3-808-basslines/", "https://itsgratuitous.com/how-to-slide-808s-in-fl-studio/", "https://www.productionmusiclive.com/blogs/news/trap-beat-guide-bass-essential-tips-for-making-808-patterns", "https://www.iconcollective.edu/808-mixing-tips"]
related: [rhythm/808-bass-craft, rhythm/waivops-drum-stats-pilot, sound-design/operator-recipe-glide-bass, rhythm/drum-style-hybrid-trap]
---
# 808 style: slide-pickup (long root, 5th pickup, slide into the downbeat)

**Sourcing note:** built from search-excerpt research, with the same
caveat as `rhythm/808-bass-craft`, which this entry cites throughout. Every
authored (non-sourced) number is flagged inline. Nothing here is a
measurement.

## The idiom this encodes

`rhythm/808-bass-craft` [sourced] documents three converging facts this spec
satisfies at once: (1) a long root holding through most of the bar is the
sustain baseline, with the tempo/energy-dependent stab alternative as a
second, sparser cell; (2) the pickup is a short note jumping from the root
"up to the 5th" in the bar's tail (create.routenote.com); (3) that pickup
overlaps into the next bar's downbeat to trigger a glide, the mechanic the
FL Studio/GarageBand/REAPER tutorials cited there all describe. There are
three cells because `808-bass-craft` found no single canonical placement or
long-vs-stab ratio. Following the schema's "curated freedom" design (see
`docs/design/bass-808.md`), the style offers plausible alternatives to
audition, not one invented "correct" pattern.

## Cell-by-cell rationale

- **`long-root-pickup`** (the sourced baseline, highest weight): a long
  root sustain (`pos:0, len:2.75, degree:0`) followed by a 5th pickup
  (`degree:7`) in the bar's last beat that slides (`slide:true`) into the
  next bar's opening note. `degree:7` is sourced (routenote's "jumping up
  to the 5th in pickup notes"). The `pos:3`/`len:2.75` split and
  `weight:4` are authored; no source gives how long the root holds before
  the pickup.
- **`stab-answer`** (the tempo/energy-dependent alternative):
  `808-bass-craft` reports that long-vs-stab tracks tempo/energy, and that
  off-kick syncopation is a named but unquantified variation. This cell
  encodes both: two short root stabs early in the bar (`pos:0`/`pos:0.75`,
  both `len:0.5`), a short 5th at `pos:2`, then the same slide-into-next-bar
  pickup as `long-root-pickup`. All four positions/lengths and `weight:2`
  are authored. The source supports "a short-stab idiom exists and
  syncopation is used for tension", not these sixteenth-grid placements.
- **`sparse-space`** (the "leave space" cell, lowest weight): one long root
  (`pos:0, len:2.0, degree:0`) with the back half of the bar silent, no
  pickup, no slide. It encodes `808-bass-craft`'s sourced "leave space"
  claim (productionmusiclive.com: "a sparse 808 bassline can give the rest
  of the beat a chance to breathe") as a drawable cell. `len:2.0` and
  `weight:1` are authored; no source gives a silence duration or how often
  a "space" bar should occur.

`degrees: [0, 7]` is deliberately narrow: root and 5th are the only degrees
the sources named for 808 pickup motion. Octave (`12`) and other extensions
are common 808-line moves but were not sourced for the pickup convention, so
they are left out of the validation set. Widen `degrees` as a reviewed edit
if auditioning shows the pattern wants an octave jump.

`register: [24, 36]` (C1-C2) sits conservatively inside the one sourced
range, "stay within the sub-bass to upper-bass range (roughly C1 to G2) to
maintain the characteristic 808 weight" (iconcollective.edu). It is
narrowed to C1-C2 to match the schema's example register.

## Key-tracking note (a mixing-layer decision, not a pattern-layer one)

`degree`/`register` place notes relative to a fitted root. They say nothing
about which 808 sample's fundamental gets tuned to what. `808-bass-craft`
documents that as a separate, disputed practice: tune the sample to the song
key, or (per the arXiv/ISMIR finding) bend the song's key to the sample's
narrow usable pitch range. Read that entry before picking a root/key for
`awh bass 808`. This spec covers only what happens once a root is chosen.

## Slide overlap: a sourced value, bigger than the schema's own example

The schema example in `docs/design/bass-808.md` uses
`slideOverlapBeats: 0.05`, a small legato-trigger epsilon, enough for a mono
synth's glide to fire. One source in `808-bass-craft` gives the overlap a
producer draws for a "tight, snappy" slide: a full 1/16th note
(itsgratuitous.com), 0.25 beats at any tempo, five times the schema's
epsilon. This entry uses the sourced value (`slideOverlapBeats: 0.25`). The
discrepancy with the schema example is open, not resolved.

## Swing: not claimed for this pattern layer

No source describes an 808 bassline (as opposed to hi-hats) as swung. The
adjacent measured number is `rhythm/waivops-drum-stats-pilot` [sourced]'s
full-n trap hi-hat finding (off-16ths landing +0.0216 beats late at
n=15,000). That measures hats, not 808 notes, and neither confirms nor
contradicts this spec's `swing: 0`. `swing: 0` reflects the absence of a
bassline-specific claim, not a sourced fact that 808 basslines are never
swung.

## Executable

```awh-808-spec
name: slide-pickup
cells:
  - name: long-root-pickup
    weight: 4
    steps:
      - {pos: 0, len: 2.75, degree: 0}
      - {pos: 3, len: 1.0, degree: 7, slide: true}
  - name: stab-answer
    weight: 2
    steps:
      - {pos: 0, len: 0.5, degree: 0}
      - {pos: 0.75, len: 0.5, degree: 0}
      - {pos: 2, len: 0.5, degree: 7}
      - {pos: 3, len: 1.0, degree: 0, slide: true}
  - name: sparse-space
    weight: 1
    steps:
      - {pos: 0, len: 2.0, degree: 0}
degrees: [0, 7]
register: [24, 36]
slideOverlapBeats: 0.25
velocity: {base: 108, accentFirst: 14}
turnaroundBar: 4
turnaroundCells: []
swing: 0
```

Sourced values: `degree: 7` as the pickup target, `slideOverlapBeats: 0.25`
as the "tight, snappy" 1/16-note overlap, and `register` narrowed inside the
sourced C1-G2 range. Authored values: all `pos`/`len`/`weight`, `velocity`,
`turnaroundBar`/`turnaroundCells`, `swing: 0`. Before promoting past
`draft`, audition `stab-answer` and `sparse-space` (the least-sourced
placements) at lower relative weight, and compare
`slideOverlapBeats: 0.25` against the schema's smaller example epsilon.
