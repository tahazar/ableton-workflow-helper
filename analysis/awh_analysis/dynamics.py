"""Waveform asymmetry, phase-rotation headroom, and sidechain pump analysis."""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, lfilter, sosfiltfilt
from scipy.stats import skew as _skew

from .audio import to_mono
from .loudness import true_peak_db

ASYMMETRY_PERCENTILE = 99.9

PHASE_ROTATION_POLES = (2, 4, 6)
PHASE_ROTATION_F0S = (100.0, 150.0, 200.0, 300.0, 400.0)
_SETTLE_S = 0.05  # discard this much from the start when measuring peaks

PUMP_WINDOW_S = 0.010
PUMP_HOP_S = 0.005
PUMP_LOW_BAND_HZ = 120.0


def asymmetry(x: np.ndarray) -> list[dict]:
    """Per-channel waveform asymmetry: peak ratio (dB) + sample skewness.

    ratio_db = 20*log10(pos_peak / |neg_peak|) using the 99.9th percentile
    of the signal (and of its negation) to resist single-sample spikes.
    """
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = x.reshape(-1, 1)

    out = []
    for ch in range(x.shape[1]):
        sig = x[:, ch]
        pos_peak = np.percentile(sig, ASYMMETRY_PERCENTILE)
        neg_peak = np.percentile(-sig, ASYMMETRY_PERCENTILE)  # positive magnitude
        if pos_peak <= 0 or neg_peak <= 0:
            ratio_db = 0.0
        else:
            ratio_db = float(20.0 * np.log10(pos_peak / neg_peak))
        sk = float(_skew(sig)) if sig.size > 2 else 0.0
        out.append({"ratio_db": ratio_db, "skewness": sk})
    return out


def _allpass_coeffs(f0: float, sr: int) -> tuple[np.ndarray, np.ndarray]:
    """First-order digital all-pass, bilinear transform of the analog
    all-pass H(s) = (w0 - s) / (w0 + s) at cutoff f0.
    """
    theta = np.pi * f0 / sr
    tan_theta = np.tan(theta)
    a = (tan_theta - 1.0) / (tan_theta + 1.0)
    b = np.array([a, 1.0])
    a_coef = np.array([1.0, a])
    return b, a_coef


def phase_rotation_headroom(
    x: np.ndarray,
    sr: int,
    poles_set: tuple[int, ...] = PHASE_ROTATION_POLES,
    f0_set: tuple[float, ...] = PHASE_ROTATION_F0S,
) -> dict:
    """Sweep all-pass cascades and report the best true-peak reduction.

    All-pass filters preserve RMS/magnitude spectrum by construction, so no
    gain renormalization is applied — the reported reduction is a direct
    true-peak comparison at unchanged loudness.
    """
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = x.reshape(-1, 1)

    n = x.shape[0]
    skip = int(round(min(_SETTLE_S, (n / sr) / 4.0) * sr)) if n > 0 else 0
    baseline_tp = true_peak_db(x[skip:], sr)

    best_reduction = -np.inf
    best_f0 = f0_set[0]
    best_poles = poles_set[0]

    for poles in poles_set:
        for f0 in f0_set:
            b, a = _allpass_coeffs(f0, sr)
            y = np.empty_like(x)
            for ch in range(x.shape[1]):
                sig = x[:, ch]
                for _ in range(poles):
                    sig = lfilter(b, a, sig)
                y[:, ch] = sig
            processed_tp = true_peak_db(y[skip:], sr)
            reduction = baseline_tp - processed_tp
            if reduction > best_reduction:
                best_reduction = reduction
                best_f0 = f0
                best_poles = poles

    return {
        "best_db": float(best_reduction),
        "f0": float(best_f0),
        "poles": int(best_poles),
    }


def _rms_envelope(
    sig: np.ndarray, sr: int, window_s: float, hop_s: float
) -> tuple[np.ndarray, np.ndarray]:
    """Windowed RMS envelope (linear). Returns (center_times_s, rms_values)."""
    n = sig.shape[0]
    win_len = max(1, int(round(window_s * sr)))
    hop_len = max(1, int(round(hop_s * sr)))
    if n < win_len:
        return np.array([]), np.array([])
    starts = np.arange(0, n - win_len + 1, hop_len)
    values = np.empty(len(starts), dtype=np.float64)
    for i, s in enumerate(starts):
        block = sig[s : s + win_len]
        values[i] = np.sqrt(np.mean(block**2))
    times = starts / sr  # window start time
    return times, values


def _fold(
    times: np.ndarray, values: np.ndarray, period_s: float, hop_s: float
) -> tuple[np.ndarray, np.ndarray]:
    """Fold a (times, linear-values) series modulo `period_s`, averaging
    (linearly) all samples landing in each phase bin. Bin width ~= hop_s.
    """
    n_bins = max(1, int(round(period_s / hop_s)))
    bin_width = period_s / n_bins
    phases = np.mod(times, period_s)
    bin_idx = np.minimum((phases / bin_width).astype(int), n_bins - 1)

    sums = np.zeros(n_bins)
    counts = np.zeros(n_bins)
    np.add.at(sums, bin_idx, values)
    np.add.at(counts, bin_idx, 1)

    folded = np.full(n_bins, np.nan)
    has_data = counts > 0
    folded[has_data] = sums[has_data] / counts[has_data]
    bin_centers = (np.arange(n_bins) + 0.5) * bin_width
    return bin_centers, folded


def _pump_band(sig: np.ndarray, sr: int, bpm: float) -> dict:
    period_s = 60.0 / bpm
    times, rms = _rms_envelope(sig, sr, PUMP_WINDOW_S, PUMP_HOP_S)
    if times.size == 0:
        return {
            "depth_db": float("nan"),
            "recovery_time_s": None,
            "trough_offset_ms": float("nan"),
            "trough_time_s": float("nan"),
        }

    bin_centers, folded_lin = _fold(times, rms, period_s, PUMP_HOP_S)
    valid = np.isfinite(folded_lin) & (folded_lin > 0)
    if not valid.any():
        return {
            "depth_db": float("nan"),
            "recovery_time_s": None,
            "trough_offset_ms": float("nan"),
            "trough_time_s": float("nan"),
        }

    floor = np.min(folded_lin[valid]) * 1e-6 if np.min(folded_lin[valid]) > 0 else 1e-12
    safe_lin = np.where(valid, folded_lin, floor)
    safe_lin = np.maximum(safe_lin, floor if floor > 0 else 1e-12)
    folded_db = 20.0 * np.log10(np.maximum(safe_lin, 1e-12))
    folded_db = np.where(valid, folded_db, np.nan)

    n_bins = len(bin_centers)
    trough_idx = int(np.nanargmin(folded_db))
    peak_db = float(np.nanmax(folded_db))
    trough_db = float(folded_db[trough_idx])
    depth_db = peak_db - trough_db

    trough_time = float(bin_centers[trough_idx])
    half_period = period_s / 2.0
    offset_s = trough_time if trough_time <= half_period else trough_time - period_s
    trough_offset_ms = offset_s * 1000.0

    threshold_db = trough_db + 0.9 * depth_db
    recovery_time_s = None
    for step in range(1, n_bins + 1):
        idx = (trough_idx + step) % n_bins
        val = folded_db[idx]
        if np.isfinite(val) and val >= threshold_db:
            recovery_time_s = float(step * (period_s / n_bins))
            break

    return {
        "depth_db": float(depth_db),
        "recovery_time_s": recovery_time_s,
        "trough_offset_ms": float(trough_offset_ms),
        "trough_time_s": trough_time,
    }


def pump(x: np.ndarray, sr: int, bpm: float) -> dict:
    """Sidechain pump analysis: RMS envelope folded modulo the beat period.

    Requires `bpm`. Reports full-band and <120 Hz-band pump depth, recovery
    time to 90%, and trough offset (ms) from the beat grid.
    """
    if not bpm or bpm <= 0:
        raise ValueError("pump() requires a positive bpm")

    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = x.reshape(-1, 1)
    mono = to_mono(x)

    nyq = sr / 2.0
    sos = butter(4, PUMP_LOW_BAND_HZ / nyq, btype="lowpass", output="sos")
    low = sosfiltfilt(sos, mono)

    return {
        "beat_period_s": 60.0 / bpm,
        "full": _pump_band(mono, sr, bpm),
        "low": _pump_band(low, sr, bpm),
    }
