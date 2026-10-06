import { describe, expect, it } from "vitest";
import {
  TRAP_LONG_SPEC,
  TRAP_SYNCOPATED_SPEC,
  TRIPLET_FLOW_SPEC,
  listBass808Styles,
  listBass808Variants,
  parseBass808Spec,
  type Bass808Spec,
} from "../src/bass/spec.js";
import { BASS808_BEATS_PER_BAR, generate808 } from "../src/bass/engine.js";

// ---------------------------------------------------------------------------
// parseBass808Spec
// ---------------------------------------------------------------------------

describe("parseBass808Spec", () => {
  it("round-trips the built-in trap-long document (docs/design/bass-808.md, verbatim)", () => {
    const yaml = `
name: trap-long
cells:
  - name: anchor-hold
    weight: 3
    steps:
      - {pos: 0, len: 2.5, degree: 0}
      - {pos: 3, len: 1.0, degree: 0, slide: true}
  - name: octave-answer
    weight: 2
    steps:
      - {pos: 0, len: 1.5, degree: 0}
      - {pos: 2, len: 0.75, degree: 12, slide: true}
      - {pos: 3, len: 1.0, degree: 0}
degrees: [0, 12, 7, -2, 10]
register: [24, 36]
slideOverlapBeats: 0.05
velocity: {base: 110, accentFirst: 12}
turnaroundBar: 4
turnaroundCells: []
swing: 0
`;
    expect(parseBass808Spec(yaml)).toEqual(TRAP_LONG_SPEC);
  });

  it("fills in documented defaults when optional fields are omitted", () => {
    const spec = parseBass808Spec(`
name: minimal
degrees: [0, 7]
cells:
  - name: only
    steps:
      - {pos: 0, len: 1, degree: 0}
`);
    expect(spec.register).toEqual([24, 36]);
    expect(spec.slideOverlapBeats).toBe(0.05);
    expect(spec.velocity).toEqual({ base: 110, accentFirst: 12 });
    expect(spec.turnaroundBar).toBe(4);
    expect(spec.turnaroundCells).toEqual([]);
    expect(spec.swing).toBe(0);
    expect(spec.cells[0]!.weight).toBe(1); // cell weight also defaults
    expect(spec.cells[0]!.steps[0]!.slide).toBe(false); // step slide also defaults
  });

  it("rejects an unknown top-level key (typo protection)", () => {
    expect(() => parseBass808Spec(`name: x\ndegres: [0]\ncells: []`)).toThrowError(
      /unknown field "degres"/,
    );
  });

  it("rejects an unknown nested cell key", () => {
    expect(() =>
      parseBass808Spec(
        `name: x\ndegrees: [0]\ncells:\n  - name: c\n    wieght: 2\n    steps: [{pos: 0, len: 1, degree: 0}]`,
      ),
    ).toThrowError(/unknown field "wieght"/);
  });

  it("rejects an unknown nested step key", () => {
    expect(() =>
      parseBass808Spec(
        `name: x\ndegrees: [0]\ncells:\n  - name: c\n    steps: [{pos: 0, len: 1, degre: 0}]`,
      ),
    ).toThrowError(/unknown field "degre"/);
  });

  it("rejects an unknown velocity key", () => {
    expect(() =>
      parseBass808Spec(
        `name: x\ndegrees: [0]\ncells:\n  - name: c\n    steps: [{pos: 0, len: 1, degree: 0}]\nvelocity: {bas: 100}`,
      ),
    ).toThrowError(/unknown field "bas"/);
  });

  it("LOUDLY rejects a step degree outside the declared degrees set", () => {
    expect(() =>
      parseBass808Spec(
        `name: x\ndegrees: [0, 7]\ncells:\n  - name: c\n    steps: [{pos: 0, len: 1, degree: 12}]`,
      ),
    ).toThrowError(/degree 12 is not in "degrees"/);
  });

  it("LOUDLY rejects the same degree-outside-degrees error inside turnaroundCells", () => {
    expect(() =>
      parseBass808Spec(
        `name: x\ndegrees: [0]\ncells:\n  - name: c\n    steps: [{pos: 0, len: 1, degree: 0}]\n` +
          `turnaroundCells:\n  - name: t\n    steps: [{pos: 0, len: 1, degree: 5}]`,
      ),
    ).toThrowError(/degree 5 is not in "degrees"/);
  });

  it("LOUDLY rejects an empty cells array", () => {
    expect(() => parseBass808Spec(`name: x\ndegrees: [0]\ncells: []`)).toThrowError(
      /"cells" must be a non-empty array/,
    );
  });

  it("LOUDLY rejects a cell with an empty steps array", () => {
    expect(() =>
      parseBass808Spec(`name: x\ndegrees: [0]\ncells:\n  - name: c\n    steps: []`),
    ).toThrowError(/"steps" must be a non-empty array/);
  });

  it("an explicitly empty turnaroundCells array is fine (the documented default, not an error)", () => {
    const spec = parseBass808Spec(
      `name: x\ndegrees: [0]\ncells:\n  - name: c\n    steps: [{pos: 0, len: 1, degree: 0}]\nturnaroundCells: []`,
    );
    expect(spec.turnaroundCells).toEqual([]);
  });

  it("rejects an out-of-range register", () => {
    expect(() =>
      parseBass808Spec(
        `name: x\ndegrees: [0]\ncells:\n  - name: c\n    steps: [{pos: 0, len: 1, degree: 0}]\nregister: [40, 20]`,
      ),
    ).toThrowError(/"register" must be/);
  });

  it("rejects a non-positive turnaroundBar", () => {
    expect(() =>
      parseBass808Spec(
        `name: x\ndegrees: [0]\ncells:\n  - name: c\n    steps: [{pos: 0, len: 1, degree: 0}]\nturnaroundBar: 0`,
      ),
    ).toThrowError(/"turnaroundBar" must be a positive integer/);
  });

  it("lists the built-in styles and their cell-name variants", () => {
    expect(listBass808Styles()).toEqual(["trap-long", "trap-syncopated", "triplet-flow"]);
    expect(listBass808Variants(TRAP_LONG_SPEC)).toEqual(["anchor-hold", "octave-answer"]);
    expect(listBass808Variants(TRAP_SYNCOPATED_SPEC)).toEqual([
      "and-of-3-push",
      "off-beat-double",
      "sparse-slide-answer",
    ]);
  });
});

// ---------------------------------------------------------------------------
// generate808 — a hand-built fixture with exactly one cell (so the weighted
// draw is deterministic regardless of the rng stream) for mechanics that
// need a precisely known step layout: the slide-overlap/bar-crossing/
// last-note-fallback property.
// ---------------------------------------------------------------------------

const SIMPLE_SPEC: Bass808Spec = {
  name: "simple",
  cells: [
    {
      name: "only",
      weight: 1,
      steps: [
        { pos: 0, len: 1.0, degree: 0, slide: false },
        { pos: 1, len: 1.0, degree: 7, slide: false },
        { pos: 2, len: 1.0, degree: 0, slide: false },
        { pos: 3, len: 1.0, degree: 0, slide: true }, // bar-crossing pickup
      ],
    },
  ],
  degrees: [0, 7, 12],
  register: [24, 36],
  slideOverlapBeats: 0.1,
  velocity: { base: 100, accentFirst: 20 },
  turnaroundBar: 4,
  turnaroundCells: [],
  swing: 0,
};

describe("generate808 — slide overlap mechanics (hand-verified fixture)", () => {
  it("bar-crossing slide pairs overlap by EXACTLY slideOverlapBeats; the final slide step (no successor) falls back to written length; nothing else overlaps", () => {
    const { notes } = generate808(SIMPLE_SPEC, 0, { seed: 1, bars: 4 });
    expect(notes).toHaveLength(16);

    // one cell per bar, 4 steps/cell -> the bar-crossing slide is always the
    // 4th note of bars 1-3 (indices 3, 7, 11); bar 4's slide step (index 15)
    // is the last placed note overall (no successor).
    for (const i of [3, 7, 11]) {
      const cur = notes[i]!;
      const next = notes[i + 1]!;
      expect(cur.duration).toBeCloseTo(1.1, 9); // (next.start - cur.start = 1) + 0.1 overlap
      expect(cur.start + cur.duration - next.start).toBeCloseTo(0.1, 9);
    }
    expect(notes[15]!.duration).toBeCloseTo(1.0, 9); // written length, no successor to slide onto

    // every other adjacent pair has zero (or positive) gap; only the three
    // bar-crossing slide pairs above ever overlap.
    for (let i = 0; i + 1 < notes.length; i++) {
      if ([3, 7, 11].includes(i)) continue;
      const cur = notes[i]!;
      const next = notes[i + 1]!;
      expect(next.start - (cur.start + cur.duration)).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("--slides off: the same bar-crossing step reverts to its written length (zero overlap)", () => {
    const { notes, meta } = generate808(SIMPLE_SPEC, 0, { seed: 1, bars: 2, slides: false });
    expect(meta.slides).toBe("off");
    expect(notes[3]!.duration).toBeCloseTo(1.0, 9);
    expect(notes[3]!.start + notes[3]!.duration).toBeLessThanOrEqual(notes[4]!.start + 1e-9);
  });

  it("accentFirst applies only to the bar-local first step (pos 0), not the others", () => {
    const { notes } = generate808(SIMPLE_SPEC, 0, { seed: 1, bars: 2 });
    expect(notes[0]!.velocity).toBe(120); // base 100 + accentFirst 20
    expect(notes[1]!.velocity).toBe(100);
    expect(notes[2]!.velocity).toBe(100);
    expect(notes[3]!.velocity).toBe(100);
    expect(notes[4]!.velocity).toBe(120); // bar 2's own first step
  });
});

describe("generate808 — negative control across all three built-ins", () => {
  it("--slides off produces zero overlaps and no zero-length/negative-gap notes, even on slide-heavy styles", () => {
    for (const built of [TRAP_LONG_SPEC, TRAP_SYNCOPATED_SPEC, TRIPLET_FLOW_SPEC]) {
      for (const seed of [1, 2, 3]) {
        const { notes } = generate808(built, 4, { seed, bars: 8, slides: false });
        for (const n of notes) expect(n.duration).toBeGreaterThan(0);
        for (let i = 0; i + 1 < notes.length; i++) {
          expect(
            notes[i + 1]!.start - (notes[i]!.start + notes[i]!.duration),
          ).toBeGreaterThanOrEqual(-1e-9);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// generate808 — degree/register semantics
// ---------------------------------------------------------------------------

describe("generate808 — degree/register semantics", () => {
  it("root is octave-fitted into register from the raw pitch class; degrees are NOT re-folded even when they push the pitch outside register bounds", () => {
    const spec: Bass808Spec = { ...SIMPLE_SPEC, register: [24, 30] }; // narrow window
    const { notes, meta } = generate808(spec, 0 /* C */, { seed: 1, bars: 1 });
    expect(Number(meta.root)).toBe(24); // C (pitch class 0) fitted up into [24, 30]
    // degree 7 (G) -> 31: outside [24, 30] and must not be clamped/folded back in
    expect(notes.some((n) => n.pitch === 31)).toBe(true);
  });

  it("every emitted pitch is root + a declared degree, across all three built-ins and many seeds", () => {
    for (const built of [TRAP_LONG_SPEC, TRAP_SYNCOPATED_SPEC, TRIPLET_FLOW_SPEC]) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const { notes, meta } = generate808(built, 9 /* A */, { seed, bars: 8 });
        const root = Number(meta.root);
        const allowed = new Set(built.degrees.map((d) => root + d));
        expect(notes.length).toBeGreaterThan(0);
        for (const n of notes) expect(allowed.has(n.pitch)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// generate808 — cell draw: weighted, --variant, turnaround
// ---------------------------------------------------------------------------

describe("generate808 — cell draw and turnaround", () => {
  it("--variant pins a named cell (by index) for every non-turnaround bar", () => {
    const { meta } = generate808(TRAP_LONG_SPEC, 0, { seed: 1, bars: 4, variant: 1 });
    const draws = meta.cellDraws!.split(",");
    expect(draws).toEqual(["octave-answer", "octave-answer", "octave-answer", "octave-answer"]);
  });

  it("turnaround bars draw from turnaroundCells when present, every turnaroundBar-th bar (trap-syncopated)", () => {
    const { meta } = generate808(TRAP_SYNCOPATED_SPEC, 0, { seed: 1, bars: 8 });
    const draws = meta.cellDraws!.split(",");
    expect(draws).toHaveLength(8);
    expect(draws[3]).toBe("turnaround-fall"); // bar 4
    expect(draws[7]).toBe("turnaround-fall"); // bar 8
    for (const i of [0, 1, 2, 4, 5, 6]) expect(draws[i]).not.toBe("turnaround-fall");
  });

  it("--variant is ignored on turnaround bars (they still draw from turnaroundCells)", () => {
    const { meta } = generate808(TRAP_SYNCOPATED_SPEC, 0, { seed: 1, bars: 4, variant: 0 });
    const draws = meta.cellDraws!.split(",");
    expect(draws).toEqual(["and-of-3-push", "and-of-3-push", "and-of-3-push", "turnaround-fall"]);
  });

  it("styles with no turnaroundCells (trap-long, triplet-flow) always draw from `cells`, every bar", () => {
    for (const built of [TRAP_LONG_SPEC, TRIPLET_FLOW_SPEC]) {
      const { meta } = generate808(built, 0, { seed: 1, bars: 8 });
      const cellNames = new Set(built.cells.map((c) => c.name));
      for (const d of meta.cellDraws!.split(",")) expect(cellNames.has(d)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// generate808 — triplet grid exactness
// ---------------------------------------------------------------------------

describe("generate808 — triplet grid exactness", () => {
  it("triplet-flow's notes all land on exact multiples of 1/3 beat within the bar", () => {
    const { notes } = generate808(TRIPLET_FLOW_SPEC, 0, { seed: 1, bars: 4, slides: false });
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) {
      const local =
        ((n.start % BASS808_BEATS_PER_BAR) + BASS808_BEATS_PER_BAR) % BASS808_BEATS_PER_BAR;
      const thirds = local * 3;
      expect(Math.abs(thirds - Math.round(thirds))).toBeLessThan(1e-6);
    }
  });
});

// ---------------------------------------------------------------------------
// generate808 — determinism (frozen regressions)
// ---------------------------------------------------------------------------

describe("generate808 — determinism (frozen regressions)", () => {
  for (const built of [TRAP_LONG_SPEC, TRAP_SYNCOPATED_SPEC, TRIPLET_FLOW_SPEC]) {
    for (const seed of [1, 42]) {
      it(`${built.name} @ seed ${seed}: same input -> byte-identical output`, () => {
        const a = generate808(built, 9, { seed, bars: 8 });
        const b = generate808(built, 9, { seed, bars: 8 });
        expect(a).toEqual(b);
        expect(a.notes.length).toBeGreaterThan(0);
      });
    }
  }

  it("trap-long @ seed 1, root A, 1 bar: pins the exact note output (regression anchor)", () => {
    const { notes, meta } = generate808(TRAP_LONG_SPEC, 9, { seed: 1, bars: 1 });
    expect(meta.root).toBe("33"); // A (pitch class 9) fitted into [24, 36]
    expect(meta.cellDraws).toBe("octave-answer");
    expect(notes).toEqual([
      { pitch: 33, start: 0, duration: 1.5, velocity: 122 },
      { pitch: 45, start: 2, duration: 1.05, velocity: 110 },
      { pitch: 33, start: 3, duration: 1, velocity: 110 }, // last note, no successor -> written length
    ]);
  });

  it("bars beyond a whole number, or < 1, is a clear error (not a silent truncation)", () => {
    expect(() => generate808(TRAP_LONG_SPEC, 0, { seed: 1, bars: 0 })).toThrow(
      /bars must be a positive integer/,
    );
    expect(() => generate808(TRAP_LONG_SPEC, 0, { seed: 1, bars: 2.5 })).toThrow(
      /bars must be a positive integer/,
    );
  });
});
