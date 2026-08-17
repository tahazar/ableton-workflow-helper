"""Duck-envelope fitting: derive the ShaperBox Volume Shaper curve from the
drums themselves (owner request, M6 follow-up).

The premise (see knowledge/setup/sidechain-template.md): Volume Shaper
applies a FIXED user-drawn dip, retriggered by a MIDI Trigger track that
mirrors Kick & Snare. The "perfect" dip is therefore derivable: duck the
bass exactly while the drums' low band actually occupies the spectrum, and
be fully out of the way before the next trigger. We measure the drums'
trigger-aligned low-band energy envelope and emit breakpoints to draw.

All numbers are measured or parameterized — nothing is vibes. Depth is the
one genuinely taste-shaped parameter; with a bass capture we compute a
masking-based recommendation, otherwise we default and say so.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfiltfilt

from .audio import to_mono

LOW_BAND_HZ = 150.0
ENV_WINDOW_S = 0.005
ENV_HOP_S = 0.0025
BODY_END_REL_DB = -12.0  # kick "body" = within 12 dB of its low-band peak
DECAY_DONE_ABOVE_FLOOR_DB = 3.0
DEFAULT_DEPTH_DB = 6.0  # tutorial-lore musical range is 3-6 dB (see
# docs/research/shaperbox-preset-format.md); masking-based depth supersedes
MIN_DEPTH_DB = 3.0
MAX_DEPTH_DB = 24.0
KICK_OVER_BASS_MARGIN_DB = 6.0  # ducked bass sits >= this below the kick peak
RELEASE_HEADROOM = 0.85  # release fully done by this fraction of the gap
PEAK_ALIGN_MAX_FRACTION = 0.25  # low-band peak later than this into the window -> misaligned triggers
FLOOR_SILENCE_SUSPECT_DB = 90.0  # peak-over-floor beyond this -> floor is digital silence (live pathology read 174 dB)


def _low_band(x: np.ndarray, sr: int) -> np.ndarray:
    sos = butter(4, LOW_BAND_HZ / (sr / 2.0), btype="lowpass", output="sos")
    return sosfiltfilt(sos, to_mono(np.asarray(x, dtype=np.float64)))


def _rms_env(
    sig: np.ndarray, sr: int, window_s: float = ENV_WINDOW_S, hop_s: float = ENV_HOP_S
) -> tuple[np.ndarray, np.ndarray]:
    win = max(1, int(round(window_s * sr)))
    hop = max(1, int(round(hop_s * sr)))
    n = (len(sig) - win) // hop + 1
    if n <= 0:
        return np.array([]), np.array([])
    idx = np.arange(n)[:, None] * hop + np.arange(win)[None, :]
    frames = sig[idx]
    rms = np.sqrt(np.mean(frames**2, axis=1))
    times = np.arange(n) * hop / sr
    return times, rms


def trigger_aligned_envelope(
    x: np.ndarray,
    sr: int,
    trigger_times_s: list[float],
    env_window_s: float = ENV_WINDOW_S,
    env_hop_s: float = ENV_HOP_S,
) -> dict:
    """Average low-band RMS envelope aligned at each trigger, over a window
    of the (robust) minimum inter-trigger gap."""
    triggers = np.sort(np.asarray(trigger_times_s, dtype=np.float64))
    if triggers.size < 2:
        raise ValueError("need at least 2 trigger times to establish a window")
    gaps = np.diff(triggers)
    window_s = float(np.percentile(gaps, 10))
    if window_s <= ENV_WINDOW_S * 4:
        raise ValueError(f"trigger gap too small to analyze ({window_s * 1000:.1f} ms)")

    low = _low_band(x, sr)
    duration_s = len(low) / sr
    win_samples = int(round(window_s * sr))

    segments = []
    for t in triggers:
        start = int(round(t * sr))
        if t + window_s <= duration_s and start >= 0:
            segments.append(low[start : start + win_samples])
    if not segments:
        raise ValueError("no trigger window fits inside the audio — check trigger times")

    stacked = np.stack([s[: min(len(s) for s in segments)] for s in segments])
    mean_power_signal = np.sqrt(np.mean(stacked**2, axis=0))
    times, rms = _rms_env(mean_power_signal, sr, env_window_s, env_hop_s)
    env_db = 20.0 * np.log10(np.maximum(rms, 1e-9))
    return {
        "window_s": window_s,
        "used_triggers": len(segments),
        "times": times,
        "env_db": env_db,
    }


def fit_duck_envelope(
    x: np.ndarray,
    sr: int,
    trigger_times_s: list[float],
    bass: np.ndarray | None = None,
    bass_sr: int | None = None,
    depth_db: float | None = None,
) -> dict:
    """Measure the drums' trigger-aligned low-band envelope and derive the
    recommended fixed duck shape (attack 0 / hold / exponential release)."""
    aligned = trigger_aligned_envelope(x, sr, trigger_times_s)
    times, env_db = aligned["times"], aligned["env_db"]
    window_s = aligned["window_s"]

    peak_idx = int(np.argmax(env_db))
    peak_db = float(env_db[peak_idx])
    tail_start = int(len(env_db) * 0.85)
    floor_db = float(np.median(env_db[tail_start:])) if tail_start < len(env_db) else peak_db - 40.0

    # hold: contiguous run from the peak where the low band stays "body"-loud
    body_threshold = peak_db + BODY_END_REL_DB
    hold_end_idx = peak_idx
    for i in range(peak_idx, len(env_db)):
        if env_db[i] >= body_threshold:
            hold_end_idx = i
        else:
            break
    hold_end_s = float(times[hold_end_idx])

    # decay done: low band has rejoined the between-hits floor
    decay_done_s = window_s
    for i in range(hold_end_idx, len(env_db)):
        if env_db[i] <= floor_db + DECAY_DONE_ABOVE_FLOOR_DB:
            decay_done_s = float(times[i])
            break

    # depth: masking-based when a bass capture is given (same-session levels!)
    depth_source = "parameter"
    if depth_db is None:
        if bass is not None and bass_sr is not None:
            bass_low = _low_band(bass, bass_sr)
            bass_low_db = float(20.0 * np.log10(max(np.sqrt(np.mean(bass_low**2)), 1e-9)))
            needed = bass_low_db - (peak_db - KICK_OVER_BASS_MARGIN_DB)
            depth_db = float(np.clip(needed, MIN_DEPTH_DB, MAX_DEPTH_DB))
            depth_source = (
                f"masking: bass low-band RMS {bass_low_db:.1f} dB vs kick peak "
                f"{peak_db:.1f} dB, margin {KICK_OVER_BASS_MARGIN_DB:.0f} dB"
            )
        else:
            depth_db = DEFAULT_DEPTH_DB
            depth_source = (
                "default (no bass capture given; 3-6 dB is the musical convention, "
                "go deeper for a stylized pump)"
            )

    # --- sanity checks: does the trigger list plausibly match real hits? --
    # Live finding: wrong/guessed trigger times still produce a plausible-
    # LOOKING envelope (peak mid-window, absurd peak-over-floor) with nothing
    # flagging it. A trigger-locked duck's low-band peak must sit near the
    # window start; a floor 60+ dB down means the "floor" is digital silence.
    warnings: list[str] = []
    peak_time_s = float(times[peak_idx])
    if peak_time_s > PEAK_ALIGN_MAX_FRACTION * window_s:
        warnings.append(
            f"low-band peak lands {peak_time_s * 1000:.0f} ms into the "
            f"{window_s * 1000:.0f} ms trigger window (expected near 0 ms for "
            "trigger-locked hits) — the trigger times probably do NOT match the "
            "real drum hits. Check the Trigger clip against the capture, or "
            "derive triggers with `awh drums detect-onsets`."
        )
    if peak_db - floor_db > FLOOR_SILENCE_SUSPECT_DB:
        warnings.append(
            f"peak-over-floor is {peak_db - floor_db:.0f} dB — the between-hit "
            "floor is near digital silence, which usually means misaligned "
            "triggers or a capture that doesn't contain the drums."
        )

    release_end_s = float(min(max(decay_done_s * 1.1, hold_end_s + 0.02), window_s * RELEASE_HEADROOM))

    # breakpoints: instant dip, hold, exponential release sampled for drawing
    def frac(t: float) -> float:
        return t / window_s

    points = [
        {"ms": 0.0, "frac": 0.0, "gain_db": -depth_db, "curve": "sharp-corner"},
        {
            "ms": hold_end_s * 1000.0,
            "frac": frac(hold_end_s),
            "gain_db": -depth_db,
            "curve": "sharp-corner",
        },
    ]
    n_release = 5
    for k in range(1, n_release + 1):
        t = hold_end_s + (release_end_s - hold_end_s) * k / n_release
        # exponential recovery: fast at first in dB terms mirrors a natural tail
        g = -depth_db * float(np.exp(-3.0 * k / n_release))
        points.append(
            {"ms": t * 1000.0, "frac": frac(t), "gain_db": round(g, 2), "curve": "smooth"}
        )
    points.append({"ms": window_s * 1000.0, "frac": 1.0, "gain_db": 0.0, "curve": "smooth"})

    return {
        "window_s": window_s,
        "window_ms": window_s * 1000.0,
        "used_triggers": aligned["used_triggers"],
        "warnings": warnings,
        "kick": {
            "low_band_hz": LOW_BAND_HZ,
            "peak_time_ms": float(times[peak_idx]) * 1000.0,
            "peak_over_floor_db": peak_db - floor_db,
            "body_end_ms": hold_end_s * 1000.0,
            "decay_done_ms": decay_done_s * 1000.0,
        },
        "recommendation": {
            "depth_db": float(depth_db),
            "depth_source": depth_source,
            "attack_ms": 0.0,
            "hold_ms": hold_end_s * 1000.0,
            "release_ms": (release_end_s - hold_end_s) * 1000.0,
            "release_curve": "exponential",
            "fully_recovered_by_ms": release_end_s * 1000.0,
            "points": points,
        },
    }


def measure_duck_depth(
    x: np.ndarray, sr: int, trigger_times_s: list[float]
) -> dict:
    """Measure the ACHIEVED duck on a bass/sidechain-bus capture: the
    peak-to-trough span of the trigger-aligned low-band envelope. Used by
    the calibration loop (compressor strategy) and for verifying a drawn
    ShaperBox curve. On un-ducked sustained material this reads near 0.

    Uses a 25 ms envelope window: long enough to average out sub-bass
    carrier ripple (a 5 ms window beats against a 50 Hz cycle), short
    enough to resolve any real duck (>= ~70 ms in practice)."""
    aligned = trigger_aligned_envelope(x, sr, trigger_times_s, 0.025, 0.005)
    env_db = aligned["env_db"]
    times = aligned["times"]
    finite = np.isfinite(env_db)
    if not finite.any():
        raise ValueError("could not compute an envelope from the capture")
    trough_idx = int(np.nanargmin(env_db))
    return {
        "depth_db": float(np.nanmax(env_db) - np.nanmin(env_db)),
        "trough_ms": float(times[trough_idx]) * 1000.0,
        "window_ms": aligned["window_s"] * 1000.0,
        "used_triggers": aligned["used_triggers"],
    }


def detect_onsets(
    x: np.ndarray, sr: int, min_gap_s: float = 0.08, threshold_mads: float = 3.0
) -> list[float]:
    """Broadband onset times (seconds) from a drums capture — for deriving
    REAL trigger positions when Kick/Snare are audio one-shots and no MIDI
    Trigger clip exists (live finding: guessing trigger times silently
    produces nonsense duck fits).

    Spectral-flux envelope (shared with ref.py), thresholded at
    median + `threshold_mads`·MAD, local-maximum picked with a `min_gap_s`
    refractory gap. Deterministic.
    """
    from .ref import onset_and_subband

    onset_env, _sub, hop_s = onset_and_subband(to_mono(np.asarray(x, dtype=np.float64)), sr)
    if onset_env.size < 3:
        raise ValueError("audio too short for onset detection")
    median = float(np.median(onset_env))
    mad = float(np.median(np.abs(onset_env - median))) or 1e-12
    # MAD threshold catches statistical outliers; the relative floor keeps
    # noise wiggles out — duck triggers are the LOUD hits by definition.
    threshold = max(median + threshold_mads * mad, 0.1 * float(np.max(onset_env)))

    min_gap_frames = max(1, int(round(min_gap_s / hop_s)))
    onsets: list[float] = []
    last = -min_gap_frames
    for i in range(1, len(onset_env) - 1):
        if (
            onset_env[i] >= threshold
            and onset_env[i] >= onset_env[i - 1]
            and onset_env[i] >= onset_env[i + 1]
            and i - last >= min_gap_frames
        ):
            onsets.append(float(i * hop_s))
            last = i
    return onsets
