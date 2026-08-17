# Design: Reference-track deconstruction (M8 — R9)

- Status: in build (2026-08-17). Science basis:
  `docs/research/reference-track-analysis.md`; measurement engine: M6.
- Owner workflow being automated: drop a reference into the project, mark
  intro/build/drop/breakdown by ear, arrange against it. M8 produces the
  DRAFT map; the owner corrects it in Live (draft-with-correction, the
  rekordbox-proven pattern). Nothing here guesses beyond its confidence.

## Commands

```
awh ref analyze <audio> [--save <name>] [--json]   # tempo/grid/arc/sections
awh ref sections apply <analysis.json|audio> [--track <path>]  # draft map -> marker clips
awh ref sections read <trackPath> [--bpm N] [-o updated.json]  # corrections -> json
```

`--save` stores the analysis as `library/references/<name>.json` (a knowledge
citizen like measurement records; `kb index` surfaces both). `ref analyze`
also embeds the M6 measurement profile (spectrum/LUFS/width) so a reference
doubles as arrangement map AND tonal target material.

## Algorithms (deterministic DSP — no ML deps in v1)

All in `awh_analysis/ref.py`, numpy/scipy only. Confidence is reported on
every inferred quantity; the honest failure mode is "low confidence", never
a silently wrong answer.

### Tempo + beat grid

1. Onset strength: spectral flux from an STFT (2048 window, 512 hop, Hann),
   half-wave rectified, per-frame sum over bins; plus a separate sub-band
   (<150 Hz, 4th-order Butterworth) energy envelope for kick tracking.
2. Tempo: autocorrelation of the onset envelope, candidate periods 60–200
   BPM; score each candidate `ac(T) + 0.5·ac(2T) + 0.5·ac(T/2)` (harmonic
   support) and take the best; refine to sub-BPM precision by parabolic
   interpolation around the peak. Confidence = peak prominence over the
   next-best non-harmonic candidate. Report the runner-up candidate too
   (half/double-time ambiguity is real in trap — surface it, don't hide it).
3. Beat phase: comb alignment — the offset in [0, period) maximizing summed
   onset strength at beat positions.
4. Downbeat: among the 4 beat phases, pick the one maximizing sub-band
   energy at candidate bar starts (kick-on-1 heuristic, stated as such),
   tie-broken by spectral-novelty alignment. Confidence reported; half-time
   material gets a note, not a fake certainty.
5. Constant tempo assumed (electronic references); grid = bpm + offset_s.

### Bar-synced energy arc

Per bar: full-band RMS dB, sub (<100 Hz) dB, highs (>5 kHz) dB — each
relative to the track's own maximum. Smoothed copy (3-bar median) used for
section rules; raw kept in the output.

### Section rules (4/4 electronic forms; confidence-tagged)

Boundaries snap to 4-bar edges (8 with `--phrase 8`). On the smoothed arc:

- **drop**: full-band jumps ≥3 dB over the previous 4-bar mean AND sub
  within 6 dB of track max, sustained ≥4 bars.
- **breakdown**: full ≥3 dB below the previous 8-bar mean OR sub falls ≥8 dB
  below track max, sustained ≥4 bars, after at least one drop.
- **build**: monotonic-ish rise (positive fitted slope ≥0.3 dB/bar over ≥4
  bars) terminating at a drop; typically sub-light — noted in evidence.
- **intro/outro**: leading/trailing regions below 60% of max energy before
  the first build/drop and after the last drop/breakdown.
- Everything else between named sections: unlabeled `section` (no invented
  pop labels — research constraint).

Each section: `{name, startBar, endBar, confidence, evidence}` where
evidence quotes the numbers that fired the rule ("full +4.2 dB vs prev 4-bar
mean; sub −1.1 dB from max").

## Live side (marker clips)

Cue points are read-only in the SDK, so the map lands as EMPTY, NAMED MIDI
clips on a dedicated "Sections" MIDI track (created if absent, or `--track`):
one clip per section spanning its bars, named `<name> <len>b [c=0.82]`.
The owner corrects by dragging/renaming; `ref sections read` converts the
clips back to an updated analysis JSON (names parsed leniently; unknown
names kept verbatim). Safety: apply refuses a track that has ANY clips
unless `--clear` (same rule as `sections apply`).

## Out of v1 (parked per research)

Key detection (libkeyfinder subprocess later), ML section labels (EDMFormer),
stem-presence lanes, tempo drift/rubato, non-4/4.

## Verification (offline-first)

Synthetic references with KNOWN structure (constructed kick grids + section
energy envelopes at exact BPMs) must round-trip: bpm within ±0.1, downbeat
within ±1 beat, every constructed boundary within ±2 bars quantized. A
half-time synthetic must surface the half/double ambiguity in candidates
rather than silently picking wrong. Real-track spot-check happens in the
owner's Live pass (checklist).
