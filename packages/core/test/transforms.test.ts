import { describe, expect, it } from "vitest";
import { makeRng, variantSeed } from "../src/transforms/rng.js";
import { parseScale, shiftDegrees, snapToScale } from "../src/transforms/scales.js";
import {
  applyPipeline,
  listTransforms,
  parsePipeline,
} from "../src/transforms/registry.js";
import type { TransformContext } from "../src/transforms/types.js";
import { BridgeError, type NoteSpec } from "../src/bridge/types.js";

const ctx = (overrides: Partial<TransformContext> = {}): TransformContext => ({
  lengthBeats: 8,
  beatsPerBar: 4,
  rng: makeRng(1),
  ...overrides,
});

const motif: NoteSpec[] = [
  { pitch: 60, start: 0, duration: 1, velocity: 100 },
  { pitch: 63, start: 1.5, duration: 0.5, velocity: 90 },
  { pitch: 67, start: 4, duration: 2, velocity: 80 },
];

describe("rng", () => {
  it("is deterministic and seed-sensitive", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const c = makeRng(43);
    const seqA = [a(), a(), a()];
    expect(seqA).toEqual([b(), b(), b()]);
    expect(seqA).not.toEqual([c(), c(), c()]);
    expect(variantSeed(1, 1)).not.toBe(variantSeed(1, 2));
  });
});

describe("scales", () => {
  it("parses scale names and snaps/shifts", () => {
    const cMinor = parseScale("C minor");
    expect(cMinor.rootNote).toBe(0);
    expect(snapToScale(61, cMinor)).toBe(60); // C# -> C (ties resolve down)
    expect(shiftDegrees(60, 2, cMinor)).toBe(63); // C -> Eb
    expect(shiftDegrees(60, 7, cMinor)).toBe(72); // full octave = 7 degrees
    expect(shiftDegrees(60, -1, cMinor)).toBe(58); // down to Bb
    expect(() => parseScale("H wrong")).toThrowError(BridgeError);
    expect(() => parseScale("C klingon")).toThrowError(/unknown scale/);
  });
});

describe("pipeline", () => {
  it("parses specs and applies steps left to right", () => {
    const steps = parsePipeline("transpose:semitones=12 retrograde");
    const out = applyPipeline(steps, motif, ctx());
    // transposed up an octave, then reversed within 8 beats
    expect(out.map((n) => n.pitch).toSorted((a, b) => a - b)).toEqual([72, 75, 79]);
    expect(out[0]).toMatchObject({ pitch: 79, start: 2 }); // 8 - 4 - 2
  });

  it("transpose-scale respects the scale and demands one", () => {
    const steps = parsePipeline("transpose-scale:degrees=2");
    const out = applyPipeline(steps, motif, ctx({ scale: parseScale("C minor") }));
    expect(out.map((n) => n.pitch)).toEqual([63, 67, 70]); // C->Eb, Eb->G, G->Bb
    expect(() => applyPipeline(steps, motif, ctx())).toThrowError(/needs a scale/);
  });

  it("humanize is reproducible per seed and bounded", () => {
    const steps = parsePipeline("humanize:timing=0.05,velocity=10");
    const a = applyPipeline(steps, motif, ctx({ rng: makeRng(9) }));
    const b = applyPipeline(steps, motif, ctx({ rng: makeRng(9) }));
    expect(a).toEqual(b);
    a.forEach((n, i) => {
      expect(Math.abs(n.start - motif[i]!.start)).toBeLessThanOrEqual(0.05 + 1e-9);
      expect(n.velocity).toBeGreaterThanOrEqual(1);
      expect(n.velocity).toBeLessThanOrEqual(127);
    });
  });

  it("rejects unknown transforms and malformed params", () => {
    expect(() => parsePipeline("nope")).toThrowError(/unknown transform/);
    expect(() => parsePipeline("transpose:semitones")).toThrowError(/key=value/);
    expect(() => parsePipeline("transpose:semitones=99")).toThrowError(/<= 48/);
    expect(() => parsePipeline("  ")).toThrowError(/empty/);
  });

  it("lists registered transforms", () => {
    const names = listTransforms().map((t) => t.name);
    for (const expected of ["transpose", "transpose-scale", "retrograde", "humanize"]) {
      expect(names).toContain(expected);
    }
  });
});
