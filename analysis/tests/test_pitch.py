"""pitch.py tests (M6b masking toolkit) — synthetic signals with known
ground truth. The headline regression test reproduces the exact live
failure the gap report (docs/design/analysis-engine.md, 2026-08-23)
describes: a naive "loudest FFT bin" picker reported a growl's 2nd
harmonic as the note once it outgrew the fundamental. `estimate_f0`'s
periodicity tracking (pyin) must still land on the fundamental — AND the
honesty feature must separately flag the dominance, not hide it.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from awh_analysis import pitch as P
from conftest import sine, to_stereo, white_noise, write_wav

SR = 44100


def _growl_with_dominant_2nd_harmonic(
    f0: float, sr: int, duration_s: float, fund_amp: float = 1.0
) -> np.ndarray:
    """Fundamental + a 2nd harmonic that RAMPS from quiet to well past the
    fundamental's own amplitude partway through — the exact live-caught
    shape (docs/design/analysis-engine.md 2026-08-23 gap report)."""
    t = np.arange(int(round(duration_s * sr))) / sr
    harmonic_amp = np.linspace(0.3, 1.6, len(t))  # ends louder than fund_amp
    sig = fund_amp * np.sin(2 * np.pi * f0 * t) + harmonic_amp * np.sin(2 * np.pi * 2 * f0 * t)
    return sig / np.max(np.abs(sig)) * 0.8


# ---------------------------------------------------------------------------
# The regression test: growl with a dominant 2nd harmonic
# ---------------------------------------------------------------------------


def test_growl_dominant_2nd_harmonic_f0_stays_at_fundamental_and_gets_flagged(tmp_path):
    f0 = 100.0
    x = _growl_with_dominant_2nd_harmonic(f0, SR, 2.0)
    path = tmp_path / "growl.wav"
    write_wav(path, to_stereo(x), SR)

    result = P.pitch(str(path))
    assert result["state"] == "voiced"
    # THE regression: f0 must land on the fundamental, not the 2nd harmonic
    # a naive spectral-peak picker was caught reporting live.
    assert result["f0_hz"] == pytest.approx(f0, rel=0.02)
    assert result["f0_hz"] < 1.5 * f0  # sanity margin: nowhere near 2*f0

    dom = result["harmonic_dominance"]
    assert dom["flagged"] is True
    assert dom["harmonic"] == 2
    assert dom["ratio_db"] > 0
    assert dom["time_s"] is not None
    assert dom["time_s"] > 1.0  # dominance only develops in the back half
    assert 0.0 < dom["fraction_of_voiced_frames"] <= 1.0


def test_growl_negative_control_constant_subordinate_2nd_harmonic_not_flagged(tmp_path):
    """Negative control (docs/lessons-learned.md rule 2): a 2nd harmonic
    that stays well BELOW the fundamental the whole time must NOT be
    flagged — the detector isn't just always-on."""
    t = np.arange(int(round(2.0 * SR))) / SR
    sig = 1.0 * np.sin(2 * np.pi * 100.0 * t) + 0.2 * np.sin(2 * np.pi * 200.0 * t)
    x = sig / np.max(np.abs(sig)) * 0.8
    path = tmp_path / "growl_subordinate.wav"
    write_wav(path, to_stereo(x), SR)

    result = P.pitch(str(path))
    assert result["f0_hz"] == pytest.approx(100.0, rel=0.02)
    assert result["harmonic_dominance"]["flagged"] is False
    assert result["harmonic_dominance"]["harmonic"] is None
    assert result["harmonic_dominance"]["ratio_db"] is None


# ---------------------------------------------------------------------------
# Pure tone -> clean f0/note/cents
# ---------------------------------------------------------------------------


def test_pure_tone_clean_f0_note_cents(tmp_path):
    x = sine(220.0, SR, 1.5, amp=0.8)  # A3, exactly on a note center
    path = tmp_path / "a3.wav"
    write_wav(path, to_stereo(x), SR)

    result = P.pitch(str(path))
    assert result["state"] == "voiced"
    assert result["f0_hz"] == pytest.approx(220.0, rel=0.01)
    assert result["note"]["name"] == "A3"
    assert abs(result["note"]["cents"]) < 20.0
    assert result["voiced_fraction"] > 0.9
    assert result["confidence"] > 0.0
    assert result["f0_stability_semitones"] is not None
    assert result["f0_stability_semitones"] < 0.5  # a steady tone barely drifts
    assert result["harmonic_dominance"]["flagged"] is False


def test_hz_to_note_known_values():
    a4 = P.hz_to_note(440.0)
    assert a4 == {"name": "A4", "midi": 69, "cents": pytest.approx(0.0, abs=1e-6)}
    c4 = P.hz_to_note(261.6256)
    assert c4["name"] == "C4"
    assert abs(c4["cents"]) < 1.0
    sharp = P.hz_to_note(440.0 * 2 ** (0.3 / 12))  # 30 cents sharp of A4
    assert sharp["name"] == "A4"
    assert sharp["cents"] == pytest.approx(30.0, abs=1.0)


# ---------------------------------------------------------------------------
# Silence / unvoiced -> a STATE, not an error (docs/lessons-learned.md #5)
# ---------------------------------------------------------------------------


def test_silence_is_a_state_not_an_error(tmp_path):
    x = np.zeros(int(round(1.5 * SR)))
    path = tmp_path / "silence.wav"
    write_wav(path, to_stereo(x), SR)

    result = P.pitch(str(path))  # must not raise
    assert result["state"] == "unvoiced"
    assert result["f0_hz"] is None
    assert result["note"] is None
    assert result["voiced_fraction"] == 0.0
    assert result["harmonic_dominance"]["flagged"] is False


def test_white_noise_mostly_unvoiced_or_low_confidence(tmp_path):
    """Noise has no stable periodicity — either reported unvoiced, or (if
    pyin finds scattered voiced frames) a low voiced_fraction/confidence.
    Never a crash, never a confidently-wrong note."""
    x = white_noise(SR, 1.5, amp=0.3)
    path = tmp_path / "noise.wav"
    write_wav(path, to_stereo(x), SR)

    result = P.pitch(str(path))  # must not raise
    assert result["voiced_fraction"] < 0.5


# ---------------------------------------------------------------------------
# Per-note segmentation
# ---------------------------------------------------------------------------


def test_per_note_segments_two_distinct_notes(tmp_path):
    note_a = sine(110.0, SR, 1.0, amp=0.8)  # A2
    gap = np.zeros(int(round(0.15 * SR)))
    note_b = sine(220.0, SR, 1.0, amp=0.8)  # A3
    x = np.concatenate([note_a, gap, note_b])
    path = tmp_path / "two_notes.wav"
    write_wav(path, to_stereo(x), SR)

    result = P.pitch(str(path), per_note=True)
    assert "notes" in result
    assert len(result["notes"]) >= 2
    voiced_notes = [n for n in result["notes"] if n["state"] == "voiced"]
    assert len(voiced_notes) >= 2
    f0s = [n["f0_hz"] for n in voiced_notes]
    assert any(abs(f - 110.0) / 110.0 < 0.05 for f in f0s)
    assert any(abs(f - 220.0) / 220.0 < 0.05 for f in f0s)
    for n in result["notes"]:
        assert "start_s" in n and "end_s" in n
        assert n["end_s"] > n["start_s"]


def test_per_note_zero_onsets_is_a_state_not_an_error(tmp_path):
    """A pure DC/near-silent buzz with no clean attacks: zero onsets is a
    state (empty notes list), not an exception."""
    x = np.full(int(round(1.2 * SR)), 1e-6)
    path = tmp_path / "flat.wav"
    write_wav(path, to_stereo(x), SR)

    result = P.pitch(str(path), per_note=True)  # must not raise
    assert result["notes"] == []


# ---------------------------------------------------------------------------
# Determinism + CLI smoke
# ---------------------------------------------------------------------------


def test_determinism_same_file_same_result(tmp_path):
    x = sine(150.0, SR, 1.2, amp=0.7)
    path = tmp_path / "det.wav"
    write_wav(path, to_stereo(x), SR)
    r1 = P.pitch(str(path))
    r2 = P.pitch(str(path))
    assert r1 == r2


def test_cli_pitch_json_smoke(tmp_path):
    x = sine(220.0, SR, 1.2, amp=0.8)
    path = tmp_path / "smoke.wav"
    write_wav(path, to_stereo(x), SR)

    proc = subprocess.run(
        [sys.executable, "-m", "awh_analysis", "pitch", str(path), "--json"],
        capture_output=True,
        text=True,
        cwd=str(Path(__file__).resolve().parents[1]),
    )
    assert proc.returncode == 0, proc.stderr
    obj = json.loads(proc.stdout)
    assert obj["f0_hz"] == pytest.approx(220.0, rel=0.02)
    assert obj["note"]["name"] == "A3"


def test_cli_pitch_per_note_text_smoke(tmp_path):
    x = sine(220.0, SR, 1.2, amp=0.8)
    path = tmp_path / "smoke_text.wav"
    write_wav(path, to_stereo(x), SR)

    proc = subprocess.run(
        [sys.executable, "-m", "awh_analysis", "pitch", str(path), "--per-note"],
        capture_output=True,
        text=True,
        cwd=str(Path(__file__).resolve().parents[1]),
    )
    assert proc.returncode == 0, proc.stderr
    assert "Per-note" in proc.stdout
