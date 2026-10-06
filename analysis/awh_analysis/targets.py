"""Genre/reference targets: measure a set of reference tracks, save/load,
and compare a new measurement against the saved target.
"""

from __future__ import annotations

import json
import os

import numpy as np

from . import audio, loudness, spectrum, stereo

BAND_FLAG_MIN_DELTA_DB = 3.0


def _stats(values: list[float]) -> dict:
    arr = np.asarray([v for v in values if np.isfinite(v)], dtype=np.float64)
    if arr.size == 0:
        return {"median": float("nan"), "iqr": float("nan")}
    median = float(np.median(arr))
    q75, q25 = np.percentile(arr, [75, 25])
    return {"median": median, "iqr": float(q75 - q25)}


def build_target(paths: list[str]) -> dict:
    """Measure a set of reference tracks into a genre target.

    Returns a dict with per-band median + IQR of the normalized third-octave
    spectrum, tilt/LUFS/PSR/width/low-correlation stats, and provenance.
    """
    if not paths:
        raise ValueError("build_target requires at least one reference file")

    per_track_bands: list[list[float]] = []
    freqs: list[float] | None = None
    tilts: list[float] = []
    lufs_list: list[float] = []
    psr_list: list[float] = []
    width_list: list[float] = []
    low_corr_list: list[float] = []

    for path in paths:
        x, sr = audio.load(path)
        bands = spectrum.third_octave_spectrum(x, sr)
        if freqs is None:
            freqs = bands["freqs"]
        per_track_bands.append(bands["db"])
        tilts.append(spectrum.spectral_tilt(bands))
        lufs_list.append(loudness.lufs_integrated(x, sr))
        psr_list.append(loudness.psr(x, sr)["min_psr_loud"])
        w = stereo.width_db(x)
        if w is not None and np.isfinite(w):
            width_list.append(w)
        corr = stereo.correlation(x, sr)
        low_corr_list.append(corr["low"])

    assert freqs is not None
    bands_arr = np.array(per_track_bands, dtype=np.float64)  # (n_tracks, n_bands)
    band_stats = []
    for i, f in enumerate(freqs):
        col = bands_arr[:, i]
        s = _stats(col.tolist())
        band_stats.append({"freq": f, "median_db": s["median"], "iqr_db": s["iqr"]})

    return {
        "bands": band_stats,
        "tilt": _stats(tilts),
        "lufs_integrated": _stats(lufs_list),
        "psr_min_loud": _stats(psr_list),
        "width_db": _stats(width_list),
        "low_band_correlation": _stats(low_corr_list),
        "sources": [os.path.basename(p) for p in paths],
    }


def save_target(target: dict, path: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w") as f:
        json.dump(target, f, indent=2)


def load_target(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


def compare_to_target(measurements: dict, target: dict) -> list[dict]:
    """Per-band deltas of `measurements['spectrum']` vs a saved target.

    Flags |delta| > max(3.0, band IQR).
    """
    spec = measurements.get("spectrum", {})
    freqs = spec.get("freqs", [])
    db = spec.get("db", [])
    target_bands = {b["freq"]: b for b in target.get("bands", [])}

    out = []
    for f, v in zip(freqs, db):
        tb = target_bands.get(f)
        if tb is None or not np.isfinite(v) or not np.isfinite(tb["median_db"]):
            continue
        delta = float(v) - float(tb["median_db"])
        iqr = float(tb["iqr_db"]) if np.isfinite(tb["iqr_db"]) else 0.0
        threshold = max(BAND_FLAG_MIN_DELTA_DB, iqr)
        out.append(
            {
                "freq": f,
                "delta_db": delta,
                "threshold_db": threshold,
                "flagged": abs(delta) > threshold,
            }
        )
    return out
