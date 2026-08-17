import numpy as np
import pytest

from awh_analysis import spectrum

from conftest import pink_noise, to_stereo, white_noise

SR = 48000


def test_white_noise_band_power_rises_3db_per_octave():
    x = to_stereo(white_noise(SR, 10.0, amp=0.25))
    bands = spectrum.third_octave_spectrum(x, SR)
    tilt = spectrum.spectral_tilt(bands)
    # White noise has flat PSD; band POWER (integrated over widening
    # third-octave bandwidth) rises ~+3 dB/oct.
    assert tilt == pytest.approx(3.0, abs=0.5)


def test_pink_noise_flat_third_octave_bands():
    x = to_stereo(pink_noise(SR, 10.0, amp=0.25))
    bands = spectrum.third_octave_spectrum(x, SR)
    freqs = np.asarray(bands["freqs"])
    db = np.asarray(bands["db"])
    mask = (freqs >= 100) & (freqs <= 4000)
    band_db = db[mask]
    assert np.all(np.isfinite(band_db))
    assert (band_db.max() - band_db.min()) < 3.0  # well within +-1.5 dB spread
    for v in band_db:
        assert v == pytest.approx(0.0, abs=1.5)


def test_pink_noise_tilt_near_zero():
    x = to_stereo(pink_noise(SR, 10.0, amp=0.25))
    bands = spectrum.third_octave_spectrum(x, SR)
    tilt = spectrum.spectral_tilt(bands)
    assert tilt == pytest.approx(0.0, abs=0.5)


def test_spectrum_normalized_to_zero_mean_100_4k():
    x = to_stereo(pink_noise(SR, 10.0, amp=0.25))
    bands = spectrum.third_octave_spectrum(x, SR)
    freqs = np.asarray(bands["freqs"])
    db = np.asarray(bands["db"])
    mask = (freqs >= 100) & (freqs <= 4000) & np.isfinite(db)
    assert np.mean(db[mask]) == pytest.approx(0.0, abs=1e-6)


def test_band_freqs_span_25_to_20000():
    x = to_stereo(white_noise(SR, 2.0))
    bands = spectrum.third_octave_spectrum(x, SR)
    freqs = bands["freqs"]
    assert freqs[0] == pytest.approx(25.0, rel=0.05)
    assert freqs[-1] == pytest.approx(20000.0, rel=0.05)
    assert len(freqs) == len(bands["db"])
