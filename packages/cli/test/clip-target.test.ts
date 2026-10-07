import { describe, expect, it, onTestFinished } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BridgeError, FakeLiveBridge, type ClipDetail } from "@awh/core";
import { makeTestLibrary, runCli, startFakeGateway, type FakeGateway } from "./helpers.js";

/**
 * Commands that write into a slot or arrangement path first read the clip
 * there: a clip fills in place, nothing there means create one. Only the
 * gateway's `not_found` means nothing there. Any other clip.get failure
 * must stop the command, or it creates a clip over one it could not read.
 * Covered through `breaks place`, `lib place` and `drop phrase`, three of
 * the four commands that share the read (`clip from-audio` needs the
 * transcription model).
 */

/** A FakeLiveBridge whose clip reads fail with a gateway `internal` error
 *  while `failClipReads` is set, as a Live API exception would. */
class ClipReadFailsBridge extends FakeLiveBridge {
  failClipReads = true;

  override getClip(path: string): Promise<ClipDetail> {
    if (this.failClipReads) {
      return Promise.reject(new BridgeError("internal", `clip read failed (${path})`));
    }
    return super.getClip(path);
  }
}

const SLOT = "track:0/slot:0";
const READ_FAILED = new RegExp(
  `reading the clip at track:0/slot:0 failed: Gateway error 500: internal — clip read failed`,
);

async function seedClip(gateway: FakeGateway, path = SLOT): Promise<void> {
  await gateway.caller("clip.create-midi", {
    target: { type: "session", slotPath: path },
    lengthBeats: 4,
    notes: [{ pitch: 60, start: 0, duration: 1, velocity: 100 }],
    name: "keep me",
  });
}

async function clipAt(gateway: FakeGateway, path = SLOT): Promise<ClipDetail> {
  return (await gateway.caller("clip.get", { path })) as ClipDetail;
}

/** A library with a `break-pattern-cli-test` knowledge entry. */
async function breakPatternLibrary(): Promise<string> {
  const { dir, libraryRoot } = await makeTestLibrary("clip-target");
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const knowledgeDir = join(dir, "knowledge", "rhythm");
  await mkdir(knowledgeDir, { recursive: true });
  await writeFile(
    join(knowledgeDir, "break-pattern-cli-test.md"),
    [
      "---",
      "slug: break-pattern-cli-test",
      "topic: rhythm",
      "tier: sourced",
      "tags: [breaks]",
      'sources: ["own analysis of test fixture"]',
      "related: []",
      "---",
      "# CLI test break pattern",
      "",
      "## Executable",
      "```awh-notation",
      "1|1 C1 1/2 v100",
      "1|2 D1 1/2 v90",
      "```",
    ].join("\n"),
  );
  return libraryRoot;
}

describe("breaks place: reading the target clip", () => {
  it("a clip.get failure stops the command and leaves the clip in the slot", async () => {
    const bridge = new ClipReadFailsBridge();
    const gateway = await startFakeGateway(bridge);
    await seedClip(gateway);
    const libraryRoot = await breakPatternLibrary();

    const result = await runCli(["-p", String(gateway.port), "breaks", "place", "cli-test", SLOT], {
      AWH_LIBRARY: libraryRoot,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(READ_FAILED);
    bridge.failClipReads = false;
    const clip = await clipAt(gateway);
    expect(clip.name).toBe("keep me");
    expect(clip.notes!.map((n) => n.pitch)).toEqual([60]);
  });

  it("an empty slot (not_found) gets a new clip", async () => {
    const gateway = await startFakeGateway();
    const libraryRoot = await breakPatternLibrary();

    const result = await runCli(["-p", String(gateway.port), "breaks", "place", "cli-test", SLOT], {
      AWH_LIBRARY: libraryRoot,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(
      /placed cli-test \[sourced\] -> track:0\/slot:0 \(2 notes, 4 beats\)/,
    );
    expect((await clipAt(gateway)).name).toBe("cli-test");
  });

  it("an occupied slot is filled in place", async () => {
    const gateway = await startFakeGateway();
    await seedClip(gateway);
    const libraryRoot = await breakPatternLibrary();

    const result = await runCli(["-p", String(gateway.port), "breaks", "place", "cli-test", SLOT], {
      AWH_LIBRARY: libraryRoot,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/filled existing clip/);
    expect((await clipAt(gateway)).notes!.map((n) => n.pitch)).toEqual([36, 38]);
  });

  it("an arrangement path with no clip (not_found) is refused, not created", async () => {
    const gateway = await startFakeGateway();
    const libraryRoot = await breakPatternLibrary();

    const result = await runCli(
      ["-p", String(gateway.port), "breaks", "place", "cli-test", "track:0/arr:0"],
      { AWH_LIBRARY: libraryRoot },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /no clip at track:0\/arr:0 — arr paths must point at an existing/,
    );
  });
});

describe("lib place: reading the target clip", () => {
  /** Saves the clip at `track:0/slot:1` into a fresh library as `riff`. */
  async function savedRiff(gateway: FakeGateway): Promise<string> {
    const { dir, libraryRoot } = await makeTestLibrary("clip-target");
    onTestFinished(() => rm(dir, { recursive: true, force: true }));
    await seedClip(gateway, "track:0/slot:1");
    const saved = await runCli([
      "-p",
      String(gateway.port),
      "save",
      "track:0/slot:1",
      "--category",
      "bass",
      "--as",
      "riff",
      "--library",
      libraryRoot,
    ]);
    expect(saved.status, saved.stderr).toBe(0);
    return libraryRoot;
  }

  it("a clip.get failure stops the command and leaves the clip in the slot", async () => {
    const bridge = new ClipReadFailsBridge();
    bridge.failClipReads = false;
    const gateway = await startFakeGateway(bridge);
    const libraryRoot = await savedRiff(gateway);
    await gateway.caller("clip.create-midi", {
      target: { type: "session", slotPath: SLOT },
      lengthBeats: 8,
      notes: [{ pitch: 48, start: 0, duration: 1, velocity: 100 }],
      name: "keep me",
    });
    bridge.failClipReads = true;

    const result = await runCli([
      "-p",
      String(gateway.port),
      "lib",
      "place",
      "riff",
      SLOT,
      "--library",
      libraryRoot,
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(READ_FAILED);
    bridge.failClipReads = false;
    const clip = await clipAt(gateway);
    expect(clip.name).toBe("keep me");
    expect(clip.notes!.map((n) => n.pitch)).toEqual([48]);
  });

  it("an empty slot (not_found) gets a new clip", async () => {
    const gateway = await startFakeGateway();
    const libraryRoot = await savedRiff(gateway);

    const result = await runCli([
      "-p",
      String(gateway.port),
      "lib",
      "place",
      "riff",
      SLOT,
      "--library",
      libraryRoot,
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect((await clipAt(gateway)).notes!.map((n) => n.pitch)).toEqual([60]);
  });

  it("an occupied slot is filled in place, tiled to its length", async () => {
    const gateway = await startFakeGateway();
    const libraryRoot = await savedRiff(gateway);
    await gateway.caller("clip.create-midi", {
      target: { type: "session", slotPath: SLOT },
      lengthBeats: 8,
      notes: [],
      name: "keep me",
    });

    const result = await runCli([
      "-p",
      String(gateway.port),
      "lib",
      "place",
      "riff",
      SLOT,
      "--library",
      libraryRoot,
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/-> track:0\/slot:0 \(2 notes, 8 beats, filled existing clip\)/);
    expect((await clipAt(gateway)).notes!.map((n) => n.start)).toEqual([0, 4]);
  });

  it("an arrangement path with no clip (not_found) is refused, not created", async () => {
    const gateway = await startFakeGateway();
    const libraryRoot = await savedRiff(gateway);

    const result = await runCli([
      "-p",
      String(gateway.port),
      "lib",
      "place",
      "riff",
      "track:0/arr:0",
      "--library",
      libraryRoot,
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /no clip at track:0\/arr:0 — arr paths must point at an existing/,
    );
  });

  it("a track path with --at-bar creates an arrangement clip", async () => {
    const gateway = await startFakeGateway();
    const libraryRoot = await savedRiff(gateway);

    const result = await runCli([
      "-p",
      String(gateway.port),
      "lib",
      "place",
      "riff",
      "track:0",
      "--at-bar",
      "2",
      "--library",
      libraryRoot,
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/-> track:0\/arr:0 \(1 notes, 4 beats\)/);
    expect((await clipAt(gateway, "track:0/arr:0")).startTime).toBe(4);
  });
});

describe("drop phrase: reading the target clip", () => {
  it("a clip.get failure stops the command and leaves the clip in the slot", async () => {
    const bridge = new ClipReadFailsBridge();
    const gateway = await startFakeGateway(bridge);
    await seedClip(gateway);

    const result = await runCli([
      "-p",
      String(gateway.port),
      "drop",
      "phrase",
      SLOT,
      "--key",
      "A minor",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(READ_FAILED);
    bridge.failClipReads = false;
    const clip = await clipAt(gateway);
    expect(clip.name).toBe("keep me");
    expect(clip.notes!.map((n) => n.pitch)).toEqual([60]);
  });

  it("an empty slot (not_found) gets a new clip", async () => {
    const gateway = await startFakeGateway();

    const result = await runCli([
      "-p",
      String(gateway.port),
      "drop",
      "phrase",
      SLOT,
      "--key",
      "A minor",
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect((await clipAt(gateway)).notes!.length).toBeGreaterThan(0);
  });

  it("an occupied slot is filled in place", async () => {
    const gateway = await startFakeGateway();
    await seedClip(gateway);

    const result = await runCli([
      "-p",
      String(gateway.port),
      "drop",
      "phrase",
      SLOT,
      "--key",
      "A minor",
    ]);

    expect(result.status, result.stderr).toBe(0);
    // Filled, not recreated: the clip keeps its 4 beats and the 8-bar
    // phrase is clamped to them.
    const clip = await clipAt(gateway);
    expect(clip.duration).toBe(4);
    expect(clip.notes!.length).toBeGreaterThan(0);
    expect(clip.notes!.every((n) => n.start < 4)).toBe(true);
  });

  it("an arrangement path with no clip (not_found) is refused, not created", async () => {
    const gateway = await startFakeGateway();

    const result = await runCli([
      "-p",
      String(gateway.port),
      "drop",
      "phrase",
      "track:0/arr:0",
      "--key",
      "A minor",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /no clip at track:0\/arr:0 — arr paths must point at an existing/,
    );
  });
});
