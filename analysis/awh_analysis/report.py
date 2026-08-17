"""Top-level `analyze` (measurements) and `findings` (the explainable layer)."""

from __future__ import annotations

import os
from typing import Any

import numpy as np

from . import audio, dynamics, loudness, spectrum, stereo, targets

HEALTHY_TILT_DB_PER_OCT = -5.0
TILT_FLAG_DEVIATION = 1.5

PSR_ALERT_THRESHOLD = loudness.PSR_ALERT_THRESHOLD
LOW_CORR_WARN_THRESHOLD = 0.8

ASYMMETRY_FLAG_DB = 3.0
PHASE_ROTATION_MIN_HEADROOM_DB = 1.0

PUMP_MISALIGN_WARN_MS = 20.0

DBTP_DELIVERY_MAX = -1.0

DELIVERY_PRESETS = {
    "club": {"lufs_lo": -8.0, "lufs_hi": -6.0, "dbtp_max": DBTP_DELIVERY_MAX},
    "streaming": {"lufs_target": -14.0, "lufs_tolerance": 1.0, "dbtp_max": DBTP_DELIVERY_MAX},
    "apple": {"lufs_target": -16.0, "lufs_tolerance": 1.0, "dbtp_max": DBTP_DELIVERY_MAX},
}

_SEVERITY_RANK = {"alert": 0, "warn": 1, "info": 2}


def analyze(
    path: str,
    bpm: float | None = None,
    target: dict | None = None,
    start_s: float | None = None,
    end_s: float | None = None,
) -> dict:
    """Run the full measurement suite on an audio file.

    Returns a JSON-serializable dict of measurements. See package README /
    design doc for field definitions.
    """
    x, sr = audio.load(path, start_s=start_s, end_s=end_s)
    n_channels = x.shape[1]
    duration_s = x.shape[0] / sr

    lufs_i = loudness.lufs_integrated(x, sr)
    st_times, st_values = loudness.lufs_short_term(x, sr)
    tp_db = loudness.true_peak_db(x, sr)
    psr_result = loudness.psr(x, sr)

    bands = spectrum.third_octave_spectrum(x, sr)
    tilt = spectrum.spectral_tilt(bands)

    width = stereo.width_db(x)
    banded_width = stereo.banded_width_db(x, sr)
    corr = stereo.correlation(x, sr)

    asym = dynamics.asymmetry(x)
    rotation = dynamics.phase_rotation_headroom(x, sr)
    pump_result = dynamics.pump(x, sr, bpm) if bpm else None

    measurements: dict[str, Any] = {
        "file": os.path.basename(path),
        "samplerate": sr,
        "channels": n_channels,
        "duration_s": duration_s,
        "bpm": bpm,
        "loudness": {
            "lufs_integrated": lufs_i,
            "lufs_short_term": {"times": st_times.tolist(), "values": st_values.tolist()},
            "true_peak_db": tp_db,
            "psr": psr_result,
        },
        "spectrum": {
            "freqs": bands["freqs"],
            "db": bands["db"],
            "tilt_db_per_oct": tilt,
        },
        "stereo": {
            "width_db": width,
            "banded_width_db": banded_width,
            "correlation": corr,
        },
        "dynamics": {
            "asymmetry": asym,
            "phase_rotation_headroom": rotation,
            "pump": pump_result,
        },
    }

    if target is not None:
        measurements["target_comparison"] = targets.compare_to_target(measurements, target)
        measurements["target_sources"] = target.get("sources", [])
    else:
        measurements["target_comparison"] = None
        measurements["target_sources"] = None

    return measurements


def _finding(
    id_: str,
    severity: str,
    metric: str,
    value: Any,
    threshold: Any,
    explanation: str,
    suggestion: str,
) -> dict:
    return {
        "id": id_,
        "severity": severity,
        "metric": metric,
        "value": value,
        "threshold": threshold,
        "explanation": explanation,
        "suggestion": suggestion,
    }


def _delivery_findings(measurements: dict, delivery: str) -> list[dict]:
    preset = DELIVERY_PRESETS.get(delivery)
    if preset is None:
        return []

    out = []
    lufs_i = measurements["loudness"]["lufs_integrated"]
    tp_db = measurements["loudness"]["true_peak_db"]

    if "lufs_lo" in preset:
        lo, hi = preset["lufs_lo"], preset["lufs_hi"]
        if lufs_i < lo or lufs_i > hi:
            delta = lufs_i - hi if lufs_i > hi else lufs_i - lo
            out.append(
                _finding(
                    "delivery_lufs",
                    "warn",
                    "lufs_integrated",
                    lufs_i,
                    f"{lo}..{hi}",
                    f"{delivery} targets {lo}..{hi} LUFS-I; measured {lufs_i:.1f} LUFS-I "
                    f"({delta:+.1f} LU outside the target range).",
                    "Adjust the master limiter's output ceiling / input gain to land the "
                    "integrated loudness inside the target range.",
                )
            )
    else:
        target_lufs = preset["lufs_target"]
        tol = preset["lufs_tolerance"]
        delta = lufs_i - target_lufs
        if abs(delta) > tol:
            out.append(
                _finding(
                    "delivery_lufs",
                    "warn",
                    "lufs_integrated",
                    lufs_i,
                    target_lufs,
                    f"{delivery} targets {target_lufs:.0f} LUFS-I (±{tol:.0f}); measured "
                    f"{lufs_i:.1f} LUFS-I ({delta:+.1f} LU off target).",
                    "Turn the master gain/limiter input up or down to hit the delivery "
                    "target; streaming services normalize anyway, so avoid over-limiting "
                    "to chase loudness.",
                )
            )

    dbtp_max = preset["dbtp_max"]
    if tp_db > dbtp_max:
        out.append(
            _finding(
                "delivery_dbtp",
                "alert",
                "true_peak_db",
                tp_db,
                dbtp_max,
                f"{delivery} requires true peak ≤ {dbtp_max:.1f} dBTP; measured "
                f"{tp_db:.2f} dBTP.",
                "Lower the limiter's output ceiling (e.g. to -1.0 dBTP) or add a true-peak "
                "limiter after the master chain to avoid inter-sample clipping on lossy codecs.",
            )
        )
    return out


def findings(measurements: dict, delivery: str | None = None) -> list[dict]:
    """Prioritized findings list, sorted alert -> warn -> info."""
    out: list[dict] = []

    if delivery is not None:
        out.extend(_delivery_findings(measurements, delivery))

    psr_min = measurements["loudness"]["psr"].get("min_psr_loud")
    if psr_min is not None and np.isfinite(psr_min) and psr_min < PSR_ALERT_THRESHOLD:
        out.append(
            _finding(
                "psr_low",
                "alert",
                "psr_min_loud",
                psr_min,
                PSR_ALERT_THRESHOLD,
                f"PSR (peak-to-short-term-loudness) is {psr_min:.1f} in the loudest "
                f"section, below Ian Shepherd's PSR ≥ 8 guideline for clean loudness.",
                "Raise the limiter's output ceiling or reduce input gain into the "
                "limiter — the mix is being squashed harder than it needs to be.",
            )
        )

    low_corr = measurements["stereo"]["correlation"].get("low")
    if low_corr is not None and np.isfinite(low_corr) and low_corr < LOW_CORR_WARN_THRESHOLD:
        out.append(
            _finding(
                "low_band_correlation",
                "warn",
                "correlation.low",
                low_corr,
                LOW_CORR_WARN_THRESHOLD,
                f"Low-band (<120 Hz) L/R correlation is {low_corr:.2f}, below 0.8 — "
                f"kick/bass phase may cancel in mono playback (clubs, phones).",
                "Add a mono-maker / Utility with 'Bass Mono' below ~120 Hz on the "
                "master, or check kick/bass sends for phase alignment.",
            )
        )

    tilt = measurements["spectrum"]["tilt_db_per_oct"]
    if np.isfinite(tilt):
        deviation = tilt - HEALTHY_TILT_DB_PER_OCT
        if abs(deviation) > TILT_FLAG_DEVIATION:
            out.append(
                _finding(
                    "spectral_tilt",
                    "warn",
                    "tilt_db_per_oct",
                    tilt,
                    HEALTHY_TILT_DB_PER_OCT,
                    f"Spectral tilt is {tilt:+.1f} dB/oct (100 Hz-4 kHz); healthy masters "
                    f"run ≈ {HEALTHY_TILT_DB_PER_OCT:.0f} dB/oct. Deviation "
                    f"{deviation:+.1f} dB/oct.",
                    "Bright/thin (tilt too flat): a gentle EQ Eight high shelf cut above "
                    "4-8 kHz. Dark/muddy (tilt too steep): a broad bell boost in the "
                    "2-6 kHz presence range.",
                )
            )

    target_comparison = measurements.get("target_comparison")
    if target_comparison:
        flagged = [b for b in target_comparison if b["flagged"]]
        flagged.sort(key=lambda b: abs(b["delta_db"]), reverse=True)
        for b in flagged[:5]:
            severity = "alert" if abs(b["delta_db"]) > 2 * b["threshold_db"] else "warn"
            direction = "above" if b["delta_db"] > 0 else "below"
            out.append(
                _finding(
                    f"target_band_{int(round(b['freq']))}hz",
                    severity,
                    f"spectrum[{b['freq']:.0f}Hz]",
                    b["delta_db"],
                    b["threshold_db"],
                    f"{b['freq']:.0f} Hz band is {abs(b['delta_db']):.1f} dB {direction} "
                    f"the reference target (threshold {b['threshold_db']:.1f} dB).",
                    f"EQ Eight on master: {'cut' if b['delta_db'] > 0 else 'boost'} "
                    f"~{min(abs(b['delta_db']), 3.0):.1f} dB around {b['freq']:.0f} Hz "
                    "to match the reference target.",
                )
            )
        if len(flagged) > 5:
            out.append(
                _finding(
                    "target_band_more",
                    "info",
                    "spectrum",
                    len(flagged),
                    5,
                    f"{len(flagged) - 5} additional band(s) also deviate from the target "
                    f"beyond threshold.",
                    "See the full target_comparison list for every flagged band.",
                )
            )

    asym_list = measurements["dynamics"]["asymmetry"]
    rotation = measurements["dynamics"]["phase_rotation_headroom"]
    best_db = rotation.get("best_db", 0.0) if rotation else 0.0
    max_asym = max((abs(a["ratio_db"]) for a in asym_list), default=0.0)
    if (
        max_asym >= ASYMMETRY_FLAG_DB
        and best_db is not None
        and np.isfinite(best_db)
        and best_db >= PHASE_ROTATION_MIN_HEADROOM_DB
    ):
        out.append(
            _finding(
                "asymmetry_phase_rotation",
                "info",
                "asymmetry.ratio_db",
                max_asym,
                ASYMMETRY_FLAG_DB,
                f"Waveform asymmetry is {max_asym:.1f} dB, and a phase-rotation sweep "
                f"found {best_db:.1f} dB of true-peak headroom (all-pass cascade at "
                f"{rotation['f0']:.0f} Hz, {rotation['poles']} poles) with no change "
                f"to the magnitude spectrum or loudness.",
                f"Insert a phase-rotation/all-pass device (e.g. an all-pass EQ band) "
                f"around {rotation['f0']:.0f} Hz to reclaim headroom before the limiter.",
            )
        )

    pump_result = measurements["dynamics"].get("pump")
    bpm = measurements.get("bpm")
    if pump_result and bpm:
        for band_key, label in (("full", "full band"), ("low", "<120 Hz")):
            band = pump_result.get(band_key, {})
            offset = band.get("trough_offset_ms")
            shape = band.get("shape")
            depth = band.get("depth_db")
            # Misalignment is only meaningful when the modulation actually
            # looks like ducking — a decay-like trough sits late in the
            # cycle by nature, not because a compressor is mis-synced.
            if (
                shape == "ducking-like"
                and offset is not None
                and np.isfinite(offset)
                and abs(offset) > PUMP_MISALIGN_WARN_MS
            ):
                out.append(
                    _finding(
                        f"pump_misalign_{band_key}",
                        "warn",
                        f"pump.{band_key}.trough_offset_ms",
                        offset,
                        PUMP_MISALIGN_WARN_MS,
                        f"Ducking-shaped pump trough ({label}) is offset {offset:+.1f} ms "
                        f"from the beat grid — the ducking isn't locked to the tempo.",
                        "Check the sidechain compressor/LFO device's sync/grid setting "
                        "and any trigger-source latency (routing delay, look-ahead).",
                    )
                )
            if depth is not None and np.isfinite(depth) and depth >= 3.0:
                out.append(
                    _finding(
                        f"pump_shape_{band_key}",
                        "info",
                        f"pump.{band_key}.depth_db",
                        depth,
                        3.0,
                        f"Beat-synced level modulation ({label}): {depth:.1f} dB deep, "
                        f"shape '{shape}' (recovery fraction "
                        f"{band.get('recovery_fraction', 0):.2f}). A single file cannot "
                        f"prove a sidechain is engaged — decay-shaped material pumps too.",
                        "To verify a sidechain definitively: capture the span with the "
                        "compressor on and bypassed, then `awh mix ab` the two — the "
                        "depth delta is the evidence.",
                    )
                )

    out.sort(key=lambda f: _SEVERITY_RANK.get(f["severity"], 3))
    return out


# ---------------------------------------------------------------------------
# Measurement records: a git-versioned "db" of analyzed files (owner request,
# M6 follow-up). One JSON per analyzed file under library/measurements/ —
# retrievable by grep/Claude without re-running the DSP.
# ---------------------------------------------------------------------------


def record_slug(path: str) -> str:
    """Filesystem-safe record name from an audio file's basename."""
    import os
    import re

    stem = os.path.splitext(os.path.basename(path))[0].lower()
    slug = re.sub(r"[^a-z0-9]+", "-", stem).strip("-")
    return slug or "record"


def save_record(
    record_path: str, source_path: str, measurements: dict, finding_list: list[dict]
) -> None:
    """Write a self-contained measurement record. Overwrites an existing
    record for the same name (re-measuring updates it); the sha256 ties the
    numbers to the exact audio bytes they came from.
    """
    import datetime
    import hashlib
    import json
    import os

    with open(source_path, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    record = {
        "schema": 1,
        "saved": datetime.date.today().isoformat(),
        "file": os.path.abspath(source_path),
        "sha256": sha,
        "measurements": measurements,
        "findings": finding_list,
    }
    os.makedirs(os.path.dirname(os.path.abspath(record_path)), exist_ok=True)
    with open(record_path, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2, allow_nan=True)
        f.write("\n")
