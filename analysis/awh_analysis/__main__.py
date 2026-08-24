"""CLI entry point: `python -m awh_analysis <report|ab|target> ...`."""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import soundfile as sf

from . import a2m, ab, advise as advise_mod, bands, clapembed, drumstats, duck, opmatch, pitch, pumpcheck, ref, report, samplepitch, samplescan, targets


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




def _cmd_a2m(args: argparse.Namespace) -> int:
    result = a2m.transcribe(
        args.file,
        onset_thresh=args.onset_thresh,
        frame_thresh=args.frame_thresh,
        min_note_len_ms=args.min_len,
        min_freq=args.min_freq,
        max_freq=args.max_freq,
        melodia_trim=not args.no_melodia_trim,
    )
    if args.json:
        _print_json(result)
    else:
        print(f"{result['n_notes']} notes ({result['model']})")
        for n in result["notes"]:
            print(
                f"  {n['start_s']:7.3f}s +{n['dur_s']:6.3f}s  "
                f"pitch={n['pitch']:3d}  vel={n['velocity']:3d}"
            )
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


def _render_pitch_segment_text(seg: dict, indent: str = "") -> list[str]:
    if seg["state"] != "voiced":
        return [f"{indent}state: {seg['state']} (no stable pitch)"]
    note = seg["note"]
    lines = [
        f"{indent}f0 {seg['f0_hz']:.1f} Hz -> {note['name']} ({note['cents']:+.0f} cents)  "
        f"voiced {seg['voiced_fraction'] * 100:.0f}%  confidence {seg['confidence']:.2f}  "
        f"stability {_fmt(seg['f0_stability_semitones'], 2)} semitones",
    ]
    dom = seg["harmonic_dominance"]
    if dom["flagged"]:
        lines.append(
            f"{indent}!! harmonic {dom['harmonic']} exceeds the fundamental by "
            f"{dom['ratio_db']:.1f} dB at {_fmt(dom['time_s'], 2)}s "
            f"({dom['fraction_of_voiced_frames'] * 100:.0f}% of voiced frames) — "
            "the fundamental is still reported above via periodicity tracking, "
            "not the loudest partial"
        )
    return lines


def _render_pitch_text(result: dict) -> str:
    lines = [
        f"File: {result['file']}  ({result['samplerate']} Hz, {result['duration_s']:.2f} s)",
        "",
    ] + _render_pitch_segment_text(result)
    if "notes" in result:
        lines += ["", f"Per-note ({len(result['notes'])} note(s), onset-segmented):"]
        if not result["notes"]:
            lines.append("  (no clean onsets detected)")
        for i, n in enumerate(result["notes"]):
            lines.append(f"  [{i}] {n['start_s']:.3f}s - {n['end_s']:.3f}s")
            lines += _render_pitch_segment_text(n, indent="      ")
    return "\n".join(lines)


def _cmd_pitch(args: argparse.Namespace) -> int:
    result = pitch.pitch(
        args.file,
        start_s=args.from_,
        end_s=args.to,
        per_note=args.per_note,
    )
    if args.json:
        _print_json(result)
    else:
        print(_render_pitch_text(result))
    return 0


def _render_bands_text(result: dict) -> str:
    files = result["files"]
    multi = len(files) > 1
    lines = [f"calibration: {result['calibration']}", ""]
    header = f"{'band':<14s} {'range':<14s}" + "".join(
        f"{'  ' + f['file']:>22s}" for f in files
    )
    lines.append(header)
    labels = [b["label"] for b in files[0]["bands"]]
    for idx, label in enumerate(labels):
        row = f"{label:<14s} "
        b0 = files[0]["bands"][idx]
        range_text = f"{b0['lo_hz']:g}-{b0['hi_hz']:g}Hz"
        row += f"{range_text:<14s}"
        for f in files:
            b = f["bands"][idx]
            cell = f"{_fmt(b['dbfs'], 1)} dBFS"
            if multi and b.get("delta_db") is not None:
                cell += f" ({b['delta_db']:+.1f})"
            row += f"{cell:>22s}"
        lines.append(row)
    lines.append("")
    for f in files:
        lines.append(
            f"{f['file']}: "
            + ", ".join(f"{b['label']}={b['fraction_of_total'] * 100:.0f}%" for b in f["bands"])
            + "  (fraction of total signal power)"
        )
    return "\n".join(lines)


def _cmd_bands(args: argparse.Namespace) -> int:
    result = bands.compare_files(args.files, bands_spec=args.bands, start_s=args.from_, end_s=args.to)
    if args.json:
        _print_json(result)
    else:
        print(_render_bands_text(result))
    return 0


def _render_opmatch_text(result: dict) -> str:
    a = result["analysis"]
    f0 = a["f0"]
    lines = [
        f"tier {result['tier']}: {result['summary']}",
        "",
        f"f0: {_fmt(f0['hz'], 1)} Hz  drift {_fmt(f0['drift_semitones'], 2)} semitones  "
        f"voiced {f0['voiced_fraction'] * 100:.0f}%",
        f"harmonicity ratio: {a['harmonicity_ratio']:.2f}  "
        f"partial deviation: {_fmt(a['partial_deviation_semitones'], 2)} semitones  "
        f"noise floor ratio: {a['noise_floor_ratio']:.2f}",
        f"ADSR fit: attack {a['adsr']['attack_s'] * 1000:.0f}ms  decay {a['adsr']['decay_s'] * 1000:.0f}ms  "
        f"sustain {a['adsr']['sustain_db']:.1f}dB  release {a['adsr']['release_s'] * 1000:.0f}ms  "
        f"(r^2={a['adsr']['r_squared']:.2f})",
        f"centroid: {a['centroid']['direction']} "
        f"({_fmt(a['centroid']['start_hz'], 0)} -> {_fmt(a['centroid']['end_hz'], 0)} Hz)",
    ]
    if result["tier"] == 3:
        lines.append("")
        lines.append("reasons:")
        for r in result["reasons"]:
            lines.append(f"  - {r}")
        return "\n".join(lines)

    p = result["proposal"]
    lines += [
        "",
        f"oscillator: {p['oscillator']['waveform']} (residual {p['oscillator']['residual']:.2f})",
        f"envelope target: attack {p['envelope']['attack_s'] * 1000:.0f}ms  "
        f"decay {p['envelope']['decay_s'] * 1000:.0f}ms  sustain {p['envelope']['sustain_db']:.1f}dB  "
        f"release {p['envelope']['release_s'] * 1000:.0f}ms  (fit r^2={p['envelope']['fit_r_squared']:.2f})",
        f"filter: {p['filter']['direction']}",
        "",
        "drawThesePartials (16 normalized amplitudes, hand-draw in Operator's "
        "harmonics editor if the stock-wave residual above is high):",
        "  " + ", ".join(f"{v:.2f}" for v in p["drawThesePartials"]),
        "",
        f"addressable (raw device.param values, HEURISTIC — see caveat): "
        f"{', '.join(f'{k}={v:.3f}' for k, v in p['addressable'].items())}",
        f"  {p['addressable_caveat']}",
    ]
    return "\n".join(lines)


def _cmd_opmatch(args: argparse.Namespace) -> int:
    result = opmatch.match(args.file)
    if args.json:
        _print_json(result)
    else:
        print(_render_opmatch_text(result))
    return 0


def _cmd_opcompare(args: argparse.Namespace) -> int:
    result = opmatch.compare(args.ref, args.cand)
    if args.json:
        _print_json(result)
    else:
        print(
            f"log-spectrogram L2: {result['log_spectrogram_l2']:.3f}  "
            f"harmonic cosine: {_fmt(result['harmonic_cosine'], 3)}  "
            f"score: {result['score']:.3f} (1.0 = identical, ears decide the rest)"
        )
    return 0


def _render_drumstats_text(result: dict) -> str:
    grid = result["grid"]
    header = "position   " + "".join(f"{i:>5d}" for i in range(grid))
    lines = [
        f"dataset: {result['dataset']}  ({result['n_loops']} loop(s), "
        f"BPM {result['bpm_range'][0]:.0f}-{result['bpm_range'][1]:.0f}, "
        f"mean {result['bpm_mean']:.1f}, decode={result['mp3_decode_mode']})",
        "",
        "position-hit probability (% of bars with an onset at that grid step):",
        header,
    ]
    for band in ("low", "mid", "high"):
        b = result["per_band"][band]
        row = "".join(f"{round(p * 100):>5d}" for p in b["position_prob"])
        lines.append(f"{band:<10s} {row}")
    lines.append("")
    for band in ("low", "mid", "high"):
        b = result["per_band"][band]
        lines.append(
            f"{band:<5s} density {b['density']:.2f} onsets/bar ({b['onsets_total']} onsets total)"
        )
    lines.append("")
    sw = result["swing_estimate"]
    if sw["delay_frac_of_16th_step"] is not None:
        lines.append(
            f"swing (high band): off-16ths land {sw['delay_frac_of_16th_step'] * 100:+.1f}% of a "
            f"step vs on-8ths ({sw['delay_equivalent_beats']:+.3f} beats equiv.; "
            f"n={sw['n_on8_onsets']}/{sw['n_off16_onsets']})"
        )
    else:
        lines.append("swing: not enough high-band onsets to estimate")
    lines.append("")
    lines.append("assumptions:")
    for a in result["assumptions"]:
        lines.append(f"  - {a}")
    if result["skipped"]:
        lines.append("")
        lines.append("skipped files:")
        for s in result["skipped"]:
            lines.append(f"  - {s['file']}: {s['reason']}")
    return "\n".join(lines)


def _cmd_drumstats(args: argparse.Namespace) -> int:
    files = drumstats.find_audio_files(args.paths)
    dataset_name = args.dataset
    if dataset_name is None and len(args.paths) == 1 and os.path.isdir(args.paths[0]):
        dataset_name = os.path.basename(os.path.normpath(args.paths[0]))

    if not files:
        # Zero audio files found is a STATE, not an error (docs/lessons-learned.md #5).
        payload = {"dataset": dataset_name, "n_loops": 0, "files": []}
        if args.json:
            _print_json(payload)
        else:
            print(f"no audio files found in: {', '.join(args.paths)}")
        return 0

    result = drumstats.mine_drum_loops(
        files,
        bpm_from_name=not args.no_bpm_from_name,
        bpm=args.bpm,
        grid=args.grid,
        dataset_name=dataset_name,
    )
    if args.save_record:
        attribution = json.loads(args.attribution) if args.attribution else None
        drumstats.save_record(args.save_record, files, result, attribution=attribution)
    if args.json:
        _print_json(result)
    else:
        print(_render_drumstats_text(result))
    return 0


def _cmd_samplescan(args: argparse.Namespace) -> int:
    from .audio import sanitize_json

    files = list(args.files)
    if not files:
        files = [line.strip() for line in sys.stdin if line.strip()]
    for path in files:
        try:
            record = samplescan.scan_file(path)
        except Exception as exc:  # noqa: BLE001 — never crash the batch on one bad file
            record = {"path": path, "unreadable": True, "error": str(exc)}
        print(json.dumps(sanitize_json(record)))
    return 0


def _cmd_samplepitch(args: argparse.Namespace) -> int:
    from .audio import sanitize_json

    files = list(args.files)
    if not files:
        files = [line.strip() for line in sys.stdin if line.strip()]
    for path in files:
        try:
            record = samplepitch.pitch_for_sample(path)
        except Exception as exc:  # noqa: BLE001 — never crash the batch on one bad file
            record = {"path": path, "unreadable": True, "error": str(exc)}
        print(json.dumps(sanitize_json(record)))
    return 0


def _cmd_clapembed(args: argparse.Namespace) -> int:
    from .audio import sanitize_json

    if args.text is not None:
        record = clapembed.embed_text(args.text, model_key=args.model)
        print(json.dumps(sanitize_json({"text": args.text, "clap": record})))
        return 0

    files = list(args.files)
    if not files:
        files = [line.strip() for line in sys.stdin if line.strip()]
    for record in clapembed.embed_audio_batch(files, model_key=args.model):
        print(json.dumps(sanitize_json(record)))
    return 0


def _render_advise_text(result: dict) -> str:
    lines = [
        f"preset: {result['preset']}   target: {'yes' if result['has_target'] else 'no'}   "
        f"layers: {'yes' if result['has_layers'] else 'no'}",
        "",
    ]
    if result.get("healthy"):
        h = result["healthy"]
        lines.append(f"HEALTHY — {h['message']}")
        for m in h.get("marginal_metrics", []):
            lines.append(f"  closest to tripping: {m['id']}  margin {_fmt(m['margin'])} {m['unit']}")
        lines.append("")

    for it in result["items"]:
        header = f"#{it['rank']} [{it['stage']}] {it['id']}"
        if it["kind"] != "finding":
            header += f"  ({it['kind']})"
        lines.append(header)
        lines.append(f"  {it['issue']}")
        lines.append(f"  -> {it['action']}")
        if it["verify"] != "n/a":
            lines.append(f"  verify:  {it['verify']}")
        if it.get("blockedBy"):
            lines.append(f"  blockedBy: {it['blockedBy']}")
        if it["kind"] == "finding":
            lines.append(f"  confidence: {it['confidence']}   basis: {it['basis']}")
        lines.append("")

    if "compare" in result:
        lines.append("compare vs. saved advice record:")
        for c in result["compare"]:
            extra = ""
            if c["status"] in ("improved", "unchanged") and "old_magnitude" in c:
                extra = f"  ({_fmt(c['old_magnitude'])} -> {_fmt(c['new_magnitude'])})"
            lines.append(f"  [{c['status']:9s}] {c['id']}{extra}")
    return "\n".join(lines)


def _cmd_advise(args: argparse.Namespace) -> int:
    if bool(args.file) == bool(args.record):
        raise ValueError("advise requires exactly one of <file> or --record <path>")

    if args.record:
        record = advise_mod.load_json_record(args.record)
        measurements = record.get("measurements")
        if measurements is None:
            raise ValueError(
                f"{args.record} is not a mix-report measurement record (no 'measurements' field)"
            )
        source_label = args.record
    else:
        measurements = report.analyze(args.file)
        source_label = args.file

    target = targets.load_target(args.target) if args.target else None
    layers = advise_mod.load_json_record(args.layers) if args.layers else None

    result = advise_mod.advise(measurements, target, layers, args.preset)

    if args.save_record:
        advise_mod.save_advice_record(args.save_record, source_label, result)

    if args.compare:
        old_record = advise_mod.load_json_record(args.compare)
        result = {**result, "compare": advise_mod.compare_advice(old_record, result)}

    if args.json:
        _print_json(result)
    else:
        print(_render_advise_text(result))
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

    p_a2m = sub.add_parser("a2m", help="Melodic audio-to-MIDI transcription (Basic Pitch, ONNX)")
    p_a2m.add_argument("file")
    p_a2m.add_argument("--onset-thresh", type=float, default=0.5,
                       help="onset detection sensitivity (Basic Pitch default 0.5)")
    p_a2m.add_argument("--frame-thresh", type=float, default=0.3,
                       help="frame/pitch confidence threshold (Basic Pitch default 0.3)")
    p_a2m.add_argument("--min-len", type=float, default=127.70,
                       help="minimum note length in ms (Basic Pitch default 127.70)")
    p_a2m.add_argument("--min-freq", type=float, default=None,
                       help="ignore pitches below this frequency in Hz")
    p_a2m.add_argument("--max-freq", type=float, default=None,
                       help="ignore pitches above this frequency in Hz")
    p_a2m.add_argument("--no-melodia-trim", action="store_true",
                       help="disable the melodia post-processing trick (default: on)")
    p_a2m.add_argument("--json", action="store_true")
    p_a2m.set_defaults(func=_cmd_a2m)

    p_on = sub.add_parser("onsets", help="Detect drum onset times in an audio capture")
    p_on.add_argument("file")
    p_on.add_argument("--min-gap-ms", type=float, default=80.0)
    p_on.add_argument("--json", action="store_true")
    p_on.set_defaults(func=_cmd_onsets)

    p_pitch = sub.add_parser(
        "pitch",
        help="Periodicity-tracked f0 (pyin) with honest harmonic-dominance reporting "
        "— never a naive FFT-peak pick",
    )
    p_pitch.add_argument("file")
    p_pitch.add_argument("--per-note", action="store_true",
                         help="segment via onset detection and report f0 per note")
    p_pitch.add_argument("--from", dest="from_", type=float, default=None)
    p_pitch.add_argument("--to", type=float, default=None)
    p_pitch.add_argument("--json", action="store_true")
    p_pitch.set_defaults(func=_cmd_pitch)

    p_bands = sub.add_parser(
        "bands",
        help="Calibrated per-band dBFS via Welch PSD (masking-diagnosis narrowband "
        "compare); multiple files -> aligned table with deltas vs. the first",
    )
    p_bands.add_argument("files", nargs="+")
    p_bands.add_argument("--bands", type=str, default=None,
                         help=f'comma-separated "lo-hi" Hz ranges (default: "{bands.DEFAULT_BANDS_ARG}")')
    p_bands.add_argument("--from", dest="from_", type=float, default=None)
    p_bands.add_argument("--to", type=float, default=None)
    p_bands.add_argument("--json", action="store_true")
    p_bands.set_defaults(func=_cmd_bands)

    p_drumstats = sub.add_parser(
        "drumstats",
        help="Mine band-split rhythm statistics (16th-grid position probabilities) from a folder of drum loops",
    )
    p_drumstats.add_argument("paths", nargs="+", help="audio files and/or directories (scanned non-recursively)")
    p_drumstats.add_argument(
        "--bpm", type=float, default=None,
        help="fixed BPM used as a fallback (or for every file with --no-bpm-from-name)",
    )
    p_drumstats.add_argument(
        "--no-bpm-from-name", action="store_true",
        help="disable parsing BPM from loop filenames (e.g. '138bpm_...') — requires --bpm",
    )
    p_drumstats.add_argument("--grid", type=int, default=drumstats.DEFAULT_GRID,
                             help="grid steps per bar (default 16 = 16th notes)")
    p_drumstats.add_argument("--dataset", type=str, default=None,
                             help="dataset name for the output (default: single input directory's basename)")
    p_drumstats.add_argument("--save-record", type=str, default=None,
                             help="also write a drum-stats measurement record JSON to this path")
    p_drumstats.add_argument("--attribution", type=str, default=None,
                             help="JSON object embedded verbatim in --save-record's 'attribution' field")
    p_drumstats.add_argument("--json", action="store_true")
    p_drumstats.set_defaults(func=_cmd_drumstats)

    p_opmatch = sub.add_parser(
        "opmatch", help="Analyze a sample and propose an Operator patch (tiered by reachability)"
    )
    p_opmatch.add_argument("file")
    p_opmatch.add_argument("--json", action="store_true")
    p_opmatch.set_defaults(func=_cmd_opmatch)

    p_opcompare = sub.add_parser(
        "opcompare", help="Compare a reference capture against a candidate (verify closed loop)"
    )
    p_opcompare.add_argument("ref")
    p_opcompare.add_argument("cand")
    p_opcompare.add_argument("--json", action="store_true")
    p_opcompare.set_defaults(func=_cmd_opcompare)

    p_samplescan = sub.add_parser(
        "samplescan",
        help="Scan sample files -> one JSONL feature record per line (M11 sample library)",
    )
    p_samplescan.add_argument(
        "files", nargs="*",
        help="file paths (or read newline-separated paths from stdin if omitted)",
    )
    p_samplescan.set_defaults(func=_cmd_samplescan)

    p_samplepitch = sub.add_parser(
        "samplepitch",
        help="Pitch-tag sample files (M11c) -> one JSONL f0/note/voiced-fraction record per line",
    )
    p_samplepitch.add_argument(
        "files", nargs="*",
        help="file paths (or read newline-separated paths from stdin if omitted)",
    )
    p_samplepitch.set_defaults(func=_cmd_samplepitch)

    p_clapembed = sub.add_parser(
        "clapembed",
        help="CLAP audio/text embeddings for semantic sample search (M11b) -> JSONL per file, "
        "or one JSON object with --text",
    )
    p_clapembed.add_argument(
        "files", nargs="*",
        help="audio file paths (or read newline-separated paths from stdin if omitted)",
    )
    p_clapembed.add_argument("--model", choices=clapembed.MODEL_CHOICES, default=clapembed.DEFAULT_MODEL,
                             help="CLAP checkpoint: music (default, music-tuned) or general (AudioSet)")
    p_clapembed.add_argument("--text", type=str, default=None,
                             help="embed this text phrase instead of the file list")
    p_clapembed.set_defaults(func=_cmd_clapembed)

    p_target = sub.add_parser("target", help="Build a genre/reference target")
    p_target.add_argument("files", nargs="+")
    p_target.add_argument("--save", type=str, required=True)
    p_target.add_argument("--records-dir", type=str, default=None,
                          help="also write a per-source measurement record into this directory")
    p_target.add_argument("--json", action="store_true")
    p_target.set_defaults(func=_cmd_target)

    p_advise = sub.add_parser(
        "advise",
        help="Deterministic rule-based mix advice (M13): a ranked, cited, verifiable plan",
    )
    p_advise.add_argument(
        "file", nargs="?", default=None, help="audio capture to measure (omit with --record)"
    )
    p_advise.add_argument(
        "--record", type=str, default=None,
        help="a saved mix-report measurement record path instead of re-measuring a capture",
    )
    p_advise.add_argument(
        "--target", type=str, default=None,
        help="genre target path (library/targets/<name>.json) — unlocks the tonal-balance stage",
    )
    p_advise.add_argument(
        "--layers", type=str, default=None,
        help="a saved mix-layers record path — unlocks the inter-element masking stage",
    )
    p_advise.add_argument("--preset", choices=["club", "streaming", "apple"], default="club")
    p_advise.add_argument(
        "--compare", type=str, default=None,
        help="a previously-saved advice record path to diff this run against",
    )
    p_advise.add_argument("--save-record", type=str, default=None,
                          help="also write an advice record JSON to this path")
    p_advise.add_argument("--json", action="store_true")
    p_advise.set_defaults(func=_cmd_advise)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except (ValueError, FileNotFoundError, OSError, sf.SoundFileError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
