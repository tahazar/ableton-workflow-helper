"""M11c: pitch-tagging for the sample library (`awh samples pitch-tag`).

Separate, OPT-IN enrichment pass on top of the M11 base index — same shape
as `clapembed.py`'s relationship to `samplescan.py`: the base `awh samples
index` scan stays fast for every file (hats, vocals, melodic loops, where a
single fundamental isn't a meaningful concept), and this module runs the
heavier `pitch.py` periodicity tracker only on files the CLI has already
decided are pitch-tag CANDIDATES (one-shots whose energy is dominated by the
low band — kicks/subs/808s/bass hits; see `packages/cli/src/samples.ts`'s
`isPitchTagCandidate`).

Built to close a real gap found live (2026-08-23): after using `mix pitch`
to correctly identify a Reese patch's real fundamental during a masking
investigation, the owner asked whether the same tool could tag kicks/subs in
the sample library so a matching kick could be FOUND by key instead of
guessed from a filename.

`pitch_for_sample(path)` reuses `pitch.analyze_segment` (the lower-level,
already-loaded-buffer entry point) rather than `pitch.pitch()`'s top-level
convenience wrapper — `pitch.pitch()` loads via `audio.load`, which has a
1 s minimum-duration floor that's wrong for short one-shots (the exact
reason `samplescan.py` has its own `load_for_scan` instead of using
`audio.load` too). Loading here goes through that same
`samplescan.load_for_scan` for consistency — a kick sample decodes exactly
once, the same way, regardless of which pass is scanning it.
"""

from __future__ import annotations

from typing import Any

from . import pitch
from .audio import to_mono
from .samplescan import load_for_scan

# Bumped whenever the pitch-tagging algorithm/output shape changes materially
# enough that already-tagged entries should be re-tagged — the TS side
# (`runPitchTag`) treats a stored `pitch_analysis_version` below this as
# stale, same spirit as `clapembed`'s model-label staleness key.
PITCH_ANALYSIS_VERSION = 1


def pitch_for_sample(path: str) -> dict[str, Any]:
    """One pitch-tag record for `path`. Never raises — any failure (missing
    file, corrupt/unsupported codec, empty audio, a too-short-to-analyze
    clip) is caught and returned as a record with `unreadable: True` (decode
    failures) or a `state` other than `"voiced"` (too-short/no periodicity
    found — a normal outcome for a broadband kick, not a failure)."""
    try:
        samples, sr = load_for_scan(path)
    except Exception as exc:  # noqa: BLE001 — decode failure is a record, not a crash
        return {"path": path, "unreadable": True, "error": str(exc)}

    if samples.size == 0 or samples.shape[0] == 0:
        return {"path": path, "unreadable": True, "error": "file decoded to zero audio frames"}

    try:
        mono = to_mono(samples)
        result = pitch.analyze_segment(mono, sr)
        return {
            "path": path,
            "unreadable": False,
            "error": None,
            "pitch_analysis_version": PITCH_ANALYSIS_VERSION,
            **result,
        }
    except Exception as exc:  # noqa: BLE001 — a DSP-stage failure is still "unreadable", not a crash
        return {"path": path, "unreadable": True, "error": f"analysis failed: {exc}"}
