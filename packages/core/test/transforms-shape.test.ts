import { describe, expect, it } from "vitest";
import { BridgeError, type NoteSpec } from "../src/bridge/types.js";
import { makeRng } from "../src/transforms/rng.js";
import {
  densify,
  fill,
  invert,
  legato,
  octave,
  shapeTransforms,
  staccato,
  thin,
  velocityShape,
} from "../src/transforms/shape.js";
import { clampPitch, type TransformContext } from "../src/transforms/types.js";

function ctx(overrides: Partial<TransformContext> = {}): TransformContext {
  return { lengthBeats: 8, beatsPerBar: 4, rng: makeRng(1), ...overrides };
}

describe("shapeTransforms registry", () => {
  it("exports all eight transforms", () => {
    expect(shapeTransforms.map((t) => t.name).toSorted()).toEqual([
      "densify",
      "fill",
      "invert",
      "legato",
      "octave",
      "staccato",
      "thin",
      "velocity-shape",
    ]);
  });
});

describe("thin", () => {
  const notes: NoteSpec[] = [
    { pitch: 60, start: 0, duration: 1 },
    { pitch: 62, start: 1, duration: 1 },
    { pitch: 64, start: 2, duration: 1 },
    { pitch: 65, start: 3, duration: 1 },
    { pitch: 67, start: 4, duration: 1 },
    { pitch: 69, start: 5, duration: 1 },
    { pitch: 71, start: 6, duration: 1 },
    { pitch: 72, start: 7, duration: 1 },
  ];

  it("always keeps bar downbeats, even with keep=0", () => {
    const out = thin.make({ keep: 0 })(notes, ctx({ rng: makeRng(1) }));
    expect(out.map((n) => n.start)).toEqual([0, 4]);
  });

  it("is deterministic for a given seed", () => {
    const transform = thin.make({ keep: 0.6 });
    const out1 = transform(notes, ctx({ rng: makeRng(7) }));
    const out2 = transform(notes, ctx({ rng: makeRng(7) }));
    expect(out1).toEqual(out2);
  });

  it("rejects out-of-range keep", () => {
    expect(() => thin.make({ keep: 2 })).toThrowError(BridgeError);
    expect(() => thin.make({ keep: -1 })).toThrowError(BridgeError);
  });
});

describe("densify", () => {
  const notes: NoteSpec[] = [
    { pitch: 60, start: 0, duration: 1 },
    { pitch: 62, start: 1, duration: 1 },
    { pitch: 64, start: 2, duration: 1 },
    { pitch: 65, start: 3, duration: 1 },
    { pitch: 67, start: 4, duration: 1 },
    { pitch: 69, start: 5, duration: 1 },
    { pitch: 71, start: 6, duration: 1 },
    { pitch: 72, start: 7, duration: 1 },
  ];

  it("is deterministic for a given seed", () => {
    const transform = densify.make({ amount: 0.5, mode: "repeat" });
    const out1 = transform(notes, ctx({ rng: makeRng(7) }));
    const out2 = transform(notes, ctx({ rng: makeRng(7) }));
    expect(out1).toEqual(out2);
  });

  it("repeat-mode echoes reuse only input pitches and never exceed lengthBeats", () => {
    const out = densify.make({ amount: 1, mode: "repeat" })(notes, ctx({ rng: makeRng(7) }));
    const inputPitches = new Set(notes.map((n) => n.pitch));
    expect(out.length).toBeGreaterThan(notes.length);
    for (const n of out) {
      expect(inputPitches.has(n.pitch)).toBe(true);
      expect(n.start).toBeLessThan(8);
    }
  });

  it("octave-mode echoes are input pitches or +12 and never exceed lengthBeats", () => {
    const out = densify.make({ amount: 1, mode: "octave" })(notes, ctx({ rng: makeRng(7) }));
    const validPitches = new Set(notes.flatMap((n) => [n.pitch, clampPitch(n.pitch + 12)]));
    expect(out.length).toBeGreaterThan(notes.length);
    for (const n of out) {
      expect(validPitches.has(n.pitch)).toBe(true);
      expect(n.start).toBeLessThan(8);
    }
  });

  it("rejects an unknown mode", () => {
    expect(() => densify.make({ mode: "bogus" })).toThrowError(BridgeError);
  });
});

describe("invert", () => {
  it("mirrors around an explicit pivot", () => {
    const notes: NoteSpec[] = [
      { pitch: 60, start: 0, duration: 1 },
      { pitch: 64, start: 1, duration: 1 },
      { pitch: 67, start: 2, duration: 1 },
    ];
    const out = invert.make({ pivot: 60 })(notes, ctx());
    expect(out.map((n) => n.pitch)).toEqual([60, 56, 53]);
  });

  it("defaults the pivot to the median input pitch", () => {
    const notes: NoteSpec[] = [
      { pitch: 60, start: 0, duration: 1 },
      { pitch: 64, start: 1, duration: 1 },
      { pitch: 67, start: 2, duration: 1 },
    ];
    // median = 64: mirrored = 2*64-60=68, 2*64-64=64, 2*64-67=61
    const out = invert.make({})(notes, ctx());
    expect(out.map((n) => n.pitch)).toEqual([68, 64, 61]);
  });

  it("snaps the mirrored pitch to the active scale", () => {
    const notes: NoteSpec[] = [{ pitch: 62, start: 0, duration: 1 }];
    const out = invert.make({ pivot: 60 })(
      notes,
      ctx({ scale: { rootNote: 0, intervals: [0, 2, 4, 5, 7, 9, 11] } }),
    );
    // mirrored = 2*60-62 = 58 (chroma 10, out of C major) -> snaps to 57
    expect(out[0]!.pitch).toBe(57);
  });
});

describe("octave", () => {
  it("shifts down by one octave by default", () => {
    const out = octave.make({})([{ pitch: 60, start: 0, duration: 1 }], ctx());
    expect(out[0]!.pitch).toBe(48);
  });

  it("shifts by an explicit number of octaves", () => {
    const out = octave.make({ shift: 2 })([{ pitch: 60, start: 0, duration: 1 }], ctx());
    expect(out[0]!.pitch).toBe(84);
  });

  it("clamps at the MIDI floor", () => {
    const out = octave.make({ shift: -4 })([{ pitch: 10, start: 0, duration: 1 }], ctx());
    expect(out[0]!.pitch).toBe(0);
  });

  it("rejects an out-of-range shift", () => {
    expect(() => octave.make({ shift: 5 })).toThrowError(BridgeError);
  });
});

describe("velocity-shape", () => {
  const notes: NoteSpec[] = [
    { pitch: 60, start: 0, duration: 1, velocity: 100 },
    { pitch: 62, start: 2, duration: 1, velocity: 100 },
  ];

  it("ramp-up reduces early notes more than late ones", () => {
    const out = velocityShape.make({ mode: "ramp-up", amount: 0.5 })(notes, ctx({ lengthBeats: 4 }));
    expect(out.map((n) => n.velocity)).toEqual([70, 85]);
  });

  it("ramp-down mirrors ramp-up", () => {
    const out = velocityShape.make({ mode: "ramp-down", amount: 0.5 })(notes, ctx({ lengthBeats: 4 }));
    expect(out.map((n) => n.velocity)).toEqual([100, 85]);
  });

  it("accent boosts downbeats and lowers everything else", () => {
    const out = velocityShape.make({ mode: "accent", amount: 0.5 })(
      notes,
      ctx({ lengthBeats: 4, beatsPerBar: 4 }),
    );
    expect(out.map((n) => n.velocity)).toEqual([114, 90]);
  });

  it("treats a missing velocity as 100", () => {
    const out = velocityShape.make({ mode: "accent", amount: 0.5 })(
      [{ pitch: 60, start: 0, duration: 1 }],
      ctx({ lengthBeats: 4, beatsPerBar: 4 }),
    );
    expect(out[0]!.velocity).toBe(114);
  });

  it("rejects an unknown mode", () => {
    expect(() => velocityShape.make({ mode: "sideways" })).toThrowError(BridgeError);
  });
});

describe("legato", () => {
  it("extends notes to the next distinct start, sharing simultaneous starts", () => {
    const notes: NoteSpec[] = [
      { pitch: 60, start: 0, duration: 0.1 },
      { pitch: 62, start: 1, duration: 0.1 },
      { pitch: 64, start: 1, duration: 0.1 },
      { pitch: 65, start: 3, duration: 0.1 },
    ];
    const out = legato.make({ gap: 0 })(notes, ctx());
    expect(out.map((n) => n.duration)).toEqual([1, 2, 2, 0.1]);
  });

  it("subtracts the gap from the extended duration", () => {
    const notes: NoteSpec[] = [
      { pitch: 60, start: 0, duration: 0.1 },
      { pitch: 62, start: 2, duration: 0.1 },
    ];
    const out = legato.make({ gap: 0.25 })(notes, ctx());
    expect(out.map((n) => n.duration)).toEqual([1.75, 0.1]);
  });

  it("rejects an out-of-range gap", () => {
    expect(() => legato.make({ gap: 2 })).toThrowError(BridgeError);
  });
});

describe("staccato", () => {
  it("scales duration by factor", () => {
    const out = staccato.make({ factor: 0.3 })([{ pitch: 60, start: 0, duration: 1 }], ctx());
    expect(out[0]!.duration).toBeCloseTo(0.3);
  });

  it("clamps duration at the 0.05 minimum", () => {
    const out = staccato.make({ factor: 0.05 })([{ pitch: 60, start: 0, duration: 0.1 }], ctx());
    expect(out[0]!.duration).toBe(0.05);
  });

  it("rejects an out-of-range factor", () => {
    expect(() => staccato.make({ factor: 0 })).toThrowError(BridgeError);
  });
});

describe("fill", () => {
  it("replaces the last bar with a grid of the last note's pitch, ramping velocity", () => {
    const notes: NoteSpec[] = [
      { pitch: 60, start: 1, duration: 1, velocity: 90 },
      { pitch: 67, start: 5, duration: 1, velocity: 100 },
    ];
    const out = fill.make({ grid: 1 })(notes, ctx({ lengthBeats: 8, beatsPerBar: 4 }));
    expect(out).toEqual([
      { pitch: 60, start: 1, duration: 1, velocity: 90 },
      { pitch: 67, start: 4, duration: 1, velocity: 70 },
      { pitch: 67, start: 5, duration: 1, velocity: 80 },
      { pitch: 67, start: 6, duration: 1, velocity: 90 },
      { pitch: 67, start: 7, duration: 1, velocity: 100 },
    ]);
  });

  it("leaves notes outside the final bar untouched", () => {
    const notes: NoteSpec[] = [
      { pitch: 60, start: 0, duration: 1, velocity: 90 },
      { pitch: 62, start: 5, duration: 1 },
    ];
    const out = fill.make({ grid: 1 })(notes, ctx({ lengthBeats: 8, beatsPerBar: 4 }));
    expect(out[0]).toEqual({ pitch: 60, start: 0, duration: 1, velocity: 90 });
  });

  it("rejects an out-of-range grid", () => {
    expect(() => fill.make({ grid: 0 })).toThrowError(BridgeError);
  });
});
