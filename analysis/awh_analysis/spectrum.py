"""Third-octave spectrum and spectral tilt.

Third-octave bands follow IEC 61260 base-10 centers (25 Hz-20 kHz), power
integrated from a Welch PSD (4096-point FFT, Hann window, 50% overlap) on
the mono downmix, and normalized so the mean level across 100 Hz-4 kHz is
0 dB (so absolute level cancels and only shape remains).
"""

from __future__ import annotations

import numpy as np
from scipy.signal import welch

from .audio import to_mono

WELCH_NFFT = 4096
TILT_BAND_LO = 100.0
TILT_BAND_HI = 4000.0

# IEC 61260 base-10 third-octave band indices spanning ~25 Hz-20 kHz.
_BAND_INDICES = range(-16, 14)  # 30 bands


def _band_centers() -> np.ndarray:
    """Exact IEC base-10 third-octave centers, Hz."""
    return np.array([1000.0 * 10.0 ** (i / 10.0) for i in _BAND_INDICES])


def _band_edges(center: float) -> tuple[float, float]:
    """Third-octave band edges (base-10) around a center frequency."""
    lo = center * 10.0 ** (-1.0 / 20.0)
    hi = center * 10.0 ** (1.0 / 20.0)
    return lo, hi


def band_power(freqs: np.ndarray, psd: np.ndarray, lo: float, hi: float) -> float:
    """Integrate PSD (power/Hz) over [lo, hi] -> power.

    Public (reused by bands.py's calibrated narrowband levels — same Welch
    machinery, different band set/purpose; see docs/design/analysis-engine
    .md's 2026-08-23 gap report on time-smeared one-FFT band energy).
    """
    mask = (freqs >= lo) & (freqs <= hi)
    f_sel = freqs[mask]
    p_sel = psd[mask]

    lo_val = np.interp(lo, freqs, psd)
    hi_val = np.interp(hi, freqs, psd)
    f_sel = np.concatenate(([lo], f_sel, [hi]))
    p_sel = np.concatenate(([lo_val], p_sel, [hi_val]))
    # de-duplicate/sort in case lo or hi coincided with an existing bin
    order = np.argsort(f_sel)
    f_sel = f_sel[order]
    p_sel = p_sel[order]
    f_sel, unique_idx = np.unique(f_sel, return_index=True)
    p_sel = p_sel[unique_idx]

    if f_sel.size < 2:
        return 0.0
    return float(np.trapezoid(p_sel, f_sel))


def welch_psd(mono: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray] | None:
    """Welch PSD (4096-pt FFT, Hann, 50% overlap) of a mono signal.

    Returns `(freqs, psd)`, or None if the signal is too short to produce a
    meaningful periodogram (degenerate case, same threshold as
    `third_octave_spectrum`). Public: bands.py reuses this exact machinery
    so its calibrated per-band levels use the same time-averaged,
    non-time-smeared periodogram as the third-octave spectrum above.
    """
    nperseg = min(WELCH_NFFT, mono.shape[0])
    if nperseg < 8:
        return None
    noverlap = nperseg // 2
    freqs, psd = welch(
        mono,
        fs=sr,
        window="hann",
        nperseg=nperseg,
        noverlap=noverlap,
        nfft=max(WELCH_NFFT, nperseg),
        scaling="density",
        # scipy documents False (no detrending); its stubs only allow str.
        detrend=False,  # pyright: ignore[reportArgumentType]
    )
    return freqs, psd


def third_octave_spectrum(x: np.ndarray, sr: int) -> dict:
    """Third-octave band spectrum, normalized to 0 dB mean over 100 Hz-4 kHz.

    Returns
    -------
    dict with:
        freqs : list of band center frequencies, Hz
        db : list of band levels, dB (relative)
    """
    mono = to_mono(np.asarray(x, dtype=np.float64))
    centers = _band_centers()
    psd_result = welch_psd(mono, sr)
    if psd_result is None:
        # Degenerate (extremely short) signal: nothing meaningful to report.
        return {"freqs": centers.tolist(), "db": [float("nan")] * len(centers)}
    freqs, psd = psd_result

    db = np.empty_like(centers)
    for i, c in enumerate(centers):
        lo, hi = _band_edges(c)
        lo = max(lo, freqs[0])
        hi = min(hi, freqs[-1])
        power = band_power(freqs, psd, lo, hi) if hi > lo else 0.0
        with np.errstate(divide="ignore"):
            db[i] = 10.0 * np.log10(power) if power > 0 else -np.inf

    norm_mask = (centers >= TILT_BAND_LO) & (centers <= TILT_BAND_HI)
    finite_norm = np.isfinite(db) & norm_mask
    if finite_norm.any():
        offset = np.mean(db[finite_norm])
        db_finite = np.isfinite(db)
        db = np.where(db_finite, db - offset, db)

    return {"freqs": centers.tolist(), "db": db.tolist()}


def spectral_tilt(bands: dict, lo: float = TILT_BAND_LO, hi: float = TILT_BAND_HI) -> float:
    """Linear fit of band dB vs log2(f) over [lo, hi] Hz -> dB/octave."""
    freqs = np.asarray(bands["freqs"], dtype=np.float64)
    db = np.asarray(bands["db"], dtype=np.float64)
    mask = (freqs >= lo) & (freqs <= hi) & np.isfinite(db)
    if mask.sum() < 2:
        return float("nan")
    log2f = np.log2(freqs[mask])
    slope, _intercept = np.polyfit(log2f, db[mask], 1)
    return float(slope)
