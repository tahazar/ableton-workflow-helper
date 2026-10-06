---
slug: isoxo-snare-arrangement
topic: sound-design
tier: sourced
tags: [isoxo, snare, trap, festival-trap, hybrid-trap, sound-design, arrangement]
sources: ["https://www.melodigging.com/genre/festival-trap", "https://www.melodigging.com/genre/hybrid-trap"]
related: [sound-design/isoxo-snare-layering, rhythm/drum-style-hybrid-trap]
---
# ISOxo snare: half-time beat-3 backbeat + build-up density ramp

## Executable
```awh-notation
sig 4/4
# steady groove: half-time backbeat, snare+clap stacked on beat 3
# (D1 = snare/38, D#1 = clap/39, GM drum map)
1|3     D1+D#1  1    v110

# build-up, one bar per density stage, leading into the drop:

# stage 1 (bar N): 8th-note roll; repeat this 1-beat cell x4 across the bar
1|1    D1   1/2   v90
1|1.5  D1   1/2   v90

# stage 2 (bar N+1): 16th-note density
1|1    D1   1/4   v95
1|1.25 D1   1/4   v95
1|1.5  D1   1/4   v95
1|1.75 D1   1/4   v95

# stage 3 (bar N+2, pre-drop): 32nd-note density, velocity ramps into the hit
1|1     D1  1/8   v100
1|1.125 D1  1/8   v100
1|1.25  D1  1/8   v105
1|1.375 D1  1/8   v105
1|1.5   D1  1/8   v110
1|1.625 D1  1/8   v110
1|1.75  D1  1/8   v115
1|1.875 D1  1/8   v120

# drop: half-time backbeat resumes
2|3     D1+D#1  1    v127
```

## The rule
Melodigging's genre reference pages list ISOxo among the artists defining
both "festival trap" and "hybrid trap." They describe the rhythmic skeleton
both genres inherit from trap: **halftime feel, snare/clap landing on beat
3** of the bar (not beats 2 and 4), with hi-hats doing the subdivision work
around it. This matches the `snareBeat: 3` field of `drum-style-hybrid-trap`
in this knowledge base, an independent confirmation of the same backbeat
placement from a different source.

For build-ups, melodigging's festival-trap page describes "rolling
1/8→1/16→1/32 snare fills leading into drops" as the genre convention: a
snare roll that steps through progressively denser subdivisions (not one
constant-density roll) as the arrangement approaches the drop. Per the same
source this typically spans an 8–16 bar build window, alongside rising
pitch and filter/reverb automation (see `isoxo-snare-pitch-resample` for
per-hit pitch manipulation).

Caveat: this entry sources genre-level convention (melodigging's
artist-tagged genre pages, which list ISOxo as a genre-defining artist),
not an ISOxo-specific interview quote. Tempo figures on the same pages
(140 BPM / 70–75 BPM halftime) are genre-general and not repeated here as
ISOxo-specific claims.
