import { BridgeError, type NoteSpec } from "../bridge/types.js";
import { shiftDegrees } from "./scales.js";
import {
  clampPitch,
  numParam,
  sortNotes,
  type TransformDef,
} from "./types.js";

/**
 * Exemplar transforms showing the pattern every transform follows:
 * - `make(params)` validates params once and returns a pure Transform.
 * - No mutation of input notes; all randomness via ctx.rng.
 */

export const transpose: TransformDef = {
  name: "transpose",
  description: "Shift all pitches by N semitones. Params: semitones (default 12)",
  make(params) {
    const semitones = numParam(params, "semitones", 12, { min: -48, max: 48 });
    return (notes) =>
      notes.map((n) => ({ ...n, pitch: clampPitch(n.pitch + semitones) }));
  },
};

export const transposeScale: TransformDef = {
  name: "transpose-scale",
  description:
    "Move pitches by N scale degrees within the Set/CLI scale. Params: degrees (default 2)",
  make(params) {
    const degrees = numParam(params, "degrees", 2, { min: -14, max: 14 });
    return (notes, ctx) => {
      if (!ctx.scale) {
        throw new BridgeError(
          "bad_request",
          "transpose-scale needs a scale: enable one in Live or pass --scale (e.g. --scale \"C minor\")",
        );
      }
      const scale = ctx.scale;
      return notes.map((n) => ({ ...n, pitch: shiftDegrees(n.pitch, degrees, scale) }));
    };
  },
};

export const retrograde: TransformDef = {
  name: "retrograde",
  description: "Reverse the phrase in time (last note first). No params",
  make() {
    return (notes, ctx) =>
      sortNotes(
        notes.map((n) => ({
          ...n,
          start: Math.max(0, ctx.lengthBeats - n.start - n.duration),
        })),
      );
  },
};

export const humanize: TransformDef = {
  name: "humanize",
  description:
    "Random timing/velocity jitter. Params: timing (beats, default 0.02), velocity (default 8)",
  make(params) {
    const timing = numParam(params, "timing", 0.02, { min: 0, max: 0.5 });
    const velocity = numParam(params, "velocity", 8, { min: 0, max: 64 });
    return (notes, ctx) =>
      sortNotes(
        notes.map((n): NoteSpec => {
          const jitteredStart = n.start + (ctx.rng() * 2 - 1) * timing;
          const jitteredVelocity =
            (n.velocity ?? 100) + Math.round((ctx.rng() * 2 - 1) * velocity);
          return {
            ...n,
            start: Math.max(0, jitteredStart),
            velocity: Math.max(1, Math.min(127, jitteredVelocity)),
          };
        }),
      );
  },
};

export const basicTransforms: TransformDef[] = [
  transpose,
  transposeScale,
  retrograde,
  humanize,
];
