---
slug: phrase-style-dubstep-cr
topic: arrangement
tier: draft
tags: [dubstep, call-response, drop-writing, phrase-style, growl, bass-music]
sources: []
related: [arrangement/call-response-drop-grammar, arrangement/call-response-rest-placement, arrangement/drop-phrase-evolution, arrangement/phrase-style-lyny-flavor, rhythm/dubstep-drum-pattern, rhythm/drum-style-dubstep, sound-design/dubstep-growl-basics]
---
# Phrase style: dubstep call-and-response

`awh drop phrase <target> [responseTarget] --style dubstep-cr` and
`awh drop respond <call> <target> --style dubstep-cr` read the spec below.
Draft until the owner auditions and tunes it — this retunes the built-in
`bass-music-cr` DATA toward dubstep specifically, using the sourced findings
in `rhythm/dubstep-drum-pattern` [sourced] and `sound-design/dubstep-growl-
basics` [sourced], plus the general call-and-response mechanism already
documented in `arrangement/call-response-drop-grammar` [sourced] and
`arrangement/call-response-rest-placement` [sourced]. It changes DATA only,
never the mechanism — same discipline as `arrangement/phrase-style-lyny-
flavor`.

## What changed from the built-in `bass-music-cr` spec, and why

- **`responseRegister` narrowed and lowered to `[24, 38]`** (vs the
  built-in's `[24, 43]`) — `sound-design/dubstep-growl-basics` describes a
  growl's "low end movement" as living in roughly 50-500Hz, built from two
  sine waves FMing at a 2:1 ratio or a bandpass-filtered saw sweeping that
  range. MIDI 24 (C1, ~32.7Hz) to 38 (D2, ~73.4Hz) keeps the response's
  written pitches sitting in the sub/low-bass fundamental register that
  growl patches are built to fill, rather than reaching up toward where a
  cleaner mid-bass would sit. `callRegister` is left at the built-in's
  `[67, 81]` (G4-A5) — nothing sourced this session argues for moving the
  bright/lead call register specifically for dubstep, and the canonical
  call-above/response-below alignment from `call-response-drop-grammar` is
  register-direction, not a specific range.
- **`callCells` reduced to two, sparser than the built-in's three** — the
  built-in's busiest cell (`ask-3`, three onsets) is dropped entirely.
  `rhythm/dubstep-drum-pattern`'s "space is the groove" finding (percussion
  and pattern density kept low so the bass reads as heavier) is applied
  here to the CALL side of the phrase: fewer onsets per cell, weighted
  toward the single-stab cell.
- **`restMinBeats` raised to `1.5`** (vs the built-in's `1.0`) — same
  space-is-the-groove reasoning, applied as a hard floor instead of just a
  cell-density nudge. Not raised as far as `phrase-style-lyny-flavor`'s
  `2.0` — that entry's extra restraint is sourced to LYNY-specific
  "minimal"/"economical" reviewer language, which this entry doesn't have
  license to borrow; `1.5` is dubstep's own general space principle, kept
  more moderate.
- **`responseDelayBeats` widened to `[2.0, 5.0]`** (vs the built-in's
  `[2.0, 4.0]`) — `call-response-rest-placement` [sourced] documents the
  response entering "a bar (or half-bar) after the call finishes" as the
  general rule (2-4 beats); the upper bound is pushed to 5 beats to give
  room for the wider, more spacious gaps `rhythm/dubstep-drum-pattern`
  documents as characteristic of the genre (and riddim specifically, per
  that entry's "strategic use of silence and negative space" citation).
  The lower bound is left at 2.0 — nothing sourced argues the minimum gap
  itself should change, only that longer gaps should be reachable.
- **`responseRecipes` restricted to `[echo-low, truncate-stab, displaced-
  echo, sparse-answer]`** — `invert-answer` is dropped. The other four map
  onto documented dubstep-response character: `truncate-stab` and
  `sparse-answer` are the recipes that produce fewer, longer, more
  space-around-them notes (the space principle again); `displaced-echo`
  is the recipe that implements hocketing, which `call-response-drop-
  grammar` names directly as "the mechanism behind dubstep bass
  'punctuations'"; `echo-low` is kept as the plainest, most legible
  question-then-answer shape. `invert-answer`'s contour inversion has no
  citable dubstep-specific grounding this session, so it's left out rather
  than included by default.
- **`resolveDegrees` restricted to `[0]`** (tonic only, vs the built-in's
  `[0, 7]` tonic/fifth) — `rhythm/dubstep-drum-pattern` cites riddim as
  built around "a single, catchy bassline that repeated throughout the
  track" (Wikipedia, Riddim (genre)). A response that always resolves to
  the root reinforces that one-idea-repeated character; this is explicitly
  borrowed from riddim's documented minimalism, not a dubstep-wide sourced
  fact — the trade-off is a less harmonically varied response bank in
  exchange for a more "single hook, repeated" feel.
- **`phraseBars`, `cellBars`, `evolution`, `turnaround`** left at the
  built-in defaults — nothing sourced this session speaks to phrase length,
  evolution pacing, or the turnaround gesture specifically for dubstep, so
  there's no citable reason to retune them. `turnaround: drop-response` in
  particular is kept because nothing argues against the built-in default,
  not because it was independently re-derived.

## Executable

```awh-phrase-spec
name: dubstep-cr
family: call-response
phraseBars: 8
cellBars: 2
callRegister: [67, 81]
responseRegister: [24, 38]
callCells:
  - {name: call-stab, beats: [0], lengths: [0.5], weight: 3}
  - {name: call-pickup, beats: [0, 2.0], lengths: [0.5, 0.5], weight: 1}
restMinBeats: 1.5
responseDelayBeats: [2.0, 5.0]
responseRecipes: [echo-low, truncate-stab, displaced-echo, sparse-answer]
resolveDegrees: [0]
evolution:
  - {bars: [1, 4], action: state}
  - {bars: [5, 8], action: vary-call}
turnaround: drop-response
```

## The rule

Same call-and-response grammar as `bass-music-cr`
(`arrangement/call-response-drop-grammar`, `arrangement/call-response-rest-
placement`, `arrangement/drop-phrase-evolution`) — this entry only retunes
the DATA (registers, cell sparseness, rest budget, delay range, eligible
recipes, resolve degree) toward dubstep specifically, using
`rhythm/dubstep-drum-pattern` and `sound-design/dubstep-growl-basics` as the
sourced anchor points. Cite `phrase-style-dubstep-cr [draft]` when this is
used, and repeat the caveat above for the tonic-only resolve choice: that
one specifically borrows riddim's documented minimalism rather than a
dubstep-wide sourced fact, so it's the field most worth reconsidering for a
non-riddim-leaning drop.
