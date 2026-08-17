import { describe, expect, it } from "vitest";
import { makeRng } from "../src/transforms/rng.js";
import { GM_DRUM_KIT, mapPadRoles, roleOfNote } from "../src/drums/roles.js";
import {
  TRAP_KICK_CELLS,
  generateDrumPattern,
  generateDrumPatternDetailed,
  listDrumStyles,
  listDrumVariants,
} from "../src/drums/grammars.js";
import { drumFill, humanizeDrums, varyDrums } from "../src/drums/fills.js";
import type { DrumContext, DrumKit } from "../src/drums/types.js";
import type { NoteSpec } from "../src/bridge/types.js";

const ctx = (overrides: Partial<DrumContext> = {}): DrumContext => ({
  bars: 2,
  beatsPerBar: 4,
  density: 0.5,
  rng: makeRng(1),
  ...overrides,
});

const FULL_KIT: DrumKit = {
  kick: 36,
  snare: 38,
  clap: 39,
  "hat-closed": 42,
  "hat-open": 46,
  ride: 51,
  crash: 49,
  tom: 45,
  shaker: 70,
  perc: 63,
};

describe("roles", () => {
  it("maps pad names to roles by keyword, case-insensitively", () => {
    const kit = mapPadRoles([
      { note: 36, name: "Kick 808" },
      { note: 38, name: "SNARE tight" },
      { note: 39, name: "Clap" },
      { note: 40, name: "CH hat" },
      { note: 41, name: "Open Hat" },
      { note: 47, name: "Ride cym" },
      { note: 48, name: "crash" },
      { note: 50, name: "Tom low" },
      { note: 60, name: "Shaker" },
    ]);
    expect(kit.kick).toBe(36);
    expect(kit.snare).toBe(38);
    expect(kit.clap).toBe(39);
    expect(kit["hat-closed"]).toBe(40);
    expect(kit["hat-open"]).toBe(41);
    expect(kit.ride).toBe(47);
    expect(kit.crash).toBe(48);
    expect(kit.tom).toBe(50);
    expect(kit.shaker).toBe(60);
  });

  it("names win over a coincidental GM match", () => {
    // note 38 is GM snare, but the name says clap -> role should be clap
    const kit = mapPadRoles([{ note: 38, name: "Clap" }]);
    expect(kit.clap).toBe(38);
    expect(kit.snare).toBeUndefined();
  });

  it("falls back to a GM note match when a pad has no usable name", () => {
    const kit = mapPadRoles([{ note: 36 }, { note: 49 }]);
    expect(kit.kick).toBe(36); // GM kick
    expect(kit.crash).toBe(49); // GM crash
  });

  it("falls back to perc when neither name nor GM note resolve a role", () => {
    const kit = mapPadRoles([{ note: 100, name: "Weird FX" }]);
    expect(kit.perc).toBe(100);
  });

  it("first pad wins per role", () => {
    const kit = mapPadRoles([
      { note: 36, name: "Kick A" },
      { note: 37, name: "Kick B" },
    ]);
    expect(kit.kick).toBe(36);
  });

  it("roleOfNote reverse-looks-up a kit", () => {
    expect(roleOfNote(GM_DRUM_KIT, 36)).toBe("kick");
    expect(roleOfNote(GM_DRUM_KIT, 999)).toBeUndefined();
  });
});

describe("generateDrumPattern", () => {
  it("lists the expected styles", () => {
    expect(listDrumStyles()).toEqual(["house", "techno", "trap"]);
  });

  it("throws a clear error on an unknown style", () => {
    expect(() => generateDrumPattern("dubstep", FULL_KIT, ctx())).toThrowError(/unknown drum style/);
  });

  for (const style of ["house", "techno", "trap"]) {
    it(`${style}: only emits pitches present in the kit`, () => {
      const notes = generateDrumPattern(style, FULL_KIT, ctx());
      const kitPitches = new Set(Object.values(FULL_KIT));
      for (const n of notes) {
        expect(kitPitches.has(n.pitch)).toBe(true);
      }
    });

    it(`${style}: respects the bars * beatsPerBar span`, () => {
      const bars = 3;
      const beatsPerBar = 4;
      const notes = generateDrumPattern(style, FULL_KIT, ctx({ bars, beatsPerBar }));
      const clipEnd = bars * beatsPerBar;
      for (const n of notes) {
        expect(n.start).toBeGreaterThanOrEqual(0);
        expect(n.start).toBeLessThan(clipEnd);
      }
    });

    it(`${style}: sorted by start then pitch`, () => {
      const notes = generateDrumPattern(style, FULL_KIT, ctx());
      for (let i = 1; i < notes.length; i++) {
        const prev = notes[i - 1]!;
        const cur = notes[i]!;
        expect(cur.start > prev.start || (cur.start === prev.start && cur.pitch >= prev.pitch)).toBe(true);
      }
    });

    it(`${style}: same seed is deterministic, different seed differs`, () => {
      const a = generateDrumPattern(style, FULL_KIT, ctx({ rng: makeRng(7) }));
      const b = generateDrumPattern(style, FULL_KIT, ctx({ rng: makeRng(7) }));
      const c = generateDrumPattern(style, FULL_KIT, ctx({ rng: makeRng(8), bars: 4 }));
      expect(a).toEqual(b);
      expect(a).not.toEqual(c);
    });

    it(`${style}: missing roles are skipped without error`, () => {
      const sparseKit: DrumKit = { kick: 36 };
      expect(() => generateDrumPattern(style, sparseKit, ctx())).not.toThrow();
      const notes = generateDrumPattern(style, sparseKit, ctx());
      for (const n of notes) expect(n.pitch).toBe(36);
    });
  }

  it("house: kicks on every beat", () => {
    const notes = generateDrumPattern("house", FULL_KIT, ctx({ bars: 1 }));
    const kickBeats = notes.filter((n) => n.pitch === FULL_KIT.kick).map((n) => n.start).sort((a, b) => a - b);
    expect(kickBeats).toEqual([0, 1, 2, 3]);
  });

  it("techno: kicks on every beat", () => {
    const notes = generateDrumPattern("techno", FULL_KIT, ctx({ bars: 1 }));
    const kickBeats = notes
      .filter((n) => n.pitch === FULL_KIT.kick && n.start % 1 === 0)
      .map((n) => n.start)
      .sort((a, b) => a - b);
    expect(kickBeats).toEqual([0, 1, 2, 3]);
  });

  it("trap: snare only on beat 3 of each bar", () => {
    const bars = 3;
    const notes = generateDrumPattern("trap", FULL_KIT, ctx({ bars, beatsPerBar: 4 }));
    const snareBeats = notes.filter((n) => n.pitch === FULL_KIT.snare).map((n) => n.start);
    expect(snareBeats).toEqual([2, 6, 10]); // beat index 2 (0-based) of each 4-beat bar
  });

  it("trap: the kick CELL is locked across ordinary bars (only velocities breathe)", () => {
    // bars 0 and 1 of a 3-bar loop are ordinary; bar 2 is the turnaround
    const { notes, meta } = generateDrumPatternDetailed("trap", FULL_KIT, ctx({ bars: 3 }));
    const kickOffsets = (bar: number) =>
      notes
        .filter((n) => n.pitch === FULL_KIT.kick && n.start >= bar * 4 && n.start < (bar + 1) * 4)
        .map((n) => n.start - bar * 4);
    const cell = TRAP_KICK_CELLS.find((c) => c.name === meta.kickCell)!;
    expect(kickOffsets(0)).toEqual(cell.offsets);
    expect(kickOffsets(1)).toEqual(cell.offsets);
    // turnaround may add a ghost on the final 16th but never loses the cell
    expect(kickOffsets(2).slice(0, cell.offsets.length)).toEqual(cell.offsets);
    expect(kickOffsets(2).length).toBeLessThanOrEqual(cell.offsets.length + 1);
  });

  it("trap: --variant forces a named kick cell; different variants differ", () => {
    expect(listDrumVariants("trap")).toEqual(TRAP_KICK_CELLS.map((c) => c.name));
    expect(listDrumVariants("house")).toEqual([]);
    const a = generateDrumPatternDetailed("trap", FULL_KIT, ctx(), { variant: 0 });
    const b = generateDrumPatternDetailed("trap", FULL_KIT, ctx(), { variant: 4 });
    expect(a.meta.kickCell).toBe("hold");
    expect(b.meta.kickCell).toBe("sparse");
    const kicksIn = (notes: NoteSpec[]) =>
      notes.filter((n) => n.pitch === FULL_KIT.kick && n.start < 4).map((n) => n.start);
    expect(kicksIn(a.notes)).toEqual([0, 3.25]);
    expect(kicksIn(b.notes)).toEqual([0, 2.5]);
  });

  it("trap: turnaround bars always carry a hat event on the final beat", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const notes = generateDrumPattern("trap", FULL_KIT, ctx({ bars: 4, rng: makeRng(seed) }));
      // bar 3 (index) is a turnaround: final beat spans [15, 16)
      const lastBeatHats = notes.filter(
        (n) => n.pitch === FULL_KIT["hat-closed"] && n.start >= 15 && n.start < 16,
      );
      expect(lastBeatHats.length).toBeGreaterThanOrEqual(3); // roll, not a lone 8th
    }
  });

  it("no open hat pad -> no open-hat notes", () => {
    const kitNoOpenHat: DrumKit = { ...FULL_KIT };
    delete kitNoOpenHat["hat-open"];
    const notes = generateDrumPattern("house", kitNoOpenHat, ctx());
    expect(notes.some((n) => n.pitch === 46)).toBe(false);
  });
});

describe("drumFill", () => {
  const pattern = generateDrumPattern("house", FULL_KIT, ctx({ bars: 2 }));

  it("replaces the tail (second half of the last bar) and ramps velocity into the downbeat", () => {
    const filled = drumFill(pattern, FULL_KIT, ctx({ bars: 2 }));
    const fillStart = 4 + 2; // (bars-1)*beatsPerBar + beatsPerBar/2
    const before = filled.filter((n) => n.start < fillStart);
    const after = filled.filter((n) => n.start >= fillStart);

    // untouched region matches the original pattern's untouched region
    const originalBefore = pattern.filter((n) => n.start < fillStart);
    expect(before).toEqual(originalBefore);

    // the fill region is a snare roll with increasing velocity
    const snareHits = after
      .filter((n) => n.pitch === FULL_KIT.snare)
      .sort((a, b) => a.start - b.start);
    expect(snareHits.length).toBeGreaterThan(1);
    for (let i = 1; i < snareHits.length; i++) {
      expect(snareHits[i]!.velocity!).toBeGreaterThanOrEqual(snareHits[i - 1]!.velocity!);
    }
    expect(snareHits[snareHits.length - 1]!.velocity).toBeGreaterThan(snareHits[0]!.velocity!);
  });

  it("replaces the whole last bar at density >= 0.7", () => {
    const filled = drumFill(pattern, FULL_KIT, ctx({ bars: 2, density: 0.8 }));
    const lastBarStart = 4;
    const originalLastBar = pattern.filter((n) => n.start >= lastBarStart);
    const filledLastBar = filled.filter((n) => n.start >= lastBarStart);
    expect(filledLastBar).not.toEqual(originalLastBar);
    expect(filled.some((n) => n.start === 0)).toBe(true); // bar 1 untouched
  });

  it("falls back to clap, then tom, when snare is unavailable", () => {
    const kitNoSnare: DrumKit = { kick: 36, clap: 39 };
    const p = generateDrumPattern("house", kitNoSnare, ctx({ bars: 2 }));
    const filled = drumFill(p, kitNoSnare, ctx({ bars: 2 }));
    const tail = filled.filter((n) => n.start >= 6);
    expect(tail.some((n) => n.pitch === 39)).toBe(true);
  });

  it("returns the input unchanged when nothing is suitable for a fill", () => {
    const kitKickOnly: DrumKit = { kick: 36 };
    const p = generateDrumPattern("house", kitKickOnly, ctx({ bars: 2 }));
    const filled = drumFill(p, kitKickOnly, ctx({ bars: 2 }));
    expect(filled).toEqual(p);
  });

  it("does not mutate the input", () => {
    const before = JSON.parse(JSON.stringify(pattern));
    drumFill(pattern, FULL_KIT, ctx({ bars: 2 }));
    expect(pattern).toEqual(before);
  });
});

describe("humanizeDrums", () => {
  it("keeps kick timing tighter than hat timing across a seeded run", () => {
    const notes: NoteSpec[] = [];
    for (let b = 0; b < 4; b++) {
      notes.push({ pitch: FULL_KIT.kick!, start: b, duration: 0.25, velocity: 100 });
      notes.push({ pitch: FULL_KIT["hat-closed"]!, start: b + 0.5, duration: 0.25, velocity: 90 });
    }
    const c = ctx({ bars: 1, rng: makeRng(3) });
    const humanized = humanizeDrums(notes, FULL_KIT, c, { timing: 0.1, velocity: 10 });

    const maxDelta = (role: "kick" | "hat-closed") => {
      const originals = notes.filter((n) => n.pitch === FULL_KIT[role]);
      const results = humanized.filter((n) => n.pitch === FULL_KIT[role]);
      let max = 0;
      for (const o of originals) {
        const match = results.reduce((closest, n) =>
          Math.abs(n.start - o.start) < Math.abs(closest.start - o.start) ? n : closest,
        results[0]!);
        max = Math.max(max, Math.abs(match.start - o.start));
      }
      return max;
    };

    expect(maxDelta("kick")).toBeLessThan(maxDelta("hat-closed"));
  });

  it("clamps start to [0, clip end] and velocity to [1, 127]", () => {
    const notes: NoteSpec[] = [
      { pitch: FULL_KIT.kick!, start: 0, duration: 0.25, velocity: 125 },
      { pitch: FULL_KIT["hat-closed"]!, start: 3.98, duration: 0.25, velocity: 3 },
    ];
    const c = ctx({ bars: 1, beatsPerBar: 4, rng: makeRng(5) });
    const humanized = humanizeDrums(notes, FULL_KIT, c, { timing: 0.5, velocity: 60 });
    for (const n of humanized) {
      expect(n.start).toBeGreaterThanOrEqual(0);
      expect(n.start).toBeLessThan(4);
      expect(n.velocity!).toBeGreaterThanOrEqual(1);
      expect(n.velocity!).toBeLessThanOrEqual(127);
    }
  });

  it("is deterministic per seed", () => {
    const notes = generateDrumPattern("house", FULL_KIT, ctx({ rng: makeRng(2) }));
    const c = () => ctx({ bars: 2, rng: makeRng(11) });
    const a = humanizeDrums(notes, FULL_KIT, c());
    const b = humanizeDrums(notes, FULL_KIT, c());
    expect(a).toEqual(b);
  });
});

describe("varyDrums", () => {
  it("keeps downbeat kicks and never introduces new pitches", () => {
    const source = generateDrumPattern("house", FULL_KIT, ctx({ bars: 2, rng: makeRng(4) }));
    const kitPitches = new Set(Object.values(FULL_KIT));
    for (const amount of [0.2, 0.5, 0.9]) {
      const varied = varyDrums(source, FULL_KIT, ctx({ bars: 2, rng: makeRng(42) }), { amount });
      for (const n of varied) {
        expect(kitPitches.has(n.pitch)).toBe(true);
      }
      const kickBeats = varied.filter((n) => n.pitch === FULL_KIT.kick).map((n) => n.start);
      for (const beat of [0, 1, 2, 3, 4, 5, 6, 7]) {
        expect(kickBeats).toContain(beat);
      }
    }
  });

  it("preserves the input's role set", () => {
    const source = generateDrumPattern("trap", FULL_KIT, ctx({ bars: 2, rng: makeRng(6) }));
    const inputPitches = new Set(source.map((n) => n.pitch));
    const varied = varyDrums(source, FULL_KIT, ctx({ bars: 2, rng: makeRng(6) }), { amount: 0.9 });
    const outputPitches = new Set(varied.map((n) => n.pitch));
    for (const pitch of inputPitches) {
      expect(outputPitches.has(pitch)).toBe(true);
    }
  });

  it("does not mutate the input", () => {
    const source = generateDrumPattern("house", FULL_KIT, ctx({ bars: 2 }));
    const before = JSON.parse(JSON.stringify(source));
    varyDrums(source, FULL_KIT, ctx({ bars: 2 }));
    expect(source).toEqual(before);
  });

  it("is deterministic per seed", () => {
    const source = generateDrumPattern("techno", FULL_KIT, ctx({ bars: 2, rng: makeRng(9) }));
    const a = varyDrums(source, FULL_KIT, ctx({ bars: 2, rng: makeRng(20) }), { amount: 0.6 });
    const b = varyDrums(source, FULL_KIT, ctx({ bars: 2, rng: makeRng(20) }), { amount: 0.6 });
    expect(a).toEqual(b);
  });
});
