"""opmatch tests — synthetic signals with known ground truth, including the
two negative controls the design doc calls for (white noise + an inharmonic
"bell", docs/design/operator-assistant.md): a reachability refusal is a
PASSING state here, not an error.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from awh_analysis import opmatch
from conftest import to_stereo, white_noise, write_wav

SR = 44100
DURATION_S = 2.0


def _harmonic_stack(f0: float, amps: list[float], sr: int, duration_s: float) -> np.ndarray:
    t = np.arange(int(round(duration_s * sr))) / sr
    sig = np.zeros_like(t)
    for k, a in enumerate(amps, start=1):
        sig += a * np.sin(2 * np.pi * f0 * k * t)
    return sig / np.max(np.abs(sig)) * 0.8


def _stretched_partial_bell(f0: float, stretch: float, n_partials: int, sr: int, duration_s: float) -> np.ndarray:
    """A "bell": partial k sits at f0*k*stretch^(k-1) (k=1 unstretched, each
    higher partial pulled progressively further off the integer-harmonic
    grid — the classic stretched-partial/inharmonic timbre), amplitude 1/k.
    """
    t = np.arange(int(round(duration_s * sr))) / sr
    sig = np.zeros_like(t)
    for k in range(1, n_partials + 1):
        fk = f0 * k * (stretch ** (k - 1))
        sig += (1.0 / k) * np.sin(2 * np.pi * fk * t)
    return sig / np.max(np.abs(sig)) * 0.8


def _adsr_tone(
    f0: float,
    sr: int,
    attack_s: float,
    decay_s: float,
    sustain_s: float,
    release_s: float,
    floor_db: float,
    peak_db: float,
    sustain_db: float,
) -> np.ndarray:
    """A sine carrier with an exact piecewise-linear-dB ADSR gain envelope
    applied — ground truth for fit_adsr."""
    total_s = attack_s + decay_s + sustain_s + release_s + 0.05
    n = int(round(total_s * sr))
    t = np.arange(n) / sr
    env_db = np.empty(n)
    decay_end = attack_s + decay_s
    sustain_end = decay_end + sustain_s
    release_end = sustain_end + release_s
    for i, tt in enumerate(t):
        if tt <= attack_s:
            env_db[i] = floor_db + (peak_db - floor_db) * (tt / attack_s)
        elif tt <= decay_end:
            env_db[i] = peak_db + (sustain_db - peak_db) * ((tt - attack_s) / decay_s)
        elif tt <= sustain_end:
            env_db[i] = sustain_db
        elif tt <= release_end:
            env_db[i] = sustain_db + (floor_db - sustain_db) * ((tt - sustain_end) / release_s)
        else:
            env_db[i] = floor_db
    gain = 10.0 ** (env_db / 20.0)
    sig = gain * np.sin(2 * np.pi * f0 * t)
    return sig / np.max(np.abs(sig)) * 0.8


# ---------------------------------------------------------------------------
# fit_adsr — synthetic ADSR envelope -> fitted params close
# ---------------------------------------------------------------------------


def test_fit_adsr_recovers_known_breakpoints_directly():
    """Hand-built times/env_db array (bypasses audio synthesis entirely) —
    the exact piecewise-linear-dB model fit_adsr is designed to detect."""
    sr_frames = 1000.0  # frames/sec, arbitrary for a synthetic array
    attack_s, decay_s, sustain_s, release_s = 0.05, 0.10, 0.40, 0.15
    floor_db, peak_db, sustain_db = -45.0, 0.0, -8.0
    total_s = attack_s + decay_s + sustain_s + release_s
    times = np.arange(0.0, total_s, 1.0 / sr_frames)
    env_db = opmatch._adsr_model_db(
        times, floor_db, peak_db, attack_s, decay_s, sustain_db, sustain_s, release_s
    )
    fit = opmatch.fit_adsr(times, env_db)
    assert fit["attack_s"] == pytest.approx(attack_s, abs=0.01)
    assert fit["decay_s"] == pytest.approx(decay_s, abs=0.01)
    assert fit["sustain_s"] == pytest.approx(sustain_s, abs=0.02)
    assert fit["release_s"] == pytest.approx(release_s, abs=0.02)
    assert fit["sustain_db"] == pytest.approx(sustain_db, abs=0.5)
    assert fit["r_squared"] >= 0.99


def test_analyze_fits_adsr_on_a_real_synthesized_tone(tmp_path):
    """End-to-end through analyze(): a sine carrier with a real ADSR gain
    envelope applied, loaded from a WAV file."""
    x = _adsr_tone(
        220.0,
        SR,
        attack_s=0.06,
        decay_s=0.15,
        sustain_s=0.8,
        release_s=0.3,
        floor_db=-50.0,
        peak_db=0.0,
        sustain_db=-6.0,
    )
    path = tmp_path / "adsr.wav"
    write_wav(path, to_stereo(x), SR)
    result = opmatch.analyze(str(path))

    adsr = result["adsr"]
    assert adsr["attack_s"] == pytest.approx(0.06, abs=0.03)
    assert adsr["decay_s"] == pytest.approx(0.15, abs=0.05)
    assert adsr["sustain_s"] == pytest.approx(0.8, abs=0.05)
    assert adsr["release_s"] == pytest.approx(0.3, abs=0.08)
    assert adsr["r_squared"] >= 0.95
    # A pure sine is a tier-1 candidate: 100% harmonic, sine waveform.
    gated = opmatch.gate(result)
    assert gated["tier"] == 1


# ---------------------------------------------------------------------------
# harmonic vector recovery — synthetic harmonic stack (known amps) -> vector
# recovered within tolerance
# ---------------------------------------------------------------------------


def test_harmonic_vector_recovers_known_partial_amplitudes(tmp_path):
    amps_true = [1.0, 0.5, 0.33, 0.25, 0.2, 0.166, 0.14, 0.125] + [0.0] * 8
    x = _harmonic_stack(220.0, amps_true, SR, DURATION_S)
    path = tmp_path / "stack.wav"
    write_wav(path, to_stereo(x), SR)

    result = opmatch.analyze(str(path))
    assert result["f0"]["hz"] == pytest.approx(220.0, rel=0.01)
    assert result["harmonicity_ratio"] >= 0.95

    expected = (np.array(amps_true) / amps_true[0]).tolist()
    recovered = result["harmonic_vector"]
    for i, (exp, got) in enumerate(zip(expected, recovered)):
        assert got == pytest.approx(exp, abs=0.08), f"partial {i + 1}: expected {exp}, got {got}"

    gated = opmatch.gate(result)
    assert gated["tier"] == 1


def test_match_reports_tier1_summary_for_a_harmonic_stack(tmp_path):
    amps_true = [1.0, 0.5, 0.33, 0.25, 0.2, 0.166, 0.14, 0.125]
    x = _harmonic_stack(220.0, amps_true, SR, DURATION_S)
    path = tmp_path / "saw_like.wav"
    write_wav(path, to_stereo(x), SR)

    result = opmatch.match(str(path))
    assert result["tier"] == 1
    assert result["reasons"] == []
    assert result["proposal"] is not None
    assert "good Operator candidate" in result["summary"]
    # drawThesePartials is ALWAYS present, regardless of tier/residual.
    assert len(result["proposal"]["drawThesePartials"]) == opmatch.N_PARTIALS
    assert set(result["proposal"]["addressable"]) >= {"Ae Attack", "Ae Decay", "Ae Sustain", "Ae Release"}


# ---------------------------------------------------------------------------
# Negative controls: white noise + an inharmonic bell -> tier-3 refusal.
# A PASSING state, not an error (docs/design/operator-assistant.md).
# ---------------------------------------------------------------------------


def test_white_noise_is_tier3_refused(tmp_path):
    x = white_noise(SR, DURATION_S, amp=0.2)
    path = tmp_path / "noise.wav"
    write_wav(path, to_stereo(x), SR)

    result = opmatch.match(str(path))
    assert result["tier"] == 3
    assert result["proposal"] is None
    assert result["reasons"], "tier-3 must report WHICH measured property is the blocker"
    assert "outside Operator's reachable set" in result["summary"]


def test_inharmonic_stretched_partial_bell_is_tier3_refused(tmp_path):
    """Partials pulled progressively off the integer-harmonic grid (a
    stretched-partial "bell" timbre) — reachable-set negative control #2.
    stretch=1.18 was empirically confirmed to reliably clear the gate
    threshold; pyin's f0 choice on adversarial inharmonic material isn't
    fully predictable at smaller stretch factors, so this value carries
    margin rather than sitting right at the threshold.
    """
    x = _stretched_partial_bell(220.0, stretch=1.18, n_partials=12, sr=SR, duration_s=DURATION_S)
    path = tmp_path / "bell.wav"
    write_wav(path, to_stereo(x), SR)

    result = opmatch.match(str(path))
    assert result["tier"] == 3
    assert result["proposal"] is None
    assert result["reasons"]


def test_partial_deviation_semitones_direct_known_truth():
    """Unit-level check of the inharmonicity measure against a HAND-BUILT
    magnitude spectrum at a known f0 (bypasses pyin entirely) — a clean
    harmonic comb reads ~0 deviation; a comb with k=3 deliberately shifted
    off-grid reads a large, correctly-signed deviation."""
    sr = 44100
    n_fft = opmatch.N_FFT
    freqs = np.fft.rfftfreq(n_fft, d=1.0 / sr)
    f0 = 220.0
    n_frames = 8

    def spectrum_with_partials(partial_freqs: list[float]) -> np.ndarray:
        mag = np.zeros((len(freqs), n_frames))
        for pf in partial_freqs:
            idx = int(np.argmin(np.abs(freqs - pf)))
            mag[idx, :] = 100.0
        return mag

    mask = np.ones(n_frames, dtype=bool)

    harmonic = spectrum_with_partials([f0 * k for k in range(1, 9)])
    dev_harmonic = opmatch.partial_deviation_semitones(harmonic, freqs, mask, f0)
    assert dev_harmonic is not None
    assert dev_harmonic < 0.15

    # partial_deviation_semitones caps its search window at 0.45*f0 (so it
    # can never bleed into a NEIGHBORING harmonic's band, see the function's
    # docstring) — shift every non-fundamental partial (k=2..8) by an
    # absolute 70 Hz, well inside that ~99 Hz cap for f0=220, so this
    # deliberately tests the mechanism within its rated operating range
    # rather than past its own search radius.
    shifted = spectrum_with_partials([f0] + [f0 * k + 70.0 for k in range(2, 9)])
    dev_shifted = opmatch.partial_deviation_semitones(shifted, freqs, mask, f0)
    assert dev_shifted is not None
    assert dev_shifted > 1.0


def test_determinism_same_file_same_proposal(tmp_path):
    amps_true = [1.0, 0.5, 0.33, 0.25, 0.2]
    x = _harmonic_stack(220.0, amps_true, SR, DURATION_S)
    path = tmp_path / "det.wav"
    write_wav(path, to_stereo(x), SR)

    r1 = opmatch.match(str(path))
    r2 = opmatch.match(str(path))
    assert r1 == r2


# ---------------------------------------------------------------------------
# compare() — op verify's closed-loop distance
# ---------------------------------------------------------------------------


def test_compare_identical_files_score_near_one(tmp_path):
    x = _harmonic_stack(220.0, [1.0, 0.5, 0.33, 0.25], SR, DURATION_S)
    path = tmp_path / "a.wav"
    write_wav(path, to_stereo(x), SR)

    result = opmatch.compare(str(path), str(path))
    assert result["score"] == pytest.approx(1.0, abs=1e-6)
    assert result["log_spectrogram_l2"] == pytest.approx(0.0, abs=1e-6)
    assert result["harmonic_cosine"] == pytest.approx(1.0, abs=1e-6)


def test_compare_dissimilar_files_score_lower(tmp_path):
    ref = _harmonic_stack(220.0, [1.0, 0.5, 0.33, 0.25], SR, DURATION_S)
    cand = white_noise(SR, DURATION_S, amp=0.2)
    ref_path = tmp_path / "ref.wav"
    cand_path = tmp_path / "cand.wav"
    write_wav(ref_path, to_stereo(ref), SR)
    write_wav(cand_path, to_stereo(cand), SR)

    result = opmatch.compare(str(ref_path), str(cand_path))
    assert result["score"] < 0.7


# ---------------------------------------------------------------------------
# CLI smoke tests
# ---------------------------------------------------------------------------


def test_cli_opmatch_json_smoke(tmp_path):
    x = _harmonic_stack(220.0, [1.0, 0.5, 0.33, 0.25], SR, DURATION_S)
    path = tmp_path / "pluck.wav"
    write_wav(path, to_stereo(x), SR)

    proc = subprocess.run(
        [sys.executable, "-m", "awh_analysis", "opmatch", str(path), "--json"],
        capture_output=True,
        text=True,
        cwd=str(Path(__file__).resolve().parents[1]),
    )
    assert proc.returncode == 0, proc.stderr
    obj = json.loads(proc.stdout)
    assert obj["tier"] == 1
    assert "drawThesePartials" in obj["proposal"]


def test_cli_opmatch_tier3_exits_zero(tmp_path):
    """Tier-3 refusal is exit 0 — a passing negative-control state, not an
    error (docs/design/operator-assistant.md)."""
    x = white_noise(SR, DURATION_S, amp=0.2)
    path = tmp_path / "noise.wav"
    write_wav(path, to_stereo(x), SR)

    proc = subprocess.run(
        [sys.executable, "-m", "awh_analysis", "opmatch", str(path), "--json"],
        capture_output=True,
        text=True,
        cwd=str(Path(__file__).resolve().parents[1]),
    )
    assert proc.returncode == 0, proc.stderr
    obj = json.loads(proc.stdout)
    assert obj["tier"] == 3
    assert obj["proposal"] is None


def test_cli_opcompare_json_smoke(tmp_path):
    x = _harmonic_stack(220.0, [1.0, 0.5, 0.33], SR, DURATION_S)
    path = tmp_path / "same.wav"
    write_wav(path, to_stereo(x), SR)

    proc = subprocess.run(
        [sys.executable, "-m", "awh_analysis", "opcompare", str(path), str(path), "--json"],
        capture_output=True,
        text=True,
        cwd=str(Path(__file__).resolve().parents[1]),
    )
    assert proc.returncode == 0, proc.stderr
    obj = json.loads(proc.stdout)
    for key in ("log_spectrogram_l2", "harmonic_cosine", "score"):
        assert key in obj
    assert obj["score"] == pytest.approx(1.0, abs=1e-6)
