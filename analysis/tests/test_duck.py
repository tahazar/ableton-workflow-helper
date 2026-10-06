import itertools

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
    rng = np.random.default_rng(11)
    sig = floor_amp * rng.standard_normal(n)
    for trig in trigger_times:
        start = int(round(trig * sr))
        length = min(n - start, int(0.45 * sr))
        if length <= 0:
            continue
        tt = np.arange(length) / sr
        sig[start : start + length] += (
            0.8 * np.exp(-tt / decay_tau_s) * np.sin(2 * np.pi * 55.0 * tt)
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
    assert all(b >= a - 1e-9 for a, b in itertools.pairwise(gains))
    assert points[-1]["gain_db"] == 0.0
    assert points[-1]["frac"] == 1.0


def test_duck_fit_masking_based_depth_from_bass():
    x = _kick_drums(SR, TRIGGERS, 4.5)
    # constant 50 Hz bass: loud enough to need real ducking, and clearly
    # voiced (a clean sine) -> takes the pitch-aware narrowband path
    t = np.arange(int(4.5 * SR)) / SR
    bass = to_stereo(0.5 * np.sin(2 * np.pi * 50.0 * t))
    result = duck.fit_duck_envelope(x, SR, TRIGGERS, bass=bass, bass_sr=SR)
    rec = result["recommendation"]
    assert "masking" in rec["depth_source"]
    assert "narrowband" in rec["depth_source"]
    assert "bass fundamental" in rec["depth_source"]
    assert duck.MIN_DEPTH_DB <= rec["depth_db"] <= duck.MAX_DEPTH_DB
    # forcing depth overrides the computation
    forced = duck.fit_duck_envelope(x, SR, TRIGGERS, bass=bass, bass_sr=SR, depth_db=9.0)
    assert forced["recommendation"]["depth_db"] == 9.0


def test_duck_fit_broadband_bass_falls_back_to_generic_low_band():
    """pyin can find a spurious low-confidence periodic frame even in pure
    white noise (state flips to "voiced" on one frame), so
    `state == "voiced"` alone is not a strong enough gate. This confirms the
    voiced_fraction gate (MASKING_MIN_VOICED_FRACTION) routes broadband
    bass to the generic-low-band calc, and that this branch produces
    exactly the generic-low-band formula's number."""
    x = _kick_drums(SR, TRIGGERS, 4.5)
    rng = np.random.default_rng(5)
    noise_bass = to_stereo(0.5 * rng.standard_normal(int(4.5 * SR)))

    bass_pitch = duck.pitch.analyze_segment(duck.to_mono(noise_bass), SR)
    assert (
        bass_pitch["voiced_fraction"] < duck.MASKING_MIN_VOICED_FRACTION
    )  # confirms the gate is exercised

    result = duck.fit_duck_envelope(x, SR, TRIGGERS, bass=noise_bass, bass_sr=SR)
    rec = result["recommendation"]
    assert "masking" in rec["depth_source"]
    assert "broadband bass" in rec["depth_source"]
    assert "narrowband" not in rec["depth_source"]

    # recompute the generic-low-band formula independently and
    # confirm the fallback matches it exactly
    bass_low = duck._low_band(noise_bass, SR)
    bass_low_db = float(20.0 * np.log10(max(np.sqrt(np.mean(bass_low**2)), 1e-9)))
    aligned = duck.trigger_aligned_envelope(x, SR, TRIGGERS)
    kick_peak_db = float(np.max(aligned["env_db"]))
    expected_needed = bass_low_db - (kick_peak_db - duck.KICK_OVER_BASS_MARGIN_DB)
    expected_depth = float(np.clip(expected_needed, duck.MIN_DEPTH_DB, duck.MAX_DEPTH_DB))
    assert rec["depth_db"] == pytest.approx(expected_depth, abs=1e-6)


def test_narrow_band_hz_floored_at_welch_resolution():
    # a very low f0: the cents-based half-width (~0.9 Hz at 30 Hz) is far
    # narrower than the Welch engine can resolve -> the resolution floor
    # must dominate, not the cents width
    lo, hi = duck._narrow_band_hz(30.0, SR)
    mainlobe_half_hz = 2.0 * SR / duck.spectrum.WELCH_NFFT
    assert (hi - lo) == pytest.approx(2 * mainlobe_half_hz, rel=1e-6)
    assert lo < 30.0 < hi

    # a higher f0: the cents-based half-width exceeds the resolution floor
    # -> the cents width must dominate instead
    lo2, hi2 = duck._narrow_band_hz(1000.0, SR)
    cents_half_hz = 1000.0 * (2.0 ** (duck.MASKING_BAND_HALF_CENTS / 1200.0) - 1.0)
    assert (hi2 - lo2) == pytest.approx(2 * cents_half_hz, rel=1e-6)
    assert cents_half_hz > mainlobe_half_hz  # confirms this case exercises the other branch


def test_masking_depth_responds_to_where_the_kicks_energy_actually_is():
    """Negative control proving the narrowband measurement measures the
    targeted band rather than behaving like the generic low-band calc.
    Same bass (a clean 300 Hz sine, well clear of the kick's own 55 Hz
    fundamental) against two kicks that differ only in whether
    they carry real energy near 300 Hz during their body window."""
    t = np.arange(int(4.5 * SR)) / SR
    bass = to_stereo(0.5 * np.sin(2 * np.pi * 300.0 * t))

    kick_far = _kick_drums(SR, TRIGGERS, 4.5)  # only the 55 Hz kick, near-silent at 300 Hz

    kick_near_sig = kick_far[:, 0].copy() if kick_far.ndim == 2 else kick_far.copy()
    # add a real 300 Hz decaying burst at each trigger, same shape as the
    # kick's own decay, so the body window carries energy there
    for trig in TRIGGERS:
        start = int(round(trig * SR))
        length = min(len(kick_near_sig) - start, int(0.45 * SR))
        if length <= 0:
            continue
        tt = np.arange(length) / SR
        kick_near_sig[start : start + length] += (
            0.8 * np.exp(-tt / 0.12) * np.sin(2 * np.pi * 300.0 * tt)
        )
    kick_near = to_stereo(kick_near_sig)

    result_far = duck.fit_duck_envelope(kick_far, SR, TRIGGERS, bass=bass, bass_sr=SR)
    result_near = duck.fit_duck_envelope(kick_near, SR, TRIGGERS, bass=bass, bass_sr=SR)

    # kick_near has real energy right where the bass lives -> the natural
    # separation is already better -> less additional duck depth needed
    assert result_near["recommendation"]["depth_db"] < result_far["recommendation"]["depth_db"]


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


def test_duck_fit_flags_misaligned_triggers():
    """Guessed trigger times produce a plausible-looking but nonsensical
    envelope. Misalignment must warn."""
    x = _kick_drums(SR, TRIGGERS, 4.5)
    aligned = duck.fit_duck_envelope(x, SR, TRIGGERS)
    assert aligned["warnings"] == []

    # triggers offset by 40% of the gap: hits land mid-window
    shifted = [t + 0.2 for t in TRIGGERS]
    result = duck.fit_duck_envelope(x, SR, shifted)
    assert any("do NOT match" in w for w in result["warnings"])

    # sparse clicks over digital silence (the live pathology read 174 dB
    # peak-over-floor): absurd floor distance must warn even when aligned
    quiet = _kick_drums(SR, TRIGGERS, 4.5, decay_tau_s=0.02, floor_amp=1e-7)
    sparse = duck.fit_duck_envelope(quiet, SR, TRIGGERS)
    assert any("digital silence" in w for w in sparse["warnings"])


def test_detect_onsets_finds_real_hit_positions():
    x = _kick_drums(SR, TRIGGERS, 4.5, decay_tau_s=0.05)
    onsets = duck.detect_onsets(x, SR)
    assert len(onsets) == len(TRIGGERS)
    for detected, true in zip(onsets, TRIGGERS, strict=True):
        assert abs(detected - true) < 0.03  # within 30 ms
