import { describe, expect, it } from "vitest";
import { makeRng } from "../src/transforms/rng.js";
import type { ScaleContext } from "../src/transforms/types.js";
import type { NoteSpec } from "../src/bridge/types.js";
import {
  BASS_MUSIC_CR_SPEC,
  RESPONSE_RECIPE_NAMES,
  listPhraseStyles,
  listPhraseVariants,
  parsePhraseSpec,
  type PhraseSpec,
} from "../src/phrase/spec.js";
import { applyResponseRecipe, fitResponseToWindow } from "../src/phrase/recipes.js";
import { generatePhrase, generateResponses } from "../src/phrase/phrase.js";

// C minor (root 0). Response resolve degrees [0, 7] -> pitch classes {C, G}.
const C_MINOR: ScaleContext = { rootNote: 0, intervals: [0, 2, 3, 5, 7, 8, 10] };
// G minor (root 7) — used to sanity-check root-relative resolve degrees.
const G_MINOR: ScaleContext = { rootNote: 7, intervals: [0, 2, 3, 5, 7, 8, 10] };

function overlaps(a: NoteSpec[], b: NoteSpec[]): boolean {
  for (const x of a) {
    for (const y of b) {
      if (x.start < y.start + y.duration - 1e-9 && y.start < x.start + x.duration - 1e-9)
        return true;
    }
  }
  return false;
}

function endOf(notes: NoteSpec[]): number {
  return notes.reduce((max, n) => Math.max(max, n.start + n.duration), 0);
}

describe("parsePhraseSpec", () => {
  it("round-trips the built-in bass-music-cr document", () => {
    const yaml = `
name: bass-music-cr
family: call-response
phraseBars: 8
cellBars: 2
callRegister: [67, 81]
responseRegister: [24, 43]
callCells:
  - {name: ask-2, beats: [0, 1.0], lengths: [0.5, 1.0], weight: 3}
  - {name: ask-3, beats: [0, 0.75, 1.5], lengths: [0.5, 0.25, 1.0], weight: 2}
  - {name: one-stab, beats: [0], lengths: [0.5], weight: 1}
restMinBeats: 1.0
responseDelayBeats: [2.0, 4.0]
responseRecipes: [echo-low, truncate-stab, invert-answer, displaced-echo, sparse-answer]
resolveDegrees: [0, 7]
evolution:
  - {bars: [1, 4], action: state}
  - {bars: [5, 8], action: vary-call}
turnaround: drop-response
`;
    expect(parsePhraseSpec(yaml)).toEqual(BASS_MUSIC_CR_SPEC);
  });

  it("fills in the documented defaults when optional fields are omitted", () => {
    const spec = parsePhraseSpec(`
name: minimal
family: call-response
callCells:
  - {name: only, beats: [0], lengths: [0.5]}
`);
    expect(spec.name).toBe("minimal");
    expect(spec.phraseBars).toBe(8);
    expect(spec.cellBars).toBe(2);
    expect(spec.callRegister).toEqual([67, 81]);
    expect(spec.responseRegister).toEqual([24, 43]);
    expect(spec.restMinBeats).toBe(1.0);
    expect(spec.responseDelayBeats).toEqual([2.0, 4.0]);
    expect(spec.responseRecipes).toEqual(RESPONSE_RECIPE_NAMES);
    expect(spec.resolveDegrees).toEqual([0, 7]);
    expect(spec.turnaround).toBe("drop-response");
    expect(spec.callCells).toEqual([{ name: "only", beats: [0], lengths: [0.5], weight: 1 }]);
  });

  it("rejects an unknown top-level key (typo protection)", () => {
    expect(() =>
      parsePhraseSpec(`
name: x
family: call-response
calCells:
  - {name: a, beats: [0], lengths: [0.5]}
`),
    ).toThrowError(/unknown field "calCells"/);
  });

  it("rejects an unknown family", () => {
    expect(() =>
      parsePhraseSpec(`
name: x
family: bass-music
callCells:
  - {name: a, beats: [0], lengths: [0.5]}
`),
    ).toThrowError(/"family" must be "call-response"/);
  });

  it("rejects a callCell missing a 0 beat (typo protection)", () => {
    expect(() =>
      parsePhraseSpec(`
name: x
family: call-response
callCells:
  - {name: a, beats: [1.0], lengths: [0.5]}
`),
    ).toThrowError(/must include 0/);
  });

  it("rejects a callCell with mismatched beats/lengths arrays", () => {
    expect(() =>
      parsePhraseSpec(`
name: x
family: call-response
callCells:
  - {name: a, beats: [0, 1.0], lengths: [0.5]}
`),
    ).toThrowError(/same length/);
  });

  it("rejects an unknown field inside a callCell (typo protection)", () => {
    expect(() =>
      parsePhraseSpec(`
name: x
family: call-response
callCells:
  - {name: a, beats: [0], lenghts: [0.5]}
`),
    ).toThrowError(/unknown field "lenghts"/);
  });

  it("rejects an unknown response recipe name", () => {
    expect(() =>
      parsePhraseSpec(`
name: x
family: call-response
callCells:
  - {name: a, beats: [0], lengths: [0.5]}
responseRecipes: [echo-low, echo-loud]
`),
    ).toThrowError(/responseRecipes\[1\]/);
  });

  it("rejects an unknown turnaround value", () => {
    expect(() =>
      parsePhraseSpec(`
name: x
family: call-response
callCells:
  - {name: a, beats: [0], lengths: [0.5]}
turnaround: reset-everything
`),
    ).toThrowError(/"turnaround" must be one of/);
  });

  it("rejects an unknown evolution action", () => {
    expect(() =>
      parsePhraseSpec(`
name: x
family: call-response
callCells:
  - {name: a, beats: [0], lengths: [0.5]}
evolution:
  - {bars: [1, 4], action: vary-response}
`),
    ).toThrowError(/unknown action/);
  });

  it("rejects cellBars that doesn't divide phraseBars", () => {
    expect(() =>
      parsePhraseSpec(`
name: x
family: call-response
phraseBars: 8
cellBars: 3
callCells:
  - {name: a, beats: [0], lengths: [0.5]}
`),
    ).toThrowError(/whole multiple/);
  });

  it("rejects an out-of-order callRegister", () => {
    expect(() =>
      parsePhraseSpec(`
name: x
family: call-response
callRegister: [80, 60]
callCells:
  - {name: a, beats: [0], lengths: [0.5]}
`),
    ).toThrowError(/callRegister/);
  });

  it("rejects an empty callCells array", () => {
    expect(() =>
      parsePhraseSpec(`
name: x
family: call-response
callCells: []
`),
    ).toThrowError(/non-empty array/);
  });

  it("lists built-in styles and call-cell variants", () => {
    expect(listPhraseStyles()).toEqual(["bass-music-cr"]);
    expect(listPhraseVariants(BASS_MUSIC_CR_SPEC)).toEqual(["ask-2", "ask-3", "one-stab"]);
  });
});

describe("response recipes — determinism + property tests", () => {
  const callNotes: NoteSpec[] = [
    { pitch: 72, start: 0, duration: 0.5, velocity: 110 },
    { pitch: 74, start: 0.75, duration: 0.25, velocity: 100 },
    { pitch: 77, start: 1.5, duration: 1.0, velocity: 100 },
  ];

  for (const recipe of RESPONSE_RECIPE_NAMES) {
    it(`${recipe}: deterministic — same seed produces byte-identical notes`, () => {
      const a = applyResponseRecipe(recipe, callNotes, C_MINOR, BASS_MUSIC_CR_SPEC, makeRng(11));
      const b = applyResponseRecipe(recipe, callNotes, C_MINOR, BASS_MUSIC_CR_SPEC, makeRng(11));
      expect(a).toEqual(b);
    });

    it(`${recipe}: different seed can differ`, () => {
      const a = applyResponseRecipe(recipe, callNotes, C_MINOR, BASS_MUSIC_CR_SPEC, makeRng(11));
      const c = applyResponseRecipe(recipe, callNotes, C_MINOR, BASS_MUSIC_CR_SPEC, makeRng(12));
      // At least the entry delay is drawn from the seed, so timing should differ
      // for at least one of several seeds. Check across a small spread instead
      // of asserting a single pair (a legitimate coincidence is possible).
      const others = [12, 13, 14, 15].map((s) =>
        applyResponseRecipe(recipe, callNotes, C_MINOR, BASS_MUSIC_CR_SPEC, makeRng(s)),
      );
      expect(others.some((o) => JSON.stringify(o) !== JSON.stringify(a))).toBe(true);
      void c;
    });

    it(`${recipe}: response never overlaps the call region`, () => {
      for (const seed of [1, 2, 3, 4, 5]) {
        const result = applyResponseRecipe(
          recipe,
          callNotes,
          C_MINOR,
          BASS_MUSIC_CR_SPEC,
          makeRng(seed),
        );
        expect(overlaps(callNotes, result.notes)).toBe(false);
      }
    });

    it(`${recipe}: rest budget honored — trailing rest before lengthBeats >= restMinBeats`, () => {
      for (const seed of [1, 2, 3, 4, 5]) {
        const result = applyResponseRecipe(
          recipe,
          callNotes,
          C_MINOR,
          BASS_MUSIC_CR_SPEC,
          makeRng(seed),
        );
        if (result.notes.length === 0) continue;
        const tail = result.lengthBeats - endOf(result.notes);
        expect(tail).toBeGreaterThanOrEqual(BASS_MUSIC_CR_SPEC.restMinBeats - 1e-9);
      }
    });

    it(`${recipe}: ends on an allowed resolve-degree pitch (root-relative)`, () => {
      for (const scale of [C_MINOR, G_MINOR]) {
        for (const seed of [1, 2, 3, 4, 5]) {
          const result = applyResponseRecipe(
            recipe,
            callNotes,
            scale,
            BASS_MUSIC_CR_SPEC,
            makeRng(seed),
          );
          if (result.notes.length === 0) continue;
          const sorted = [...result.notes].toSorted((a, b) => a.start - b.start);
          const last = sorted[sorted.length - 1]!;
          const chroma = (((last.pitch - scale.rootNote) % 12) + 12) % 12;
          expect(BASS_MUSIC_CR_SPEC.resolveDegrees).toContain(chroma);
        }
      }
    });

    it(`${recipe}: response pitches stay within the response register`, () => {
      const result = applyResponseRecipe(
        recipe,
        callNotes,
        C_MINOR,
        BASS_MUSIC_CR_SPEC,
        makeRng(3),
      );
      for (const n of result.notes) {
        expect(n.pitch).toBeGreaterThanOrEqual(BASS_MUSIC_CR_SPEC.responseRegister[0]);
        expect(n.pitch).toBeLessThanOrEqual(BASS_MUSIC_CR_SPEC.responseRegister[1]);
      }
    });
  }

  it("negative control: a call that fills its own cell still gets a legal, non-overlapping response with a WARNING", () => {
    const fullCall: NoteSpec[] = [{ pitch: 72, start: 0, duration: 4, velocity: 100 }];
    const result = applyResponseRecipe(
      "echo-low",
      fullCall,
      C_MINOR,
      BASS_MUSIC_CR_SPEC,
      makeRng(1),
    );
    expect(result.warnings.some((w) => /leaves only .* rest at its own bar tail/.test(w))).toBe(
      true,
    );
    expect(overlaps(fullCall, result.notes)).toBe(false);
    expect(result.notes.length).toBeGreaterThan(0);
    const tail = result.lengthBeats - endOf(result.notes);
    expect(tail).toBeGreaterThanOrEqual(BASS_MUSIC_CR_SPEC.restMinBeats - 1e-9);
  });

  it("a well-rested call produces no rest-budget warning", () => {
    const shortCall: NoteSpec[] = [{ pitch: 72, start: 0, duration: 0.5, velocity: 100 }];
    const result = applyResponseRecipe(
      "echo-low",
      shortCall,
      C_MINOR,
      BASS_MUSIC_CR_SPEC,
      makeRng(1),
    );
    expect(result.warnings).toEqual([]);
  });

  it("gracefully handles an empty call (no notes) without throwing", () => {
    for (const recipe of RESPONSE_RECIPE_NAMES) {
      expect(() =>
        applyResponseRecipe(recipe, [], C_MINOR, BASS_MUSIC_CR_SPEC, makeRng(1)),
      ).not.toThrow();
      const result = applyResponseRecipe(recipe, [], C_MINOR, BASS_MUSIC_CR_SPEC, makeRng(1));
      expect(result.notes).toEqual([]);
    }
  });

  it("fitResponseToWindow clamps a natural result into a smaller fixed window and still resolves", () => {
    const result = applyResponseRecipe(
      "echo-low",
      callNotes,
      C_MINOR,
      BASS_MUSIC_CR_SPEC,
      makeRng(5),
    );
    const fitted = fitResponseToWindow(result, 4, C_MINOR, BASS_MUSIC_CR_SPEC);
    expect(fitted.lengthBeats).toBe(4);
    for (const n of fitted.notes) expect(n.start + n.duration).toBeLessThanOrEqual(4 + 1e-9);
    expect(fitted.notes.length).toBeGreaterThan(0);
    const last = [...fitted.notes].toSorted((a, b) => a.start - b.start).pop()!;
    const chroma = (((last.pitch - C_MINOR.rootNote) % 12) + 12) % 12;
    expect(BASS_MUSIC_CR_SPEC.resolveDegrees).toContain(chroma);
  });

  it("recipe registry rejects an unknown recipe name", () => {
    expect(() =>
      // @ts-expect-error deliberately invalid recipe name
      applyResponseRecipe("echo-loud", callNotes, C_MINOR, BASS_MUSIC_CR_SPEC, makeRng(1)),
    ).toThrowError(/unknown response recipe/);
  });

  it("recipe registry rejects a name inherited from Object.prototype", () => {
    expect(() =>
      // @ts-expect-error deliberately invalid recipe name
      applyResponseRecipe("constructor", callNotes, C_MINOR, BASS_MUSIC_CR_SPEC, makeRng(1)),
    ).toThrowError(/unknown response recipe/);
  });
});

describe("generateResponses (drop respond)", () => {
  const callNotes: NoteSpec[] = [
    { pitch: 72, start: 0, duration: 0.5, velocity: 110 },
    { pitch: 74, start: 1.0, duration: 1.0, velocity: 100 },
  ];

  it("default one-per-recipe cycling: recipes assigned round-robin, seeds derived per candidate", () => {
    const candidates = generateResponses(callNotes, C_MINOR, BASS_MUSIC_CR_SPEC, {
      recipes: RESPONSE_RECIPE_NAMES as unknown as (typeof RESPONSE_RECIPE_NAMES)[number][],
      count: RESPONSE_RECIPE_NAMES.length,
      seed: 1,
    });
    expect(candidates.map((c) => c.recipe)).toEqual(RESPONSE_RECIPE_NAMES);
    // seeds are distinct
    expect(new Set(candidates.map((c) => c.seed)).size).toBe(candidates.length);
  });

  it("is deterministic: same options -> byte-identical candidates", () => {
    const a = generateResponses(callNotes, C_MINOR, BASS_MUSIC_CR_SPEC, {
      recipes: ["echo-low"],
      count: 3,
      seed: 9,
    });
    const b = generateResponses(callNotes, C_MINOR, BASS_MUSIC_CR_SPEC, {
      recipes: ["echo-low"],
      count: 3,
      seed: 9,
    });
    expect(a).toEqual(b);
  });

  it("single pinned recipe cycles seeds only", () => {
    const candidates = generateResponses(callNotes, C_MINOR, BASS_MUSIC_CR_SPEC, {
      recipes: ["truncate-stab"],
      count: 3,
      seed: 4,
    });
    expect(candidates.every((c) => c.recipe === "truncate-stab")).toBe(true);
    expect(new Set(candidates.map((c) => JSON.stringify(c.notes))).size).toBeGreaterThan(1);
  });
});

describe("generatePhrase (drop phrase) — frozen regression", () => {
  it("bars=8, seed=42, C minor: frozen note output for the built-in spec", () => {
    const phrase = generatePhrase(BASS_MUSIC_CR_SPEC, C_MINOR, { bars: 8, seed: 42 });
    expect(phrase.meta).toEqual({ callCell: "ask-3", recipe: "displaced-echo", seed: "42" });
    expect(phrase.lengthBeats).toBe(32);
    expect(phrase.warnings).toEqual([]);
    expect(phrase.callNotes).toEqual([
      { pitch: 74, start: 0, duration: 0.5, velocity: 100 },
      { pitch: 74, start: 0.75, duration: 0.25, velocity: 100 },
      { pitch: 77, start: 1.5, duration: 1, velocity: 100 },
      { pitch: 74, start: 8, duration: 0.5, velocity: 100 },
      { pitch: 74, start: 8.75, duration: 0.25, velocity: 100 },
      { pitch: 77, start: 9.5, duration: 1, velocity: 100 },
      { pitch: 74, start: 16, duration: 0.5, velocity: 100 },
      { pitch: 74, start: 16.75, duration: 0.25, velocity: 100 },
      { pitch: 72, start: 17.5, duration: 1, velocity: 100 },
      { pitch: 74, start: 24, duration: 0.5, velocity: 100 },
      { pitch: 75, start: 24.75, duration: 0.25, velocity: 100 },
      { pitch: 79, start: 25.5, duration: 1, velocity: 100 },
    ]);
    expect(phrase.responseNotes).toEqual([
      { pitch: 38, start: 5, duration: 0.5, velocity: 100 },
      { pitch: 36, start: 6.25, duration: 0.25, velocity: 100 },
      { pitch: 38, start: 13, duration: 0.5, velocity: 100 },
      { pitch: 36, start: 14.25, duration: 0.25, velocity: 100 },
      { pitch: 38, start: 21, duration: 0.5, velocity: 100 },
      { pitch: 36, start: 22.25, duration: 0.25, velocity: 100 },
    ]);
  });

  it("bars=16, seed=99, variant=one-stab: frozen note counts + turnaround silence", () => {
    const phrase = generatePhrase(BASS_MUSIC_CR_SPEC, C_MINOR, { bars: 16, seed: 99, variant: 2 });
    expect(phrase.meta.callCell).toBe("one-stab");
    expect(phrase.lengthBeats).toBe(64);
    expect(phrase.callNotes.length).toBe(8); // one onset per bar, 8 call bars in 16
    // turnaround (drop-response, default) removes response in the last cell of
    // each 8-bar unit: cells end at bar 8 and bar 16 (beats 32 and 64).
    const respNear = (lo: number, hi: number) =>
      phrase.responseNotes.filter((n) => n.start >= lo && n.start < hi);
    expect(respNear(24, 32).length).toBe(0);
    expect(respNear(56, 64).length).toBe(0);
    expect(respNear(0, 8).length).toBeGreaterThan(0);
  });
});

describe("generatePhrase — property tests", () => {
  const seeds = [1, 2, 3, 4, 5, 42, 99, 1000];

  it("call and response never overlap across the whole phrase, for many seeds", () => {
    for (const seed of seeds) {
      const phrase = generatePhrase(BASS_MUSIC_CR_SPEC, C_MINOR, { bars: 8, seed });
      expect(overlaps(phrase.callNotes, phrase.responseNotes)).toBe(false);
    }
  });

  it("response, where present, ends on an allowed resolve-degree pitch", () => {
    for (const seed of seeds) {
      const phrase = generatePhrase(BASS_MUSIC_CR_SPEC, C_MINOR, { bars: 8, seed });
      const cellBeats = BASS_MUSIC_CR_SPEC.cellBars * 4;
      for (let c = 0; c < 4; c++) {
        const inCell = phrase.responseNotes.filter(
          (n) => n.start >= c * cellBeats && n.start < (c + 1) * cellBeats,
        );
        if (inCell.length === 0) continue;
        const last = [...inCell].toSorted((a, b) => a.start - b.start).pop()!;
        const chroma = (((last.pitch - C_MINOR.rootNote) % 12) + 12) % 12;
        expect(BASS_MUSIC_CR_SPEC.resolveDegrees).toContain(chroma);
      }
    }
  });

  it("two-target form: call and response share the same lengthBeats (equal-length paired clips)", () => {
    for (const bars of [8, 16] as const) {
      const phrase = generatePhrase(BASS_MUSIC_CR_SPEC, C_MINOR, { bars, seed: 7 });
      expect(phrase.lengthBeats).toBe(bars * 4);
    }
  });

  it('evolution touches only the claimed side: "state" cells repeat the call verbatim; "vary-call" cells change only the call, never the response', () => {
    const phrase = generatePhrase(BASS_MUSIC_CR_SPEC, C_MINOR, { bars: 8, seed: 5 });
    const cellBeats = BASS_MUSIC_CR_SPEC.cellBars * 4; // 8
    const cellOf = (notes: NoteSpec[], c: number) =>
      notes
        .filter((n) => n.start >= c * cellBeats && n.start < (c + 1) * cellBeats)
        .map((n) => ({ ...n, start: n.start - c * cellBeats }));

    // cells 0,1 are "state" (bars 1, 3); cells 2,3 are "vary-call" (bars 5, 7)
    const call0 = cellOf(phrase.callNotes, 0);
    const call1 = cellOf(phrase.callNotes, 1);
    const call2 = cellOf(phrase.callNotes, 2);
    const call3 = cellOf(phrase.callNotes, 3);
    const resp0 = cellOf(phrase.responseNotes, 0);
    const resp1 = cellOf(phrase.responseNotes, 1);
    const resp2 = cellOf(phrase.responseNotes, 2);
    const resp3 = cellOf(phrase.responseNotes, 3);

    // "state": call repeats verbatim between the two state cells
    expect(call0).toEqual(call1);
    // response is the same anchored response in every cell (state or vary-call;
    // cell 3 is the turnaround cell for this spec so is excluded from this
    // claim; the turnaround tests cover it)
    expect(resp0).toEqual(resp1);
    expect(resp1).toEqual(resp2);
    void resp3;
    // "vary-call": call rhythm (onset times) is identical to the base cell,
    // only pitches may differ, and at least one vary-call bar
    // differs in pitch from the base call (it's not a no-op)
    expect(call2.map((n) => n.start)).toEqual(call0.map((n) => n.start));
    expect(call3.map((n) => n.start)).toEqual(call0.map((n) => n.start));
    expect(
      [call2, call3].some(
        (c) => JSON.stringify(c.map((n) => n.pitch)) !== JSON.stringify(call0.map((n) => n.pitch)),
      ),
    ).toBe(true);
  });

  it("throws a clear error when --bars is not a whole multiple of cellBars", () => {
    const oddSpec: PhraseSpec = { ...BASS_MUSIC_CR_SPEC, cellBars: 3 };
    expect(() => generatePhrase(oddSpec, C_MINOR, { bars: 8, seed: 1 })).toThrowError(
      /whole multiple/,
    );
  });

  it("--variant forces a named call cell; different variants differ", () => {
    const a = generatePhrase(BASS_MUSIC_CR_SPEC, C_MINOR, { bars: 8, seed: 1, variant: 0 });
    const b = generatePhrase(BASS_MUSIC_CR_SPEC, C_MINOR, { bars: 8, seed: 1, variant: 2 });
    expect(a.meta.callCell).toBe("ask-2");
    expect(b.meta.callCell).toBe("one-stab");
  });

  it("is deterministic: same seed -> byte-identical phrase", () => {
    const a = generatePhrase(BASS_MUSIC_CR_SPEC, C_MINOR, { bars: 8, seed: 17 });
    const b = generatePhrase(BASS_MUSIC_CR_SPEC, C_MINOR, { bars: 8, seed: 17 });
    expect(a).toEqual(b);
  });
});
