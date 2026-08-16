import { BridgeError } from "../bridge/types.js";
import type { ScaleContext } from "./types.js";

/** Common scales by name (semitone offsets from root). */
export const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  "harmonic-minor": [0, 2, 3, 5, 7, 8, 11],
  "melodic-minor": [0, 2, 3, 5, 7, 9, 11],
  "pentatonic-major": [0, 2, 4, 7, 9],
  "pentatonic-minor": [0, 3, 5, 7, 10],
};

const ROOTS: Record<string, number> = {
  C: 0, "C#": 1, DB: 1, D: 2, "D#": 3, EB: 3, E: 4, F: 5, "F#": 6, GB: 6,
  G: 7, "G#": 8, AB: 8, A: 9, "A#": 10, BB: 10, B: 11,
};

/** Parse e.g. "C minor", "F# dorian" into a ScaleContext. */
export function parseScale(text: string): ScaleContext {
  const m = text.trim().match(/^([A-Ga-g](?:#|b)?)\s+([\w-]+)$/);
  if (!m) {
    throw new BridgeError("bad_request", `invalid scale "${text}" (expected e.g. "C minor", "F# dorian")`);
  }
  const rootNote = ROOTS[m[1]!.toUpperCase()];
  const intervals = SCALES[m[2]!.toLowerCase()];
  if (rootNote === undefined) throw new BridgeError("bad_request", `unknown root "${m[1]}"`);
  if (!intervals) {
    throw new BridgeError(
      "bad_request",
      `unknown scale "${m[2]}" (known: ${Object.keys(SCALES).join(", ")})`,
    );
  }
  return { rootNote, intervals };
}

/** Nearest in-scale pitch (ties resolve downward). */
export function snapToScale(pitch: number, scale: ScaleContext): number {
  for (let distance = 0; distance <= 6; distance++) {
    for (const candidate of [pitch - distance, pitch + distance]) {
      if (candidate < 0 || candidate > 127) continue;
      const degree = ((candidate - scale.rootNote) % 12 + 12) % 12;
      if (scale.intervals.includes(degree)) return candidate;
    }
  }
  return pitch;
}

/**
 * Move an in-scale pitch by N scale degrees (out-of-scale input is snapped
 * first). degrees may be negative.
 */
export function shiftDegrees(pitch: number, degrees: number, scale: ScaleContext): number {
  const snapped = snapToScale(pitch, scale);
  const chroma = ((snapped - scale.rootNote) % 12 + 12) % 12;
  const index = scale.intervals.indexOf(chroma);
  const octave = Math.floor((snapped - scale.rootNote) / 12);
  const size = scale.intervals.length;
  const targetIndex = index + degrees;
  const targetOctave = octave + Math.floor(targetIndex / size);
  const wrapped = ((targetIndex % size) + size) % size;
  const result = scale.rootNote + targetOctave * 12 + scale.intervals[wrapped]!;
  return Math.max(0, Math.min(127, result));
}
