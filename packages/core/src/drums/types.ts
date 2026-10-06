/**
 * Drum tools: pattern generation, fills and per-role variation over a
 * drum-rack kit. Everything here is pure and seeded the same way as the
 * transforms module: the same kit + ctx + rng sequence always reproduces the
 * same notes, and only ctx.rng introduces randomness.
 */

export type DrumRole =
  | "kick"
  | "snare"
  | "clap"
  | "hat-closed"
  | "hat-open"
  | "ride"
  | "crash"
  | "tom"
  | "shaker"
  | "perc";

/** role -> MIDI note of the pad that plays it. Not every role need be present. */
export type DrumKit = Partial<Record<DrumRole, number>>;

export interface DrumContext {
  /** Pattern/clip length in bars. Integer, >= 1. */
  bars: number;
  /** Beats per bar, usually 4. */
  beatsPerBar: number;
  /** 0..1, default 0.5. Scales optional-hit probability & subdivision density. */
  density: number;
  /** Seeded PRNG in [0, 1), from makeRng(seed). */
  rng: () => number;
}
