"""A/B comparison: loudness-matched diff between two renders."""

from __future__ import annotations

import os
from typing import Any

import numpy as np

from . import audio, dynamics, loudness, spectrum, stereo

BAND_CHANGE_FLAG_DB = 3.0


def _gain_match(x: np.ndarray, sr: int, target_lufs: float) -> tuple[np.ndarray, float]:
    current = loudness.lufs_integrated(x, sr)
    gain_db = target_lufs - current
    gain_lin = 10.0 ** (gain_db / 20.0)
    return x * gain_lin, gain_db


def _measure(x: np.ndarray, sr: int) -> dict:
    bands = spectrum.third_octave_spectrum(x, sr)
    return {
        "lufs_integrated": loudness.lufs_integrated(x, sr),
        "true_peak_db": loudness.true_peak_db(x, sr),
        "psr_min_loud": loudness.psr(x, sr)["min_psr_loud"],
        "spectrum": bands,
        "tilt_db_per_oct": spectrum.spectral_tilt(bands),
        "width_db": stereo.width_db(x),
        "correlation": stereo.correlation(x, sr),
    }


def ab_compare(path_a: str, path_b: str, bpm: float | None = None) -> dict:
    """Loudness-matched A/B diff: gain-match both to the quieter LUFS-I,
    then diff third-octave bands, LUFS/PSR/dBTP, width, low-band
    correlation, and (with `bpm`) pump.
    """
    x_a, sr_a = audio.load(path_a)
    x_b, sr_b = audio.load(path_b)

    lufs_a = loudness.lufs_integrated(x_a, sr_a)
    lufs_b = loudness.lufs_integrated(x_b, sr_b)
    target_lufs = min(lufs_a, lufs_b)

    x_a_m, gain_a = _gain_match(x_a, sr_a, target_lufs)
    x_b_m, gain_b = _gain_match(x_b, sr_b, target_lufs)

    meas_a = _measure(x_a_m, sr_a)
    meas_b = _measure(x_b_m, sr_b)

    freqs = meas_a["spectrum"]["freqs"]
    db_a = np.asarray(meas_a["spectrum"]["db"])
    db_b = np.asarray(meas_b["spectrum"]["db"])
    band_delta = (db_b - db_a).tolist()

    corr_a = meas_a["correlation"]
    corr_b = meas_b["correlation"]

    width_a = meas_a["width_db"]
    width_b = meas_b["width_db"]
    width_delta = (
        width_b - width_a
        if width_a is not None
        and width_b is not None
        and np.isfinite(width_a)
        and np.isfinite(width_b)
        else None
    )

    result: dict[str, Any] = {
        "file_a": os.path.basename(path_a),
        "file_b": os.path.basename(path_b),
        "lufs_matched_to": target_lufs,
        "gain_applied_db": {"a": gain_a, "b": gain_b},
        "deltas": {
            "lufs_integrated": meas_b["lufs_integrated"] - meas_a["lufs_integrated"],
            "true_peak_db": meas_b["true_peak_db"] - meas_a["true_peak_db"],
            "psr_min_loud": meas_b["psr_min_loud"] - meas_a["psr_min_loud"],
            "tilt_db_per_oct": meas_b["tilt_db_per_oct"] - meas_a["tilt_db_per_oct"],
            "width_db": width_delta,
            "correlation_low": corr_b["low"] - corr_a["low"],
        },
        "spectrum": {"freqs": freqs, "delta_db": band_delta},
        "changed_findings": [],
    }

    for f, d in zip(freqs, band_delta, strict=True):
        if np.isfinite(d) and abs(d) > BAND_CHANGE_FLAG_DB:
            result["changed_findings"].append(
                {
                    "id": f"band_change_{int(round(f))}hz",
                    "severity": "warn",
                    "metric": f"spectrum[{f:.0f}Hz]",
                    "value": d,
                    "threshold": BAND_CHANGE_FLAG_DB,
                    "explanation": f"{f:.0f} Hz band changed {d:+.1f} dB from A to B "
                    f"(loudness-matched).",
                    "suggestion": "Confirm this band change is intentional; it's larger "
                    "than typical run-to-run variance.",
                }
            )

    if abs(result["deltas"]["tilt_db_per_oct"]) > 1.0:
        result["changed_findings"].append(
            {
                "id": "tilt_change",
                "severity": "info",
                "metric": "tilt_db_per_oct",
                "value": result["deltas"]["tilt_db_per_oct"],
                "threshold": 1.0,
                "explanation": f"Spectral tilt changed {result['deltas']['tilt_db_per_oct']:+.1f} "
                f"dB/oct from A to B.",
                "suggestion": "Check master EQ/bus processing differences between the two renders.",
            }
        )

    if bpm:
        pump_a = dynamics.pump(x_a_m, sr_a, bpm)
        pump_b = dynamics.pump(x_b_m, sr_b, bpm)
        result["pump"] = {"a": pump_a, "b": pump_b}
        for band_key in ("full", "low"):
            depth_a = pump_a[band_key]["depth_db"]
            depth_b = pump_b[band_key]["depth_db"]
            if np.isfinite(depth_a) and np.isfinite(depth_b) and abs(depth_b - depth_a) > 1.0:
                result["changed_findings"].append(
                    {
                        "id": f"pump_change_{band_key}",
                        "severity": "info",
                        "metric": f"pump.{band_key}.depth_db",
                        "value": depth_b - depth_a,
                        "threshold": 1.0,
                        "explanation": f"Sidechain pump depth ({band_key}) changed "
                        f"{depth_b - depth_a:+.1f} dB from A to B.",
                        "suggestion": "Compare sidechain compressor/LFO settings between renders.",
                    }
                )

    result["changed_findings"].sort(
        key=lambda f: {"alert": 0, "warn": 1, "info": 2}.get(f["severity"], 3)
    )
    return result
