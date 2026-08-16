import type { NoteSpec } from "../bridge/types.js";
import { numParam, sortNotes, type TransformDef } from "./types.js";

/**
 * Rhythm transforms (M3): reshape note timing without touching pitch.
 * Same pattern as basic.ts — make(params) validates once, returns a pure
 * Transform; randomness (syncopate) flows through ctx.rng only.
 */

export const quantize: TransformDef = {
  name: "quantize",
  description:
    "Snap note starts toward the nearest grid line. Params: grid (beats, default 0.25, min 0.0625, max 4), strength (0-1, default 1; 0.5 moves halfway). Durations unchanged.",
  make(params) {
    const grid = numParam(params, "grid", 0.25, { min: 0.0625, max: 4 });
    const strength = numParam(params, "strength", 1, { min: 0, max: 1 });
    return (notes) =>
      sortNotes(
        notes.map((n): NoteSpec => {
          const nearest = Math.round(n.start / grid) * grid;
          const start = Math.max(0, n.start + (nearest - n.start) * strength);
          return { ...n, start };
        }),
      );
  },
};

export const swing: TransformDef = {
  name: "swing",
  description:
    'Delay notes sitting on ODD grid subdivisions (the "off" 8ths/16ths) for a swung feel. Params: grid (beats, default 0.25), amount (0-1, default 0.55); delay = amount * grid * 2/3.',
  make(params) {
    const grid = numParam(params, "grid", 0.25, { min: 0.0625, max: 4 });
    const amount = numParam(params, "amount", 0.55, { min: 0, max: 1 });
    const delay = amount * grid * (2 / 3);
    return (notes) =>
      sortNotes(
        notes.map((n): NoteSpec => {
          const index = Math.round(n.start / grid);
          const onOddGrid = index % 2 !== 0 && Math.abs(n.start - index * grid) < 1e-6;
          return onOddGrid ? { ...n, start: n.start + delay } : n;
        }),
      );
  },
};

export const syncopate: TransformDef = {
  name: "syncopate",
  description:
    "Push a random subset of ON-grid (beat-aligned) notes off the grid. Params: probability (0-1, default 0.4), offset (beats, default 0.5).",
  make(params) {
    const probability = numParam(params, "probability", 0.4, { min: 0, max: 1 });
    const offset = numParam(params, "offset", 0.5);
    return (notes, ctx) =>
      sortNotes(
        notes.map((n): NoteSpec => {
          const onBeat = Math.abs(n.start - Math.round(n.start)) < 1e-6;
          if (!onBeat || ctx.rng() >= probability) return n;
          const shifted = n.start + offset;
          const start = Math.max(0, Math.min(shifted, ctx.lengthBeats - 1e-6));
          return { ...n, start };
        }),
      );
  },
};

export const rotate: TransformDef = {
  name: "rotate",
  description:
    "Rotate the phrase in time, wrapping at the clip boundary. Params: beats (default 1, may be negative).",
  make(params) {
    const beats = numParam(params, "beats", 1);
    return (notes, ctx) =>
      sortNotes(
        notes.map((n): NoteSpec => {
          const start = (((n.start + beats) % ctx.lengthBeats) + ctx.lengthBeats) % ctx.lengthBeats;
          return { ...n, start };
        }),
      );
  },
};

export const stretch: TransformDef = {
  name: "stretch",
  description:
    "Time-scale the phrase by a factor: start and duration are both multiplied. Notes that land at or past the clip length after scaling are dropped. Params: factor (default 2, min 0.25, max 4).",
  make(params) {
    const factor = numParam(params, "factor", 2, { min: 0.25, max: 4 });
    return (notes, ctx) =>
      notes
        .map((n): NoteSpec => ({ ...n, start: n.start * factor, duration: n.duration * factor }))
        .filter((n) => n.start < ctx.lengthBeats);
  },
};

export const rhythmTransforms: TransformDef[] = [quantize, swing, syncopate, rotate, stretch];
