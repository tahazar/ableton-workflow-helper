import numpy as np
import pytest

from awh_analysis import report

from conftest import pink_noise, to_stereo, write_wav

SR = 48000


def test_club_delivery_finding_on_minus14_lufs_file(tmp_path):
    sig = to_stereo(pink_noise(SR, 6.0, amp=0.2))
    lufs = report.loudness.lufs_integrated(sig, SR)
    gain_db = -14.0 - lufs
    x = sig * 10 ** (gain_db / 20.0)

    path = tmp_path / "x.wav"
    write_wav(path, x, SR)

    measurements = report.analyze(str(path))
    assert measurements["loudness"]["lufs_integrated"] == pytest.approx(-14.0, abs=0.2)

    finding_list = report.findings(measurements, delivery="club")
    delivery_findings = [f for f in finding_list if f["id"] == "delivery_lufs"]
    assert len(delivery_findings) == 1
    f = delivery_findings[0]
    assert f["value"] == pytest.approx(-14.0, abs=0.2)
    assert f["threshold"] == "-8.0..-6.0"
    # -14 is below the club range's lower bound of -8 -> delta ~= -6 LU
    expected_delta = f["value"] - (-8.0)
    assert expected_delta == pytest.approx(-6.0, abs=0.3)


def test_findings_sorted_alert_warn_info():
    measurements = {
        "bpm": None,
        "loudness": {"psr": {"min_psr_loud": 5.0}},
        "stereo": {"correlation": {"low": 0.5}},
        "spectrum": {"tilt_db_per_oct": -5.0},
        "target_comparison": None,
        "dynamics": {
            "asymmetry": [{"ratio_db": 4.0, "skewness": 0.1}],
            "phase_rotation_headroom": {"best_db": 2.0, "f0": 200.0, "poles": 4},
            "pump": None,
        },
    }
    finding_list = report.findings(measurements)
    severities = [f["severity"] for f in finding_list]
    assert severities == ["alert", "warn", "info"]

    rank = {"alert": 0, "warn": 1, "info": 2}
    ranks = [rank[s] for s in severities]
    assert ranks == sorted(ranks)


def test_analyze_top_level_schema(tmp_path):
    sig = to_stereo(pink_noise(SR, 3.0, amp=0.2))
    path = tmp_path / "x.wav"
    write_wav(path, sig, SR)

    measurements = report.analyze(str(path), bpm=120.0)
    for key in (
        "file",
        "samplerate",
        "channels",
        "duration_s",
        "bpm",
        "loudness",
        "spectrum",
        "stereo",
        "dynamics",
        "target_comparison",
    ):
        assert key in measurements

    finding_list = report.findings(measurements)
    for f in finding_list:
        for key in ("id", "severity", "metric", "value", "threshold", "explanation", "suggestion"):
            assert key in f
