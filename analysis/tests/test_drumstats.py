import subprocess
import sys

import numpy as np
import pytest

from awh_analysis import drumstats
from conftest import to_stereo, white_noise, write_wav

SR = 44100
BPM = 120.0
GRID = 16
BARS = 4


def _step_dur_s(bpm: float = BPM, grid: int = GRID) -> float:
    return (60.0 / bpm) * (4.0 / grid)


def _burst(
    n: int, sr: int, t0: float, freq: float, amp: float, tau: float, seed: int | None = None
) -> tuple[int, np.ndarray]:
    """A short exponentially-decaying burst: a sine (kick-like) if seed is
    None, otherwise filtered noise (click-like, for the hat proxy)."""
    start = int(round(t0 * sr))
    length = min(n - start, int(0.08 * sr))
    if start < 0 or length <= 0:
        raise ValueError(f"burst at {t0} s does not fit in {n} samples")
    tt = np.arange(length) / sr
    env = np.exp(-tt / tau)
    if seed is None:
        burst = amp * env * np.sin(2 * np.pi * freq * tt)
    else:
        rng = np.random.default_rng(seed)
        burst = amp * env * rng.standard_normal(length)
    return start, burst


LEAD_IN_S = 0.06  # pre-roll before the first hit, comfortably past one full
# STFT analysis window (2048 samples @ 44.1kHz = 46.4ms; see ref.py's
# ONSET_NFFT). A transient inside that first window is partly "seen" by
# frame 0 itself, damping the flux between frames 0 and 1 below threshold.
# Real files always have some lead-in, so this is a resolution limit worth
# clearing with margin rather than a synthetic-only quirk (in the WaivOps
# pilot corpus every loop's first low-band onset landed near t=0; see
# downbeat_check in the pilot's saved records).


def _synthetic_loop(
    bars: int = BARS, kick_steps=(0, 4, 8, 12), hat_steps=(2, 6, 10, 14)
) -> np.ndarray:
    """A synthetic drum loop: known BPM, a 55 Hz decaying-sine "kick" burst
    at `kick_steps` of every bar (four-on-the-floor by default) and a
    9 kHz decaying-noise "hat" click at `hat_steps` (offbeat 8ths by
    default), over a quiet noise floor."""
    step_dur = _step_dur_s()
    bar_dur = step_dur * GRID
    duration_s = bar_dur * bars
    n = int(round(duration_s * SR))
    rng = np.random.default_rng(7)
    sig = 0.002 * rng.standard_normal(n)

    for bar in range(bars):
        for s in kick_steps:
            t0 = LEAD_IN_S + bar * bar_dur + s * step_dur
            start, burst = _burst(n, SR, t0, 55.0, 0.9, 0.04)
            sig[start : start + len(burst)] += burst
        for s in hat_steps:
            t0 = LEAD_IN_S + bar * bar_dur + s * step_dur
            start, burst = _burst(n, SR, t0, 9000.0, 0.5, 0.01, seed=int(t0 * 1e6) % 99991)
            sig[start : start + len(burst)] += burst
    return sig


def _write_loop(tmp_path, name: str, sig: np.ndarray) -> str:
    path = tmp_path / name
    write_wav(path, to_stereo(sig), SR)
    return str(path)


def test_mine_drum_loops_recovers_known_pattern(tmp_path):
    """Positive case: a synthetic four-floor kick + offbeat-8th hat loop
    must be recovered by the miner, with low-band peaks at grid positions 0/4/8/12,
    high-band peaks at 2/6/10/14."""
    path = _write_loop(tmp_path, "synthetic.wav", _synthetic_loop())
    result = drumstats.mine_drum_loops(
        [path], bpm_from_name=False, bpm=BPM, grid=GRID, dataset_name="synth"
    )

    assert result["n_loops"] == 1
    assert result["bpm_range"] == [BPM, BPM]

    low_prob = result["per_band"]["low"]["position_prob"]
    for i in (0, 4, 8, 12):
        assert low_prob[i] >= 0.7, f"low band position {i} should carry the kick, got {low_prob[i]}"
    for i in range(GRID):
        if i not in (0, 4, 8, 12):
            assert low_prob[i] <= 0.3, f"low band position {i} should be quiet, got {low_prob[i]}"

    high_prob = result["per_band"]["high"]["position_prob"]
    for i in (2, 6, 10, 14):
        assert high_prob[i] >= 0.9, (
            f"high band position {i} should carry the hat, got {high_prob[i]}"
        )
    for i in range(GRID):
        if i not in (2, 6, 10, 14):
            assert high_prob[i] <= 0.2, (
                f"high band position {i} should be quiet, got {high_prob[i]}"
            )

    # swing computation must not crash even when it has partial/no data to
    # work with (every synthetic onset here lands on an even grid position)
    assert result["swing_estimate"]["band"] == "high"

    # pilot-size caveat is always present
    assert any("PILOT sample size" in a for a in result["assumptions"])
    # the synthetic loop starts on beat 1, so the check should agree
    assert result["downbeat_check"]["loops_checked"] == 1
    assert result["downbeat_check"]["loops_near_zero"] == 1


def test_mine_drum_loops_silence_is_zero_items(tmp_path):
    """Zero items is a state, not an error (docs/lessons-learned.md #5): a
    silent loop must mine cleanly to all-zero histograms, never crash or
    produce NaN."""
    silent = np.zeros(int(round(8.0 * SR)))
    path = _write_loop(tmp_path, "silence.wav", silent)
    result = drumstats.mine_drum_loops(
        [path], bpm_from_name=False, bpm=BPM, grid=GRID, dataset_name="silence"
    )

    assert result["n_loops"] == 1
    for band in ("low", "mid", "high"):
        b = result["per_band"][band]
        assert b["onsets_total"] == 0
        assert b["density"] == 0.0
        assert all(p == 0.0 for p in b["position_prob"])


def test_find_audio_files_empty_dir_is_empty_list(tmp_path):
    empty_dir = tmp_path / "empty"
    empty_dir.mkdir()
    assert drumstats.find_audio_files([str(empty_dir)]) == []


def test_cli_drumstats_no_audio_files_exits_zero(tmp_path):
    """CLI-level zero-items state: an existing directory with no audio
    files must exit 0 with an explanatory message, not error (same
    convention as `a2m`'s zero-notes case)."""
    empty_dir = tmp_path / "empty"
    empty_dir.mkdir()
    repo_analysis = __import__("pathlib").Path(__file__).resolve().parents[1]

    proc = subprocess.run(
        [sys.executable, "-m", "awh_analysis", "drumstats", str(empty_dir)],
        capture_output=True,
        text=True,
        cwd=str(repo_analysis),
    )
    assert proc.returncode == 0, proc.stderr
    assert "no audio files found" in proc.stdout


def test_mine_drum_loops_white_noise_negative_control(tmp_path):
    """Negative control (docs/lessons-learned.md #2): stationary white noise
    carries no rhythmic structure, so no single grid position should
    dominate the way a real kick/hat does. Empirically, with n=16 x 8s
    loops (64 bars total) the noisiest observed max/mean ratio across many
    seeds stayed under ~1.5 for every band; a real four-floor/offbeat
    pattern's dominant positions run close to `n_bars`x the trough (ratio
    well over 3, see the positive test's near-1.0-vs-0.0 split). `< 2.0x`
    leaves comfortable margin above the noise floor while still failing
    loudly if the onset detector or grid-folding math ever introduces a
    spurious periodic bias.
    """
    paths = []
    for i in range(16):
        sig = white_noise(SR, 8.0, amp=0.3, seed=2000 + i)
        paths.append(_write_loop(tmp_path, f"noise{i}.wav", sig))

    result = drumstats.mine_drum_loops(
        paths, bpm_from_name=False, bpm=BPM, grid=GRID, dataset_name="noise"
    )
    assert result["n_loops"] == 16

    for band in ("low", "mid", "high"):
        probs = result["per_band"][band]["position_prob"]
        assert result["per_band"][band]["onsets_total"] > 0, (
            f"{band} band detected no onsets at all — test is vacuous"
        )
        mean_p = sum(probs) / len(probs)
        max_p = max(probs)
        assert max_p < 2.0 * mean_p, (
            f"{band} band: position prob max {max_p:.3f} vs mean {mean_p:.3f} "
            "looks too peaked for white noise — check for a spurious periodic bias"
        )


def test_bpm_from_filename_and_fallback():
    assert drumstats._bpm_from_filename("138bpm_tr9_drm_id_001_0158.mp3") == 138.0
    assert drumstats._bpm_from_filename("no_tempo_here.wav") is None


def test_mine_drum_loops_skips_files_with_no_bpm(tmp_path):
    named = _write_loop(tmp_path, "120bpm_loop.wav", _synthetic_loop())
    unnamed = _write_loop(tmp_path, "loop_no_tempo.wav", _synthetic_loop())
    result = drumstats.mine_drum_loops(
        [named, unnamed], bpm_from_name=True, grid=GRID, dataset_name="mixed"
    )
    assert result["n_loops"] == 1
    assert len(result["skipped"]) == 1
    assert result["skipped"][0]["file"] == "loop_no_tempo.wav"
    assert "no BPM" in result["skipped"][0]["reason"]


def test_mine_drum_loops_requires_paths_or_bpm():
    with pytest.raises(ValueError):
        drumstats.mine_drum_loops([])
    with pytest.raises(ValueError):
        drumstats.mine_drum_loops(["/does/not/matter.wav"], bpm_from_name=False, bpm=None)


def test_save_record_writes_sha256_and_attribution(tmp_path):
    path = _write_loop(tmp_path, "synthetic.wav", _synthetic_loop())
    result = drumstats.mine_drum_loops(
        [path], bpm_from_name=False, bpm=BPM, grid=GRID, dataset_name="synth"
    )
    record_path = tmp_path / "records" / "synth.json"
    drumstats.save_record(
        str(record_path),
        [path],
        result,
        attribution={"license": "CC BY 4.0", "requires_attribution": True},
    )
    assert record_path.exists()
    import json

    saved = json.loads(record_path.read_text())
    assert saved["kind"] == "drumstats"
    assert saved["n_sources"] == 1
    assert saved["sources"][0]["file"] == "synthetic.wav"
    assert len(saved["sources"][0]["sha256"]) == 64
    assert saved["attribution"]["license"] == "CC BY 4.0"
    assert saved["stats"]["dataset"] == "synth"
