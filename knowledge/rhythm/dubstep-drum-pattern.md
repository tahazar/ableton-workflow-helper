---
slug: dubstep-drum-pattern
topic: rhythm
tier: sourced
tags: [dubstep, 140bpm, half-time, drums, riddim, tearout, melodic-dubstep, space]
sources: ["https://en.wikipedia.org/wiki/Riddim_(genre)", "https://rateyourmusic.com/genre/tearout-1/", "https://rateyourmusic.com/genre/future-riddim/", "https://www.pointblankmusicschool.com/blog/how-to-create-a-dubstep-drop-from-scratch/", "https://www.dubstepforum.com/forum/viewtopic.php?t=70477", "https://bassgorilla.com/what-is-riddim-dubstep/", "https://www.studiobrootle.com/how-to-make-dubstep/"]
related: [rhythm/drum-style-dubstep, rhythm/burial-2step-skeleton, rhythm/burial-swing-feel, arrangement/call-response-drop-grammar, arrangement/call-response-rest-placement, sound-design/dubstep-growl-basics]
---
# Dubstep drum pattern: the 140 BPM half-time skeleton

**Sourcing note:** sources were consulted through search excerpts tied to
named pages (dubstepforum.com, pointblankmusicschool.com, Wikipedia,
attackmagazine.com, musicradar.com, unison.audio, cymatics.fm and others),
not full-page reads. Claims that one named page corroborates cleanly (the
riddim/tearout/future-riddim genre facts) are cited tightly. Claims
synthesized across several tutorials without per-sentence attribution (the
kick/snare skeleton, the space/percussion claims) cite every page in the
group. Treat the skeleton and the space principle as corroborated across
many independent tutorials, not as one quotable source.

## Executable

```awh-notation
sig 4/4
# Illustrative: the half-time skeleton assembled from the cited production
# tutorials/threads below, not a transcription of any specific track.
1|1    C1   1/4  v115   # kick, beat 1: the one fixed downbeat every source agrees on
1|3    D1   1/4  v127   # snare/clap, beat 3: the half-time backbeat, locked
1|3.5  F#1  1/8  v50    # sparse closed hat, off the backbeat: support, not filler
# beats 1.5-2.75 and 3.5-4 of the bar left open on purpose;
# see "Space is the groove" below
```

## The rule

### The skeleton: kick on 1, backbeat on 3, everything else optional

Every tutorial and thread checked agrees on two fixed points: a kick on beat
1 and a snare (or clap, or both) on beat 3 of a 4/4 bar at ~140 BPM. "The
kick usually hits on the first beat, with the snare on the third beat of the
bar; this half-time pattern leaves space for bass movement and keeps the
groove heavy and controlled" (dubstepforum.com production threads;
pointblankmusicschool.com, "How to Create a Dubstep Drop from Scratch").
The trap-family drum engine encodes the same half-time backbeat as
`snareBeat: 3` (see `packages/core/src/drums/styleSpec.ts`), and Burial's
Untrue-era tracks sit in the same half-time range per
`rhythm/burial-2step-skeleton` [sourced]. Dubstep and its UK-garage-adjacent
neighbors share this backbone.

### Kick placement is a freedom, not a second fixed rule

Beyond the beat-1 downbeat, sources do not converge on a spot for extra
kicks. They describe kicks moving around the backbeat (pickups into beat 3,
hits after it, busier or sparser bars) without numbers. The trap-family
kick-cell model treats placement the same way: one cell is drawn and held
for the whole loop, and several cells with different kick counts and
positions are offered as alternatives. That is the "curated freedom"
`TrapFamilyKickCell` exists for. The lack of a sourced number licenses
several plausible cells (see `rhythm/drum-style-dubstep`), not an invented
"authoritative" placement.

### Hats and percussion: support, not filler

Hats and percussion play a supporting role, unlike in house or garage.
Aggregated from pointblankmusicschool.com and dubstepforum.com: "Dubstep
drums are all about impact and space... their job is to support the bass
and reinforce the groove," with percussion kept "sparse — shakers,
rimshots, and occasional ghost hits for movement" rather than a constant
grid (bassgorilla.com, "How To Make Your Own Dubstep"; studiobrootle.com,
"How To Make Dubstep"). Hats and perc keep time and add texture between the
two fixed hits without competing with the bass.

### Space is the groove, not the absence of one

The recurring cross-source claim is that silence is load-bearing: "leave
lots of empty space and don't be afraid of a split second of silence...
fewer [percussion] hits mean each one feels more powerful"
(bassgorilla.com). Riddim leans on this harder than dubstep in general; its
producers make "strategic use of silence and negative space to create
tension and emphasize the impact of the bass drops" (bassgorilla.com, "What
is Riddim Dubstep?"). `arrangement/call-response-rest-placement` [sourced]
documents the same principle for the call-and-response drop grammar. It is
one rule at two grains: whole-pattern space here, phrase-level rest there.

### Subgenre contrasts (the ones with a named source)

These three distinctions have clean, single-page attribution:

- **Riddim**: "a subgenre of dubstep known for its heavy use of repetitive
  and minimalist sub-bass and triplet percussion arrangements", typically
  140-150 BPM, named around 2012 by dubstep artist Jakes for a style built
  around "a single, catchy bassline that repeated throughout the track"
  (en.wikipedia.org/wiki/Riddim_(genre)). The throughline is repetitive
  loops, triplet percussion and a minimal bassline: fewer pattern ideas,
  repeated harder.
- **Tearout**: an earlier, harder-edged style with "aggressive and heavy
  basslines," "very distorted basses... through FM synthesis," "punchy and
  dominant midrange" and "rugged half-time drum grooves around 140 BPM",
  pioneered by Rusko and Caspa in the mid-2000s UK scene before evolving
  toward brostep (rateyourmusic.com/genre/tearout-1/). The half-time
  skeleton is the same; the contrast is the bass and percussion aggression
  on top.
- **Melodic dubstep / future riddim**: the harmonic opposite of riddim's
  starkness, with "futuristic, melodic, and vibrant synth leads" and
  "half-time triplets" kept from riddim but "a far stronger melodic focus":
  chord progressions and leads instead of one repeated bass hook
  (rateyourmusic.com/genre/future-riddim/). The half-time drum skeleton is
  shared across the family. Riddim, tearout and melodic/future riddim
  differ in bass and harmony, not kick/snare grammar.

### What this entry does not claim

No source gave a BPM-locked secondary-kick offset, a hat velocity curve, or
a "correct" percussion density, and this entry does not invent them.
`rhythm/drum-style-dubstep` [draft] turns the skeleton into several
auditionable kick cells. Their offsets are an authored proposal built on
these sourced constraints, not further-sourced fact.
