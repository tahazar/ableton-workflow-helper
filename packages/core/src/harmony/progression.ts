import { BridgeError } from "../bridge/types.js";

/**
 * Chord progressions, entirely in-scale (M7): every chord's root AND its
 * stacked quality are DERIVED from the scale's own step pattern (never a
 * chromatic/equal-tempered assumption), so a given progression text + scale
 * always yields the same chords — deterministic and diffable, same spirit as
 * the M3 transforms (see transforms/scales.ts).
 */

export interface ChordSpec {
  /** As written, e.g. "bVI7". */
  symbol: string;
  /** 0-based scale degree of the root. */
  degree: number;
  /** Pitch class 0-11 (root + scale position + accidental). */
  rootPc: number;
  /** Semitones from root, ascending, e.g. [0,3,7] or [0,3,7,10]. */
  intervals: number[];
  /** "maj"|"min"|"dim"|"aug"|"sus2"|"sus4" (+"7" suffix when a 7th is added). */
  quality: string;
}

/** Matches transforms/types.ts ScaleContext structurally, without importing
 *  it — harmony only needs rootNote + intervals. */
export interface ScaleContextLike {
  rootNote: number;
  intervals: number[];
}

const ROMAN_DEGREES: Record<string, number> = {
  i: 0,
  ii: 1,
  iii: 2,
  iv: 3,
  v: 4,
  vi: 5,
  vii: 6,
};

// [accidental?][roman numeral][suffix?] — suffixes are mutually exclusive
// (grammar decision: "V7sus4" etc. is not supported, keeping the grammar
// simple and the derivation unambiguous).
const CHORD_RE = /^([b#]?)([ivIV]+)(7|sus2|sus4|dim|aug)?$/;

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * Absolute semitone offset from the scale root for a (possibly negative or
 * >= scale-length) scale-degree index. Octaves are lifted so the result is
 * monotonic as `degree` increases — same technique as shiftDegrees in
 * transforms/scales.ts, but degree-indexed rather than pitch-indexed.
 */
function scaleStepOffset(degree: number, scale: ScaleContextLike): number {
  const size = scale.intervals.length;
  const idx = mod(degree, size);
  const octave = Math.floor(degree / size);
  return scale.intervals[idx]! + octave * 12;
}

/** Label a stacked third+fifth pair. Falls back to a third-size guess for
 *  non-tertian stacks (e.g. thirds built on a scale whose step pattern
 *  doesn't yield a plain triad) — not exercised by diatonic 7-note scales,
 *  documented as a grammar decision rather than spec-tested behavior. */
function classifyTriad(third: number, fifth: number): string {
  if (third === 4 && fifth === 7) return "maj";
  if (third === 3 && fifth === 7) return "min";
  if (third === 3 && fifth === 6) return "dim";
  if (third === 4 && fifth === 8) return "aug";
  return third <= 3 ? "min" : "maj";
}

function parseChord(symbol: string, scale: ScaleContextLike): ChordSpec {
  const m = CHORD_RE.exec(symbol);
  if (!m) {
    throw new BridgeError("bad_request", `invalid chord symbol "${symbol}"`);
  }
  const [, accidental, numeral, suffix] = m;
  const degree = ROMAN_DEGREES[numeral!.toLowerCase()];
  if (degree === undefined) {
    throw new BridgeError(
      "bad_request",
      `invalid chord symbol "${symbol}" (unknown roman numeral "${numeral}")`,
    );
  }
  const size = scale.intervals.length;
  if (degree >= size) {
    throw new BridgeError(
      "bad_request",
      `chord "${symbol}" root degree ${degree} is out of range for a ${size}-note scale`,
    );
  }

  const rootOffset = scaleStepOffset(degree, scale);
  const third = scaleStepOffset(degree + 2, scale) - rootOffset;
  const fifth = scaleStepOffset(degree + 4, scale) - rootOffset;

  let intervals: number[];
  let quality: string;
  if (suffix === "dim") {
    // Explicit override: leaves the scale entirely (spec).
    intervals = [0, 3, 6];
    quality = "dim";
  } else if (suffix === "aug") {
    intervals = [0, 4, 8];
    quality = "aug";
  } else if (suffix === "sus2") {
    const second = scaleStepOffset(degree + 1, scale) - rootOffset;
    intervals = [0, second, fifth];
    quality = "sus2";
  } else if (suffix === "sus4") {
    const fourth = scaleStepOffset(degree + 3, scale) - rootOffset;
    intervals = [0, fourth, fifth];
    quality = "sus4";
  } else {
    quality = classifyTriad(third, fifth);
    intervals = [0, third, fifth];
    if (suffix === "7") {
      const seventh = scaleStepOffset(degree + 6, scale) - rootOffset;
      intervals = [...intervals, seventh];
      quality = `${quality}7`;
    }
  }

  // Borrowed root (b/#): shift the pitch class only, keep the stacked
  // interval STRUCTURE from the original (diatonic) degree — the numeral's
  // case never overrides the scale-derived quality (spec).
  const accidentalShift = accidental === "b" ? -1 : accidental === "#" ? 1 : 0;
  const rootPc = mod(scale.rootNote + rootOffset + accidentalShift, 12);

  return { symbol, degree, rootPc, intervals, quality };
}

/**
 * Parse a chord progression string ("i-VI-III-VII" or "I IV V vi") into
 * ChordSpecs, entirely in terms of `scale`. Chords separated by `-` or
 * whitespace (or both).
 */
export function parseProgression(text: string, scale: ScaleContextLike): ChordSpec[] {
  const tokens = text.trim().split(/[\s-]+/).filter((t) => t.length > 0);
  if (tokens.length === 0) {
    throw new BridgeError("bad_request", `empty progression`);
  }
  return tokens.map((symbol) => parseChord(symbol, scale));
}
