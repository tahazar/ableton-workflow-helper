import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  KnowledgeStore,
  extractFencedBlock,
  parseKnowledgeEntry,
  serializeKnowledgeEntry,
  type KnowledgeEntry,
} from "../src/index.js";

const entry: KnowledgeEntry = {
  slug: "garage-hat-shuffle",
  topic: "rhythm/garage",
  tier: "sourced",
  tags: ["garage", "2step", "swing"],
  sources: ["own analysis of <track>", "https://example.com/article"],
  related: ["library/clips/hats/rolling-garage-hats-1"],
  title: "Garage hat shuffle",
  body: [
    "## Executable",
    "- pipeline: `swing:grid=0.25,amount=0.7 velocity-shape:mode=accent`",
    "```awh-notation",
    "1|1 F#1 1/4 v90",
    "```",
    "",
    "## The rule",
    "16th swing 60-70%, accents on 1 and 2.5.",
  ].join("\n"),
};

describe("knowledge entry format", () => {
  it("round-trips and extracts the Executable section", () => {
    const md = serializeKnowledgeEntry(entry);
    const back = parseKnowledgeEntry(md);
    expect(back.slug).toBe(entry.slug);
    expect(back.topic).toBe("rhythm/garage");
    expect(back.executable).toContain("pipeline:");
    expect(back.executable).not.toContain("The rule");
    expect(extractFencedBlock(back.body, "awh-notation")).toBe("1|1 F#1 1/4 v90");
  });

  it("enforces tier rules and structure", () => {
    expect(() =>
      serializeKnowledgeEntry({ ...entry, tier: "sourced", sources: [] }),
    ).toThrowError(/citation/);
    expect(() => serializeKnowledgeEntry({ ...entry, topic: "Bad Topic" })).toThrowError(/topic/);
    expect(() => parseKnowledgeEntry("no frontmatter")).toThrowError(/frontmatter/);
  });
});

describe("KnowledgeStore", () => {
  let root: string;
  let measurements: string;
  let store: KnowledgeStore;
  beforeEach(async () => {
    const base = await mkdtemp(join(tmpdir(), "awh-kb-"));
    root = join(base, "knowledge");
    measurements = join(base, "measurements");
    store = new KnowledgeStore(root, measurements);
  });
  afterEach(async () => {
    await rm(join(root, ".."), { recursive: true, force: true });
  });

  it("saves, discovers open-ended topics, filters, loads", async () => {
    await store.saveEntry(entry);
    await store.saveEntry({
      ...entry,
      slug: "trap-hat-rolls",
      topic: "rhythm/trap",
      tier: "draft",
      sources: [],
    });
    await store.saveEntry({
      ...entry,
      slug: "my-mixdown-order",
      topic: "workflow", // a brand-new domain: just a directory
      tier: "verified",
      sources: [],
    });

    expect(await store.listTopics()).toEqual(["rhythm/garage", "rhythm/trap", "workflow"]);
    expect((await store.listEntries({ topic: "rhythm" })).length).toBe(2);
    expect((await store.listEntries({ tier: "verified" }))[0]!.slug).toBe("my-mixdown-order");
    expect((await store.loadEntry("garage-hat-shuffle")).relPath).toBe(
      join("rhythm", "garage", "garage-hat-shuffle.md"),
    );
  });

  it("rejects topic/directory mismatches and duplicate slugs across topics", async () => {
    await store.saveEntry(entry);
    await expect(store.saveEntry({ ...entry, topic: "workflow" })).rejects.toThrowError(/already used/);
    // hand-planted mismatch
    await mkdir(join(root, "mixing"), { recursive: true });
    await writeFile(
      join(root, "mixing", "rogue.md"),
      serializeKnowledgeEntry({ ...entry, slug: "rogue", topic: "rhythm/garage" }),
    );
    await expect(store.listEntries()).rejects.toThrowError(/does not match directory/);
  });

  it("indexes entries by topic plus measurement records", async () => {
    await store.saveEntry(entry);
    await mkdir(measurements, { recursive: true });
    await writeFile(
      join(measurements, "my-ref.json"),
      JSON.stringify({
        saved: "2026-08-17",
        file: "/x/my-ref.wav",
        measurements: {
          bpm: 98,
          loudness: { lufs_integrated: -9.2 },
          spectrum: { tilt_db_per_oct: -5.3 },
        },
        findings: [{}, {}],
      }),
    );
    const index = await store.buildIndex();
    expect(index).toContain("## rhythm/garage");
    expect(index).toContain("[garage-hat-shuffle](rhythm/garage/garage-hat-shuffle.md)");
    expect(index).toContain("## measurements");
    expect(index).toContain("| [my-ref](../library/measurements/my-ref.json) | 2026-08-17 | -9.2 | -5.3 | 98 | 2 |");
    const onDisk = await readFile(join(root, "INDEX.md"), "utf8");
    expect(onDisk).toBe(index);
    // INDEX.md itself is not an entry
    expect((await store.listEntries()).map((e) => e.slug)).toEqual(["garage-hat-shuffle"]);
  });

  it("indexes drum-stats records (awh drums mine --save) alongside mix reports without crashing", async () => {
    // Regression: library/measurements/ holds two record shapes — a
    // drumstats record (`kind: "drumstats"`, no `measurements` field) sitting
    // next to an ordinary mix-report record must not throw reading either.
    await mkdir(measurements, { recursive: true });
    await writeFile(
      join(measurements, "my-ref.json"),
      JSON.stringify({
        saved: "2026-08-17",
        file: "/x/my-ref.wav",
        measurements: {
          bpm: 98,
          loudness: { lufs_integrated: -9.2 },
          spectrum: { tilt_db_per_oct: -5.3 },
        },
        findings: [{}, {}],
      }),
    );
    await writeFile(
      join(measurements, "waivops-tr9-pilot.json"),
      JSON.stringify({
        schema: 1,
        kind: "drumstats",
        saved: "2026-08-19",
        n_sources: 14,
        sources: [{ file: "a.mp3", sha256: "x".repeat(64) }],
        stats: { dataset: "waivops-edm-tr9-pilot", n_loops: 14 },
        attribution: { note: "CC BY 4.0 — WaivOps" },
      }),
    );

    const measurementRecords = await store.listMeasurementRecords();
    expect(measurementRecords.map((r) => r.name)).toEqual(["my-ref"]);

    const drumStatsRecords = await store.listDrumStatsRecords();
    expect(drumStatsRecords).toEqual([
      { name: "waivops-tr9-pilot", saved: "2026-08-19", dataset: "waivops-edm-tr9-pilot", nLoops: 14, nSources: 14 },
    ]);

    const index = await store.buildIndex();
    expect(index).toContain("## measurements");
    expect(index).toContain("| [my-ref](../library/measurements/my-ref.json)");
    expect(index).toContain("## drum-stats records");
    expect(index).toContain("| [waivops-tr9-pilot](../library/measurements/waivops-tr9-pilot.json) | 2026-08-19 | waivops-edm-tr9-pilot | 14 | 14 |");
  });

  it("flags prose-only entries in the index", async () => {
    await store.saveEntry({
      ...entry,
      slug: "vibes-only",
      topic: "workflow",
      tier: "draft",
      sources: [],
      body: "Just prose, no executable section.",
    });
    expect(await store.buildIndex()).toContain("PROSE-ONLY");
  });
});

describe("reference records in the index", () => {
  it("surfaces library/references/ maps alongside measurements", async () => {
    const base = await mkdtemp(join(tmpdir(), "awh-kbref-"));
    try {
      const store = new KnowledgeStore(
        join(base, "knowledge"),
        undefined,
        join(base, "references"),
      );
      await store.saveEntry(entry);
      await mkdir(join(base, "references"), { recursive: true });
      await writeFile(
        join(base, "references", "my-ref-track.json"),
        JSON.stringify({
          saved: "2026-08-17",
          file: "/x/my-ref-track.wav",
          reference: { bpm: 128.02, sections: [{}, {}, {}, {}, {}] },
        }),
      );
      const index = await store.buildIndex();
      expect(index).toContain("## references");
      expect(index).toContain("| [my-ref-track](../library/references/my-ref-track.json) | 2026-08-17 | 128.0 | 5 |");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
