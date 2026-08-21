"""B1: melodic audio-to-MIDI transcription (Basic Pitch, ONNX backend).

Requires the `a2m` extra (see analysis/README.md) — skipped entirely if
basic-pitch isn't installed, so the rest of the suite stays green on a venv
that only has the M6 (measurement) dependencies.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

pytest.importorskip("basic_pitch")

from awh_analysis import a2m
from conftest import white_noise, write_wav

SR = 22050
ANALYSIS_ROOT = Path(__file__).resolve().parents[1]


def sine(freq: float, duration_s: float, sr: int = SR, amp: float = 0.5) -> np.ndarray:
    t = np.arange(int(round(duration_s * sr))) / sr
    return amp * np.sin(2 * np.pi * freq * t)


def test_single_note_sine_440hz_is_a4(tmp_path):
    """440 Hz -> MIDI 69 (A4), one note, covering nearly the whole 2s file."""
    path = tmp_path / "a440.wav"
    write_wav(path, sine(440.0, 2.0), SR)

    result = a2m.transcribe(str(path))

    assert result["n_notes"] >= 1
    pitches = [n["pitch"] for n in result["notes"]]
    assert 69 in pitches
    note = next(n for n in result["notes"] if n["pitch"] == 69)
    assert note["dur_s"] > 1.0  # spans most of the 2s tone
    assert 1 <= note["velocity"] <= 127


def test_two_note_sequence_in_order(tmp_path):
    """220 Hz (A3=57) then a gap then 330 Hz (E4=64): both detected, in order,
    and sorted by start time (the function's documented sort key)."""
    gap = np.zeros(int(round(0.2 * SR)))
    x = np.concatenate([sine(220.0, 0.8), gap, sine(330.0, 0.8)])
    path = tmp_path / "twonote.wav"
    write_wav(path, x, SR)

    result = a2m.transcribe(str(path))

    assert result["n_notes"] == 2
    pitches = [n["pitch"] for n in result["notes"]]
    assert pitches == [57, 64]
    # notes list is sorted by start_s (documented contract)
    starts = [n["start_s"] for n in result["notes"]]
    assert starts == sorted(starts)
    assert starts[0] < starts[1]


def test_silence_is_zero_notes_not_an_error(tmp_path):
    """Zero notes is a valid STATE (docs/lessons-learned.md #5), not a
    thrown error — silence -> n_notes == 0, notes == []."""
    path = tmp_path / "silence.wav"
    write_wav(path, np.zeros(int(round(1.5 * SR))), SR)

    result = a2m.transcribe(str(path))

    assert result["n_notes"] == 0
    assert result["notes"] == []


def test_negative_control_white_noise_does_not_produce_a_confident_melody(tmp_path):
    """White noise has no pitched structure — the model must not hallucinate
    a melody out of it.

    Empirically (verified against this exact fixture while writing this
    test, onnxruntime CPU backend): Basic Pitch's default thresholds produce
    EXACTLY ZERO notes on white noise at every amplitude tried (0.2 to 0.95
    full-scale) and on pink noise too — broadband noise doesn't resemble the
    model's learned harmonic/onset features closely enough to cross
    onset_thresh=0.5/frame_thresh=0.3. We assert a looser bound than "always
    exactly 0" on purpose: a small note count with short durations, so the
    test keeps meaning (catches genuine melody hallucination) without being
    brittle to minor model/library version drift that might produce an
    occasional short spurious blip.
    """
    x = white_noise(SR, 2.0, amp=0.5, seed=20260817)
    path = tmp_path / "noise.wav"
    write_wav(path, x, SR)

    result = a2m.transcribe(str(path))

    assert result["n_notes"] <= 3
    assert all(n["dur_s"] < 1.0 for n in result["notes"])


def test_deterministic_same_file_same_params(tmp_path):
    """Same file + params -> identical JSON (no seed, no randomness at
    inference time — the whole point of a transcription tool)."""
    path = tmp_path / "det.wav"
    write_wav(path, sine(440.0, 1.5), SR)

    a = a2m.transcribe(str(path))
    b = a2m.transcribe(str(path))

    assert a == b


def test_params_reflect_what_was_actually_used(tmp_path):
    path = tmp_path / "params.wav"
    write_wav(path, sine(440.0, 1.2), SR)

    result = a2m.transcribe(
        str(path),
        onset_thresh=0.6,
        frame_thresh=0.4,
        min_note_len_ms=100.0,
        min_freq=100.0,
        max_freq=2000.0,
        melodia_trim=False,
    )

    assert result["params"] == {
        "onset_thresh": 0.6,
        "frame_thresh": 0.4,
        "min_note_len_ms": 100.0,
        "min_freq": 100.0,
        "max_freq": 2000.0,
        "melodia_trim": False,
    }
    assert result["model"].startswith("basic-pitch ")


def test_cli_a2m_json_smoke(tmp_path):
    """`python -m awh_analysis a2m <file> --json` — the exact invocation the
    Node CLI shells out to (see runAnalysisJson/`awh clip from-audio`)."""
    path = tmp_path / "cli440.wav"
    write_wav(path, sine(440.0, 1.5), SR)

    proc = subprocess.run(
        [sys.executable, "-m", "awh_analysis", "a2m", str(path), "--json"],
        capture_output=True,
        text=True,
        cwd=str(ANALYSIS_ROOT),
    )
    assert proc.returncode == 0, proc.stderr
    obj = json.loads(proc.stdout)
    for key in ("notes", "params", "model", "n_notes"):
        assert key in obj
    assert obj["n_notes"] >= 1
    assert obj["notes"][0]["pitch"] == 69
