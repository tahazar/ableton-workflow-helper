import { describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ClipDetail } from "@awh/core";
import { makeTestLibrary, runCli, startFakeGateway } from "./helpers.js";

/**
 * Arp engine CLI-level tests (docs/design/arp-engine.md's verification
 * bar). The engine/spec property tests live in
 * packages/core/test/arp.test.ts. This file covers what's specific to the
 * CLI layer: --prog end-to-end against a fake gateway, the chord-clip
 * source (reading a clip `awh chords` itself would write), the
 * knowledge-entry style fallback (tier printed) via an isolated AWH_LIBRARY
 * (sibling knowledge/ dir, the same override `findLibraryRoot` honors; see
 * packages/core/src/library/store.ts), the melody-only negative control,
 * and the unknown-style error. Runs the CLI in-process (`runCli`) against
 * an in-process fake gateway.
 */

describe("awh arp — full CLI integration", () => {
  it("--prog end-to-end against a fake gateway: writes a clip, shows in status", async () => {
    const { port, caller } = await startFakeGateway();
    const { dir, libraryRoot } = await makeTestLibrary("arp");
    try {
      const result = await runCli(
        [
          "-p",
          String(port),
          "arp",
          "--prog",
          "i-VI-III-VII",
          "--key",
          "A minor",
          "--style",
          "basic-up",
          "--bars",
          "4",
          "track:0",
          "--at-bar",
          "1",
        ],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/-> track:0\/arr:0 \(4 bars, \d+ notes\)/);
      expect(result.stdout).toMatch(/style basic-up — contour up/);

      const detail = (await caller("clip.get", { path: "track:0/arr:0" })) as ClipDetail;
      expect(detail.kind).toBe("midi");
      expect(detail.notes!.length).toBeGreaterThan(0);
      expect(detail.duration).toBe(16);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--dry-run never writes (status stays clean)", async () => {
    const { port, caller } = await startFakeGateway();
    const { dir, libraryRoot } = await makeTestLibrary("arp");
    try {
      const result = await runCli(
        [
          "-p",
          String(port),
          "arp",
          "--prog",
          "i-VI",
          "--key",
          "A minor",
          "track:0",
          "--at-bar",
          "1",
          "--dry-run",
        ],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/dry run:/);
      // bar|beat notation preview reached real output
      expect(result.stdout).toMatch(/1\|1 /);

      const summary = (await caller("set.summary")) as {
        tracks: { arrangementClips: unknown[] }[];
      };
      expect(summary.tracks[0]!.arrangementClips).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("chord-clip source: reads a clip `awh chords` itself would write, and arpeggiates it", async () => {
    const { port, caller } = await startFakeGateway();
    const { dir, libraryRoot } = await makeTestLibrary("arp");
    try {
      const chordsResult = await runCli(
        [
          "-p",
          String(port),
          "chords",
          "track:0",
          "--progression",
          "i-VI-III-VII",
          "--key",
          "A minor",
          "--at-bar",
          "1",
        ],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(chordsResult.status, chordsResult.stderr).toBe(0);

      const arpResult = await runCli(
        [
          "-p",
          String(port),
          "arp",
          "track:0/arr:0",
          "track:2",
          "--style",
          "melodic-techno-16ths",
          "--at-bar",
          "1",
        ],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(arpResult.status, arpResult.stderr).toBe(0);
      expect(arpResult.stdout).toMatch(/chord clip track:0\/arr:0 \(4 chords\)/);

      const detail = (await caller("clip.get", { path: "track:2/arr:0" })) as ClipDetail;
      expect(detail.kind).toBe("midi");
      expect(detail.notes!.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("melody-only clip source is a STATE (exit 0, nothing written), not an error", async () => {
    const { port, caller } = await startFakeGateway();
    const { dir, libraryRoot } = await makeTestLibrary("arp");
    try {
      await caller("clip.create-midi", {
        target: { type: "session", slotPath: "track:0/slot:0" },
        lengthBeats: 4,
        notes: [
          { pitch: 60, start: 0, duration: 0.5, velocity: 100 },
          { pitch: 62, start: 0.5, duration: 0.5, velocity: 100 },
        ],
        name: "melody",
      });

      const result = await runCli(
        ["-p", String(port), "arp", "track:0/slot:0", "track:2", "--at-bar", "1"],
        {
          AWH_LIBRARY: libraryRoot,
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/looks like a melody/);

      const summary = (await caller("set.summary")) as {
        tracks: { arrangementClips: unknown[] }[];
      };
      expect(summary.tracks[2]!.arrangementClips).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("unknown style: a clear, non-zero-exit error naming the arp-style-<name> convention", async () => {
    const { dir, libraryRoot } = await makeTestLibrary("arp");
    try {
      // style resolution fails before any gateway call is made, so no fake
      // gateway is needed for this one; the port is never dialed.
      const result = await runCli(
        [
          "-p",
          "9",
          "arp",
          "--prog",
          "i-VI",
          "--key",
          "A minor",
          "--style",
          "does-not-exist",
          "track:0",
          "--at-bar",
          "1",
        ],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/unknown arp style "does-not-exist"/);
      expect(result.stderr).toMatch(/arp-style-does-not-exist/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("style fallback from a temp knowledge entry — tier printed, variants listable", async () => {
    const { port } = await startFakeGateway();
    const { dir, libraryRoot } = await makeTestLibrary("arp");
    try {
      const knowledgeDir = join(dir, "knowledge", "rhythm");
      await mkdir(knowledgeDir, { recursive: true });
      await writeFile(
        join(knowledgeDir, "arp-style-cli-test.md"),
        [
          "---",
          "slug: arp-style-cli-test",
          "topic: rhythm",
          "tier: sourced",
          "tags: [arp]",
          'sources: ["own analysis of test fixture"]',
          "related: []",
          "---",
          "# CLI test arp style",
          "",
          "## Executable",
          "```awh-arp-spec",
          "name: cli-test",
          "contour: down",
          "octaves: 1",
          "rate: 1/8",
          "gate: 0.6",
          "patternLength: 8",
          "euclid: {k: 6, n: 8, rotate: 0}",
          "```",
          "",
          "## The rule",
          "test fixture only.",
        ].join("\n"),
      );

      const result = await runCli(
        [
          "-p",
          String(port),
          "arp",
          "--prog",
          "i-VI",
          "--key",
          "A minor",
          "--style",
          "cli-test",
          "track:0",
          "--at-bar",
          "1",
          "--dry-run",
        ],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/style cli-test \[sourced\]/);
      expect(result.stdout).toMatch(/contour down/);

      // variants: euclid.n = 8 -> rotate-0..rotate-7, and an unknown variant's
      // error names them (same listable convention as drums/phrase).
      const badVariant = await runCli(
        [
          "-p",
          String(port),
          "arp",
          "--prog",
          "i-VI",
          "--key",
          "A minor",
          "--style",
          "cli-test",
          "track:0",
          "--at-bar",
          "1",
          "--variant",
          "nope",
          "--dry-run",
        ],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(badVariant.status).not.toBe(0);
      expect(badVariant.stderr).toMatch(/rotate-0.*rotate-7/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
