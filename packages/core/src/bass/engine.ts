/**
 * M16 808 bass engine: generate808 turns a Bass808Spec (see spec.ts) + a
 * song-key root into a full melodic-rhythmic 808 bassline. Pinned semantics:
 * docs/design/bass-808.md.
 *
 * The glide contract is the point: `slide: true` steps are emitted LEGATO —
 * extended to overlap the next sounding note's start by exactly
 * `slideOverlapBeats` — so any mono synth with glide (an 808 plugin, Serum
 * mono, the `operator-recipe-glide-bass` knowledge entry) slides exactly
 * where the pattern says. `--slides off` (opts.slides = false) trims every
 * step to its written length instead — plain gates, zero overlaps.
 */
import type { NoteSpec } from "../bridge/types.js";
import { clampPitch, sortNotes } from "../transforms/types.js";
import { makeRng } from "../transforms/rng.js";
import { pickWeighted } from "../phrase/util.js";
import { fitPitchToRegister } from "../phrase/util.js";
import type { Bass808Cell, Bass808Spec } from "./spec.js";

/** 808 bass is 4/4 only today (same convention as the arp engine — see
 *  docs/design/arp-engine.md — the CLI exposes no --sig for `awh bass 808`). */
export const BASS808_BEATS_PER_BAR = 4;

export interface GenerateBass808Options {
  seed: number;
  /** Force a specific cell (index into listBass808Variants) for every
   *  non-turnaround bar. Turnaround bars ignore this — see spec.ts. */
  variant?: number;
  /** Total bars to generate. */
  bars: number;
  /** Legato glide overlaps on `slide: true` steps. Default true. */
  slides?: boolean;
}

export interface GeneratedBass808 {
  notes: NoteSpec[];
  /** root/seed/bars/slides/cellDraws — the CLI adds style/tier on top. */
  meta: Record<string, string>;
}

function clampVelocity(v: number): number {
  return Math.max(1, Math.min(127, Math.round(v)));
}

interface PlacedStep {
  /** Absolute beat position (bar * BASS808_BEATS_PER_BAR + bar-local pos, swing-adjusted). */
  start: number;
  len: number;
  degree: number;
  slide: boolean;
  /** Bar-local pos, BEFORE swing — used for the beat-1 accent check. */
  isBarFirst: boolean;
}

/**
 * Generate a full 808 bassline spanning `opts.bars` bars from `spec`, with
 * `rootPitchClass` (0-11, e.g. from resolveKey's ScaleContext.rootNote)
 * octave-fitted into `spec.register` ONCE for the whole pattern. Every
 * step's pitch is `root + degree` — degrees are NOT re-folded into the
 * register (pinned: register fits the ROOT only). Deterministic: same
 * spec + rootPitchClass + opts => byte-identical notes.
 */
export function generate808(
  spec: Bass808Spec,
  rootPitchClass: number,
  opts: GenerateBass808Options,
): GeneratedBass808 {
  if (!Number.isInteger(opts.bars) || opts.bars < 1) {
    throw new Error(`generate808: bars must be a positive integer (got ${opts.bars})`);
  }
  const slidesOn = opts.slides ?? true;
  const rng = makeRng(opts.seed);
  const root = fitPitchToRegister(rootPitchClass, spec.register);

  const cellDraws: string[] = [];
  const placed: PlacedStep[] = [];

  for (let bar = 0; bar < opts.bars; bar++) {
    const useTurnaround =
      spec.turnaroundBar > 0 &&
      (bar + 1) % spec.turnaroundBar === 0 &&
      spec.turnaroundCells.length > 0;
    const pool = useTurnaround ? spec.turnaroundCells : spec.cells;

    let cell: Bass808Cell;
    if (!useTurnaround && opts.variant !== undefined) {
      const idx = ((opts.variant % spec.cells.length) + spec.cells.length) % spec.cells.length;
      cell = spec.cells[idx]!;
    } else {
      cell = pickWeighted(pool, rng);
    }
    cellDraws.push(cell.name);

    const barStart = bar * BASS808_BEATS_PER_BAR;
    for (const step of cell.steps) {
      // Open-detail (unstated by the design beyond the schema field): swing
      // nudges the "and" of a beat (bar-local pos with a 0.5 fractional
      // part) later by `spec.swing` beats — same drum-engine convention as
      // arp/drums' swing. All three built-ins ship swing: 0, so this is
      // inert for them; it exists for schema completeness only.
      const swungPos = Math.abs((step.pos % 1) - 0.5) < 1e-9 ? step.pos + spec.swing : step.pos;
      placed.push({
        start: barStart + swungPos,
        len: step.len,
        degree: step.degree,
        slide: step.slide ?? false,
        isBarFirst: step.pos === 0,
      });
    }
  }

  placed.sort((a, b) => a.start - b.start);

  const notes: NoteSpec[] = placed.map((step, i) => {
    const pitch = clampPitch(root + step.degree);
    const velocity = clampVelocity(
      spec.velocity.base + (step.isBarFirst ? spec.velocity.accentFirst : 0),
    );

    let duration = step.len;
    if (slidesOn && step.slide) {
      const next = placed[i + 1];
      // Bar-crossing works for free: `next` is drawn from the same globally
      // time-sorted array regardless of which bar it's in. A slide on the
      // very last placed step (no successor at all) falls back to its
      // written length (duration already defaults to step.len above).
      if (next) {
        duration = next.start - step.start + spec.slideOverlapBeats;
      }
    }

    return { pitch, start: step.start, duration, velocity };
  });

  return {
    notes: sortNotes(notes),
    meta: {
      seed: String(opts.seed),
      bars: String(opts.bars),
      slides: slidesOn ? "on" : "off",
      root: String(root),
      cellDraws: cellDraws.join(","),
    },
  };
}
