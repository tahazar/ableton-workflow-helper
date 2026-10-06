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
Draft until the owner auditions and tunes it. It retunes the built-in
`bass-music-cr` data toward dubstep, using the sourced findings in
`rhythm/dubstep-drum-pattern` [sourced] and `sound-design/dubstep-growl-basics`
[sourced], plus the general call-and-response mechanism in
`arrangement/call-response-drop-grammar` [sourced] and
`arrangement/call-response-rest-placement` [sourced]. It changes data only,
never the mechanism, like `arrangement/phrase-style-lyny-flavor`.

## What changed from the built-in `bass-music-cr` spec, and why

- `responseRegister` narrowed and lowered to `[24, 38]` (built-in: `[24, 43]`).
  `sound-design/dubstep-growl-basics` places a growl's "low end movement" in
  roughly 50-500Hz, built from two sine waves FMing at a 2:1 ratio or a
  bandpass-filtered saw sweeping that range. MIDI 24 (C1, ~32.7Hz) to 38 (D2,
  ~73.4Hz) keeps the response's written pitches in the sub/low-bass
  fundamental register growl patches are built to fill, below where a cleaner
  mid-bass sits. `callRegister` stays at the built-in's `[67, 81]` (G4-A5): no
  cited source argues for moving the call register for dubstep, and the
  call-above/response-below alignment from `call-response-drop-grammar` is a
  register direction, not a specific range.
- `callCells` reduced to two, sparser than the built-in's three. The
  built-in's busiest cell (`ask-3`, three onsets) is dropped.
  `rhythm/dubstep-drum-pattern`'s "space is the groove" finding (low
  percussion and pattern density so the bass reads heavier) is applied to the
  call side: fewer onsets per cell, weighted toward the single-stab cell.
- `restMinBeats` raised to `1.5` (built-in: `1.0`). Same reasoning, applied as
  a hard floor instead of a cell-density nudge. Not raised to
  `phrase-style-lyny-flavor`'s `2.0`: that entry's extra restraint is sourced
  to LYNY-specific "minimal"/"economical" reviewer language this entry has no
  license to borrow. `1.5` is dubstep's general space principle, kept
  moderate.
- `responseDelayBeats` widened to `[2.0, 5.0]` (built-in: `[2.0, 4.0]`).
  `call-response-rest-placement` [sourced] gives the response entering "a bar
  (or half-bar) after the call finishes" as the general rule (2-4 beats). The
  upper bound goes to 5 beats to reach the wider gaps
  `rhythm/dubstep-drum-pattern` documents as characteristic of the genre (and
  riddim specifically, per that entry's "strategic use of silence and
  negative space" citation). The lower bound stays at 2.0: no source argues
  the minimum gap should change, only that longer gaps should be reachable.
- `responseRecipes` restricted to `[echo-low, truncate-stab, displaced-echo,
  sparse-answer]`; `invert-answer` is dropped. The four map onto documented
  dubstep-response character: `truncate-stab` and `sparse-answer` produce
  fewer, longer notes with more space around them; `displaced-echo`
  implements hocketing, which `call-response-drop-grammar` names as "the
  mechanism behind dubstep bass 'punctuations'"; `echo-low` is the plainest
  question-then-answer shape. `invert-answer`'s contour inversion has no cited
  dubstep-specific grounding, so it is left out rather than included by
  default.
- `resolveDegrees` restricted to `[0]` (tonic only; built-in: `[0, 7]`
  tonic/fifth). `rhythm/dubstep-drum-pattern` cites riddim as built around "a
  single, catchy bassline that repeated throughout the track" (Wikipedia,
  Riddim (genre)). A response that always resolves to the root reinforces
  that one-idea-repeated character. This borrows riddim's documented
  minimalism; it is not a dubstep-wide sourced fact. The trade-off is a less
  harmonically varied response bank for a more "single hook, repeated" feel.
- `phraseBars`, `cellBars`, `evolution`, `turnaround` stay at the built-in
  defaults. No cited source addresses phrase length, evolution pacing, or the
  turnaround gesture for dubstep. `turnaround: drop-response` is kept because
  nothing argues against the default, not because it was re-derived.

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
placement`, `arrangement/drop-phrase-evolution`). This entry only retunes the
data (registers, cell sparseness, rest budget, delay range, eligible recipes,
resolve degree) toward dubstep, with `rhythm/dubstep-drum-pattern` and
`sound-design/dubstep-growl-basics` as the sourced anchors. Cite
`phrase-style-dubstep-cr [draft]` when using it, and repeat the caveat for
the tonic-only resolve: it borrows riddim's documented minimalism rather than
a dubstep-wide sourced fact, so it is the first field to reconsider for a
non-riddim drop.
