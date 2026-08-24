"""M13 mix advisor rule-engine tests (docs/design/mix-advisor.md).

Per-rule fixtures are real synthetic audio through the real `report.analyze`
pipeline for the rules the design doc names explicitly (clipped sine ->
integrity, decorrelated low band -> phase, band-boosted noise vs a flat
saved target -> capped EQ, quiet clean mix -> healthy state) — each paired
with a negative control that must NOT trip it (docs/lessons-learned.md rule
2). Rules that don't need audio synthesis to exercise meaningfully (masking
over a hand-assembled layers record, dependency-ordering/blockedBy,
tilt-vs-bands exclusivity, determinism, --compare) construct the
measurement dict directly — `advise()` is a pure function of that dict, so
this is a faithful, much faster test of the same code path.
"""

from __future__ import annotations

import copy

import numpy as np
import pytest

from awh_analysis import advise, bands as bands_mod, report, targets

from conftest import pink_noise, sine, to_stereo, white_noise, write_wav

SR = 48000


def _finding_ids(result: dict) -> list[str]:
    return [it["id"] for it in result["items"] if it["kind"] == "finding"]


def _base_measurements(**overrides) -> dict:
    """A minimal, otherwise-healthy measurement dict for dict-literal
    fixtures (masking/ordering/determinism/compare tests) — streaming-level
    loudness, safe true peak, high PSR, correlated stereo, no target.
    """
    base = {
        "file": "x.wav",
        "samplerate": SR,
        "channels": 2,
        "duration_s": 4.0,
        "bpm": None,
        "loudness": {
            "lufs_integrated": -14.0,
            "lufs_short_term": {"times": [], "values": []},
            "true_peak_db": -6.0,
            "psr": {"min_psr_loud": 10.0, "windows": []},
        },
        "spectrum": {"freqs": [], "db": [], "tilt_db_per_oct": float("nan")},
        "stereo": {"width_db": None, "banded_width_db": {}, "correlation": {"full": 1.0, "low": 1.0}},
        "dynamics": {
            "asymmetry": [{"ratio_db": 0.0, "skewness": 0.0}],
            "phase_rotation_headroom": {"best_db": 0.0, "f0": 100.0, "poles": 2},
            "pump": None,
        },
        "target_comparison": None,
        "target_sources": None,
    }
    for k, v in overrides.items():
        base[k] = v
    return base


# ---------------------------------------------------------------------------
# Stage 1 — integrity: clipped sine vs a safely-gained negative control
# ---------------------------------------------------------------------------


def test_integrity_true_peak_ceiling(tmp_path):
    sig = sine(300.0, SR, 4.0, amp=1.0)
    clipped = np.clip(sig * 2.0, -1.0, 1.0)  # driven 6 dB over full scale then hard-clipped
    path = tmp_path / "clipped.wav"
    write_wav(path, to_stereo(clipped), SR)

    m = report.analyze(str(path))
    assert m["loudness"]["true_peak_db"] > advise.TRUE_PEAK_CEILING_DBTP

    result = advise.advise(m, None, None, "club")
    assert "true-peak-ceiling" in _finding_ids(result)
    item = next(it for it in result["items"] if it["id"] == "true-peak-ceiling")
    assert item["stage"] == "integrity"
    assert item["evidence"]["true_peak_db"] == pytest.approx(m["loudness"]["true_peak_db"])


def test_integrity_true_peak_negative_control(tmp_path):
    sig = sine(300.0, SR, 4.0, amp=0.3)  # gained safely, no clipping
    path = tmp_path / "safe.wav"
    write_wav(path, to_stereo(sig), SR)

    m = report.analyze(str(path))
    assert m["loudness"]["true_peak_db"] < advise.TRUE_PEAK_CEILING_DBTP

    result = advise.advise(m, None, None, "club")
    assert "true-peak-ceiling" not in _finding_ids(result)


# ---------------------------------------------------------------------------
# Stage 2 — phase: decorrelated low band vs a correlated negative control
# ---------------------------------------------------------------------------


def _low_band_stereo(anti_correlated: bool) -> np.ndarray:
    t = np.arange(int(4.0 * SR)) / SR
    low_l = 0.5 * np.sin(2 * np.pi * 60.0 * t)
    low_r = -low_l if anti_correlated else low_l
    hi = 0.3 * np.sin(2 * np.pi * 3000.0 * t)  # correlated high content either way
    left, right = low_l + hi, low_r + hi
    x = np.stack([left, right], axis=1)
    return x / max(float(np.max(np.abs(x))), 1.0) * 0.9


def test_phase_low_band_correlation(tmp_path):
    path = tmp_path / "decorr.wav"
    write_wav(path, _low_band_stereo(anti_correlated=True), SR)

    m = report.analyze(str(path))
    assert m["stereo"]["correlation"]["low"] < advise.LOW_CORR_THRESHOLD

    result = advise.advise(m, None, None, "club")
    assert "low-band-correlation" in _finding_ids(result)
    item = next(it for it in result["items"] if it["id"] == "low-band-correlation")
    assert item["stage"] == "phase"
    assert item["evidence"]["low_band_r"] == pytest.approx(m["stereo"]["correlation"]["low"])


def test_phase_low_band_correlation_negative_control(tmp_path):
    path = tmp_path / "corr.wav"
    write_wav(path, _low_band_stereo(anti_correlated=False), SR)

    m = report.analyze(str(path))
    assert m["stereo"]["correlation"]["low"] >= advise.LOW_CORR_THRESHOLD

    result = advise.advise(m, None, None, "club")
    assert "low-band-correlation" not in _finding_ids(result)


# ---------------------------------------------------------------------------
# Stage 4 — tonal: band-boosted noise vs a flat saved target -> capped EQ
# ---------------------------------------------------------------------------


def _pink_target(tmp_path, n=4) -> dict:
    paths = []
    for i in range(n):
        sig = to_stereo(pink_noise(SR, 4.0, amp=0.15, seed=3000 + i))
        p = tmp_path / f"ref{i}.wav"
        write_wav(p, sig, SR)
        paths.append(str(p))
    return targets.build_target(paths)


def _gain_to_lufs(x: np.ndarray, sr: int, target_lufs: float) -> np.ndarray:
    lufs = report.loudness.lufs_integrated(x, sr)
    return x * 10.0 ** ((target_lufs - lufs) / 20.0)


def test_tonal_eq_band_capped_amount(tmp_path):
    target = _pink_target(tmp_path)

    sig = pink_noise(SR, 4.0, amp=0.15, seed=4000)
    t = np.arange(len(sig)) / SR
    boosted = sig + 0.09 * np.sin(2 * np.pi * 1000.0 * t)  # one narrow band, way over threshold
    x = _gain_to_lufs(to_stereo(boosted), SR, -14.0)
    path = tmp_path / "boosted.wav"
    write_wav(path, x, SR)

    m = report.analyze(str(path), target=target)
    flagged = [b for b in m["target_comparison"] if b["flagged"]]
    assert len(flagged) == 1  # isolated to one band -> exercises eq-band, not the tilt rule

    result = advise.advise(m, target, None, "streaming")
    ids = _finding_ids(result)
    assert any(i.startswith("eq-band-") for i in ids)
    assert "spectral-tilt-vs-target" not in ids  # exclusivity: bands, not tilt, wins here

    item = next(it for it in result["items"] if it["id"].startswith("eq-band-"))
    delta = item["evidence"]["delta_db"]
    capped = item["evidence"]["capped_amount_db"]
    assert abs(delta) > advise.EQ_CAP_DB  # the raw delta genuinely exceeds the cap...
    assert capped == pytest.approx(advise.EQ_CAP_DB)  # ...but the action amount never does
    assert f"{capped:.1f} dB" in item["action"]


def test_tonal_eq_band_negative_control(tmp_path):
    target = _pink_target(tmp_path)

    sig = to_stereo(pink_noise(SR, 4.0, amp=0.15, seed=4001))  # no boost injected
    x = _gain_to_lufs(sig, SR, -14.0)
    path = tmp_path / "unboosted.wav"
    write_wav(path, x, SR)

    m = report.analyze(str(path), target=target)
    result = advise.advise(m, target, None, "streaming")
    ids = _finding_ids(result)
    assert not any(i.startswith("eq-band-") for i in ids)


# ---------------------------------------------------------------------------
# Tilt-vs-bands exclusivity: a broadly-mistilted capture picks ONE
# ---------------------------------------------------------------------------


def test_tilt_vs_bands_exclusivity_picks_tilt(tmp_path):
    target = _pink_target(tmp_path)  # pink-ish, rolled-off reference

    sig = white_noise(SR, 4.0, amp=0.15, seed=5000)  # flat spectrum -> broad tilt error
    x = _gain_to_lufs(to_stereo(sig), SR, -14.0)
    path = tmp_path / "white.wav"
    write_wav(path, x, SR)

    m = report.analyze(str(path), target=target)
    flagged = [b for b in m["target_comparison"] if b["flagged"]]
    assert len(flagged) >= advise.TILT_BAND_SIGN_MIN_COUNT  # broad, many-band deviation

    result = advise.advise(m, target, None, "streaming")
    ids = _finding_ids(result)
    assert "spectral-tilt-vs-target" in ids
    assert not any(i.startswith("eq-band-") for i in ids)  # per-band items suppressed this pass


# ---------------------------------------------------------------------------
# Stage 3 — masking: comparable-energy layers vs a separated negative control
# ---------------------------------------------------------------------------


def _layer_bands(tmp_path, freq: float, amp: float, name: str) -> tuple[dict, str]:
    sig = to_stereo(sine(freq, SR, 4.0, amp=amp))
    path = tmp_path / f"{name}.wav"
    write_wav(path, sig, SR)
    return bands_mod.analyze_file(str(path)), f"{name}.wav"


def _layers_record(tmp_path, freq_b: float, amp_b: float) -> dict:
    bands_a, file_a = _layer_bands(tmp_path, 40.0, 0.5, "kick")
    bands_b, file_b = _layer_bands(tmp_path, freq_b, amp_b, "other")
    return {
        "kind": "layers",
        "tracks": [
            {"trackPath": "track:0", "trackName": "Kick", "file": file_a},
            {"trackPath": "track:1", "trackName": "Sub", "file": file_b},
        ],
        "bands": {
            "files": [{**bands_a, "file": file_a}, {**bands_b, "file": file_b}],
            "baseline_file": file_a,
        },
    }


def test_masking_layer_collision(tmp_path):
    layers = _layers_record(tmp_path, freq_b=45.0, amp_b=0.48)  # both strong in "sub"
    m = _base_measurements()

    result = advise.advise(m, None, layers, "streaming")
    ids = _finding_ids(result)
    assert "layer-masking-sub" in ids
    item = next(it for it in result["items"] if it["id"] == "layer-masking-sub")
    assert item["stage"] == "masking"
    assert {item["evidence"]["layer_a"], item["evidence"]["layer_b"]} == {"Kick", "Sub"}


def test_masking_negative_control_separated_energy(tmp_path):
    layers = _layers_record(tmp_path, freq_b=2000.0, amp_b=0.5)  # "other" carries no sub energy
    m = _base_measurements()

    result = advise.advise(m, None, layers, "streaming")
    ids = _finding_ids(result)
    assert not any(i.startswith("layer-masking") for i in ids)


# ---------------------------------------------------------------------------
# Missing-input placeholders
# ---------------------------------------------------------------------------


def test_missing_target_and_layers_placeholders():
    m = _base_measurements()
    result = advise.advise(m, None, None, "streaming")
    by_id = {it["id"]: it for it in result["items"]}
    assert by_id["missing-target"]["kind"] == "placeholder"
    assert by_id["missing-target"]["stage"] == "tonal"
    assert by_id["missing-layers"]["kind"] == "placeholder"
    assert by_id["missing-layers"]["stage"] == "masking"
    # Placeholders never count as actionable findings.
    assert result["healthy"] is not None


# ---------------------------------------------------------------------------
# Dependency ordering + blockedBy: a two-stage fixture (phase + tonal)
# ---------------------------------------------------------------------------


def test_ordering_and_blocked_by_two_stage_fixture():
    target = {
        "bands": [{"freq": 1000.0, "median_db": 0.0, "iqr_db": 0.5}],
        "tilt": {"median": -5.0, "iqr": 0.5},
    }
    m = _base_measurements(
        stereo={"width_db": None, "banded_width_db": {}, "correlation": {"full": 0.5, "low": 0.5}},
        spectrum={"freqs": [1000.0], "db": [8.0], "tilt_db_per_oct": -5.0},
    )

    result = advise.advise(m, target, None, "streaming")
    ids_in_rank_order = [it["id"] for it in result["items"]]

    phase_item = next(it for it in result["items"] if it["id"] == "low-band-correlation")
    tonal_item = next(it for it in result["items"] if it["id"].startswith("eq-band-"))

    assert phase_item["stage"] == "phase"
    assert tonal_item["stage"] == "tonal"
    assert phase_item["rank"] < tonal_item["rank"]  # dependency ladder ranks phase first
    assert phase_item["rank"] in tonal_item["blockedBy"]
    assert tonal_item["rank"] not in phase_item["blockedBy"]  # never blocked by something later
    # Rank order matches the items list order (rank is assigned positionally).
    assert ids_in_rank_order == [it["id"] for it in sorted(result["items"], key=lambda i: i["rank"])]


# ---------------------------------------------------------------------------
# Determinism: identical inputs -> identical plan, every time.
# ---------------------------------------------------------------------------


def test_determinism():
    target = {
        "bands": [{"freq": 1000.0, "median_db": 0.0, "iqr_db": 0.5}],
        "tilt": {"median": -5.0, "iqr": 0.5},
    }
    m = _base_measurements(
        loudness={
            "lufs_integrated": -20.0,
            "lufs_short_term": {"times": [], "values": []},
            "true_peak_db": 2.0,
            "psr": {"min_psr_loud": 4.0, "windows": []},
        },
        stereo={"width_db": None, "banded_width_db": {}, "correlation": {"full": 0.5, "low": 0.5}},
        spectrum={"freqs": [1000.0], "db": [8.0], "tilt_db_per_oct": -5.0},
    )

    r1 = advise.advise(copy.deepcopy(m), copy.deepcopy(target), None, "club")
    r2 = advise.advise(copy.deepcopy(m), copy.deepcopy(target), None, "club")
    assert r1 == r2

    ranks1 = [it["id"] for it in r1["items"]]
    ranks2 = [it["id"] for it in r2["items"]]
    assert ranks1 == ranks2


# ---------------------------------------------------------------------------
# Healthy state: a quiet, clean mix at streaming level
# ---------------------------------------------------------------------------


def test_healthy_state_quiet_clean_mix(tmp_path):
    sig = to_stereo(pink_noise(SR, 6.0, amp=0.15, seed=6000))
    x = _gain_to_lufs(sig, SR, -14.0)  # streaming-level, not club-squashed
    path = tmp_path / "healthy.wav"
    write_wav(path, x, SR)

    m = report.analyze(str(path))
    result = advise.advise(m, None, None, "streaming")

    assert _finding_ids(result) == []
    assert result["healthy"] is not None
    assert result["healthy"]["message"]
    assert len(result["healthy"]["marginal_metrics"]) == 2
    for probe in result["healthy"]["marginal_metrics"]:
        assert probe["margin"] >= 0.0


# ---------------------------------------------------------------------------
# --compare: resolved / improved / unchanged / new
# ---------------------------------------------------------------------------


def test_compare_resolutions():
    before = _base_measurements(
        loudness={
            "lufs_integrated": -14.0,
            "lufs_short_term": {"times": [], "values": []},
            "true_peak_db": 1.0,  # over ceiling
            "psr": {"min_psr_loud": 5.0, "windows": []},  # PSR alert too
        },
        stereo={"width_db": None, "banded_width_db": {}, "correlation": {"full": 1.0, "low": 1.0}},
    )
    old_result = advise.advise(before, None, None, "streaming")
    old_record = {"items": old_result["items"]}

    # After: true peak fixed (resolved), PSR slightly better but still alerting
    # (improved), stereo now decorrelated (new).
    after = _base_measurements(
        loudness={
            "lufs_integrated": -14.0,
            "lufs_short_term": {"times": [], "values": []},
            "true_peak_db": -3.0,
            "psr": {"min_psr_loud": 6.5, "windows": []},
        },
        stereo={"width_db": None, "banded_width_db": {}, "correlation": {"full": 0.5, "low": 0.5}},
    )
    new_result = advise.advise(after, None, None, "streaming")

    comparison = advise.compare_advice(old_record, new_result)
    by_id = {c["id"]: c for c in comparison}

    assert by_id["true-peak-ceiling"]["status"] == "resolved"
    assert by_id["psr-low"]["status"] == "improved"
    assert by_id["psr-low"]["new_magnitude"] < by_id["psr-low"]["old_magnitude"]
    assert by_id["low-band-correlation"]["status"] == "new"


def test_compare_unchanged_when_magnitude_barely_moves():
    m = _base_measurements(
        loudness={
            "lufs_integrated": -14.0,
            "lufs_short_term": {"times": [], "values": []},
            "true_peak_db": 2.0,
            "psr": {"min_psr_loud": 10.0, "windows": []},
        },
    )
    old_result = advise.advise(m, None, None, "streaming")
    old_record = {"items": old_result["items"]}

    m2 = copy.deepcopy(m)
    m2["loudness"]["true_peak_db"] = 1.98  # trivially different, within COMPARE_EPS
    new_result = advise.advise(m2, None, None, "streaming")

    comparison = advise.compare_advice(old_record, new_result)
    item = next(c for c in comparison if c["id"] == "true-peak-ceiling")
    assert item["status"] == "unchanged"
