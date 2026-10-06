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
related: [rhythm/arp-style-melodic-techno, rhythm/arp-style-ratchet, rhythm/drum-style-dusty-garage, arrangement/phrase-style-lyny-flavor]
---
# Arp style: uplifting/classic trance 16ths

**Sourcing note:** research went through search excerpts tied to named
pages rather than full-page reads, as in `rhythm/dubstep-drum-pattern`. Two
claims trace to one named page each (tagged inline). The rest (the "key
variables" framing and the sound-design description of the classic "plink")
came back aggregated across several production tutorials and is cited to
the group. No source gave a numeric gate, velocity or accent-step list for a
trance arp (unlike melodic techno, where one numeric example exists; see
`arp-style-melodic-techno`). The `awh-arp-spec` values are authored to match
the sourced qualitative description, not transcribed from a measured
pattern.

## The rule

### The idiom: a small, repeating chord-tone shape, not a "solo"

Trance arps are pattern-first: "a melody is a combination of a pattern and
note changes, where the pattern determines how notes are placed
horizontally on the piano roll (giving rhythm), and note changes determine
how they're placed vertically (making it melodic)". The workflow copies the
voiced chord progression into the arp channel and lets the same pattern run
across every chord change (myloops.net, "How To Make A Big Trance Arp
Lead"). This matches the schema's "chord changes re-select the pitch pool at
the chord boundary without resetting pattern position": one fixed rhythmic
pattern under a moving harmony, which `patternLength`/`contour` (decoupled
from the chord clip) already provide.

### Contour: up-then-down through the voicing, not a random walk

The classic shape, from tranceproducer.co.uk's "How to Write Trance Melodies
& Arps from Scratch" and echoed by other tutorials (myloops.net,
beatkey.app, drumloopai.com), is **root, 3rd, 5th, octave, then back down
through 5th, 3rd**: a 4-note climb and its reversal, usually at 16ths (four
notes per beat). In schema terms that is `contour: updown` over a voicing
extended by octave copies. Not `up` (no reversal), not `walk` (it is a fixed
shape), not `as-voiced` (it reorders and extends the voicing).

### Octave span: two is the "sweeping" choice, one is the "compact" choice

The same group names octave range as a defining lever: "single octaves stay
compact and focused, while multi-octave arpeggios create sweeping, dramatic
movements" (tranceproducer.co.uk, corroborated across the group). Uplifting
trance leans sweeping, hence `octaves: 2`. It is a spectrum; drop to
`octaves: 1` for a tighter arp.

### Rate: 16ths, played dense, the genre default

Every page that discussed rate used 16ths at four notes per beat ("a simple
pattern playing 16th notes (1 note playing every 1/4th of a step) gives a
fast paced rhythm", myloops.net). So `rate: 1/16` with a full
`euclid: {k:16, n:16}` (every step sounds) is the baseline. Thinning the
grid (lower `k`) makes a different, sparser style.

### Gate and sound design: short-ish, plucky, described but not numbered

The group (adsrsounds.com's Virus TI trance-gate tutorial,
tranceproducer.co.uk, myloops.net, allanmorrowstudios.com) converges on a
"plink" lead/arp voice: oscillators detuned 5-15 cents for width, and "a
fast attack and medium decay on the filter envelope gives the classic trance
arp 'plink' — the note opens briefly and then closes." That describes a
filter envelope, not a sequencer gate length, but it points to a gate short
enough to leave air between notes. `gate: 0.6` is an authored reading of
"opens briefly and closes" onto the 0-1 gate fraction. EDMProd's
arpeggiator page confirms gate is a standard lever ("'Gate' lets you shorten
or lengthen each note... a crucial parameter for controlling the
articulation") without a trance-specific number.

### Accent placement and the "rolling" feel: adjacent evidence only

No source gave a velocity/accent number or step list for a trance arp.
EDMProd confirms accenting specific notes is standard ("the 'Velocity'
section is a cool way to accentuate certain notes... add dynamics and
emphasis to specific notes in your arpeggio pattern") without naming which.
The "rolling", always-moving character of trance's sequenced parts is
evidenced on the bassline instead: a 1/16 rolling bass is "the foundation
of the classic trance sound", with "movement notes (5th, then 3rd) falling
on offbeats" giving "its trademark rolling energy" (theproducerschool.com,
"5 Essential Bass Patterns That Define Hard House and Trance Music"). That
supports the genre's appetite for continuous, offbeat-active 16th motion,
not an arp accent map. The `accentSteps` (one soft downbeat lean per beat)
are authored, a default to audition and retune.

### Swing: not claimed

No source described a trance arp as swung. The genre's sequenced parts are
described as driving and metronomic (unlike garage; see
`rhythm/burial-swing-feel` [sourced], where swing is the documented
technique). `swing: 0` reflects the absence of a claim, not a sourced fact
that trance arps are never swung.

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

Only `rate: 1/16` and `contour: updown` are directly supported by the
sources. `octaves`, `gate`, the accent map and `swing: 0` are authored
readings of the qualitative claims, not measurements. Before promoting past
`draft`, audition `octaves: 1` (compact) and a shorter `gate` (~0.4-0.5,
more "plink") as the two obvious retuning knobs.
