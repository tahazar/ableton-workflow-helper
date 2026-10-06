"""Drum-loop rhythm-statistics mining: band-split onset
mining across a folder of drum loops -> per-band 16th-grid position-hit
probability histograms, aggregated per dataset.

This module measures; it never compares against or writes to the built-in
style specs (`packages/core/src/drums/grammars.ts` / `styleSpec.ts`), which
stay hand-authored and locked. Comparisons happen in prose, in the CLI's
pretty output and in knowledge-base entries that cite a saved record.

Pipeline per loop (see `mine_drum_loops`):

1. Load audio (mp3 or wav/aiff/flac/...). MP3 decode path: this repo's
   soundfile/libsndfile build decodes MP3 directly (libsndfile >= 1.1). `load_loop` tries that first and
   only falls back to shelling out to `ffmpeg` (decoding to a temp WAV)
   if the direct read fails; the mode actually used for a given corpus is
   reported in the output's `mp3_decode_mode` field, and `ffmpeg -version`
   availability is checked lazily (only if the fallback is ever needed) so
   a machine without ffmpeg still works when soundfile alone suffices.
2. Mono downmix (`audio.to_mono`).
3. Band-split into low (<120 Hz) / mid (120 Hz-2 kHz) / high (>2 kHz) via
   4th-order Butterworth filters (the same filter family/order as
   `duck.py` and `ref.py` use). This is a kick / snare-clap / hat proxy
   for a mixed loop, not source separation or ground truth: a hi-hat
   transient has low-frequency click energy, a kick has harmonics well
   past 2 kHz, a clap smears across mid and high. Read "low band" as "the
   range where a kick's fundamental dominates in a typical mix", not "the
   kick track".
4. Per band: onset detection reuses `duck.detect_onsets` (spectral flux +
   MAD threshold + relative floor) run on the band-limited signal. Each
   onset time is folded onto the loop's 16th-note grid (`--grid`, default
   16 steps/bar) using the loop's BPM, assuming the loop starts on beat 1
   (downbeat at t=0s). A 4/4 time signature is also assumed for the
   steps-per-bar math. `mine_drum_loops` checks this assumption against
   every loop's own low-band first onset and reports the pass rate in
   `downbeat_check` rather than asserting it blindly.
5. Per-bar presence (not raw count) is accumulated per grid position, so
   `position_prob[i]` is a true 0..1 probability: the fraction of bars,
   across the whole dataset, that had at least one onset near position i.
   `density` (mean onsets/bar, unclipped) and `onsets_total` are reported
   separately for loops with busy/rolled hits at one position.

Small-n caveat: every result carries `n_loops` and an assumptions list
that says so in words, so a pilot corpus's numbers are not read as more
certain than the sample size supports.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from typing import Any

import numpy as np
from scipy.signal import butter, sosfiltfilt

from . import audio, duck
from .audio import to_mono

LOW_BAND_HZ = 120.0
HIGH_BAND_HZ = 2000.0
BANDS: tuple[str, ...] = ("low", "mid", "high")

DEFAULT_GRID = 16
BEATS_PER_BAR = 4  # 4/4 assumed for the grid-step math (see module docstring)

# min_gap_s for onset detection scales with the grid's own step duration so
# a fast loop's adjacent 16ths don't get merged into one onset, but floored
# so quiet noise doesn't get picked up on very slow loops.
MIN_GAP_FLOOR_S = 0.03
MIN_GAP_CEIL_S = 0.08
MIN_GAP_STEP_FRACTION = 0.4

DOWNBEAT_NEAR_ZERO_STEPS = 1.5  # first low-band onset within this many grid
# steps of t=0 counts as "starts on beat 1" for the diagnostic

AUDIO_EXTENSIONS = {".mp3", ".wav", ".wave", ".aif", ".aiff", ".flac", ".ogg"}


def find_audio_files(paths: list[str]) -> list[str]:
    """Expand files/directories into a flat, sorted list of audio file
    paths. Directories are scanned non-recursively (one dataset = one flat
    folder of loops, matching the WaivOps example-pack layout)."""
    files: list[str] = []
    for p in paths:
        if os.path.isdir(p):
            for name in sorted(os.listdir(p)):
                if os.path.splitext(name)[1].lower() in AUDIO_EXTENSIONS:
                    files.append(os.path.join(p, name))
        elif os.path.isfile(p):
            if os.path.splitext(p)[1].lower() in AUDIO_EXTENSIONS:
                files.append(p)
    return sorted(files)


def _decode_via_ffmpeg(path: str) -> tuple[np.ndarray, int]:
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
        return audio.load(tmp_path)
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


def load_loop(path: str) -> tuple[np.ndarray, int, str]:
    """Load one loop file. Returns (samples, samplerate, decode_mode).

    decode_mode is `"soundfile"` (the normal, direct path; libsndfile >=
    1.1 reads MP3 natively) or `"ffmpeg-cli fallback"` (only exercised when
    soundfile's direct read fails; requires ffmpeg on PATH).
    """
    try:
        x, sr = audio.load(path)
        return x, sr, "soundfile"
    except Exception as primary_exc:
        if not path.lower().endswith(".mp3"):
            raise
        x, sr = _decode_via_ffmpeg(path)
        return x, sr, "ffmpeg-cli fallback"


def _band_split(mono: np.ndarray, sr: int) -> dict[str, np.ndarray]:
    """Low/mid/high split via 4th-order Butterworth filters. Proxy for
    kick/snare-clap/hat; see module docstring."""
    nyq = sr / 2.0
    low_sos = butter(4, LOW_BAND_HZ / nyq, btype="lowpass", output="sos")
    mid_sos = butter(4, [LOW_BAND_HZ / nyq, HIGH_BAND_HZ / nyq], btype="bandpass", output="sos")
    high_sos = butter(4, HIGH_BAND_HZ / nyq, btype="highpass", output="sos")
    return {
        "low": sosfiltfilt(low_sos, mono),
        "mid": sosfiltfilt(mid_sos, mono),
        "high": sosfiltfilt(high_sos, mono),
    }


def _bar_presence(steps: list[int], grid: int, n_bars: int) -> np.ndarray:
    """(n_bars, grid) boolean presence matrix from absolute grid-step onset
    indices. Steps that fall in a trailing partial bar (beyond n_bars) are
    dropped, so the loop's last fractional bar is not double-counted."""
    presence = np.zeros((max(n_bars, 1), grid), dtype=bool)
    for s in steps:
        bar, pos = divmod(s, grid)
        if 0 <= bar < presence.shape[0]:
            presence[bar, pos] = True
    return presence


def _swing_estimate(offsets: dict[str, list[float]], grid: int) -> dict[str, Any]:
    """Swing/shuffle estimate from the high band (hats carry the shuffle
    feel most audibly). For every high-band onset, its timing is expressed
    as a signed fraction of one grid step from the nearest grid line
    (-0.5..0.5). Onsets nearest an even grid position (on-8th: beat, "&",
    etc., e.g. position 2) are pooled separately from onsets nearest an odd
    position (the following off-16th, e.g. position 3). This generalizes
    the "position 2 vs the 16th right after it" comparison across every
    such pair in the dataset instead of just one, which is more reliable
    at pilot sample sizes. A positive delay means off-16ths land later
    than the grid relative to on-8ths, i.e. a swung/shuffled feel,
    directly comparable to `swingDelay` in grammars.ts once converted to
    beats (`delay_equivalent_beats`).
    """
    even = np.array(offsets["even"], dtype=np.float64)
    odd = np.array(offsets["odd"], dtype=np.float64)
    even_mean = float(np.mean(even)) if even.size else None
    odd_mean = float(np.mean(odd)) if odd.size else None
    delay_frac = (odd_mean - even_mean) if (even_mean is not None and odd_mean is not None) else None
    step_beats = float(BEATS_PER_BAR) / grid
    return {
        "band": "high",
        "method": (
            "mean fractional-grid-step timing offset of onsets nearest EVEN "
            "positions (on-8th) vs ODD positions (the following off-16th); "
            "positive = off-16th lands later (swung)"
        ),
        "on8_mean_offset_steps": even_mean,
        "off16_mean_offset_steps": odd_mean,
        "delay_frac_of_16th_step": delay_frac,
        "delay_equivalent_beats": (delay_frac * step_beats) if delay_frac is not None else None,
        "n_on8_onsets": int(even.size),
        "n_off16_onsets": int(odd.size),
    }


def _bpm_from_filename(path: str) -> float | None:
    m = re.match(r"^(\d+(?:\.\d+)?)\s*bpm", os.path.basename(path), re.IGNORECASE)
    return float(m.group(1)) if m else None


def mine_drum_loops(
    paths: list[str],
    *,
    bpm_from_name: bool = True,
    bpm: float | None = None,
    grid: int = DEFAULT_GRID,
    dataset_name: str | None = None,
) -> dict[str, Any]:
    """Mine band-split rhythm statistics from a list of drum-loop audio
    files. See the module docstring for the full pipeline.

    Raises ValueError if `paths` is empty, if `bpm_from_name=False` and no
    `bpm` fallback is given, or if every file was skipped (decode failure
    or no determinable BPM). A directory with no audio files at all is a
    separate, non-error state the CLI handles before calling this.
    """
    if not paths:
        raise ValueError("mine_drum_loops requires at least one audio file path")
    if not bpm_from_name and bpm is None:
        raise ValueError("bpm_from_name=False requires an explicit bpm fallback")
    if grid < 4 or grid % 4 != 0:
        raise ValueError(f"grid must be a positive multiple of 4 (got {grid})")

    presence_hits = {b: np.zeros(grid, dtype=np.float64) for b in BANDS}
    bars_seen = {b: 0 for b in BANDS}
    onsets_total = {b: 0 for b in BANDS}
    swing_offsets: dict[str, list[float]] = {"even": [], "odd": []}
    tempos: list[float] = []
    used_files: list[str] = []
    skipped: list[dict[str, str]] = []
    mp3_decode_mode: str | None = None
    downbeat_checked = 0
    downbeat_near_zero = 0
    downbeat_threshold_s: float | None = None

    for path in paths:
        loop_bpm = _bpm_from_filename(path) if bpm_from_name else None
        if loop_bpm is None:
            loop_bpm = bpm
        if loop_bpm is None:
            skipped.append({"file": os.path.basename(path), "reason": "no BPM in filename and no --bpm override"})
            continue

        try:
            x, sr, mode = load_loop(path)
        except Exception as exc:  # noqa: BLE001 — report and continue mining the rest
            skipped.append({"file": os.path.basename(path), "reason": f"could not decode: {exc}"})
            continue
        if mp3_decode_mode is None:
            mp3_decode_mode = mode

        mono = to_mono(x)
        duration_s = len(mono) / sr
        step_dur_s = (60.0 / loop_bpm) * (float(BEATS_PER_BAR) / grid)
        n_bars = max(1, round(duration_s / (step_dur_s * grid)))
        min_gap_s = min(MIN_GAP_CEIL_S, max(MIN_GAP_FLOOR_S, MIN_GAP_STEP_FRACTION * step_dur_s))

        bands = _band_split(mono, sr)
        for band_name, sig in bands.items():
            try:
                band_onsets = duck.detect_onsets(sig, sr, min_gap_s=min_gap_s)
            except ValueError:
                band_onsets = []

            steps = [int(round(t / step_dur_s)) for t in band_onsets]
            presence_hits[band_name] += _bar_presence(steps, grid, n_bars).sum(axis=0)
            bars_seen[band_name] += n_bars
            onsets_total[band_name] += len(band_onsets)

            if band_name == "low" and band_onsets:
                downbeat_checked += 1
                threshold = DOWNBEAT_NEAR_ZERO_STEPS * step_dur_s
                downbeat_threshold_s = threshold
                if band_onsets[0] <= threshold:
                    downbeat_near_zero += 1

            if band_name == "high":
                for t in band_onsets:
                    step = t / step_dur_s
                    nearest = round(step)
                    frac = step - nearest
                    pos = int(nearest) % grid
                    (swing_offsets["even"] if pos % 2 == 0 else swing_offsets["odd"]).append(frac)

        tempos.append(loop_bpm)
        used_files.append(path)

    if not used_files:
        raise ValueError(
            f"no loop could be analyzed out of {len(paths)} file(s) — "
            f"{skipped[0]['reason'] if skipped else 'unknown reason'} (see the skipped list for detail)"
        )

    per_band: dict[str, dict[str, Any]] = {}
    for band_name in BANDS:
        bars = bars_seen[band_name]
        prob = (presence_hits[band_name] / bars).tolist() if bars else [0.0] * grid
        density = (onsets_total[band_name] / bars) if bars else 0.0
        per_band[band_name] = {
            "position_prob": prob,
            "density": density,
            "onsets_total": onsets_total[band_name],
        }

    tempos_arr = np.asarray(tempos, dtype=np.float64)
    n_loops = len(used_files)

    assumptions = [
        "band-split (<120 Hz / 120 Hz-2 kHz / >2 kHz) is a KICK / SNARE-CLAP / HAT "
        "PROXY, not source separation — a hat transient still has low-frequency "
        "click energy and a kick has harmonics past 2 kHz; treat 'low band' as "
        "'where a kick dominates in a mix', not 'the isolated kick track'.",
        "4/4 time signature assumed for the grid-step math "
        f"(step duration = (60/bpm) * ({BEATS_PER_BAR}/grid)).",
        "loop is assumed to start on beat 1 (downbeat at t=0s) — checked against "
        f"the low band's first onset on {downbeat_checked}/{n_loops} loop(s) with a "
        f"detectable low-band onset; {downbeat_near_zero} landed within "
        f"{(downbeat_threshold_s or 0) * 1000:.0f} ms of t=0"
        + (
            " (the assumption held for every checked loop)"
            if downbeat_checked and downbeat_near_zero == downbeat_checked
            else " — see downbeat_check for the ones that didn't"
            if downbeat_checked
            else " (no loop had a detectable low-band onset to check against)"
        )
        + ".",
        f"n={n_loops} loop(s) — a PILOT sample size; treat position probabilities "
        "as suggestive, not definitive, until the full dataset is mined.",
    ]
    if skipped:
        assumptions.append(f"{len(skipped)} file(s) were skipped — see the skipped list for reasons.")

    result: dict[str, Any] = {
        "dataset": dataset_name or "unnamed",
        "n_loops": n_loops,
        "bpm_range": [float(tempos_arr.min()), float(tempos_arr.max())],
        "bpm_mean": float(tempos_arr.mean()),
        "grid": grid,
        "per_band": per_band,
        "swing_estimate": _swing_estimate(swing_offsets, grid),
        "downbeat_check": {
            "assumption": "loop starts on beat 1 (downbeat at t=0s)",
            "loops_checked": downbeat_checked,
            "loops_near_zero": downbeat_near_zero,
            "near_zero_threshold_s": downbeat_threshold_s,
        },
        "mp3_decode_mode": mp3_decode_mode,
        "assumptions": assumptions,
        "files": [os.path.basename(p) for p in used_files],
        "skipped": skipped,
        "generated_by": "awh_analysis.drumstats.mine_drum_loops",
    }
    return result


def save_record(
    record_path: str,
    source_paths: list[str],
    stats: dict[str, Any],
    attribution: dict[str, Any] | None = None,
) -> None:
    """Write a self-contained drum-stats measurement record in the same
    library/measurements/ convention as `report.save_record` (schema +
    saved date + sha256-tied sources), adapted for a many-file dataset:
    `sources` is a list of {file, sha256} instead of one file/hash pair.
    """
    import datetime
    import hashlib

    sources = []
    for p in source_paths:
        with open(p, "rb") as f:
            sha = hashlib.sha256(f.read()).hexdigest()
        sources.append({"file": os.path.basename(p), "sha256": sha})

    record = {
        "schema": 1,
        "kind": "drumstats",
        "saved": datetime.date.today().isoformat(),
        "n_sources": len(sources),
        "sources": sources,
        "stats": stats,
        "attribution": attribution or {},
    }
    os.makedirs(os.path.dirname(os.path.abspath(record_path)), exist_ok=True)
    from .audio import sanitize_json

    with open(record_path, "w", encoding="utf-8") as f:
        json.dump(sanitize_json(record), f, indent=2, allow_nan=False)
        f.write("\n")
