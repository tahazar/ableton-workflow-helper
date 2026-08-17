import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LibraryStore,
  parseClipEntry,
  serializeClipEntry,
  slugify,
  type ClipEntry,
} from "../src/index.js";

const entry: ClipEntry = {
  slug: "rolling-garage-hats-1",
  kind: "midi",
  category: "hats",
  tags: ["garage", "shuffle"],
  bpm: 132,
  scale: null,
  lengthBeats: 4,
  source: { project: "song-x.als", path: "track:3/slot:2", saved: "2026-08-17" },
  tier: "verified",
  title: "Rolling garage hats",
  notation: "1|1 F#1 1/4 v90\n1|2.5 F#1 1/4 v100 p85",
  prose: "Velocity dip on the offbeats is what makes it roll.",
};

describe("clip entry format", () => {
  it("round-trips through markdown", () => {
    const md = serializeClipEntry(entry);
    expect(md).toContain("```awh-notation");
    expect(md).toContain("# Rolling garage hats");
    const back = parseClipEntry(md);
    expect(back).toEqual(entry);
  });

  it("rejects malformed entries", () => {
    expect(() => serializeClipEntry({ ...entry, slug: "Bad Slug" })).toThrowError(/slug/);
    expect(() => serializeClipEntry({ ...entry, tier: "maybe" as never })).toThrowError(/tier/);
    expect(() => serializeClipEntry({ ...entry, notation: "" })).toThrowError(/notation/);
    expect(() => parseClipEntry("# no frontmatter")).toThrowError(/frontmatter/);
  });

  it("slugifies free text", () => {
    expect(slugify("ISOxo Snare! (v2)")).toBe("isoxo-snare-v2");
    expect(() => slugify("!!!")).toThrowError(/slug/);
  });
});

describe("LibraryStore", () => {
  let root: string;
  let store: LibraryStore;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "awh-lib-"));
    store = new LibraryStore(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("saves, lists, filters, and loads clips", async () => {
    await store.saveClip(entry);
    await store.saveClip({ ...entry, slug: "trap-hats-1", category: "hats", tags: ["trap"] });
    await store.saveClip({ ...entry, slug: "deep-kick", category: "kicks", tags: ["house"] });

    // sorted by relative path: hats/* before kicks/*
    expect((await store.listClips()).map((e) => e.slug)).toEqual([
      "rolling-garage-hats-1",
      "trap-hats-1",
      "deep-kick",
    ]);
    expect((await store.listClips({ category: "hats" }))).toHaveLength(2);
    expect((await store.listClips({ tag: "house" }))[0]!.slug).toBe("deep-kick");
    const loaded = await store.loadClip("rolling-garage-hats-1");
    expect(loaded.notation).toBe(entry.notation);
    expect(loaded.relPath).toBe(join("clips", "hats", "rolling-garage-hats-1.md"));
  });

  it("refuses overwrites and cross-category slug clashes", async () => {
    await store.saveClip(entry);
    await expect(store.saveClip(entry)).rejects.toThrowError(/already exists/);
    await expect(
      store.saveClip({ ...entry, category: "kicks" }),
    ).rejects.toThrowError(/already used/);
    await store.saveClip({ ...entry, tier: "draft" }, { overwrite: true });
    expect((await store.loadClip(entry.slug)).tier).toBe("draft");
  });

  it("builds an index grouped by category", async () => {
    await store.saveClip(entry);
    await store.saveClip({ ...entry, slug: "deep-kick", category: "kicks" });
    const index = await store.buildIndex();
    expect(index).toContain("## hats");
    expect(index).toContain("## kicks");
    expect(index).toContain("[rolling-garage-hats-1](hats/rolling-garage-hats-1.md)");
    const onDisk = await readFile(join(root, "clips", "INDEX.md"), "utf8");
    expect(onDisk).toBe(index);
    // INDEX.md itself must not be picked up as an entry
    expect((await store.listClips()).map((e) => e.slug)).not.toContain("INDEX");
  });
});
