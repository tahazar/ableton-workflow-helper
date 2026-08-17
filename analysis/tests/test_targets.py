import numpy as np

from awh_analysis import report, targets

from conftest import pink_noise, to_stereo, write_wav

SR = 48000


def test_build_save_load_compare_target(tmp_path):
    paths = []
    for i in range(3):
        sig = to_stereo(pink_noise(SR, 3.0, amp=0.2, seed=1000 + i))
        p = tmp_path / f"ref{i}.wav"
        write_wav(p, sig, SR)
        paths.append(str(p))

    target = targets.build_target(paths)
    assert len(target["sources"]) == 3
    assert len(target["bands"]) > 0
    assert np.isfinite(target["tilt"]["median"])

    target_path = tmp_path / "target.json"
    targets.save_target(target, str(target_path))
    loaded = targets.load_target(str(target_path))
    assert loaded["sources"] == target["sources"]

    # A track close to the target should mostly not be flagged.
    test_sig = to_stereo(pink_noise(SR, 3.0, amp=0.2, seed=2000))
    test_path = tmp_path / "test.wav"
    write_wav(test_path, test_sig, SR)
    measurements = report.analyze(str(test_path), target=loaded)

    deltas = measurements["target_comparison"]
    assert deltas is not None
    assert len(deltas) > 0
    flagged_fraction = sum(1 for d in deltas if d["flagged"]) / len(deltas)
    assert flagged_fraction < 0.3
