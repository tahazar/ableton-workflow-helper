"""Sample-library scanning: per-file feature extraction for `awh samples
index`/`search`/`similar` (see `docs/design/sample-library.md`).

`scan_file(path)` is the whole contract: load a sample (wav/aiff/flac/mp3,
any length; one-shots are legitimately much shorter than `audio.load`'s
1 s analysis floor, so this module reads raw rather than going through
`audio.load`), and return one deterministic, JSON-safe feature record.
A per-file decode failure (corrupt/truncated file, unsupported codec, an
mp3 with no ffmpeg fallback available) is caught here and turned into an
`{"unreadable": true, "error": ...}` record, never an exception the
caller has to guard against (docs/lessons-learned.md: "zero items is a
state, not an error" generalizes to "one bad file in a big scan is a
state, not a crash").

Reused rather than re-derived, per the design doc:
- `duck.detect_onsets` for onset count/density (same spectral-flux + MAD
  threshold machinery `awh drums mine`/`awh mix duck` already rely on).
- `ref.onset_and_subband` + `ref.estimate_tempo` for loop BPM: the exact
  autocorrelation-with-harmonic-scoring tempo engine `awh ref analyze`
  uses, run here on the whole (short) file instead of a reference-length
  excerpt.
- `drumstats`'s low/<120 Hz>/mid/high(>2kHz) band split (same Butterworth
  family/order as `duck.py`/`ref.py`) for the band-energy split ("the
  drum-mining bands", per the design doc).

Spectral centroid/rolloff/flatness + 13 MFCCs come from librosa (already a
project dependency, see analysis/README.md) rather than a hand-rolled mel
filterbank + DCT; librosa provides the standard algorithm deterministically.

Everything in the record is either a direct measurement or an explicitly
labeled guess (`type_guess`, with its basis spelled out in
`type_guess_basis`), never presented with false certainty.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from typing import Any

import librosa
import numpy as np
import soundfile as sf

from . import duck, ref
from .audio import to_mono
from .drumstats import HIGH_BAND_HZ, LOW_BAND_HZ, _band_split

_DB_FLOOR = 1e-12

# --- type-guess heuristic (onsets + duration; see module docstring) -------
# A file needs to be both long enough and busy enough to plausibly be a
# rhythmic loop rather than a single hit/note. Tuned against the design's
# own synthetic verification corpus (a several-second kick loop with
# several hits vs. sub-2s one-shots). Conservative so short
# multi-hit fills don't get misread as loops.
LOOP_MIN_DURATION_S = 1.2
LOOP_MIN_ONSETS = 3

ONSET_MIN_GAP_S = 0.08  # same default as the `onsets` CLI subcommand

# Similarity-vector field order (mfcc[0..12], centroid, rolloff, flatness,
# band_low, band_mid, band_high). `awh samples similar` depends on every
# record in the index using this exact order.
SIMILARITY_VECTOR_LEN = 13 + 3 + 3


def _read_raw(path: str) -> tuple[np.ndarray, int]:
    """Read a file's raw samples with no minimum-duration floor (unlike
    `audio.load`): a one-shot sample can legitimately be well under 1 s."""
    samples, sr = sf.read(path, dtype="float64", always_2d=True)
    return samples, sr


def _decode_mp3_via_ffmpeg(path: str) -> tuple[np.ndarray, int]:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError(
            f"soundfile/libsndfile could not read '{path}' directly and ffmpeg is "
            "not installed (checked `ffmpeg -version`, not found on PATH) — install "
            "ffmpeg or convert the file to WAV first"
        )
    fd, tmp_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        proc = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", path, tmp_path],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg failed to decode '{path}': {proc.stderr.strip()}")
        return _read_raw(tmp_path)
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


def load_for_scan(path: str) -> tuple[np.ndarray, int]:
    """Load one sample file. Mirrors `drumstats.load_loop`'s soundfile-
    first / ffmpeg-fallback MP3 path, but reads raw (no `audio.load`
    1 s-minimum floor), since a one-shot can legitimately be well under 1 s.
    Public (not `_`-prefixed): reused by `samplepitch.py` so pitch
    tagging loads short one-shots the same correct way `scan_file` does,
    rather than going through `pitch.pitch()`'s `audio.load`-based path
    (which has the 1 s floor this function exists to avoid)."""
    try:
        return _read_raw(path)
    except Exception:
        if not path.lower().endswith(".mp3"):
            raise
        return _decode_mp3_via_ffmpeg(path)


def _db(value: float) -> float:
    return float(20.0 * np.log10(max(value, _DB_FLOOR)))


def _n_fft_for(n_samples: int) -> int:
    """Largest power of two <= min(2048, n_samples), floored at 32. Keeps
    librosa's frame-based spectral features well-defined on very short
    one-shots (a hi-hat burst can be well under the usual 2048-sample
    analysis window)."""
    n_fft = 2048
    while n_fft > n_samples and n_fft > 32:
        n_fft //= 2
    return n_fft


def _spectral_features(mono: np.ndarray, sr: int) -> dict[str, Any]:
    """Median spectral centroid/rolloff/flatness + 13 MFCC means, all via
    librosa on a frame grid sized to the (possibly very short) signal."""
    n_fft = _n_fft_for(mono.size)
    hop = max(1, n_fft // 4)
    y = np.asarray(mono, dtype=np.float64)

    centroid = librosa.feature.spectral_centroid(y=y, sr=sr, n_fft=n_fft, hop_length=hop)
    rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, n_fft=n_fft, hop_length=hop)
    flatness = librosa.feature.spectral_flatness(y=y, n_fft=n_fft, hop_length=hop)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, n_fft=n_fft, hop_length=hop)

    return {
        "spectral_centroid_hz": float(np.median(centroid)),
        "spectral_rolloff_hz": float(np.median(rolloff)),
        "spectral_flatness": float(np.median(flatness)),
        "mfcc_means": [float(v) for v in np.mean(mfcc, axis=1)],
    }


def _band_energy(mono: np.ndarray, sr: int) -> dict[str, Any]:
    """Low(<120Hz)/mid(120Hz-2kHz)/high(>2kHz) energy split as fractions of
    total band power (sums to 1), the same Butterworth band split
    `awh drums mine` uses, reused rather than re-derived."""
    bands = _band_split(mono, sr)
    powers = {name: float(np.mean(sig**2)) for name, sig in bands.items()}
    total = sum(powers.values())
    if total <= 0:
        fractions = {"low": 0.0, "mid": 0.0, "high": 0.0}
    else:
        fractions = {name: p / total for name, p in powers.items()}
    dominant = max(fractions, key=lambda k: fractions[k])
    return {"band_energy": fractions, "dominant_band": dominant}


def _onset_stats(mono: np.ndarray, sr: int, duration_s: float) -> tuple[int, float]:
    """(onset_count, onset_density_per_s). A signal too short for the
    onset-envelope machinery (well under one STFT analysis window) is
    treated as a single hit: the common case for a very short one-shot,
    not a detection failure."""
    try:
        onsets = duck.detect_onsets(mono, sr, min_gap_s=ONSET_MIN_GAP_S)
        count = len(onsets)
    except ValueError:
        count = 1
    density = count / duration_s if duration_s > 0 else 0.0
    return count, density


def _bpm_estimate(mono: np.ndarray, sr: int) -> dict[str, Any]:
    """Loop BPM via the same autocorrelation-with-harmonic-scoring engine
    `awh ref analyze` uses (`ref.estimate_tempo`), run on the whole file.
    Returns bpm=None/confidence=None when the tempo machinery can't fire
    (e.g. not enough onset-envelope frames), a normal outcome for short
    or sparse loops, never a crash."""
    try:
        onset_env, _sub, hop_s = ref.onset_and_subband(mono, sr)
        tempo = ref.estimate_tempo(onset_env, hop_s)
        return {
            "bpm": tempo["bpm"],
            "bpm_confidence": tempo["confidence"],
            "bpm_runner_up": tempo["runner_up"],
        }
    except ValueError:
        return {"bpm": None, "bpm_confidence": None, "bpm_runner_up": None}


def scan_file(path: str) -> dict[str, Any]:
    """Extract the full feature record for one sample file.

    Never raises: any failure (missing file, corrupt/unsupported codec,
    empty audio) is caught and returned as
    `{"path": path, "unreadable": True, "error": "..."}`.
    """
    try:
        samples, sr = load_for_scan(path)
    except Exception as exc:  # noqa: BLE001 — decode failure is a record, not a crash
        return {"path": path, "unreadable": True, "error": str(exc)}

    if samples.size == 0 or samples.shape[0] == 0:
        return {"path": path, "unreadable": True, "error": "file decoded to zero audio frames"}

    try:
        channels = int(samples.shape[1])
        duration_s = float(samples.shape[0]) / sr
        mono = to_mono(samples)

        rms = float(np.sqrt(np.mean(mono**2)))
        peak = float(np.max(np.abs(mono))) if mono.size else 0.0

        onset_count, onset_density = _onset_stats(mono, sr, duration_s)

        is_loop = duration_s >= LOOP_MIN_DURATION_S and onset_count >= LOOP_MIN_ONSETS
        type_guess = "loop" if is_loop else "oneshot"
        type_guess_basis = (
            f"duration {duration_s:.2f}s >= {LOOP_MIN_DURATION_S:.2f}s and "
            f"{onset_count} onsets >= {LOOP_MIN_ONSETS} -> loop"
            if is_loop
            else (
                f"duration {duration_s:.2f}s / {onset_count} onsets did not clear the "
                f"loop heuristic (needs >= {LOOP_MIN_DURATION_S:.2f}s and "
                f">= {LOOP_MIN_ONSETS} onsets) -> oneshot"
            )
        )

        bpm_info = _bpm_estimate(mono, sr) if is_loop else {
            "bpm": None,
            "bpm_confidence": None,
            "bpm_runner_up": None,
        }

        spectral = _spectral_features(mono, sr)
        band = _band_energy(mono, sr)

        similarity_vector = (
            spectral["mfcc_means"]
            + [
                spectral["spectral_centroid_hz"],
                spectral["spectral_rolloff_hz"],
                spectral["spectral_flatness"],
            ]
            + [band["band_energy"]["low"], band["band_energy"]["mid"], band["band_energy"]["high"]]
        )
        assert len(similarity_vector) == SIMILARITY_VECTOR_LEN

        return {
            "path": path,
            "unreadable": False,
            "error": None,
            "duration_s": duration_s,
            "channels": channels,
            "sample_rate": int(sr),
            "rms_db": _db(rms),
            "peak_db": _db(peak),
            "onset_count": onset_count,
            "onset_density_per_s": onset_density,
            "type_guess": type_guess,
            "type_guess_basis": type_guess_basis,
            **bpm_info,
            **spectral,
            **band,
            "similarity_vector": similarity_vector,
            "low_band_hz": LOW_BAND_HZ,
            "high_band_hz": HIGH_BAND_HZ,
        }
    except Exception as exc:  # noqa: BLE001 — a DSP-stage failure is still "unreadable", not a crash
        return {"path": path, "unreadable": True, "error": f"analysis failed: {exc}"}
