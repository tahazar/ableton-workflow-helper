---
slug: arp-style-melodic-techno
topic: rhythm
tier: draft
tags: [melodic-techno, afterlife, arp, 16ths, style-spec]
sources:
  - "https://theproducerschool.com/blogs/featured-blogs/how-to-make-melodic-techno-like-mrak-afterlife"
  - "https://audioservices.studio/production/arpeggios-technical-dive"
  - "https://www.attackmagazine.com/technique/beat-dissected/deep-melodic-progressive-techno/"
  - "https://www.scribd.com/article/558057713/Arpeggios-For-Melodic-Techno"
  - "https://www.samplesoundmusic.com/blogs/academy/create-a-melodic-techno-arp"
related: [rhythm/arp-style-trance-16ths, rhythm/arp-style-ratchet, arrangement/phrase-style-lyny-flavor, rhythm/euclidean-rhythm-craft]
---
# Arp style: melodic techno long-cycle, off-accent 16ths

**Sourcing note (this session):** same constraint as `rhythm/dubstep-drum-
pattern` and `rhythm/arp-style-trance-16ths` — page fetches were mostly
blocked, research went through web-search excerpts. **Treat this entry as
arms-length from Tale Of Us/Afterlife specifically**, the same honesty stance
`arrangement/phrase-style-lyny-flavor` takes toward LYNY: no interview or
technical breakdown surfaced that describes how Tale Of Us, or Afterlife
artists generally, actually build an arp. What DID surface is (a) one
concrete numeric arp example attributed to a named melodic-techno record in
Beat Magazine, (b) a genre-level structural claim about cycle length from a
named Afterlife-artist tutorial (MRAK, not Tale Of Us), and (c) generic
arpeggiator-technique material that happens to appear in melodic-techno
search results without being melodic-techno-specific. All three tiers are
kept visibly separate below.

## The rule

### The one concrete numeric example this session found

A Beat Magazine feature on Space 92 — cited via its Scribd excerpt,
"Arpeggios For Melodic Techno" — describes his track "The Game" as built
around "an arpeggio of 16th notes with the notes D, E, F and G in the
hookline": a short, stepwise (not wide-interval) four-note ascending cell at
16th-note rate. This is the ONE sourced, named, numeric arp example in this
session for the genre — but it is Space 92's "The Game," not a Tale Of
Us/Afterlife track, so read it as "a melodic-techno arp that got written
about," not as "the Afterlife arp." The stepwise D-E-F-G shape (seconds, not
thirds) is notably narrower-interval than the trance root-3rd-5th-octave
shape in `rhythm/arp-style-trance-16ths` — worth flagging as a genuine
genre contrast rather than assuming all dance-music arps share one contour
family.

### Long cycle length: sourced to a specific Afterlife-adjacent artist, not the whole label

The Producer School's tutorial on making melodic techno "like MRAK
(Afterlife)" states plainly that the arp "loops for eight bars and somehow
gets more hypnotic instead of boring" — an explicit claim that the cycle is
long (8 bars, not 1-2) and that length itself is doing expressive work
(repetition-as-hypnosis, not repetition-as-filler). This is the strongest
single claim behind this entry's `patternLength` being large rather than a
one-bar loop. It is sourced to MRAK specifically (one Afterlife-adjacent
artist's technique per one tutorial), not corroborated across multiple
named Tale Of Us sources, so treat "eight-bar cycle" as a real, named,
single-source claim — solid, but singular.

### Off-accents and sparse velocity: one aggregated numeric example, not independently corroborated

A web-search aggregate (spanning Pheek's "Arpeggios Technical Dive," Attack
Magazine's "Deep & Melodic Progressive Techno" Beat Dissected, EDMProd's
techno guide, a Beatportal step-by-step melodic-house/techno guide, and
Samplesound's "Create a Melodic Techno Arp" tutorial) returned this specific
worked example: **"an A minor arpeggio programmed as A-C-E-A in 16th notes
with 65% gate, setting strong velocity on beats 1 and 3 (110), medium on
off-beats (85), and subtle on 16th fills (65)."** This is the numeric core
this entry's executable block leans on hardest, but it came back as one
synthesized answer over five different pages with no single page named as
its origin — same "batch, not a pinpoint quote" caveat as
`rhythm/dubstep-drum-pattern`'s kick/snare skeleton section. Read "strong on
1 and 3, medium on off-beats, subtle on fills" as the off-accent shape this
entry's `velocity.accentSteps` encodes, and 65% as the sourced gate figure —
both genuinely numeric, neither pinned to one nameable article.

### Evolving instead of varying: pads over arps, but the principle generalizes

The same aggregate describes evolution happening mainly through **filter
automation over long spans** rather than through changing the note pattern:
"layering 2-3 pad sounds... with automation to evolve the filter cutoff over
16 bars is a common approach," and separately, "modulating filter cutoffs,
resonance, and envelope parameters in real-time" is how arpeggios
specifically are said to "evolve and transform throughout a track." That is
sound-design/automation territory the `awh-arp-spec` schema doesn't reach
(no filter/automation field) — noted here as a real limitation of what a
pattern-position spec can express for this idiom (see schema-feedback note
below), not fabricated into a spec field that doesn't exist.

### Lower octave count: inferred from the sourced chord tones, not independently stated

The MRAK tutorial names the chord-tone material as "minor six chords, using
the first note, the third note of the scale, the fifth note and the sixth
note" — four chord tones, no source describing them being thrown up two or
three octaves the way the trance entry's "sweeping" description does.
Combined with the D-E-F-G example above staying within a single octave,
this entry's `octaves: 1` is a reasonable inference from what both sourced
examples actually show (compact range), not a separately stated "melodic
techno arps use one octave" rule.

## Executable

```awh-arp-spec
name: melodic-techno-off-accent-16ths
contour: up
octaves: 1
rate: 1/16
gate: 0.65
patternLength: 32
euclid: {k: 16, n: 16, rotate: 0}
rests: []
ratchets: {}
velocity:
  base: 85
  accentSteps: [0, 8, 16, 24]
  accentBoost: 25
  shape: none
swing: 0
```

`gate: 0.65` and the accent split (base 85 = the sourced "medium
off-beats/subtle fills" range, `accentSteps` boosted to ~110 = the sourced
"strong on beats 1 and 3") are the direct translation of the one numeric
example above, repeated once per bar across a 2-bar (`patternLength: 32`)
cycle — longer than the trance entry's one-bar 16, and still sparse (4 of
32 positions accented). That 2-bar figure is this agent's compromise, not a
sourced number: the sourced "eight bars, hypnotic" claim describes the
ARRANGEMENT loop (how long before the part meaningfully changes via filter
automation), not necessarily the `patternLength` field's narrower meaning
(the accent/rest/ratchet cycle in steps) — a true 8-bar `patternLength`
(128 steps at 1/16 in 4/4) would only matter if the accent map varied
bar-to-bar, and no source describes that; both sources describe a SHORT
repeating note cell (D-E-F-G; A-C-E-A) inside a long hypnotic arrangement
loop. `patternLength: 32` is offered as a reasonable middle value to
audition — the honest gap is that the "eight-bar" claim lives at the
arrangement/automation grain, not the pattern-position grain this schema
currently expresses (see schema feedback in the seeding report).
