"""Mix advisor: a deterministic rule engine over `report.analyze`'s
measurement dict. It never re-measures; it reuses the same pipeline `mix
report` uses, so a saved report record and a fresh capture produce identical advice
for identical numbers).

Design: docs/design/mix-advisor.md. Every item is a measurement plus a
named move. Each one cites the numbers that triggered it, a
concrete Live move, an exact verify command, and a `basis` line pointing at
the research/precedent that justifies its threshold (no folklore numbers).

## The dependency ladder

Six fixed stages (`STAGES`), each one's problems can invalidate measurements
and moves made in later stages, so ranking is by stage first, not raw
severity:

  1. integrity: true peak / inter-sample clipping / extreme asymmetry
  2. phase: low-band L/R correlation
  3. masking: inter-element collisions (needs a `--layers` record)
  4. tonal: spectral tilt vs. target or per-band EQ (needs `--target`)
  5. dynamics: PSR (limiter squash)
  6. loudness: LUFS-I vs. delivery preset

## The rule table

Each entry in `RULES` is a `Rule`: id, stage, a `measure(ctx)` function that
returns zero or more `Hit`s (each carrying whether it fires, its evidence
dict, a scalar `magnitude` (how far past the threshold, used for ranking
and for `--compare`'s improved/unchanged split), and rendered issue/action/
verify text), a fixed `confidence`, and a `basis` citation string. Plural
rules (masking, per-band EQ) return one Hit per instance; scalar rules
return zero or one.
"""

from __future__ import annotations

import datetime
import math
import os
import re
from dataclasses import dataclass, field
from typing import Any, Callable

from . import report as report_mod
from . import targets as targets_mod

STAGES = ["integrity", "phase", "masking", "tonal", "dynamics", "loudness"]
STAGE_INDEX = {name: i for i, name in enumerate(STAGES)}

# ---------------------------------------------------------------------------
# Thresholds. Every one cites a basis in the Rule it belongs to below.
# Reused directly from existing modules where one already exists (never a
# second, drifting copy of the same number).
# ---------------------------------------------------------------------------

TRUE_PEAK_CEILING_DBTP = report_mod.DBTP_DELIVERY_MAX  # -1.0, report.py precedent
INTER_SAMPLE_CLIP_DBTP = 0.0  # digital full scale: oversampled peak > 0 dBTP is a genuine over
# "Extreme" asymmetry: report.py already flags waveform asymmetry >= 3 dB
# (ASYMMETRY_FLAG_DB) as worth a phase-rotation *opportunity* note (stage-4-
# ish, informational). Integrity needs a stricter bar: beyond what natural
# asymmetric material shows (research doc: up to ~6 dB is normal for voice/
# brass/saw bass) is a DC-offset/clipping red flag, not a headroom trick.
# Chosen as 2x report.py's own threshold, reusing report.py's own "escalate
# to alert at 2x the base threshold" convention (see report.findings' target
# band severity split) rather than inventing an unrelated number.
EXTREME_ASYMMETRY_DB = 2.0 * report_mod.ASYMMETRY_FLAG_DB  # 6.0

LOW_CORR_THRESHOLD = report_mod.LOW_CORR_WARN_THRESHOLD  # 0.8, report.py precedent

# Masking (stage 3): "comparable energy" reuses targets.py's own flag-delta
# convention (3 dB) rather than inventing a second number for the same
# "this counts as different" judgment call. "Significant" presence is left
# open by the design doc. Using fraction of the
# capture's total signal power (not an absolute dBFS) keeps it independent
# of how hot each layer capture happened to be gain-staged.
MASKING_COMPARABLE_DB = targets_mod.BAND_FLAG_MIN_DELTA_DB  # 3.0
MASKING_SIGNIFICANT_FRACTION = 0.05
MASKING_BAND_LABELS = ("sub", "low", "scoop zone")

TILT_FLAG_DEVIATION = report_mod.TILT_FLAG_DEVIATION  # 1.5 dB/oct, report.py precedent
TILT_BAND_SIGN_MIN_COUNT = 4  # design doc's literal "≥4 same-signed band deltas"
EQ_CAP_DB = 3.0  # design doc's literal "min(|delta|, 3) dB" cap
EQ_BAND_ITEM_CAP = 5  # report.py's own flagged[:5] + "N more" precedent

PSR_ALERT_THRESHOLD = report_mod.PSR_ALERT_THRESHOLD  # 8.0, Ian Shepherd guideline

DELIVERY_PRESETS = report_mod.DELIVERY_PRESETS
DEFAULT_PRESET = "club"

# --compare resolution: "meaningfully changed" epsilon per rule id (spec
# leaves the resolution granularity open): chosen per rule's own unit scale
# rather than one universal number across dB/LU/correlation
# units of very different magnitude).
COMPARE_EPS = {
    "true-peak-ceiling": 0.1,
    "extreme-asymmetry": 0.3,
    "low-band-correlation": 0.02,
    "layer-masking": 0.3,
    "spectral-tilt-vs-target": 0.1,
    "eq-band": 0.2,
    "psr-low": 0.3,
    "lufs-delivery": 0.2,
}
DEFAULT_COMPARE_EPS = 0.1


def _finite(v: Any) -> bool:
    return isinstance(v, (int, float)) and math.isfinite(v)


def _sign(v: float) -> int:
    return 1 if v > 0 else (-1 if v < 0 else 0)


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


# ---------------------------------------------------------------------------
# Context + Hit/Rule shapes
# ---------------------------------------------------------------------------


@dataclass
class Ctx:
    measurements: dict
    target: dict | None
    layers: dict | None
    preset: str
    target_comparison: list[dict] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.target is not None:
            self.target_comparison = targets_mod.compare_to_target(self.measurements, self.target)


@dataclass
class Hit:
    fires: bool
    evidence: dict
    issue: str
    action: str
    verify: str
    magnitude: float  # how far past threshold; used for ranking + --compare
    item_id: str  # full id (may have a per-instance suffix for plural rules)


@dataclass
class Rule:
    id: str
    stage: str
    confidence: str
    basis: str
    unit: str
    measure: Callable[[Ctx], list[Hit]]


# ---------------------------------------------------------------------------
# Stage 1: integrity
# ---------------------------------------------------------------------------


def _measure_true_peak(ctx: Ctx) -> list[Hit]:
    tp = ctx.measurements["loudness"]["true_peak_db"]
    if not _finite(tp):
        return []
    fires = tp > TRUE_PEAK_CEILING_DBTP
    # bool(...): `tp` is frequently a numpy float64, and `numpy.bool_` (the
    # comparison result) isn't JSON-serializable even through sanitize_json,
    # so saving an advice record would fail. Cast to a real Python bool.
    inter_sample = bool(tp > INTER_SAMPLE_CLIP_DBTP)
    evidence = {
        "true_peak_db": tp,
        "ceiling_dbtp": TRUE_PEAK_CEILING_DBTP,
        "inter_sample_clip": inter_sample,
    }
    if inter_sample:
        issue = (
            f"true peak is {tp:.2f} dBTP — over 0 dBTP means inter-sample peaks are "
            f"clipping in the digital domain, not just close to the delivery ceiling."
        )
    else:
        issue = (
            f"true peak is {tp:.2f} dBTP, above the {TRUE_PEAK_CEILING_DBTP:.1f} dBTP "
            f"safe delivery ceiling."
        )
    return [
        Hit(
            fires=fires,
            evidence=evidence,
            issue=issue,
            action=(
                "Lower the limiter's output ceiling to -1.0 dBTP (or reduce input gain "
                "into the limiter) before anything downstream is measured — headroom first."
            ),
            verify=(
                "awh mix capture --bars 8 -o after.wav && awh mix report after.wav "
                "(true peak should read <= -1.0 dBTP)"
            ),
            magnitude=tp - TRUE_PEAK_CEILING_DBTP,
            item_id="true-peak-ceiling",
        )
    ]


def _measure_extreme_asymmetry(ctx: Ctx) -> list[Hit]:
    asym_list = ctx.measurements["dynamics"]["asymmetry"]
    values = [abs(a["ratio_db"]) for a in asym_list if _finite(a.get("ratio_db"))]
    if not values:
        return []
    max_asym = max(values)
    evidence = {"max_asymmetry_db": max_asym, "threshold_db": EXTREME_ASYMMETRY_DB}
    return [
        Hit(
            fires=max_asym > EXTREME_ASYMMETRY_DB,
            evidence=evidence,
            issue=(
                f"waveform asymmetry is {max_asym:.1f} dB — beyond the ~6 dB typical of "
                f"naturally asymmetric sources (voice/brass/saw bass), which usually means "
                f"DC offset or one-sided clipping rather than benign source asymmetry."
            ),
            action=(
                "Check for DC offset (Utility's DC filter) and inspect the waveform for "
                "one-sided flattening on the loudest element before trusting any "
                "downstream measurement."
            ),
            verify=(
                "re-capture after removing DC offset / clipping and awh mix report "
                "(waveform asymmetry should fall back toward the source's natural range)"
            ),
            magnitude=max_asym - EXTREME_ASYMMETRY_DB,
            item_id="extreme-asymmetry",
        )
    ]


# ---------------------------------------------------------------------------
# Stage 2: phase
# ---------------------------------------------------------------------------


def _measure_low_band_correlation(ctx: Ctx) -> list[Hit]:
    corr = ctx.measurements["stereo"]["correlation"].get("low")
    if not _finite(corr):
        return []
    evidence = {"low_band_r": corr, "threshold": LOW_CORR_THRESHOLD}
    return [
        Hit(
            fires=corr < LOW_CORR_THRESHOLD,
            evidence=evidence,
            issue=(
                f"kick and bass are partially cancelling below 120 Hz (low-band L/R "
                f"correlation {corr:.2f}, below {LOW_CORR_THRESHOLD:.1f})"
            ),
            action=(
                "Utility on the bass group: Bass Mono at 120 Hz; if the low end thins, "
                "nudge kick or bass phase instead (Serum/sampler phase knob or a short nudge)"
            ),
            verify=(
                "awh mix capture --bars 8 -o after.wav && awh mix report after.wav "
                "(low-band correlation should read >= 0.8)"
            ),
            magnitude=LOW_CORR_THRESHOLD - corr,
            item_id="low-band-correlation",
        )
    ]


# ---------------------------------------------------------------------------
# Stage 3: masking (needs a saved `mix layers` record)
# ---------------------------------------------------------------------------


def _masking_candidates(layers: dict, band_label: str) -> list[tuple[dict, dict]]:
    files = layers.get("bands", {}).get("files", [])
    out = []
    for f in files:
        for b in f.get("bands", []):
            if (
                b.get("label") == band_label
                and _finite(b.get("dbfs"))
                and (b.get("fraction_of_total") or 0.0) >= MASKING_SIGNIFICANT_FRACTION
            ):
                out.append((f, b))
    return out


def _measure_layer_masking(ctx: Ctx) -> list[Hit]:
    if not ctx.layers:
        return []
    tracks = ctx.layers.get("tracks", [])
    name_by_file = {t.get("file"): t.get("trackName") for t in tracks if t.get("file")}

    hits: list[Hit] = []
    for band_label in MASKING_BAND_LABELS:
        candidates = _masking_candidates(ctx.layers, band_label)
        best: dict | None = None
        for i in range(len(candidates)):
            for j in range(i + 1, len(candidates)):
                fi, bi = candidates[i]
                fj, bj = candidates[j]
                diff = abs(bi["dbfs"] - bj["dbfs"])
                if diff <= MASKING_COMPARABLE_DB and (best is None or diff < best["diff"]):
                    best = {
                        "band": band_label,
                        "lo_hz": bi["lo_hz"],
                        "hi_hz": bi["hi_hz"],
                        "a_file": fi.get("file"),
                        "b_file": fj.get("file"),
                        "a_dbfs": bi["dbfs"],
                        "b_dbfs": bj["dbfs"],
                        "diff": diff,
                    }
        if best is None:
            continue
        layer_a = name_by_file.get(best["a_file"], best["a_file"])
        layer_b = name_by_file.get(best["b_file"], best["b_file"])
        evidence = {
            "band": best["band"],
            "lo_hz": best["lo_hz"],
            "hi_hz": best["hi_hz"],
            "layer_a": layer_a,
            "layer_a_dbfs": best["a_dbfs"],
            "layer_b": layer_b,
            "layer_b_dbfs": best["b_dbfs"],
            "diff_db": best["diff"],
            "threshold_db": MASKING_COMPARABLE_DB,
        }
        hits.append(
            Hit(
                fires=True,
                evidence=evidence,
                issue=(
                    f'"{layer_a}" and "{layer_b}" carry comparable energy in the '
                    f"{best['band']} band ({best['lo_hz']:.0f}-{best['hi_hz']:.0f} Hz): "
                    f"{best['a_dbfs']:.1f} vs {best['b_dbfs']:.1f} dBFS "
                    f"({best['diff']:.1f} dB apart) — likely masking each other."
                ),
                action=(
                    f"Carve one out of the {best['band']} band: EQ Eight cut on the "
                    f"weaker element (or the one that doesn't need this range), or "
                    f"sidechain the quieter one to duck under the louder one in this band."
                ),
                verify=(
                    f"re-capture both layers (awh mix layers ...) and awh mix bands the "
                    f"results — the {best['band']} band gap should widen past "
                    f"{MASKING_COMPARABLE_DB:.1f} dB"
                ),
                magnitude=MASKING_COMPARABLE_DB - best["diff"],
                item_id=f"layer-masking-{_slug(best['band'])}",
            )
        )
    return hits


# ---------------------------------------------------------------------------
# Stage 4: tonal balance (needs --target). Tilt-vs-bands exclusivity is
# enforced by the engine (advise()), not here: the eq-band rule is
# not run for a pass where the tilt rule already fired.
# ---------------------------------------------------------------------------


def _measure_spectral_tilt(ctx: Ctx) -> list[Hit]:
    if not ctx.target:
        return []
    target_tilt = ctx.target.get("tilt", {}).get("median")
    tilt = ctx.measurements["spectrum"]["tilt_db_per_oct"]
    if not _finite(target_tilt) or not _finite(tilt):
        return []
    tilt_error = tilt - target_tilt
    flagged = [b for b in ctx.target_comparison if b["flagged"]]
    same_sign = [b for b in flagged if _sign(b["delta_db"]) == _sign(tilt_error)]
    fires = abs(tilt_error) > TILT_FLAG_DEVIATION and len(same_sign) >= TILT_BAND_SIGN_MIN_COUNT
    evidence = {
        "tilt_db_per_oct": tilt,
        "target_tilt_db_per_oct": target_tilt,
        "deviation_db_per_oct": tilt_error,
        "threshold_db_per_oct": TILT_FLAG_DEVIATION,
        "aligned_band_count": len(same_sign),
    }
    direction = (
        "cut highs with a broad shelf above ~4-8 kHz"
        if tilt_error > 0
        else "boost presence with a broad bell in the 2-6 kHz range"
    )
    return [
        Hit(
            fires=fires,
            evidence=evidence,
            issue=(
                f"spectral tilt is {tilt:+.1f} dB/oct vs the target's {target_tilt:+.1f} "
                f"dB/oct ({tilt_error:+.1f} dB/oct off) — {len(same_sign)} flagged bands "
                f"move in the SAME direction, so this is a broad tonal trend, not isolated "
                f"bands."
            ),
            action=(
                f"EQ Eight on master: {direction} to bring the overall tilt back toward "
                f"the target — fix this BEFORE chasing individual bands; a single broad "
                f"move often resolves most of the per-band deltas below."
            ),
            verify=(
                "awh mix capture --bars 8 -o after.wav && awh mix report after.wav "
                "--target <name> (tilt should move back within "
                f"{TILT_FLAG_DEVIATION:.1f} dB/oct of target, and previously-flagged "
                "bands should shrink)"
            ),
            magnitude=abs(tilt_error) - TILT_FLAG_DEVIATION,
            item_id="spectral-tilt-vs-target",
        )
    ]


def _measure_eq_bands(ctx: Ctx) -> list[Hit]:
    if not ctx.target:
        return []
    flagged = [b for b in ctx.target_comparison if b["flagged"]]
    flagged.sort(key=lambda b: abs(b["delta_db"]), reverse=True)
    hits: list[Hit] = []
    shown = flagged[:EQ_BAND_ITEM_CAP]
    for b in shown:
        freq = b["freq"]
        delta = b["delta_db"]
        threshold = b["threshold_db"]
        capped = min(abs(delta), EQ_CAP_DB)
        evidence = {
            "freq_hz": freq,
            "delta_db": delta,
            "threshold_db": threshold,
            "capped_amount_db": capped,
        }
        direction_word = "above" if delta > 0 else "below"
        move_word = "cut" if delta > 0 else "boost"
        hits.append(
            Hit(
                fires=True,
                evidence=evidence,
                issue=(
                    f"{freq:.0f} Hz band is {abs(delta):.1f} dB {direction_word} the target "
                    f"(threshold {threshold:.1f} dB)."
                ),
                action=(
                    f"EQ Eight on master: {move_word} ~{capped:.1f} dB around {freq:.0f} Hz "
                    "— one conservative pass, re-measure, repeat if the delta remains."
                ),
                verify=(
                    "awh mix capture --bars 8 -o after.wav && awh mix report after.wav "
                    f"--target <name> ({freq:.0f} Hz band delta should shrink toward 0)"
                ),
                magnitude=abs(delta) - threshold,
                item_id=f"eq-band-{round(freq)}hz",
            )
        )
    if len(flagged) > EQ_BAND_ITEM_CAP:
        remaining = len(flagged) - EQ_BAND_ITEM_CAP
        hits.append(
            Hit(
                fires=True,
                evidence={"remaining_bands": remaining},
                issue=f"{remaining} additional band(s) also deviate from the target beyond threshold.",
                action="See the full target_comparison list for every flagged band.",
                verify="n/a",
                magnitude=0.0,
                item_id="eq-band-more",
            )
        )
    return hits


# ---------------------------------------------------------------------------
# Stage 5: dynamics
# ---------------------------------------------------------------------------


def _measure_psr(ctx: Ctx) -> list[Hit]:
    psr_min = ctx.measurements["loudness"]["psr"].get("min_psr_loud")
    if not _finite(psr_min):
        return []
    evidence = {"psr_min_loud": psr_min, "threshold": PSR_ALERT_THRESHOLD}
    return [
        Hit(
            fires=psr_min < PSR_ALERT_THRESHOLD,
            evidence=evidence,
            issue=(
                f"PSR (peak-to-short-term-loudness) is {psr_min:.1f} in the loudest "
                f"section, below the PSR >= {PSR_ALERT_THRESHOLD:.0f} clean-loudness guideline."
            ),
            action=(
                "Raise the limiter's output ceiling or reduce input gain into the limiter "
                "— the mix is being squashed harder than it needs to be."
            ),
            verify=(
                "awh mix capture --bars 8 -o after.wav && awh mix report after.wav "
                "(PSR in the loudest section should read >= 8)"
            ),
            magnitude=PSR_ALERT_THRESHOLD - psr_min,
            item_id="psr-low",
        )
    ]


# ---------------------------------------------------------------------------
# Stage 6: loudness/delivery, last (re-measure after stages 1-5)
# ---------------------------------------------------------------------------


def _measure_lufs_delivery(ctx: Ctx) -> list[Hit]:
    preset_cfg = DELIVERY_PRESETS.get(ctx.preset)
    if preset_cfg is None:
        return []
    lufs_i = ctx.measurements["loudness"]["lufs_integrated"]
    if not _finite(lufs_i):
        return []

    note = (
        " Fixing stages 1-5 above changes loudness — re-measure this after acting on "
        "any earlier item, not before."
    )
    if "lufs_lo" in preset_cfg:
        lo, hi = preset_cfg["lufs_lo"], preset_cfg["lufs_hi"]
        fires = lufs_i < lo or lufs_i > hi
        delta = (lufs_i - hi) if lufs_i > hi else (lufs_i - lo)
        evidence = {"lufs_integrated": lufs_i, "range_lo": lo, "range_hi": hi, "delta_lu": delta}
        issue = (
            f"{ctx.preset} targets {lo:.0f}..{hi:.0f} LUFS-I; measured {lufs_i:.1f} LUFS-I "
            f"({delta:+.1f} LU outside the target range)." + note
        )
        magnitude = abs(delta)
    else:
        target_lufs = preset_cfg["lufs_target"]
        tol = preset_cfg["lufs_tolerance"]
        delta = lufs_i - target_lufs
        fires = abs(delta) > tol
        evidence = {
            "lufs_integrated": lufs_i,
            "target_lufs": target_lufs,
            "tolerance_lu": tol,
            "delta_lu": delta,
        }
        issue = (
            f"{ctx.preset} targets {target_lufs:.0f} LUFS-I (+/-{tol:.0f}); measured "
            f"{lufs_i:.1f} LUFS-I ({delta:+.1f} LU off target)." + note
        )
        magnitude = abs(delta) - tol

    return [
        Hit(
            fires=fires,
            evidence=evidence,
            issue=issue,
            action=(
                "Turn the master gain/limiter input up or down to hit the delivery "
                f"target ({ctx.preset}); streaming services normalize anyway, so avoid "
                "over-limiting just to chase loudness."
            ),
            verify=(
                "awh mix capture --bars 8 -o after.wav && awh mix report after.wav "
                f"--delivery {ctx.preset} (LUFS-I should land inside the target)"
            ),
            magnitude=magnitude,
            item_id="lufs-delivery",
        )
    ]


# ---------------------------------------------------------------------------
# The rule table
# ---------------------------------------------------------------------------

RULES: list[Rule] = [
    Rule(
        id="true-peak-ceiling",
        stage="integrity",
        confidence="high",
        basis=(
            "docs/research/data-driven-mixing.md (true peak <= -1 dBTP delivery ceiling); "
            "report.py DBTP_DELIVERY_MAX"
        ),
        unit="dBTP",
        measure=_measure_true_peak,
    ),
    Rule(
        id="extreme-asymmetry",
        stage="integrity",
        confidence="medium",
        basis=(
            "docs/research/data-driven-mixing.md (asymmetric sources show up to ~6 dB "
            "natural asymmetry); threshold = 2x report.py's own ASYMMETRY_FLAG_DB "
            "alert-escalation convention"
        ),
        unit="dB",
        measure=_measure_extreme_asymmetry,
    ),
    Rule(
        id="low-band-correlation",
        stage="phase",
        confidence="high",
        basis=(
            "docs/research/data-driven-mixing.md phase/mono-compatibility guidance; "
            "report.py LOW_CORR_WARN_THRESHOLD"
        ),
        unit="correlation",
        measure=_measure_low_band_correlation,
    ),
    Rule(
        id="layer-masking",
        stage="masking",
        confidence="medium",
        basis=(
            "docs/design/analysis-engine.md's masking toolkit + "
            "docs/research/data-driven-mixing.md's masking/attention-model precedent "
            "(Gullfoss); comparable-energy threshold reuses targets.py's "
            "BAND_FLAG_MIN_DELTA_DB=3.0 dB convention"
        ),
        unit="dB",
        measure=_measure_layer_masking,
    ),
    Rule(
        id="spectral-tilt-vs-target",
        stage="tonal",
        confidence="medium",
        basis=(
            "docs/design/mix-advisor.md's tilt-vs-bands rule; report.py "
            "TILT_FLAG_DEVIATION=1.5; docs/research/data-driven-mixing.md's Pestana et "
            "al. spectral-tilt figure"
        ),
        unit="dB/oct",
        measure=_measure_spectral_tilt,
    ),
    Rule(
        id="eq-band",
        stage="tonal",
        confidence="medium",
        basis=(
            "targets.py compare_to_target (|delta| > max(3dB, IQR)); "
            "docs/research/data-driven-mixing.md genre-target-comparison precedent "
            "(iZotope Tonal Balance Control method)"
        ),
        unit="dB",
        measure=_measure_eq_bands,
    ),
    Rule(
        id="psr-low",
        stage="dynamics",
        confidence="high",
        basis=(
            "docs/research/data-driven-mixing.md (Ian Shepherd's PSR >= 8 guideline, a "
            "BS.1770-validated crest proxy); loudness.py PSR_ALERT_THRESHOLD"
        ),
        unit="PSR",
        measure=_measure_psr,
    ),
    Rule(
        id="lufs-delivery",
        stage="loudness",
        confidence="high",
        basis=(
            "docs/research/data-driven-mixing.md streaming/club loudness targets table; "
            "report.py DELIVERY_PRESETS"
        ),
        unit="LU",
        measure=_measure_lufs_delivery,
    ),
]

RULE_BY_ID = {r.id: r for r in RULES}


# ---------------------------------------------------------------------------
# Placeholders (missing inputs): not rule-table entries (no measurement to
# trigger on), but first-class ranked items per the design doc.
# ---------------------------------------------------------------------------


def _placeholder_missing_target() -> dict:
    return {
        "id": "missing-target",
        "kind": "placeholder",
        "stage": "tonal",
        "evidence": {},
        "issue": "no measured target — tonal-balance comparison is skipped.",
        "action": (
            "Run `awh mix target <refs...> --save <name>` against your OWN reference "
            "tracks (never pink noise), then re-run `awh mix advise --target <name>`."
        ),
        "verify": "n/a",
        "confidence": "n/a",
        "basis": "docs/design/mix-advisor.md Inputs section",
        "magnitude": 0.0,
    }


def _placeholder_missing_layers() -> dict:
    return {
        "id": "missing-layers",
        "kind": "placeholder",
        "stage": "masking",
        "evidence": {},
        "issue": "no saved mix-layers record — inter-element masking checks are skipped.",
        "action": (
            "Run `awh mix layers <track:N> <track:M>... --save <name>` on the layers "
            "you suspect are competing, then re-run `awh mix advise --layers <name>`."
        ),
        "verify": "n/a",
        "confidence": "n/a",
        "basis": "docs/design/mix-advisor.md Inputs section",
        "magnitude": 0.0,
    }


# ---------------------------------------------------------------------------
# Engine: run rules, rank, link blockedBy, or report the healthy state.
# ---------------------------------------------------------------------------


def _hit_to_item(rule: Rule, hit: Hit) -> dict:
    return {
        "id": hit.item_id,
        "kind": "info" if hit.item_id == "eq-band-more" else "finding",
        "stage": rule.stage,
        "evidence": hit.evidence,
        "issue": hit.issue,
        "action": hit.action,
        "verify": hit.verify,
        "confidence": rule.confidence,
        "basis": rule.basis,
        "magnitude": hit.magnitude,
    }


def _margin_probes(ctx: Ctx) -> list[dict]:
    """Every scalar rule's magnitude, evaluated unconditionally (fires or
    not). The raw material for the healthy-mix state's "two most marginal
    metrics". Plural rules (masking, per-band EQ) are excluded: a margin
    list is a scalar-meter concept, not a per-band/per-layer-pair one.
    """
    out = []
    for rule in RULES:
        if rule.id in ("layer-masking", "eq-band"):
            continue
        for hit in rule.measure(ctx):
            out.append(
                {
                    "id": hit.item_id,
                    "unit": rule.unit,
                    "margin": -hit.magnitude,
                    "evidence": hit.evidence,
                }
            )
    return out


def advise(
    measurements: dict, target: dict | None, layers: dict | None, preset: str | None
) -> dict:
    """Run the full rule table and return the ranked plan.

    Deterministic: a pure function of (measurements, target, layers, preset).
    Same inputs always produce the same item list/order/text.
    """
    preset = preset or DEFAULT_PRESET
    ctx = Ctx(measurements=measurements, target=target, layers=layers, preset=preset)

    items: list[dict] = []

    for rule in RULES:
        if rule.id == "eq-band":
            continue  # decided below, after the tilt rule (exclusivity)
        for hit in rule.measure(ctx):
            if hit.fires:
                items.append(_hit_to_item(rule, hit))

    # Tilt-vs-bands exclusivity: only run the per-band EQ rule if the tilt
    # rule did not fire this pass.
    tilt_fired = any(it["id"] == "spectral-tilt-vs-target" for it in items)
    if not tilt_fired:
        eq_rule = RULE_BY_ID["eq-band"]
        for hit in eq_rule.measure(ctx):
            if hit.fires:
                items.append(_hit_to_item(eq_rule, hit))

    if target is None:
        items.append(_placeholder_missing_target())
    if layers is None:
        items.append(_placeholder_missing_layers())

    # Rank: stage order first (the dependency ladder is the ranking), then
    # worst-first within a stage, then id for a fully deterministic tie-break.
    items.sort(key=lambda it: (STAGE_INDEX[it["stage"]], -it["magnitude"], it["id"]))
    for i, it in enumerate(items):
        it["rank"] = i + 1

    # blockedBy: a "finding" is blocked by every other finding in a strictly
    # earlier stage. Placeholders/info items neither block nor are blocked:
    # they're not measured problems, just missing inputs/footnotes.
    finding_ranks_by_stage: dict[int, list[int]] = {}
    for it in items:
        if it["kind"] == "finding":
            finding_ranks_by_stage.setdefault(STAGE_INDEX[it["stage"]], []).append(it["rank"])
    for it in items:
        if it["kind"] != "finding":
            it["blockedBy"] = []
            continue
        my_stage = STAGE_INDEX[it["stage"]]
        blocked_by = []
        for s in range(my_stage):
            blocked_by.extend(finding_ranks_by_stage.get(s, []))
        it["blockedBy"] = sorted(blocked_by)

    actionable = [it for it in items if it["kind"] == "finding"]
    healthy = None
    if not actionable:
        probes = _margin_probes(ctx)
        probes.sort(key=lambda p: p["margin"])
        healthy = {
            "message": "nothing actionable at these thresholds.",
            "marginal_metrics": [
                {"id": p["id"], "margin": p["margin"], "unit": p["unit"], "evidence": p["evidence"]}
                for p in probes[:2]
            ],
        }

    return {
        "preset": preset,
        "has_target": target is not None,
        "has_layers": layers is not None,
        "items": items,
        "healthy": healthy,
    }


# ---------------------------------------------------------------------------
# --compare: resolved / improved / unchanged / new, per item id.
# ---------------------------------------------------------------------------


def compare_advice(old_record: dict, new_result: dict) -> list[dict]:
    """Per-item resolution between a previously-saved advice record and a
    freshly-run `advise()` result. Categories: resolved (old id no longer
    appears), improved (still fires but the magnitude shrank past the
    rule's epsilon), unchanged (still fires, ~same or worse; there is no
    separate "regressed" bucket, so a worse magnitude folds into
    "unchanged" with the before/after numbers shown),
    new (an id that wasn't in the old record at all).
    """
    old_items = {it["id"]: it for it in old_record.get("items", [])}
    new_items = {it["id"]: it for it in new_result.get("items", [])}

    out: list[dict] = []
    for id_, old in old_items.items():
        eps = COMPARE_EPS.get(_base_rule_id(id_), DEFAULT_COMPARE_EPS)
        new = new_items.get(id_)
        if new is None:
            out.append(
                {
                    "id": id_,
                    "status": "resolved",
                    "old_evidence": old.get("evidence"),
                    "new_evidence": None,
                }
            )
            continue
        old_mag = old.get("magnitude", 0.0)
        new_mag = new.get("magnitude", 0.0)
        if new_mag <= old_mag - eps:
            status = "improved"
        else:
            status = "unchanged"
        out.append(
            {
                "id": id_,
                "status": status,
                "old_magnitude": old_mag,
                "new_magnitude": new_mag,
                "old_evidence": old.get("evidence"),
                "new_evidence": new.get("evidence"),
            }
        )
    for id_, new in new_items.items():
        if id_ not in old_items:
            out.append(
                {
                    "id": id_,
                    "status": "new",
                    "old_evidence": None,
                    "new_evidence": new.get("evidence"),
                }
            )

    order = {"resolved": 0, "improved": 1, "new": 2, "unchanged": 3}
    out.sort(key=lambda c: (order.get(c["status"], 9), c["id"]))
    return out


def _base_rule_id(item_id: str) -> str:
    if item_id.startswith("eq-band"):
        return "eq-band"
    if item_id.startswith("layer-masking"):
        return "layer-masking"
    return item_id


# ---------------------------------------------------------------------------
# Record I/O: same library/measurements/ convention as report.save_record,
# with kind="advice" (mix records/kb index branch on `kind`; see index.ts).
# ---------------------------------------------------------------------------


def save_advice_record(record_path: str, source_label: str, result: dict) -> None:
    record = {
        "schema": 1,
        "kind": "advice",
        "saved": datetime.date.today().isoformat(),
        "source": source_label,
        "preset": result["preset"],
        "has_target": result["has_target"],
        "has_layers": result["has_layers"],
        "items": result["items"],
        "healthy": result["healthy"],
    }
    os.makedirs(os.path.dirname(os.path.abspath(record_path)), exist_ok=True)
    from .audio import sanitize_json

    with open(record_path, "w", encoding="utf-8") as f:
        import json

        json.dump(sanitize_json(record), f, indent=2, allow_nan=False)
        f.write("\n")


def load_json_record(path: str) -> dict:
    import json

    with open(path, encoding="utf-8") as f:
        return json.load(f)
