import numpy as np
import pytest

from awh_analysis import dynamics

from conftest import asymmetric_signal, sine, to_stereo

SR = 48000


def test_asymmetry_detects_skewed_peaks():
    x = to_stereo(asymmetric_signal(110.0, SR, 4.0, amp=0.7))
    result = dynamics.asymmetry(x)
    assert len(result) == 2
    for ch in result:
        assert abs(ch["ratio_db"]) > 1.0


def test_asymmetry_symmetric_sine_near_zero():
    x = to_stereo(sine(110.0, SR, 4.0, amp=0.7))
    result = dynamics.asymmetry(x)
    for ch in result:
        assert ch["ratio_db"] == pytest.approx(0.0, abs=0.1)


def test_phase_rotation_headroom_on_asymmetric_signal():
    x = to_stereo(asymmetric_signal(110.0, SR, 4.0, amp=0.7))
    result = dynamics.phase_rotation_headroom(x, SR)
    assert result["best_db"] > 0.0
    assert result["f0"] in (100.0, 150.0, 200.0, 300.0, 400.0)
    assert result["poles"] in (2, 4, 6)


def test_phase_rotation_headroom_on_symmetric_sine_near_zero():
    x = to_stereo(sine(110.0, SR, 4.0, amp=0.7))
    result = dynamics.phase_rotation_headroom(x, SR)
    assert result["best_db"] == pytest.approx(0.0, abs=0.3)


def _make_pumped_signal(sr: int, bpm: float, duration_s: float, depth_db: float, recover_frac: float = 0.3):
    period = 60.0 / bpm
    t = np.arange(int(round(duration_s * sr))) / sr
    carrier = sine(55.0, sr, duration_s, amp=1.0) + 0.5 * sine(1000.0, sr, duration_s, amp=1.0)
    phase = np.mod(t, period) / period
    env_db = np.where(phase < recover_frac, -depth_db * (1.0 - phase / recover_frac), 0.0)
    env_lin = 10.0 ** (env_db / 20.0)
    sig = carrier * env_lin
    sig = sig / np.max(np.abs(sig)) * 0.8
    return to_stereo(sig)


def test_pump_detects_synthetic_depth_and_grid_alignment():
    bpm = 120.0
    depth_db = 6.0
    x = _make_pumped_signal(SR, bpm, 8.0, depth_db)

    result = dynamics.pump(x, SR, bpm)
    assert result["beat_period_s"] == pytest.approx(0.5, abs=1e-9)

    for band in ("full", "low"):
        band_result = result[band]
        assert band_result["depth_db"] == pytest.approx(depth_db, abs=2.0)
        assert abs(band_result["trough_offset_ms"]) < 10.0
        assert band_result["recovery_time_s"] is not None
        assert band_result["recovery_time_s"] > 0.0


def test_pump_requires_bpm():
    x = to_stereo(sine(110.0, SR, 2.0, amp=0.5))
    with pytest.raises(ValueError):
        dynamics.pump(x, SR, 0)


def _make_decaying_retrigger_signal(sr: int, bpm: float, duration_s: float, depth_db: float):
    """Negative control: no sidechain anywhere. A bass note retriggered on
    each beat whose own decay produces a beat-synced RMS trough. A naive
    periodicity detector reads this as 'pumping'; the shape features must
    not call it ducking.
    """
    period = 60.0 / bpm
    t = np.arange(int(round(duration_s * sr))) / sr
    carrier = sine(55.0, sr, duration_s, amp=1.0) + 0.5 * sine(1000.0, sr, duration_s, amp=1.0)
    phase = np.mod(t, period) / period
    env_db = -depth_db * phase  # falls all cycle, resets at each retrigger
    sig = carrier * 10.0 ** (env_db / 20.0)
    sig = sig / np.max(np.abs(sig)) * 0.8
    return to_stereo(sig)


def test_pump_shape_distinguishes_ducking_from_natural_decay():
    """Depth/periodicity alone can't tell a sidechain from a decaying note.
    The shape features must.
    """
    bpm = 120.0
    ducked = dynamics.pump(_make_pumped_signal(SR, bpm, 8.0, 8.0), SR, bpm)
    decayed = dynamics.pump(_make_decaying_retrigger_signal(SR, bpm, 8.0, 8.0), SR, bpm)

    # Both look 'deep' to a naive detector...
    assert ducked["full"]["depth_db"] > 4.0
    assert decayed["full"]["depth_db"] > 4.0
    # ...but the shapes separate them.
    assert ducked["full"]["shape"] == "ducking-like"
    assert ducked["full"]["recovery_fraction"] > 0.6
    assert decayed["full"]["shape"] == "decay-like"
    assert decayed["full"]["recovery_fraction"] < 0.3
    assert decayed["full"]["trough_position"] > 0.75


def test_pump_ab_control_sidechain_on_vs_off():
    """The definitive verification path: same material with and without
    ducking; the depth delta is the evidence."""
    bpm = 120.0
    t = 8.0
    on = dynamics.pump(_make_pumped_signal(SR, bpm, t, 8.0), SR, bpm)
    flat = to_stereo((sine(55.0, SR, t, amp=1.0) + 0.5 * sine(1000.0, SR, t, amp=1.0)) * 0.5)
    off = dynamics.pump(flat, SR, bpm)
    assert on["full"]["depth_db"] - off["full"]["depth_db"] > 4.0
