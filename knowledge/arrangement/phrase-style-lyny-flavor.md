---
slug: phrase-style-lyny-flavor
topic: arrangement
tier: draft
tags: [lyny, artist-study, call-response, drop-writing, dubstep, trap, phrase-style]
sources: []
related:
  - arrangement/call-response-drop-grammar
  - arrangement/call-response-rest-placement
  - arrangement/drop-phrase-evolution
  - arrangement/lyny-drop-structure
---
# Phrase style: LYNY flavor

`awh drop phrase <target> [responseTarget] --style lyny-flavor` and
`awh drop respond <call> <target> --style lyny-flavor` read the spec below.

**Read the caveat first — this is flavor, not a documented LYNY technique.**
As `arrangement/lyny-drop-structure` spells out, no interview, stems
breakdown, or technical write-up describes how LYNY actually phrases a
call-and-response drop, spaces rests, or relates pitches. This spec is the
general craft in `arrangement/call-response-drop-grammar` and
`arrangement/drop-phrase-evolution`, tuned toward the tonal DESCRIPTORS that
outlet reviews do attribute to him — economical/minimal arrangement,
low-end-dominant response sound, vocal-chop-register call sound, deliberate
space around hits (`arrangement/lyny-drop-structure`'s "What's actually
documented" section). Treat it as a starting-point flavor to audition, never
as a transcription of anything he has actually written. Tier is `draft`
until the owner auditions and tunes it.

## What changed from the built-in `bass-music-cr` spec, and why

- **`callCells` sparser** — mostly a single vocal-chop stab (weight 4) with
  one two-hit variant, instead of the built-in's busier 2-3 onset cells:
  "clarity of purpose" / economical arrangement (sweetnsourmagazine.com, per
  `lyny-drop-structure`).
- **`callRegister` nudged up** (`[69, 84]`, A4-C6) — vocal-chop territory,
  matching the vocal-chop-forward descriptor (fuxwithit.com;
  thissongissick.com, per `lyny-drop-structure`).
- **`responseRegister` unchanged but narrowed at the top** (`[24, 41]`) —
  keeps the response down-and-dirty/minimal-mixdown low end
  (thissongissick.com; edmidentity.com, per `lyny-drop-structure`) without
  it climbing toward the call's territory.
- **`restMinBeats` doubled** (2.0 vs 1.0) and **`responseDelayBeats` widened**
  (`[3.0, 5.0]` vs `[2.0, 4.0]`) — "deliberate space around hits" applied
  directly via the general rest-placement rule
  (`arrangement/call-response-rest-placement`), reading the reviewers'
  restraint framing as MORE silence, not less.
- **`responseRecipes` restricted to `truncate-stab` and `sparse-answer`** —
  the two recipes that produce the fewest, longest, most space-around-them
  response notes; this is where "minimal" and "extra space" actually land
  in the generated output.
- **`turnaround: extra-rest`** instead of the built-in's `drop-response` —
  an even quieter reset cue at each phrase boundary, consistent with the
  same restraint framing.
- `phraseBars`, `cellBars`, `evolution`, and `resolveDegrees` are left at
  the built-in defaults — nothing in the sourced coverage speaks to phrase
  length, evolution pacing, or cadence pitches, so there is no descriptor to
  flavor them with.

## Executable

```awh-phrase-spec
name: lyny-flavor
family: call-response
phraseBars: 8
cellBars: 2
callRegister: [69, 84]
responseRegister: [24, 41]
callCells:
  - {name: chop-stab, beats: [0], lengths: [0.25], weight: 4}
  - {name: chop-pair, beats: [0, 2.0], lengths: [0.25, 0.5], weight: 1}
restMinBeats: 2.0
responseDelayBeats: [3.0, 5.0]
responseRecipes: [truncate-stab, sparse-answer]
resolveDegrees: [0, 7]
evolution:
  - {bars: [1, 4], action: state}
  - {bars: [5, 8], action: vary-call}
turnaround: extra-rest
```

## The rule

Same call-and-response grammar as `bass-music-cr`
(`arrangement/call-response-drop-grammar`, `arrangement/call-response-rest-
placement`, `arrangement/drop-phrase-evolution`) — this entry only retunes
the DATA (registers, cell sparseness, rest budget, eligible recipes,
turnaround), never the mechanism. Cite `phrase-style-lyny-flavor [draft]`
when this is used, and always repeat the caveat above: it is a plausible
flavor built from review adjectives, not LYNY's own technique.
