---
slug: waivops-drum-stats-pilot
topic: rhythm
tier: sourced
tags: [house, techno, trap, edm, drums, statistics, waivops, pilot, style-spec]
sources: ["https://github.com/patchbanks/WaivOps-EDM-TR9", "https://doi.org/10.5281/zenodo.10278066", "https://github.com/patchbanks/WaivOps-EDM-TR8", "https://doi.org/10.5281/zenodo.13257814", "https://github.com/patchbanks/WaivOps-HH-TRP", "https://doi.org/10.5281/zenodo.15734094", "own analysis: awh drums mine, library/measurements/waivops-tr9-pilot.json, waivops-tr8-pilot.json, waivops-hhtrp-pilot.json"]
related: [rhythm/drum-style-dusty-garage, rhythm/drum-style-hybrid-trap]
---
# WaivOps drum-loop rhythm statistics: pilot mining pass

**Attribution (CC BY 4.0 — required on any reuse of these numbers or the
source audio):** all three datasets are by WaivOps, a crowdsourced project
managed by Patchbanks (info@patchbanks.com), each licensed Creative Commons
Attribution 4.0 International.

```bibtex
@misc{EDM-TR9, author={WaivOps}, title={WaivOps EDM-TR9: Open Audio Resources for Machine Learning in Music}, year={2023}, doi={10.5281/zenodo.10278066}, url={https://doi.org/10.5281/zenodo.10278066}}
@misc{EDM-TR8, author={WaivOps}, title={WaivOps EDM-TR8: Open Audio Resources for Machine Learning in Music}, year={2024}, doi={10.5281/zenodo.13257814}, url={https://doi.org/10.5281/zenodo.13257814}}
@dataset{HH-TRP, author={WaivOps}, title={WaivOps HH-TRP: Open Audio Resources for Machine Learning in Music}, year={2025}, doi={10.5281/zenodo.15734094}, url={https://doi.org/10.5281/zenodo.15734094}}
```

## PILOT CAVEAT — read this before the numbers below

This is a **pilot on example loops, not the full datasets**: n=14 (TR9),
n=25 (TR8), n=20 (HH-TRP) — the MP3 previews checked into each dataset's own
GitHub repo (`examples/`), not the full multi-GB Zenodo archives (3780 /
3790 / 15000 loops respectively), which are egress-blocked from the build
container that ran this pass. Treat every number below as **suggestive, a
starting hypothesis to re-check at full n**, never as settled fact — see
`docs/dev-loop.md`'s "Drum stats mining owner checklist" for the exact
download commands and `awh drums mine --save` invocations to redo this at
full scale. The saved measurement records
(`library/measurements/waivops-{tr9,tr8,hhtrp}-pilot.json`) carry the raw
per-position numbers, sha256-tied to the exact pilot audio files analyzed.

## Executable

This entry is a MEASUREMENT REPORT, not a style spec — there is no
`awh-style-spec` block to feed `drums gen` here. The executable part is
retrieval: the raw numbers live in saved measurement records, reproducible
with the same command that made them.

```sh
awh mix records waivops-tr9-pilot      # pretty summary + pointer to the JSON
awh mix records waivops-tr8-pilot
awh mix records waivops-hhtrp-pilot
# re-run against the same (or the full) dataset:
awh drums mine <dir> --dataset <name> --save <name> --attribution "<CC BY credit line>"
```

## Method (band-split proxy, not source separation)

`awh drums mine` band-splits each loop into low (<120 Hz) / mid
(120 Hz-2 kHz) / high (>2 kHz), runs spectral-flux onset detection per band,
and folds onsets onto a 16th-note grid (BPM from filename, loop assumed to
start on beat 1 — verified per-loop against the low band's first onset; it
held for **all 59/59 loops across all three datasets**, see each record's
`downbeat_check`). This is a **kick / snare-clap / hat PROXY**, not ground
truth — a kick's harmonics extend into the mid band, a clap smears across
mid and high, and a sustained 808 has a much softer attack than a spectral-
flux detector expects. Read every "low band" claim below as "where a kick
dominates in the mix", not "the isolated kick".

## The numbers, compared against the built-in StyleSpecs

`packages/core/src/drums/grammars.ts` is never edited by this entry — these
are REPORTED comparisons for the owner to weigh, per `docs/dev-loop.md`.

### TR9 (house/techno, TR-909-style) vs `HOUSE_STYLE_SPEC`/`TECHNO_STYLE_SPEC`

| position (16-grid) | 0 | 4 | 8 | 12 |
|---|---|---|---|---|
| low-band hit prob | 95% | 98% | 98% | 98% |

**Four-on-the-floor: AGREES strongly.** Both specs assume `kickBeats:
"four-floor"` (a kick on every beat, positions 0/4/8/12); the mined low band
hits 95-98% at exactly those four positions and is at or near 0% everywhere
else (0%, 0-4%, 4-11%, 4-32% at the in-between positions) — about as clean a
confirmation as a proxy measurement gets.

High-band (hat) density is 12.6 onsets/bar with a clear on-8th vs off-16th
split (even 16th positions 77-100%, odd 30-41%) — consistent with
`HOUSE_STYLE_SPEC`'s dense `hatGrid: {low: "8ths", high: "16ths"}` at busy
density (every 16th filled, off-16ths softer/less consistent than on-8ths).
Swing estimate: off-16ths land **2.5% of a step EARLIER** than on-8ths
(-0.006 beats equivalent) — i.e. essentially straight. Matches both specs'
`swingDelay: 0` (AGREES; the small negative number is noise-floor, not a
real early-swing feel — n=440/268 onsets, see the record for the exact
figures).

Mid band (clap/snare proxy) also spikes to 100% at 0/4/8/12 — this is very
likely **kick harmonic bleed**, not evidence of claps on the downbeats;
house/techno's actual backbeat (`backbeat: [clap, snare]` /
`backbeatMinDensity`) lands on the SAME positions the kick already
dominates in this proxy, so this measurement genuinely cannot separate
"kick transient in the mid band" from "clap on the beat" — flagged
honestly rather than claimed as a backbeat confirmation.

### TR8 (TR-808/electro) vs the house-family four-floor assumption

| position (16-grid) | 0 | 4 | 8 | 12 |
|---|---|---|---|---|
| low-band hit prob | 99% | 61% | 75% | 61% |

**Partial disagreement.** Beat 1 (position 0) is almost universal (99%),
but beats 2/3/4 are noticeably less consistent (61-75%) than TR9's — TR8 is
NOT a clean four-on-the-floor dataset the way TR9 is. That tracks with the
README's own framing ("multi-genre rhythm styles" / TR-808 + "additional
electro synth drums", tempo range 95-130 BPM vs TR9's tighter 120-140) —
TR8 leans more electro/breakbeat-adjacent than strict house/techno, so
comparing it against `HOUSE_STYLE_SPEC` at all is a stretch this entry
flags rather than papers over. Swing is again essentially straight
(-0.3% of a step, -0.001 beats) — agrees with both specs' `swingDelay: 0`
regardless of the kick-pattern mismatch.

### HH-TRP (trap) vs `TRAP_STYLE_SPEC`

| position (16-grid) | 0 (kick "anchor") | 8 (snare beat 3) |
|---|---|---|
| low-band hit prob | 52% | — |
| mid-band hit prob | — | 99% |

**Backbeat: AGREES strongly.** `TRAP_STYLE_SPEC.snareBeat: 3` (with
`clapWithSnare: true`) predicts a near-universal snare+clap on beat 3 (grid
position 8); the mid band hits 99% there — the single cleanest confirmation
in this pilot.

**Kick anchor: DISAGREES, and plainly.** Every one of the six curated
`TRAP_KICK_CELLS` starts with `offsets: [0, ...]` — beat 1 "always anchors"
per the code comment. The mined low band shows only **52%** of bars with a
detectable onset at position 0 — barely better than half. Two honest
explanations, neither a clean exoneration: (1) trap kicks are often
sustained 808 glides rather than sharp transients, and a spectral-flux
onset detector is tuned for transients, so a soft-attack 808 landing
exactly on beat 1 may simply not register as an "onset" the way a TR-909
kick does; (2) this dataset is algorithmically generated from "a customized
database of MIDI patterns" (per its README) — it may simply include many
patterns that don't anchor beat 1 the way the curated 6 cells assume. This
pilot cannot distinguish the two; it's a genuine open question for the full
mining pass, not a settled "the spec is wrong."

Low-band density is 4.27 onsets/bar, above the `TRAP_KICK_CELLS` average of
3.0 (mean offsets-per-cell across hold=2, double-tap=3, late-lean=3,
rolling=4, sparse=2, syncopated=4) — read as "real trap loops may be busier
than the curated cells on average", a plausible future-cell-variety lead,
not a contradiction.

**Swing: the most notable mismatch.** `TRAP_STYLE_SPEC.swingDelay: 0.06`
beats (applied to the `swung-16ths` hat base specifically) predicts off-
16ths landing noticeably LATER. The mined high-band swing estimate instead
shows off-16ths landing **7.5% of a step EARLIER** than on-8ths (-0.019
beats equivalent, n=1274/233 onsets) — sign-flipped from the spec's
assumption. Caveat before reading this as "the spec is wrong": this
measurement pools ALL hats in the dataset regardless of which of the three
named hat bases (`straight-8ths` / `16th-run` / `swung-16ths`) a given loop
actually uses, and only one of those three carries a delay in the built-in
generator — a real per-base swing signal could easily wash out in an
aggregate. The full mining pass should bucket by inferred hat density/base
before this comparison is trustworthy.

## What this pilot does NOT claim

No claim here is about the FULL datasets (thousands of loops each) — see
the caveat block up top. No number here has been used to edit
`grammars.ts`/`styleSpec.ts`; those stay hand-authored, and any future
change based on this line of research is a deliberate, reviewed, hand-made
edit, never automatic. The mid-band "backbeat" reading for TR9 is
explicitly flagged as unable to separate kick bleed from real claps — don't
cite it as a clap confirmation, only the trap mid-band (position 8, no
kick collision there) is a clean read.
