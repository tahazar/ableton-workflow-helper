---
slug: arp-style-trance-16ths
topic: rhythm
tier: draft
tags: [trance, uplifting-trance, arp, 16ths, style-spec]
sources:
  - "https://tranceproducer.co.uk/blogs/news/how-to-write-trance-melodies-and-arps-from-scratch"
  - "https://www.myloops.net/how-to-make-a-big-trance-arp-lead"
  - "https://www.edmprod.com/arpeggiators/"
  - "https://allanmorrowstudios.com/trance-music/trance-arpeggios-tutorial/"
  - "https://theproducerschool.com/blogs/featured-blogs/5-essential-bass-patterns-that-define-hard-house-and-trance-music"
related: [rhythm/arp-style-melodic-techno, rhythm/arp-ratchet-craft, rhythm/drum-style-dusty-garage, arrangement/phrase-style-lyny-flavor]
---
# Arp style: uplifting/classic trance 16ths

**Sourcing note (this session):** page fetches were mostly unavailable (per
this project's standing egress limits); research was done through the
web-search tool, which returns synthesized excerpts tied to named pages
rather than raw HTML — the same constraint and honesty policy as
`rhythm/dubstep-drum-pattern`. Two claims below trace cleanly to one named
page each (tagged inline). The rest — the "key variables" framing and the
sound-design description of the classic "plink" — came back aggregated
across a batch of production-tutorial pages without clean per-sentence
attribution; those are cited as a batch, not pretended to be one quote.
**No source gave a numeric gate value, velocity number, or accent-step list
for a trance arp specifically** (unlike the melodic-techno search, which did
surface one concrete numeric example — see `arp-style-melodic-techno`). The
`awh-arp-spec` values below are this agent's construction, built to match the
sourced qualitative description, not a transcription of a measured pattern.

## The rule

### The idiom: a small, repeating chord-tone shape, not a "solo"

Trance arpeggios are described consistently as pattern-first, not
melody-first: "a melody is a combination of a pattern and note changes,
where the pattern determines how notes are placed horizontally on the piano
roll (giving rhythm), and note changes determine how they're placed
vertically (making it melodic)" — the workflow given is to copy the voiced
chord progression straight into the arp channel and let the SAME pattern
play across every chord change (myloops.net, "How To Make A Big Trance Arp
Lead"). That is exactly the pinned schema's "chord changes re-select the
pitch pool at the chord boundary without resetting pattern position" — the
idiom is one fixed rhythmic pattern riding under a moving harmony, which is
what `patternLength`/`contour` decoupled from the chord clip already gives
for free.

### Contour: up-then-down through the voicing, not a random walk

The recurring description of the classic shape — corroborated across
tranceproducer.co.uk's "How to Write Trance Melodies & Arps from Scratch"
and echoed in several other production-tutorial pages returned alongside it
(myloops.net, beatkey.app, drumloopai.com) — is a **root, 3rd, 5th, octave,
then back down through 5th, 3rd** shape: a 4-note climb to the octave
followed by its own reversal, typically run at 16th notes (four notes per
beat). In the schema's terms that is `contour: updown` over a voicing
extended by octave copies — not `up` (no reversal), not `walk` (it's a fixed
shape, not a bounded random walk), and not `as-voiced` (it reorders/extends
the voicing rather than just cycling it bottom-to-top once).

### Octave span: two is the "sweeping" choice, one is the "compact" choice

The same aggregated batch names octave range as one of the handful of
levers that actually defines the character: "single octaves stay compact
and focused, while multi-octave arpeggios create sweeping, dramatic
movements" (tranceproducer.co.uk, corroborated across the batch). Classic
"uplifting" trance leans toward the sweeping read — hence `octaves: 2`
below — but this is explicitly a spectrum, not a rule with one correct
answer; drop to `octaves: 1` for a tighter, more contained arp.

### Rate: 16ths, played dense — the genre's default, not a special case

Every page in this batch that discussed rate at all used 16th notes at
four notes per beat as the default resolution ("a simple pattern playing
16th notes (1 note playing every 1/4th of a step) gives a fast paced
rhythm," myloops.net), which is why `rate: 1/16` and a full `euclid: {k:16,
n:16}` (no thinning — every step sounds) is the idiom's baseline rather than
a deliberately sparse choice. Thinning the grid (lower `k`) reads as a
different, sparser arp style, not this one.

### Gate and sound design: short-ish, plucky — described, not numbered

The batch (adsrsounds.com's Virus TI trance-gate tutorial, tranceproducer.co.uk,
myloops.net, allanmorrowstudios.com) converges on a "plink" character for the
lead/arp voice: detuning oscillators slightly (5-15 cents) for width, and "a
fast attack and medium decay on the filter envelope gives the classic trance
arp 'plink' — the note opens briefly and then closes." That is a synth-patch
description (filter envelope decay), not a sequencer gate-length number, but
it points toward a gate short enough to leave air between notes rather than
one that legatos into the next — `gate: 0.6` below is this agent's read of
"opens briefly and closes" onto the schema's 0-1 gate fraction, not a sourced
figure. EDMProd's arpeggiator page confirms gate is one of the standard
levers ("'Gate' lets you shorten or lengthen each note... a crucial parameter
for controlling the articulation") without giving a trance-specific number
either.

### Accent placement and the "rolling" feel: adjacent evidence only

No source in this session gave a velocity/accent NUMBER or step list for a
trance arp specifically. EDMProd's arpeggiator page confirms accenting
specific notes is standard practice ("the 'Velocity' section is a cool way
to accentuate certain notes... add dynamics and emphasis to specific notes
in your arpeggio pattern") without naming which notes. The "rolling," always
in-motion character commonly attributed to trance's sequenced parts is best
evidenced one layer over, on the BASSLINE rather than the arp: a 1/16
rolling bass pattern is described as "the foundation of the classic trance
sound," with "movement notes (5th, then 3rd) falling on offbeats" giving the
bass "its trademark rolling energy" (theproducerschool.com, "5 Essential
Bass Patterns That Define Hard House and Trance Music"). Treat that as
corroborating the GENRE'S general appetite for continuous, offbeat-active
16th motion across its sequenced parts, not as a sourced arp accent map —
the `accentSteps` below (one soft downbeat lean per beat) are this agent's
own construction, offered as a reasonable default to audition and retune,
not a documented trance technique.

### Swing: not claimed

Nothing in this session's sources described a trance arp as swung; the
genre's sequenced parts are generally described as driving and metronomic
rather than shuffled (unlike, say, garage — see `rhythm/burial-swing-feel`
[sourced] for a genre where swing genuinely is the documented technique).
`swing: 0` below reflects the absence of a claim, not a positive sourced
fact that trance arps are never swung.

## Executable

```awh-arp-spec
name: trance-16ths
contour: updown
octaves: 2
rate: 1/16
gate: 0.6
patternLength: 16
euclid: {k: 16, n: 16, rotate: 0}
rests: []
ratchets: {}
velocity:
  base: 100
  accentSteps: [0, 4, 8, 12]
  accentBoost: 20
  shape: none
swing: 0
```

Every value above except `rate: 1/16` and `contour: updown` (both directly
supported by the sourced description) is this agent's construction —
`octaves`, `gate`, the accent map, and `swing: 0` are a plausible reading of
the sourced qualitative claims, not measurements. Audition against
`octaves: 1` (compact reading) and a shorter `gate` (~0.4-0.5, more
"plink"-forward) as the two most obvious retuning knobs before promoting
this past `draft`.
