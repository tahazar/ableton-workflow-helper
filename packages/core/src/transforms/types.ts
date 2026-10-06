import { BridgeError, type NoteSpec } from "../bridge/types.js";

/**
 * Deterministic note transforms: the core of the variation engine.
 *
 * A Transform is a pure function: (notes, ctx) -> new notes. All randomness
 * flows through ctx.rng (seeded), so the same seed + params + input always
 * yields the same variation; variations are reproducible and diffable.
 *
 * Authorship rule: transforms rework the user's material. They may drop,
 * move, reshape, double (octave/repeat) existing notes, but must not invent
 * unrelated new melodic content. Co-writing belongs to the LLM agent layer
 * above this one.
 */

export interface ScaleContext {
  /** 0-11, C = 0. */
  rootNote: number;
  /** Semitone offsets from root, e.g. major = [0,2,4,5,7,9,11]. */
  intervals: number[];
}

export interface TransformContext {
  /** Clip length in beats. */
  lengthBeats: number;
  beatsPerBar: number;
  /** Present when the Set has an active scale (or the user supplied one). */
  scale?: ScaleContext;
  /** Seeded PRNG in [0, 1). */
  rng: () => number;
}

export type Transform = (notes: NoteSpec[], ctx: TransformContext) => NoteSpec[];

export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

export interface TransformDef {
  name: string;
  description: string;
  /** Validate params and return the configured transform. */
  make(params: Params): Transform;
}

// -- param helpers (shared by all transform implementations) ----------------

export function numParam(
  params: Params,
  key: string,
  fallback: number,
  opts: { min?: number; max?: number } = {},
): number {
  const raw = params[key];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value)) {
    throw new BridgeError("bad_request", `param "${key}" must be a number`);
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new BridgeError("bad_request", `param "${key}" must be >= ${opts.min}`);
  }
  if (opts.max !== undefined && value > opts.max) {
    throw new BridgeError("bad_request", `param "${key}" must be <= ${opts.max}`);
  }
  return value;
}

export function strParam(params: Params, key: string, fallback: string): string {
  const raw = params[key];
  return raw === undefined ? fallback : String(raw);
}

/** Clamp helper used by pitch-moving transforms. */
export function clampPitch(pitch: number): number {
  return Math.max(0, Math.min(127, Math.round(pitch)));
}

/** Sort order used everywhere: time, then pitch. */
export function sortNotes(notes: NoteSpec[]): NoteSpec[] {
  return [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}
