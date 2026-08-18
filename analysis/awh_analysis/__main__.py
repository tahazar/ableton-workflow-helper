"""CLI entry point: `python -m awh_analysis <report|ab|target> ...`."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

import soundfile as sf

from . import ab, duck, pumpcheck, ref, report, targets


def _print_json(obj: Any) -> None:
    from .audio import sanitize_json

    # allow_nan=False + sanitize: -inf/nan become null instead of the
    # invalid-JSON Infinity tokens that crash strict parsers (Node).
    print(json.dumps(sanitize_json(obj), indent=2, allow_nan=False))


def _fmt(v: Any, digits: int = 2) -> str:
    if v is None:
        return "n/a"
    if isinstance(v, float):
        if v != v:  # NaN
            return "n/a"
        if v == float("inf"):
            return "+inf"
        if v == float("-inf"):
            return "-inf"
        return f"{v:.{digits}f}"
    return str(v)


def _render_findings_text(finding_list: list[dict]) -> str:
    if not finding_list:
        return "  (no findings)"
    lines = []
    for f in finding_list:
        lines.append(
            f"  [{f['severity'].upper():5s}] {f['id']}: {f['metric']} = "
            f"{_fmt(f['value'])} (threshold {_fmt(f['threshold'])})"
        )
        lines.append(f"           {f['explanation']}")
        lines.append(f"           -> {f['suggestion']}")
    return "\n".join(lines)


def _render_report_text(measurements: dict, finding_list: list[dict]) -> str:
    loud = measurements["loudness"]
    spec = measurements["spectrum"]
    st = measurements["stereo"]
    lines = [
        f"File: {measurements['file']}  ({measurements['samplerate']} Hz, "
        f"{measurements['channels']} ch, {measurements['duration_s']:.2f} s)",
        "",
        "Loudness:",
        f"  LUFS-I           {_fmt(loud['lufs_integrated'])} LUFS",
        f"  True peak        {_fmt(loud['true_peak_db'])} dBTP",
        f"  PSR (min, loud)  {_fmt(loud['psr'].get('min_psr_loud'))}",
        "",
        "Spectrum:",
        f"  Tilt             {_fmt(spec['tilt_db_per_oct'])} dB/oct",
        "",
        "Stereo:",
        f"  Width            {_fmt(st['width_db'])} dB",
        f"  Correlation      full={_fmt(st['correlation']['full'])} "
        f"low={_fmt(st['correlation']['low'])}",
        "",
        "Findings:",
        _render_findings_text(finding_list),
    ]
    return "\n".join(lines)


def _cmd_report(args: argparse.Namespace) -> int:
    target = targets.load_target(args.target) if args.target else None
    measurements = report.analyze(
        args.file,
        bpm=args.bpm,
        target=target,
        start_s=args.from_,
        end_s=args.to,
    )
    finding_list = report.findings(measurements, delivery=args.delivery)
    if args.save_record:
        report.save_record(args.save_record, args.file, measurements, finding_list)
    if args.quiet:
        pass
    elif args.json:
        _print_json({"measurements": measurements, "findings": finding_list})
    else:
        print(_render_report_text(measurements, finding_list))
    return 0


def _cmd_ab(args: argparse.Namespace) -> int:
    result = ab.ab_compare(args.a, args.b, bpm=args.bpm)
    if args.json:
        _print_json(result)
    else:
        lines = [
            f"A: {result['file_a']}  B: {result['file_b']}",
            f"Matched to {result['lufs_matched_to']:.2f} LUFS-I "
            f"(gain A {result['gain_applied_db']['a']:+.2f} dB, "
            f"gain B {result['gain_applied_db']['b']:+.2f} dB)",
            "",
            "Deltas (B - A):",
        ]
        for k, v in result["deltas"].items():
            lines.append(f"  {k:20s} {_fmt(v)}")
        lines.append("")
        lines.append("Changed findings:")
        lines.append(_render_findings_text(result["changed_findings"]))
        print("\n".join(lines))
    return 0


def _cmd_target(args: argparse.Namespace) -> int:
    target = targets.build_target(args.files)
    targets.save_target(target, args.save)
    if args.records_dir:
        import os

        from . import report as report_mod

        os.makedirs(args.records_dir, exist_ok=True)
        for path in args.files:
            m = report_mod.analyze(path)
            f = report_mod.findings(m)
            name = report_mod.record_slug(path)
            report_mod.save_record(os.path.join(args.records_dir, f"{name}.json"), path, m, f)
    if args.json:
        _print_json(target)
    else:
        print(f"Saved target ({len(target['sources'])} source(s)) -> {args.save}")
        print(f"  tilt   median={_fmt(target['tilt']['median'])} dB/oct")
        print(f"  LUFS-I median={_fmt(target['lufs_integrated']['median'])}")
    return 0




def _cmd_duck(args: argparse.Namespace) -> int:
    from . import audio

    triggers = [float(t) for t in args.triggers.split(",") if t.strip()]
    x, sr = audio.load(args.file)
    if args.cycle:
        duration_s = x.shape[0] / sr
        tiled = []
        k = 0
        while k * args.cycle < duration_s:
            tiled.extend(t + k * args.cycle for t in triggers)
            k += 1
        triggers = [t for t in tiled if t < duration_s]
    bass_x = bass_sr = None
    if args.bass:
        bass_x, bass_sr = audio.load(args.bass)
    result = duck.fit_duck_envelope(
        x, sr, triggers, bass=bass_x, bass_sr=bass_sr, depth_db=args.depth
    )
    if args.json:
        _print_json(result)
    else:
        rec = result["recommendation"]
        k = result["kick"]
        lines = []
        for w in result.get("warnings", []):
            lines.append(f"!! WARNING: {w}")
        if result.get("warnings"):
            lines.append("")
        lines += [
            f"Trigger-aligned duck fit ({result['used_triggers']} triggers, "
            f"window {result['window_ms']:.0f} ms)",
            "",
            f"Drums low band (<{k['low_band_hz']:.0f} Hz): peak at "
            f"{k['peak_time_ms']:.0f} ms, {k['peak_over_floor_db']:.1f} dB over the "
            f"between-hit floor; body ends {k['body_end_ms']:.0f} ms; "
            f"tail gone by {k['decay_done_ms']:.0f} ms",
            "",
            f"Recommended Volume Shaper envelope (per trigger):",
            f"  depth    {rec['depth_db']:.1f} dB   ({rec['depth_source']})",
            f"  attack   0 ms (instant — trigger-locked)",
            f"  hold     {rec['hold_ms']:.0f} ms at full depth",
            f"  release  {rec['release_ms']:.0f} ms, {rec['release_curve']} — fully "
            f"recovered by {rec['fully_recovered_by_ms']:.0f} ms "
            f"({100 * rec['fully_recovered_by_ms'] / result['window_ms']:.0f}% of the gap)",
            "",
            "Points to draw (time | % of trigger gap | gain | point type):",
            "  (Volume Shaper: LFO Length in ms = the trigger gap; MIDI Trigger On;",
            "   Snap off; sharp-corner points for the dip, smooth for the release.",
            "   Save to Favorites / LFO copy-paste to reuse across projects.)",
        ]
        for pt in rec["points"]:
            lines.append(
                f"  {pt['ms']:7.1f} ms  {100 * pt['frac']:5.1f}%  {pt['gain_db']:+6.2f} dB"
                f"  {pt.get('curve', '')}"
            )
        print("\n".join(lines))
    return 0




def _cmd_duckdepth(args: argparse.Namespace) -> int:
    from . import audio

    triggers = [float(t) for t in args.triggers.split(",") if t.strip()]
    x, sr = audio.load(args.file)
    if args.cycle:
        duration_s = x.shape[0] / sr
        tiled = []
        k = 0
        while k * args.cycle < duration_s:
            tiled.extend(t + k * args.cycle for t in triggers)
            k += 1
        triggers = [t for t in tiled if t < duration_s]
    result = duck.measure_duck_depth(x, sr, triggers)
    if args.json:
        _print_json(result)
    else:
        print(
            f"achieved duck: {result['depth_db']:.2f} dB deep, trough at "
            f"{result['trough_ms']:.0f} ms ({result['used_triggers']} triggers, "
            f"window {result['window_ms']:.0f} ms)"
        )
    return 0


def _cmd_pumpcheck(args: argparse.Namespace) -> int:
    from . import audio

    triggers = [float(t) for t in args.triggers.split(",") if t.strip()]
    x, sr = audio.load(args.file)
    if args.cycle:
        duration_s = x.shape[0] / sr
        tiled = []
        k = 0
        while k * args.cycle < duration_s:
            tiled.extend(t + k * args.cycle for t in triggers)
            k += 1
        triggers = [t for t in tiled if t < duration_s]
    result = pumpcheck.check_pump(x, sr, triggers)
    if args.json:
        _print_json(result)
    else:
        env = result["envelope"]
        fit = result["fitted"]
        lines = [
            f"Trigger-locked pump check ({result['used_triggers']} triggers, "
            f"window {result['window_ms']:.0f} ms)",
            "",
            f"Envelope: peak {env['peak_db']:.1f} dB, tail {env['tail_db']:.1f} dB "
            f"(span {env['peak_to_tail_db']:.1f} dB), minimum at {env['min_time_ms']:.0f} ms "
            f"({100 * env['min_fraction']:.0f}% into the window)",
            "",
            "Fitted duck model (instant dip / hold / exponential release):",
            f"  depth    {fit['depth_db']:.1f} dB",
            f"  hold     {fit['hold_ms']:.0f} ms",
            f"  release  tau {fit['release_tau_ms']:.0f} ms",
            f"  fit r^2  {fit['r_squared']:.2f}",
            "",
            f"Verdict: {result['verdict']}",
            f"  {result['evidence']}",
        ]
        if result["notes"]:
            lines.append("")
            lines.append("Notes:")
            for note in result["notes"]:
                lines.append(f"  - {note}")
        print("\n".join(lines))
    return 0


def _render_ref_text(result: dict) -> str:
    lines = [
        f"File: {result['file']}  ({result['duration_s']:.1f} s)",
        f"BPM: {result['bpm']:.2f}  (confidence {result['bpm_confidence']:.2f}"
        + (
            f", runner-up {result['bpm_runner_up']:.2f}"
            if result["bpm_runner_up"] is not None
            else ""
        )
        + ")",
        f"Beat offset: {result['beat_offset_s']:.3f} s  "
        f"(downbeat confidence {result['downbeat_confidence']:.2f})",
        f"Bars: {result['bar_count']}",
        "",
        "Sections:",
        f"  {'name':<10s} {'bars':<12s} {'conf':<5s} evidence",
    ]
    for s in result["sections"]:
        bars = f"{s['start_bar']}-{s['end_bar']}"
        lines.append(f"  {s['name']:<10s} {bars:<12s} {s['confidence']:<5.2f} {s['evidence']}")
    if result["notes"]:
        lines.append("")
        lines.append("Notes:")
        for note in result["notes"]:
            lines.append(f"  - {note}")
    return "\n".join(lines)


def _cmd_ref(args: argparse.Namespace) -> int:
    result = ref.analyze_reference(args.file, phrase_bars=args.phrase, hint_bpm=args.hint_bpm)
    if args.save_record:
        ref.save_reference_record(args.save_record, args.file, result)
    if args.json:
        _print_json(result)
    else:
        print(_render_ref_text(result))
    return 0




def _cmd_onsets(args: argparse.Namespace) -> int:
    from . import audio

    x, sr = audio.load(args.file)
    onsets = duck.detect_onsets(x, sr, min_gap_s=args.min_gap_ms / 1000.0)
    if args.json:
        _print_json({"file": args.file, "count": len(onsets), "onsets_s": onsets})
    else:
        print(f"{len(onsets)} onsets detected:")
        print(",".join(f"{t:.3f}" for t in onsets))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="awh_analysis")
    sub = parser.add_subparsers(dest="command", required=True)

    p_report = sub.add_parser("report", help="Analyze a single audio file")
    p_report.add_argument("file")
    p_report.add_argument("--bpm", type=float, default=None)
    p_report.add_argument("--target", type=str, default=None)
    p_report.add_argument("--delivery", choices=["club", "streaming", "apple"], default=None)
    p_report.add_argument("--from", dest="from_", type=float, default=None)
    p_report.add_argument("--to", dest="to", type=float, default=None)
    p_report.add_argument("--json", action="store_true")
    p_report.add_argument("--save-record", type=str, default=None,
                          help="also write a measurement record JSON to this path")
    p_report.add_argument("--quiet", action="store_true",
                          help="suppress stdout (for record-only runs)")
    p_report.set_defaults(func=_cmd_report)

    p_ab = sub.add_parser("ab", help="Loudness-matched A/B comparison")
    p_ab.add_argument("a")
    p_ab.add_argument("b")
    p_ab.add_argument("--bpm", type=float, default=None)
    p_ab.add_argument("--json", action="store_true")
    p_ab.set_defaults(func=_cmd_ab)

    p_duck = sub.add_parser("duck", help="Fit a sidechain duck envelope to the drums")
    p_duck.add_argument("file", help="drums (kick-dominant) audio capture")
    p_duck.add_argument("--triggers", type=str, required=True,
                        help="comma-separated trigger times in SECONDS (one cycle if --cycle)")
    p_duck.add_argument("--cycle", type=float, default=None,
                        help="trigger pattern cycle length in seconds — tiles the trigger "
                             "list across the whole file (capture must start on a cycle boundary)")
    p_duck.add_argument("--bass", type=str, default=None,
                        help="bass capture (same session/levels) for masking-based depth")
    p_duck.add_argument("--depth", type=float, default=None,
                        help="force duck depth in dB (skips the computed recommendation)")
    p_duck.add_argument("--json", action="store_true")
    p_duck.set_defaults(func=_cmd_duck)

    p_dd = sub.add_parser("duckdepth", help="Measure the achieved duck depth on a capture")
    p_dd.add_argument("file")
    p_dd.add_argument("--triggers", type=str, required=True)
    p_dd.add_argument("--cycle", type=float, default=None)
    p_dd.add_argument("--json", action="store_true")
    p_dd.set_defaults(func=_cmd_duckdepth)

    p_pump = sub.add_parser("pumpcheck", help="Trigger-locked sidechain-pump verification (fits the fixed duck model)")
    p_pump.add_argument("file", help="capture to check (ideally the isolated ducked bus)")
    p_pump.add_argument("--triggers", type=str, required=True,
                        help="comma-separated trigger times in SECONDS (one cycle if --cycle)")
    p_pump.add_argument("--cycle", type=float, default=None,
                        help="trigger pattern cycle length in seconds — tiles the trigger "
                             "list across the whole file (capture must start on a cycle boundary)")
    p_pump.add_argument("--json", action="store_true")
    p_pump.set_defaults(func=_cmd_pumpcheck)

    p_ref = sub.add_parser("ref", help="Analyze a reference track: tempo/grid, energy arc, section map")
    p_ref.add_argument("file")
    p_ref.add_argument("--phrase", type=int, default=4,
                       help="phrase length in bars for section boundary snapping (default 4)")
    p_ref.add_argument("--hint-bpm", type=float, default=None,
                       help="disambiguate half/double-time: matches the runner-up "
                            "within 2%% -> swap (never invents a tempo)")
    p_ref.add_argument("--save-record", type=str, default=None,
                       help="also write a reference-analysis record JSON to this path")
    p_ref.add_argument("--json", action="store_true")
    p_ref.set_defaults(func=_cmd_ref)

    p_on = sub.add_parser("onsets", help="Detect drum onset times in an audio capture")
    p_on.add_argument("file")
    p_on.add_argument("--min-gap-ms", type=float, default=80.0)
    p_on.add_argument("--json", action="store_true")
    p_on.set_defaults(func=_cmd_onsets)

    p_target = sub.add_parser("target", help="Build a genre/reference target")
    p_target.add_argument("files", nargs="+")
    p_target.add_argument("--save", type=str, required=True)
    p_target.add_argument("--records-dir", type=str, default=None,
                          help="also write a per-source measurement record into this directory")
    p_target.add_argument("--json", action="store_true")
    p_target.set_defaults(func=_cmd_target)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except (ValueError, FileNotFoundError, OSError, sf.SoundFileError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
