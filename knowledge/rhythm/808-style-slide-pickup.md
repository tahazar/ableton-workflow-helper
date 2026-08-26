---
slug: 808-style-slide-pickup
topic: rhythm
tier: draft
tags: [trap, hip-hop, 808, bass, slide, style-spec]
sources: ["https://create.routenote.com/blog/how-to-make-trap-beats-pt-3-808-basslines/", "https://itsgratuitous.com/how-to-slide-808s-in-fl-studio/", "https://www.productionmusiclive.com/blogs/news/trap-beat-guide-bass-essential-tips-for-making-808-patterns", "https://www.iconcollective.edu/808-mixing-tips"]
related: [rhythm/808-bass-craft, rhythm/waivops-drum-stats-pilot, sound-design/operator-recipe-glide-bass, rhythm/drum-style-hybrid-trap]
---
# 808 style: slide-pickup (long root, 5th pickup, slide into the downbeat)

**Sourcing note (this session):** built from search-excerpt research (page
fetches egress-blocked) — same caveat as `rhythm/808-bass-craft`, which this
entry's prose cites back to throughout. Every constructed (non-sourced)
number below is flagged inline; nothing here claims to be a measurement.

## The idiom this encodes

`rhythm/808-bass-craft` [sourced] documents three converging, source-backed
facts this style spec is built to satisfy at once: (1) a long root note
holding through most of the bar is the idiomatic sustain baseline, with the
tempo/energy-dependent stab alternative offered as a second, sparser cell;
(2) the sourced pickup convention is a short note jumping from the root
"up to the 5th" in the bar's tail (create.routenote.com); (3) that pickup
note slides — overlaps — into the next bar's downbeat, the same
overlap-triggers-glide mechanic described identically across the FL Studio/
GarageBand/REAPER tutorials cited in that entry. Three cells are offered
because `808-bass-craft` explicitly found NO single canonical placement or
long-vs-stab ratio — per the pinned schema's "curated freedom" design (see
`docs/design/bass-808.md`), this style proposes plausible alternatives to
audition, not one invented "correct" pattern.

## Cell-by-cell rationale

- **`long-root-pickup`** (the sourced baseline, given the highest weight):
  a long root sustain (`pos:0, len:2.75, degree:0`) followed by a 5th
  pickup (`degree:7`) in the bar's last beat that slides (`slide:true`)
  into whatever the next bar's cell opens on. The `degree:7` value is
  directly sourced (routenote's "jumping up to the 5th in pickup notes");
  the exact `pos:3`/`len:2.75` split and the `weight:4` are this agent's
  construction — no source gives a numeric bar-fraction for how long the
  root holds before the pickup.
- **`stab-answer`** (the tempo/energy-dependent alternative):
  `808-bass-craft` reports the long-vs-stab choice tracks tempo/energy
  rather than a fixed rule, and separately reports off-kick syncopation as
  a named (if unquantified) variation technique. This cell encodes both as
  one alternative: two short root stabs early in the bar
  (`pos:0`/`pos:0.75`, both `len:0.5`), a short 5th note at `pos:2`, then
  the same slide-into-next-bar pickup as `long-root-pickup`. All four
  positions/lengths and the `weight:2` are constructed — sourced as "a
  short-stab idiom exists and syncopation is used for tension", not as
  these specific sixteenth-grid placements.
- **`sparse-space`** (the "leave space" cell, lowest weight): a single
  long root note (`pos:0, len:2.0, degree:0`) with the entire back half of
  the bar left silent — no pickup, no slide. This directly encodes
  `808-bass-craft`'s sourced "leave space" claim
  (productionmusiclive.com: "a sparse 808 bassline can give the rest of
  the beat a chance to breathe") as a literal, drawable cell rather than
  leaving space only as prose advice. `len:2.0` and `weight:1` (rarest of
  the three) are this agent's construction — no source gives a numeric
  silence-duration or a frequency for how often a "space" bar should occur
  relative to the other two.

`degrees: [0, 7]` is deliberately narrow — root and 5th are the only two
scale-degrees any source in this session actually named for 808 pickup
motion. Octave (`12`) and other extensions are real, common 808-line moves
in general trap practice but were not specifically sourced this session for
the pickup convention, so they are left OUT of the validation set here
rather than padded in as unsourced flexibility; widen `degrees` deliberately
(as a reviewed edit) if auditioning shows the pattern wants an octave jump.

`register: [24, 36]` (C1-C2) sits inside, and conservative relative to, the
one sourced range claim found — "stay within the sub-bass to upper-bass
range (roughly C1 to G2) to maintain the characteristic 808 weight"
(iconcollective.edu) — narrowed to C1-C2 to match the pinned schema's own
example register rather than stretching to the full sourced C1-G2 span.

## Key-tracking note (a mixing-layer decision, not a pattern-layer one)

This spec's `degree`/`register` fields only place NOTES relative to a
fitted root — they say nothing about which physical 808 SAMPLE's own
fundamental gets tuned to what. `808-bass-craft` documents that as a
separate, disputed practice (tune the sample to the song key, vs. the
arXiv/ISMIR-sourced finding that at least one professional workflow bends
the song's key to the 808 sample's own narrow usable pitch range) — read
that entry before picking a root/key for `awh bass 808`, this spec only
covers what happens once a root is chosen.

## Slide overlap: a sourced value, bigger than the schema's own example

The pinned schema's own example (`docs/design/bass-808.md`) shows
`slideOverlapBeats: 0.05` — a small legato-TRIGGER epsilon, just enough for
a mono synth's glide to fire. One source in `808-bass-craft` gives an
actual number for the overlap a producer draws for a "tight, snappy" slide
specifically: a full 1/16th note (itsgratuitous.com) — 0.25 beats at any
tempo, five times the schema example's epsilon. This entry uses the
SOURCED value (`slideOverlapBeats: 0.25`) rather than the schema
example's epsilon — see the schema feedback below, this is flagged as a
genuine discrepancy worth the owner's attention, not silently resolved.

## Swing: not claimed for this pattern layer

No source found this session describes an 808 BASSLINE (as opposed to hi-
hats) as swung. The one adjacent, actually-measured number is
`rhythm/waivops-drum-stats-pilot` [sourced]'s full-n trap hi-hat finding
(off-16ths landing +0.0216 beats late at n=15,000) — a real measurement,
but of hats, not of 808 bass notes, and not a claim this style spec's
`swing: 0` contradicts or confirms. `swing: 0` here reflects the absence of
a bassline-specific claim, not a sourced fact that 808 basslines are never
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

Every number above is either directly sourced (`degree: 7` as the pickup
target; `slideOverlapBeats: 0.25` as the "tight, snappy" 1/16-note overlap;
`register` narrowed inside the sourced C1-G2 range) or this agent's
construction flagged in the rationale above (all `pos`/`len`/`weight`
values, `velocity`, `turnaroundBar`/`turnaroundCells`, `swing: 0`).
Audition `stab-answer` and `sparse-space` at lower relative weight first
(they are the least-sourced-placement cells) and compare
`slideOverlapBeats: 0.25` against the schema's smaller example epsilon
before promoting this past `draft` — see schema feedback in the seeding
report for the discrepancy this choice surfaces.
