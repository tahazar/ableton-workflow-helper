import numpy as np
import pytest

from awh_analysis import duck
from conftest import to_stereo

SR = 44100


def _kick_drums(
    sr: int,
    trigger_times: list[float],
    duration_s: float,
    decay_tau_s: float = 0.12,
    floor_amp: float = 0.003,
):
    """Synthetic drums: a 55 Hz kick burst with known exponential decay at
    each trigger, over a quiet noise floor."""
    n = int(round(duration_s * sr))
    t = np.arange(n) / sr
    rng = np.random.default_rng(11)
    sig = floor_amp * rng.standard_normal(n)
    for trig in trigger_times:
        start = int(round(trig * sr))
        length = min(n - start, int(0.45 * sr))
        if length <= 0:
            continue
        tt = np.arange(length) / sr
        sig[start : start + length] += 0.8 * np.exp(-tt / decay_tau_s) * np.sin(
            2 * np.pi * 55.0 * tt
        )
    return to_stereo(sig)


TRIGGERS = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]


def test_duck_fit_tracks_the_kick_decay():
    x = _kick_drums(SR, TRIGGERS, 4.5)
    result = duck.fit_duck_envelope(x, SR, TRIGGERS)

    assert result["window_ms"] == pytest.approx(500.0, abs=5.0)
    assert result["used_triggers"] == len(TRIGGERS)

    k = result["kick"]
    # tau=120ms -> body (-12 dB) ends around 12/8.686*tau ~= 166 ms
    assert 80.0 < k["body_end_ms"] < 260.0
    # tail should be gone well before the next trigger but after the body
    assert k["body_end_ms"] < k["decay_done_ms"] <= 500.0
    assert k["peak_over_floor_db"] > 20.0

    rec = result["recommendation"]
    assert rec["attack_ms"] == 0.0
    assert rec["depth_db"] == duck.DEFAULT_DEPTH_DB  # no bass given
    assert "default" in rec["depth_source"]
    # fully recovered before the next trigger, with headroom
    assert rec["fully_recovered_by_ms"] <= 500.0 * duck.RELEASE_HEADROOM + 1e-6
    # points: dip at t=0, monotonically recovering, ends at 0 dB
    points = rec["points"]
    assert points[0]["gain_db"] == -rec["depth_db"]
    gains = [p["gain_db"] for p in points]
    assert all(b >= a - 1e-9 for a, b in zip(gains, gains[1:]))
    assert points[-1]["gain_db"] == 0.0
    assert points[-1]["frac"] == 1.0


def test_duck_fit_masking_based_depth_from_bass():
    x = _kick_drums(SR, TRIGGERS, 4.5)
    # constant 50 Hz bass — loud enough to need real ducking
    t = np.arange(int(4.5 * SR)) / SR
    bass = to_stereo(0.5 * np.sin(2 * np.pi * 50.0 * t))
    result = duck.fit_duck_envelope(x, SR, TRIGGERS, bass=bass, bass_sr=SR)
    rec = result["recommendation"]
    assert "masking" in rec["depth_source"]
    assert duck.MIN_DEPTH_DB <= rec["depth_db"] <= duck.MAX_DEPTH_DB
    # forcing depth overrides the computation
    forced = duck.fit_duck_envelope(x, SR, TRIGGERS, bass=bass, bass_sr=SR, depth_db=9.0)
    assert forced["recommendation"]["depth_db"] == 9.0


def test_duck_fit_uses_robust_min_gap_for_uneven_triggers():
    # kick & snare style pattern: gaps of 0.5 and 0.25 s
    triggers = [0.5, 1.0, 1.25, 1.75, 2.25, 2.5, 3.0]
    x = _kick_drums(SR, triggers, 4.0, decay_tau_s=0.05)
    result = duck.fit_duck_envelope(x, SR, triggers)
    # window keys to the small gap so the duck always recovers in time
    assert result["window_ms"] == pytest.approx(250.0, abs=5.0)
    assert result["recommendation"]["fully_recovered_by_ms"] <= 250.0 * duck.RELEASE_HEADROOM + 1e-6


def test_duck_fit_input_validation():
    x = _kick_drums(SR, [0.5], 1.0)
    with pytest.raises(ValueError):
        duck.fit_duck_envelope(x, SR, [0.5])  # one trigger: no gap
    with pytest.raises(ValueError):
        duck.fit_duck_envelope(x, SR, [10.0, 10.5])  # outside the audio


def test_measure_duck_depth_ducked_vs_flat():
    t = np.arange(int(4.5 * SR)) / SR
    carrier = 0.5 * np.sin(2 * np.pi * 50.0 * t)
    period = 0.5
    phase = np.mod(t, period) / period
    # 8 dB duck for the first 40% of each cycle, linear recovery
    env_db = np.where(phase < 0.4, -8.0 * (1.0 - phase / 0.4), 0.0)
    ducked = to_stereo(carrier * 10.0 ** (env_db / 20.0))
    flat = to_stereo(carrier)
    triggers = [0.5 * k for k in range(9)]

    d = duck.measure_duck_depth(ducked, SR, triggers)
    f = duck.measure_duck_depth(flat, SR, triggers)
    assert d["depth_db"] == pytest.approx(8.0, abs=1.5)
    assert f["depth_db"] < 1.0
    assert d["depth_db"] - f["depth_db"] > 6.0
