import { describe, expect, it, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { extname } from "node:path";
import {
  nextRandom,
  seedToRngState,
  createInitialState,
  pickNextSection,
  pickVariant,
  rollMutes,
  boundedRandomWalkStep,
  stepFluctuation,
  advanceToNextSection,
  sectionDurationSeconds,
  // eslint-disable-next-line
} from "../assets/endless/player.js";
import { parseWavHeader, writeWavPcm16, expectedLoopDurationSeconds } from "../src/endless/wav.js";
import { buildEndlessPlayer, checkEndlessSpecFile, endlessAssetsDir, SINGLE_FILE_WARN_BYTES } from "../src/endless/build.js";
import { buildEndlessDemo } from "../src/endless/demo.js";
import { parseSectionsArg, sectionsFromReference, buildEndlessPlanYaml } from "../src/endless/plan.js";

/**
 * M10 endless player tests (docs/design/endless-player.md "Verification bar").
 *
 * IMPORTANT: the decision-core imports above come straight from
 * `packages/cli/assets/endless/player.js` — the SAME FILE the emitted
 * HTML loads in the browser. There is no second, TS-typed copy of the
 * decision logic; this file is the architecture's whole point (see the
 * file's own header comment).
 */

function makeSpec(overrides: Record<string, unknown> = {}) {
  return {
    name: "t",
    bpm: 120,
    sig: "4/4",
    seed: 0,
    crossfadeMs: 80,
    layers: [
      { id: "drums", gainDb: 0 },
      { id: "bass", gainDb: 0 },
      { id: "pads", gainDb: -3, fluctuate: { filterHz: [800, 8000] } },
    ],
    sections: [
      {
        id: "intro",
        bars: 2,
        pools: { drums: ["d1.wav", "d2.wav"], bass: ["b1.wav"], pads: ["p1.wav", "p2.wav", "p3.wav"] },
        layerMuteProbability: 0,
      },
      {
        id: "drop",
        bars: 2,
        pools: { drums: ["d3.wav", "d4.wav", "d5.wav"], bass: ["b2.wav"], pads: ["p4.wav"] },
        layerMuteProbability: 0.5,
      },
    ],
    transitions: {
      intro: [{ to: "drop", weight: 3 }],
      drop: [{ to: "drop", weight: 1 }, { to: "intro", weight: 3 }],
    },
    rules: { noRepeatVariant: 2, maxConsecutive: 2, protectedLayers: ["bass"] },
    fluctuation: { gainWalkDb: 1.5 },
    ...overrides,
  };
}

describe("player.js PRNG", () => {
  it("is a pure function of its state (same input -> same output, always)", () => {
    const a = nextRandom(seedToRngState(42));
    const b = nextRandom(seedToRngState(42));
    expect(a).toEqual(b);
  });

  it("produces values in [0, 1)", () => {
    let s = seedToRngState(1);
    for (let i = 0; i < 1000; i++) {
      const r = nextRandom(s);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(1);
      s = r.state;
    }
  });
});

describe("player.js pickNextSection — weight distribution", () => {
  it("a 3:1 weighted edge pair lands close to 75%/25% over 10k draws", () => {
    const spec = makeSpec({
      transitions: { hub: [{ to: "a", weight: 3 }, { to: "b", weight: 1 }] },
      rules: { noRepeatVariant: 2, maxConsecutive: 1000, protectedLayers: [] },
    });
    let rngState = seedToRngState(42);
    const counts: Record<string, number> = { a: 0, b: 0 };
    for (let i = 0; i < 10000; i++) {
      const state = { rngState, currentSectionId: "hub", sectionHistory: ["hub"], variantHistory: {}, fluctuation: {} };
      const picked = pickNextSection(spec, state);
      counts[picked.sectionId] = (counts[picked.sectionId] ?? 0) + 1;
      rngState = picked.rngState;
    }
    const ratio = counts.a! / (counts.a! + counts.b!);
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(0.8);
  });

  it("the entry pick (currentSectionId null) always chooses spec.sections[0], no randomness consumed", () => {
    const spec = makeSpec();
    const rngState = seedToRngState(999);
    const state = { rngState, currentSectionId: null, sectionHistory: [], variantHistory: {}, fluctuation: {} };
    const picked = pickNextSection(spec, state);
    expect(picked.sectionId).toBe("intro");
    expect(picked.rngState).toBe(rngState);
  });
});

describe("player.js pickNextSection — maxConsecutive", () => {
  it("never lets a section repeat more than rules.maxConsecutive times in a row", () => {
    const spec = makeSpec({
      transitions: { drop: [{ to: "drop", weight: 100 }, { to: "intro", weight: 1 }], intro: [{ to: "drop", weight: 1 }] },
      rules: { noRepeatVariant: 2, maxConsecutive: 2, protectedLayers: [] },
    });
    let state = {
      rngState: seedToRngState(3),
      currentSectionId: "drop",
      sectionHistory: ["drop"],
      variantHistory: {},
      fluctuation: {},
    };
    let curRun = 1;
    let maxRun = 1;
    let prev = "drop";
    for (let i = 0; i < 3000; i++) {
      const picked = pickNextSection(spec, state);
      curRun = picked.sectionId === prev ? curRun + 1 : 1;
      maxRun = Math.max(maxRun, curRun);
      prev = picked.sectionId;
      state = {
        ...state,
        currentSectionId: picked.sectionId,
        sectionHistory: [...state.sectionHistory, picked.sectionId].slice(-20),
        rngState: picked.rngState,
      };
    }
    expect(maxRun).toBeLessThanOrEqual(2);
  });

  it("a dead-end section (no outgoing edges) self-loops instead of throwing", () => {
    const spec = makeSpec({ transitions: {}, rules: { noRepeatVariant: 2, maxConsecutive: 1, protectedLayers: [] } });
    const state = {
      rngState: seedToRngState(1),
      currentSectionId: "intro",
      sectionHistory: ["intro"],
      variantHistory: {},
      fluctuation: {},
    };
    const picked = pickNextSection(spec, state);
    expect(picked.sectionId).toBe("intro");
  });
});

describe("player.js pickVariant — noRepeatVariant", () => {
  it("never returns an excluded (recently-picked) index when the pool is large enough", () => {
    const spec = makeSpec();
    (spec.sections[0] as any).pools.drums = ["d0", "d1", "d2", "d3"];
    spec.rules.noRepeatVariant = 2;
    let rngState = seedToRngState(7);
    for (let i = 0; i < 500; i++) {
      const state = {
        rngState,
        currentSectionId: null,
        sectionHistory: [],
        variantHistory: { intro: { drums: [0, 1] } },
        fluctuation: {},
      };
      const r = pickVariant(spec, state, "intro", "drums");
      expect([2, 3]).toContain(r.index);
      rngState = r.rngState;
    }
  });

  it("falls back to the full pool when noRepeatVariant would exclude every candidate", () => {
    const spec = makeSpec();
    (spec.sections[0] as any).pools.bass = ["only-one.wav"];
    spec.rules.noRepeatVariant = 2;
    const state = {
      rngState: seedToRngState(2),
      currentSectionId: null,
      sectionHistory: [],
      variantHistory: { intro: { bass: [0] } },
      fluctuation: {},
    };
    const r = pickVariant(spec, state, "intro", "bass");
    expect(r.index).toBe(0); // only option, exclusion dropped rather than deadlocking
  });
});

describe("player.js rollMutes — protectedLayers", () => {
  it("never mutes a protected layer, even at layerMuteProbability=0.99", () => {
    const spec = makeSpec();
    (spec.sections[1] as any).layerMuteProbability = 0.99;
    spec.rules.protectedLayers = ["bass"];
    let rngState = seedToRngState(11);
    for (let i = 0; i < 3000; i++) {
      const state = { rngState, currentSectionId: null, sectionHistory: [], variantHistory: {}, fluctuation: {} };
      const r = rollMutes(spec, state, "drop");
      expect(r.muted).not.toContain("bass");
      rngState = r.rngState;
    }
  });

  it("NEGATIVE CONTROL: an unprotected layer at probability 1 IS muted (the roller isn't a no-op)", () => {
    const spec = makeSpec();
    (spec.sections[1] as any).layerMuteProbability = 1;
    spec.rules.protectedLayers = ["bass"];
    const state = { rngState: seedToRngState(4), currentSectionId: null, sectionHistory: [], variantHistory: {}, fluctuation: {} };
    const r = rollMutes(spec, state, "drop");
    expect(r.muted).toContain("drums");
    expect(r.muted).toContain("pads");
  });
});

describe("player.js fluctuation walk — bounded", () => {
  it("boundedRandomWalkStep never leaves [min, max] over 100k steps, even from a boundary start", () => {
    let value = 1.5;
    let rngState = seedToRngState(5);
    for (let i = 0; i < 100000; i++) {
      const r = boundedRandomWalkStep(value, -1.5, 1.5, rngState, 0.05, 4);
      value = r.value;
      rngState = r.state;
      expect(value).toBeGreaterThanOrEqual(-1.5);
      expect(value).toBeLessThanOrEqual(1.5);
    }
  });

  it("stepFluctuation keeps every layer's gain within +-gainWalkDb and filterHz within its declared range", () => {
    const spec = makeSpec({ fluctuation: { gainWalkDb: 2 } });
    let state = createInitialState(spec as any, 77);
    for (let i = 0; i < 5000; i++) {
      const { fluctuation, state: rngState } = stepFluctuation(spec, state, 0.1);
      state = { ...state, fluctuation, rngState };
      expect(fluctuation.drums.gainOffsetDb).toBeGreaterThanOrEqual(-2);
      expect(fluctuation.drums.gainOffsetDb).toBeLessThanOrEqual(2);
      expect(fluctuation.pads.filterHz).toBeGreaterThanOrEqual(800);
      expect(fluctuation.pads.filterHz).toBeLessThanOrEqual(8000);
      expect(fluctuation.bass.filterHz).toBeNull();
    }
  });
});

describe("player.js determinism", () => {
  it("same seed -> byte-identical decision sequence", () => {
    const spec = makeSpec();
    function run() {
      let state = createInitialState(spec as any, 12345);
      const trace: unknown[] = [];
      for (let i = 0; i < 60; i++) {
        const { state: next, decision } = advanceToNextSection(spec, state);
        state = next;
        trace.push(decision);
        const f = stepFluctuation(spec, state, 0.5);
        state = { ...state, fluctuation: f.fluctuation, rngState: f.state };
        trace.push(f.fluctuation);
      }
      return trace;
    }
    expect(run()).toEqual(run());
  });

  it("different seeds diverge (sanity: it's not silently constant)", () => {
    const spec = makeSpec();
    function run(seed: number) {
      let state = createInitialState(spec as any, seed);
      const trace: string[] = [];
      for (let i = 0; i < 30; i++) {
        const { state: next, decision } = advanceToNextSection(spec, state);
        state = next;
        trace.push(decision.sectionId + JSON.stringify(decision.variants));
      }
      return trace.join("|");
    }
    expect(run(1)).not.toBe(run(2));
  });

  it("sectionDurationSeconds matches bars*4*60/bpm (4/4, v1)", () => {
    const spec = makeSpec({ bpm: 128 });
    expect(sectionDurationSeconds(spec, spec.sections[0])).toBeCloseTo((2 * 4 * 60) / 128, 6);
  });
});

// ---------------------------------------------------------------------------
// WAV read/write (pure RIFF chunk math)
// ---------------------------------------------------------------------------

describe("wav.ts", () => {
  it("round-trips a written WAV's duration exactly", () => {
    const sampleRate = 44100;
    const durationSeconds = 2.5;
    const samples = new Int16Array(Math.round(sampleRate * durationSeconds));
    const buf = writeWavPcm16(samples, sampleRate, 1);
    const info = parseWavHeader(buf);
    expect(info.sampleRate).toBe(sampleRate);
    expect(info.numChannels).toBe(1);
    expect(info.bitsPerSample).toBe(16);
    expect(info.durationSeconds).toBeCloseTo(durationSeconds, 6);
  });

  it("rejects a non-WAV file with a clear message", () => {
    const notWav = Buffer.from("this is definitely not a wav file, just text");
    expect(() => parseWavHeader(notWav)).toThrow(/not a WAV file/);
  });

  it("expectedLoopDurationSeconds matches bars*4*60/bpm", () => {
    expect(expectedLoopDurationSeconds(8, 140)).toBeCloseTo((8 * 4 * 60) / 140, 9);
  });
});

// ---------------------------------------------------------------------------
// endless plan
// ---------------------------------------------------------------------------

describe("plan.ts", () => {
  it("parseSectionsArg parses 'id:bars,...'", () => {
    expect(parseSectionsArg("intro:8,drop:16")).toEqual([
      { id: "intro", bars: 8 },
      { id: "drop", bars: 16 },
    ]);
  });

  it("parseSectionsArg rejects a malformed entry", () => {
    expect(() => parseSectionsArg("intro:eight")).toThrow();
  });

  it("sectionsFromReference converts start_bar/end_bar into bar counts", () => {
    const sections = sectionsFromReference([
      { name: "Intro", start_bar: 1, end_bar: 8 },
      { name: "Drop 1", start_bar: 9, end_bar: 24 },
    ]);
    expect(sections).toEqual([
      { id: "intro", bars: 8 },
      { id: "drop-1", bars: 16 },
    ]);
  });

  it("buildEndlessPlanYaml emits a scaffold with empty pools and a reachable transition loop", () => {
    const text = buildEndlessPlanYaml({ name: "my-song", bpm: 140, sections: [{ id: "intro", bars: 8 }, { id: "drop", bars: 16 }] });
    expect(text).toContain("drums: []");
    expect(text).toContain("bpm: 140");
    expect(text).toContain("intro: [{to: drop, weight: 1}]");
    expect(text).toContain("drop: [{to: intro, weight: 1}]");
  });
});

// ---------------------------------------------------------------------------
// endless build — validation + emission (real tmp files on disk)
// ---------------------------------------------------------------------------

function wavBytesFor(durationSeconds: number, sampleRate = 44100): Buffer {
  const samples = new Int16Array(Math.round(sampleRate * durationSeconds));
  return writeWavPcm16(samples, sampleRate, 1);
}

async function writeTinySpecProject(dir: string, opts: { badDuration?: boolean; skipFile?: string } = {}) {
  await mkdir(join(dir, "audio"), { recursive: true });
  const bpm = 120;
  const bars = 1; // 1 bar @ 120bpm = 2s
  const correctSeconds = expectedLoopDurationSeconds(bars, bpm);
  const files: Record<string, number> = {
    "audio/intro-drums-a.wav": correctSeconds,
    "audio/intro-bass-a.wav": correctSeconds,
    "audio/drop-drums-a.wav": opts.badDuration ? correctSeconds + 0.2 : correctSeconds,
    "audio/drop-bass-a.wav": correctSeconds,
  };
  for (const [file, seconds] of Object.entries(files)) {
    if (file === opts.skipFile) continue;
    await writeFile(join(dir, file), wavBytesFor(seconds));
  }
  const spec = `
name: tiny
bpm: ${bpm}
sig: 4/4
seed: 1
layers:
  - {id: drums, gainDb: 0}
  - {id: bass, gainDb: 0}
sections:
  - id: intro
    bars: ${bars}
    pools:
      drums: [audio/intro-drums-a.wav]
      bass: [audio/intro-bass-a.wav]
  - id: drop
    bars: ${bars}
    pools:
      drums: [audio/drop-drums-a.wav]
      bass: [audio/drop-bass-a.wav]
transitions:
  intro: [{to: drop, weight: 1}]
  drop: [{to: intro, weight: 1}]
rules:
  protectedLayers: [bass]
`;
  const specPath = join(dir, "endless.yaml");
  await writeFile(specPath, spec, "utf8");
  return specPath;
}

const cleanupDirs: string[] = [];
afterAll(async () => {
  await Promise.all(cleanupDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

describe("endless build — validation failures, each loudly named", () => {
  it("missing audio file", async () => {
    const dir = await tmp("awh-endless-missing-");
    const specPath = await writeTinySpecProject(dir, { skipFile: "audio/drop-drums-a.wav" });
    await expect(buildEndlessPlayer(specPath, join(dir, "out"))).rejects.toThrow(
      /missing audio file "audio\/drop-drums-a\.wav"/,
    );
  });

  it("wrong duration (off by 200ms, over the 25ms tolerance)", async () => {
    const dir = await tmp("awh-endless-baddur-");
    const specPath = await writeTinySpecProject(dir, { badDuration: true });
    await expect(buildEndlessPlayer(specPath, join(dir, "out"))).rejects.toThrow(
      /does not match 1 bar\(s\) @ 120 BPM/,
    );
  });

  it("empty pool", async () => {
    const dir = await tmp("awh-endless-emptypool-");
    await mkdir(join(dir, "audio"), { recursive: true });
    await writeFile(join(dir, "audio", "a.wav"), wavBytesFor(2));
    await writeFile(
      join(dir, "endless.yaml"),
      `
name: t
bpm: 120
layers:
  - {id: drums, gainDb: 0}
  - {id: pads, gainDb: 0}
sections:
  - id: a
    bars: 1
    pools: { drums: [audio/a.wav], pads: [] }
`,
      "utf8",
    );
    await expect(buildEndlessPlayer(join(dir, "endless.yaml"), join(dir, "out"))).rejects.toThrow(
      /layer "pads": pool is empty/,
    );
  });

  it("NEGATIVE CONTROL: unreachable section is rejected, not silently unreachable", async () => {
    const dir = await tmp("awh-endless-unreachable-");
    await mkdir(join(dir, "audio"), { recursive: true });
    for (const f of ["intro.wav", "drop.wav", "island.wav"]) {
      await writeFile(join(dir, "audio", f), wavBytesFor(2));
    }
    await writeFile(
      join(dir, "endless.yaml"),
      `
name: t
bpm: 120
layers:
  - {id: drums, gainDb: 0}
sections:
  - id: intro
    bars: 1
    pools: { drums: [audio/intro.wav] }
  - id: drop
    bars: 1
    pools: { drums: [audio/drop.wav] }
  - id: island
    bars: 1
    pools: { drums: [audio/island.wav] }
transitions:
  intro: [{to: drop, weight: 1}]
  drop: [{to: intro, weight: 1}]
`,
      "utf8",
    );
    await expect(buildEndlessPlayer(join(dir, "endless.yaml"), join(dir, "out"))).rejects.toThrow(
      /"island" is unreachable/,
    );
  });

  it("writes NOTHING to the output dir when validation fails (no partial output)", async () => {
    const dir = await tmp("awh-endless-nopartial-");
    const specPath = await writeTinySpecProject(dir, { skipFile: "audio/drop-drums-a.wav" });
    const outDir = join(dir, "out");
    await expect(buildEndlessPlayer(specPath, outDir)).rejects.toThrow();
    const { existsSync } = await import("node:fs");
    expect(existsSync(outDir)).toBe(false);
  });
});

describe("endless build — happy path emission", () => {
  it("emits index.html, player.js, audio/, and endless-README.md", async () => {
    const dir = await tmp("awh-endless-happy-");
    const specPath = await writeTinySpecProject(dir);
    const result = await buildEndlessPlayer(specPath, join(dir, "out"));
    const names = result.files.map((f) => f.split("/").pop());
    expect(names).toContain("index.html");
    expect(names).toContain("player.js");
    expect(names).toContain("endless-README.md");
    const html = await readFile(join(dir, "out", "index.html"), "utf8");
    expect(html).toContain("audio/intro-drums-a.wav");
    const playerJs = await readFile(join(dir, "out", "player.js"), "utf8");
    const assetPlayerJs = await readFile(join(endlessAssetsDir(), "player.js"), "utf8");
    expect(playerJs).toBe(assetPlayerJs); // literally the same file, not a re-derived copy
  });

  it("--single-file inlines player.js and every audio file, zero external src/href references", async () => {
    const dir = await tmp("awh-endless-singlefile-");
    const specPath = await writeTinySpecProject(dir);
    const result = await buildEndlessPlayer(specPath, join(dir, "out"), { singleFile: true });
    expect(result.files).toHaveLength(2); // index.html + endless-README.md only
    const html = await readFile(join(dir, "out", "index.html"), "utf8");
    const externalRefs = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']*)["']/g)]
      .map((m) => m[1]!)
      .filter((v) => v !== "" && !v.startsWith("#") && !v.startsWith("data:"));
    expect(externalRefs).toEqual([]);
    expect(html).toContain("data:audio/wav;base64,");
    expect(result.singleFileBytes).toBeGreaterThan(0);
    expect(result.singleFileBytes!).toBeLessThan(SINGLE_FILE_WARN_BYTES); // this tiny fixture is well under the guideline
  });
});

// ---------------------------------------------------------------------------
// endless demo — synthesizes + builds in one step
// ---------------------------------------------------------------------------

describe("endless demo", () => {
  it("produces a listenable folder that also passes build validation (same build path)", async () => {
    const dir = await tmp("awh-endless-demo-");
    const outDir = join(dir, "demo");
    const result = await buildEndlessDemo(outDir);
    const names = result.files.map((f) => f.split("/").pop());
    expect(names).toContain("index.html");
    expect(names).toContain("player.js");
    expect(names).toContain("endless.yaml");
    const wavFiles = result.files.filter((f) => f.endsWith(".wav"));
    expect(wavFiles.length).toBeGreaterThanOrEqual(3 * 2 + 3 * 3); // 3 layers x (2 intro + 3 drop variants)
    // Every emitted WAV is real, parseable, non-silent audio.
    for (const f of wavFiles.slice(0, 3)) {
      const buf = await readFile(f);
      const info = parseWavHeader(buf);
      expect(info.sampleRate).toBe(44100);
      const samples = new Int16Array(buf.buffer, buf.byteOffset + 44, (buf.length - 44) / 2);
      const hasSignal = Array.from(samples.slice(0, 5000)).some((s) => Math.abs(s) > 50);
      expect(hasSignal).toBe(true);
    }
    // checkEndlessSpecFile again directly on the emitted spec: zero problems.
    const { problems } = await checkEndlessSpecFile(join(outDir, "endless.yaml"));
    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Playwright browser smoke (stretch goal)
// ---------------------------------------------------------------------------

function serveDir(dir: string): Promise<{ server: Server; port: number }> {
  const mime: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".wav": "audio/wav",
    ".md": "text/plain",
    ".json": "application/json",
  };
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]!);
      const rel = urlPath === "/" ? "/index.html" : urlPath;
      readFile(join(dir, rel))
        .then((data) => {
          res.writeHead(200, { "content-type": mime[extname(rel)] ?? "application/octet-stream" });
          res.end(data);
        })
        .catch(() => {
          res.writeHead(404);
          res.end();
        });
    });
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolvePromise({ server, port });
    });
  });
}

describe("browser smoke (Playwright, stretch goal)", () => {
  it("loads the demo page and the scheduler's debug state advances over time", async () => {
    let chromium: typeof import("playwright-core").chromium;
    try {
      ({ chromium } = await import("playwright-core"));
    } catch {
      console.warn("SKIPPED: playwright-core not installed");
      return;
    }
    const dir = await tmp("awh-endless-pw-");
    await buildEndlessDemo(dir);
    const { server, port } = await serveDir(dir);
    // No hardcoded executablePath: that only ever resolves inside the one
    // build environment that happened to have Chromium pre-installed there.
    // Let Playwright resolve its own normally-installed browser (`npx
    // playwright install chromium`); skip like the import guard above if
    // none is found, so this stays a real (not machine-specific) test.
    let browser;
    try {
      browser = await chromium.launch();
    } catch {
      console.warn("SKIPPED: no Chromium install found for playwright-core (npx playwright install chromium)");
      server.close();
      return;
    }
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.click("#endless-play");
      await page.waitForFunction(() => (window as any).__endlessEngine?.getDebugState().playing === true, {
        timeout: 10000,
      });
      const state1 = await page.evaluate(() => (window as any).__endlessEngine.getDebugState());
      await page.waitForTimeout(3000);
      const state2 = await page.evaluate(() => (window as any).__endlessEngine.getDebugState());
      expect(state2.elapsedSeconds).toBeGreaterThan(state1.elapsedSeconds);
      expect(state2.currentSection).toBeTruthy();
      expect(Array.isArray(state2.sectionHistory)).toBe(true);
      expect(state2.sectionHistory.length).toBeGreaterThanOrEqual(state1.sectionHistory.length);
    } finally {
      await browser?.close();
      server.close();
    }
  }, 30000);
});
