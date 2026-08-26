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

**Sourcing note (this session):** page fetches were mostly blocked; research
went through web-search excerpts (same constraint as this topic's other new
entries). The mechanical definition of "ratchet" is well corroborated across
several sequencer-technique pages. The genre-lineage framing this entry was
asked to cover (psy/techno, Berlin-school) turned out THIN on ratchet-
specific technical detail once searched directly — Berlin-school material
talks about sequences and delay/reverb treatment in general, not ratchet
counts or placement, and psytrance-specific searches returned sample-pack
marketing rather than technique writing. **The one genuinely detailed,
numeric source on ratchet PLACEMENT and RESTRAINT this session found is
about trap hi-hat rolls, not psy/techno** — cited plainly as such below and
used for the general placement/restraint principle, not as a psy/techno
fact.

## The rule

### What a ratchet actually is, mechanically

"Ratcheting is a 'subdivision' adjustment... it allows you to add trills and
note flurries that are shorter than the chosen division, without adjusting
the clock speed or note division" — a ratcheted step repeats at a faster
internal subdivision while the sequencer's own clock and the surrounding
steps stay put (Sweetwater InSync, "How to Ratchet Notes in a Step
Sequencer"). A modular-synthesis walkthrough describes the equivalent
patch mechanically: an occasional trigger opens a gate for a set duration
("two clock pulses long," in its example) which lets a faster ratchet
clock through for exactly that many repeats before closing again
(learningmodular.com, "Patching a Ratcheting Sequence"). Both sources agree
on the core shape the pinned schema already captures: one step position,
subdivided into N equal repeats, rather than a change to the underlying
grid — exactly what `ratchets: {stepIndex: count}` encodes.

### Counts: 2-3 is the documented range; nothing sourced this session goes to 4

Sweetwater notes some hardware sequencers expose "a 'ratchet' setting of 2,
3, or 4 gates per step" as adjustable options — so 4 is a real, implemented
option on real gear, not invented. But no source in this session described
4-count ratchets as the MUSICAL default or a commonly reached-for choice;
every worked example actually discussed (the modular patch's "two clock
pulses," the trap-roll guidance below) uses 2 or 3. Read this entry's
"rarely 4" framing as an inference from what sources actually reach for in
practice, not a documented ceiling — 4 is available in the schema
(`ratchets` accepts 2/3/4 per the pinned spec) and not forbidden, just
under-attested as a default choice.

### Placement and restraint — sourced from trap hats, applied here as general craft

This session found no psy/techno-specific source on WHERE ratchets land or
how often. The clearest sourced placement/restraint guidance for
fast-roll rhythmic devices generally came from a trap hi-hat production
guide: "1/32 and 1/64 rolls are reserved for transitions and snare
pickups... hi-hat rolls are used before a new bar to guide the listener to
the next beat of the snare or kick" — i.e. rolls land at phrase/pattern
BOUNDARIES (the tail of a cell, right before the next downbeat), not
scattered through the middle of a groove (theghostproduction.com, "Trap
hats: 7 Rules For Cleaner Rolls"). The same source is explicit about
restraint being the actual skill: "fast rolls only work when they answer
the groove," "a 1/64 burst before every snare gets boring by bar five," and
"strong trap hats usually use one obvious roll per 2-bar phrase, then
smaller ghost notes to pull the ear forward." Read that as the general
principle this entry generalizes beyond trap: **one ratchet event per
phrase, positioned at the tail/pre-downbeat, is a device that still reads
as a decision; ratcheting every few steps stops reading as anything.**
This is an explicit genre-crossing extrapolation — trap-hat sourcing
applied to a psy/techno-framed entry — not a claim that Berghain-style
techno or psytrance producers follow this exact rule.

### Why the tail/pre-downbeat position works with the schema's semantics

The pinned schema resolves `ratchets` against PATTERN POSITION (steps
0-indexed within `patternLength`), independent of which chord or bar is
currently sounding. That means a ratchet fixed at, say, step 14 of a
16-step pattern lands on the same relative position — the last 16th before
the next cycle — every time the pattern repeats, regardless of harmony.
That is a good structural match for "ratchet at the pre-downbeat tail":
the device becomes a recurring pattern-level punctuation mark rather than
a per-bar random event, which is the same "curated, held-per-loop" shape
`rhythm/drum-style-dubstep` and the trap-family kick-cell model already use
for their locked, non-random-per-bar craft choices.

### Berlin-school note (thin — flagged, not built on)

Berlin-school sequencer material (Gearspace's "What is Berlin School?"
thread) describes the lineage's basic sound — "the style is based around
repetitive short sequences and arps that slowly change and are often run
through delay and reverb," with a claim that ratcheting there is achieved
by "setting a sequencer to 32 or 64 steps using shorter note lengths, then
spacing out the normal sequence to create ratcheting repetitions." That is
a real, named technique (over-resolving the sequencer and leaving gaps),
but it is forum material, not a technical breakdown with placement/count
specifics, and this session found nothing to corroborate it further. It's
included here as a documented ALTERNATIVE way to get a ratchet-like result
(over-resolve the whole grid rather than subdivide single steps) — worth
knowing about, not built into the executable block below, since the pinned
schema's `ratchets` field already does the single-step-subdivide version
more directly.

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

Every value here is this agent's construction translating the sourced
placement/restraint principle into the schema, not a measured pattern.
`euclid: {k: 13, n: 16}` thins 3 of the 16 steps (a moderate, not extreme,
thinning — see `rhythm/euclidean-rhythm-craft` for how E(k,16) choices
compare) to leave room for the ratchets to read as events rather than get
buried in a fully dense grid. The two ratchets sit at steps 13 and 15 — the
pattern's last few 16ths, i.e. the tail immediately before the cycle wraps
back to step 0 — one restrained 2-count and one slightly busier 3-count
right at the pre-downbeat position, per the "rolls at phrase boundaries,
rarely more than one per phrase" reading above. `accentSteps: [0, 15]`
gives the wrap-around downbeat its lift and puts a second accent on the
final ratcheted step so the roll actually lands with intent rather than
trailing off. Treat 2 counts before 3 counts (not the reverse) as this
entry's own choice — a small crescendo into the downbeat — since no source
specified an ordering between multiple ratchets in one tail.
