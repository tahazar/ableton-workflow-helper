import json
import subprocess
import sys
from pathlib import Path

from conftest import pink_noise, to_stereo, write_wav

from awh_analysis.__main__ import main

SR = 48000


def _run_main(capsys, argv: list[str]) -> tuple[int, str, str]:
    code = main(argv)
    captured = capsys.readouterr()
    return code, captured.out, captured.err


def test_cli_module_entry_point_smoke(tmp_path):
    # The only test that spawns `python -m awh_analysis`, the way the
    # TypeScript CLI runs it: it covers the `__main__` guard and the exit code.
    # The other CLI tests call main() in-process so coverage counts it.
    sig = to_stereo(pink_noise(SR, 3.0, amp=0.2))
    path = tmp_path / "x.wav"
    write_wav(path, sig, SR)

    proc = subprocess.run(
        [sys.executable, "-m", "awh_analysis", "report", str(path), "--bpm", "120", "--json"],
        capture_output=True,
        text=True,
        cwd=str(Path(__file__).resolve().parents[1]),
    )
    assert proc.returncode == 0, proc.stderr
    assert "measurements" in json.loads(proc.stdout)


def test_cli_report_json(tmp_path, capsys):
    sig = to_stereo(pink_noise(SR, 3.0, amp=0.2))
    path = tmp_path / "x.wav"
    write_wav(path, sig, SR)

    code, out, err = _run_main(capsys, ["report", str(path), "--bpm", "120", "--json"])
    assert code == 0, err
    obj = json.loads(out)
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


def test_cli_ab_json(tmp_path, capsys):
    sig = to_stereo(pink_noise(SR, 3.0, amp=0.2))
    path_a = tmp_path / "a.wav"
    path_b = tmp_path / "b.wav"
    write_wav(path_a, sig, SR)
    write_wav(path_b, sig, SR)

    code, out, err = _run_main(capsys, ["ab", str(path_a), str(path_b), "--json"])
    assert code == 0, err
    obj = json.loads(out)
    assert "deltas" in obj
    assert "spectrum" in obj


def test_cli_target_json(tmp_path, capsys):
    paths = []
    for i in range(2):
        sig = to_stereo(pink_noise(SR, 2.0, amp=0.2, seed=500 + i))
        p = tmp_path / f"ref{i}.wav"
        write_wav(p, sig, SR)
        paths.append(str(p))

    save_path = tmp_path / "target.json"
    code, out, err = _run_main(capsys, ["target", *paths, "--save", str(save_path), "--json"])
    assert code == 0, err
    obj = json.loads(out)
    assert "sources" in obj
    assert save_path.exists()


def test_cli_bad_input_nonzero_exit(tmp_path, capsys):
    code, out, err = _run_main(capsys, ["report", str(tmp_path / "does-not-exist.wav")])
    assert code == 1
    assert out == ""
    assert err.startswith("error: ")
