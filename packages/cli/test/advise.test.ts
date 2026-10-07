import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analysisPythonPath, hasAnalysisPython } from "./analysis-venv.js";
import type { OpCaller } from "../src/op.js";
import {
  enrichActionsWithDevices,
  readMasterChainDevices,
  resolveMeasurementRecordPath,
  type MasterDevice,
} from "../src/advise.js";
import {
  hasBuiltCli,
  makeTestLibrary,
  runCli,
  startFakeGateway,
  writeWavMono16,
} from "./helpers.js";

/**
 * Mix advisor (docs/design/mix-advisor.md) CLI-side tests. The rule engine
 * itself is Python-tested (analysis/tests/test_advise.py). This file covers
 * what's specific to the CLI layer: record-name resolution, `--set`
 * device-name enrichment (pure function, and against a real fake gateway
 * whose "main" track is the master; see packages/core/src/bridge/paths.ts),
 * and missing-target/missing-layers placeholders reaching real CLI output.
 * The skill-flows gate lives in packages/core/test/skill-flows.test.ts.
 */

// ---------------------------------------------------------------------------
// resolveMeasurementRecordPath: pure, no gateway/python needed.
// ---------------------------------------------------------------------------

describe("resolveMeasurementRecordPath", () => {
  it("returns an existing literal path unchanged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "awh-advise-"));
    const file = join(dir, "some-record.json");
    await writeFile(file, "{}");
    expect(resolveMeasurementRecordPath(file, "/irrelevant/library")).toBe(file);
    await rm(dir, { recursive: true, force: true });
  });

  it("resolves a bare name under <library>/measurements/<name>.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "awh-advise-"));
    const measurementsDir = join(dir, "measurements");
    await mkdir(measurementsDir, { recursive: true });
    await writeFile(join(measurementsDir, "myrecord.json"), "{}");
    expect(resolveMeasurementRecordPath("myrecord", dir)).toBe(
      join(measurementsDir, "myrecord.json"),
    );
    await rm(dir, { recursive: true, force: true });
  });

  it("throws a clear error when neither a file nor a named record exists", () => {
    expect(() => resolveMeasurementRecordPath("nope", "/tmp/awh-does-not-exist-lib")).toThrow(
      /neither a file nor library\/measurements\/nope\.json/,
    );
  });
});

// ---------------------------------------------------------------------------
// enrichActionsWithDevices: pure text substitution, additive-only.
// ---------------------------------------------------------------------------

describe("enrichActionsWithDevices", () => {
  it("names a real master-chain device in an action that mentions its class generically", () => {
    const items = [
      { id: "eq-band-1000hz", action: "EQ Eight on master: cut ~3.0 dB around 1000 Hz" },
    ];
    const devices: MasterDevice[] = [{ path: "main/dev:2", name: "EQ Eight" }];
    const [enriched] = enrichActionsWithDevices(items, devices);
    expect(enriched!.action).toContain('your existing "EQ Eight" (main/dev:2)');
    expect(enriched!.action).toContain("cut ~3.0 dB around 1000 Hz");
  });

  it("matches a RENAMED device by class word, not exact string", () => {
    const items = [
      { id: "low-band-correlation", action: "Utility on the bass group: Bass Mono at 120 Hz" },
    ];
    const devices: MasterDevice[] = [{ path: "main/dev:0", name: "Master Utility (renamed)" }];
    const [enriched] = enrichActionsWithDevices(items, devices);
    expect(enriched!.action).toContain('your existing "Master Utility (renamed)" (main/dev:0)');
  });

  it("leaves the action untouched when no matching device exists on the chain", () => {
    const items = [
      { id: "eq-band-1000hz", action: "EQ Eight on master: cut ~3.0 dB around 1000 Hz" },
    ];
    const devices: MasterDevice[] = [{ path: "main/dev:0", name: "Reverb" }];
    const [enriched] = enrichActionsWithDevices(items, devices);
    expect(enriched!.action).toBe(items[0]!.action);
  });

  it("is a no-op (same array reference) with zero master devices — additive only, never required", () => {
    const items = [
      { id: "eq-band-1000hz", action: "EQ Eight on master: cut ~3.0 dB around 1000 Hz" },
    ];
    expect(enrichActionsWithDevices(items, [])).toBe(items);
  });
});

// ---------------------------------------------------------------------------
// readMasterChainDevices against a real fake gateway (helpers.ts).
// Confirms the fake bridge's "main" path answers device.get the same way a
// real track does, and that a gateway failure/absence degrades to an empty
// list rather than throwing.
// ---------------------------------------------------------------------------

describe("readMasterChainDevices", () => {
  it("lists devices actually sitting on the master (main) chain", async () => {
    const { caller } = await startFakeGateway();
    await caller("device.insert", { ownerPath: "main", name: "EQ Eight" });
    await caller("device.insert", { ownerPath: "main", name: "Limiter" });

    const devices = await readMasterChainDevices(caller);
    expect(devices).toEqual([
      { path: "main/dev:0", name: "EQ Eight" },
      { path: "main/dev:1", name: "Limiter" },
    ]);
  });

  it("an empty master chain returns an empty list, not an error", async () => {
    const { caller } = await startFakeGateway();
    expect(await readMasterChainDevices(caller)).toEqual([]);
  });

  it("a gateway that's simply not there degrades to an empty list (additive/offline-safe)", async () => {
    const unreachable: OpCaller = async () => {
      throw new Error("could not reach the gateway");
    };
    await expect(readMasterChainDevices(unreachable)).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Full CLI integration (spawns the built dist/index.js, real Python engine):
// arg mapping, --record/--target/--layers resolution, missing-target
// placeholder in real output, --set enrichment end to end, --compare.
// Skipped when the CLI hasn't been built or no analysis Python is found
// (analysis-venv.ts).
// ---------------------------------------------------------------------------

function sineSamples(freq: number, sr: number, durS: number, amp = 0.3): number[] {
  const n = Math.round(durS * sr);
  const out = Array.from({ length: n }, () => 0);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

// Every advise run goes through the analysis engine, so pin its Python.
function runAdviseCli(args: string[], env: Record<string, string>) {
  return runCli(args, { AWH_PYTHON: analysisPythonPath(), ...env });
}

describe.skipIf(!hasBuiltCli || !hasAnalysisPython)(
  "integ: awh mix advise — full CLI integration",
  () => {
    it("requires exactly one of <captureFile> or --record", async () => {
      const { dir, libraryRoot } = await makeTestLibrary("advise", { linkAnalysis: true });
      const result = await runAdviseCli(["mix", "advise"], { AWH_LIBRARY: libraryRoot });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/exactly one of <captureFile> or --record/);
      await rm(dir, { recursive: true, force: true });
    });

    it("no --target/--layers -> the missing-input placeholders reach real output (JSON and pretty)", async () => {
      const { dir, libraryRoot } = await makeTestLibrary("advise", { linkAnalysis: true });
      const wav = join(dir, "capture.wav");
      writeWavMono16(wav, sineSamples(300, 44100, 2.0), 44100);

      const jsonResult = await runAdviseCli(["--json", "mix", "advise", wav], {
        AWH_LIBRARY: libraryRoot,
      });
      expect(jsonResult.status).toBe(0);
      const parsed = JSON.parse(jsonResult.stdout) as {
        has_target: boolean;
        has_layers: boolean;
        items: { id: string; kind: string; stage: string }[];
      };
      expect(parsed.has_target).toBe(false);
      expect(parsed.has_layers).toBe(false);
      const byId = Object.fromEntries(parsed.items.map((item) => [item.id, item]));
      expect(byId["missing-target"]).toMatchObject({ kind: "placeholder", stage: "tonal" });
      expect(byId["missing-layers"]).toMatchObject({ kind: "placeholder", stage: "masking" });

      const prettyResult = await runAdviseCli(["mix", "advise", wav], { AWH_LIBRARY: libraryRoot });
      expect(prettyResult.status).toBe(0);
      expect(prettyResult.stdout).toMatch(/missing-target/);
      expect(prettyResult.stdout).toMatch(/no measured target/);
      expect(prettyResult.stdout).toMatch(/missing-layers/);

      await rm(dir, { recursive: true, force: true });
    });

    it("--record/--target/--layers all resolve saved records BY NAME from library/measurements|targets", async () => {
      const { dir, libraryRoot } = await makeTestLibrary("advise", { linkAnalysis: true });
      await mkdir(join(libraryRoot, "measurements"), { recursive: true });
      await mkdir(join(libraryRoot, "targets"), { recursive: true });

      // A minimal, valid mix-report-shaped measurement record (kind absent,
      // per report.save_record's convention).
      const measurements = {
        file: "x.wav",
        samplerate: 44100,
        channels: 2,
        duration_s: 2.0,
        bpm: null,
        loudness: {
          lufs_integrated: -14.0,
          lufs_short_term: { times: [], values: [] },
          true_peak_db: -6.0,
          psr: { min_psr_loud: 10.0, windows: [] },
        },
        spectrum: { freqs: [1000.0], db: [-30.0], tilt_db_per_oct: -5.0 },
        stereo: { width_db: null, banded_width_db: {}, correlation: { full: 1.0, low: 1.0 } },
        dynamics: {
          asymmetry: [{ ratio_db: 0.0, skewness: 0.0 }],
          phase_rotation_headroom: { best_db: 0.0, f0: 100.0, poles: 2 },
          pump: null,
        },
        target_comparison: null,
        target_sources: null,
      };
      await writeFile(
        join(libraryRoot, "measurements", "myreport.json"),
        JSON.stringify({
          schema: 1,
          saved: "2026-08-24",
          file: "x.wav",
          sha256: "x",
          measurements,
          findings: [],
        }),
      );
      await writeFile(
        join(libraryRoot, "targets", "myclub.json"),
        JSON.stringify({
          bands: [{ freq: 1000.0, median_db: 0.0, iqr_db: 0.3 }],
          tilt: { median: -5.0, iqr: 0.5 },
          sources: ["ref.wav"],
        }),
      );
      await writeFile(
        join(libraryRoot, "measurements", "mylayers.json"),
        JSON.stringify({
          kind: "layers",
          schema: 1,
          saved: "2026-08-24",
          tracks: [
            { trackPath: "track:0", trackName: "Kick", file: "a.wav" },
            { trackPath: "track:1", trackName: "Sub", file: "b.wav" },
          ],
          bands: { files: [], baseline_file: "a.wav" },
        }),
      );

      const result = await runAdviseCli(
        [
          "--json",
          "mix",
          "advise",
          "--record",
          "myreport",
          "--target",
          "myclub",
          "--layers",
          "mylayers",
        ],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as { has_target: boolean; has_layers: boolean };
      expect(parsed.has_target).toBe(true);
      expect(parsed.has_layers).toBe(true);

      await rm(dir, { recursive: true, force: true });
    });

    it("--set names a real master-chain device in the action text, end to end against a fake gateway", async () => {
      const { port, caller } = await startFakeGateway();
      await caller("device.insert", { ownerPath: "main", name: "EQ Eight" });

      const { dir, libraryRoot } = await makeTestLibrary("advise", { linkAnalysis: true });
      await mkdir(join(libraryRoot, "targets"), { recursive: true });
      // A tight target far from a 300 Hz sine's spectrum -> guaranteed at
      // least one flagged band -> an EQ Eight-mentioning action.
      await writeFile(
        join(libraryRoot, "targets", "tight.json"),
        JSON.stringify({
          bands: [{ freq: 1000.0, median_db: 0.0, iqr_db: 0.2 }],
          tilt: { median: -5.0, iqr: 0.2 },
          sources: ["ref.wav"],
        }),
      );
      const wav = join(dir, "capture.wav");
      writeWavMono16(wav, sineSamples(300, 44100, 2.0), 44100);

      const result = await runAdviseCli(
        ["--json", "-p", String(port), "mix", "advise", wav, "--target", "tight", "--set"],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        items: { id: string; kind: string; action: string }[];
      };
      const eqLikeItem = parsed.items.find(
        (item) => item.kind === "finding" && item.action.includes("EQ Eight"),
      );
      expect(eqLikeItem).toBeDefined();
      expect(eqLikeItem!.action).toContain('your existing "EQ Eight" (main/dev:0)');

      await rm(dir, { recursive: true, force: true });
    });

    it("--compare reports resolved/new against a saved advice record", async () => {
      const { dir, libraryRoot } = await makeTestLibrary("advise", { linkAnalysis: true });

      // Before: clipped (true-peak-ceiling fires).
      const before = join(dir, "before.wav");
      const clipped = sineSamples(300, 44100, 2.0, 1.0).map((s) =>
        Math.max(-1, Math.min(1, s * 2)),
      );
      writeWavMono16(before, clipped, 44100);
      const saveResult = await runAdviseCli(["mix", "advise", before, "--save", "before"], {
        AWH_LIBRARY: libraryRoot,
      });
      expect(saveResult.status).toBe(0);
      expect(existsSync(join(libraryRoot, "measurements", "before.json"))).toBe(true);

      // After: safely gained (true-peak-ceiling resolved), decorrelated low
      // band (a new item: low-band-correlation).
      const after = join(dir, "after.wav");
      const t = Array.from({ length: 44100 * 2 }, (_, i) => i / 44100);
      const left = t.map((s) => 0.3 * Math.sin(2 * Math.PI * 60 * s));
      const right = t.map((s) => -0.3 * Math.sin(2 * Math.PI * 60 * s));
      // Interleave into a stereo 16-bit wav by hand (writeWavMono16 is mono
      // only).
      const n = left.length;
      const buffer = Buffer.alloc(44 + n * 2 * 2);
      buffer.write("RIFF", 0);
      buffer.writeUInt32LE(36 + n * 4, 4);
      buffer.write("WAVE", 8);
      buffer.write("fmt ", 12);
      buffer.writeUInt32LE(16, 16);
      buffer.writeUInt16LE(1, 20);
      buffer.writeUInt16LE(2, 22);
      buffer.writeUInt32LE(44100, 24);
      buffer.writeUInt32LE(44100 * 4, 28);
      buffer.writeUInt16LE(4, 32);
      buffer.writeUInt16LE(16, 34);
      buffer.write("data", 36);
      buffer.writeUInt32LE(n * 4, 40);
      for (let i = 0; i < n; i++) {
        buffer.writeInt16LE(Math.round(left[i]! * 32767), 44 + i * 4);
        buffer.writeInt16LE(Math.round(right[i]! * 32767), 44 + i * 4 + 2);
      }
      writeFileSync(after, buffer);

      const compareResult = await runAdviseCli(
        ["--json", "mix", "advise", after, "--compare", "before"],
        {
          AWH_LIBRARY: libraryRoot,
        },
      );
      expect(compareResult.status).toBe(0);
      const parsed = JSON.parse(compareResult.stdout) as {
        compare: { id: string; status: string }[];
      };
      const byId = Object.fromEntries(parsed.compare.map((c) => [c.id, c.status]));
      expect(byId["true-peak-ceiling"]).toBe("resolved");
      expect(byId["low-band-correlation"]).toBe("new");

      await rm(dir, { recursive: true, force: true });
    });
  },
);
