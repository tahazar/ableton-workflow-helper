import json
import subprocess
import sys

from conftest import pink_noise, to_stereo, write_wav

SR = 48000


def test_cli_report_json_smoke(tmp_path):
    sig = to_stereo(pink_noise(SR, 3.0, amp=0.2))
    path = tmp_path / "x.wav"
    write_wav(path, sig, SR)

    proc = subprocess.run(
        [sys.executable, "-m", "awh_analysis", "report", str(path), "--bpm", "120", "--json"],
        capture_output=True,
        text=True,
        cwd=str(__import__("pathlib").Path(__file__).resolve().parents[1]),
    )
    assert proc.returncode == 0, proc.stderr
    obj = json.loads(proc.stdout)
    assert "measurements" in obj
    assert "findings" in obj
    m = obj["measurements"]
    for key in (
        "file",
        "samplerate",
        "channels",
        "duration_s",
        "loudness",
        "spectrum",
        "stereo",
        "dynamics",
    ):
        assert key in m


def test_cli_ab_json_smoke(tmp_path):
    sig = to_stereo(pink_noise(SR, 3.0, amp=0.2))
    path_a = tmp_path / "a.wav"
    path_b = tmp_path / "b.wav"
    write_wav(path_a, sig, SR)
    write_wav(path_b, sig, SR)

    proc = subprocess.run(
        [sys.executable, "-m", "awh_analysis", "ab", str(path_a), str(path_b), "--json"],
        capture_output=True,
        text=True,
        cwd=str(__import__("pathlib").Path(__file__).resolve().parents[1]),
    )
    assert proc.returncode == 0, proc.stderr
    obj = json.loads(proc.stdout)
    assert "deltas" in obj
    assert "spectrum" in obj


def test_cli_target_json_smoke(tmp_path):
    paths = []
    for i in range(2):
        sig = to_stereo(pink_noise(SR, 2.0, amp=0.2, seed=500 + i))
        p = tmp_path / f"ref{i}.wav"
        write_wav(p, sig, SR)
        paths.append(str(p))

    save_path = tmp_path / "target.json"
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "awh_analysis",
            "target",
            *paths,
            "--save",
            str(save_path),
            "--json",
        ],
        capture_output=True,
        text=True,
        cwd=str(__import__("pathlib").Path(__file__).resolve().parents[1]),
    )
    assert proc.returncode == 0, proc.stderr
    obj = json.loads(proc.stdout)
    assert "sources" in obj
    assert save_path.exists()


def test_cli_bad_input_nonzero_exit(tmp_path):
    proc = subprocess.run(
        [sys.executable, "-m", "awh_analysis", "report", str(tmp_path / "does-not-exist.wav")],
        capture_output=True,
        text=True,
        cwd=str(__import__("pathlib").Path(__file__).resolve().parents[1]),
    )
    assert proc.returncode != 0
