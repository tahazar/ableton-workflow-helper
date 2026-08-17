import numpy as np
import pytest

from awh_analysis import stereo

from conftest import sine

SR = 48000


def test_identical_lr_correlation_one_and_width_very_negative():
    mono = sine(440.0, SR, 2.0, amp=0.5)
    x = np.stack([mono, mono], axis=1)

    corr = stereo.correlation(x, SR)
    assert corr["full"] == pytest.approx(1.0, abs=1e-9)
    assert corr["low"] == pytest.approx(1.0, abs=1e-6)

    width = stereo.width_db(x)
    assert width is not None
    assert width < -80.0  # side energy ~0 -> very negative dB (or -inf)


def test_inverted_lr_correlation_minus_one():
    mono = sine(440.0, SR, 2.0, amp=0.5)
    x = np.stack([mono, -mono], axis=1)

    corr = stereo.correlation(x, SR)
    assert corr["full"] == pytest.approx(-1.0, abs=1e-9)
    assert corr["low"] == pytest.approx(-1.0, abs=1e-6)


def test_mono_input_width_none_and_correlation_one():
    mono = sine(440.0, SR, 2.0, amp=0.5).reshape(-1, 1)
    assert stereo.width_db(mono) is None
    corr = stereo.correlation(mono, SR)
    assert corr["full"] == 1.0
    assert corr["low"] == 1.0


def test_banded_width_returns_all_bands():
    rng = np.random.default_rng(0)
    n = SR * 2
    left = rng.standard_normal(n) * 0.2
    right = rng.standard_normal(n) * 0.2
    x = np.stack([left, right], axis=1)
    banded = stereo.banded_width_db(x, SR)
    assert set(banded.keys()) == {"low", "mid", "high"}
    for v in banded.values():
        assert v is None or np.isfinite(v)
