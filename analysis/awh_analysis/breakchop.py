"""Break-sample chop analyzer (`awh breaks chop`): onset-slice a break
sample (amen, think, funky drummer, ...) into a labeled chop map: slice
spans, a per-slice role guess (kick/snare/hat/ghost) with confidence, BPM,
and grid position with the offset error measured (never silently snapped).

Reuses existing machinery rather than new DSP (docs/design/break-engine.md):
  - onset detection: `duck.detect_onsets` (spectral flux + MAD threshold).
  - BPM: `ref.onset_and_subband` + `ref.estimate_tempo` (same autocorrelation
    + harmonic-scoring estimator `awh ref analyze` uses, confidence carried).
  - role guess: the same low/mid/high band-split proxy `drumstats.py` mines
    across a whole loop (`drumstats._band_split`, a kick/snare-clap/hat
    proxy, not source separation), applied per-slice instead of per-loop.

Slicing convention (plain `soundfile` read + slice + write, no Simpler
dependency, sample-accurate at slice boundaries):
  - slice i spans [onset[i], onset[i+1]) for i < n-1.
  - the final slice's `end_s` is always the file's own end (byte-exact,
    lossless cut), never truncated at a decayed-below-floor point, so
    `--export` byte lengths always match the reported spans exactly. Where
    the last slice's energy decays below a floor (informational
    only, does not change the cut) is separately reported as
    `tail_decay_s` when detectable.
  - material before the first onset (a pre-roll/lead-in) is not part of any
    slice: onset detection defines where slices start, by construction.

Grid convention: 16 steps/bar (16th notes), 4/4 assumed (same defaults as
`drumstats.py`/the drum/arp engines). The file's downbeat is assumed at
t=0s (checked, not asserted: see `downbeat_check`, same convention as
`drumstats.mine_drum_loops`). Each slice's onset time is folded onto that
grid; `offset_ms` is the signed measured distance from the nearest grid
line. A sloppy/swung break reports a nonzero offset and is never snapped
onto the grid.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import os
from typing import Any

import numpy as np
import soundfile as sf

from . import audio, drumstats, duck, ref
from .audio import to_mono

BEATS_PER_BAR = 4
GRID_STEPS_PER_BAR = 16

DEFAULT_MIN_GAP_S = 0.025  # breaks pack hits much tighter than a generic
# drum loop (32nd-note ghost snares are routine). This is finer than
# duck.detect_onsets' own 0.08s default, floored at a plausible minimum
# separable-transient gap rather than tied to the (not-yet-known) BPM.

# A slice whose broadband peak sits this many dB below the loudest slice in
# the file is a "ghost" hit (a quiet/grace-note-style hit) regardless of its
# spectral balance. Measured relative to the file's own loudest transient,
# never an absolute dBFS number (a quietly-recorded break should not read as
# "all ghosts"). 18 dB is generous: ghost snares in break
# breaks typically sit 10-25 dB under the main backbeat.
GHOST_RELATIVE_PEAK_DB = -18.0
GHOST_CONFIDENCE_SPAN_DB = 12.0  # ghost confidence saturates to 1.0 this far
# past the threshold: a hit right at the threshold reads as barely-
# confident-ghost (0.0), one 12dB quieter reads as fully confident (1.0).

TAIL_DECAY_ABOVE_FLOOR_DB = 3.0  # same convention as duck.py's
# DECAY_DONE_ABOVE_FLOOR_DB: the tail is "decayed" once it's back within this
# many dB of the between-hit noise floor.

ROLE_BY_BAND = {"low": "kick", "mid": "snare", "high": "hat"}

DOWNBEAT_NEAR_ZERO_STEPS = 1.5  # same tolerance as drumstats.py


def _grid_step_dur_s(bpm: float, grid: int = GRID_STEPS_PER_BAR) -> float:
    return (60.0 / bpm) * (float(BEATS_PER_BAR) / grid)


def _estimate_bpm(mono: np.ndarray, sr: int) -> dict[str, Any]:
    onset_env, _sub, hop_s = ref.onset_and_subband(mono, sr)
    tempo = ref.estimate_tempo(onset_env, hop_s)
    return tempo


def analyze_break(
    path: str,
    bpm_override: float | None = None,
    min_gap_s: float = DEFAULT_MIN_GAP_S,
    grid: int = GRID_STEPS_PER_BAR,
) -> dict[str, Any]:
    """Chop a break sample into a labeled slice map. See module docstring
    for the slicing/grid conventions. Raises ValueError if the file is too
    short to analyze (same floor as `audio.load`). Zero onsets detected is
    not an error (a near-silent or already-atomized file): it comes back as
    a zero-slice map (a state, not an error; docs/lessons-learned.md #5),
    left to the caller (the CLI) to report plainly.
    """
    x, sr = audio.load(path)
    mono = to_mono(x)
    duration_s = mono.shape[0] / sr

    if bpm_override is not None:
        bpm = float(bpm_override)
        bpm_confidence = 1.0
        bpm_source = "override"
        bpm_runner_up = None
    else:
        tempo = _estimate_bpm(mono, sr)
        bpm = float(tempo["bpm"])
        bpm_confidence = float(tempo["confidence"])
        bpm_source = "estimated"
        bpm_runner_up = tempo["runner_up"]

    onsets = duck.detect_onsets(mono, sr, min_gap_s=min_gap_s)

    result: dict[str, Any] = {
        "file": os.path.basename(path),
        "samplerate": sr,
        "duration_s": duration_s,
        "bpm": bpm,
        "bpm_confidence": bpm_confidence,
        "bpm_source": bpm_source,
        "bpm_runner_up": bpm_runner_up,
        "grid_steps_per_bar": grid,
        "beats_per_bar": BEATS_PER_BAR,
        "min_gap_s": min_gap_s,
        "ghost_threshold_db": GHOST_RELATIVE_PEAK_DB,
        "n_slices": 0,
        "slices": [],
        "downbeat_check": None,
        "assumptions": [
            "4/4 time signature and a 16th-note grid are assumed for grid-step "
            "math (same convention as awh_analysis.drumstats).",
            "the file is assumed to start on beat 1 (downbeat at t=0s) — see "
            "downbeat_check.",
            "role guess (kick/snare/hat) is a low/mid/high BAND-ENERGY PROXY "
            "(same one drumstats.py mines across a whole loop), not source "
            "separation or ground truth — treat it as a GUESS, tier it with "
            "its own confidence.",
            f"a slice whose peak sits {abs(GHOST_RELATIVE_PEAK_DB):.0f} dB or more "
            "below the file's loudest slice is labeled 'ghost' regardless of its "
            "band balance.",
        ],
    }

    if not onsets:
        return result

    step_dur_s = _grid_step_dur_s(bpm, grid)
    bands = drumstats._band_split(mono, sr)  # same low/mid/high proxy filters
    # drumstats mines across a whole loop; we reuse its exact filter bank
    # (see drumstats.LOW_BAND_HZ/HIGH_BAND_HZ) but slice per-onset instead.

    starts = sorted(onsets)
    ends = [*starts[1:], duration_s]

    peaks = []
    for s, e in zip(starts, ends, strict=True):
        i0 = int(round(s * sr))
        i1 = max(i0 + 1, int(round(e * sr)))
        seg = mono[i0:i1]
        peaks.append(float(np.max(np.abs(seg))) if seg.size else 0.0)
    global_peak = max(peaks) if peaks else 0.0

    slices: list[dict[str, Any]] = []
    downbeat_checked = 0
    downbeat_near_zero = 0
    for idx, (s, e) in enumerate(zip(starts, ends, strict=True)):
        i0 = int(round(s * sr))
        i1 = max(i0 + 1, int(round(e * sr)))

        band_energy = {}
        for name, sig in bands.items():
            seg = sig[i0:i1]
            band_energy[name] = float(np.mean(seg**2)) if seg.size else 0.0
        total_energy = sum(band_energy.values())

        peak = peaks[idx]
        peak_db_rel = (
            20.0 * np.log10(max(peak, 1e-12) / max(global_peak, 1e-12))
            if global_peak > 0
            else -120.0
        )
        is_ghost = bool(peak_db_rel <= GHOST_RELATIVE_PEAK_DB)

        if is_ghost:
            role = "ghost"
            margin_db = GHOST_RELATIVE_PEAK_DB - peak_db_rel
            confidence = float(np.clip(margin_db / GHOST_CONFIDENCE_SPAN_DB, 0.0, 1.0))
            band_fractions = (
                {k: v / total_energy for k, v in band_energy.items()}
                if total_energy > 0
                else {k: 1.0 / len(band_energy) for k in band_energy}
            )
        elif total_energy > 0:
            band_fractions = {k: v / total_energy for k, v in band_energy.items()}
            winner = max(band_fractions, key=lambda k: band_fractions[k])
            role = ROLE_BY_BAND[winner]
            confidence = float(band_fractions[winner])
        else:
            # totally silent slice (shouldn't normally happen post-onset-
            # detection, but a degenerate 1-sample slice at file end could
            # produce this): an even 3-way split, not a guessed role.
            band_fractions = {k: 1.0 / len(band_energy) for k in band_energy}
            role = "ghost"
            confidence = 0.0

        grid_step = int(round(s / step_dur_s))
        offset_ms = (s - grid_step * step_dur_s) * 1000.0
        bar = grid_step // grid
        pos = grid_step % grid

        if idx == 0:
            downbeat_checked = 1
            downbeat_near_zero = 1 if grid_step <= DOWNBEAT_NEAR_ZERO_STEPS else 0

        slices.append(
            {
                "index": idx,
                "start_s": s,
                "end_s": e,
                "duration_s": e - s,
                "grid_step": grid_step,
                "bar": bar,
                "pos": pos,
                "offset_ms": offset_ms,
                "role": role,
                "confidence": confidence,
                "is_ghost": is_ghost,
                "peak_db_rel": peak_db_rel,
                "bands": band_fractions,
            }
        )

    # Tail-decay diagnostic (informational only; see module docstring: the
    # last slice's `end_s` above is always the file end, never truncated).
    last = slices[-1]
    tail_decay_s = None
    i0 = int(round(last["start_s"] * sr))
    tail = mono[i0:]
    if tail.size > 0:
        peak_db = 20.0 * np.log10(max(float(np.max(np.abs(tail))), 1e-12))
        win = max(1, int(round(0.01 * sr)))
        n_win = max(1, tail.size // win)
        env_db = [
            20.0 * np.log10(max(float(np.sqrt(np.mean(tail[k * win : (k + 1) * win] ** 2))), 1e-12))
            for k in range(n_win)
        ]
        floor_db = min(env_db) if env_db else peak_db
        for k, level in enumerate(env_db):
            if level <= floor_db + TAIL_DECAY_ABOVE_FLOOR_DB and (k * win) / sr > 0.01:
                tail_decay_s = last["start_s"] + (k * win) / sr
                break

    result["n_slices"] = len(slices)
    result["slices"] = slices
    result["tail_decay_s"] = tail_decay_s
    result["downbeat_check"] = {
        "assumption": "file starts on beat 1 (downbeat at t=0s)",
        "loops_checked": downbeat_checked,
        "loops_near_zero": downbeat_near_zero,
        "near_zero_threshold_s": DOWNBEAT_NEAR_ZERO_STEPS * step_dur_s,
    }
    return result


def export_slices(path: str, chopmap: dict[str, Any], export_dir: str) -> dict[str, Any]:
    """Cut each slice to its own WAV (`<nn>-<role>.wav`, plain soundfile
    read/slice/write, sample-accurate at the reported spans) plus a
    README.md mapping table for dragging into a Drum Rack. Returns the
    list of exported files with byte lengths, so "export byte-lengths
    match slice spans" is checkable from the return value.
    """
    os.makedirs(export_dir, exist_ok=True)
    info = sf.info(path)
    sr = info.samplerate
    subtype = info.subtype

    exported: list[dict[str, Any]] = []
    readme_rows = ["| slice | file | start_s | end_s | grid | role | confidence |", "|---|---|---|---|---|---|---|"]
    for sl in chopmap["slices"]:
        idx = sl["index"]
        start = sl["start_s"]
        frames = int(round((sl["end_s"] - start) * sr))
        name = f"{idx:02d}-{sl['role']}.wav"
        out_path = os.path.join(export_dir, name)
        data, _sr = sf.read(
            path,
            start=int(round(start * sr)),
            frames=frames,
            dtype="float64",
            always_2d=True,
        )
        sf.write(out_path, data, sr, subtype=subtype)
        byte_length = os.path.getsize(out_path)
        exported.append(
            {
                "index": idx,
                "file": name,
                "path": os.path.abspath(out_path),
                "frames": data.shape[0],
                "byte_length": byte_length,
            }
        )
        readme_rows.append(
            f"| {idx} | {name} | {start:.3f} | {sl['end_s']:.3f} | bar {sl['bar'] + 1} pos {sl['pos']} | "
            f"{sl['role']} | {sl['confidence']:.2f} |"
        )

    readme_path = os.path.join(export_dir, "README.md")
    with open(readme_path, "w", encoding="utf-8") as f:
        f.write(
            f"# Chop export — {os.path.basename(path)}\n\n"
            f"{len(exported)} slice(s), BPM {chopmap['bpm']:.1f} "
            f"({chopmap['bpm_source']}), grid {chopmap['grid_steps_per_bar']}/bar.\n\n"
            "Drag these files into an empty Drum Rack's pads in order (00, 01, "
            "02, ...) for the zero-friction path — `awh breaks pattern "
            "--mode drum-rack` maps slice N to pad N assuming exactly this "
            "order.\n\n" + "\n".join(readme_rows) + "\n"
        )

    return {"dir": os.path.abspath(export_dir), "readme": readme_path, "files": exported}


def save_chopmap_record(record_path: str, source_path: str, chopmap: dict[str, Any]) -> None:
    """Write a self-contained chop-map record in the library/measurements/
    convention (kind "chopmap"), same schema/saved/sha256 shape as
    `report.save_record`/`drumstats.save_record`. `mix records` and the kb
    index render this kind."""
    with open(source_path, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    record = {
        "schema": 1,
        "kind": "chopmap",
        "saved": datetime.date.today().isoformat(),
        "file": os.path.abspath(source_path),
        "sha256": sha,
        "chopmap": chopmap,
    }
    os.makedirs(os.path.dirname(os.path.abspath(record_path)), exist_ok=True)
    from .audio import sanitize_json

    with open(record_path, "w", encoding="utf-8") as f:
        json.dump(sanitize_json(record), f, indent=2, allow_nan=False)
        f.write("\n")
