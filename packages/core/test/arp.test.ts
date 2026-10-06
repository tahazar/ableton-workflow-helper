import { describe, expect, it } from "vitest";
import type { NoteSpec } from "../src/bridge/types.js";
import {
  BASIC_UP_SPEC,
  MELODIC_TECHNO_16THS_SPEC,
  arpRateBeats,
  checkArpGate,
  listArpStyles,
  listArpVariants,
  parseArpSpec,
  type ArpSpec,
} from "../src/arp/spec.js";
import {
  chordsFromNotes,
  euclideanMask,
  generateArp,
  type ArpChordSpan,
} from "../src/arp/engine.js";
import { ratchet } from "../src/transforms/ratchet.js";
import type { TransformContext } from "../src/transforms/types.js";
import { makeRng } from "../src/transforms/rng.js";

const txCtx = (overrides: Partial<TransformContext> = {}): TransformContext => ({
  lengthBeats: 8,
  beatsPerBar: 4,
  rng: makeRng(1),
  ...overrides,
});

// ---------------------------------------------------------------------------
// parseArpSpec
// ---------------------------------------------------------------------------

describe("parseArpSpec", () => {
  it("round-trips the built-in melodic-techno-16ths document (docs/design/arp-engine.md, verbatim)", () => {
    const yaml = `
name: melodic-techno-16ths
contour: updown
octaves: 2
rate: 1/16
gate: 0.8
patternLength: 16
euclid: {k: 16, n: 16, rotate: 0}
rests: []
ratchets: {}
velocity:
  base: 96
  accentSteps: [0, 6, 10]
  accentBoost: 24
  shape: none
swing: 0
walk:
  maxInterval: 2
`;
    expect(parseArpSpec(yaml)).toEqual(MELODIC_TECHNO_16THS_SPEC);
  });

  it("fills in documented defaults when optional fields are omitted", () => {
    const spec = parseArpSpec(`name: minimal`);
    expect(spec.contour).toBe("up");
    expect(spec.octaves).toBe(1);
    expect(spec.rate).toBe("1/16");
    expect(spec.gate).toBe(0.8);
    expect(spec.patternLength).toBe(16);
    expect(spec.euclid).toEqual({ k: 16, n: 16, rotate: 0 }); // full mask sized to patternLength
    expect(spec.rests).toEqual([]);
    expect(spec.ratchets).toEqual({});
    expect(spec.velocity).toEqual({ base: 100, accentSteps: [], accentBoost: 0, shape: "none" });
    expect(spec.swing).toBe(0);
    expect(spec.walk).toEqual({ maxInterval: 2 });
  });

  it("rejects an unknown top-level key (typo protection)", () => {
    expect(() => parseArpSpec(`name: x\ncontor: up`)).toThrowError(/unknown field "contor"/);
  });

  it("rejects an unknown nested euclid key", () => {
    expect(() => parseArpSpec(`name: x\neuclid: {k: 4, n: 8, rotat: 1}`)).toThrowError(/unknown field "rotat"/);
  });

  it("rejects an unknown nested velocity key", () => {
    expect(() => parseArpSpec(`name: x\nvelocity: {base: 90, accent: [0]}`)).toThrowError(/unknown field "accent"/);
  });

  it("rejects an invalid contour", () => {
    expect(() => parseArpSpec(`name: x\ncontour: sideways`)).toThrowError(/"contour" must be one of/);
  });

  it("rejects a malformed rate", () => {
    expect(() => parseArpSpec(`name: x\nrate: 1/6`)).toThrowError(/"rate" must be/);
  });

  it("rejects a gate outside [0.05, 1.0]", () => {
    expect(() => parseArpSpec(`name: x\ngate: 1.5`)).toThrowError(/"gate" must be/);
  });

  it("LOUDLY rejects euclid.k = 0 (a silent arp is never generated wordlessly)", () => {
    expect(() => parseArpSpec(`name: x\neuclid: {k: 0, n: 16}`)).toThrowError(
      /euclid\.k.*must be >= 1.*silent arp/,
    );
  });

  it("rejects euclid.k > euclid.n", () => {
    expect(() => parseArpSpec(`name: x\neuclid: {k: 20, n: 16}`)).toThrowError(/must be <=/);
  });

  it("rejects a rests index out of [0, patternLength)", () => {
    expect(() => parseArpSpec(`name: x\npatternLength: 8\nrests: [8]`)).toThrowError(/rests\[0\]/);
  });

  it("rejects a ratchet subdivision count outside {2,3,4}", () => {
    expect(() => parseArpSpec(`name: x\nratchets: {2: 5}`)).toThrowError(/subdivision count/);
  });

  it("lists the built-in styles and their variants (euclid rotation)", () => {
    expect(listArpStyles()).toEqual(["basic-up", "melodic-techno-16ths"]);
    expect(listArpVariants(BASIC_UP_SPEC)).toEqual(
      Array.from({ length: 16 }, (_, i) => `rotate-${i}`),
    );
  });

  it("arpRateBeats/checkArpGate validate CLI --rate/--gate overrides the same way the parser does", () => {
    expect(arpRateBeats("1/16")).toBeCloseTo(0.25);
    expect(arpRateBeats("1/8t")).toBeCloseTo((4 / 8) * (2 / 3));
    expect(arpRateBeats("1/4d")).toBeCloseTo(1 * 1.5);
    expect(() => arpRateBeats("1/6")).toThrow();
    expect(checkArpGate(0.5)).toBe(0.5);
    expect(() => checkArpGate(1.2)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// euclideanMask
// ---------------------------------------------------------------------------

describe("euclideanMask", () => {
  it("matches the classic E(3,8) rhythm (x..x..x.)", () => {
    expect(euclideanMask(3, 8, 0)).toEqual([
      true, false, false, true, false, false, true, false,
    ]);
  });

  it("produces exactly k onsets at every rotation, for a spread of (k,n) pairs", () => {
    for (const [k, n] of [
      [3, 8],
      [5, 16],
      [7, 16],
      [2, 5],
      [1, 4],
      [16, 16],
    ] as const) {
      for (let rotate = 0; rotate < n; rotate++) {
        const mask = euclideanMask(k, n, rotate);
        expect(mask.filter(Boolean).length).toBe(k);
        expect(mask.length).toBe(n);
      }
    }
  });

  it("k=0 is all-false, k=n is all-true (degenerate edges, no throw)", () => {
    expect(euclideanMask(0, 8)).toEqual(Array.from({ length: 8 }, () => false));
    expect(euclideanMask(16, 16)).toEqual(Array.from({ length: 16 }, () => true));
  });

  it("negative rotate wraps the same as a positive equivalent", () => {
    expect(euclideanMask(3, 8, -1)).toEqual(euclideanMask(3, 8, 7));
  });
});

// ---------------------------------------------------------------------------
// chordsFromNotes
// ---------------------------------------------------------------------------

describe("chordsFromNotes", () => {
  it("NEGATIVE CONTROL: a melody (no simultaneities) is a state, not a garbage 1-note-chord result", () => {
    const notes: NoteSpec[] = [
      { pitch: 60, start: 0, duration: 0.5, velocity: 100 },
      { pitch: 62, start: 0.5, duration: 0.5, velocity: 100 },
      { pitch: 64, start: 1, duration: 0.5, velocity: 100 },
    ];
    expect(chordsFromNotes(notes)).toEqual({ kind: "melody" });
  });

  it("an empty clip is also a melody state (nothing to arpeggiate)", () => {
    expect(chordsFromNotes([])).toEqual({ kind: "melody" });
  });

  it("groups same-start notes into chords with contiguous spans", () => {
    const notes: NoteSpec[] = [
      { pitch: 67, start: 0, duration: 2, velocity: 100 },
      { pitch: 60, start: 0, duration: 2, velocity: 100 },
      { pitch: 64, start: 0, duration: 2, velocity: 100 },
      { pitch: 72, start: 2, duration: 1.5, velocity: 100 },
      { pitch: 76, start: 2, duration: 2, velocity: 100 },
    ];
    const result = chordsFromNotes(notes);
    expect(result.kind).toBe("chords");
    if (result.kind !== "chords") throw new Error("unreachable");
    expect(result.chords).toEqual([
      { pitches: [60, 64, 67], startBeat: 0, endBeat: 2 },
      { pitches: [72, 76], startBeat: 2, endBeat: 4 }, // last chord: own longest duration
    ]);
  });

  it("a clip with at least one real simultaneity is 'chords' even if one group is a single note", () => {
    const notes: NoteSpec[] = [
      { pitch: 60, start: 0, duration: 1, velocity: 100 },
      { pitch: 64, start: 0, duration: 1, velocity: 100 },
      { pitch: 67, start: 1, duration: 1, velocity: 100 },
    ];
    const result = chordsFromNotes(notes);
    expect(result.kind).toBe("chords");
  });
});

// ---------------------------------------------------------------------------
// generateArp
// ---------------------------------------------------------------------------

const FULL_MASK_SPEC = (overrides: Partial<ArpSpec> = {}): ArpSpec => ({
  ...BASIC_UP_SPEC,
  euclid: { k: BASIC_UP_SPEC.patternLength, n: BASIC_UP_SPEC.patternLength, rotate: 0 },
  ...overrides,
});

describe("generateArp — pitch pool", () => {
  it("every emitted pitch is in the chord voicing extended by octaves", () => {
    const chords: ArpChordSpan[] = [{ pitches: [60, 64, 67], startBeat: 0, endBeat: 8 }];
    const spec = FULL_MASK_SPEC({ octaves: 3 });
    const { notes } = generateArp(chords, spec, { seed: 1, bars: 2 });
    const allowed = new Set<number>();
    for (let o = 0; o < 3; o++) for (const p of chords[0]!.pitches) allowed.add(p + 12 * o);
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(allowed.has(n.pitch)).toBe(true);
  });

  it("as-voiced ignores the octave extension and only cycles the base voicing", () => {
    const chords: ArpChordSpan[] = [{ pitches: [60, 64, 67], startBeat: 0, endBeat: 8 }];
    const spec = FULL_MASK_SPEC({ contour: "as-voiced", octaves: 3 });
    const { notes } = generateArp(chords, spec, { seed: 1, bars: 2 });
    const base = new Set(chords[0]!.pitches);
    for (const n of notes) expect(base.has(n.pitch)).toBe(true);
    // and it reaches all three (not stuck on one octave copy)
    expect(new Set(notes.map((n) => n.pitch))).toEqual(base);
  });
});

describe("generateArp — polymeter wrap", () => {
  it("patternLength 12 at rate 1/16 over 2 bars wraps accents at hand-computed positions", () => {
    // 2 bars @ 4 beats, 1/16 steps -> 32 steps. Accent positions [0,5,10] mod 12:
    // i mod 12 in {0,5,10} for i in 0..31 -> {0,5,10,12,17,22,24,29}.
    const spec: ArpSpec = {
      ...BASIC_UP_SPEC,
      patternLength: 12,
      euclid: { k: 32, n: 32, rotate: 0 }, // full mask over the whole 2-bar run
      velocity: { base: 100, accentSteps: [0, 5, 10], accentBoost: 20, shape: "none" },
    };
    const chords: ArpChordSpan[] = [{ pitches: [60], startBeat: 0, endBeat: 8 }];
    const { notes } = generateArp(chords, spec, { seed: 1, bars: 2 });
    expect(notes).toHaveLength(32);
    const accentedIdx = notes.reduce<number[]>((acc, n, i) => {
      if (n.velocity === 120) acc.push(i);
      return acc;
    }, []);
    expect(accentedIdx).toEqual([0, 5, 10, 12, 17, 22, 24, 29]);
    for (const n of notes) {
      if (!accentedIdx.includes(notes.indexOf(n))) expect(n.velocity).toBe(100);
    }
  });
});

describe("generateArp — chord boundary re-selects the pool without resetting position", () => {
  it("the pitch INDEX keeps advancing across a chord change (does not restart at 0)", () => {
    // Two 3-note chords, 2 beats each, rate 1/16 (0.25 beat/step) -> 16 steps,
    // chordA covers steps 0-7, chordB covers steps 8-15. With a naive
    // "reset pattern position at chord change" bug, step 8's pitch index
    // would restart at 0 (chordB's bottom note, 72); the pinned behavior
    // keeps the global step counter (i=8) live, landing on i%3=2 (chordB's
    // top note, 79) instead, which distinguishes the two.
    const spec = FULL_MASK_SPEC({ octaves: 1, patternLength: 16 });
    const chords: ArpChordSpan[] = [
      { pitches: [60, 64, 67], startBeat: 0, endBeat: 2 },
      { pitches: [72, 76, 79], startBeat: 2, endBeat: 4 },
    ];
    const { notes } = generateArp(chords, spec, { seed: 1, bars: 1 });
    expect(notes).toHaveLength(16);
    expect(notes[7]!.pitch).toBe(64); // chordA, i=7, 7%3=1
    expect(notes[8]!.pitch).toBe(79); // chordB, i=8, 8%3=2 (not 72)
    expect(notes[9]!.pitch).toBe(72); // chordB, i=9, 9%3=0
  });
});

describe("generateArp — gate and ratchets", () => {
  it("a plain step's duration never exceeds the step (gate <= 1)", () => {
    const spec = FULL_MASK_SPEC({ gate: 1.0 });
    const chords: ArpChordSpan[] = [{ pitches: [60], startBeat: 0, endBeat: 8 }];
    const { notes } = generateArp(chords, spec, { seed: 1, bars: 2 });
    const stepBeats = 0.25; // 1/16
    for (const n of notes) expect(n.duration).toBeLessThanOrEqual(stepBeats + 1e-9);
  });

  it("ratcheted subdivisions never overlap and stay within the step", () => {
    const spec: ArpSpec = {
      ...BASIC_UP_SPEC,
      patternLength: 8,
      euclid: { k: 8, n: 8, rotate: 0 },
      gate: 1.0,
      ratchets: { 3: 3 },
    };
    const chords: ArpChordSpan[] = [{ pitches: [60], startBeat: 0, endBeat: 4 }];
    const { notes } = generateArp(chords, spec, { seed: 1, bars: 1 });
    // ratchet fires at pattern position 3 -> steps i=3 and i=11 within 16 steps
    const ratcheted = notes.filter((n) => n.start >= 0.75 - 1e-9 && n.start < 1.0 - 1e-9);
    expect(ratcheted).toHaveLength(3);
    for (let i = 1; i < ratcheted.length; i++) {
      expect(ratcheted[i]!.start).toBeGreaterThanOrEqual(ratcheted[i - 1]!.start + ratcheted[i - 1]!.duration - 1e-9);
    }
    expect(ratcheted[ratcheted.length - 1]!.start + ratcheted[ratcheted.length - 1]!.duration).toBeLessThanOrEqual(
      1.0 + 1e-9,
    );
  });
});

describe("generateArp — walk contour", () => {
  it("stays within maxInterval chord-tone steps per move", () => {
    const spec: ArpSpec = {
      ...BASIC_UP_SPEC,
      contour: "walk",
      euclid: { k: 16, n: 16, rotate: 0 },
      walk: { maxInterval: 2 },
    };
    const pitches = [60, 62, 64, 66, 68, 70, 72];
    const chords: ArpChordSpan[] = [{ pitches, startBeat: 0, endBeat: 32 }];
    const { notes } = generateArp(chords, spec, { seed: 7, bars: 8 });
    const idxs = notes.map((n) => pitches.indexOf(n.pitch));
    expect(idxs.every((i) => i >= 0)).toBe(true);
    for (let i = 1; i < idxs.length; i++) {
      expect(Math.abs(idxs[i]! - idxs[i - 1]!)).toBeLessThanOrEqual(2);
    }
  });
});

describe("generateArp — determinism (frozen regressions)", () => {
  for (const builtIn of [BASIC_UP_SPEC, MELODIC_TECHNO_16THS_SPEC]) {
    for (const seed of [1, 42]) {
      it(`${builtIn.name} @ seed ${seed}: same input -> byte-identical output`, () => {
        const chords: ArpChordSpan[] = [
          { pitches: [60, 63, 67], startBeat: 0, endBeat: 4 },
          { pitches: [65, 68, 72], startBeat: 4, endBeat: 8 },
          { pitches: [63, 67, 70], startBeat: 8, endBeat: 12 },
          { pitches: [58, 62, 65], startBeat: 12, endBeat: 16 },
        ];
        const a = generateArp(chords, builtIn, { seed, bars: 4 });
        const b = generateArp(chords, builtIn, { seed, bars: 4 });
        expect(a).toEqual(b);
        expect(a.notes.length).toBeGreaterThan(0);
        expect(a.meta).toEqual({
          contour: builtIn.contour,
          patternLength: String(builtIn.patternLength),
          seed: String(seed),
          rotate: "0",
        });
      });
    }
  }

  it("basic-up @ seed 1 over a fixed 1-bar progression pins the exact first notes (regression anchor)", () => {
    const chords: ArpChordSpan[] = [{ pitches: [60, 64, 67], startBeat: 0, endBeat: 4 }];
    const { notes } = generateArp(chords, BASIC_UP_SPEC, { seed: 1, bars: 1 });
    expect(notes.slice(0, 4)).toEqual([
      { pitch: 60, start: 0, duration: 0.2, velocity: 100 },
      { pitch: 64, start: 0.25, duration: 0.2, velocity: 100 },
      { pitch: 67, start: 0.5, duration: 0.2, velocity: 100 },
      { pitch: 60, start: 0.75, duration: 0.2, velocity: 100 },
    ]);
    expect(notes).toHaveLength(16);
  });
});

// ---------------------------------------------------------------------------
// ratchet transform (registry-facing)
// ---------------------------------------------------------------------------

describe("ratchet transform", () => {
  const notes: NoteSpec[] = [
    { pitch: 60, start: 0, duration: 1, velocity: 100 },
    { pitch: 64, start: 1, duration: 1, velocity: 90 },
  ];

  it("default 'all' subdivides every note into 3 non-overlapping repeats", () => {
    const transform = ratchet.make({});
    const out = transform(notes, txCtx());
    expect(out).toHaveLength(6);
    for (const n of out) expect(n.duration).toBeLessThanOrEqual(1 / 3 + 1e-9);
    // no overlap within each original note's repeats
    const firstThree = out.filter((n) => n.pitch === 60);
    for (let i = 1; i < firstThree.length; i++) {
      expect(firstThree[i]!.start).toBeGreaterThanOrEqual(
        firstThree[i - 1]!.start + firstThree[i - 1]!.duration - 1e-9,
      );
    }
  });

  it("steps selects specific grid positions, leaving other notes untouched", () => {
    const transform = ratchet.make({ steps: "4", count: 2, gate: 0.5 }); // note at start=1 -> position 4 @ grid 0.25
    const out = transform(notes, txCtx());
    const untouched = out.filter((n) => n.pitch === 60);
    const ratcheted = out.filter((n) => n.pitch === 64);
    expect(untouched).toHaveLength(1);
    expect(untouched[0]).toEqual(notes[0]);
    expect(ratcheted).toHaveLength(2);
    expect(ratcheted[0]!.duration).toBeCloseTo(0.25);
  });

  it("rejects a non-integer count", () => {
    expect(() => ratchet.make({ count: 2.5 })).toThrow(/count/);
  });
});
