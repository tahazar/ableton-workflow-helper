import { describe, expect, it } from "vitest";
import { BridgeError } from "../src/bridge/types.js";
import { makeRng } from "../src/transforms/rng.js";
import { quantize, rotate, stretch, swing, syncopate } from "../src/transforms/rhythm.js";
import type { TransformContext } from "../src/transforms/types.js";

const ctx = (overrides: Partial<TransformContext> = {}): TransformContext => ({
  lengthBeats: 8,
  beatsPerBar: 4,
  rng: makeRng(1),
  ...overrides,
});

describe("quantize", () => {
  it("snaps starts to the nearest grid line at full strength", () => {
    const notes = [
      { pitch: 60, start: 0.1, duration: 0.5 },
      { pitch: 62, start: 0.4, duration: 0.5 },
      { pitch: 64, start: 0.6, duration: 0.5 },
    ];
    const out = quantize.make({})(notes, ctx());
    expect(out).toEqual([
      { pitch: 60, start: 0, duration: 0.5 },
      { pitch: 62, start: 0.5, duration: 0.5 },
      { pitch: 64, start: 0.5, duration: 0.5 },
    ]);
  });

  it("moves halfway to the grid line at strength=0.5", () => {
    const notes = [{ pitch: 60, start: 0.1, duration: 0.5 }];
    const out = quantize.make({ strength: 0.5 })(notes, ctx());
    expect(out[0]!.start).toBeCloseTo(0.05, 10);
  });

  it("rejects out-of-range grid/strength", () => {
    expect(() => quantize.make({ grid: 0.01 })).toThrowError(BridgeError);
    expect(() => quantize.make({ grid: 5 })).toThrowError(/<= 4/);
    expect(() => quantize.make({ strength: -0.1 })).toThrowError(/>= 0/);
    expect(() => quantize.make({ strength: 1.5 })).toThrowError(/<= 1/);
  });
});

describe("swing", () => {
  it("delays only odd-grid-subdivision notes, by amount*grid*2/3", () => {
    const notes = [
      { pitch: 60, start: 0, duration: 0.25 },
      { pitch: 62, start: 0.25, duration: 0.25 },
      { pitch: 64, start: 0.5, duration: 0.25 },
      { pitch: 65, start: 0.75, duration: 0.25 },
    ];
    const out = swing.make({})(notes, ctx());
    const delay = 0.55 * 0.25 * (2 / 3);
    expect(out[0]!.start).toBe(0); // even subdivision, untouched
    expect(out[1]!.start).toBeCloseTo(0.25 + delay, 10);
    expect(out[2]!.start).toBe(0.5); // even, untouched
    expect(out[3]!.start).toBeCloseTo(0.75 + delay, 10);
  });

  it("honours custom grid and amount", () => {
    const notes = [
      { pitch: 60, start: 0, duration: 0.5 },
      { pitch: 62, start: 0.5, duration: 0.5 },
      { pitch: 64, start: 1, duration: 0.5 },
      { pitch: 65, start: 1.5, duration: 0.5 },
    ];
    const out = swing.make({ grid: 0.5, amount: 1 })(notes, ctx());
    const delay = 1 * 0.5 * (2 / 3);
    expect(out[0]!.start).toBe(0);
    expect(out[1]!.start).toBeCloseTo(0.5 + delay, 10);
    expect(out[2]!.start).toBe(1);
    expect(out[3]!.start).toBeCloseTo(1.5 + delay, 10);
  });

  it("rejects out-of-range grid/amount", () => {
    expect(() => swing.make({ grid: 0.01 })).toThrowError(BridgeError);
    expect(() => swing.make({ amount: 1.1 })).toThrowError(/<= 1/);
  });
});

describe("syncopate", () => {
  const notes = [
    { pitch: 60, start: 0, duration: 0.5 },
    { pitch: 62, start: 0.3, duration: 0.5 }, // off-grid, must never move
    { pitch: 64, start: 1, duration: 0.5 },
    { pitch: 65, start: 1.7, duration: 0.5 }, // off-grid, must never move
    { pitch: 67, start: 2, duration: 0.5 },
    { pitch: 69, start: 3, duration: 0.5 },
  ];

  it("is deterministic for a given seed", () => {
    const transform = syncopate.make({ probability: 0.4, offset: 0.5 });
    const a = transform(notes, ctx({ rng: makeRng(42) }));
    const b = transform(notes, ctx({ rng: makeRng(42) }));
    expect(a).toEqual(b);
  });

  it("only ever moves on-grid (beat-aligned) notes", () => {
    const transform = syncopate.make({ probability: 0.4, offset: 0.5 });
    const out = transform(notes, ctx({ rng: makeRng(42) }));
    const off1 = out.find((n) => n.pitch === 62)!;
    const off2 = out.find((n) => n.pitch === 65)!;
    expect(off1.start).toBe(0.3);
    expect(off2.start).toBe(1.7);
  });

  it("keeps every start within [0, lengthBeats)", () => {
    const transform = syncopate.make({ probability: 1, offset: 2 });
    const out = transform(notes, ctx({ rng: makeRng(7), lengthBeats: 8 }));
    for (const n of out) {
      expect(n.start).toBeGreaterThanOrEqual(0);
      expect(n.start).toBeLessThan(8);
    }
  });

  it("shifts on-beat notes by +offset and clamps at the clip boundary", () => {
    const transform = syncopate.make({ probability: 1, offset: 2 });
    const out = transform(
      [{ pitch: 60, start: 7, duration: 0.5 }],
      ctx({ rng: makeRng(7), lengthBeats: 8 }),
    );
    expect(out[0]!.start).toBeCloseTo(7.999999, 6);
  });

  it("clamps at 0 for a negative offset", () => {
    const transform = syncopate.make({ probability: 1, offset: -5 });
    const out = transform([{ pitch: 60, start: 0, duration: 0.5 }], ctx({ rng: makeRng(7) }));
    expect(out[0]!.start).toBe(0);
  });

  it("rejects out-of-range probability", () => {
    expect(() => syncopate.make({ probability: 1.5 })).toThrowError(BridgeError);
    expect(() => syncopate.make({ probability: -1 })).toThrowError(/>= 0/);
  });
});

describe("rotate", () => {
  it("shifts and wraps notes at the clip boundary (positive beats)", () => {
    const notes = [
      { pitch: 60, start: 7, duration: 0.5 },
      { pitch: 62, start: 0, duration: 0.5 },
      { pitch: 64, start: 3.5, duration: 0.5 },
    ];
    const out = rotate.make({})(notes, ctx());
    expect(out).toEqual([
      { pitch: 60, start: 0, duration: 0.5 }, // 7+1 wraps to 0
      { pitch: 62, start: 1, duration: 0.5 },
      { pitch: 64, start: 4.5, duration: 0.5 },
    ]);
  });

  it("wraps correctly for negative beats", () => {
    const notes = [
      { pitch: 60, start: 0, duration: 0.5 },
      { pitch: 62, start: 1, duration: 0.5 },
    ];
    const out = rotate.make({ beats: -1 })(notes, ctx());
    expect(out).toEqual([
      { pitch: 62, start: 0, duration: 0.5 },
      { pitch: 60, start: 7, duration: 0.5 },
    ]);
  });
});

describe("stretch", () => {
  it("scales start and duration by factor, dropping notes past the clip end", () => {
    const notes = [
      { pitch: 60, start: 0, duration: 0.5 },
      { pitch: 62, start: 3, duration: 1 },
      { pitch: 65, start: 3.9, duration: 0.2 },
      { pitch: 64, start: 4, duration: 1 }, // 4*2 = 8 >= lengthBeats(8), dropped
    ];
    const out = stretch.make({})(notes, ctx());
    expect(out).toEqual([
      { pitch: 60, start: 0, duration: 1 },
      { pitch: 62, start: 6, duration: 2 },
      { pitch: 65, start: 7.8, duration: 0.4 },
    ]);
  });

  it("supports shrinking (factor < 1)", () => {
    const notes = [{ pitch: 60, start: 4, duration: 2 }];
    const out = stretch.make({ factor: 0.5 })(notes, ctx());
    expect(out).toEqual([{ pitch: 60, start: 2, duration: 1 }]);
  });

  it("rejects out-of-range factor", () => {
    expect(() => stretch.make({ factor: 0.1 })).toThrowError(BridgeError);
    expect(() => stretch.make({ factor: 5 })).toThrowError(/<= 4/);
  });
});
