# Design: Audio-to-MIDI (B1)

- Status: built (2026-08-18).
- Scope: **melodic** transcription only. Drum/percussion timing detection is
  a different problem (already solved by `awh drums detect-onsets`, which
  finds hit positions, not pitches) — this feature does not touch it.

## Architecture

```
audio file ──► analysis/awh_analysis/a2m.py ──► JSON {notes, params, model, n_notes}
                 (Basic Pitch / basic_pitch.inference.predict, ONNX backend)
                                │
                    awh clip from-audio (Node CLI)
                 seconds->beats @ tempo, optional grid quantize,
                 clip-length = ceil(last note end) to whole bars
                                │
                     gateway: clip.create-midi / clip.notes
```

- **`analysis/awh_analysis/a2m.py`** wraps Spotify's
  [Basic Pitch](https://github.com/spotify/basic-pitch) (Apache-2.0),
  polyphonic melodic pitch estimation. All model inference lives here, same
  as every other measurement — the Node CLI does zero DSP.
- **Dependency**: ONNX Runtime backend, not TensorFlow. Basic Pitch's own
  PyPI metadata makes TensorFlow an *unconditional* dependency on Linux +
  Python ≥3.11, so it's installed with `--no-deps` plus its actual runtime
  deps (onnxruntime substituted for the inference backend) — see
  `analysis/README.md` for the exact command and the full license audit (no
  GPL/AGPL packages entered the venv; one LGPL-2.1 transitive dep — `soxr`,
  librosa's default resampler — called out explicitly since it's the one
  non-permissive license in the tree, though the constraint being guarded
  against is GPL/AGPL specifically). Basic Pitch ships a pre-converted
  `.onnx` copy of its model inside its own wheel, so no separate model
  download/conversion step is needed; it auto-selects ONNX at runtime
  because that's the only backend importable in this venv.
- **`awh clip from-audio <audioFile> <target>`** (Node CLI): runs
  `python -m awh_analysis a2m <file> --json`, converts the returned
  seconds-domain notes to beats at the Set's tempo (or `--bpm`), optionally
  quantizes note starts (and lengths ≥ one grid unit) to `--quantize`, computes
  clip length as the ceiling of the last note's end to a whole number of 4/4
  bars, then writes the clip via the same `clip.create-midi`/`clip.notes`
  gateway ops every other clip-writing command uses. Target is either a bare
  track path (auto-picks an empty session slot, like `awh drums gen`) or an
  explicit session slot (`track:0/slot:2`) — an existing clip at an explicit
  slot target is overwritten in place, the same occupied-target convention
  `awh lib place` established (`docs/lessons-learned.md` #3). The gateway has
  no clip-resize op, so a transcription longer than an existing clip's own
  length is clamped to fit (notes past the boundary are dropped, and the CLI
  says so) rather than silently sending notes Live would never play.

## Parameters

All four Basic Pitch tuning knobs are exposed as pass-through flags, with
Basic Pitch's own defaults kept as the CLI defaults so "just run it" behaves
like the reference implementation:

| Flag | Basic Pitch param | Default |
|---|---|---|
| `--onset-thresh` | `onset_threshold` | 0.5 |
| `--frame-thresh` | `frame_threshold` | 0.3 |
| `--min-len` (ms) | `minimum_note_length` | 127.70 |
| `--min-freq` / `--max-freq` | `minimum_frequency` / `maximum_frequency` | unrestricted |
| `--quantize <1/4\|1/8\|1/16\|1/32\|off>` | (ours, post-processing) | `off` |
| `--bpm` | (ours; seconds→beats) | the Set's tempo |

Note velocity (1–127) is a linear map of Basic Pitch's per-note amplitude
(itself roughly a confidence/energy score in [0,1], clamped defensively
before mapping) — not a measured loudness. Treat it as "louder/more
confident notes get higher velocity", not a calibrated dynamics capture.

## Honest limits (read before trusting the output)

- **A polyphonic pitch estimate, not ground truth.** Basic Pitch is a
  general-purpose model; it does well on clean monophonic and moderately
  polyphonic melodic material and can mis-hear octaves, miss quiet notes, or
  invent short spurious ones on dense/noisy audio. Every command run prints
  a closing "audition and correct in Live" line — this is a fast starting
  point, not a transcript to trust blind.
- **Not for drums.** Percussive/noise-like transcription is a different
  problem (onset timing, not pitch) — `awh drums detect-onsets` already
  solves it for one-shot drum captures. Don't route drum audio through
  `from-audio` expecting sensible pitches.
- **Deterministic, but only in the "same weights, no seed" sense.** Same
  file + same params reliably reproduce the same notes (verified: see
  `analysis/tests/test_a2m.py::test_deterministic_same_file_same_params`) —
  there's no random seed to expose, unlike `awh vary`/drum generation.
- **Zero notes is a state, not an error** (silence, or nothing crossed the
  thresholds): the CLI prints that plainly and exits 0 without creating an
  empty clip (`docs/lessons-learned.md` #5).
- **Negative-controlled against noise** (`docs/lessons-learned.md` #2):
  `test_negative_control_white_noise_does_not_produce_a_confident_melody`
  feeds broadband white noise through the exact same code path and asserts
  it does not fabricate a confident melody — empirically, Basic Pitch's
  default thresholds produce zero notes on white/pink noise at every
  amplitude tried; the test's bound is intentionally a little looser than
  "always exactly 0" so it stays meaningful without being brittle to minor
  model/library version drift.
