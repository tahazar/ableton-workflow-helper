/**
 * Arp engine: generateArp turns a chord progression (as a sequence of
 * time-spanned chord voicings) into an arpeggiated note stream, driven by an
 * ArpSpec (see spec.ts). Also home to two reusable rhythm utilities:
 * euclideanMask and chordsFromNotes (reads a chord clip, or reports "this
 * looks like a melody"). Pinned semantics: docs/design/arp-engine.md.
 *
 * A single global step counter `i` (0, 1, 2, ...) drives the contour's
 * pitch-pool index, the pattern position (`i mod patternLength`) that drives
 * accents/rests/ratchets, and the walk contour's rng draw. `i` never resets,
 * including across chord boundaries; only the pitch pool changes there
 * (voicing/octaves of whichever chord's span contains the step's time).
 * That one rule makes patternLength != bar length true polymeter (it wraps
 * on its own cycle regardless of chord changes) and lets chord boundaries
 * re-select the pool without resetting pattern position, with no separate
 * bookkeeping.
 */
import type { NoteSpec } from "../bridge/types.js";
import { sortNotes } from "../transforms/types.js";
import { makeRng } from "../transforms/rng.js";
import type { ArpContour, ArpSpec } from "./spec.js";
import { arpRateBeats } from "./spec.js";

/** Beats per bar assumed throughout the arp engine (the CLI exposes no --sig
 *  for `awh arp`; see docs/design/arp-engine.md's CLI section). */
export const ARP_BEATS_PER_BAR = 4;

// ---------------------------------------------------------------------------
// euclideanMask: shared rhythm utility
// ---------------------------------------------------------------------------

/**
 * Euclidean onset mask: exactly `k` onsets spread as evenly as possible over
 * `n` steps (the "Bresenham" bucket-transition construction: deterministic,
 * O(n), and degenerates sensibly at the edges: k<=0 -> all false, k>=n -> all
 * true). `rotate` shifts the pattern by that many steps (any integer,
 * normalized mod n).
 */
export function euclideanMask(k: number, n: number, rotate = 0): boolean[] {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`euclideanMask: n must be a positive integer (got ${n})`);
  }
  const bucket = (i: number): number => Math.floor((i * k) / n);
  const base = Array.from({ length: n }, (_, i) => bucket(i) !== bucket(i - 1));
  const rot = ((rotate % n) + n) % n;
  return Array.from({ length: n }, (_, i) => base[(i + rot) % n]!);
}

// ---------------------------------------------------------------------------
// chordsFromNotes: group a clip's notes into chords with spans, for the
// chord-clip arp source.
// ---------------------------------------------------------------------------

export interface ArpChordSpan {
  /** Ascending MIDI pitches. */
  pitches: number[];
  startBeat: number;
  endBeat: number;
}

export type ChordsFromNotesResult = { kind: "chords"; chords: ArpChordSpan[] } | { kind: "melody" };

const SIMULTANEOUS_EPS = 1e-6;

/**
 * Group simultaneous (same start-time, within epsilon) notes into chords
 * with spans covering the clip: each chord's span runs to the next group's
 * start, and the last group's span runs to its own longest note. A notes
 * list with no simultaneities anywhere (every group is a single note, or
 * there are no notes at all) returns { kind: "melody" }: a state, not a
 * degenerate one-note-chord result (docs/lessons-learned.md #5).
 */
export function chordsFromNotes(notes: NoteSpec[]): ChordsFromNotesResult {
  if (notes.length === 0) return { kind: "melody" };

  const sorted = [...notes].toSorted((a, b) => a.start - b.start || a.pitch - b.pitch);
  const groups: NoteSpec[][] = [];
  for (const note of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last[0]!.start - note.start) < SIMULTANEOUS_EPS) {
      last.push(note);
    } else {
      groups.push([note]);
    }
  }

  if (groups.every((g) => g.length === 1)) return { kind: "melody" };

  const chords: ArpChordSpan[] = groups.map((group, i) => {
    const pitches = [...new Set(group.map((n) => n.pitch))].toSorted((a, b) => a - b);
    const startBeat = group[0]!.start;
    const endBeat =
      i + 1 < groups.length
        ? groups[i + 1]![0]!.start
        : startBeat + Math.max(...group.map((n) => n.duration));
    return { pitches, startBeat, endBeat };
  });
  return { kind: "chords", chords };
}

// ---------------------------------------------------------------------------
// contour pitch-index sequences
// ---------------------------------------------------------------------------

/** One full cycle of pool indices for a non-walk, non-as-voiced contour. */
function contourCycle(
  contour: Exclude<ArpContour, "walk" | "as-voiced">,
  poolLen: number,
): number[] {
  if (poolLen <= 1) return [0];
  switch (contour) {
    case "up":
      return Array.from({ length: poolLen }, (_, i) => i);
    case "down":
      return Array.from({ length: poolLen }, (_, i) => poolLen - 1 - i);
    case "updown": {
      const up = Array.from({ length: poolLen }, (_, i) => i);
      const down = Array.from({ length: poolLen - 2 }, (_, i) => poolLen - 2 - i);
      return [...up, ...down];
    }
    case "downup": {
      const down = Array.from({ length: poolLen }, (_, i) => poolLen - 1 - i);
      const up = Array.from({ length: poolLen - 2 }, (_, i) => i + 1);
      return [...down, ...up];
    }
    case "converge": {
      const out: number[] = [];
      let lo = 0;
      let hi = poolLen - 1;
      let takeLow = true;
      while (lo <= hi) {
        if (lo === hi) {
          out.push(lo);
          break;
        }
        if (takeLow) {
          out.push(lo);
          lo++;
        } else {
          out.push(hi);
          hi--;
        }
        takeLow = !takeLow;
      }
      return out;
    }
    case "diverge":
      return [...contourCycle("converge", poolLen)].toReversed();
  }
}

// ---------------------------------------------------------------------------
// generateArp
// ---------------------------------------------------------------------------

export interface GenerateArpOptions {
  seed: number;
  /** Forces the euclid mask's rotation (see listArpVariants). */
  variant?: number;
  /** Total bars to generate. If the chords' own span is shorter, the chord
   *  sequence tiles (loops) to fill it; the step counter keeps advancing
   *  across loop boundaries (no reset), same as any other chord change. */
  bars: number;
}

export interface GeneratedArp {
  notes: NoteSpec[];
  /** contour/patternLength/seed/rotate; the CLI adds style/tier on top. */
  meta: Record<string, string>;
}

function clampVelocity(v: number): number {
  return Math.max(1, Math.min(127, Math.round(v)));
}

function findChordAt(chords: ArpChordSpan[], tLocal: number): ArpChordSpan {
  for (const chord of chords) {
    if (tLocal < chord.endBeat - 1e-9) return chord;
  }
  return chords[chords.length - 1]!;
}

/** Extend a chord's voicing upward by octave copies (1 = unchanged), sorted
 *  ascending: the pool every contour except as-voiced draws from. */
function poolWithOctaves(pitches: number[], octaves: number): number[] {
  const out: number[] = [];
  for (let o = 0; o < octaves; o++) {
    for (const p of pitches) out.push(p + 12 * o);
  }
  return out.toSorted((a, b) => a - b);
}

/**
 * Generate an arpeggiated note stream over `chords` (spans must start at 0
 * and be contiguous/ascending; the last span's endBeat defines one loop of
 * harmonic content) per `spec`, for `opts.bars` bars total (4 beats/bar).
 * Deterministic: same chords + spec + opts => byte-identical notes.
 */
export function generateArp(
  chords: ArpChordSpan[],
  spec: ArpSpec,
  opts: GenerateArpOptions,
): GeneratedArp {
  if (chords.length === 0) throw new Error("generateArp: chords must be non-empty");
  const cycleLen = chords[chords.length - 1]!.endBeat;
  if (cycleLen <= 0) throw new Error("generateArp: chords must have a positive total span");

  const totalBeats = opts.bars * ARP_BEATS_PER_BAR;
  const stepBeats = arpRateBeats(spec.rate);
  const stepCount = Math.floor(totalBeats / stepBeats + 1e-9);

  const rotate = opts.variant ?? spec.euclid.rotate;
  const mask = euclideanMask(spec.euclid.k, spec.euclid.n, rotate);
  const restSet = new Set(spec.rests);
  const accentSet = new Set(spec.velocity.accentSteps);

  const rng = makeRng(opts.seed);
  let walkIndex = 0;
  let walkInitialized = false;

  const notes: NoteSpec[] = [];

  for (let i = 0; i < stepCount; i++) {
    const t = i * stepBeats;
    const tLocal = ((t % cycleLen) + cycleLen) % cycleLen;
    const chord = findChordAt(chords, tLocal);
    const pool =
      spec.contour === "as-voiced"
        ? [...chord.pitches].toSorted((a, b) => a - b)
        : poolWithOctaves(chord.pitches, spec.octaves);
    const poolLen = pool.length;

    let pitchIndex: number;
    if (spec.contour === "walk") {
      if (!walkInitialized) {
        walkIndex = 0;
        walkInitialized = true;
      } else {
        const span = spec.walk.maxInterval;
        const delta = Math.floor(rng() * (2 * span + 1)) - span;
        walkIndex = Math.max(0, Math.min(poolLen - 1, walkIndex + delta));
      }
      pitchIndex = Math.min(walkIndex, poolLen - 1);
    } else if (spec.contour === "as-voiced") {
      pitchIndex = i % poolLen;
    } else {
      const cycle = contourCycle(spec.contour, poolLen);
      pitchIndex = cycle[i % cycle.length]!;
    }

    const pos = i % spec.patternLength;
    const sounding = mask[i % spec.euclid.n]! && !restSet.has(pos);
    if (!sounding) continue;

    const pitch = pool[pitchIndex]!;

    const shapeDelta =
      spec.patternLength <= 1 || spec.velocity.shape === "none"
        ? 0
        : spec.velocity.shape === "ramp-up"
          ? (pos / (spec.patternLength - 1) - 0.5) * spec.velocity.accentBoost
          : (0.5 - pos / (spec.patternLength - 1)) * spec.velocity.accentBoost;
    const velocity = clampVelocity(
      spec.velocity.base + (accentSet.has(pos) ? spec.velocity.accentBoost : 0) + shapeDelta,
    );

    const swungStart = t + (i % 2 === 1 ? spec.swing * stepBeats : 0);

    const ratchetCount = spec.ratchets[pos];
    if (ratchetCount) {
      const subSlot = stepBeats / ratchetCount;
      for (let r = 0; r < ratchetCount; r++) {
        notes.push({
          pitch,
          start: swungStart + r * subSlot,
          duration: subSlot * spec.gate,
          velocity,
        });
      }
    } else {
      notes.push({
        pitch,
        start: swungStart,
        duration: stepBeats * spec.gate,
        velocity,
      });
    }
  }

  return {
    notes: sortNotes(notes),
    meta: {
      contour: spec.contour,
      patternLength: String(spec.patternLength),
      seed: String(opts.seed),
      rotate: String(rotate),
    },
  };
}
