"""M11 sample-library scanning tests (docs/design/sample-library.md's
verification bar): a synthetic corpus of a sine-bass one-shot, a
noise-burst hat one-shot, and a kick loop at a known BPM."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from awh_analysis import samplescan
from conftest import sine, white_noise, write_wav

SR = 44100
BPM = 120.0

LEAD_IN_S = 0.06  # see test_drumstats.py — clears one full STFT window
# before the first onset so spectral-flux detection isn't damped by frame 0.


def _decaying_sine(freq: float, sr: int, duration_s: float, amp: float, tau: float) -> np.ndarray:
    t = np.arange(int(round(duration_s * sr))) / sr
    env = np.exp(-t / tau)
    return amp * env * np.sin(2 * np.pi * freq * t)


def _sine_bass_oneshot() -> np.ndarray:
    """A clean 80 Hz sine, 0.6 s — well under the loop-duration floor."""
    return sine(80.0, SR, 0.6, amp=0.6)


def _noise_hat_oneshot(seed: int = 1) -> np.ndarray:
    """A short, broadband noise burst — the "hat" proxy also used by
    test_drumstats.py's synthetic loop, standalone as a one-shot."""
    return white_noise(SR, 0.12, amp=0.5, seed=seed)


def _kick_loop(bpm: float = BPM, n_hits: int = 8) -> np.ndarray:
    """A 60 Hz decaying-sine kick repeated every beat at a known BPM —
    enough beats for the autocorrelation tempo engine to lock on."""
    beat_s = 60.0 / bpm
    duration_s = LEAD_IN_S + n_hits * beat_s + 0.2
    n = int(round(duration_s * SR))
    rng = np.random.default_rng(11)
    sig = 0.001 * rng.standard_normal(n)
    for i in range(n_hits):
        t0 = LEAD_IN_S + i * beat_s
        start = int(round(t0 * SR))
        burst = _decaying_sine(60.0, SR, 0.12, 0.9, 0.04)
        end = min(n, start + len(burst))
        sig[start:end] += burst[: end - start]
    return sig


def _write(tmp_path, name: str, sig: np.ndarray) -> str:
    path = tmp_path / name
    write_wav(path, sig, SR)
    return str(path)


# ---------------------------------------------------------------------------
# scan_file: feature ranges + type guesses
# ---------------------------------------------------------------------------


def test_sine_bass_oneshot_features(tmp_path):
    path = _write(tmp_path, "bass_oneshot.wav", _sine_bass_oneshot())
    rec = samplescan.scan_file(path)

    assert rec["unreadable"] is False
    assert rec["error"] is None
    assert rec["duration_s"] == pytest.approx(0.6, abs=0.01)
    assert rec["channels"] == 1
    assert rec["sample_rate"] == SR
    assert rec["type_guess"] == "oneshot"
    assert "oneshot" in rec["type_guess_basis"]
    # short, sub-loop-duration file -> BPM never attempted
    assert rec["bpm"] is None
    assert rec["bpm_confidence"] is None
    # an 80 Hz tone's energy sits almost entirely under the 120 Hz low-band
    # cutoff
    assert rec["dominant_band"] == "low"
    assert rec["band_energy"]["low"] > 0.9
    assert rec["rms_db"] < 0.0  # never above digital full-scale
    assert rec["peak_db"] < 0.0


def test_noise_hat_oneshot_features(tmp_path):
    path = _write(tmp_path, "noise_hat.wav", _noise_hat_oneshot())
    rec = samplescan.scan_file(path)

    assert rec["unreadable"] is False
    assert rec["type_guess"] == "oneshot"
    assert rec["bpm"] is None
    # broadband noise's power is dominated by the (much wider) high band
    assert rec["dominant_band"] == "high"
    assert rec["spectral_flatness"] > 0.1  # noisy, not tonal


def test_kick_loop_type_guess_and_bpm(tmp_path):
    path = _write(tmp_path, "kick_loop_120bpm.wav", _kick_loop(BPM))
    rec = samplescan.scan_file(path)

    assert rec["unreadable"] is False
    assert rec["type_guess"] == "loop"
    assert "loop" in rec["type_guess_basis"]
    assert rec["onset_count"] >= samplescan.LOOP_MIN_ONSETS
    assert rec["bpm"] is not None
    assert rec["bpm"] == pytest.approx(BPM, abs=3.0)
    assert rec["bpm_confidence"] is not None
    assert rec["bpm_confidence"] > 0.3
    assert rec["dominant_band"] == "low"


def test_feature_vector_shape(tmp_path):
    path = _write(tmp_path, "kick_loop.wav", _kick_loop(BPM))
    rec = samplescan.scan_file(path)

    assert len(rec["mfcc_means"]) == 13
    assert len(rec["similarity_vector"]) == samplescan.SIMILARITY_VECTOR_LEN
    assert rec["similarity_vector"][:13] == rec["mfcc_means"]

    band = rec["band_energy"]
    assert set(band.keys()) == {"low", "mid", "high"}
    assert sum(band.values()) == pytest.approx(1.0, abs=1e-6)
    assert rec["dominant_band"] in band


def test_determinism(tmp_path):
    path = _write(tmp_path, "kick_loop.wav", _kick_loop(BPM))
    r1 = samplescan.scan_file(path)
    r2 = samplescan.scan_file(path)
    assert r1 == r2


# ---------------------------------------------------------------------------
# Negative controls / robustness — never a crash
# ---------------------------------------------------------------------------


def test_missing_file_is_unreadable_record(tmp_path):
    rec = samplescan.scan_file(str(tmp_path / "does-not-exist.wav"))
    assert rec["unreadable"] is True
    assert rec["error"]
    assert "path" in rec


def test_corrupt_file_is_unreadable_record(tmp_path):
    path = tmp_path / "corrupt.wav"
    path.write_bytes(b"not actually a wav file, just garbage bytes" * 4)
    rec = samplescan.scan_file(str(path))
    assert rec["unreadable"] is True
    assert rec["error"]


def test_empty_audio_is_unreadable_record(tmp_path):
    path = _write(tmp_path, "empty.wav", np.zeros(0))
    rec = samplescan.scan_file(str(path))
    assert rec["unreadable"] is True


def test_silence_does_not_crash(tmp_path):
    """Digital silence is a legitimate (if useless) sample — must scan
    cleanly, never NaN/crash (docs/lessons-learned.md #5 generalized)."""
    path = _write(tmp_path, "silence.wav", np.zeros(int(round(1.0 * SR))))
    rec = samplescan.scan_file(path)
    assert rec["unreadable"] is False
    assert rec["rms_db"] is not None
    assert all(np.isfinite(v) for v in rec["mfcc_means"])


# ---------------------------------------------------------------------------
# CLI: `python -m awh_analysis samplescan` — JSONL batch, args and stdin
# ---------------------------------------------------------------------------

REPO_ANALYSIS = Path(__file__).resolve().parents[1]


def _run_samplescan(args: list[str], stdin: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "awh_analysis", "samplescan", *args],
        input=stdin,
        capture_output=True,
        text=True,
        cwd=str(REPO_ANALYSIS),
    )


def test_cli_samplescan_args_emits_jsonl(tmp_path):
    good = _write(tmp_path, "bass.wav", _sine_bass_oneshot())
    missing = str(tmp_path / "missing.wav")

    proc = _run_samplescan([good, missing])
    assert proc.returncode == 0, proc.stderr
    lines = [json.loads(l) for l in proc.stdout.strip().splitlines()]
    assert len(lines) == 2
    assert lines[0]["unreadable"] is False
    assert lines[1]["unreadable"] is True


def test_cli_samplescan_stdin_emits_jsonl(tmp_path):
    good = _write(tmp_path, "hat.wav", _noise_hat_oneshot())
    proc = _run_samplescan([], stdin=good + "\n")
    assert proc.returncode == 0, proc.stderr
    lines = [json.loads(l) for l in proc.stdout.strip().splitlines()]
    assert len(lines) == 1
    assert lines[0]["type_guess"] == "oneshot"


def test_cli_samplescan_never_emits_nan_or_infinity_tokens(tmp_path):
    """Every record goes through `audio.sanitize_json` — non-finite floats
    must come out as JSON `null`, never the invalid `NaN`/`Infinity`
    tokens Python's json module would otherwise happily write (M6 finding,
    see audio.sanitize_json's docstring)."""
    silent = _write(tmp_path, "silence.wav", np.zeros(int(round(1.0 * SR))))
    proc = _run_samplescan([silent])
    assert proc.returncode == 0, proc.stderr
    assert "NaN" not in proc.stdout
    assert "Infinity" not in proc.stdout
    json.loads(proc.stdout.strip())  # must parse as strict JSON
