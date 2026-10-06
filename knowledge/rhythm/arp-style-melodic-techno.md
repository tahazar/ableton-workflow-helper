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

**Sourcing note:** research went through search excerpts, as in
`rhythm/dubstep-drum-pattern` and `rhythm/arp-style-trance-16ths`. This
entry is arms-length from Tale Of Us/Afterlife specifically, the same stance
`arrangement/phrase-style-lyny-flavor` takes toward LYNY: no interview or
technical breakdown describes how Tale Of Us, or Afterlife artists
generally, build an arp. What the sources do give is (a) one numeric arp
example from a named melodic-techno record in Beat Magazine, (b) a
genre-level cycle-length claim from a tutorial on a named Afterlife artist
(MRAK, not Tale Of Us), and (c) generic arpeggiator technique that appears
in melodic-techno search results without being genre-specific. The three
tiers are kept separate below.

## The rule

### The one concrete numeric example

A Beat Magazine feature on Space 92 (cited via its Scribd excerpt,
"Arpeggios For Melodic Techno") describes his track "The Game" as built
around "an arpeggio of 16th notes with the notes D, E, F and G in the
hookline": a short, stepwise four-note ascending cell at 16th-note rate.
It is the only sourced, named, numeric arp example for the genre, and it is
Space 92, not Tale Of Us/Afterlife. Read it as "a melodic-techno arp that
got written about", not "the Afterlife arp". The stepwise D-E-F-G shape
(seconds, not thirds) is narrower than the trance root-3rd-5th-octave shape
in `rhythm/arp-style-trance-16ths`, a real genre contrast: dance-music arps
do not share one contour family.

### Long cycle length: sourced to one Afterlife-adjacent artist, not the whole label

The Producer School's tutorial on making melodic techno "like MRAK
(Afterlife)" says the arp "loops for eight bars and somehow gets more
hypnotic instead of boring". The cycle is long (8 bars, not 1-2) and the
length does expressive work (repetition as hypnosis, not filler). This is
the main support for a large `patternLength` instead of a one-bar loop. It
is one tutorial about one artist, not corroborated across named Tale Of Us
sources: solid, but single-source.

### Off-accents and sparse velocity: one aggregated numeric example, not independently corroborated

A search aggregate spanning Pheek's "Arpeggios Technical Dive", Attack
Magazine's "Deep & Melodic Progressive Techno" Beat Dissected, EDMProd's
techno guide, a Beatportal melodic-house/techno guide, and Samplesound's
"Create a Melodic Techno Arp" returned this worked example: **"an A minor
arpeggio programmed as A-C-E-A in 16th notes with 65% gate, setting strong
velocity on beats 1 and 3 (110), medium on off-beats (85), and subtle on
16th fills (65)."** The executable block leans on it hardest, but it is one
synthesized answer over five pages with no single page named as its origin
(the same caveat as `rhythm/dubstep-drum-pattern`'s kick/snare skeleton).
"Strong on 1 and 3, medium on off-beats, subtle on fills" is the off-accent
shape `velocity.accentSteps` encodes, and 65% is the sourced gate. Both are
numeric, neither is pinned to one article.

### Evolving instead of varying: pads over arps, but the principle generalizes

The same aggregate says evolution happens mainly through filter automation
over long spans, not note changes: "layering 2-3 pad sounds... with
automation to evolve the filter cutoff over 16 bars is a common approach",
and arpeggios "evolve and transform throughout a track" by "modulating
filter cutoffs, resonance, and envelope parameters in real-time". The
`awh-arp-spec` schema has no filter or automation field, so a
pattern-position spec cannot express this part of the idiom. It is noted
here, not faked into a field.

### Lower octave count: inferred from the sourced chord tones, not independently stated

The MRAK tutorial names the chord tones as "minor six chords, using the
first note, the third note of the scale, the fifth note and the sixth note":
four tones, with no source describing them spread over two or three octaves
the way the trance entry's "sweeping" description does. With the D-E-F-G
example also staying within one octave, `octaves: 1` is an inference from
both examples' compact range, not a stated rule.

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

`gate: 0.65` and the accent split translate the numeric example directly:
base 85 is the sourced "medium off-beats/subtle fills" range, and
`accentSteps` boosted to ~110 is the sourced "strong on beats 1 and 3",
repeated per bar across a 2-bar (`patternLength: 32`) cycle. That is longer
than the trance entry's one-bar 16 and still sparse (4 of 32 positions
accented). The 2-bar figure is an authored compromise. The sourced "eight
bars, hypnotic" claim describes the arrangement loop (how long before the
part changes via filter automation), not `patternLength`'s narrower meaning
(the accent/rest/ratchet cycle in steps). A true 8-bar `patternLength` (128
steps at 1/16 in 4/4) would matter only if the accent map varied bar to bar,
and no source describes that. Both sources describe a short repeating cell
(D-E-F-G; A-C-E-A) inside a long hypnotic arrangement loop.
`patternLength: 32` is a middle value to audition. The open gap is that the
"eight-bar" claim lives at the arrangement/automation grain, which this
schema does not express.
