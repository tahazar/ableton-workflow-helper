"""Loudness measurements: LUFS-I, LUFS-S, true peak, PSR.

K-weighting follows BS.1770-4 as described in the design doc (pre-filter
high shelf +1.53 dB @ f_c 1681.97 Hz, RLB high-pass f_c 38.13 Hz) — this is
pyloudnorm's ``filter_class="DeMan"``, the ITU-coefficient-exact variant.
Integrated loudness uses pyloudnorm directly (400 ms blocks / 75% overlap,
absolute gate -70 LUFS, relative gate -10 LU). Short-term loudness and PSR
reuse the same K-weighting biquads via a small windowed-loudness helper so
all three measurements agree with pyloudnorm to well within tolerance.
"""

from __future__ import annotations

import numpy as np
import pyloudnorm as pyln
from scipy.signal import lfilter, resample_poly

_FILTER_CLASS = "DeMan"

# BS.1770 channel gains, ordered [L, R, C, Ls, Rs].
_CHANNEL_GAINS = [1.0, 1.0, 1.0, 1.41, 1.41]

TRUE_PEAK_OVERSAMPLE = 4
SHORT_TERM_WINDOW_S = 3.0
SHORT_TERM_HOP_S = 1.0
PSR_LOUD_WINDOW_LU = 3.0
PSR_ALERT_THRESHOLD = 8.0


def _meter(sr: int) -> pyln.Meter:
    return pyln.Meter(sr, filter_class=_FILTER_CLASS)


def lufs_integrated(x: np.ndarray, sr: int) -> float:
    """BS.1770-4 integrated (gated) loudness in LUFS."""
    meter = _meter(sr)
    return float(meter.integrated_loudness(np.asarray(x, dtype=np.float64)))


def _k_weight(x: np.ndarray, sr: int) -> np.ndarray:
    """Apply the K-weighting filter cascade to (n, ch) samples."""
    meter = _meter(sr)
    out = np.array(x, dtype=np.float64, copy=True)
    if out.ndim == 1:
        out = out.reshape(-1, 1)
    for filter_stage in meter._filters.values():
        b, a = filter_stage.b, filter_stage.a
        for ch in range(out.shape[1]):
            out[:, ch] = lfilter(b, a, out[:, ch])
    return out


def _channel_gains(n_channels: int) -> list[float]:
    return _CHANNEL_GAINS[:n_channels]


def _windowed_loudness(
    x_k: np.ndarray,
    sr: int,
    window_s: float,
    hop_s: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Ungated windowed loudness series (LUFS-S style) from K-weighted samples.

    Returns (times, values) where `times` is the window start time in
    seconds. If the signal is shorter than `window_s`, a single window
    spanning the whole signal is used (best effort on short files).
    """
    n = x_k.shape[0]
    gains = _channel_gains(x_k.shape[1])
    win_len = int(round(window_s * sr))
    hop_len = int(round(hop_s * sr))

    if n < win_len:
        starts = [0]
        win_len = n
    else:
        last_start = n - win_len
        starts = list(range(0, last_start + 1, hop_len))

    times = np.array([s / sr for s in starts], dtype=np.float64)
    values = np.empty(len(starts), dtype=np.float64)
    for i, s in enumerate(starts):
        block = x_k[s : s + win_len, :]
        z = np.mean(block**2, axis=0)  # per-channel mean square
        # BS.1770 defines gains for five channels; channels past the fifth
        # are dropped here (see the quality plan's cleanup list).
        weighted = sum(g * zi for g, zi in zip(gains, z, strict=False))
        with np.errstate(divide="ignore"):
            values[i] = -0.691 + 10.0 * np.log10(weighted) if weighted > 0 else -np.inf
    return times, values


def lufs_short_term(
    x: np.ndarray,
    sr: int,
    window_s: float = SHORT_TERM_WINDOW_S,
    hop_s: float = SHORT_TERM_HOP_S,
) -> tuple[np.ndarray, np.ndarray]:
    """Short-term loudness series: 3 s window / 1 s hop by default.

    Returns
    -------
    times : ndarray
        Window start times, seconds.
    values : ndarray
        LUFS-S per window (ungated).
    """
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = x.reshape(-1, 1)
    x_k = _k_weight(x, sr)
    return _windowed_loudness(x_k, sr, window_s, hop_s)


def _oversampled_abs(x: np.ndarray, factor: int) -> np.ndarray:
    """Polyphase-oversampled |x|, per channel, same relative time base."""
    up = resample_poly(x, factor, 1, axis=0)
    return np.abs(up)


def true_peak_db(x: np.ndarray, sr: int, oversample: int = TRUE_PEAK_OVERSAMPLE) -> float:
    """True peak in dBTP: >=4x polyphase-oversampled max abs over channels.

    Guaranteed to be >= the plain sample peak (guards against polyphase
    filter ringing under-reporting on pathological inputs).
    """
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = x.reshape(-1, 1)
    sample_peak = float(np.max(np.abs(x))) if x.size else 0.0
    oversampled_peak = float(np.max(_oversampled_abs(x, oversample))) if x.size else 0.0
    peak = max(sample_peak, oversampled_peak)
    if peak <= 0:
        return -np.inf
    return 20.0 * np.log10(peak)


def psr(x: np.ndarray, sr: int) -> dict:
    """Peak-to-short-term-loudness ratio per 3 s window.

    Returns
    -------
    dict with:
        min_psr_loud : float
            Min PSR over windows whose LUFS-S is within 3 LU of the max
            LUFS-S window ("loudest sections"). NaN if there are no windows.
        windows : list of {time, lufs_s, true_peak_db, psr}
    """
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = x.reshape(-1, 1)

    x_k = _k_weight(x, sr)
    times, lufs_s = _windowed_loudness(x_k, sr, SHORT_TERM_WINDOW_S, SHORT_TERM_HOP_S)

    win_len = int(round(SHORT_TERM_WINDOW_S * sr))
    win_len = min(win_len, x.shape[0]) or x.shape[0]

    windows = []
    for t, ls in zip(times, lufs_s, strict=True):
        s = int(round(t * sr))
        block = x[s : s + win_len, :]
        tp = true_peak_db(block, sr)
        p = tp - ls if np.isfinite(ls) else -np.inf
        windows.append(
            {
                "time": float(t),
                "lufs_s": float(ls),
                "true_peak_db": float(tp),
                "psr": float(p),
            }
        )

    if not windows:
        return {"min_psr_loud": float("nan"), "windows": []}

    finite_lufs = [w["lufs_s"] for w in windows if np.isfinite(w["lufs_s"])]
    if not finite_lufs:
        return {"min_psr_loud": float("nan"), "windows": windows}

    max_lufs_s = max(finite_lufs)
    loud = [
        w["psr"]
        for w in windows
        if np.isfinite(w["lufs_s"]) and (max_lufs_s - w["lufs_s"]) <= PSR_LOUD_WINDOW_LU
    ]
    min_psr_loud = min(loud) if loud else float("nan")

    return {"min_psr_loud": float(min_psr_loud), "windows": windows}
