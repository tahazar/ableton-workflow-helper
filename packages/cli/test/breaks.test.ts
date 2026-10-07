import { describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { analysisPythonPath, hasAnalysisPython } from "./analysis-venv.js";
import type { ClipDetail } from "@awh/core";
import { makeTestLibrary, runCli, startFakeGateway, writeWavMono16 } from "./helpers.js";

/**
 * Break engine CLI-level tests (docs/design/break-engine.md's verification
 * bar). The pattern/fill engine's own property tests live in
 * packages/core/test/breaks.test.ts (pure, no Python). This file covers
 * what's specific to the CLI layer: `--map` chop-map-record resolution,
 * the `--mode` note-mapping check (and its count-mismatch warning), the
 * knowledge break-style-<name>/break-pattern-<name> fallback via an
 * isolated AWH_LIBRARY (same pattern as arp.test.ts), `mix records`
 * rendering the "chopmap" kind, a real end-to-end `awh breaks chop` run
 * against a synthetic break WAV, and the skill-flows gate.
 */

// A hand-built chop-map record that bypasses the Python analyzer, since the
// pattern/fill engine has its own core-level tests and this file covers CLI
// wiring: 5 slices, one bar, one snare-role substitution candidate.
function chopMapRecordJson(overrides: { confidence?: number } = {}) {
  const conf = overrides.confidence ?? 0.9;
  const slice = (index: number, gridStep: number, role: string) => ({
    index,
    start_s: gridStep * 0.1,
    end_s: (gridStep + 1) * 0.1,
    duration_s: 0.1,
    grid_step: gridStep,
    bar: 0,
    pos: gridStep,
    offset_ms: 0,
    role,
    confidence: conf,
    is_ghost: role === "ghost",
    peak_db_rel: 0,
    bands: { low: 0.33, mid: 0.33, high: 0.34 },
  });
  return {
    schema: 1,
    kind: "chopmap",
    saved: "2026-08-26",
    file: "/tmp/amen.wav",
    sha256: "deadbeef",
    chopmap: {
      file: "amen.wav",
      samplerate: 44100,
      duration_s: 1.6,
      bpm: 138,
      bpm_confidence: 0.8,
      bpm_source: "override",
      bpm_runner_up: null,
      grid_steps_per_bar: 16,
      beats_per_bar: 4,
      min_gap_s: 0.025,
      ghost_threshold_db: -18,
      n_slices: 5,
      slices: [
        slice(0, 0, "kick"),
        slice(1, 4, "snare"),
        slice(2, 8, "hat"),
        slice(3, 12, "snare"),
        slice(4, 15, "ghost"),
      ],
      tail_decay_s: null,
      downbeat_check: {},
      assumptions: [],
    },
  };
}

async function writeChopMapRecord(
  libraryRoot: string,
  name: string,
  overrides: { confidence?: number } = {},
): Promise<void> {
  const dir = join(libraryRoot, "measurements");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${name}.json`),
    JSON.stringify(chopMapRecordJson(overrides), null, 2),
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// Synthetic break WAV (real audio, real Python subprocess), using the same
// attack/release-ramped burst construction as analysis/tests/test_breakchop.py,
// reimplemented here in plain PCM16 mono so the CLI-level `chop` test
// exercises the real awh_analysis.breakchop subprocess end to end.
// ---------------------------------------------------------------------------

function burst(sr: number, freq: number, amp: number, tau: number, noise: boolean): number[] {
  const length = Math.round(8 * tau * sr);
  const out = Array.from({ length }, () => 0);
  for (let i = 0; i < length; i++) {
    const t = i / sr;
    let env = Math.exp(-t / tau);
    const aSamp = Math.round(0.005 * sr);
    if (i < aSamp) env *= 0.5 - 0.5 * Math.cos((Math.PI * i) / aSamp);
    const rSamp = Math.round(0.005 * sr);
    if (i > length - rSamp) env *= 0.5 + 0.5 * Math.cos((Math.PI * (i - (length - rSamp))) / rSamp);
    out[i] = amp * env * (noise ? Math.random() * 2 - 1 : Math.sin(2 * Math.PI * freq * t));
  }
  return out;
}

function synthBreakWav(path: string): void {
  const sr = 44100;
  const stepDurS = (60.0 / 90.0) * (4.0 / 16); // 0.1667s
  const leadS = 3 * stepDurS;
  const events: [number, "kick" | "snare" | "hat"][] = [
    [0, "kick"],
    [8, "snare"],
    [16, "kick"],
    [24, "hat"],
  ];
  const durS = leadS + (Math.max(...events.map((e) => e[0])) + 8) * stepDurS + 0.3;
  const n = Math.round(durS * sr);
  const sig = Array.from({ length: n }, () => 0);
  for (const [step, kind] of events) {
    const t0 = leadS + step * stepDurS;
    const start = Math.round(t0 * sr);
    const b =
      kind === "kick"
        ? burst(sr, 55.0, 0.9, 0.04, false)
        : kind === "snare"
          ? burst(sr, 220.0, 0.6, 0.03, false)
          : burst(sr, 9000.0, 0.3, 0.012, true);
    for (let i = 0; i < b.length && start + i < n; i++) sig[start + i]! += b[i]!;
  }
  writeWavMono16(path, sig, sr);
}

// ---------------------------------------------------------------------------

describe.skipIf(!hasAnalysisPython)("integ: awh breaks chop — real Python subprocess", () => {
  it("chops a synthetic break wav, saves a chopmap record, and `mix records` renders it", async () => {
    const { dir, libraryRoot } = await makeTestLibrary("breaks", { linkAnalysis: true });
    try {
      const wav = join(dir, "break.wav");
      synthBreakWav(wav);

      const chopResult = await runCli(
        ["breaks", "chop", wav, "--bpm", "90", "--save", "amen-test", "--json"],
        {
          AWH_LIBRARY: libraryRoot,
          AWH_PYTHON: analysisPythonPath(),
        },
      );
      expect(chopResult.status, chopResult.stderr).toBe(0);
      const obj = JSON.parse(chopResult.stdout) as { n_slices: number };
      expect(obj.n_slices).toBe(4);

      const recordsResult = await runCli(["mix", "records", "--json"], {
        AWH_LIBRARY: libraryRoot,
        AWH_PYTHON: analysisPythonPath(),
      });
      expect(recordsResult.status, recordsResult.stderr).toBe(0);
      const rows = JSON.parse(recordsResult.stdout) as { name: string; summary: string }[];
      const row = rows.find((r) => r.name === "amen-test");
      expect(row?.summary).toMatch(/chopmap: 4 slice/);

      const showResult = await runCli(["mix", "records", "amen-test"], {
        AWH_LIBRARY: libraryRoot,
        AWH_PYTHON: analysisPythonPath(),
      });
      expect(showResult.status, showResult.stderr).toBe(0);
      expect(showResult.stdout).toMatch(/awh breaks pattern/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  it("--export cuts slice WAVs with a README mapping table", async () => {
    const { dir, libraryRoot } = await makeTestLibrary("breaks", { linkAnalysis: true });
    try {
      const wav = join(dir, "break.wav");
      synthBreakWav(wav);
      const exportDir = join(dir, "export");
      const result = await runCli(["breaks", "chop", wav, "--bpm", "90", "--export", exportDir], {
        AWH_LIBRARY: libraryRoot,
        AWH_PYTHON: analysisPythonPath(),
      });
      expect(result.status, result.stderr).toBe(0);
      expect(existsSync(join(exportDir, "README.md"))).toBe(true);
      expect(existsSync(join(exportDir, "00-kick.wav"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);
});

describe("awh breaks pattern — full CLI integration", () => {
  it("--map resolution + --dry-run: notes reference the chop map's own slices", async () => {
    const { port, caller } = await startFakeGateway();
    const { dir, libraryRoot } = await makeTestLibrary("breaks", { linkAnalysis: true });
    try {
      await writeChopMapRecord(libraryRoot, "amen");
      const result = await runCli(
        [
          "-p",
          String(port),
          "breaks",
          "pattern",
          "track:0",
          "--map",
          "amen",
          "--style",
          "jungle-classic",
          "--bars",
          "1",
          "--at-bar",
          "1",
          "--dry-run",
        ],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/dry run: chop map amen/);
      expect(result.stdout).toMatch(/1\|1 /); // bar|beat notation preview

      const summary = (await caller("set.summary")) as {
        tracks: { arrangementClips: unknown[] }[];
      };
      expect(summary.tracks[0]!.arrangementClips).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes a real clip end to end against a fake gateway", async () => {
    const { port, caller } = await startFakeGateway();
    const { dir, libraryRoot } = await makeTestLibrary("breaks", { linkAnalysis: true });
    try {
      await writeChopMapRecord(libraryRoot, "amen");
      const result = await runCli(
        [
          "-p",
          String(port),
          "breaks",
          "pattern",
          "track:0",
          "--map",
          "amen",
          "--style",
          "halftime",
          "--bars",
          "1",
          "--at-bar",
          "1",
        ],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status, result.stderr).toBe(0);
      const detail = (await caller("clip.get", { path: "track:0/arr:0" })) as ClipDetail;
      expect(detail.kind).toBe("midi");
      expect(detail.notes!.length).toBeGreaterThan(0);
      // drum-rack (default) mode: every pitch is C1-up (36..) in slice order.
      for (const n of detail.notes!) {
        expect(n.pitch).toBeGreaterThanOrEqual(36);
        expect(n.pitch).toBeLessThan(36 + 5);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--mode live-slices prints the loud count-mismatch warning naming the slice count", async () => {
    const { dir, libraryRoot } = await makeTestLibrary("breaks", { linkAnalysis: true });
    try {
      await writeChopMapRecord(libraryRoot, "amen");
      const result = await runCli(
        [
          "breaks",
          "pattern",
          "track:0",
          "--map",
          "amen",
          "--mode",
          "live-slices",
          "--bars",
          "1",
          "--at-bar",
          "1",
          "--dry-run",
        ],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/LIVE-SLICES MODE/);
      expect(result.stdout).toMatch(/EXACTLY 5 slice/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--mode drum-rack refuses to address a chop map with more than 16 slices", async () => {
    const { dir, libraryRoot } = await makeTestLibrary("breaks", { linkAnalysis: true });
    try {
      const many = chopMapRecordJson();
      many.chopmap.n_slices = 17;
      many.chopmap.slices = Array.from({ length: 17 }, (_, i) => ({
        ...many.chopmap.slices[0]!,
        index: i,
        grid_step: i,
        pos: i,
      }));
      const dirPath = join(libraryRoot, "measurements");
      await mkdir(dirPath, { recursive: true });
      await writeFile(join(dirPath, "big.json"), JSON.stringify(many), "utf8");

      const result = await runCli(
        [
          "breaks",
          "pattern",
          "track:0",
          "--map",
          "big",
          "--bars",
          "1",
          "--at-bar",
          "1",
          "--dry-run",
        ],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/at most 16 pads/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("negative control: an all-low-confidence chop map warns and restricts substitution", async () => {
    const { dir, libraryRoot } = await makeTestLibrary("breaks", { linkAnalysis: true });
    try {
      await writeChopMapRecord(libraryRoot, "shaky", { confidence: 0.2 });
      const result = await runCli(
        [
          "breaks",
          "pattern",
          "track:0",
          "--map",
          "shaky",
          "--style",
          "jungle-classic",
          "--bars",
          "2",
          "--at-bar",
          "1",
          "--dry-run",
        ],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/WARNING:.*confidence/);
      expect(result.stdout).toMatch(/substitution false/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("zero-slices map is a state, not an error", async () => {
    const { dir, libraryRoot } = await makeTestLibrary("breaks", { linkAnalysis: true });
    try {
      const empty = chopMapRecordJson();
      empty.chopmap.n_slices = 0;
      empty.chopmap.slices = [];
      const dirPath = join(libraryRoot, "measurements");
      await mkdir(dirPath, { recursive: true });
      await writeFile(join(dirPath, "empty.json"), JSON.stringify(empty), "utf8");

      const result = await runCli(
        [
          "breaks",
          "pattern",
          "track:0",
          "--map",
          "empty",
          "--bars",
          "1",
          "--at-bar",
          "1",
          "--dry-run",
        ],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/zero slices/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("unknown style: a clear, non-zero-exit error naming the break-style-<name> convention", async () => {
    const { dir, libraryRoot } = await makeTestLibrary("breaks", { linkAnalysis: true });
    try {
      await writeChopMapRecord(libraryRoot, "amen");
      const result = await runCli(
        [
          "breaks",
          "pattern",
          "track:0",
          "--map",
          "amen",
          "--style",
          "does-not-exist",
          "--bars",
          "1",
          "--at-bar",
          "1",
          "--dry-run",
        ],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/unknown break style "does-not-exist"/);
      expect(result.stderr).toMatch(/break-style-does-not-exist/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("style fallback from a temp knowledge entry — tier printed", async () => {
    const { dir, libraryRoot } = await makeTestLibrary("breaks", { linkAnalysis: true });
    try {
      await writeChopMapRecord(libraryRoot, "amen");
      const knowledgeDir = join(dir, "knowledge", "rhythm");
      await mkdir(knowledgeDir, { recursive: true });
      await writeFile(
        join(knowledgeDir, "break-style-cli-test.md"),
        [
          "---",
          "slug: break-style-cli-test",
          "topic: rhythm",
          "tier: sourced",
          "tags: [breaks]",
          'sources: ["own analysis of test fixture"]',
          "related: []",
          "---",
          "# CLI test break style",
          "",
          "## Executable",
          "```awh-break-spec",
          "name: cli-test",
          "statementBars: 0",
          "turnaroundDensity: 0.3",
          "```",
          "",
          "## The rule",
          "test fixture only.",
        ].join("\n"),
      );

      const result = await runCli(
        [
          "breaks",
          "pattern",
          "track:0",
          "--map",
          "amen",
          "--style",
          "cli-test",
          "--bars",
          "1",
          "--at-bar",
          "1",
          "--dry-run",
        ],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/style cli-test \[sourced\]/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("awh breaks fill — full CLI integration", () => {
  it("--dry-run shows N seeded candidates with their device lists", async () => {
    const { dir, libraryRoot } = await makeTestLibrary("breaks", { linkAnalysis: true });
    try {
      await writeChopMapRecord(libraryRoot, "amen");
      const result = await runCli(
        ["breaks", "fill", "track:0", "--map", "amen", "--beats", "2", "--count", "3", "--dry-run"],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/dry run: 3 fill candidate/);
      expect(result.stdout).toMatch(/fill .+ s\d+/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes N candidates into consecutive session slots, named 'fill <devices> s<seed>'", async () => {
    const { port, caller } = await startFakeGateway();
    const { dir, libraryRoot } = await makeTestLibrary("breaks", { linkAnalysis: true });
    try {
      await writeChopMapRecord(libraryRoot, "amen");
      const result = await runCli(
        [
          "-p",
          String(port),
          "breaks",
          "fill",
          "track:0",
          "--map",
          "amen",
          "--beats",
          "2",
          "--count",
          "3",
          "--seed",
          "5",
        ],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status, result.stderr).toBe(0);
      const summary = (await caller("set.summary")) as {
        tracks: { path: string; sessionClips: { path: string; name?: string }[] }[];
      };
      const clips = summary.tracks[0]!.sessionClips;
      expect(clips.length).toBe(3);
      for (const c of clips) {
        expect(c.name).toMatch(/^fill .+ s\d+$/);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("zero-slices map is a state, not an error", async () => {
    const { dir, libraryRoot } = await makeTestLibrary("breaks", { linkAnalysis: true });
    try {
      const empty = chopMapRecordJson();
      empty.chopmap.n_slices = 0;
      empty.chopmap.slices = [];
      const dirPath = join(libraryRoot, "measurements");
      await mkdir(dirPath, { recursive: true });
      await writeFile(join(dirPath, "empty.json"), JSON.stringify(empty), "utf8");

      const result = await runCli(["breaks", "fill", "track:0", "--map", "empty", "--dry-run"], {
        AWH_LIBRARY: libraryRoot,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/zero slices/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("awh breaks place — full CLI integration", () => {
  it("resolves a break-pattern-<name> entry's awh-notation block, no rack -> GM fallback", async () => {
    const { port, caller } = await startFakeGateway();
    const { dir, libraryRoot } = await makeTestLibrary("breaks", { linkAnalysis: true });
    try {
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
          "",
          "## The rule",
          "test fixture only.",
        ].join("\n"),
      );

      const result = await runCli(
        ["-p", String(port), "breaks", "place", "cli-test", "track:0", "--at-bar", "1"],
        {
          AWH_LIBRARY: libraryRoot,
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/placed cli-test \[sourced\]/);
      expect(result.stdout).toMatch(/no drum rack on track:0/);

      const detail = (await caller("clip.get", { path: "track:0/arr:0" })) as ClipDetail;
      expect(detail.kind).toBe("midi");
      expect(detail.notes!.length).toBe(2);
      // GM fallback: C1 (36, kick) and D1 (38, snare) pass through unchanged.
      expect(detail.notes!.map((n) => n.pitch).toSorted((a, b) => a - b)).toEqual([36, 38]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("missing entry: a helpful error naming the break-pattern-<name> slug convention", async () => {
    const { dir, libraryRoot } = await makeTestLibrary("breaks", { linkAnalysis: true });
    try {
      const result = await runCli(
        ["breaks", "place", "does-not-exist", "track:0", "--at-bar", "1"],
        {
          AWH_LIBRARY: libraryRoot,
        },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/unknown break pattern "does-not-exist"/);
      expect(result.stderr).toMatch(/break-pattern-does-not-exist/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
