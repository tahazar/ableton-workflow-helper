import { describe, expect, it } from "vitest";
import {
  clampNotesToLength,
  clipLengthBeats,
  parseQuantizeGrid,
  quantizeNotes,
  secondsToBeats,
} from "../src/a2m/quantize.js";
import type { NoteSpec } from "../src/bridge/types.js";

describe("secondsToBeats", () => {
  it("converts at 120 BPM (0.5s per beat)", () => {
    expect(secondsToBeats(1, 120)).toBeCloseTo(2, 10);
    expect(secondsToBeats(0.5, 120)).toBeCloseTo(1, 10);
  });

  it("converts at 60 BPM (1s per beat) and 90 BPM", () => {
    expect(secondsToBeats(3, 60)).toBeCloseTo(3, 10);
    expect(secondsToBeats(2, 90)).toBeCloseTo(3, 10);
  });

  it("rejects non-positive tempo", () => {
    expect(() => secondsToBeats(1, 0)).toThrow(RangeError);
    expect(() => secondsToBeats(1, -10)).toThrow(RangeError);
  });
});

describe("parseQuantizeGrid", () => {
  it("maps note-value strings to beats (quarter = 1 beat)", () => {
    expect(parseQuantizeGrid("1/4")).toBe(1);
    expect(parseQuantizeGrid("1/8")).toBe(0.5);
    expect(parseQuantizeGrid("1/16")).toBe(0.25);
    expect(parseQuantizeGrid("1/32")).toBe(0.125);
  });

  it("returns null for off", () => {
    expect(parseQuantizeGrid("off")).toBeNull();
  });

  it("rejects unknown grids", () => {
    expect(() => parseQuantizeGrid("1/3")).toThrow(RangeError);
    expect(() => parseQuantizeGrid("")).toThrow(RangeError);
  });
});

function note(start: number, duration: number, pitch = 60): NoteSpec {
  return { start, duration, pitch, velocity: 100 };
}

describe("quantizeNotes", () => {
  it("snaps starts to the nearest grid line (1/16 = 0.25 beats)", () => {
    const notes = [note(0.1, 1), note(0.9, 1), note(1.13, 1)];
    const out = quantizeNotes(notes, 0.25);
    expect(out.map((n) => n.start)).toEqual([0, 1, 1.25]);
  });

  it("snaps duration too when the note is already >= one grid unit", () => {
    // 1 beat starting at 0, grid = 1/8 (0.5 beats): end 1.0 -> stays 1.0
    const notes = [note(0, 1.05)];
    const out = quantizeNotes(notes, 0.5);
    expect(out[0]!.start).toBe(0);
    expect(out[0]!.duration).toBeCloseTo(1, 10);
  });

  it("leaves a note's duration alone when it's shorter than the grid (no forced lengthening)", () => {
    // a 32nd-note-ish blip (0.1 beats) under a coarse 1/4 (1 beat) grid
    const notes = [note(0.02, 0.1)];
    const out = quantizeNotes(notes, 1);
    expect(out[0]!.start).toBe(0);
    expect(out[0]!.duration).toBe(0.1); // untouched, not snapped up to 1 beat
  });

  it("never emits a zero-length note", () => {
    // start/end quantize to the same grid line -> falls back to original duration
    const notes = [note(0.24, 0.02)];
    const out = quantizeNotes(notes, 0.25);
    expect(out[0]!.duration).toBeGreaterThan(0);
  });

  it("re-sorts by start then pitch after snapping (order can change)", () => {
    const notes = [note(0.6, 0.4, 72), note(0.4, 0.4, 60)];
    const out = quantizeNotes(notes, 0.5);
    // both snap to 0.5 -> tie-break by pitch ascending
    expect(out.map((n) => [n.start, n.pitch])).toEqual([
      [0.5, 60],
      [0.5, 72],
    ]);
  });

  it("rejects non-positive grid size", () => {
    expect(() => quantizeNotes([], 0)).toThrow(RangeError);
  });
});

describe("clipLengthBeats", () => {
  it("ceils a span up to whole bars (4/4 = 4 beats/bar)", () => {
    expect(clipLengthBeats(3, 4)).toBe(4);
    expect(clipLengthBeats(4, 4)).toBe(4);
    expect(clipLengthBeats(4.01, 4)).toBe(8);
    expect(clipLengthBeats(9, 4)).toBe(12);
  });

  it("returns one bar for an empty/zero span", () => {
    expect(clipLengthBeats(0, 4)).toBe(4);
    expect(clipLengthBeats(-1, 4)).toBe(4);
  });
});

describe("clampNotesToLength", () => {
  it("passes notes through unchanged when they all fit", () => {
    const notes = [note(0, 1), note(2, 1)];
    expect(clampNotesToLength(notes, 4)).toEqual(notes);
  });

  it("drops notes that start at or after the length", () => {
    const notes = [note(0, 1), note(4, 1), note(5, 1)];
    const out = clampNotesToLength(notes, 4);
    expect(out).toHaveLength(1);
    expect(out[0]!.start).toBe(0);
  });

  it("shortens a note that crosses the boundary instead of dropping it", () => {
    const notes = [note(3, 2)]; // 3 -> 5, length cap 4
    const out = clampNotesToLength(notes, 4);
    expect(out).toHaveLength(1);
    expect(out[0]!.start).toBe(3);
    expect(out[0]!.duration).toBeCloseTo(1, 10);
  });

  it("rejects non-positive length", () => {
    expect(() => clampNotesToLength([], 0)).toThrow(RangeError);
  });
});
