"""bands.py tests (M6b masking toolkit): calibrated per-band dBFS via a
Welch periodogram — the fix for the two gaps the 2026-08-23 masking-
analysis session found in the scratch numpy it had to hand-roll (docs/
design/analysis-engine.md's "Future work" section): (1) an ad-hoc
10*log10(sum |FFT|^2) is only meaningful within one sitting, not
calibrated; (2) one FFT over a whole capture time-smears a changing
bassline. Tests cover: energy lands in the right band, calibration sanity
(full-scale sine ~ 0 dBFS), determinism, and comparison-table wiring.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from awh_analysis import bands
from conftest import sine, to_stereo, white_noise, write_wav

SR = 48000


# ---------------------------------------------------------------------------
# parse_bands_arg
# ---------------------------------------------------------------------------


def test_parse_bands_arg_default_matches_documented_string():
    parsed = bands.parse_bands_arg(None)
    assert parsed == bands.DEFAULT_BANDS_HZ
    reparsed = bands.parse_bands_arg(bands.DEFAULT_BANDS_ARG)
    assert reparsed == bands.DEFAULT_BANDS_HZ  # labels preserved on round-trip


def test_parse_bands_arg_custom_ranges_get_generic_labels():
    parsed = bands.parse_bands_arg("20-100,140-200,200-500")
    assert [(lo, hi) for lo, hi, _ in parsed] == [(20.0, 100.0), (140.0, 200.0), (200.0, 500.0)]
    assert parsed[0][2] == "sub"  # matches a named default
    assert parsed[1][2] == "scoop zone"
    assert parsed[2][2] == "low-mid"


def test_parse_bands_arg_rejects_bad_ranges():
    with pytest.raises(ValueError):
        bands.parse_bands_arg("100-50")  # hi <= lo
    with pytest.raises(ValueError):
        bands.parse_bands_arg("not-a-range-nope")
    with pytest.raises(ValueError):
        bands.parse_bands_arg("")


# ---------------------------------------------------------------------------
# Energy lands in the right band
# ---------------------------------------------------------------------------


def test_narrowband_tone_lands_in_its_own_band_and_nowhere_else():
    x = to_stereo(sine(300.0, SR, 3.0, amp=0.5))  # squarely inside 200-500
    levels = bands.band_levels(x, SR, bands.DEFAULT_BANDS_HZ)
    by_label = {b["label"]: b for b in levels["bands"]}
    assert by_label["low-mid"]["dbfs"] > by_label["sub"]["dbfs"] + 20
    assert by_label["low-mid"]["dbfs"] > by_label["scoop zone"]["dbfs"] + 20
    assert by_label["low-mid"]["dbfs"] > by_label["mid"]["dbfs"] + 20
    # fraction_of_total: almost all the signal's energy sits in low-mid
    assert by_label["low-mid"]["fraction_of_total"] > 0.9


def test_sub_bass_tone_lands_in_sub_band():
    x = to_stereo(sine(50.0, SR, 3.0, amp=0.5))
    levels = bands.band_levels(x, SR, bands.DEFAULT_BANDS_HZ)
    by_label = {b["label"]: b for b in levels["bands"]}
    assert by_label["sub"]["dbfs"] > by_label["low-mid"]["dbfs"] + 20
    assert by_label["sub"]["fraction_of_total"] > 0.9


# ---------------------------------------------------------------------------
# Calibration sanity: full-scale sine ~= 0 dBFS in its band
# ---------------------------------------------------------------------------


def test_full_scale_sine_reads_near_zero_dbfs_in_its_band():
    x = to_stereo(sine(300.0, SR, 3.0, amp=1.0))  # peak amplitude 1.0 = full scale
    levels = bands.band_levels(x, SR, bands.DEFAULT_BANDS_HZ)
    by_label = {b["label"]: b for b in levels["bands"]}
    assert by_label["low-mid"]["dbfs"] == pytest.approx(0.0, abs=0.5)


def test_half_scale_sine_reads_near_minus_6_dbfs():
    """amp=0.5 -> power is 1/4 -> -6.02 dB relative to the full-scale
    reference (a direct calibration-linearity check, not just one point)."""
    x = to_stereo(sine(300.0, SR, 3.0, amp=0.5))
    levels = bands.band_levels(x, SR, bands.DEFAULT_BANDS_HZ)
    by_label = {b["label"]: b for b in levels["bands"]}
    assert by_label["low-mid"]["dbfs"] == pytest.approx(-6.02, abs=0.5)


def test_silence_reads_minus_infinity_not_a_crash():
    x = to_stereo(np.zeros(int(round(1.5 * SR))))
    levels = bands.band_levels(x, SR, bands.DEFAULT_BANDS_HZ)
    for b in levels["bands"]:
        assert b["dbfs"] == float("-inf")
        assert b["fraction_of_total"] == 0.0


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


def test_determinism_same_file_same_result(tmp_path):
    x = sine(220.0, SR, 2.0, amp=0.6)
    path = tmp_path / "det.wav"
    write_wav(path, to_stereo(x), SR)
    r1 = bands.analyze_file(str(path))
    r2 = bands.analyze_file(str(path))
    assert r1 == r2


# ---------------------------------------------------------------------------
# Multi-file comparison table: per-band deltas vs. the first file
# ---------------------------------------------------------------------------


def test_compare_files_deltas_vs_first_file(tmp_path):
    a = sine(300.0, SR, 2.0, amp=1.0)  # 0 dBFS in low-mid
    b = sine(300.0, SR, 2.0, amp=0.5)  # -6 dBFS in low-mid
    path_a = tmp_path / "a.wav"
    path_b = tmp_path / "b.wav"
    write_wav(path_a, to_stereo(a), SR)
    write_wav(path_b, to_stereo(b), SR)

    result = bands.compare_files([str(path_a), str(path_b)])
    assert result["baseline_file"] == str(path_a)
    assert len(result["files"]) == 2
    assert "delta_db" not in result["files"][0]["bands"][0]  # baseline carries no delta
    low_mid_b = next(x for x in result["files"][1]["bands"] if x["label"] == "low-mid")
    assert low_mid_b["delta_db"] == pytest.approx(-6.02, abs=0.5)


def test_compare_files_single_file_has_no_deltas(tmp_path):
    x = sine(300.0, SR, 1.5, amp=0.7)
    path = tmp_path / "solo.wav"
    write_wav(path, to_stereo(x), SR)
    result = bands.compare_files([str(path)])
    assert len(result["files"]) == 1
    assert "delta_db" not in result["files"][0]["bands"][0]


# ---------------------------------------------------------------------------
# White noise: energy spread but STILL calibrated (informational sanity)
# ---------------------------------------------------------------------------


def test_white_noise_band_levels_are_finite_and_ordered_by_bandwidth():
    x = to_stereo(white_noise(SR, 3.0, amp=0.3))
    levels = bands.band_levels(x, SR, bands.DEFAULT_BANDS_HZ)
    for b in levels["bands"]:
        assert np.isfinite(b["dbfs"])
    # White noise has flat PSD -> wider bands carry more power (sub is
    # narrower than mid, etc.) — not a strict monotone claim, just sane.
    by_label = {b["label"]: b for b in levels["bands"]}
    assert by_label["mid"]["dbfs"] > by_label["sub"]["dbfs"]


# ---------------------------------------------------------------------------
# CLI smoke
# ---------------------------------------------------------------------------


def test_cli_bands_json_smoke(tmp_path):
    a = sine(300.0, SR, 1.5, amp=0.8)
    path_a = tmp_path / "a.wav"
    write_wav(path_a, to_stereo(a), SR)

    proc = subprocess.run(
        [sys.executable, "-m", "awh_analysis", "bands", str(path_a), "--json"],
        capture_output=True,
        text=True,
        cwd=str(Path(__file__).resolve().parents[1]),
    )
    assert proc.returncode == 0, proc.stderr
    obj = json.loads(proc.stdout)
    assert len(obj["files"]) == 1
    assert obj["calibration"]


def test_cli_bands_multi_file_text_smoke(tmp_path):
    a = sine(300.0, SR, 1.5, amp=1.0)
    b = sine(300.0, SR, 1.5, amp=0.5)
    path_a = tmp_path / "a.wav"
    path_b = tmp_path / "b.wav"
    write_wav(path_a, to_stereo(a), SR)
    write_wav(path_b, to_stereo(b), SR)

    proc = subprocess.run(
        [
            sys.executable, "-m", "awh_analysis", "bands",
            str(path_a), str(path_b), "--bands", "200-500",
        ],
        capture_output=True,
        text=True,
        cwd=str(Path(__file__).resolve().parents[1]),
    )
    assert proc.returncode == 0, proc.stderr
    assert "calibration" in proc.stdout
    assert "low-mid" in proc.stdout
