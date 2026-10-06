"""Break-chop analyzer tests (docs/design/break-engine.md's verification
bar): synthetic break -> exact slice count, correct roles, small grid
offsets; a shifted-hits synthetic -> offsets reported (never silently
snapped); --export byte-lengths (frame counts) match the reported spans;
determinism; a negative-control ghost hit; zero-onset state.
"""

from __future__ import annotations

import itertools
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

from awh_analysis import breakchop
from conftest import to_stereo

SR = 44100
BPM = 90.0
GRID = 16
STEP_DUR_S = (60.0 / BPM) * (4.0 / GRID)  # 0.16667s, generous relative to
# the onset detector's own ~20-30ms measurement latency, so a well-behaved
# synthetic fixture's offsets stay a small fraction of one grid step.
LEAD_STEPS = 3  # pre-roll expressed as a whole number of grid steps (not an
# arbitrary lead-in) so the code's "downbeat at absolute t=0" assumption
# folds the fixture's hits onto the exact intended grid positions, while
# still giving the onset detector enough pre-roll before the first transient
# (same margin rationale as awh_analysis.drumstats' own LEAD_IN_S).
LEAD_S = LEAD_STEPS * STEP_DUR_S

# amen-shaped skeleton: kick/snare backbeat-ish + hats, well separated (>=8
# steps apart) so no slice's span accidentally swallows a neighboring hit.
EVENTS = [(0, "kick"), (8, "snare"), (16, "kick"), (24, "hat"), (32, "snare"), (40, "kick"), (48, "hat")]


def _burst(
    n: int, sr: int, t0: float, freq: float, amp: float, tau: float,
    attack_s: float = 0.005, release_s: float = 0.005, seed: int | None = None,
):
    """A short decaying burst with a raised-cosine attack and release ramp.
    Real percussive hits never start/stop with a mathematical discontinuity;
    an instantaneous on/off step injects broadband "click" energy that a
    zero-phase (filtfilt) band-split filter can ring across a wide time
    span, contaminating neighboring slices' role classification. The ramps
    keep this fixture's spectral content true to the burst's intended
    frequency (a tone if seed is None, filtered noise for the hat proxy)."""
    start = int(round(t0 * sr))
    length = min(n - start, int(8 * tau * sr))
    if length <= 0:
        return None, None
    tt = np.arange(length) / sr
    env = np.exp(-tt / tau).copy()
    a_samp = max(1, int(round(attack_s * sr)))
    if a_samp < length:
        env[:a_samp] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(a_samp) / a_samp)
    r_samp = max(1, int(round(release_s * sr)))
    if r_samp < length:
        env[-r_samp:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(r_samp) / r_samp)
    if seed is None:
        burst = amp * env * np.sin(2 * np.pi * freq * tt)
    else:
        rng = np.random.default_rng(seed)
        burst = amp * env * rng.standard_normal(length)
    return start, burst


def _synthetic_break(shift_s: float = 0.0, noise_seed: int = 3) -> np.ndarray:
    dur = LEAD_S + (max(s for s, _ in EVENTS) + 8) * STEP_DUR_S + 0.3
    n = int(round(dur * SR))
    rng = np.random.default_rng(noise_seed)
    sig = 0.0005 * rng.standard_normal(n)
    for step, kind in EVENTS:
        t0 = LEAD_S + step * STEP_DUR_S + shift_s
        if kind == "kick":
            start, b = _burst(n, SR, t0, 55.0, 0.9, 0.04)
        elif kind == "snare":
            start, b = _burst(n, SR, t0, 220.0, 0.6, 0.03)
        else:
            start, b = _burst(n, SR, t0, 9000.0, 0.3, 0.012, seed=int(t0 * 1e7) % 99991)
        assert start is not None
        sig[start : start + len(b)] += b
    return sig


def _write(tmp_path, name: str, sig: np.ndarray) -> str:
    path = tmp_path / name
    sf.write(str(path), to_stereo(sig), SR, subtype="PCM_24")
    return str(path)


def test_synthetic_break_slice_count_roles_and_small_offsets(tmp_path):
    path = _write(tmp_path, "break.wav", _synthetic_break())
    result = breakchop.analyze_break(path, bpm_override=BPM)

    assert result["n_slices"] == len(EVENTS)
    assert result["bpm_source"] == "override"
    assert result["bpm"] == BPM

    expected_steps = [s + LEAD_STEPS for s, _ in EVENTS]
    expected_roles = [role for _, role in EVENTS]
    got_steps = [sl["grid_step"] for sl in result["slices"]]
    got_roles = [sl["role"] for sl in result["slices"]]
    assert got_steps == expected_steps
    assert got_roles == expected_roles

    # "grid offsets ~0": small relative to the grid, not literally zero. A
    # real onset detector has some measurement latency (see module
    # docstring's ramp rationale) which this asserts stays well under a
    # quarter of one grid step, never silently rounded away.
    quarter_step_ms = STEP_DUR_S * 1000.0 * 0.25
    for sl in result["slices"]:
        assert abs(sl["offset_ms"]) < quarter_step_ms, sl

    # role guesses on well-separated, correctly-pitched hits should read as
    # confident, not a coin flip.
    for sl in result["slices"]:
        assert sl["confidence"] > 0.85, sl
        assert not sl["is_ghost"]

    # every slice's end is the next slice's start (contiguous spans), and
    # the final slice's end is the file's own end (never truncated early;
    # see module docstring's slicing convention).
    for a, b in itertools.pairwise(result["slices"]):
        assert a["end_s"] == b["start_s"]
    assert result["slices"][-1]["end_s"] == result["duration_s"]


def test_shifted_hits_offsets_are_measured_not_snapped(tmp_path):
    """A sloppy break (every hit displaced off the grid by the same known
    amount) must show that shift in its reported offsets, never silently
    re-snapped back onto the grid."""
    shift_s = 0.03
    on_grid = breakchop.analyze_break(_write(tmp_path, "grid.wav", _synthetic_break(0.0)), bpm_override=BPM)
    shifted = breakchop.analyze_break(_write(tmp_path, "shifted.wav", _synthetic_break(shift_s)), bpm_override=BPM)

    assert on_grid["n_slices"] == shifted["n_slices"] == len(EVENTS)
    for a, b in zip(on_grid["slices"], shifted["slices"], strict=True):
        delta_ms = b["offset_ms"] - a["offset_ms"]
        # allow generous slack for onset-detection quantization (~1 STFT
        # hop, see ref.ONSET_HOP). The point is the shift shows up at all.
        assert delta_ms > shift_s * 1000.0 * 0.5, (a, b, delta_ms)


def test_ghost_negative_control(tmp_path):
    """A quiet hit well below the loudest slice's peak is labeled 'ghost'
    with a real confidence, not silently folded into a band role."""
    n = int(round(4.5 * SR))
    rng = np.random.default_rng(1)
    sig = 0.0002 * rng.standard_normal(n)
    for t0 in (0.5, 3.9):
        start, b = _burst(n, SR, t0, 55.0, 0.4, 0.04)
        sig[start : start + len(b)] += b
    start, b = _burst(n, SR, 2.2, 55.0, 0.05, 0.04)  # ~-18 dB below the main hits
    sig[start : start + len(b)] += b

    path = _write(tmp_path, "ghost.wav", sig)
    result = breakchop.analyze_break(path, bpm_override=BPM)
    assert result["n_slices"] == 3
    ghost = result["slices"][1]
    assert ghost["is_ghost"] is True
    assert ghost["role"] == "ghost"
    assert 0.0 < ghost["confidence"] <= 1.0
    assert result["slices"][0]["role"] == "kick"
    assert result["slices"][2]["role"] == "kick"


def test_zero_onsets_is_a_state_not_an_error(tmp_path):
    """Docs/lessons-learned.md #5: nothing detected is a state (empty slice
    list), never a raised exception."""
    n = int(round(2.0 * SR))
    sig = np.zeros(n)  # digital silence, no hits at all
    path = _write(tmp_path, "silence.wav", sig)
    result = breakchop.analyze_break(path, bpm_override=BPM)
    assert result["n_slices"] == 0
    assert result["slices"] == []


def test_export_byte_lengths_match_slice_spans(tmp_path):
    path = _write(tmp_path, "break.wav", _synthetic_break())
    result = breakchop.analyze_break(path, bpm_override=BPM)
    export_dir = tmp_path / "export"
    exported = breakchop.export_slices(path, result, str(export_dir))

    assert len(exported["files"]) == result["n_slices"]
    sr = sf.info(path).samplerate
    for f, sl in zip(exported["files"], result["slices"], strict=True):
        expected_frames = round((sl["end_s"] - sl["start_s"]) * sr)
        assert f["frames"] == expected_frames
        actual_frames = sf.info(f["path"]).frames
        assert actual_frames == expected_frames
    assert (export_dir / "README.md").exists()
    readme = (export_dir / "README.md").read_text()
    for f in exported["files"]:
        assert f["file"] in readme


def test_determinism(tmp_path):
    path = _write(tmp_path, "break.wav", _synthetic_break())
    a = breakchop.analyze_break(path, bpm_override=BPM)
    b = breakchop.analyze_break(path, bpm_override=BPM)
    assert json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)


def test_bpm_estimated_when_not_overridden(tmp_path):
    """Without --bpm, the existing tempo estimator runs and carries its own
    confidence (never silently assumed)."""
    path = _write(tmp_path, "break.wav", _synthetic_break())
    result = breakchop.analyze_break(path)
    assert result["bpm_source"] == "estimated"
    assert 0.0 <= result["bpm_confidence"] <= 1.0
    assert result["bpm"] > 0


def test_save_chopmap_record(tmp_path):
    path = _write(tmp_path, "break.wav", _synthetic_break())
    result = breakchop.analyze_break(path, bpm_override=BPM)
    record_path = tmp_path / "records" / "amen.json"
    breakchop.save_chopmap_record(str(record_path), path, result)
    record = json.loads(record_path.read_text())
    assert record["kind"] == "chopmap"
    assert record["chopmap"]["n_slices"] == result["n_slices"]
    assert "sha256" in record


def test_cli_breakchop_json_smoke(tmp_path):
    path = _write(tmp_path, "break.wav", _synthetic_break())
    proc = subprocess.run(
        [sys.executable, "-m", "awh_analysis", "breakchop", str(path), "--bpm", str(BPM), "--json"],
        capture_output=True,
        text=True,
        cwd=str(Path(__file__).resolve().parents[1]),
    )
    assert proc.returncode == 0, proc.stderr
    obj = json.loads(proc.stdout)
    assert obj["n_slices"] == len(EVENTS)


def test_cli_breakchop_export_and_save_record(tmp_path):
    path = _write(tmp_path, "break.wav", _synthetic_break())
    export_dir = tmp_path / "export"
    record_path = tmp_path / "record.json"
    proc = subprocess.run(
        [
            sys.executable, "-m", "awh_analysis", "breakchop", str(path),
            "--bpm", str(BPM), "--export", str(export_dir),
            "--save-record", str(record_path), "--json",
        ],
        capture_output=True,
        text=True,
        cwd=str(Path(__file__).resolve().parents[1]),
    )
    assert proc.returncode == 0, proc.stderr
    obj = json.loads(proc.stdout)
    assert obj["export"]["files"]
    assert (export_dir / "README.md").exists()
    assert record_path.exists()
    record = json.loads(record_path.read_text())
    assert record["kind"] == "chopmap"
