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

## Full datasets mined — n in the thousands, pilot superseded

This entry originally reported a **pilot** on the small example-loop MP3s
checked into each dataset's GitHub repo (n=14/25/20). The owner downloaded
and mined the full Zenodo archives — **n=3780 (TR9), n=3790 (TR8), n=15000
(HH-TRP)** — real numbers below, not extrapolation. The pilot's own numbers
are kept in `library/measurements/waivops-{tr9,tr8,hhtrp}-pilot.json` for
the small-n-vs-full-n comparison (genuinely interesting: TR9 CONFIRMED
even more cleanly at full n, TR8's headline number was substantially a
small-sample artifact, and HH-TRP's swing finding **flipped sign** between
pilot and full — see each dataset's section). Confidence language below is
updated accordingly: this is no longer "a starting hypothesis to re-check",
it's a real measurement at a sample size that supports it.

## Executable

This entry is a MEASUREMENT REPORT, not a style spec — there is no
`awh-style-spec` block to feed `drums gen` here. The executable part is
retrieval: the raw numbers live in saved measurement records, reproducible
with the same command that made them.

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
start on beat 1). This is a **kick / snare-clap / hat PROXY**, not ground
truth — a kick's harmonics extend into the mid band, a clap smears across
mid and high, and a sustained 808 has a much softer attack than a spectral-
flux detector expects. Read every "low band" claim below as "where a kick
dominates in the mix", not "the isolated kick".

**The downbeat assumption does NOT hold uniformly at full n** — this is a
new, real finding the small pilot (which happened to pass 59/59) could not
have surfaced. Per-dataset pass rate (`downbeat_check` in each record):

| dataset | loops passing downbeat check | rate |
|---|---|---|
| TR9 | 3780 / 3780 | **100%** — trust the TR9 position numbers fully |
| HH-TRP | 13099 / 15000 | **87%** — mostly reliable, read with light caution |
| TR8 | 705 / 3790 | **19%** — DO NOT over-trust TR8's low-band position numbers below; most TR8 loops' onset grid is misaligned to this analysis's beat-1 assumption, which plausibly explains why TR8's positions read more smeared/uniform than TR9's clean peaks (see TR8 section) |

## The numbers, compared against the built-in StyleSpecs

`packages/core/src/drums/grammars.ts` is never edited by this entry — these
are REPORTED comparisons for the owner to weigh, per `docs/dev-loop.md`.

### TR9 (house/techno, TR-909-style) vs `HOUSE_STYLE_SPEC`/`TECHNO_STYLE_SPEC`

| position (16-grid) | 0 | 4 | 8 | 12 | pilot (n=14) |
|---|---|---|---|---|---|
| low-band hit prob (n=3780) | **100%** | **100%** | **100%** | **100%** | 95/98/98/98% |

**Four-on-the-floor: CONFIRMED, even more cleanly than the pilot suggested.**
Both specs assume `kickBeats: "four-floor"` (kick on every beat); the full
mined low band hits a literal 100.0% at all four beat positions, and the
downbeat check passes 3780/3780 (100%) — as clean a real-data confirmation
as this method can produce. Swing: off-16ths land essentially on-time
relative to on-8ths (-0.004 beats equivalent) — agrees with both specs'
`swingDelay: 0`, same conclusion as the pilot, now at real n.

Mid band still spikes near 100% at 0/4/8/12 — still very likely **kick
harmonic bleed**, not a clean clap/backbeat confirmation, for the same
reason as before: house/techno's backbeat lands on the same grid positions
the kick already dominates, so this proxy still cannot separate the two.

### TR8 (TR-808/electro) vs the house-family four-floor assumption

| position (16-grid) | 0 | 4 | 8 | 12 | pilot (n=25) |
|---|---|---|---|---|---|
| low-band hit prob (n=3790) | 74.3% | 71.2% | 72.6% | 73.3% | 99/61/75/61% |

**The pilot's headline number ("beat 1 near-universal, others weaker") was
substantially a small-sample artifact.** At full n the four beat positions
read much more evenly (71-74% across all four) — nowhere near TR9's clean
100%, but also not the lopsided 99/61/75/61 pattern the n=25 pilot showed.
**Read this number with real caution regardless**: only 19% of TR8 loops
pass the downbeat-alignment check (vs. TR9's 100%), meaning most TR8 loops'
onset grid is likely offset from this analysis's beat-1 assumption — the
more-even 71-74% distribution may itself be an artifact of smeared/
misaligned grid positions rather than a genuine "TR8 kicks land fairly
evenly across all 4 beats" finding. This dataset needs a downbeat-detection
fix (or a manual per-loop offset pass) before its position numbers are
fully trustworthy — flagged as a real follow-up, not resolved here. Swing
remains essentially straight (0.0012 beats) — agrees with `swingDelay: 0`,
unaffected by the alignment issue since swing is measured relative to each
loop's own onsets, not the absolute grid.

### HH-TRP (trap) vs `TRAP_STYLE_SPEC`

| position (16-grid) | 0 (kick "anchor") | 8 (snare beat 3) | pilot (n=20) |
|---|---|---|---|
| low-band hit prob (n=15000) | **49.4%** | — | 52% |
| mid-band hit prob | — | **93.0%** | 99% |

**Backbeat: CONFIRMED strongly, at real scale.** `TRAP_STYLE_SPEC.snareBeat:
3` (with `clapWithSnare: true`) predicts a near-universal snare+clap on beat
3; the mid band hits 93.0% there across 15000 loops — down slightly from the
pilot's 99% but still an overwhelming majority, the single most reliable
finding in this whole pass.

**Kick anchor: DISAGREES, and this is now a ROBUST finding, not a pilot
fluke.** 49.4% at n=15000 vs. the pilot's 52% at n=20 — essentially
identical numbers at a sample size 750x larger. Every one of the six
curated `TRAP_KICK_CELLS` starts with `offsets: [0, ...]` (beat 1 "always
anchors" per the code comment), but barely half of real trap loops in this
dataset have a detectable low-band onset there. The two candidate
explanations from the pilot still both stand and this full pass still can't
distinguish them: (1) soft-attack 808 glides landing on beat 1 without
registering as a spectral-flux "onset", or (2) the dataset's algorithmically
generated MIDI patterns genuinely not anchoring beat 1 as often as the
curated 6 cells assume. HH-TRP's downbeat-check pass rate (87%) is decent
but not perfect, so a modest reading of (1) contributing some of the gap is
reasonable — but it cannot explain the whole 50-point shortfall on its own.
**This is now a real, statistically solid open question for a deliberate,
hand-reviewed look at `TRAP_KICK_CELLS`** — not a pilot artifact to dismiss.

Low-band density is unchanged in character from the pilot (busier than the
curated cells' average) — see the record for exact figures.

**Swing: the pilot's finding did NOT hold — it flipped sign.** The pilot
(n=20, ~1500 onsets) reported off-16ths landing 7.5% of a step EARLIER than
on-8ths (-0.019 beats), sign-flipped from `TRAP_STYLE_SPEC.swingDelay: 0.06`.
At full n (15000 loops, 866531 on-8th + 141770 off-16th onsets — three
orders of magnitude more data), the sign **flips back to positive**:
off-16ths land LATER by 0.0216 beats — the same DIRECTION the spec assumes,
just a smaller magnitude (0.0216 vs the spec's 0.06). This is a clean
demonstration of exactly the risk this whole exercise exists to catch: a
20-loop sample gave a confidently wrong-signed answer; 15000 loops gave the
right-signed one. Same caveat as before still applies to the magnitude
comparison: this pools all three hat bases (`straight-8ths`/`16th-run`/
`swung-16ths`) and only one carries a delay in the generator, so a
per-hat-base bucketing pass would sharpen the magnitude comparison — but
the DIRECTION question this pilot got wrong is now resolved.

## What this entry does NOT claim

No number here has been used to edit `grammars.ts`/`styleSpec.ts`; those
stay hand-authored, and any future change based on this line of research is
a deliberate, reviewed, hand-made edit, never automatic. The mid-band
"backbeat" reading for TR9 is explicitly flagged as unable to separate kick
bleed from real claps — don't cite it as a clap confirmation, only the trap
mid-band (position 8, no kick collision there) is a clean read. TR8's
low-band position numbers specifically should be read with real caution
given its 19% downbeat-alignment pass rate — that dataset's numbers are the
least trustworthy of the three, not because the sample is small (it isn't,
n=3790) but because the grid-alignment assumption this method depends on
demonstrably fails for most of its loops.
