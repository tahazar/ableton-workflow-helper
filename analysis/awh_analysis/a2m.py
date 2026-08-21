"""Melodic audio-to-MIDI transcription (B1).

Wraps Spotify's Basic Pitch (`basic_pitch.inference.predict`, Apache-2.0),
running on the ONNX Runtime backend (no TensorFlow — see analysis/README.md
for the exact install). Polyphonic pitch estimation, not ground truth: this
is a starting point to audition and correct in Live, not a transcript.

Deterministic on a given machine/onnxruntime build: the model has no
training-time-only randomness (no dropout at inference), so the same file +
params reliably produce the same note list — unlike `awh vary`/drum
generation, there is no seed to pass.
"""

from __future__ import annotations

import contextlib
import importlib.metadata
import io
from typing import Any, Dict, List, Optional, TypedDict


class Note(TypedDict):
    start_s: float
    dur_s: float
    pitch: int
    velocity: int


def _velocity_from_amplitude(amplitude: float) -> int:
    """Map Basic Pitch's ~[0,1] note amplitude/confidence to MIDI velocity 1-127.

    Amplitude is clamped defensively (the model's output is not contractually
    bounded to [0,1]) before the linear map, so an out-of-range value degrades
    to the nearest valid velocity instead of raising or emitting invalid MIDI.
    """
    amplitude = max(0.0, min(1.0, amplitude))
    return max(1, min(127, round(1 + amplitude * 126)))


def transcribe(
    path: str,
    *,
    onset_thresh: float = 0.5,
    frame_thresh: float = 0.3,
    min_note_len_ms: float = 127.70,
    min_freq: Optional[float] = None,
    max_freq: Optional[float] = None,
    melodia_trim: bool = True,
) -> Dict[str, Any]:
    """Transcribe monophonic/polyphonic melodic content in `path` to notes.

    Parameters mirror Basic Pitch's own defaults (onset_thresh=0.5,
    frame_thresh=0.3, min_note_len_ms=127.70, min/max_freq=None i.e.
    unrestricted, melodia_trim=True i.e. the melodia post-processing trick
    is applied). Returns a dict:

        {notes: [{start_s, dur_s, pitch, velocity}, ...] (sorted by
                 start_s then pitch),
         params: {...the params actually used...},
         model: "basic-pitch <version>",
         n_notes: len(notes)}

    Zero notes (silence, or nothing above threshold) is a valid, non-error
    result: notes == [] and n_notes == 0.
    """
    try:
        from basic_pitch.inference import predict
    except ImportError as exc:  # pragma: no cover - environment problem, not logic
        raise RuntimeError(
            "basic-pitch is not installed in this environment. See "
            "analysis/README.md for the exact ONNX-backend install command "
            "(pip install basic-pitch --no-deps, then onnxruntime + the "
            "non-tensorflow runtime deps)."
        ) from exc

    # Basic Pitch unconditionally prints "Predicting MIDI for <path>..." to
    # stdout (basic_pitch/inference.py, not gated behind its no_tf_warnings
    # log-level context) — swallow it so `--json` output stays parseable.
    with contextlib.redirect_stdout(io.StringIO()):
        _model_output, _midi_data, note_events = predict(
            path,
            onset_threshold=onset_thresh,
            frame_threshold=frame_thresh,
            minimum_note_length=min_note_len_ms,
            minimum_frequency=min_freq,
            maximum_frequency=max_freq,
            melodia_trick=melodia_trim,
        )

    notes: List[Note] = []
    for start_s, end_s, pitch, amplitude, *_rest in note_events:
        start = float(start_s)
        dur = max(0.0, float(end_s) - start)
        notes.append(
            {
                "start_s": start,
                "dur_s": dur,
                "pitch": int(pitch),
                "velocity": _velocity_from_amplitude(float(amplitude)),
            }
        )
    notes.sort(key=lambda n: (n["start_s"], n["pitch"]))

    try:
        model_version = importlib.metadata.version("basic-pitch")
    except importlib.metadata.PackageNotFoundError:  # pragma: no cover
        model_version = "unknown"

    return {
        "notes": notes,
        "params": {
            "onset_thresh": onset_thresh,
            "frame_thresh": frame_thresh,
            "min_note_len_ms": min_note_len_ms,
            "min_freq": min_freq,
            "max_freq": max_freq,
            "melodia_trim": melodia_trim,
        },
        "model": f"basic-pitch {model_version}",
        "n_notes": len(notes),
    }
