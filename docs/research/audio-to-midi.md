# Research: Audio-to-MIDI ("Convert to Melody") — Aug 2026

Question: is NoteGrabber 2 proprietary, and is there a convert-to-melody
algorithm better than Ableton's built-in that we can legally embed?

## NoteGrabber 2 (Navie D) — verdict: not an algorithm at all

- VST3/AU plugin (not M4L), $69, proprietary/closed-source, released Jul 2025.
- **It performs no automatic transcription.** It renders a spectrogram over a
  piano roll and the user manually paints/traces the notes. Gearspace users
  called its "100% accurate" marketing misleading: it is a visualizer,
  accuracy is the user's tracing, and output carries zero velocity data.
- Mixed reviews follow: no ghost notes (nothing is automatic), but "tedious"
  and pricey vs. alternatives.
- Orthogonal to our need. Its spectrogram-review UX is the one idea worth
  borrowing, as a review layer on top of automatic transcription.

## Ableton's built-in converter — the bar is low and hasn't moved

- Classic DSP pitch-tracking + transient segmentation (note boundaries come
  from warp/transient markers), dating to Live 9 (2013). Convert Drums maps to
  only kick/snare/hat.
- Complaints unchanged since 2013: missed onsets, "2-3 random notes" from clear
  loops, stuttered chords. Live 12.0–12.4 release notes show no converter
  improvements. 12.3 added stem separation (Music AI/Moises), which cleans the
  input, not the transcriber.

## The embeddable winner: Spotify Basic Pitch

- ICASSP 2022 neural model (harmonic CQT + tiny CNN, ~17k params), polyphonic,
  instrument-agnostic, pitch bends. The community treats DAW built-ins as the
  floor and Basic Pitch as the free state of the art (NeuralNote, the
  well-regarded free plugin, is Basic Pitch in C++).
- **License: Apache-2.0 for code and model weights** (TF/CoreML/TFLite/ONNX all
  shipped under it; npm package license verified). Redistributable inside our
  MIT .ablx with LICENSE/NOTICE attribution. ADR-002-compatible.
- Node-ready: `@spotify/basic-pitch` (TypeScript, TF.js, ~1.8 MB incl.
  weights) accepts any AudioBuffer-shaped object, so it runs in the Extension
  Host. Caveat: pinned to tfjs 3.x, unmaintained since 2022. Preferred path
  (what NeuralNote validated): ONNX weights + onnxruntime-node (MIT), porting
  the small note-event post-processing from basic-pitch-ts. ~280 ms per 5 s of
  audio on native CPU; a 10 s clip well under a second.
- Post-processing is where perceived quality is won. Adopt NeuralNote's
  controls: note-split sensitivity, time quantization, scale snapping.

## Monophonic upgrade: CREPE Notes / SwiftF0 (all MIT)

- CREPE Notes (SMC 2023) segments CREPE f0 contours into notes and **beats
  Basic Pitch by +7–10% F on monophonic material** (flute 74%, double-bass
  stems 72%, solo sax 90%) with 97% fewer params. SwiftF0 (2025) outperforms
  CREPE at ~20× less compute and is ONNX-friendly.
- So a dedicated "melody (monophonic)" mode should use this pipeline;
  "harmony/polyphonic" mode uses Basic Pitch.

## Ruled out

- YourMT3+ (strongest open multi-instrument transcriber): GPL-3.0 +
  GPU/PyTorch, license- and runtime-incompatible.
- MT3/MR-MT3: JAX/T5X, frozen, no JS path; loses to Basic Pitch zero-shot on
  e.g. guitar (F50 52.4 vs 66.1).
- Timbre-Trap (MIT): no clear accuracy win over Basic Pitch, no JS path.
- Melodyne DNA ($399): gold standard on clean solo sources, "terrible on
  mixes" per consensus; proprietary. Samplab: cloud-only. Reference points,
  not options.

## Recommended feature shape (backlog candidate)

`awh convert <audio-clip-path>` + right-click "AWH: Convert to MIDI" on audio
clips:
1. Read the clip file path via the gateway (`clip.get` already returns it).
2. Decode + resample to 22,050 Hz mono; run Basic Pitch (ONNX) or the
   CREPE-Notes pipeline per mode; post-process (split sensitivity, quantize,
   scale-snap using the Set's scale from `set.summary`).
3. Write the result via the existing `clip.create-midi`; no new gateway ops.
4. Later: pair with 12.3 stem separation ("stem → transcribe → snap") and a
   spectrogram review UI (the one good NoteGrabber idea).

Sources: spotify/basic-pitch(-ts), DamRsn/NeuralNote, Ableton manual +
release notes, arXiv 2402.15258 / 2311.08884 / 2508.18440, Gearspace/KVR
reviews.
