---
slug: waivops-drum-stats-pilot
topic: rhythm
tier: sourced
tags: [house, techno, trap, edm, drums, statistics, waivops, full-dataset, style-spec]
sources: ["https://github.com/patchbanks/WaivOps-EDM-TR9", "https://doi.org/10.5281/zenodo.10278066", "https://github.com/patchbanks/WaivOps-EDM-TR8", "https://doi.org/10.5281/zenodo.13257814", "https://github.com/patchbanks/WaivOps-HH-TRP", "https://doi.org/10.5281/zenodo.15734094", "own analysis: awh drums mine on the FULL archives, library/measurements/waivops-{tr9,tr8,hhtrp}-full.json (supersedes the original -pilot.json records, kept for the small-n comparison below)"]
related: [rhythm/drum-style-dusty-garage, rhythm/drum-style-hybrid-trap]
---
# WaivOps drum-loop rhythm statistics: full-dataset mining pass

**Attribution (CC BY 4.0 — required on any reuse of these numbers or the
source audio):** all three datasets are by WaivOps, a crowdsourced project
managed by Patchbanks (info@patchbanks.com), each licensed Creative Commons
Attribution 4.0 International.

```bibtex
@misc{EDM-TR9, author={WaivOps}, title={WaivOps EDM-TR9: Open Audio Resources for Machine Learning in Music}, year={2023}, doi={10.5281/zenodo.10278066}, url={https://doi.org/10.5281/zenodo.10278066}}
@misc{EDM-TR8, author={WaivOps}, title={WaivOps EDM-TR8: Open Audio Resources for Machine Learning in Music}, year={2024}, doi={10.5281/zenodo.13257814}, url={https://doi.org/10.5281/zenodo.13257814}}
@dataset{HH-TRP, author={WaivOps}, title={WaivOps HH-TRP: Open Audio Resources for Machine Learning in Music}, year={2025}, doi={10.5281/zenodo.15734094}, url={https://doi.org/10.5281/zenodo.15734094}}
```

## Full datasets mined, with the small-n pilot for comparison

Numbers come from the full Zenodo archives: **n=3780 (TR9), n=3790 (TR8),
n=15000 (HH-TRP)**, measured, not extrapolated. A pilot on the small
example-loop MP3s checked into each dataset's GitHub repo (n=14/25/20) is
kept in `library/measurements/waivops-{tr9,tr8,hhtrp}-pilot.json` for the
small-n vs. full-n comparison. That comparison is informative: TR9 confirms
more cleanly at full n, TR8's headline number was largely a small-sample
artifact, and HH-TRP's swing finding **flipped sign** between pilot and
full (see each dataset's section). At these sample sizes the numbers are
measurements, not starting hypotheses.

## Executable

This entry is a measurement report, not a style spec. There is no
`awh-style-spec` block to feed `drums gen`. The executable part is
retrieval: the raw numbers live in saved measurement records, reproducible
with the command that made them.

```sh
awh mix records waivops-tr9-full      # pretty summary + pointer to the JSON
awh mix records waivops-tr8-full
awh mix records waivops-hhtrp-full
# re-run against the same (or a re-downloaded) dataset:
awh drums mine <dir> --dataset <name> --save <name> --attribution "<CC BY credit line>"
```

## Method (band-split proxy, not source separation)

`awh drums mine` band-splits each loop into low (<120 Hz) / mid
(120 Hz-2 kHz) / high (>2 kHz), runs spectral-flux onset detection per band,
and folds onsets onto a 16th-note grid (BPM from filename, loop assumed to
start on beat 1). This is a **kick / snare-clap / hat proxy**, not ground
truth. A kick's harmonics extend into the mid band, a clap smears across mid
and high, and a sustained 808 has a much softer attack than a spectral-flux
detector expects. Read every "low band" claim as "where a kick dominates in
the mix", not "the isolated kick".

The downbeat assumption does not hold uniformly at full n. The small pilot
passed 59/59 and could not have shown this. Per-dataset pass rate
(`downbeat_check` in each record):

| dataset | loops passing downbeat check | rate |
|---|---|---|
| TR9 | 3780 / 3780 | **100%** — trust the TR9 position numbers fully |
| HH-TRP | 13099 / 15000 | **87%** — mostly reliable, read with light caution |
| TR8 | 705 / 3790 | **19%** — do not over-trust TR8's low-band position numbers below; most TR8 loops' onset grid is misaligned to this analysis's beat-1 assumption, which plausibly explains why TR8's positions read more smeared/uniform than TR9's clean peaks (see TR8 section) |

## The numbers, compared against the built-in StyleSpecs

This entry does not edit `packages/core/src/drums/grammars.ts`. These are
reported comparisons to weigh, per `docs/dev-loop.md`.

### TR9 (house/techno, TR-909-style) vs `HOUSE_STYLE_SPEC`/`TECHNO_STYLE_SPEC`

| position (16-grid) | 0 | 4 | 8 | 12 | pilot (n=14) |
|---|---|---|---|---|---|
| low-band hit prob (n=3780) | **100%** | **100%** | **100%** | **100%** | 95/98/98/98% |

**Four-on-the-floor: confirmed, more cleanly than the pilot suggested.**
Both specs assume `kickBeats: "four-floor"` (kick on every beat). The full
low band hits 100.0% at all four beat positions and the downbeat check
passes 3780/3780 (100%), as clean a confirmation as this method can give.
Swing: off-16ths land essentially on time relative to on-8ths (-0.004 beats
equivalent), agreeing with both specs' `swingDelay: 0`, as the pilot found.

The mid band also spikes near 100% at 0/4/8/12. That is very likely **kick
harmonic bleed**, not a clean clap/backbeat confirmation: house/techno's
backbeat lands on grid positions the kick already dominates, so this proxy
cannot separate them.

### TR8 (TR-808/electro) vs the house-family four-floor assumption

| position (16-grid) | 0 | 4 | 8 | 12 | pilot (n=25) |
|---|---|---|---|---|---|
| low-band hit prob (n=3790) | 74.3% | 71.2% | 72.6% | 73.3% | 99/61/75/61% |

**The pilot's headline ("beat 1 near-universal, others weaker") was largely
a small-sample artifact.** At full n the four beat positions read evenly
(71-74%): far from TR9's clean 100%, and not the lopsided 99/61/75/61 of the
n=25 pilot. Read this with caution regardless. Only 19% of TR8 loops pass
the downbeat check (vs. TR9's 100%), so most TR8 onset grids are likely
offset from the beat-1 assumption, and the even 71-74% may itself come from
smeared, misaligned positions rather than kicks spread evenly across the
beats. The position numbers need a downbeat-detection fix (or a manual
per-loop offset pass) before they are trustworthy; that follow-up is open.
Swing is essentially straight (0.0012 beats), agreeing with
`swingDelay: 0`. Alignment does not affect it, since swing is measured
relative to each loop's own onsets, not the absolute grid.

### HH-TRP (trap) vs `TRAP_STYLE_SPEC`

| position (16-grid) | 0 (kick "anchor") | 8 (snare beat 3) | pilot (n=20) |
|---|---|---|---|
| low-band hit prob (n=15000) | **49.4%** | — | 52% |
| mid-band hit prob | — | **93.0%** | 99% |

**Backbeat: confirmed strongly, at scale.** `TRAP_STYLE_SPEC.snareBeat: 3`
(with `clapWithSnare: true`) predicts a near-universal snare+clap on beat 3.
The mid band hits 93.0% there across 15000 loops, slightly below the pilot's
99% and still the most reliable finding in this pass.

**Kick anchor: disagrees, and the finding is robust.** 49.4% at n=15000 vs.
52% at n=20: nearly identical at 750x the sample size. All six curated
`TRAP_KICK_CELLS` start with `offsets: [0, ...]` (beat 1 "always anchors"
per the code comment), but barely half of real trap loops here show a
low-band onset there. Two explanations remain and this pass cannot separate
them: (1) soft-attack 808 glides on beat 1 that do not register as
spectral-flux onsets, or (2) the dataset's algorithmically generated MIDI
patterns anchoring beat 1 less often than the six curated cells assume.
HH-TRP's 87% downbeat pass rate makes some contribution from (1) plausible,
but it cannot explain the whole 50-point shortfall. **This is a
statistically solid open question for a deliberate, hand-reviewed look at
`TRAP_KICK_CELLS`.**

Low-band density has the same character as in the pilot (busier than the
curated cells' average); see the record for exact figures.

**Swing: the pilot's finding did not hold; it flipped sign.** The pilot
(n=20, ~1500 onsets) had off-16ths landing 7.5% of a step earlier than
on-8ths (-0.019 beats), opposite to `TRAP_STYLE_SPEC.swingDelay: 0.06`. At
full n (15000 loops, 866531 on-8th + 141770 off-16th onsets, three orders of
magnitude more data) the sign is positive: off-16ths land later by 0.0216
beats. That is the direction the spec assumes, at a smaller magnitude
(0.0216 vs. 0.06). A 20-loop sample gave a confidently wrong-signed answer
and 15000 loops gave the right sign, which is the risk this measurement
exists to catch. One caveat on magnitude: the figure pools all three hat
bases (`straight-8ths`/`16th-run`/`swung-16ths`), and only one carries a
delay in the generator, so per-hat-base bucketing would sharpen the
magnitude comparison. The direction question is resolved.

## What this entry does not claim

No number here has been used to edit `grammars.ts`/`styleSpec.ts`. Those
stay hand-authored, and any change based on this research is a deliberate,
reviewed, manual edit. The TR9 mid-band "backbeat" reading cannot separate
kick bleed from claps; do not cite it as a clap confirmation. Only the trap
mid band (position 8, no kick collision) is a clean read. TR8's low-band
position numbers are the least trustworthy of the three, not because the
sample is small (n=3790) but because the grid-alignment assumption this
method depends on fails for most of its loops.
