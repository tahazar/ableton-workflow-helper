/**
 * Pure helpers for `awh clip from-audio` (SDK-free: seconds/beats math and
 * grid quantization for transcribed notes). The DSP (pitch/onset detection)
 * lives in analysis/awh_analysis/a2m.py; this module only does the deterministic arithmetic on the note list the Python side
 * returns before it's written to Live.
 */
import type { NoteSpec } from "../bridge/types.js";

/** Convert a duration in seconds to beats at a given tempo. */
export function secondsToBeats(seconds: number, bpm: number): number {
  if (!(bpm > 0)) {
    throw new RangeError(`secondsToBeats: bpm must be > 0, got ${bpm}`);
  }
  return (seconds * bpm) / 60;
}

/** Supported `--quantize` grid specs, in beats (quarter note = 1 beat). */
export const QUANTIZE_GRIDS: Record<string, number> = {
  "1/4": 1,
  "1/8": 0.5,
  "1/16": 0.25,
  "1/32": 0.125,
};

/**
 * Parse a `--quantize` value into a grid size in beats, or `null` for "off"
 * (no quantization). Throws on anything else so a typo fails loudly instead
 * of silently snapping to the wrong grid.
 */
export function parseQuantizeGrid(spec: string): number | null {
  if (spec === "off") return null;
  const beats = QUANTIZE_GRIDS[spec];
  if (beats === undefined) {
    throw new RangeError(
      `unknown --quantize grid "${spec}" — one of: ${Object.keys(QUANTIZE_GRIDS).join(", ")}, off`,
    );
  }
  return beats;
}

/**
 * Snap note starts to the nearest grid line. Durations are also snapped, but
 * only when the note is already at least one grid unit long. Short
 * ornaments/blips (e.g. a 32nd-note grace note under a 1/8 grid) keep their
 * transcribed length rather than being forced up to the grid, which would
 * turn a short note into an audibly longer one. A duration that would
 * quantize to zero or negative length falls back to the original duration
 * (never emits a zero-length note).
 */
export function quantizeNotes(notes: readonly NoteSpec[], gridBeats: number): NoteSpec[] {
  if (!(gridBeats > 0)) {
    throw new RangeError(`quantizeNotes: gridBeats must be > 0, got ${gridBeats}`);
  }
  const snapped = notes.map((n) => {
    const start = Math.round(n.start / gridBeats) * gridBeats;
    let duration = n.duration;
    if (n.duration >= gridBeats) {
      const end = Math.round((n.start + n.duration) / gridBeats) * gridBeats;
      const snappedDuration = end - start;
      if (snappedDuration > 0) duration = snappedDuration;
    }
    return { ...n, start, duration };
  });
  snapped.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return snapped;
}

/** Ceil a span in beats up to a whole number of bars, in beats. */
export function clipLengthBeats(lastNoteEndBeats: number, beatsPerBar: number): number {
  if (!(beatsPerBar > 0)) {
    throw new RangeError(`clipLengthBeats: beatsPerBar must be > 0, got ${beatsPerBar}`);
  }
  if (lastNoteEndBeats <= 0) return beatsPerBar;
  return Math.ceil(lastNoteEndBeats / beatsPerBar) * beatsPerBar;
}

/**
 * Drop notes at/after `lengthBeats` and shorten any note that would
 * otherwise extend past it. Used when a transcription is written into an
 * existing clip slot whose length can't be changed via the gateway (there is
 * no clip-resize op). Notes past the clip's boundary would never sound in
 * Live, so this trims them instead of sending out-of-range note data.
 */
export function clampNotesToLength(notes: readonly NoteSpec[], lengthBeats: number): NoteSpec[] {
  if (!(lengthBeats > 0)) {
    throw new RangeError(`clampNotesToLength: lengthBeats must be > 0, got ${lengthBeats}`);
  }
  const out: NoteSpec[] = [];
  for (const n of notes) {
    if (n.start >= lengthBeats) continue;
    const end = Math.min(n.start + n.duration, lengthBeats);
    const duration = end - n.start;
    if (duration <= 0) continue;
    out.push(duration === n.duration ? n : { ...n, duration });
  }
  return out;
}
