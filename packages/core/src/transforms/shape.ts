import { BridgeError, type NoteSpec } from "../bridge/types.js";
import { snapToScale } from "./scales.js";
import {
  clampPitch,
  numParam,
  sortNotes,
  strParam,
  type TransformDef,
} from "./types.js";

/**
 * Shape transforms — rework existing material (spec R7): they may drop,
 * reshape, double, or echo the user's notes, but never invent pitches that
 * didn't come from the input.
 */

function isDownbeat(start: number, beatsPerBar: number): boolean {
  const remainder = start % beatsPerBar;
  const distance = Math.min(remainder, beatsPerBar - remainder);
  return distance < 1e-6;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export const thin: TransformDef = {
  name: "thin",
  description:
    "Drop notes to open space; bar downbeats always survive. Params: keep (0-1, default 0.6)",
  make(params) {
    const keep = numParam(params, "keep", 0.6, { min: 0, max: 1 });
    return (notes, ctx) =>
      notes.filter((n) => isDownbeat(n.start, ctx.beatsPerBar) || ctx.rng() < keep);
  },
};

export const densify: TransformDef = {
  name: "densify",
  description:
    "Add echoes of existing notes. Params: amount (0-1, default 0.3), mode (repeat|octave, default repeat)",
  make(params) {
    const amount = numParam(params, "amount", 0.3, { min: 0, max: 1 });
    const mode = strParam(params, "mode", "repeat");
    if (mode !== "repeat" && mode !== "octave") {
      throw new BridgeError("bad_request", `param "mode" must be "repeat" or "octave"`);
    }
    return (notes, ctx) => {
      const echoes: NoteSpec[] = [];
      for (const n of notes) {
        if (ctx.rng() >= amount) continue;
        const echo: NoteSpec =
          mode === "repeat"
            ? {
                ...n,
                start: n.start + n.duration,
                duration: n.duration / 2,
                velocity: Math.max(1, (n.velocity ?? 100) - 20),
              }
            : { ...n, pitch: clampPitch(n.pitch + 12) };
        if (echo.start >= ctx.lengthBeats) continue;
        echoes.push(echo);
      }
      return sortNotes([...notes, ...echoes]);
    };
  },
};

export const invert: TransformDef = {
  name: "invert",
  description:
    "Mirror the melodic contour around a pivot pitch (default: median of input). Params: pivot (MIDI pitch)",
  make(params) {
    const hasPivot = params.pivot !== undefined;
    const pivotParam = hasPivot
      ? numParam(params, "pivot", 0, { min: 0, max: 127 })
      : undefined;
    return (notes, ctx) => {
      if (notes.length === 0) return notes;
      const pivot = pivotParam ?? median(notes.map((n) => n.pitch));
      return notes.map((n) => {
        const mirrored = clampPitch(2 * pivot - n.pitch);
        return { ...n, pitch: ctx.scale ? snapToScale(mirrored, ctx.scale) : mirrored };
      });
    };
  },
};

export const octave: TransformDef = {
  name: "octave",
  description: "Shift the whole phrase by octaves. Params: shift (default -1, range -4..4)",
  make(params) {
    const shift = numParam(params, "shift", -1, { min: -4, max: 4 });
    return (notes) => notes.map((n) => ({ ...n, pitch: clampPitch(n.pitch + 12 * shift) }));
  },
};

export const velocityShape: TransformDef = {
  name: "velocity-shape",
  description:
    "Reshape velocities: ramp-up, ramp-down, or accent downbeats. Params: mode (ramp-up|ramp-down|accent, default accent), amount (0-1, default 0.5)",
  make(params) {
    const mode = strParam(params, "mode", "accent");
    if (mode !== "ramp-up" && mode !== "ramp-down" && mode !== "accent") {
      throw new BridgeError(
        "bad_request",
        `param "mode" must be "ramp-up", "ramp-down", or "accent"`,
      );
    }
    const amount = numParam(params, "amount", 0.5, { min: 0, max: 1 });
    return (notes, ctx) =>
      notes.map((n) => {
        const v = n.velocity ?? 100;
        let shaped: number;
        if (mode === "accent") {
          shaped = isDownbeat(n.start, ctx.beatsPerBar)
            ? v + amount * (127 - v)
            : v - amount * 20;
        } else {
          const frac =
            ctx.lengthBeats > 0 ? Math.min(1, Math.max(0, n.start / ctx.lengthBeats)) : 0;
          const reduction = (mode === "ramp-up" ? 1 - frac : frac) * amount * 60;
          shaped = v - reduction;
        }
        return { ...n, velocity: Math.max(1, Math.min(127, Math.round(shaped))) };
      });
  },
};

export const legato: TransformDef = {
  name: "legato",
  description:
    "Extend each note to meet the next note's start (minus gap). Simultaneous notes share the same next start. Params: gap (beats, default 0, 0-1)",
  make(params) {
    const gap = numParam(params, "gap", 0, { min: 0, max: 1 });
    return (notes) => {
      const sorted = sortNotes(notes);
      const starts = [...new Set(sorted.map((n) => n.start))].sort((a, b) => a - b);
      return sorted.map((n) => {
        const idx = starts.indexOf(n.start);
        const nextStart = idx + 1 < starts.length ? starts[idx + 1] : undefined;
        if (nextStart === undefined) return n;
        return { ...n, duration: Math.max(0.01, nextStart - n.start - gap) };
      });
    };
  },
};

export const staccato: TransformDef = {
  name: "staccato",
  description: "Shorten durations. Params: factor (0.05-1, default 0.5)",
  make(params) {
    const factor = numParam(params, "factor", 0.5, { min: 0.05, max: 1 });
    return (notes) => notes.map((n) => ({ ...n, duration: Math.max(0.05, n.duration * factor) }));
  },
};

export const fill: TransformDef = {
  name: "fill",
  description:
    "Build a fill in the last bar from the input's last note. Params: grid (beats, default 0.25)",
  make(params) {
    const grid = numParam(params, "grid", 0.25, { min: 0.05, max: 4 });
    return (notes, ctx) => {
      if (notes.length === 0) return notes;
      const sorted = sortNotes(notes);
      const last = sorted[sorted.length - 1]!;
      const fillStart = Math.max(0, ctx.lengthBeats - ctx.beatsPerBar);
      const outside = notes.filter((n) => n.start < fillStart || n.start >= ctx.lengthBeats);
      const stepCount = Math.max(0, Math.floor((ctx.lengthBeats - fillStart) / grid + 1e-9));
      const targetVelocity = last.velocity ?? 100;
      const fillNotes: NoteSpec[] = Array.from({ length: stepCount }, (_, i) => {
        const frac = stepCount > 1 ? i / (stepCount - 1) : 1;
        const velocity = Math.round(70 + frac * (targetVelocity - 70));
        return {
          pitch: last.pitch,
          start: fillStart + i * grid,
          duration: grid,
          velocity: Math.max(1, Math.min(127, velocity)),
        };
      });
      return sortNotes([...outside, ...fillNotes]);
    };
  },
};

export const shapeTransforms: TransformDef[] = [
  thin,
  densify,
  invert,
  octave,
  velocityShape,
  legato,
  staccato,
  fill,
];
