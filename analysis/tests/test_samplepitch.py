"""Pitch-tagging tests (docs/design/sample-library.md's verification
bar, same convention as test_samplescan.py): a synthetic tuned "808" one-shot
(a decaying low sine with a real fundamental), a broadband noise-burst
"kick" one-shot (no periodicity; the common real case this tool must not
mis-tag), and a too-short clip (state, not a crash)."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from awh_analysis import samplepitch
from conftest import sine, white_noise, write_wav

SR = 44100


def _decaying_sine(freq: float, sr: int, duration_s: float, amp: float, tau: float) -> np.ndarray:
    t = np.arange(int(round(duration_s * sr))) / sr
    env = np.exp(-t / tau)
    return amp * env * np.sin(2 * np.pi * freq * t)


def _tuned_808_oneshot(freq: float = 55.0) -> np.ndarray:
    """A clean, decaying low sine, the tuned-kick/808 case: has a real,
    trackable fundamental (A1 at 55 Hz)."""
    return _decaying_sine(freq, SR, 0.6, amp=0.6, tau=0.25)


def _broadband_kick_oneshot(seed: int = 3) -> np.ndarray:
    """A decaying noise burst, the common real "kick" case: mostly-low
    dominant band (a hard transient thump), but no coherent periodicity.
    Must land as unvoiced, never a confidently-wrong fabricated pitch."""
    t = np.linspace(0, 0.25, int(round(0.25 * SR)), endpoint=False)
    return white_noise(SR, 0.25, amp=0.6, seed=seed) * np.exp(-t * 12)


def _write(tmp_path, name: str, sig: np.ndarray) -> str:
    path = tmp_path / name
    write_wav(path, sig, SR)
    return str(path)


# ---------------------------------------------------------------------------
# pitch_for_sample: tuned vs. broadband vs. too-short
# ---------------------------------------------------------------------------


def test_tuned_808_lands_on_real_fundamental(tmp_path):
    path = _write(tmp_path, "808.wav", _tuned_808_oneshot(55.0))
    rec = samplepitch.pitch_for_sample(path)

    assert rec["unreadable"] is False
    assert rec["error"] is None
    assert rec["pitch_analysis_version"] == samplepitch.PITCH_ANALYSIS_VERSION
    assert rec["state"] == "voiced"
    assert rec["f0_hz"] == pytest.approx(55.0, rel=0.05)
    assert rec["note"]["name"] == "A1"
    assert rec["voiced_fraction"] > 0.5


def test_broadband_kick_is_unvoiced_not_a_fabricated_pitch(tmp_path):
    """The negative control this tool exists to get right: a real kick is
    usually a broadband transient, not a tuned tone, so it must come back
    unvoiced/low-confidence, never a confidently-wrong f0."""
    path = _write(tmp_path, "kick.wav", _broadband_kick_oneshot())
    rec = samplepitch.pitch_for_sample(path)

    assert rec["unreadable"] is False
    assert rec["state"] in ("unvoiced", "too_short")
    assert rec["f0_hz"] is None
    assert rec["note"] is None


def test_too_short_clip_is_a_state_not_a_crash(tmp_path):
    path = _write(tmp_path, "tooshort.wav", sine(55.0, SR, 0.01, amp=0.5))
    rec = samplepitch.pitch_for_sample(path)

    assert rec["unreadable"] is False
    assert rec["state"] == "too_short"
    assert rec["f0_hz"] is None


def test_determinism(tmp_path):
    path = _write(tmp_path, "808.wav", _tuned_808_oneshot(55.0))
    r1 = samplepitch.pitch_for_sample(path)
    r2 = samplepitch.pitch_for_sample(path)
    assert r1 == r2


# ---------------------------------------------------------------------------
# Negative controls / robustness — never a crash
# ---------------------------------------------------------------------------


def test_missing_file_is_unreadable_record(tmp_path):
    rec = samplepitch.pitch_for_sample(str(tmp_path / "does-not-exist.wav"))
    assert rec["unreadable"] is True
    assert rec["error"]
    assert "path" in rec


def test_corrupt_file_is_unreadable_record(tmp_path):
    path = tmp_path / "corrupt.wav"
    path.write_bytes(b"not actually a wav file, just garbage bytes" * 4)
    rec = samplepitch.pitch_for_sample(str(path))
    assert rec["unreadable"] is True
    assert rec["error"]


def test_empty_audio_is_unreadable_record(tmp_path):
    path = _write(tmp_path, "empty.wav", np.zeros(0))
    rec = samplepitch.pitch_for_sample(str(path))
    assert rec["unreadable"] is True


def test_silence_does_not_crash(tmp_path):
    path = _write(tmp_path, "silence.wav", np.zeros(int(round(1.0 * SR))))
    rec = samplepitch.pitch_for_sample(path)
    assert rec["unreadable"] is False
    assert rec["state"] in ("unvoiced", "too_short")


# ---------------------------------------------------------------------------
# CLI: `python -m awh_analysis samplepitch` — JSONL batch, args and stdin
# ---------------------------------------------------------------------------

REPO_ANALYSIS = Path(__file__).resolve().parents[1]


def _run_samplepitch(args: list[str], stdin: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "awh_analysis", "samplepitch", *args],
        input=stdin,
        capture_output=True,
        text=True,
        cwd=str(REPO_ANALYSIS),
    )


def test_cli_samplepitch_args_emits_jsonl(tmp_path):
    good = _write(tmp_path, "808.wav", _tuned_808_oneshot(55.0))
    missing = str(tmp_path / "missing.wav")

    proc = _run_samplepitch([good, missing])
    assert proc.returncode == 0, proc.stderr
    lines = [json.loads(l) for l in proc.stdout.strip().splitlines()]
    assert len(lines) == 2
    assert lines[0]["unreadable"] is False
    assert lines[0]["state"] == "voiced"
    assert lines[1]["unreadable"] is True


def test_cli_samplepitch_stdin_emits_jsonl(tmp_path):
    kick = _write(tmp_path, "kick.wav", _broadband_kick_oneshot())
    proc = _run_samplepitch([], stdin=kick + "\n")
    assert proc.returncode == 0, proc.stderr
    lines = [json.loads(l) for l in proc.stdout.strip().splitlines()]
    assert len(lines) == 1
    assert lines[0]["unreadable"] is False


def test_cli_samplepitch_never_emits_nan_or_infinity_tokens(tmp_path):
    """Every record goes through `audio.sanitize_json` (same as samplescan):
    non-finite floats must come out as JSON `null`, never the invalid
    `NaN`/`Infinity` tokens Python's json module would otherwise write."""
    silent = _write(tmp_path, "silence.wav", np.zeros(int(round(1.0 * SR))))
    proc = _run_samplepitch([silent])
    assert proc.returncode == 0, proc.stderr
    assert "NaN" not in proc.stdout
    assert "Infinity" not in proc.stdout
    json.loads(proc.stdout.strip())  # must parse as strict JSON
