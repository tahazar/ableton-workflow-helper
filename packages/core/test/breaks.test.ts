import { describe, expect, it } from "vitest";
import {
  HALFTIME_SPEC,
  JUNGLE_CLASSIC_SPEC,
  listBreakStyles,
  parseBreakSpec,
  type BreakSpec,
} from "../src/breaks/spec.js";
import {
  DRUM_RACK_PAD_COUNT,
  SLICE_NOTE_BASE,
  noteToSliceIndex,
  parseChopMap,
  sliceNote,
  type ChopMap,
  type ChopMapSlice,
} from "../src/breaks/chopmap.js";
import {
  DEFAULT_FILL_SPEC,
  LOW_CONFIDENCE_THRESHOLD,
  generateBreakFill,
  generateBreakPattern,
} from "../src/breaks/engine.js";

// ---------------------------------------------------------------------------
// parseBreakSpec
// ---------------------------------------------------------------------------

describe("parseBreakSpec", () => {
  it("round-trips the built-in jungle-classic document", () => {
    const yaml = `
name: jungle-classic
statementBars: 1
turnaroundDensity: 0.6
snareDisplacement: [-1, 1, 2]
ghostShuffleChance: 0.25
allowSubstitution: true
`;
    expect(parseBreakSpec(yaml)).toEqual(JUNGLE_CLASSIC_SPEC);
  });

  it("round-trips the built-in halftime document", () => {
    const yaml = `
name: halftime
statementBars: 0
turnaroundDensity: 0.15
snareDisplacement: []
ghostShuffleChance: 0.05
allowSubstitution: true
`;
    expect(parseBreakSpec(yaml)).toEqual(HALFTIME_SPEC);
  });

  it("fills in documented defaults when optional fields are omitted", () => {
    const spec = parseBreakSpec(`name: minimal`);
    expect(spec.statementBars).toBe(1);
    expect(spec.turnaroundDensity).toBe(0.5);
    expect(spec.snareDisplacement).toEqual([]);
    expect(spec.ghostShuffleChance).toBe(0);
    expect(spec.allowSubstitution).toBe(true);
  });

  it("rejects an unknown top-level field (typo-catching)", () => {
    expect(() => parseBreakSpec(`name: x\nturnarondDensity: 0.5`)).toThrow(/unknown field/);
  });

  it("rejects a missing name", () => {
    expect(() => parseBreakSpec(`statementBars: 1`)).toThrow(/"name"/);
  });

  it("rejects an out-of-range turnaroundDensity", () => {
    expect(() => parseBreakSpec(`name: x\nturnaroundDensity: 1.5`)).toThrow(/turnaroundDensity/);
  });

  it("rejects a zero entry in snareDisplacement (must be a real offset)", () => {
    expect(() => parseBreakSpec(`name: x\nsnareDisplacement: [0]`)).toThrow(/snareDisplacement/);
  });

  it("lists the built-in style names", () => {
    expect(listBreakStyles()).toEqual(["jungle-classic", "halftime"]);
  });
});

// ---------------------------------------------------------------------------
// chopmap: parseChopMap + sliceNote
// ---------------------------------------------------------------------------

describe("parseChopMap", () => {
  it("adapts the Python analyzer's raw (snake_case) JSON shape", () => {
    const raw = {
      file: "amen.wav",
      bpm: 138.5,
      bpm_confidence: 0.82,
      grid_steps_per_bar: 16,
      beats_per_bar: 4,
      slices: [
        {
          index: 0,
          start_s: 0.0,
          end_s: 0.5,
          grid_step: 0,
          offset_ms: 3.2,
          role: "kick",
          confidence: 0.91,
          is_ghost: false,
        },
      ],
    };
    const map = parseChopMap(raw);
    expect(map.bpm).toBe(138.5);
    expect(map.bpmConfidence).toBe(0.82);
    expect(map.gridStepsPerBar).toBe(16);
    expect(map.slices).toEqual([
      {
        index: 0,
        startS: 0,
        endS: 0.5,
        gridStep: 0,
        offsetMs: 3.2,
        role: "kick",
        confidence: 0.91,
        isGhost: false,
      },
    ]);
  });

  it("rejects an invalid role", () => {
    expect(() =>
      parseChopMap({
        bpm: 120,
        slices: [{ index: 0, start_s: 0, end_s: 1, grid_step: 0, offset_ms: 0, role: "cowbell", confidence: 1 }],
      }),
    ).toThrow(/role/);
  });
});

describe("sliceNote", () => {
  it("drum-rack and live-slices both map slice index -> C1-up chromatically", () => {
    expect(sliceNote(0, "drum-rack", 4)).toBe(SLICE_NOTE_BASE);
    expect(sliceNote(3, "live-slices", 4)).toBe(SLICE_NOTE_BASE + 3);
  });

  it("drum-rack mode refuses to address a slice beyond one rack page", () => {
    expect(() => sliceNote(16, "drum-rack", 17)).toThrow(/at most 16 pads/);
  });

  it("live-slices mode has no 16-pad cap", () => {
    expect(sliceNote(30, "live-slices", 40)).toBe(SLICE_NOTE_BASE + 30);
  });

  it("noteToSliceIndex inverts sliceNote", () => {
    expect(noteToSliceIndex(sliceNote(7, "drum-rack", 10))).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// generateBreakPattern
// ---------------------------------------------------------------------------

const STEP_BEATS = 0.25; // 16 steps/bar, 4 beats/bar

function slice(
  index: number,
  gridStep: number,
  role: ChopMapSlice["role"],
  confidence = 0.9,
): ChopMapSlice {
  return {
    index,
    startS: gridStep * 0.1,
    endS: (gridStep + 1) * 0.1,
    gridStep,
    offsetMs: 0,
    role,
    confidence,
    isGhost: role === "ghost",
  };
}

/** A one-bar (16-step) canonical amen-ish skeleton: kick@0, snare@4, hat@8,
 *  snare@12, a ghost hit@15 (the bar's last step, so the canonical timeline
 *  measures out to a clean 16 steps — sourceLen = max(gridStep)+1). */
function amenMap(confidence = 0.9): ChopMap {
  return {
    file: "amen.wav",
    bpm: 138,
    bpmConfidence: 0.8,
    gridStepsPerBar: 16,
    beatsPerBar: 4,
    slices: [
      slice(0, 0, "kick", confidence),
      slice(1, 4, "snare", confidence),
      slice(2, 8, "hat", confidence),
      slice(3, 12, "snare", confidence),
      slice(4, 15, "ghost", confidence),
    ],
  };
}

const noteToIndex = (pitch: number) => noteToSliceIndex(pitch);

describe("generateBreakPattern — statement phase (verbatim, deterministic)", () => {
  it("bars=1, statementBars=1: exact canonical notes, no rng influence at all", () => {
    const spec: BreakSpec = { ...JUNGLE_CLASSIC_SPEC, statementBars: 1 };
    const { notes, warnings } = generateBreakPattern(amenMap(), spec, {
      seed: 1,
      bars: 1,
      mode: "drum-rack",
    });
    expect(warnings).toEqual([]);
    expect(notes).toEqual([
      { pitch: 36, start: 0, duration: 0.2125, velocity: 100 },
      { pitch: 37, start: 1.0, duration: 0.2125, velocity: 100 },
      { pitch: 38, start: 2.0, duration: 0.2125, velocity: 100 },
      { pitch: 39, start: 3.0, duration: 0.2125, velocity: 100 },
      { pitch: 40, start: 3.75, duration: 0.2125, velocity: 100 },
    ]);
  });

  it("is unaffected by seed (statement never touches rng)", () => {
    const spec: BreakSpec = { ...JUNGLE_CLASSIC_SPEC, statementBars: 1 };
    const a = generateBreakPattern(amenMap(), spec, { seed: 1, bars: 1, mode: "drum-rack" });
    const b = generateBreakPattern(amenMap(), spec, { seed: 99, bars: 1, mode: "drum-rack" });
    expect(a.notes).toEqual(b.notes);
  });
});

describe("generateBreakPattern — every note maps to a real slice", () => {
  for (const style of [JUNGLE_CLASSIC_SPEC, HALFTIME_SPEC]) {
    it(`${style.name}: 4 bars, seed 7 — all pitches resolve to a valid slice index`, () => {
      const { notes } = generateBreakPattern(amenMap(), style, { seed: 7, bars: 4, mode: "drum-rack" });
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) {
        const idx = noteToIndex(n.pitch);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(5);
      }
    });
  }
});

describe("generateBreakPattern — role substitution honors roles", () => {
  it("every non-displaced, non-shuffled note at a canonical step keeps that step's own role", () => {
    const spec: BreakSpec = {
      name: "role-test",
      statementBars: 0,
      turnaroundDensity: 1,
      snareDisplacement: [], // isolate substitution/stutter only
      ghostShuffleChance: 0,
      allowSubstitution: true,
    };
    const map = amenMap();
    const { notes } = generateBreakPattern(map, spec, { seed: 3, bars: 3, mode: "drum-rack" });
    const roleByIndex = new Map(map.slices.map((s) => [s.index, s.role]));
    const canonicalRoleAtStep = new Map(map.slices.map((s) => [s.gridStep, s.role]));

    for (const n of notes) {
      const step = n.start / STEP_BEATS;
      if (!Number.isInteger(step)) continue; // stutter tail — same index as its own head, checked via the pitch itself
      const canonicalStep = ((step % 16) + 16) % 16;
      const expectedRole = canonicalRoleAtStep.get(canonicalStep);
      expect(expectedRole).toBeDefined();
      expect(roleByIndex.get(noteToIndex(n.pitch))).toBe(expectedRole);
    }
  });
});

describe("generateBreakPattern — negative control: all-low-confidence roles", () => {
  it("warns and restricts to same-slice tricks (never substitutes a different slice)", () => {
    const spec: BreakSpec = {
      name: "low-conf-test",
      statementBars: 0,
      turnaroundDensity: 1,
      snareDisplacement: [],
      ghostShuffleChance: 0,
      allowSubstitution: true, // spec ALLOWS it — the map's own low confidence must override
    };
    const map = amenMap(0.3); // every slice below LOW_CONFIDENCE_THRESHOLD (0.4)
    expect(map.slices.every((s) => s.confidence < LOW_CONFIDENCE_THRESHOLD)).toBe(true);

    const { notes, warnings, meta } = generateBreakPattern(map, spec, { seed: 5, bars: 3, mode: "drum-rack" });
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/confidence/);
    expect(meta.substitutionAllowed).toBe("false");

    const canonicalIndexAtStep = new Map(map.slices.map((s) => [s.gridStep, s.index]));
    for (const n of notes) {
      const step = n.start / STEP_BEATS;
      if (!Number.isInteger(step)) continue; // stutter tail
      const canonicalStep = ((step % 16) + 16) % 16;
      const expectedIndex = canonicalIndexAtStep.get(canonicalStep);
      expect(expectedIndex).toBeDefined();
      // never a DIFFERENT slice of the same role — always the canonical
      // slice's own index (stutter/retrigger only).
      expect(noteToIndex(n.pitch)).toBe(expectedIndex);
    }
  });
});

describe("generateBreakPattern — snare displacement", () => {
  it("moves a snare hit off its canonical step by a listed offset", () => {
    const map: ChopMap = {
      file: "x.wav",
      bpm: 120,
      bpmConfidence: 0.8,
      gridStepsPerBar: 16,
      beatsPerBar: 4,
      slices: [slice(0, 0, "kick", 0.9), slice(1, 8, "snare", 0.9)],
    };
    const spec: BreakSpec = {
      name: "displace-test",
      statementBars: 0,
      turnaroundDensity: 1, // displacement roll always fires
      snareDisplacement: [2],
      ghostShuffleChance: 0,
      allowSubstitution: false,
    };
    const { notes } = generateBreakPattern(map, spec, { seed: 1, bars: 1, mode: "drum-rack" });
    const snareNotes = notes.filter((n) => noteToIndex(n.pitch) === 1);
    expect(snareNotes.some((n) => n.start === 8 * STEP_BEATS)).toBe(false); // never at its own step
    expect(snareNotes.some((n) => n.start === 10 * STEP_BEATS)).toBe(true); // relocated +2 steps
  });
});

describe("generateBreakPattern — zero-slices map is a state, not an error", () => {
  it("returns no notes and a plain-language warning", () => {
    const map: ChopMap = {
      file: "empty.wav",
      bpm: 120,
      bpmConfidence: 0,
      gridStepsPerBar: 16,
      beatsPerBar: 4,
      slices: [],
    };
    const { notes, warnings } = generateBreakPattern(map, JUNGLE_CLASSIC_SPEC, {
      seed: 1,
      bars: 2,
      mode: "drum-rack",
    });
    expect(notes).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("generateBreakPattern — determinism (frozen regressions)", () => {
  for (const style of [JUNGLE_CLASSIC_SPEC, HALFTIME_SPEC]) {
    for (const seed of [1, 42]) {
      it(`${style.name} @ seed ${seed}: same input -> identical output`, () => {
        const a = generateBreakPattern(amenMap(), style, { seed, bars: 4, mode: "drum-rack" });
        const b = generateBreakPattern(amenMap(), style, { seed, bars: 4, mode: "drum-rack" });
        expect(a).toEqual(b);
        expect(a.notes.length).toBeGreaterThan(0);
      });
    }
  }
});

describe("generateBreakPattern — drum-rack cap surfaces as an error, not a silent wrap", () => {
  it("throws when the map has more slices than one rack page can address", () => {
    const many: ChopMap = {
      file: "x.wav",
      bpm: 120,
      bpmConfidence: 0.8,
      gridStepsPerBar: 32,
      beatsPerBar: 4,
      slices: Array.from({ length: 17 }, (_, i) => slice(i, i, "kick", 0.9)),
    };
    expect(() =>
      generateBreakPattern(many, JUNGLE_CLASSIC_SPEC, { seed: 1, bars: 1, mode: "drum-rack" }),
    ).toThrow(/at most 16 pads/);
    expect(() =>
      generateBreakPattern(many, JUNGLE_CLASSIC_SPEC, { seed: 1, bars: 1, mode: "live-slices" }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// generateBreakFill
// ---------------------------------------------------------------------------

describe("generateBreakFill", () => {
  it("every candidate's notes map to a real slice index", () => {
    const { candidates } = generateBreakFill(amenMap(), { seed: 1, beats: 2, count: 5 });
    expect(candidates).toHaveLength(5);
    for (const c of candidates) {
      expect(c.notes.length).toBeGreaterThan(0);
      for (const n of c.notes) {
        const idx = noteToIndex(n.pitch);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(5);
      }
    }
  });

  it("restraint rule: never more than maxDevices distinct device types per candidate", () => {
    const { candidates } = generateBreakFill(amenMap(), { seed: 3, beats: 2, count: 20 });
    for (const c of candidates) {
      const distinct = new Set(c.devicesUsed);
      expect(distinct.size).toBeLessThanOrEqual(DEFAULT_FILL_SPEC.maxDevices);
      expect(c.devicesUsed.length).toBe(distinct.size); // no duplicate device names
    }
  });

  it("names candidates 'fill <devices> s<seed>' (drop-respond convention)", () => {
    const { candidates } = generateBreakFill(amenMap(), { seed: 2, beats: 2, count: 3 });
    for (const c of candidates) {
      expect(c.name).toBe(`fill ${c.devicesUsed.join(",")} s${c.seed}`);
    }
  });

  it("seeded candidates are pairwise distinguishable in seed and reproducible", () => {
    const a = generateBreakFill(amenMap(), { seed: 10, beats: 2, count: 4 });
    const b = generateBreakFill(amenMap(), { seed: 10, beats: 2, count: 4 });
    expect(a).toEqual(b);
    const seeds = a.candidates.map((c) => c.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it("zero-slices map is a state, not an error", () => {
    const map: ChopMap = { file: "empty.wav", bpm: 120, bpmConfidence: 0, gridStepsPerBar: 16, beatsPerBar: 4, slices: [] };
    const { candidates, warnings } = generateBreakFill(map, { seed: 1, beats: 2, count: 3 });
    expect(candidates).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
