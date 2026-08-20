import { describe, expect, it } from "vitest";
import { parseEndlessSpec, validateEndlessSpec, type EndlessSpec } from "../src/endless/spec.js";

/**
 * M10 EndlessSpec parsing + structural validation (docs/design/endless-player.md
 * "Verification bar"). File-existence and WAV-duration checks live in
 * packages/cli/test/endless.test.ts (they need real files on disk) — this
 * file covers everything that's a pure function of the parsed spec:
 * typo-rejection, reachability (with the required negative control: a
 * stranded section is REJECTED, not silently unreachable), and empty pools.
 */

const MINIMAL_YAML = `
name: test-song
bpm: 140
sig: 4/4
layers:
  - {id: drums, gainDb: 0}
  - {id: bass, gainDb: 0}
sections:
  - id: intro
    bars: 8
    pools:
      drums: [audio/intro-drums-a.wav]
      bass: [audio/intro-bass-a.wav]
  - id: drop
    bars: 16
    pools:
      drums: [audio/drop-drums-a.wav, audio/drop-drums-b.wav]
      bass: [audio/drop-bass-a.wav]
transitions:
  intro: [{to: drop, weight: 1}]
  drop: [{to: drop, weight: 1}]
rules:
  noRepeatVariant: 2
  maxConsecutive: 2
  protectedLayers: [bass]
fluctuation:
  gainWalkDb: 1.5
`;

describe("parseEndlessSpec", () => {
  it("parses a well-formed spec with every field", () => {
    const spec = parseEndlessSpec(MINIMAL_YAML);
    expect(spec.name).toBe("test-song");
    expect(spec.bpm).toBe(140);
    expect(spec.sig).toBe("4/4");
    expect(spec.layers).toHaveLength(2);
    expect(spec.sections).toHaveLength(2);
    expect(spec.sections[0]?.pools.drums).toEqual(["audio/intro-drums-a.wav"]);
    expect(spec.rules.protectedLayers).toEqual(["bass"]);
    expect(spec.fluctuation.gainWalkDb).toBe(1.5);
  });

  it("applies documented defaults when optional fields are absent", () => {
    const spec = parseEndlessSpec(`
name: bare
bpm: 120
layers:
  - {id: drums, gainDb: 0}
sections:
  - id: a
    bars: 4
    pools: { drums: [audio/a.wav] }
`);
    expect(spec.seed).toBe(0);
    expect(spec.crossfadeMs).toBe(80);
    expect(spec.rules.noRepeatVariant).toBe(2);
    expect(spec.rules.maxConsecutive).toBe(2);
    expect(spec.rules.protectedLayers).toEqual([]);
    expect(spec.fluctuation.gainWalkDb).toBe(1.5);
    expect(spec.transitions).toEqual({});
  });

  it("rejects an unknown top-level field (typo)", () => {
    expect(() => parseEndlessSpec(MINIMAL_YAML.replace("crossfadeMs", "crossfadeMs") + "\nbmp: 1"))
      .toThrow(/unknown field "bmp"/);
  });

  it("rejects an unknown field inside a layer", () => {
    expect(() =>
      parseEndlessSpec(`
name: t
bpm: 120
layers:
  - {id: drums, gain_db: 0}
sections:
  - id: a
    bars: 4
    pools: { drums: [audio/a.wav] }
`),
    ).toThrow(/unknown field "gain_db"/);
  });

  it("rejects a pool referencing an undeclared layer id (typo)", () => {
    expect(() =>
      parseEndlessSpec(`
name: t
bpm: 120
layers:
  - {id: drums, gainDb: 0}
sections:
  - id: a
    bars: 4
    pools: { drum: [audio/a.wav] }
`),
    ).toThrow(/"drum" is not a declared layer id/);
  });

  it("rejects a transition edge targeting an undeclared section id (typo)", () => {
    expect(() =>
      parseEndlessSpec(`
name: t
bpm: 120
layers:
  - {id: drums, gainDb: 0}
sections:
  - id: intro
    bars: 4
    pools: { drums: [audio/a.wav] }
transitions:
  intro: [{to: dorp, weight: 1}]
`),
    ).toThrow(/"dorp".*not a declared section id/);
  });

  it("rejects sig other than 4/4", () => {
    expect(() => parseEndlessSpec(MINIMAL_YAML.replace("sig: 4/4", "sig: 3/4"))).toThrow(
      /"sig" must be "4\/4"/,
    );
  });

  it("rejects zero layers / zero sections", () => {
    expect(() => parseEndlessSpec(`name: t\nbpm: 120\nlayers: []\nsections: []`)).toThrow(
      /"layers" must be a non-empty array/,
    );
  });

  it("rejects a protectedLayers entry that isn't a declared layer id", () => {
    expect(() =>
      parseEndlessSpec(`
name: t
bpm: 120
layers:
  - {id: drums, gainDb: 0}
sections:
  - id: a
    bars: 4
    pools: { drums: [audio/a.wav] }
rules:
  protectedLayers: [bass]
`),
    ).toThrow(/"bass" is not a declared layer id/);
  });

  it("rejects a non-positive transition weight", () => {
    expect(() =>
      parseEndlessSpec(`
name: t
bpm: 120
layers:
  - {id: drums, gainDb: 0}
sections:
  - id: a
    bars: 4
    pools: { drums: [audio/a.wav] }
  - id: b
    bars: 4
    pools: { drums: [audio/b.wav] }
transitions:
  a: [{to: b, weight: 0}]
`),
    ).toThrow(/"weight" must be a positive number/);
  });
});

describe("validateEndlessSpec", () => {
  it("passes a well-formed spec with no problems", () => {
    const spec = parseEndlessSpec(MINIMAL_YAML);
    expect(validateEndlessSpec(spec)).toEqual([]);
  });

  it("NEGATIVE CONTROL: a section stranded by the transition graph is rejected, not silently unreachable", () => {
    const spec = parseEndlessSpec(`
name: t
bpm: 120
layers:
  - {id: drums, gainDb: 0}
sections:
  - id: intro
    bars: 4
    pools: { drums: [audio/intro.wav] }
  - id: drop
    bars: 4
    pools: { drums: [audio/drop.wav] }
  - id: island
    bars: 4
    pools: { drums: [audio/island.wav] }
transitions:
  intro: [{to: drop, weight: 1}]
  drop: [{to: intro, weight: 1}]
`);
    const problems = validateEndlessSpec(spec);
    expect(problems.some((p) => p.includes('"island"') && p.includes("unreachable"))).toBe(true);
  });

  it("flags an empty pool by section and layer name", () => {
    const spec = parseEndlessSpec(`
name: t
bpm: 120
layers:
  - {id: drums, gainDb: 0}
  - {id: pads, gainDb: -3}
sections:
  - id: intro
    bars: 4
    pools: { drums: [audio/intro.wav], pads: [] }
`);
    const problems = validateEndlessSpec(spec);
    expect(problems.some((p) => p.includes('section "intro"') && p.includes('layer "pads"') && p.includes("empty"))).toBe(
      true,
    );
  });

  it("reports multiple problems in one pass (not fail-fast)", () => {
    const spec: EndlessSpec = parseEndlessSpec(`
name: t
bpm: 120
layers:
  - {id: drums, gainDb: 0}
sections:
  - id: intro
    bars: 4
    pools: { drums: [] }
  - id: stranded
    bars: 4
    pools: { drums: [audio/stranded.wav] }
`);
    const problems = validateEndlessSpec(spec);
    expect(problems.length).toBeGreaterThanOrEqual(2);
    expect(problems.some((p) => p.includes("empty"))).toBe(true);
    expect(problems.some((p) => p.includes("unreachable"))).toBe(true);
  });
});
