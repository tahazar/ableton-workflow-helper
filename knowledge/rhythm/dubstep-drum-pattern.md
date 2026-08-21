---
slug: dubstep-drum-pattern
topic: rhythm
tier: sourced
tags: [dubstep, 140bpm, half-time, drums, riddim, tearout, melodic-dubstep, space]
sources: ["https://en.wikipedia.org/wiki/Riddim_(genre)", "https://rateyourmusic.com/genre/tearout-1/", "https://rateyourmusic.com/genre/future-riddim/", "https://www.pointblankmusicschool.com/blog/how-to-create-a-dubstep-drop-from-scratch/", "https://www.dubstepforum.com/forum/viewtopic.php?t=70477", "https://bassgorilla.com/what-is-riddim-dubstep/", "https://www.studiobrootle.com/how-to-make-dubstep/"]
related: [rhythm/drum-style-dubstep, rhythm/burial-2step-skeleton, rhythm/burial-swing-feel, arrangement/call-response-drop-grammar, arrangement/call-response-rest-placement, sound-design/dubstep-growl-basics]
---
# Dubstep drum pattern: the 140 BPM half-time skeleton

**Sourcing note (this session):** full-page fetch (WebFetch) was blocked at
the network egress layer for every production-tutorial and forum host tried
this session (dubstepforum.com, pointblankmusicschool.com, en.wikipedia.org,
attackmagazine.com, musicradar.com, unison.audio, cymatics.fm, and others all
returned an egress-policy block on direct fetch). Research below was done
through the web-search tool, which returns synthesized excerpts tied to named
pages rather than full raw HTML. Where a claim is corroborated cleanly by a
single named page (the riddim/tearout/future-riddim genre facts) it's cited
tightly; where the search tool aggregated several tutorials into one answer
without clean per-sentence attribution (the core kick/snare skeleton, the
space/percussion claims) the citation lists every page in that batch rather
than pretending to know which exact page said which exact sentence. Treat the
skeleton and space principle as well-corroborated across many independent
tutorials, not as a single quotable source.

## Executable

```awh-notation
sig 4/4
# ILLUSTRATIVE — the half-time skeleton assembled from the cited production
# tutorials/threads below, not a transcription of any specific track.
1|1    C1   1/4  v115   # kick, beat 1 — the one fixed downbeat every source agrees on
1|3    D1   1/4  v127   # snare/clap, beat 3 — the half-time backbeat, locked
1|3.5  F#1  1/8  v50    # sparse closed hat, off the backbeat — support, not filler
# beats 1.5-2.75 and 3.5-4 of the bar left open — the rest is not an accident,
# see "Space is the groove" below
```

## The rule

### The skeleton: kick on 1, backbeat on 3, everything else optional

Every tutorial and forum thread checked this session agrees on the same
two fixed points: a kick on beat 1, and a snare (or clap, or both) on beat 3
of a 4/4 bar at ~140 BPM — described as "the kick usually hits on the first
beat, with the snare on the third beat of the bar; this half-time pattern
leaves space for bass movement and keeps the groove heavy and controlled"
(dubstepforum.com production-discussion threads; pointblankmusicschool.com,
"How to Create a Dubstep Drop from Scratch"). This is the same half-time
backbeat mechanism the trap-family drum engine already encodes as
`snareBeat: 3` (see `packages/core/src/drums/styleSpec.ts`), and the same
half-time range Burial's Untrue-era tracks sit in per
`rhythm/burial-2step-skeleton` [sourced] — dubstep and its UK-garage-adjacent
neighbors share this backbone.

### Kick placement is a freedom, not a second fixed rule

Beyond the beat-1 downbeat, sources do NOT converge on one canonical spot for
extra kick hits — threads and tutorials describe kicks moving around the
backbeat (pickups into beat 3, hits after it, busier or sparser bars) without
giving a single number. This matches the way the trap-family kick-cell model
already treats kick placement: one cell is drawn and HELD for the whole loop
(locked, not per-bar random), and multiple cells with different kick counts
and positions are offered as alternatives rather than one "correct" pattern —
exactly the "curated freedom" `TrapFamilyKickCell` was built for. Read the
absence of a single sourced number as license to offer several plausible
cells (see `rhythm/drum-style-dubstep`), not as a gap needing an invented
"authoritative" placement.

### Hats and percussion: support, not filler

Hi-hats and other percussion play a secondary, supportive role — they are
not the rhythmic focus the way they are in house or garage. Aggregated
across pointblankmusicschool.com and dubstepforum.com discussion: "Dubstep
drums are all about impact and space... their job is to support the bass and
reinforce the groove," with percussion kept "sparse — shakers, rimshots, and
occasional ghost hits for movement" rather than a constant grid (bassgorilla.com,
"How To Make Your Own Dubstep"; studiobrootle.com, "How To Make Dubstep").
Practical reading: hats/perc exist to keep time and add texture between the
two fixed drum hits, not to compete with the bass for rhythmic attention.

### Space is the groove, not the absence of one

The recurring, cross-source claim is that silence is load-bearing: "leave
lots of empty space and don't be afraid of a split second of silence... fewer
[percussion] hits mean each one feels more powerful" (bassgorilla.com).
Riddim specifically is called out for leaning on this harder than dubstep in
general — riddim producers are described as making "strategic use of silence
and negative space to create tension and emphasize the impact of the bass
drops" (bassgorilla.com, "What is Riddim Dubstep?"). This is the same
principle `arrangement/call-response-rest-placement` [sourced] documents for
the call-and-response drop grammar specifically — treat the two as the same
rule applied at two different grains (whole-pattern space here, phrase-level
rest there).

### Subgenre contrasts (the ones with an actual named source)

These three are the subgenre distinctions with clean, single-page
attribution this session, not folklore:

- **Riddim** — "a subgenre of dubstep known for its heavy use of repetitive
  and minimalist sub-bass and triplet percussion arrangements," typically
  140-150 BPM, coined around 2012 by dubstep artist Jakes to describe a style
  built around "a single, catchy bassline that repeated throughout the
  track" (en.wikipedia.org/wiki/Riddim_(genre)). The repetitive-loop,
  triplet-percussion, minimal-bassline description is the throughline: fewer
  distinct pattern ideas, repeated harder, not more ideas per bar.
- **Tearout** — an earlier, harder-edged style: "aggressive and heavy
  basslines," "very distorted basses... through FM synthesis," "punchy and
  dominant midrange" and "rugged half-time drum grooves around 140 BPM,"
  pioneered by Rusko and Caspa in the mid-2000s UK scene before evolving
  toward brostep (rateyourmusic.com/genre/tearout-1/). Same half-time
  skeleton as the rest of the genre; the contrast is in the bass/percussion
  aggression layered on top, not the drum grammar itself.
- **Melodic dubstep / future riddim** — the harmonic opposite of riddim's
  starkness: "futuristic, melodic, and vibrant synth leads," "half-time
  triplets" retained from riddim but with "a far stronger melodic focus" —
  chord progressions and leads instead of one repeated bass hook
  (rateyourmusic.com/genre/future-riddim/). Confirms the half-time drum
  skeleton is shared across the whole family; what changes between riddim,
  tearout, and melodic/future-riddim is the bass and harmony on top of it,
  not the kick/snare grammar.

### What this entry does NOT claim

No source gave an exact BPM-locked secondary-kick offset, an exact hat
velocity curve, or a numeric "correct" percussion density — those would be
invented precision this entry refuses to fabricate. `rhythm/drum-style-dubstep`
[draft] turns the skeleton above into several concrete, auditionable kick
cells; treat their specific offsets as an authored proposal built on this
entry's sourced constraints, not as a further-sourced fact.
