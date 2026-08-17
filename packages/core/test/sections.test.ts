import { describe, expect, it } from "vitest";
import {
  tileNotes,
  validateSectionsPlan,
  type SectionsPlan,
} from "../src/sections/types.js";
import { renderSections, type SourceClip } from "../src/sections/render.js";
import { listForms, planFromForm, planFromReferenceSections } from "../src/sections/presets.js";
import { BridgeError, type NoteSpec } from "../src/bridge/types.js";

const motif: NoteSpec[] = [
  { pitch: 60, start: 0, duration: 1, velocity: 100 },
  { pitch: 63, start: 2, duration: 1, velocity: 90 },
];

const sources = new Map<string, SourceClip>([
  ["track:0/slot:0", { notes: motif, lengthBeats: 4 }],
  ["track:1/slot:0", { notes: [{ pitch: 36, start: 0, duration: 0.5, velocity: 110 }], lengthBeats: 4 }],
]);

const plan: SectionsPlan = {
  name: "test",
  trackMap: { lead: "track:0", drums: "track:1" },
  sections: [
    { name: "intro", bars: 4, tracks: { lead: "off", drums: { source: "track:1/slot:0", ops: "humanize:timing=0.05,velocity=12" } } },
    { name: "drop", bars: 8, tracks: { lead: { source: "track:0/slot:0" }, drums: { source: "track:1/slot:0" } } },
  ],
};

describe("tileNotes", () => {
  it("repeats a phrase across a span and clips the tail", () => {
    const tiled = tileNotes(motif, 4, 10);
    expect(tiled).toHaveLength(5); // 2 + 2 + first note of third repeat only
    expect(tiled.map((n) => n.start)).toEqual([0, 2, 4, 6, 8]);
  });
});

describe("validateSectionsPlan", () => {
  it("accepts a valid plan and normalises off-forms", () => {
    const parsed = validateSectionsPlan({
      name: "x",
      trackMap: { a: "track:0" },
      sections: [{ name: "s", bars: 2, tracks: { a: null } }],
    });
    expect(parsed.sections[0]!.tracks.a).toBe("off");
  });

  it("rejects structural mistakes with clear messages", () => {
    expect(() => validateSectionsPlan({})).toThrowError(/trackMap/);
    expect(() =>
      validateSectionsPlan({ trackMap: { a: "track:0" }, sections: [] }),
    ).toThrowError(/non-empty/);
    expect(() =>
      validateSectionsPlan({
        trackMap: { a: "track:0" },
        sections: [{ name: "s", bars: 2, tracks: { GHOST: "off" } }],
      }),
    ).toThrowError(/unknown track "GHOST"/);
    expect(() =>
      validateSectionsPlan({
        trackMap: { a: "track:0" },
        sections: [{ name: "s", bars: 1.5, tracks: {} }],
      }),
    ).toThrowError(/positive integer/);
  });
});

describe("renderSections", () => {
  it("places one clip per active layer at cumulative positions", () => {
    const { clips, totalBars } = renderSections(plan, sources, { seed: 5 });
    expect(totalBars).toBe(12);
    // intro: drums only; drop: both
    expect(clips).toHaveLength(3);
    const [introDrums, dropDrums, dropLead] = [
      clips.find((c) => c.name === "intro-drums")!,
      clips.find((c) => c.name === "drop-drums")!,
      clips.find((c) => c.name === "drop-lead")!,
    ];
    expect(introDrums).toMatchObject({ trackPath: "track:1", startBeat: 0, lengthBeats: 16 });
    expect(dropDrums).toMatchObject({ trackPath: "track:1", startBeat: 16, lengthBeats: 32 });
    expect(dropLead).toMatchObject({ trackPath: "track:0", startBeat: 16, lengthBeats: 32 });
    // verbatim layer is tiled source: 2 notes per 4 beats over 32 beats
    expect(dropLead.notes).toHaveLength(16);
  });

  it("is deterministic per seed and honours atBar", () => {
    const a = renderSections(plan, sources, { seed: 9, atBar: 33 });
    const b = renderSections(plan, sources, { seed: 9, atBar: 33 });
    expect(a).toEqual(b);
    expect(a.clips[0]!.startBeat).toBe(128);
    const c = renderSections(plan, sources, { seed: 10, atBar: 33 });
    expect(c.clips.find((x) => x.name === "intro-drums")!.notes).not.toEqual(
      a.clips.find((x) => x.name === "intro-drums")!.notes,
    );
  });

  it("fails clearly on unfetched sources", () => {
    expect(() => renderSections(plan, new Map(), {})).toThrowError(BridgeError);
  });
});

describe("presets", () => {
  it("builds a house plan for supplied roles; missing roles go off", () => {
    expect(listForms()).toContain("house");
    const built = planFromForm("house", {
      drums: { trackPath: "track:1", source: "track:1/slot:0" },
      bass: { trackPath: "track:2", source: "track:2/slot:0" },
    });
    expect(built.sections.map((s) => s.name)).toEqual([
      "intro", "build1", "drop1", "breakdown", "build2", "drop2", "outro",
    ]);
    expect(built.sections.reduce((sum, s) => sum + s.bars, 0)).toBe(128);
    const drop = built.sections.find((s) => s.name === "drop1")!;
    expect(drop.tracks.drums).toEqual({ source: "track:1/slot:0" });
    const breakdown = built.sections.find((s) => s.name === "breakdown")!;
    expect(breakdown.tracks.bass).toBe("off");
    // renders end-to-end
    const rendered = renderSections(
      validateSectionsPlan(built),
      new Map([
        ["track:1/slot:0", sources.get("track:1/slot:0")!],
        ["track:2/slot:0", sources.get("track:0/slot:0")!],
      ]),
      { seed: 1 },
    );
    expect(rendered.totalBars).toBe(128);
  });

  it("rejects unknown forms and empty roles", () => {
    expect(() => planFromForm("polka", { a: { trackPath: "t", source: "s" } })).toThrowError(/unknown form/);
    expect(() => planFromForm("house", {})).toThrowError(/at least one role/);
  });

  it("builds a plan from a corrected reference map with bars sourced from the reference, not a preset", () => {
    const built = planFromReferenceSections(
      [
        { name: "intro", start_bar: 1, end_bar: 12 },
        { name: "build up 1", start_bar: 13, end_bar: 16 },
        { name: "drop 1", start_bar: 17, end_bar: 32 },
      ],
      { drums: { trackPath: "track:1", source: "track:1/slot:0" } },
    );
    expect(built.sections.map((s) => s.name)).toEqual(["intro", "build up 1", "drop 1"]);
    expect(built.sections.map((s) => s.bars)).toEqual([12, 4, 16]);
    // every layer verbatim — no genre ops guessed for an arbitrary reference
    expect(built.sections.every((s) => s.tracks.drums && s.tracks.drums !== "off")).toBe(true);
    const drop = built.sections.find((s) => s.name === "drop 1")!;
    expect(drop.tracks.drums).toEqual({ source: "track:1/slot:0" });
    // renders end-to-end
    const rendered = renderSections(
      validateSectionsPlan(built),
      new Map([["track:1/slot:0", sources.get("track:1/slot:0")!]]),
      { seed: 1 },
    );
    expect(rendered.totalBars).toBe(32);
  });

  it("rejects empty sections and empty roles for reference-derived plans", () => {
    expect(() => planFromReferenceSections([], { a: { trackPath: "t", source: "s" } })).toThrowError(
      /no sections/,
    );
    expect(() =>
      planFromReferenceSections([{ name: "intro", start_bar: 1, end_bar: 4 }], {}),
    ).toThrowError(/at least one role/);
  });
});
