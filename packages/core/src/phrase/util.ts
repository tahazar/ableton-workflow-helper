/**
 * Shared timing/pitch helpers for the phrase engine (recipes.ts + phrase.ts).
 * Kept separate from recipes.ts so both it and phrase.ts can share them
 * without a circular import.
 */
import type { NoteSpec } from "../bridge/types.js";
import type { ScaleContext } from "../transforms/types.js";
import { clampPitch, sortNotes } from "../transforms/types.js";
import { shiftDegrees, snapToScale } from "../transforms/scales.js";
import type { CallCell } from "./spec.js";

/** Phrase engine is 4/4 only (see docs/design/phrase-engine.md). */
export const PHRASE_BEATS_PER_BAR = 4;

export function callEndBeat(notes: NoteSpec[]): number {
  return notes.reduce((max, n) => Math.max(max, n.start + n.duration), 0);
}

export function callStartBeat(notes: NoteSpec[]): number {
  return notes.length === 0 ? 0 : Math.min(...notes.map((n) => n.start));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function medianPitch(notes: NoteSpec[]): number {
  return median(notes.map((n) => n.pitch));
}

/** Weighted pick from a list of {weight}; consumes exactly one rng() draw. */
export function pickWeighted<T extends { weight: number }>(items: T[], rng: () => number): T {
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  const draw = rng() * total;
  let cumulative = 0;
  for (const item of items) {
    cumulative += item.weight;
    if (draw < cumulative) return item;
  }
  return items[items.length - 1]!;
}

/** Round up to the next whole bar (never below one bar). */
export function ceilToBar(beats: number, beatsPerBar: number = PHRASE_BEATS_PER_BAR): number {
  const bars = Math.max(1, Math.ceil((beats - 1e-9) / beatsPerBar));
  return bars * beatsPerBar;
}

/**
 * Octave-fold a pitch into a register by repeated +/-12 shifts (never
 * transposes by anything other than whole octaves), then hard-clamps if the
 * register itself is narrower than an octave.
 */
export function fitPitchToRegister(pitch: number, register: readonly [number, number]): number {
  let p = pitch;
  let guard = 0;
  while (p < register[0] && guard++ < 20) p += 12;
  while (p > register[1] && guard++ < 20) p -= 12;
  return Math.max(register[0], Math.min(register[1], Math.round(p)));
}

/** Octave-fold into `register`, then snap to `scale`, re-folding if the snap nudged it out. */
export function repitchLow(pitch: number, scale: ScaleContext, register: readonly [number, number]): number {
  const folded = fitPitchToRegister(pitch, register);
  const snapped = snapToScale(folded, scale);
  return fitPitchToRegister(snapped, register);
}

/** All MIDI pitches in `register` whose (pitch - root) mod 12 is one of `resolveDegrees`. */
export function resolveDegreePitches(
  register: readonly [number, number],
  rootNote: number,
  resolveDegrees: number[],
): number[] {
  const chromas = new Set(resolveDegrees.map((d) => ((Math.round(d) % 12) + 12) % 12));
  const pitches: number[] = [];
  for (let p = register[0]; p <= register[1]; p++) {
    const chroma = ((p - rootNote) % 12 + 12) % 12;
    if (chromas.has(chroma)) pitches.push(p);
  }
  return pitches;
}

/** Nearest candidate to `target` (ties broken toward the lower pitch). */
export function nearestPitch(target: number, candidates: number[]): number {
  if (candidates.length === 0) return clampPitch(target);
  return candidates.reduce((best, p) =>
    Math.abs(p - target) < Math.abs(best - target) ||
    (Math.abs(p - target) === Math.abs(best - target) && p < best)
      ? p
      : best,
  );
}

/**
 * Generate one bar's worth of call pitches for `cell` (one pitch per onset):
 * a bounded scale-degree walk starting near the register's middle. Consumes
 * one rng() draw per onset after the first, so is deterministic and
 * reproducible per seed.
 */
export function generateCallPitches(
  cell: CallCell,
  register: readonly [number, number],
  scale: ScaleContext,
  rng: () => number,
): number[] {
  const mid = Math.round((register[0] + register[1]) / 2);
  let current = fitPitchToRegister(snapToScale(mid, scale), register);
  const pitches: number[] = [current];
  for (let i = 1; i < cell.beats.length; i++) {
    const stepDegrees = Math.floor(rng() * 5) - 2; // -2..+2 scale degrees
    current = fitPitchToRegister(shiftDegrees(current, stepDegrees, scale), register);
    pitches.push(current);
  }
  return pitches;
}

export function callCellToNotes(cell: CallCell, pitches: number[], velocity = 100): NoteSpec[] {
  return sortNotes(
    cell.beats.map((b, i) => ({ pitch: pitches[i]!, start: b, duration: cell.lengths[i]!, velocity })),
  );
}
