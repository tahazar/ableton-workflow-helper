---
slug: arp-style-ratchet
topic: rhythm
tier: draft
tags: [ratchet, roll, techno, psytrance, berlin-school, sequencer, arp, style-spec]
sources:
  - "https://www.sweetwater.com/insync/how-to-ratchet-notes-in-a-step-sequencer/"
  - "https://learningmodular.com/patching-a-ratcheting-sequence/"
  - "https://gearspace.com/board/electronic-music-instruments-and-electronic-music-production/943214-what-berlin-school.html"
  - "https://theghostproduction.com/trap-hats-cleaner-rolls-hard-bounce/"
related: [rhythm/arp-style-trance-16ths, rhythm/arp-style-melodic-techno, rhythm/euclidean-rhythm-craft, rhythm/drum-style-hybrid-trap]
---
# Ratchets/rolls as a rhythmic device

**Sourcing note:** research went through search excerpts, like this
topic's other entries. The mechanical definition of "ratchet" is well
corroborated across several sequencer-technique pages. The genre lineage
(psy/techno, Berlin-school) is thin on ratchet-specific detail: Berlin-school
material covers sequences and delay/reverb treatment in general, not ratchet
counts or placement, and psytrance searches returned sample-pack marketing
rather than technique writing. The one detailed, numeric source on ratchet
placement and restraint is about trap hi-hat rolls, not psy/techno. It is
cited as such and used for the general principle, not as a psy/techno fact.

## The rule

### What a ratchet is, mechanically

"Ratcheting is a 'subdivision' adjustment... it allows you to add trills and
note flurries that are shorter than the chosen division, without adjusting
the clock speed or note division." A ratcheted step repeats at a faster
internal subdivision while the clock and surrounding steps stay put
(Sweetwater InSync, "How to Ratchet Notes in a Step Sequencer"). A modular
walkthrough describes the equivalent patch: an occasional trigger opens a
gate for a set duration ("two clock pulses long" in its example), letting a
faster ratchet clock through for that many repeats (learningmodular.com,
"Patching a Ratcheting Sequence"). Both agree on the shape the schema
captures: one step position subdivided into N equal repeats, with the
underlying grid unchanged. That is what `ratchets: {stepIndex: count}`
encodes.

### Counts: 2-3 is the documented range; nothing sourced goes to 4

Sweetwater notes some hardware sequencers offer "a 'ratchet' setting of 2,
3, or 4 gates per step", so 4 exists on real gear. No source describes
4-count ratchets as a musical default. Every worked example (the modular
patch's "two clock pulses", the trap-roll guidance below) uses 2 or 3.
"Rarely 4" is an inference from what sources reach for, not a documented
ceiling. The schema accepts 2/3/4 and 4 is not forbidden, just
under-attested.

### Placement and restraint: sourced from trap hats, applied here as general craft

No psy/techno-specific source covers where ratchets land or how often. The
clearest placement/restraint guidance for fast-roll devices comes from a
trap hi-hat guide: "1/32 and 1/64 rolls are reserved for transitions and
snare pickups... hi-hat rolls are used before a new bar to guide the
listener to the next beat of the snare or kick". Rolls land at phrase or
pattern boundaries (a cell's tail, right before the next downbeat), not
mid-groove (theghostproduction.com, "Trap hats: 7 Rules For Cleaner
Rolls"). The same source treats restraint as the skill: "fast rolls only
work when they answer the groove", "a 1/64 burst before every snare gets
boring by bar five", and "strong trap hats usually use one obvious roll per
2-bar phrase, then smaller ghost notes to pull the ear forward". This entry
generalizes that beyond trap: **one ratchet per phrase, at the
tail/pre-downbeat, reads as a decision; ratcheting every few steps reads as
nothing.** This is an explicit genre-crossing extrapolation, not a claim
that Berghain-style techno or psytrance producers follow this rule.

### Why the tail/pre-downbeat position works with the schema's semantics

The schema resolves `ratchets` against pattern position (0-indexed steps
within `patternLength`), independent of the sounding chord or bar. A
ratchet at step 14 of a 16-step pattern lands on the last 16th before the
next cycle on every repeat, regardless of harmony. That fits "ratchet at
the pre-downbeat tail": the device becomes recurring pattern-level
punctuation, not a per-bar random event. It is the same curated,
held-per-loop shape `rhythm/drum-style-dubstep` and the trap-family
kick-cell model use for their locked craft choices.

### Berlin-school note (thin, flagged, not built on)

Gearspace's "What is Berlin School?" thread describes the lineage's sound:
"the style is based around repetitive short sequences and arps that slowly
change and are often run through delay and reverb". It claims ratcheting
there comes from "setting a sequencer to 32 or 64 steps using shorter note
lengths, then spacing out the normal sequence to create ratcheting
repetitions". That is a named technique (over-resolve the grid and leave
gaps), but it is forum material without placement/count specifics, and
nothing corroborates it. It is a documented alternative route to a
ratchet-like result. The executable block does not use it, since the
schema's `ratchets` field does single-step subdivision directly.

## Executable

```awh-arp-spec
name: ratchet-tail-thin-16ths
contour: up
octaves: 1
rate: 1/16
gate: 0.55
patternLength: 16
euclid: {k: 13, n: 16, rotate: 0}
rests: []
ratchets: {13: 2, 15: 3}
velocity:
  base: 90
  accentSteps: [0, 15]
  accentBoost: 20
  shape: none
swing: 0
```

Every value is authored, translating the sourced placement/restraint
principle into the schema. It is not a measured pattern.
`euclid: {k: 13, n: 16}` thins 3 of 16 steps (moderate thinning; see
`rhythm/euclidean-rhythm-craft` for how E(k,16) choices compare) so the
ratchets read as events instead of getting buried in a dense grid. The
ratchets sit at steps 13 and 15, the tail right before the cycle wraps to
step 0: one restrained 2-count and one busier 3-count at the pre-downbeat,
per "rolls at phrase boundaries, rarely more than one per phrase".
`accentSteps: [0, 15]` lifts the wrap-around downbeat and accents the final
ratcheted step so the roll lands with intent. Putting the 2-count before the
3-count (a small crescendo into the downbeat) is this entry's own choice; no
source specifies an ordering between ratchets in one tail.
