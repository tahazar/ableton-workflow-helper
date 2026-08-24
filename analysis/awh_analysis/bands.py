"""Calibrated narrowband energy compare (M6b masking toolkit).

Closes two of the gaps found doing real masking analysis (see
docs/design/analysis-engine.md's "Future work" section, 2026-08-23):

1. **Not calibrated.** The scratch numpy from that session computed a bare
   `10*log10(sum |FFT|^2)` — only meaningful for comparing captures taken in
   the same sitting at the same gain staging. Here, band levels are
   reported as dBFS with a stated calibration reference: a full-scale sine
   (peak amplitude 1.0) reads 0 dBFS, same discipline as `loudness.py`'s
   true-peak dBTP.
2. **Time-smeared.** One FFT over an entire multi-bar capture treats a
   rhythmically-changing bassline as a stationary tone. Band power here is
   integrated from a Welch periodogram (spectrum.py's `welch_psd` — same
   4096-pt FFT / Hann / 50% overlap machinery as the third-octave
   spectrum), which time-averages several overlapping windows rather than
   one FFT over the whole file — real narrowband masking questions that
   need a MOMENT, not an average, want `--from/--to` or `mix pitch
   --per-note`, not this tool alone (see the design doc's "confirmed, not
   a gap" note on `mix report`'s spectral tilt for the same reasoning).
"""

from __future__ import annotations

import numpy as np

from .audio import to_mono
from .spectrum import band_power, welch_psd

# Named default zones (sub / low / scoop zone / low-mid / mid) — the exact
# ranges the gap report's own example used ("20-100,140-200,200-500"),
# filled out to a contiguous 20 Hz-2 kHz sweep with a "low" zone (100-140)
# and "mid" (500-2000) added so the defaults cover a full masking-diagnosis
# pass without the caller having to know the danger zones by heart.
DEFAULT_BANDS_HZ: list[tuple[float, float, str]] = [
    (20.0, 100.0, "sub"),
    (100.0, 140.0, "low"),
    (140.0, 200.0, "scoop zone"),
    (200.0, 500.0, "low-mid"),
    (500.0, 2000.0, "mid"),
]

DEFAULT_BANDS_ARG = "20-100,100-140,140-200,200-500,500-2000"

# A full-scale sine (peak amplitude 1.0) has mean-square (RMS^2) = 0.5; a
# Welch density-scaled PSD integrated across the band containing that
# sine's frequency approximates that same mean-square (Parseval). Using
# 0.5 as the reference power makes a full-scale sine read 0.0 dBFS in its
# band — the calibration point this module's tests hold it to.
CALIBRATION_REF_POWER = 0.5

CALIBRATION_NOTE = (
    "0 dBFS = a full-scale sine (peak amplitude 1.0); band levels are a "
    "Welch PSD (4096-pt FFT, Hann window, 50% overlap) integrated over each "
    "band's Hz range and referenced to a full-scale sine's power (0.5 = "
    "RMS^2 of an amplitude-1.0 sine) — same true-peak-dBFS discipline as "
    "loudness.py, not a relative, gain-staging-dependent number."
)


def parse_bands_arg(spec: str | None) -> list[tuple[float, float, str]]:
    """Parse "20-100,140-200,..." into (lo_hz, hi_hz, label) triples.

    A range that exactly matches one of the named defaults keeps its label
    (sub/low/scoop zone/low-mid/mid) even when the caller passes the
    default string back explicitly; any other range gets a generic
    "<lo>-<hi>Hz" label.
    """
    if spec is None:
        return list(DEFAULT_BANDS_HZ)
    default_by_range = {(lo, hi): label for lo, hi, label in DEFAULT_BANDS_HZ}
    out: list[tuple[float, float, str]] = []
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "-" not in chunk:
            raise ValueError(f"band '{chunk}' is not in 'lo-hi' form")
        lo_s, _, hi_s = chunk.partition("-")
        try:
            lo, hi = float(lo_s), float(hi_s)
        except ValueError as exc:
            raise ValueError(f"band '{chunk}' is not in 'lo-hi' form") from exc
        if hi <= lo:
            raise ValueError(f"band '{chunk}': high edge must be > low edge")
        label = default_by_range.get((lo, hi), f"{lo:g}-{hi:g}Hz")
        out.append((lo, hi, label))
    if not out:
        raise ValueError("no bands parsed from --bands")
    return out


def band_levels(x: np.ndarray, sr: int, bands: list[tuple[float, float, str]]) -> dict:
    """Calibrated dBFS + fraction-of-total-signal-power per named band."""
    mono = to_mono(np.asarray(x, dtype=np.float64))
    total_power = float(np.mean(mono**2)) if mono.size else 0.0

    psd_result = welch_psd(mono, sr)
    results = []
    for lo, hi, label in bands:
        if psd_result is None:
            results.append(
                {
                    "label": label,
                    "lo_hz": lo,
                    "hi_hz": hi,
                    "dbfs": float("nan"),
                    "fraction_of_total": float("nan"),
                    "power": float("nan"),
                }
            )
            continue
        freqs, psd = psd_result
        lo_c = max(lo, float(freqs[0]))
        hi_c = min(hi, float(freqs[-1]))
        power = band_power(freqs, psd, lo_c, hi_c) if hi_c > lo_c else 0.0
        with np.errstate(divide="ignore"):
            dbfs = 10.0 * np.log10(power / CALIBRATION_REF_POWER) if power > 0 else -np.inf
        fraction = power / total_power if total_power > 0 else 0.0
        results.append(
            {
                "label": label,
                "lo_hz": lo,
                "hi_hz": hi,
                "dbfs": dbfs,
                "fraction_of_total": fraction,
                "power": power,
            }
        )
    return {"bands": results, "total_power": total_power}


def analyze_file(
    path: str,
    bands_spec: str | None = None,
    start_s: float | None = None,
    end_s: float | None = None,
) -> dict:
    from . import audio

    x, sr = audio.load(path, start_s=start_s, end_s=end_s)
    bands = parse_bands_arg(bands_spec)
    levels = band_levels(x, sr, bands)
    return {
        "file": path,
        "samplerate": sr,
        "duration_s": float(x.shape[0] / sr),
        **levels,
    }


def compare_files(
    paths: list[str],
    bands_spec: str | None = None,
    start_s: float | None = None,
    end_s: float | None = None,
) -> dict:
    """Aligned per-band comparison across 1+ files; per-band `delta_db` vs.
    the FIRST file is added to every file after the first (None where
    either side isn't a finite dBFS number — silence in one band is a
    state, not something to fake a delta for)."""
    analyses = [analyze_file(p, bands_spec, start_s, end_s) for p in paths]
    baseline = analyses[0]
    baseline_by_label = {b["label"]: b for b in baseline["bands"]}
    for a in analyses[1:]:
        for b in a["bands"]:
            base = baseline_by_label.get(b["label"])
            if base is not None and np.isfinite(b["dbfs"]) and np.isfinite(base["dbfs"]):
                b["delta_db"] = b["dbfs"] - base["dbfs"]
            else:
                b["delta_db"] = None
    return {
        "files": analyses,
        "baseline_file": baseline["file"],
        "calibration": CALIBRATION_NOTE,
    }
