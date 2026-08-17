"""Stereo width and phase correlation."""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfiltfilt

LOW_BAND_HZ = 120.0
HIGH_BAND_HZ = 2000.0
BUTTER_ORDER = 4


def _rms(x: np.ndarray) -> float:
    if x.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(x))))


def _mid_side(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    left = x[:, 0]
    right = x[:, 1]
    mid = 0.5 * (left + right)
    side = 0.5 * (left - right)
    return mid, side


def _ratio_db(side: np.ndarray, mid: np.ndarray) -> float | None:
    mid_rms = _rms(mid)
    side_rms = _rms(side)
    if mid_rms == 0.0 and side_rms == 0.0:
        return None  # silence: undefined
    if mid_rms == 0.0:
        return float("inf")  # fully out-of-phase: all side, no mid
    if side_rms == 0.0:
        return float("-inf")  # perfectly mono-compatible (identical L=R)
    return 20.0 * np.log10(side_rms / mid_rms)


def width_db(x: np.ndarray) -> float | None:
    """Full-band Side/Mid RMS ratio in dB. Mono input -> None."""
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1 or x.shape[1] < 2:
        return None
    mid, side = _mid_side(x)
    return _ratio_db(side, mid)


def _band_filter(x: np.ndarray, sr: int, band: str) -> np.ndarray:
    nyq = sr / 2.0
    if band == "low":
        sos = butter(BUTTER_ORDER, LOW_BAND_HZ / nyq, btype="lowpass", output="sos")
    elif band == "mid":
        sos = butter(
            BUTTER_ORDER,
            [LOW_BAND_HZ / nyq, HIGH_BAND_HZ / nyq],
            btype="bandpass",
            output="sos",
        )
    elif band == "high":
        sos = butter(BUTTER_ORDER, HIGH_BAND_HZ / nyq, btype="highpass", output="sos")
    else:
        raise ValueError(f"unknown band: {band}")
    return sosfiltfilt(sos, x, axis=0)


def banded_width_db(x: np.ndarray, sr: int) -> dict:
    """Side/Mid RMS ratio in dB per band: <120 Hz, 120-2k, >2k."""
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1 or x.shape[1] < 2:
        return {"low": None, "mid": None, "high": None}
    out = {}
    for band in ("low", "mid", "high"):
        filtered = _band_filter(x, sr, band)
        mid, side = _mid_side(filtered)
        out[band] = _ratio_db(side, mid)
    return out


def _pearson(a: np.ndarray, b: np.ndarray) -> float:
    if a.size < 2:
        return 1.0
    a = a - np.mean(a)
    b = b - np.mean(b)
    denom = np.sqrt(np.sum(a * a) * np.sum(b * b))
    if denom == 0.0:
        return 1.0
    return float(np.sum(a * b) / denom)


def correlation(x: np.ndarray, sr: int) -> dict:
    """Pearson correlation of L,R: full band and low band (<120 Hz, 4th-order Butterworth).

    Mono files report correlation 1.0 (nothing to decorrelate).
    """
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1 or x.shape[1] < 2:
        return {"full": 1.0, "low": 1.0}

    left, right = x[:, 0], x[:, 1]
    full = _pearson(left, right)

    nyq = sr / 2.0
    sos = butter(BUTTER_ORDER, LOW_BAND_HZ / nyq, btype="lowpass", output="sos")
    left_lo = sosfiltfilt(sos, left)
    right_lo = sosfiltfilt(sos, right)
    low = _pearson(left_lo, right_lo)

    return {"full": full, "low": low}
