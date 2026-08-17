import numpy as np
import pytest

from awh_analysis import ab

from conftest import pink_noise, to_stereo, write_wav

SR = 48000


def test_ab_compare_matches_loudness_and_zeros_band_deltas(tmp_path):
    sig = to_stereo(pink_noise(SR, 6.0, amp=0.2))
    louder = sig * 10 ** (3.0 / 20.0)

    path_a = tmp_path / "a.wav"
    path_b = tmp_path / "b.wav"
    write_wav(path_a, sig, SR)
    write_wav(path_b, louder, SR)

    result = ab.ab_compare(str(path_a), str(path_b))

    assert result["deltas"]["lufs_integrated"] == pytest.approx(0.0, abs=0.3)
    assert result["gain_applied_db"]["b"] == pytest.approx(-3.0, abs=0.1)
    assert result["gain_applied_db"]["a"] == pytest.approx(0.0, abs=1e-6)

    band_deltas = np.asarray(result["spectrum"]["delta_db"])
    finite = band_deltas[np.isfinite(band_deltas)]
    assert np.all(np.abs(finite) < 0.3)


def test_ab_compare_with_bpm_includes_pump(tmp_path):
    sig = to_stereo(pink_noise(SR, 4.0, amp=0.2))
    path_a = tmp_path / "a.wav"
    path_b = tmp_path / "b.wav"
    write_wav(path_a, sig, SR)
    write_wav(path_b, sig, SR)

    result = ab.ab_compare(str(path_a), str(path_b), bpm=120.0)
    assert "pump" in result
    assert "a" in result["pump"] and "b" in result["pump"]
