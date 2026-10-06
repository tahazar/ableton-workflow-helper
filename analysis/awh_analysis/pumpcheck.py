"""Trigger-locked sidechain verification.

`dynamics.pump` folds the RMS envelope against the beat period and reads
off a peak/trough shape. That shape read alone cannot distinguish ducking
from a retriggered note's own decay on a full-mix capture (disabling the
shaper barely moves the folded trough; see
knowledge/setup/sidechain-template.md). The retriggered decay case is
beat-synced too, so a beat-fold sees the same periodicity either way.

This module addresses that two ways:

1. Align on the actual trigger note times (`duck.trigger_aligned_envelope`)
   instead of a generic beat period. Kick & Snare patterns aren't
   one-per-beat, so a period-fold measures the wrong thing on this
   template regardless of the shape question.
2. Fit the fixed duck model (instant dip, hold, exponential release) to
   the trigger-aligned envelope instead of reading off statistics. Volume
   Shaper applies the identical user-drawn envelope on every hit, so a
   parametric fit against that exact shape is the right model. A good fit
   (high r^2) at a shape a natural decay cannot produce (early trough, not
   one drifting to the end of the window) is evidence, not a coincidental
   periodicity.

Scope: this is a single-capture check. Decay cannot produce an early
trough with a flat hold and exponential recovery back to the tail level
(it only falls), but an A/B (shaper on vs Device On -> 0, `ab_compare`)
remains the definitive verification; that is a separate `awh mix duck`/`ab`
flow.
"""

from __future__ import annotations

import numpy as np

from .duck import trigger_aligned_envelope

# 25 ms envelope window / 5 ms hop: same as duck.measure_duck_depth. Long
# enough to average out sub-bass carrier ripple, short enough to resolve a
# real duck.
ENV_WINDOW_S = 0.025
ENV_HOP_S = 0.005

TAIL_FRACTION = 0.15  # last 15% of the window = the stable "recovered" reference

# Grid search over the fixed-shape fit (coarse, deterministic, no
# scipy.optimize randomness).
HOLD_STEPS = 24
HOLD_MAX_FRACTION = 0.6  # hold searched over 0..60% of the window
TAU_STEPS = 24
TAU_MIN_FRACTION = 0.1  # release tau searched over 10..60% of the window
TAU_MAX_FRACTION = 0.6

DUCKING_DEPTH_DB = 2.0
DUCKING_R_SQUARED = 0.8
DUCKING_MAX_MIN_FRACTION = 0.6  # envelope minimum must land in the first 60% of the window

NO_DUCK_DEPTH_DB = 1.0
NO_DUCK_MIN_MIN_FRACTION = 0.75  # minimum in the last 25% = still falling at wrap = decay, not duck

HONEST_LIMIT_SPAN_DB = (
    20.0  # peak-to-tail beyond this suggests a full-mix / bleed-dominated capture
)


def _dip_basis(times: np.ndarray, hold_s: float, tau_s: float) -> np.ndarray:
    """Shape of the fixed duck model normalized to 1.0 at the dip and 0.0
    once fully recovered: 1 for t < hold, exp(-(t-hold)/tau) after."""
    return np.where(times < hold_s, 1.0, np.exp(-(times - hold_s) / tau_s))


def _fit_dip_model(
    times: np.ndarray, y_db: np.ndarray, window_s: float
) -> tuple[float, float, float, float]:
    """Coarse deterministic grid search over (hold, tau); depth is fit in
    closed form (linear least squares through the origin) for each grid
    point. Returns (depth_db, hold_s, tau_s, r_squared)."""
    holds = np.linspace(0.0, HOLD_MAX_FRACTION * window_s, HOLD_STEPS)
    taus = np.linspace(TAU_MIN_FRACTION * window_s, TAU_MAX_FRACTION * window_s, TAU_STEPS)

    ss_tot = float(np.sum((y_db - np.mean(y_db)) ** 2))

    best_rss = None
    best = (0.0, 0.0, float(taus[0]))
    for hold in holds:
        for tau in taus:
            basis = _dip_basis(times, float(hold), float(tau))
            denom = float(np.sum(basis * basis))
            # model = -depth * basis; least squares coefficient c on
            # (model = c * basis) is sum(y*basis)/sum(basis^2); depth = -c,
            # clamped to >= 0 (a duck cannot have negative depth).
            c = float(np.sum(y_db * basis) / denom) if denom > 1e-12 else 0.0
            depth = max(0.0, -c)
            residual = y_db - (-depth * basis)
            rss = float(np.sum(residual * residual))
            if best_rss is None or rss < best_rss:
                best_rss = rss
                best = (depth, float(hold), float(tau))

    depth_db, hold_s, tau_s = best
    if ss_tot > 1e-12:
        r_squared = float(np.clip(1.0 - best_rss / ss_tot, -10.0, 1.0))
    else:
        r_squared = 1.0 if best_rss <= 1e-9 else 0.0
    return depth_db, hold_s, tau_s, r_squared


def _classify(depth_db: float, r_squared: float, min_fraction: float) -> tuple[str, str]:
    is_decay_shaped = min_fraction >= NO_DUCK_MIN_MIN_FRACTION

    if (
        depth_db >= DUCKING_DEPTH_DB
        and r_squared >= DUCKING_R_SQUARED
        and min_fraction <= DUCKING_MAX_MIN_FRACTION
    ):
        evidence = (
            f"depth {depth_db:.1f} dB >= {DUCKING_DEPTH_DB:.1f} dB, fit r^2={r_squared:.2f} "
            f">= {DUCKING_R_SQUARED:.2f}, and the envelope minimum lands "
            f"{min_fraction * 100:.0f}% into the trigger window (<= "
            f"{DUCKING_MAX_MIN_FRACTION * 100:.0f}%) — matches a trigger-locked dip-then-"
            "recover shape, not note decay."
        )
        return "ducking", evidence

    if depth_db < NO_DUCK_DEPTH_DB or is_decay_shaped:
        if depth_db < NO_DUCK_DEPTH_DB and is_decay_shaped:
            evidence = (
                f"depth {depth_db:.1f} dB < {NO_DUCK_DEPTH_DB:.1f} dB and the envelope "
                f"minimum lands {min_fraction * 100:.0f}% into the window (>= "
                f"{NO_DUCK_MIN_MIN_FRACTION * 100:.0f}%, i.e. still falling at the next "
                "trigger) — no modulation and a decay-shaped tail."
            )
        elif depth_db < NO_DUCK_DEPTH_DB:
            evidence = (
                f"depth {depth_db:.1f} dB < {NO_DUCK_DEPTH_DB:.1f} dB — no meaningful "
                "level modulation at the trigger."
            )
        else:
            evidence = (
                f"envelope minimum lands {min_fraction * 100:.0f}% into the window (>= "
                f"{NO_DUCK_MIN_MIN_FRACTION * 100:.0f}%) — still falling right up to the "
                "next trigger, the shape of a retriggered note's own decay, not a duck "
                "that dips then recovers."
            )
        return "no-duck", evidence

    evidence = (
        f"depth {depth_db:.1f} dB and fit r^2={r_squared:.2f} fall between the ducking "
        f"threshold ({DUCKING_DEPTH_DB:.1f} dB depth, r^2>={DUCKING_R_SQUARED:.2f}, "
        f"minimum <= {DUCKING_MAX_MIN_FRACTION * 100:.0f}% into the window) and the "
        f"no-duck threshold (< {NO_DUCK_DEPTH_DB:.1f} dB) — not enough evidence either way."
    )
    return "inconclusive", evidence


def check_pump(x: np.ndarray, sr: int, trigger_times_s: list[float]) -> dict:
    """Trigger-locked pump/duck verification.

    Aligns the low-band envelope to each trigger note (not a beat-period
    fold), then fits the fixed Volume-Shaper-shaped dip model (instant
    attack / hold / exponential release) to it by a coarse deterministic
    grid search. A confident fit at an early-trough shape is evidence a
    real duck is engaged; a late-trough (still-falling) shape or near-zero
    depth is the retriggered-decay negative control the `dynamics.pump`
    beat-fold heuristic cannot rule out.
    """
    aligned = trigger_aligned_envelope(x, sr, trigger_times_s, ENV_WINDOW_S, ENV_HOP_S)
    times = aligned["times"]
    env_db = aligned["env_db"]
    window_s = aligned["window_s"]
    if times.size == 0:
        raise ValueError("could not compute an envelope from the capture")

    tail_start = min(int(round(len(env_db) * (1.0 - TAIL_FRACTION))), len(env_db) - 1)
    tail_db = float(np.mean(env_db[tail_start:]))
    peak_db = float(np.max(env_db))
    peak_to_tail_db = peak_db - tail_db

    min_idx = int(np.argmin(env_db))
    min_time_s = float(times[min_idx])
    min_fraction = min_time_s / window_s if window_s > 0 else 0.0

    y_db = env_db - tail_db
    depth_db, hold_s, tau_s, r_squared = _fit_dip_model(times, y_db, window_s)

    verdict, evidence = _classify(depth_db, r_squared, min_fraction)

    notes: list[str] = []
    if peak_to_tail_db > HONEST_LIMIT_SPAN_DB:
        notes.append(
            f"peak-to-tail span is {peak_to_tail_db:.1f} dB (> {HONEST_LIMIT_SPAN_DB:.0f} dB) "
            "— this looks like a full-mix-like capture where the trigger source's own low "
            "end may dominate the envelope; the isolated ducked bus (the Sidechain track's "
            "own output) is the reliable capture point, not a tap that mixes the drums back in."
        )

    return {
        "window_ms": window_s * 1000.0,
        "used_triggers": aligned["used_triggers"],
        "envelope": {
            "peak_db": peak_db,
            "tail_db": tail_db,
            "peak_to_tail_db": peak_to_tail_db,
            "min_time_ms": min_time_s * 1000.0,
            "min_fraction": min_fraction,
        },
        "fitted": {
            "depth_db": depth_db,
            "hold_ms": hold_s * 1000.0,
            "release_tau_ms": tau_s * 1000.0,
            "r_squared": r_squared,
        },
        "verdict": verdict,
        "evidence": evidence,
        "notes": notes,
    }
