import numpy as np
import pytest

from awh_analysis import loudness

from conftest import sine, to_stereo

SR = 48000


def test_lufs_997hz_k_weighting_near_zero_db():
    """997 Hz sine at -20 dBFS -> LUFS-I within +-0.7 LU of -20 (K-weighting ~0 dB there)."""
    amp = 10 ** (-20.0 / 20.0)
    x = to_stereo(sine(997.0, SR, 5.0, amp=amp))
    lufs = loudness.lufs_integrated(x, SR)
    assert lufs == pytest.approx(-20.0, abs=0.7)


def test_lufs_gain_change_moves_by_gain():
    amp = 10 ** (-20.0 / 20.0)
    x = to_stereo(sine(997.0, SR, 5.0, amp=amp))
    lufs_a = loudness.lufs_integrated(x, SR)

    x_quieter = x * 10 ** (-3.0 / 20.0)
    lufs_b = loudness.lufs_integrated(x_quieter, SR)

    assert (lufs_b - lufs_a) == pytest.approx(-3.0, abs=0.1)


def test_true_peak_full_scale_997hz_near_0db():
    x = to_stereo(sine(997.0, SR, 2.0, amp=1.0))
    tp = loudness.true_peak_db(x, SR)
    assert tp == pytest.approx(0.0, abs=0.2)


def test_true_peak_never_below_sample_peak():
    x = to_stereo(sine(997.0, SR, 2.0, amp=0.98))
    sample_peak_db = 20.0 * np.log10(np.max(np.abs(x)))
    tp = loudness.true_peak_db(x, SR)
    assert tp >= sample_peak_db - 1e-9


def test_true_peak_intersample_fs4_phase_shift():
    """A sine at fs/4 with a phase offset undersells its true peak at the
    sample grid; true-peak measurement must report >= the sample peak.
    """
    x = to_stereo(sine(SR / 4.0, SR, 2.0, amp=1.0, phase=np.pi / 4))
    sample_peak_db = 20.0 * np.log10(np.max(np.abs(x)))
    tp = loudness.true_peak_db(x, SR)
    assert tp >= sample_peak_db
    # the sample grid catches this signal at -3 dB; true peak recovers most of it
    assert tp > sample_peak_db + 1.0


def _make_bass_and_mid(sr: int, duration_s: float) -> np.ndarray:
    t = np.arange(int(round(duration_s * sr))) / sr
    sig = 0.5 * np.sin(2 * np.pi * 80 * t) + 0.3 * np.sin(2 * np.pi * 1000 * t)
    return sig


def test_psr_lower_for_heavily_limited_signal():
    sig = _make_bass_and_mid(SR, 8.0)
    clean = to_stereo(sig / np.max(np.abs(sig)) * 0.5)

    limited = np.tanh(sig * 6.0)
    limited = to_stereo(limited / np.max(np.abs(limited)) * 0.98)

    psr_clean = loudness.psr(clean, SR)
    psr_limited = loudness.psr(limited, SR)

    assert np.isfinite(psr_clean["min_psr_loud"])
    assert np.isfinite(psr_limited["min_psr_loud"])
    assert psr_limited["min_psr_loud"] < psr_clean["min_psr_loud"]


def test_lufs_short_term_series_shape():
    x = to_stereo(sine(440.0, SR, 6.0, amp=0.3))
    times, values = loudness.lufs_short_term(x, SR)
    assert len(times) == len(values)
    assert len(times) >= 3  # 6s of audio, 3s window / 1s hop -> 4 windows
    assert np.all(np.isfinite(values))
