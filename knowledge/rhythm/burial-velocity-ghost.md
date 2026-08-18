---
slug: burial-velocity-ghost
topic: rhythm
tier: sourced
tags: [burial, velocity, ghost-notes, humanize, groove]
sources:
  - "https://www.musicradar.com/tuition/tech/how-to-make-a-burial-style-beat-221976"
  - "http://waveformless.blogspot.com/2009/10/making-burial-style-beats.html"
  - "https://www.musicradar.com/tuition/tech/how-to-add-groove-and-pace-to-a-beat-using-ghost-notes-625526"
  - "https://www.attackmagazine.com/technique/beat-dissected/burial-ghost-hardware/"
related: [rhythm/burial-2step-skeleton, rhythm/burial-swing-feel, rhythm/burial-percussion-palette]
---
# Burial-style velocity variation and ghost notes

## The rule

Producer breakdowns of the Burial-style workflow (MusicRadar's tutorial,
summarized independently on the Waveformless blog; Attack Magazine's Ghost
Hardware beat-dissection) converge on three velocity-driven moves layered on
top of the skeleton and off-grid timing:

1. **Kick velocity variation** — don't fire every kick at a fixed velocity;
   vary hit-to-hit so the four-to-floor-plus figure (see
   `rhythm/burial-2step-skeleton` [sourced]) doesn't read as machine-locked.
2. **Ghost notes** — softer snare/rimshot hits placed between the main
   backbeat hits, at low velocity, adding rhythmic detail without competing
   with the 2/4 backbeat.
3. **Hat/percussion velocity shaping** — vary the volume of each hi-hat or
   shaker hit "to mimic the feel of a live drummer" (Waveformless's summary
   of the MusicRadar tutorial), rather than a flat-velocity 16th roll.

These are general production-technique guidance for achieving a Burial-
adjacent groove (secondhand tutorials, not Burial's own words) — cite
accordingly; don't present as his stated method the way the Sound Forge/
no-quantize claims in `rhythm/burial-swing-feel` [sourced] can be.

## Executable

Ghost-note layer added to Skeleton A from `rhythm/burial-2step-skeleton`
[sourced] — low-velocity rimshot hits between the main backbeat:

```awh-notation
sig 4/4
# ILLUSTRATIVE ghost-note layer, constructed from the cited technique
# descriptions (MusicRadar tutorial; Waveformless summary) — not a
# transcription of a specific Burial track's ghost placement.
1|1.75  C#1  1/4  v35  p70   # ghost rimshot before beat 2, low velocity + probability
1|3.25  C#1  1/4  v30  p60   # ghost rimshot after beat 3
```

Pipeline form for applying velocity variation + ghosts to an existing drum
clip: `velocity-shape:mode=accent humanize:velocity=15`. Pair with
`awh drums humanize <clipPath> --velocity 10-15` for role-aware velocity
variation across kick/hat/snare roles at once (kicks and hats get
independent variation rather than one flat humanize amount).
