import numpy as np
import pytest

from awh_analysis import audio

from conftest import sine, to_stereo, write_wav

SR = 48000


def test_load_rejects_short_file(tmp_path):
    short = to_stereo(sine(440, SR, 0.5))
    path = tmp_path / "short.wav"
    write_wav(path, short, SR)
    with pytest.raises(ValueError):
        audio.load(str(path))


def test_load_roundtrip_and_window(tmp_path):
    sig = to_stereo(sine(440, SR, 3.0))
    path = tmp_path / "sig.wav"
    write_wav(path, sig, SR)

    x, sr = audio.load(str(path))
    assert sr == SR
    assert x.shape[0] == pytest.approx(3.0 * SR, abs=2)
    assert x.shape[1] == 2

    x2, _ = audio.load(str(path), start_s=1.0, end_s=2.5)
    assert x2.shape[0] == pytest.approx(1.5 * SR, abs=2)


def test_load_out_of_range_window_raises(tmp_path):
    sig = to_stereo(sine(440, SR, 2.0))
    path = tmp_path / "sig.wav"
    write_wav(path, sig, SR)
    with pytest.raises(ValueError):
        audio.load(str(path), start_s=0.0, end_s=10.0)


def test_to_mono():
    x = np.stack([np.ones(10), -np.ones(10)], axis=1)
    mono = audio.to_mono(x)
    assert np.allclose(mono, 0.0)


def test_sanitize_json_strips_non_finite():
    import json

    from awh_analysis.audio import sanitize_json

    dirty = {"a": float("-inf"), "b": [1.0, float("nan"), {"c": float("inf")}], "d": "x", "e": 3}
    clean = sanitize_json(dirty)
    assert clean == {"a": None, "b": [1.0, None, {"c": None}], "d": "x", "e": 3}
    json.dumps(clean, allow_nan=False)  # must not raise
