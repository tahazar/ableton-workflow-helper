"""pumpcheck tests: synthetic known-truth signals, including the
retriggered-decay negative control the `dynamics.pump` beat-fold heuristic
cannot rule out."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np

from awh_analysis import pumpcheck
from conftest import to_stereo, write_wav

SR = 44100
TRIGGERS = [0.5 * k for k in range(9)]  # 0.5 s spacing, matches PERIOD_S below
DURATION_S = 4.5
PERIOD_S = 0.5


def _ducked_bass(
    sr: int,
    trigger_times: list[float],
    duration_s: float,
    depth_db: float,
    hold_s: float,
    tau_s: float,
    period_s: float = PERIOD_S,
    carrier_hz: float = 50.0,
    carrier_amp: float = 0.5,
):
    """Sustained carrier tone with the exact fixed dip model applied every
    cycle (instant dip / hold / exponential release): what a Volume Shaper
    produces, retriggered on the trigger clip."""
    n = int(round(duration_s * sr))
    t = np.arange(n) / sr
    carrier = carrier_amp * np.sin(2 * np.pi * carrier_hz * t)
    phase = np.mod(t, period_s)
    env_db = np.where(phase < hold_s, -depth_db, -depth_db * np.exp(-(phase - hold_s) / tau_s))
    sig = carrier * 10.0 ** (env_db / 20.0)
    return to_stereo(sig)


def _flat_bass(sr: int, duration_s: float, carrier_hz: float = 50.0, carrier_amp: float = 0.5):
    """No modulation at all — the null case."""
    n = int(round(duration_s * sr))
    t = np.arange(n) / sr
    return to_stereo(carrier_amp * np.sin(2 * np.pi * carrier_hz * t))


def _decaying_bass(
    sr: int,
    trigger_times: list[float],
    duration_s: float,
    decay_tau_s: float = 0.15,
    floor_amp: float = 0.003,
):
    """The case beat-folding cannot separate: a bass note retriggered at each
    trigger time, decaying on its own (no duck at all). High right at the
    trigger, falling continuously toward the next one. Beat-synced, but not
    ducking.
    Pattern copied from test_duck.py's _kick_drums."""
    n = int(round(duration_s * sr))
    rng = np.random.default_rng(11)
    sig = floor_amp * rng.standard_normal(n)
    for trig in trigger_times:
        start = int(round(trig * sr))
        length = min(n - start, int(0.45 * sr))
        if length <= 0:
            continue
        tt = np.arange(length) / sr
        sig[start : start + length] += 0.7 * np.exp(-tt / decay_tau_s) * np.sin(
            2 * np.pi * 50.0 * tt
        )
    return to_stereo(sig)


def test_check_pump_genuine_duck_is_detected():
    x = _ducked_bass(SR, TRIGGERS, DURATION_S, depth_db=8.0, hold_s=0.06, tau_s=0.08)
    result = pumpcheck.check_pump(x, SR, TRIGGERS)

    assert result["verdict"] == "ducking"
    fit = result["fitted"]
    assert abs(fit["depth_db"] - 8.0) <= 2.0
    assert abs(fit["hold_ms"] - 60.0) <= 40.0
    assert fit["r_squared"] >= 0.8


def test_check_pump_retriggered_decay_is_not_ducking():
    """Negative control: a retriggered note's own decay is beat-synced too,
    and must not read as ducking."""
    x = _decaying_bass(SR, TRIGGERS, DURATION_S)
    result = pumpcheck.check_pump(x, SR, TRIGGERS)

    assert result["verdict"] != "ducking"
    assert result["verdict"] == "no-duck"


def test_check_pump_flat_bass_no_modulation():
    x = _flat_bass(SR, DURATION_S)
    result = pumpcheck.check_pump(x, SR, TRIGGERS)

    assert result["verdict"] == "no-duck"
    assert result["fitted"]["depth_db"] < 1.0


def test_check_pump_shallow_duck_is_inconclusive():
    x = _ducked_bass(SR, TRIGGERS, DURATION_S, depth_db=1.5, hold_s=0.06, tau_s=0.08)
    result = pumpcheck.check_pump(x, SR, TRIGGERS)

    assert result["verdict"] == "inconclusive"


def test_check_pump_is_deterministic():
    x = _ducked_bass(SR, TRIGGERS, DURATION_S, depth_db=8.0, hold_s=0.06, tau_s=0.08)
    r1 = pumpcheck.check_pump(x, SR, TRIGGERS)
    r2 = pumpcheck.check_pump(x, SR, TRIGGERS)
    assert r1 == r2


def test_cli_pumpcheck_json_smoke(tmp_path):
    x = _ducked_bass(SR, TRIGGERS, DURATION_S, depth_db=8.0, hold_s=0.06, tau_s=0.08)
    path = tmp_path / "bass.wav"
    write_wav(path, x, SR)
    trig_arg = ",".join(str(t) for t in TRIGGERS)

    proc = subprocess.run(
        [sys.executable, "-m", "awh_analysis", "pumpcheck", str(path), "--triggers", trig_arg, "--json"],
        capture_output=True,
        text=True,
        cwd=str(Path(__file__).resolve().parents[1]),
    )
    assert proc.returncode == 0, proc.stderr
    obj = json.loads(proc.stdout)
    for key in ("window_ms", "used_triggers", "envelope", "fitted", "verdict", "evidence", "notes"):
        assert key in obj
    assert obj["verdict"] == "ducking"
    for key in ("peak_db", "tail_db", "peak_to_tail_db", "min_time_ms", "min_fraction"):
        assert key in obj["envelope"]
    for key in ("depth_db", "hold_ms", "release_tau_ms", "r_squared"):
        assert key in obj["fitted"]
