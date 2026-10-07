import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, utimes } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { analysisPythonPath, hasAnalysisPython } from "./analysis-venv.js";
import { analysisPython } from "../src/analysis-python.js";
import {
  computeNormalizationStats,
  cosineSimilarity,
  expectedClapModelLabel,
  indexHasClapEmbeddings,
  isPitchTagCandidate,
  loadSamplesIndex,
  makePythonClapEmbedder,
  makePythonClapTextEmbedder,
  makePythonPitchTagger,
  makePythonScanner,
  normalizeVector,
  noteNameToHz,
  pathTokens,
  pitchDisplayNote,
  planIndexUpdate,
  rankSimilar,
  rankSimilarSemantic,
  resolveReferenceClapVector,
  resolveReferenceVector,
  resolveSamplesIndexPath,
  runEmbed,
  runIndex,
  runPitchTag,
  saveSamplesIndex,
  scanFilesChunked,
  searchIndex,
  searchSemantic,
  suggestRelaxations,
  summarizeIndex,
  walkSampleFiles,
  PITCH_ANALYSIS_VERSION,
  type ClapEmbedFn,
  type ClapEmbedRecord,
  type PitchInfo,
  type PitchTagFn,
  type RawPitchRecord,
  type SamplesIndexFile,
  type ScanRecord,
  type ScannerFn,
} from "../src/samples.js";
import { CLI_DIST, hasBuiltCli, writeWavMono16 } from "./helpers.js";

/**
 * Sample-library tests (docs/design/sample-library.md's verification
 * bar), in two tiers:
 *  - Fake-scanner tests (fast, no python) for the index/prune/search
 *    machinery, which only needs deterministic feature records, not real
 *    audio analysis.
 *  - Real-scanner tests (spawn `python -m awh_analysis samplescan` against
 *    the repo's .venv) for the negative-control similarity
 *    ranking, which needs real MFCC/spectral features to be meaningful.
 *
 * Every test sets AWH_SAMPLES_INDEX to a tmp path and never writes to the
 * real ~/.awh (docs/design/sample-library.md: "Never committed... nothing
 * under library/ or knowledge/").
 */

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "awh-samples-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function fakeScanRecord(path: string, overrides: Partial<ScanRecord> = {}): ScanRecord {
  return {
    path,
    unreadable: false,
    error: null,
    duration_s: 2.0,
    channels: 1,
    sample_rate: 44100,
    rms_db: -12,
    peak_db: -3,
    onset_count: 4,
    onset_density_per_s: 2,
    type_guess: "loop",
    type_guess_basis: "fake",
    bpm: 120,
    bpm_confidence: 0.9,
    bpm_runner_up: null,
    spectral_centroid_hz: 1000,
    spectral_rolloff_hz: 3000,
    spectral_flatness: 0.2,
    mfcc_means: Array.from({ length: 13 }, () => 0),
    band_energy: { low: 0.6, mid: 0.3, high: 0.1 },
    dominant_band: "low",
    similarity_vector: [...Array.from({ length: 13 }, () => 0), 1000, 3000, 0.2, 0.6, 0.3, 0.1],
    low_band_hz: 120,
    high_band_hz: 2000,
    ...overrides,
  };
}

/** A trivially fake scanner: no real audio decoding, just synthesizes a
 * deterministic record per file (path-derived so tests can distinguish
 * files) and counts invocations for chunk-batching assertions. */
function fakeScannerWithCallCount(): { scanner: ScannerFn; calls: string[][] } {
  const calls: string[][] = [];
  const scanner: ScannerFn = async (files) => {
    calls.push(files);
    return files.map((f) => fakeScanRecord(f));
  };
  return { scanner, calls };
}

async function touchFile(path: string, content = "x"): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

// ---------------------------------------------------------------------------
// pathTokens
// ---------------------------------------------------------------------------

describe("pathTokens", () => {
  it("normalizes folder + filename words, lowercased, split on punctuation", () => {
    const tokens = pathTokens("/packs/Amen_Break_170.wav");
    expect(tokens).toEqual(expect.arrayContaining(["packs", "amen", "break", "170", "wav"]));
  });
});

// ---------------------------------------------------------------------------
// walkSampleFiles + missing dir
// ---------------------------------------------------------------------------

describe("walkSampleFiles", () => {
  it("finds wav/aiff/flac/mp3 recursively, skips dotfiles and other extensions", async () => {
    await touchFile(join(tmpDir, "a.wav"));
    await touchFile(join(tmpDir, "sub", "b.aiff"));
    await touchFile(join(tmpDir, "sub", "c.flac"));
    await touchFile(join(tmpDir, "sub", "d.mp3"));
    await touchFile(join(tmpDir, "notes.txt"));
    await touchFile(join(tmpDir, ".hidden", "e.wav"));

    const files = await walkSampleFiles(tmpDir);
    expect(files.length).toBe(4);
    expect(files.some((f) => f.endsWith("a.wav"))).toBe(true);
    expect(files.some((f) => f.endsWith("b.aiff"))).toBe(true);
    expect(files.some((f) => f.endsWith("c.flac"))).toBe(true);
    expect(files.some((f) => f.endsWith("d.mp3"))).toBe(true);
    expect(files.some((f) => f.endsWith("notes.txt"))).toBe(false);
    expect(files.some((f) => f.includes(".hidden"))).toBe(false);
  });

  it("MISSING DIR -> loud error", async () => {
    await expect(walkSampleFiles(join(tmpDir, "does-not-exist"))).rejects.toThrow(
      /not a directory/,
    );
  });
});

// ---------------------------------------------------------------------------
// AWH_SAMPLES_INDEX honored, never the real ~/.awh
// ---------------------------------------------------------------------------

describe("resolveSamplesIndexPath", () => {
  const original = process.env.AWH_SAMPLES_INDEX;
  afterEach(() => {
    if (original === undefined) delete process.env.AWH_SAMPLES_INDEX;
    else process.env.AWH_SAMPLES_INDEX = original;
  });

  it("honors AWH_SAMPLES_INDEX", () => {
    const target = join(tmpDir, "custom-index.json");
    process.env.AWH_SAMPLES_INDEX = target;
    expect(resolveSamplesIndexPath()).toBe(resolve(target));
  });

  it("defaults to ~/.awh/samples-index.json when unset (never a repo-local path)", () => {
    delete process.env.AWH_SAMPLES_INDEX;
    const p = resolveSamplesIndexPath();
    expect(p).toBe(join(homedir(), ".awh", "samples-index.json"));
  });
});

// ---------------------------------------------------------------------------
// runIndex: incremental skip + prune (fake scanner: deterministic, fast)
// ---------------------------------------------------------------------------

describe("runIndex (fake scanner) — incremental + prune", () => {
  it("first run scans everything; second run (untouched) scans 0", async () => {
    const corpus = join(tmpDir, "corpus");
    await touchFile(join(corpus, "a.wav"));
    await touchFile(join(corpus, "sub", "b.wav"));
    const indexPath = join(tmpDir, "index.json");
    const { scanner, calls } = fakeScannerWithCallCount();

    const first = await runIndex([corpus], { rescan: false, indexPath, scanner });
    expect(first.scanned).toBe(2);
    expect(first.unchanged).toBe(0);
    expect(first.pruned).toBe(0);
    expect(calls.length).toBeGreaterThan(0);

    // touch nothing -> second run must scan 0 files (incremental skip)
    const second = await runIndex([corpus], { rescan: false, indexPath, scanner });
    expect(second.scanned).toBe(0);
    expect(second.unchanged).toBe(2);
    expect(second.pruned).toBe(0);
  });

  it("a changed file (new mtime) is rescanned; an unchanged one is not", async () => {
    const corpus = join(tmpDir, "corpus");
    await touchFile(join(corpus, "a.wav"));
    await touchFile(join(corpus, "b.wav"));
    const indexPath = join(tmpDir, "index.json");
    const { scanner } = fakeScannerWithCallCount();

    await runIndex([corpus], { rescan: false, indexPath, scanner });

    const future = new Date(Date.now() + 60_000);
    await utimes(join(corpus, "a.wav"), future, future);

    const second = await runIndex([corpus], { rescan: false, indexPath, scanner });
    expect(second.scanned).toBe(1);
    expect(second.unchanged).toBe(1);
  });

  it("--rescan forces a full re-scan even with nothing changed", async () => {
    const corpus = join(tmpDir, "corpus");
    await touchFile(join(corpus, "a.wav"));
    const indexPath = join(tmpDir, "index.json");
    const { scanner } = fakeScannerWithCallCount();

    await runIndex([corpus], { rescan: false, indexPath, scanner });
    const rescanned = await runIndex([corpus], { rescan: true, indexPath, scanner });
    expect(rescanned.scanned).toBe(1);
    expect(rescanned.unchanged).toBe(0);
  });

  it("a deleted file is PRUNED from the index on the next run", async () => {
    const corpus = join(tmpDir, "corpus");
    await touchFile(join(corpus, "a.wav"));
    await touchFile(join(corpus, "b.wav"));
    const indexPath = join(tmpDir, "index.json");
    const { scanner } = fakeScannerWithCallCount();

    await runIndex([corpus], { rescan: false, indexPath, scanner });
    await rm(join(corpus, "b.wav"));

    const second = await runIndex([corpus], { rescan: false, indexPath, scanner });
    expect(second.pruned).toBe(1);
    expect(Object.keys(second.index.files).some((p) => p.endsWith("b.wav"))).toBe(false);
    expect(Object.keys(second.index.files).some((p) => p.endsWith("a.wav"))).toBe(true);

    // and it's actually persisted to disk, at the AWH_SAMPLES_INDEX path
    const reloaded = await loadSamplesIndex(indexPath);
    expect(Object.keys(reloaded.files).length).toBe(1);
  });

  it("MISSING DIR -> loud error, no partial index written", async () => {
    const indexPath = join(tmpDir, "index.json");
    const { scanner } = fakeScannerWithCallCount();
    await expect(
      runIndex([join(tmpDir, "nope")], { rescan: false, indexPath, scanner }),
    ).rejects.toThrow(/not a directory/);
    expect(existsSync(indexPath)).toBe(false);
  });

  it("batches the scanner calls into chunks, not one call per file", async () => {
    const corpus = join(tmpDir, "corpus");
    for (let i = 0; i < 25; i++) await touchFile(join(corpus, `s${i}.wav`));
    const indexPath = join(tmpDir, "index.json");
    const { scanner, calls } = fakeScannerWithCallCount();

    await runIndex([corpus], { rescan: false, indexPath, scanner, chunkSize: 10 });
    expect(calls.length).toBe(3); // 10 + 10 + 5, never 25 separate calls
    expect(calls[0]!.length).toBe(10);
    expect(calls[2]!.length).toBe(5);
  });
});

describe("planIndexUpdate", () => {
  it("only prunes entries under the CURRENT run's roots", () => {
    const index: SamplesIndexFile = {
      version: 1,
      roots: ["/roots/a", "/roots/b"],
      files: {
        "/roots/a/gone.wav": {
          path: "/roots/a/gone.wav",
          size: 1,
          mtimeMs: 1,
          tokens: [],
          scan: fakeScanRecord("/roots/a/gone.wav"),
        },
        "/roots/b/still-there.wav": {
          path: "/roots/b/still-there.wav",
          size: 1,
          mtimeMs: 1,
          tokens: [],
          scan: fakeScanRecord("/roots/b/still-there.wav"),
        },
      },
    };
    // indexing only /roots/a this run; /roots/b entries must survive even
    // though they're not in currentFiles
    const plan = planIndexUpdate(index, ["/roots/a"], [], { rescan: false });
    expect(plan.toPrune).toEqual(["/roots/a/gone.wav"]);
  });
});

// ---------------------------------------------------------------------------
// search: token/filter matrix + zero-hits relaxations
// ---------------------------------------------------------------------------

function indexFromRecords(records: ScanRecord[]): SamplesIndexFile {
  const files: SamplesIndexFile["files"] = {};
  for (const r of records) {
    files[r.path] = { path: r.path, size: 1, mtimeMs: 1, tokens: pathTokens(r.path), scan: r };
  }
  return { version: 1, roots: [], files };
}

describe("searchIndex", () => {
  const index = indexFromRecords([
    fakeScanRecord("/packs/breaks/Amen_Break_170.wav", {
      type_guess: "loop",
      duration_s: 7.2,
      bpm: 170,
      dominant_band: "high",
    }),
    fakeScanRecord("/packs/breaks/Amen_Break_Slow_136.wav", {
      type_guess: "loop",
      duration_s: 8.4,
      bpm: 136,
      dominant_band: "high",
    }),
    fakeScanRecord("/packs/bass/Deep_Sub_Bass_One_Shot.wav", {
      type_guess: "oneshot",
      duration_s: 0.8,
      bpm: null,
      dominant_band: "low",
    }),
    fakeScanRecord("/packs/broken/corrupt.wav", { unreadable: true }),
  ]);

  it("ALL terms must match by default", () => {
    const hits = searchIndex(index, ["amen", "break"]);
    expect(hits.length).toBe(2);
    const hitsWith170 = searchIndex(index, ["amen", "break", "170"]);
    expect(hitsWith170.length).toBe(1);
    expect(hitsWith170[0]!.path).toContain("Amen_Break_170");
  });

  it("--any relaxes to match-any-term", () => {
    const hits = searchIndex(index, ["amen", "sub"], { any: true });
    expect(hits.length).toBe(3); // both amen breaks + the sub bass
  });

  it("--type filters", () => {
    const hits = searchIndex(index, ["bass"], { type: "oneshot" });
    expect(hits.length).toBe(1);
    expect(hits[0]!.path).toContain("Deep_Sub_Bass");
  });

  it("--min-dur / --max-dur filter", () => {
    const short = searchIndex(index, ["amen"], { maxDurS: 8.0 });
    expect(short.length).toBe(1);
    expect(short[0]!.path).toContain("Amen_Break_170");
  });

  it("--bpm / --bpm-tol filters, excluding null-bpm entries", () => {
    const hits = searchIndex(index, ["amen"], { bpm: 172, bpmTol: 5 });
    expect(hits.length).toBe(1);
    expect(hits[0]!.path).toContain("Amen_Break_170");
  });

  it("--band filters on the dominant band", () => {
    const hits = searchIndex(index, [], { band: "low" });
    expect(hits.length).toBe(1);
    expect(hits[0]!.path).toContain("Deep_Sub_Bass");
  });

  it("unreadable entries never match", () => {
    const hits = searchIndex(index, ["corrupt"]);
    expect(hits.length).toBe(0);
  });

  it("ZERO HITS is a state with relaxation suggestions, not an empty void", () => {
    const hits = searchIndex(index, ["amen", "break", "174"]);
    expect(hits.length).toBe(0);
    const relaxations = suggestRelaxations(index, ["amen", "break", "174"], {});
    expect(relaxations.length).toBeGreaterThan(0);
    // dropping the trailing "174" term should recover the 2 amen breaks
    const dropped = relaxations.find((r) => r.terms.join(" ") === "amen break");
    expect(dropped?.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// similarity math (pure)
// ---------------------------------------------------------------------------

describe("cosine similarity + normalization", () => {
  it("identical vectors -> similarity 1", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it("orthogonal vectors -> similarity 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it("normalization z-scores each dimension, guarding a zero-std column", () => {
    const stats = computeNormalizationStats([
      [1, 5],
      [3, 5],
      [5, 5],
    ]);
    expect(stats.mean[0]).toBeCloseTo(3, 6);
    expect(stats.std[1]).toBe(1); // constant column -> guarded to 1, not 0
    const normalized = normalizeVector([3, 5], stats);
    expect(normalized[0]).toBeCloseTo(0, 6);
    expect(normalized[1]).toBeCloseTo(0, 6); // (5-5)/1
  });

  it("rankSimilar excludes the reference path itself", () => {
    const ref = [1, 0, 0];
    const candidates = [
      {
        path: "/a",
        vector: [1, 0, 0],
        entry: { path: "/a", size: 1, mtimeMs: 1, tokens: [], scan: fakeScanRecord("/a") },
      },
      {
        path: "/b",
        vector: [0, 1, 0],
        entry: { path: "/b", size: 1, mtimeMs: 1, tokens: [], scan: fakeScanRecord("/b") },
      },
    ];
    const ranked = rankSimilar(ref, candidates, "/a");
    expect(ranked.map((h) => h.path)).toEqual(["/b"]);
  });
});

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

describe("summarizeIndex", () => {
  it("counts by type/band and reports duration range", () => {
    const index = indexFromRecords([
      fakeScanRecord("/a.wav", { type_guess: "loop", duration_s: 2, dominant_band: "low" }),
      fakeScanRecord("/b.wav", { type_guess: "oneshot", duration_s: 0.5, dominant_band: "high" }),
      fakeScanRecord("/c.wav", { unreadable: true }),
    ]);
    const stats = summarizeIndex(index);
    expect(stats.totalFiles).toBe(3);
    expect(stats.byType).toEqual({ loop: 1, oneshot: 1, unreadable: 1 });
    expect(stats.byBand).toEqual({ low: 1, mid: 0, high: 1 });
    expect(stats.durationStats).toEqual({ minS: 0.5, maxS: 2, meanS: 1.25 });
  });
});

// ---------------------------------------------------------------------------
// Real python scanner: negative-control similarity ranking + real index
// build. Uses analysis-venv.ts's Python; skipped if there is none so the
// rest of the suite still runs.
// ---------------------------------------------------------------------------

function sineSamples(freq: number, sr: number, durS: number, amp = 0.6): number[] {
  const n = Math.round(durS * sr);
  const out = Array.from({ length: n }, () => 0);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

/** Deterministic PRNG (mulberry32), so no external deps are needed for a fake
 * noise burst in a Node test. */
function noiseSamples(durS: number, sr: number, amp = 0.5, seed = 1): number[] {
  let s = seed >>> 0;
  const rand = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = Math.round(durS * sr);
  const out = Array.from({ length: n }, () => 0);
  for (let i = 0; i < n; i++) {
    const env = Math.exp(-i / sr / 0.03);
    out[i] = amp * env * (rand() * 2 - 1);
  }
  return out;
}

describe.skipIf(!hasAnalysisPython)(
  "integ: real analysis engine — index build + similarity negative control",
  () => {
    const SR = 44100;
    let originalAwhPython: string | undefined;

    beforeEach(() => {
      originalAwhPython = process.env.AWH_PYTHON;
      process.env.AWH_PYTHON = analysisPythonPath();
    });
    afterEach(() => {
      if (originalAwhPython === undefined) delete process.env.AWH_PYTHON;
      else process.env.AWH_PYTHON = originalAwhPython;
    });

    it(
      "indexes a real tmp corpus, then a `similar` query on a sine-bass reference " +
        "ranks a second sine bass above the noise hats, hat last",
      async () => {
        const corpus = join(tmpDir, "corpus");
        await mkdir(corpus, { recursive: true });
        writeWavMono16(join(corpus, "bass1.wav"), sineSamples(80, SR, 0.6), SR);
        writeWavMono16(join(corpus, "bass2.wav"), sineSamples(85, SR, 0.6), SR);
        writeWavMono16(join(corpus, "bass3.wav"), sineSamples(110, SR, 0.7), SR);
        writeWavMono16(join(corpus, "hat1.wav"), noiseSamples(0.12, SR, 0.5, 1), SR);
        writeWavMono16(join(corpus, "hat2.wav"), noiseSamples(0.15, SR, 0.5, 2), SR);

        const indexPath = join(tmpDir, "index.json");
        const { python, cwd } = analysisPython();
        expect(existsSync(cwd)).toBe(true);
        const scanner = makePythonScanner(python, cwd);

        const first = await runIndex([corpus], { rescan: false, indexPath, scanner });
        expect(first.scanned).toBe(5);
        expect(first.unreadable).toBe(0);

        // incremental skip proven on the real engine too
        const second = await runIndex([corpus], { rescan: false, indexPath, scanner });
        expect(second.scanned).toBe(0);
        expect(second.unchanged).toBe(5);

        const index = await loadSamplesIndex(indexPath);
        const bass1Path = join(corpus, "bass1.wav");
        const { vector: refVector, fromIndex } = await resolveReferenceVector(
          index,
          bass1Path,
          scanner,
        );
        expect(fromIndex).toBe(true);

        const candidates = Object.values(index.files)
          .filter((e) => !e.scan.unreadable)
          .map((e) => ({ path: e.path, vector: e.scan.similarity_vector!, entry: e }));
        const ranked = rankSimilar(refVector, candidates, bass1Path);
        expect(ranked.length).toBe(4); // everything except the reference itself

        const rankedNames = ranked.map((h) => h.path.split("/").pop());
        // Negative control: both hats must rank below both other basses,
        // since the reference is more similar to any other sine bass than to
        // a noise burst.
        const bassRanks = rankedNames
          .map((n, i) => (n?.startsWith("bass") ? i : -1))
          .filter((i) => i >= 0);
        const hatRanks = rankedNames
          .map((n, i) => (n?.startsWith("hat") ? i : -1))
          .filter((i) => i >= 0);
        expect(Math.max(...bassRanks)).toBeLessThan(Math.min(...hatRanks));
        // and the very last-ranked sample is a hat
        expect(rankedNames[rankedNames.length - 1]).toMatch(/^hat/);
      },
      30_000,
    );

    it("reference file not in the index is scanned on the fly", async () => {
      const corpus = join(tmpDir, "corpus");
      await mkdir(corpus, { recursive: true });
      writeWavMono16(join(corpus, "bass2.wav"), sineSamples(85, SR, 0.6), SR);

      const indexPath = join(tmpDir, "index.json");
      const { python, cwd } = analysisPython();
      const scanner = makePythonScanner(python, cwd);
      await runIndex([corpus], { rescan: false, indexPath, scanner });

      const index = await loadSamplesIndex(indexPath);
      const outsideRef = join(tmpDir, "not-indexed-bass.wav");
      writeWavMono16(outsideRef, sineSamples(80, SR, 0.6), SR);

      const { fromIndex, vector } = await resolveReferenceVector(index, outsideRef, scanner);
      expect(fromIndex).toBe(false);
      expect(vector.length).toBeGreaterThan(0);
    }, 30_000);
  },
);

// ---------------------------------------------------------------------------
// Semantic search (docs/design/sample-semantic.md), all under
// AWH_CLAP_STUB=1, with the same two-tier split as above:
//  - pure logic (fake embedder, no python) for embed/mismatch/search/rank
//  - real `clapembed.py` subprocess (still AWH_CLAP_STUB=1, so torch never
//    loads) for the end-to-end integration + the negative control, which
//    needs the CLI's own wiring in src/index.ts, not only the samples.ts
//    library functions.
// ---------------------------------------------------------------------------

describe("M11b semantic search — embed/search/similar logic (fake embedder, AWH_CLAP_STUB=1)", () => {
  let originalStub: string | undefined;
  beforeEach(() => {
    originalStub = process.env.AWH_CLAP_STUB;
    process.env.AWH_CLAP_STUB = "1";
  });
  afterEach(() => {
    if (originalStub === undefined) delete process.env.AWH_CLAP_STUB;
    else process.env.AWH_CLAP_STUB = originalStub;
  });

  /** A fake embedder: deterministic per path, no python, but
   * still stamped "stub-v1" so it agrees with `expectedClapModelLabel`
   * under AWH_CLAP_STUB=1 (set above), the same contract the real
   * clapembed.py subprocess honors. */
  function fakeClapEmbedder(dim = 8): { embedder: ClapEmbedFn; calls: string[][] } {
    const calls: string[][] = [];
    const embedder: ClapEmbedFn = async (files) => {
      calls.push(files);
      return files.map((f): ClapEmbedRecord => {
        // deterministic, path-derived pseudo-vector (good enough for pure
        // ranking/incremental-logic tests; the real content-hash property
        // is covered by the real clapembed.py subprocess tests below)
        let seed = 0;
        for (const ch of f) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
        const v = Array.from({ length: dim }, (_, i) => Math.sin(seed + i));
        return { path: f, unreadable: false, error: null, clap: { model: "stub-v1", dim, v } };
      });
    };
    return { embedder, calls };
  }

  it("expectedClapModelLabel honors AWH_CLAP_STUB", () => {
    expect(expectedClapModelLabel("music")).toBe("stub-v1");
    expect(expectedClapModelLabel("general")).toBe("stub-v1");
  });

  it("embed fills the index and is incremental (second run embeds 0)", async () => {
    const corpus = join(tmpDir, "corpus");
    await touchFile(join(corpus, "a.wav"));
    await touchFile(join(corpus, "b.wav"));
    const indexPath = join(tmpDir, "index.json");
    const { scanner } = fakeScannerWithCallCount();
    await runIndex([corpus], { rescan: false, indexPath, scanner });

    const { embedder } = fakeClapEmbedder();
    const first = await runEmbed({ indexPath, model: "music", embedder });
    expect(first.embedded).toBe(2);
    expect(first.neverEmbedded).toBe(2);
    expect(first.stale).toBe(0);
    expect(first.upToDate).toBe(0);
    expect(first.unreadable).toBe(0);
    expect(first.totalCandidates).toBe(2);
    expect(first.modelLabel).toBe("stub-v1");

    const second = await runEmbed({ indexPath, model: "music", embedder });
    expect(second.embedded).toBe(0);
    expect(second.upToDate).toBe(2);
    expect(second.neverEmbedded).toBe(0);

    expect(indexHasClapEmbeddings(second.index, "music")).toBe(true);
  });

  it("embed never calls the embedder for unreadable (scan-failed) entries", async () => {
    const corpus = join(tmpDir, "corpus");
    await touchFile(join(corpus, "good.wav"));
    await touchFile(join(corpus, "bad.wav"));
    const indexPath = join(tmpDir, "index.json");
    const scanner: ScannerFn = async (files) =>
      files.map((f) =>
        f.includes("bad") ? { path: f, unreadable: true, error: "boom" } : fakeScanRecord(f),
      );
    await runIndex([corpus], { rescan: false, indexPath, scanner });

    const { embedder, calls } = fakeClapEmbedder();
    const result = await runEmbed({ indexPath, model: "music", embedder });
    expect(result.totalCandidates).toBe(1); // only the readable file is a candidate
    expect(calls.flat().every((p) => !p.includes("bad"))).toBe(true);
  });

  it("a model change (music -> general) makes every prior vector STALE and re-embeds, reporting counts", async () => {
    const corpus = join(tmpDir, "corpus");
    await touchFile(join(corpus, "a.wav"));
    await touchFile(join(corpus, "b.wav"));
    const indexPath = join(tmpDir, "index.json");
    const { scanner } = fakeScannerWithCallCount();
    await runIndex([corpus], { rescan: false, indexPath, scanner });

    // seed a prior embed under a different model label, simulating a real
    // `embed --model general` run without needing two real model spaces
    // under the stub (which always stamps "stub-v1" regardless of --model).
    const index = await loadSamplesIndex(indexPath);
    for (const entry of Object.values(index.files)) {
      entry.clap = { model: "clap-general-v1", dim: 8, v: Array.from({ length: 8 }, () => 0.1) };
    }
    await saveSamplesIndex(indexPath, index);

    const { embedder } = fakeClapEmbedder();
    const result = await runEmbed({ indexPath, model: "music", embedder });
    expect(result.stale).toBe(2);
    expect(result.neverEmbedded).toBe(0);
    expect(result.embedded).toBe(2);
    expect(result.upToDate).toBe(0);

    const reloaded = await loadSamplesIndex(indexPath);
    for (const entry of Object.values(reloaded.files)) {
      expect(entry.clap!.model).toBe("stub-v1");
    }
  });

  it("zero unembedded files is a STATE (embedded=0, upToDate=totalCandidates), not an error", async () => {
    const corpus = join(tmpDir, "corpus");
    await touchFile(join(corpus, "a.wav"));
    const indexPath = join(tmpDir, "index.json");
    const { scanner } = fakeScannerWithCallCount();
    await runIndex([corpus], { rescan: false, indexPath, scanner });

    const { embedder } = fakeClapEmbedder();
    await runEmbed({ indexPath, model: "music", embedder });
    const again = await runEmbed({ indexPath, model: "music", embedder });
    expect(again.embedded).toBe(0);
    expect(again.upToDate).toBe(1);
  });

  it("indexHasClapEmbeddings is false before embed, true after", async () => {
    const corpus = join(tmpDir, "corpus");
    await touchFile(join(corpus, "a.wav"));
    const indexPath = join(tmpDir, "index.json");
    const { scanner } = fakeScannerWithCallCount();
    await runIndex([corpus], { rescan: false, indexPath, scanner });

    const before = await loadSamplesIndex(indexPath);
    expect(indexHasClapEmbeddings(before, "music")).toBe(false);

    const { embedder } = fakeClapEmbedder();
    const result = await runEmbed({ indexPath, model: "music", embedder });
    expect(indexHasClapEmbeddings(result.index, "music")).toBe(true);
  });

  it("searchSemantic ranks by cosine and composes with filters (filter-first)", () => {
    const index = indexFromRecords([
      fakeScanRecord("/packs/loopA.wav", { type_guess: "loop", duration_s: 4 }),
      fakeScanRecord("/packs/loopB.wav", { type_guess: "loop", duration_s: 4 }),
      fakeScanRecord("/packs/oneshotC.wav", { type_guess: "oneshot", duration_s: 0.3 }),
    ]);
    index.files["/packs/loopA.wav"]!.clap = { model: "stub-v1", dim: 2, v: [1, 0] };
    index.files["/packs/loopB.wav"]!.clap = { model: "stub-v1", dim: 2, v: [0.9, 0.1] };
    index.files["/packs/oneshotC.wav"]!.clap = { model: "stub-v1", dim: 2, v: [1, 0] }; // identical to the query but filtered out

    const query = [1, 0];
    const result = searchSemantic(index, query, "music", { type: "loop" });
    expect(result.hits.length).toBe(2); // oneshotC excluded by --type loop, despite the best score
    expect(result.hits.map((h) => h.path)).toEqual(["/packs/loopA.wav", "/packs/loopB.wav"]);
    expect(result.hits[0]!.score).toBeCloseTo(1, 6); // loopA is an exact-direction match
    expect(result.hits[0]!.score).toBeGreaterThan(result.hits[1]!.score);
    expect(result.notEmbeddedInIndex).toBe(0);
    expect(result.totalReadableInIndex).toBe(3);
  });

  it("searchSemantic's not-embedded footer counts files without a matching-model vector", () => {
    const index = indexFromRecords([
      fakeScanRecord("/packs/embedded.wav"),
      fakeScanRecord("/packs/not-embedded.wav"),
      fakeScanRecord("/packs/other-model.wav"),
    ]);
    index.files["/packs/embedded.wav"]!.clap = { model: "stub-v1", dim: 2, v: [1, 0] };
    index.files["/packs/other-model.wav"]!.clap = { model: "clap-general-v1", dim: 2, v: [1, 0] };

    const result = searchSemantic(index, [1, 0], "music", {});
    expect(result.hits.length).toBe(1);
    expect(result.hits[0]!.path).toBe("/packs/embedded.wav");
    expect(result.notEmbeddedInIndex).toBe(2); // not-embedded.wav + other-model.wav
    expect(result.totalReadableInIndex).toBe(3);
  });

  it("rankSimilarSemantic excludes the reference path and ranks by cosine", () => {
    const ref = [1, 0];
    const candidates = [
      {
        path: "/a",
        vector: { model: "stub-v1", dim: 2, v: [1, 0] },
        entry: indexFromRecords([fakeScanRecord("/a")]).files["/a"]!,
      },
      {
        path: "/b",
        vector: { model: "stub-v1", dim: 2, v: [0, 1] },
        entry: indexFromRecords([fakeScanRecord("/b")]).files["/b"]!,
      },
    ];
    const ranked = rankSimilarSemantic(ref, candidates, "/a");
    expect(ranked.map((h) => h.path)).toEqual(["/b"]);
    expect(ranked[0]!.score).toBeCloseTo(0, 6);
  });
});

describe.skipIf(!hasAnalysisPython)(
  "integ: M11b real clapembed.py stub-mode integration (AWH_CLAP_STUB=1, real subprocess)",
  () => {
    let originalAwhPython: string | undefined;
    let originalStub: string | undefined;

    beforeEach(() => {
      originalAwhPython = process.env.AWH_PYTHON;
      originalStub = process.env.AWH_CLAP_STUB;
      process.env.AWH_PYTHON = analysisPythonPath();
      process.env.AWH_CLAP_STUB = "1";
    });
    afterEach(() => {
      if (originalAwhPython === undefined) delete process.env.AWH_PYTHON;
      else process.env.AWH_PYTHON = originalAwhPython;
      if (originalStub === undefined) delete process.env.AWH_CLAP_STUB;
      else process.env.AWH_CLAP_STUB = originalStub;
    });

    it("embeds real files through the real clapembed subprocess and is incremental", async () => {
      const corpus = join(tmpDir, "corpus");
      // Content doesn't need to be valid audio: the stub embedder
      // hashes raw bytes, it never decodes anything.
      await touchFile(join(corpus, "a.wav"), "content-a");
      await touchFile(join(corpus, "b.wav"), "content-b");
      const indexPath = join(tmpDir, "index.json");
      const { scanner } = fakeScannerWithCallCount();
      await runIndex([corpus], { rescan: false, indexPath, scanner });

      const { python, cwd } = analysisPython();
      const embedder = makePythonClapEmbedder(python, cwd);
      const first = await runEmbed({ indexPath, model: "music", embedder });
      expect(first.embedded).toBe(2);
      expect(first.modelLabel).toBe("stub-v1");

      const second = await runEmbed({ indexPath, model: "music", embedder });
      expect(second.embedded).toBe(0);
      expect(second.upToDate).toBe(2);
    }, 20_000);

    it("similar --semantic ranks a stub-identical (byte-for-byte copy) file first", async () => {
      const corpus = join(tmpDir, "corpus");
      await touchFile(join(corpus, "ref.wav"), "IDENTICAL-BYTES-XYZ");
      await touchFile(join(corpus, "dup.wav"), "IDENTICAL-BYTES-XYZ"); // byte-identical copy
      await touchFile(join(corpus, "other.wav"), "totally-different-content");
      const indexPath = join(tmpDir, "index.json");
      const { scanner } = fakeScannerWithCallCount();
      await runIndex([corpus], { rescan: false, indexPath, scanner });

      const { python, cwd } = analysisPython();
      const embedder = makePythonClapEmbedder(python, cwd);
      await runEmbed({ indexPath, model: "music", embedder });

      const index = await loadSamplesIndex(indexPath);
      const refPath = join(corpus, "ref.wav");
      const { vector: refVector, fromIndex } = await resolveReferenceClapVector(
        index,
        refPath,
        embedder,
        "music",
      );
      expect(fromIndex).toBe(true);

      const readable = Object.values(index.files).filter((e) => !e.scan.unreadable);
      const candidates = readable.map((e) => ({ path: e.path, vector: e.clap!, entry: e }));
      const ranked = rankSimilarSemantic(refVector.v, candidates, refPath);

      expect(ranked[0]!.path).toBe(resolve(join(corpus, "dup.wav")));
      expect(ranked[0]!.score).toBeCloseTo(1, 6);
      expect(ranked[ranked.length - 1]!.path).toBe(resolve(join(corpus, "other.wav")));
    }, 20_000);

    it("text embedding via the real subprocess is deterministic and shaped right", async () => {
      const { python, cwd } = analysisPython();
      const textEmbedder = makePythonClapTextEmbedder(python, cwd);
      const a = await textEmbedder("dusty breakbeat", "music");
      const b = await textEmbedder("dusty breakbeat", "music");
      expect(a.v).toEqual(b.v);
      expect(a.model).toBe("stub-v1");
      expect(a.dim).toBe(a.v.length);
    }, 20_000);

    it.skipIf(!hasBuiltCli)(
      "NEGATIVE CONTROL: `awh samples search --semantic` with ZERO embeddings anywhere in " +
        "the index errors with the embed instruction and NEVER falls back to token search",
      async () => {
        const corpus = join(tmpDir, "corpus");
        await touchFile(join(corpus, "a.wav"));
        const indexPath = join(tmpDir, "index.json");
        const { scanner } = fakeScannerWithCallCount();
        await runIndex([corpus], { rescan: false, indexPath, scanner });
        // deliberately never run `embed`: the index has entries, zero vectors

        const result = spawnSync(
          process.execPath,
          [CLI_DIST, "samples", "search", "--semantic", "four on the floor techno drums"],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              AWH_SAMPLES_INDEX: indexPath,
              AWH_CLAP_STUB: "1",
              AWH_PYTHON: analysisPythonPath(),
            },
          },
        );

        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(/awh samples embed/);
        expect(result.stderr).toMatch(/no samples have CLAP embeddings/);
        // never a silent fallback: no token-search-shaped hit table on stdout
        expect(result.stdout.trim()).toBe("");
      },
    );
  },
);

// ---------------------------------------------------------------------------
// Pitch tagging (kicks/subs -> f0/note, for key-matched search). Same shape
// as the embed/search-semantic pattern above: a separate, opt-in
// enrichment pass, incremental, only over eligible candidates
// (isPitchTagCandidate).
// ---------------------------------------------------------------------------

describe("M11c pitch tagging — index/search logic (fake tagger)", () => {
  /** A candidate record: a one-shot whose energy is low-band-dominated
   * (the eligibility filter's own criteria). */
  function candidateRecord(path: string, overrides: Partial<ScanRecord> = {}): ScanRecord {
    return fakeScanRecord(path, { type_guess: "oneshot", dominant_band: "low", ...overrides });
  }

  function fakePitchRecord(path: string, overrides: Partial<RawPitchRecord> = {}): RawPitchRecord {
    return {
      path,
      unreadable: false,
      error: null,
      pitch_analysis_version: PITCH_ANALYSIS_VERSION,
      state: "voiced",
      f0_hz: 55.0,
      note: { name: "A1", midi: 33, cents: 0 }, // standard notation, as the real Python side stamps it
      voiced_fraction: 0.9,
      confidence: 0.6,
      f0_stability_semitones: 0.1,
      harmonic_dominance: {
        flagged: false,
        harmonic: null,
        ratio_db: null,
        time_s: null,
        fraction_of_voiced_frames: 0,
      },
      ...overrides,
    };
  }

  function fakePitchTagger(): { tagger: PitchTagFn; calls: string[][] } {
    const calls: string[][] = [];
    const tagger: PitchTagFn = async (files) => {
      calls.push(files);
      return files.map((f) => fakePitchRecord(f));
    };
    return { tagger, calls };
  }

  describe("isPitchTagCandidate", () => {
    it("true for a low-band one-shot", () => {
      const index = indexFromRecords([candidateRecord("/a.wav")]);
      expect(isPitchTagCandidate(index.files["/a.wav"]!)).toBe(true);
    });
    it("false for a loop (even low-band)", () => {
      const index = indexFromRecords([
        fakeScanRecord("/a.wav", { type_guess: "loop", dominant_band: "low" }),
      ]);
      expect(isPitchTagCandidate(index.files["/a.wav"]!)).toBe(false);
    });
    it("false for a one-shot NOT low-band (a hat, say)", () => {
      const index = indexFromRecords([
        fakeScanRecord("/a.wav", { type_guess: "oneshot", dominant_band: "high" }),
      ]);
      expect(isPitchTagCandidate(index.files["/a.wav"]!)).toBe(false);
    });
    it("false for an unreadable entry", () => {
      const index = indexFromRecords([{ path: "/a.wav", unreadable: true, error: "boom" }]);
      expect(isPitchTagCandidate(index.files["/a.wav"]!)).toBe(false);
    });
  });

  it("runPitchTag tags only candidates and is incremental (second run tags 0)", async () => {
    const corpus = join(tmpDir, "corpus");
    await touchFile(join(corpus, "kick.wav"));
    await touchFile(join(corpus, "hat.wav"));
    const indexPath = join(tmpDir, "index.json");
    const scanner: ScannerFn = async (files) =>
      files.map((f) =>
        f.includes("kick")
          ? candidateRecord(f)
          : fakeScanRecord(f, { type_guess: "oneshot", dominant_band: "high" }),
      );
    await runIndex([corpus], { rescan: false, indexPath, scanner });

    const { tagger, calls } = fakePitchTagger();
    const first = await runPitchTag({ indexPath, tagger });
    expect(first.tagged).toBe(1);
    expect(first.neverTagged).toBe(1);
    expect(first.stale).toBe(0);
    expect(first.upToDate).toBe(0);
    expect(first.notCandidate).toBe(1); // the hat
    expect(first.totalCandidates).toBe(1);
    expect(calls.flat()).toEqual([join(corpus, "kick.wav")]); // never called for the hat

    const second = await runPitchTag({ indexPath, tagger });
    expect(second.tagged).toBe(0);
    expect(second.upToDate).toBe(1);
  });

  it("re-tags a stale (older PITCH_ANALYSIS_VERSION) entry", async () => {
    const corpus = join(tmpDir, "corpus");
    await touchFile(join(corpus, "kick.wav"));
    const indexPath = join(tmpDir, "index.json");
    const scanner: ScannerFn = async (files) => files.map((f) => candidateRecord(f));
    await runIndex([corpus], { rescan: false, indexPath, scanner });

    const index = await loadSamplesIndex(indexPath);
    const kickPath = join(corpus, "kick.wav");
    index.files[kickPath]!.pitch = {
      analysisVersion: 0, // older than PITCH_ANALYSIS_VERSION
      state: "unvoiced",
      f0Hz: null,
      note: null,
      voicedFraction: 0,
      confidence: 0,
      f0StabilitySemitones: null,
      harmonicDominance: {
        flagged: false,
        harmonic: null,
        ratioDb: null,
        timeS: null,
        fractionOfVoicedFrames: 0,
      },
    };
    await saveSamplesIndex(indexPath, index);

    const { tagger } = fakePitchTagger();
    const result = await runPitchTag({ indexPath, tagger });
    expect(result.stale).toBe(1);
    expect(result.neverTagged).toBe(0);
    expect(result.tagged).toBe(1);

    const reloaded = await loadSamplesIndex(indexPath);
    expect(reloaded.files[kickPath]!.pitch!.state).toBe("voiced"); // overwritten by the re-tag
  });

  it("zero eligible candidates is a STATE (totalCandidates=0), not an error", async () => {
    const corpus = join(tmpDir, "corpus");
    await touchFile(join(corpus, "hat.wav"));
    const indexPath = join(tmpDir, "index.json");
    const scanner: ScannerFn = async (files) =>
      files.map((f) => fakeScanRecord(f, { type_guess: "oneshot", dominant_band: "high" }));
    await runIndex([corpus], { rescan: false, indexPath, scanner });

    const { tagger, calls } = fakePitchTagger();
    const result = await runPitchTag({ indexPath, tagger });
    expect(result.totalCandidates).toBe(0);
    expect(result.tagged).toBe(0);
    expect(calls.length).toBe(0);
  });

  // ---------------------------------------------------------------------
  // Octave-convention correctness. Python's pitch.py stamps `note.name` in
  // scientific notation (C4 = MIDI 60), an octave apart from this
  // codebase's Ableton convention (C3 = MIDI 60, @awh/core's
  // pitchToMidi/midiToPitch). Every note name the user sees or types must
  // use the Ableton convention; the raw Python `name` must never reach a
  // user.
  // ---------------------------------------------------------------------

  it("noteNameToHz parses Ableton-convention names (A3 = 440 Hz, not A4)", () => {
    expect(noteNameToHz("A3")).toBeCloseTo(440, 6);
    expect(noteNameToHz("C3")).toBeCloseTo(261.6255653, 3); // Ableton C3 = middle C = MIDI 60
  });

  it("pitchDisplayNote re-derives the Ableton name from midi, ignoring the raw Python name", () => {
    const info: PitchInfo = {
      analysisVersion: PITCH_ANALYSIS_VERSION,
      state: "voiced",
      f0Hz: 440,
      note: { name: "A4", midi: 69, cents: 0 }, // Python's scientific-notation name, must be ignored
      voicedFraction: 0.9,
      confidence: 0.6,
      f0StabilitySemitones: 0.1,
      harmonicDominance: {
        flagged: false,
        harmonic: null,
        ratioDb: null,
        timeS: null,
        fractionOfVoicedFrames: 0,
      },
    };
    expect(pitchDisplayNote(info)).toBe("A3"); // Ableton convention, not the stored "A4"
  });

  it("pitchDisplayNote returns null when there's no pitch", () => {
    const info: PitchInfo = {
      analysisVersion: PITCH_ANALYSIS_VERSION,
      state: "unvoiced",
      f0Hz: null,
      note: null,
      voicedFraction: 0,
      confidence: 0,
      f0StabilitySemitones: null,
      harmonicDominance: {
        flagged: false,
        harmonic: null,
        ratioDb: null,
        timeS: null,
        fractionOfVoicedFrames: 0,
      },
    };
    expect(pitchDisplayNote(info)).toBeNull();
  });

  // ---------------------------------------------------------------------
  // search --near-note
  // ---------------------------------------------------------------------

  function withPitch(rec: ScanRecord, pitch: PitchInfo): SamplesIndexFile["files"][string] {
    return { path: rec.path, size: 1, mtimeMs: 1, tokens: pathTokens(rec.path), scan: rec, pitch };
  }

  function voicedPitch(f0Hz: number): PitchInfo {
    return {
      analysisVersion: PITCH_ANALYSIS_VERSION,
      state: "voiced",
      f0Hz,
      note: { name: "?", midi: 0, cents: 0 },
      voicedFraction: 0.9,
      confidence: 0.6,
      f0StabilitySemitones: 0.1,
      harmonicDominance: {
        flagged: false,
        harmonic: null,
        ratioDb: null,
        timeS: null,
        fractionOfVoicedFrames: 0,
      },
    };
  }

  it("searchIndex --near-note matches within cents tolerance and excludes untagged/unvoiced entries", () => {
    const targetHz = noteNameToHz("F1"); // this project's own key root, per the real session
    const index: SamplesIndexFile = { version: 1, roots: [], files: {} };
    // exactly on the note
    index.files["/on-note.wav"] = withPitch(candidateRecord("/on-note.wav"), voicedPitch(targetHz));
    // 20 cents sharp — inside the default 50-cent tolerance
    index.files["/close.wav"] = withPitch(
      candidateRecord("/close.wav"),
      voicedPitch(targetHz * 2 ** (20 / 1200)),
    );
    // a full semitone (100 cents) away — outside the default tolerance
    index.files["/far.wav"] = withPitch(
      candidateRecord("/far.wav"),
      voicedPitch(targetHz * 2 ** (100 / 1200)),
    );
    // a candidate that was never tagged
    index.files["/untagged.wav"] = {
      ...indexFromRecords([candidateRecord("/untagged.wav")]).files["/untagged.wav"]!,
    };
    // a tagged-but-unvoiced (broadband) entry sitting numerically at f0Hz=null
    index.files["/broadband.wav"] = withPitch(candidateRecord("/broadband.wav"), {
      ...voicedPitch(targetHz),
      state: "unvoiced",
      f0Hz: null,
    });

    const hits = searchIndex(index, [], { nearNoteHz: targetHz });
    const paths = hits.map((h) => h.path).toSorted();
    expect(paths).toEqual(["/close.wav", "/on-note.wav"]);
  });

  it("suggestRelaxations names untagged eligible candidates when --near-note finds nothing", () => {
    const targetHz = noteNameToHz("F1");
    const index: SamplesIndexFile = { version: 1, roots: [], files: {} };
    index.files["/kick1.wav"] = indexFromRecords([candidateRecord("/kick1.wav")]).files[
      "/kick1.wav"
    ]!;
    index.files["/kick2.wav"] = indexFromRecords([candidateRecord("/kick2.wav")]).files[
      "/kick2.wav"
    ]!;

    const suggestions = suggestRelaxations(index, [], { nearNoteHz: targetHz });
    expect(suggestions.some((s) => s.note.includes("pitch-tag"))).toBe(true);
  });
});

describe.skipIf(!hasAnalysisPython)(
  "integ: M11c real samplepitch.py subprocess integration",
  () => {
    const SR = 44100;
    let originalAwhPython: string | undefined;

    beforeEach(() => {
      originalAwhPython = process.env.AWH_PYTHON;
      process.env.AWH_PYTHON = analysisPythonPath();
    });
    afterEach(() => {
      if (originalAwhPython === undefined) delete process.env.AWH_PYTHON;
      else process.env.AWH_PYTHON = originalAwhPython;
    });

    it("pitch-tags a real tuned low sine as voiced, and real broadband noise as unvoiced", async () => {
      const corpus = join(tmpDir, "corpus");
      mkdirSync(corpus, { recursive: true });
      const tunedPath = join(corpus, "808.wav");
      const noisePath = join(corpus, "kick.wav");
      writeWavMono16(tunedPath, sineSamples(55.0, SR, 0.6), SR);
      writeWavMono16(noisePath, noiseSamples(0.25, SR, 0.6, 3), SR);
      const indexPath = join(tmpDir, "index.json");
      // Force both files pitch-tag-eligible regardless of the real scan
      // heuristics (isPitchTagCandidate: readable + oneshot + low band).
      const scanner: ScannerFn = async (files) =>
        files.map((f) =>
          fakeScanRecord(f, { type_guess: "oneshot", dominant_band: "low", onset_count: 1 }),
        );

      await runIndex([corpus], { rescan: false, indexPath, scanner });

      const { python, cwd } = analysisPython();
      const tagger = makePythonPitchTagger(python, cwd);
      const result = await runPitchTag({ indexPath, tagger });
      expect(result.tagged).toBe(2);

      const reloaded = await loadSamplesIndex(indexPath);
      expect(reloaded.files[tunedPath]!.pitch!.state).toBe("voiced");
      expect(reloaded.files[tunedPath]!.pitch!.f0Hz).not.toBeNull();
      expect(reloaded.files[noisePath]!.pitch!.state).toBe("unvoiced");
      expect(reloaded.files[noisePath]!.pitch!.f0Hz).toBeNull();
    }, 20_000);
  },
);

// keep scanFilesChunked + saveSamplesIndex imports exercised even where the
// higher-level runIndex tests above don't directly assert on them
describe("scanFilesChunked / saveSamplesIndex plumbing", () => {
  it("empty file list never calls the scanner", async () => {
    const { scanner, calls } = fakeScannerWithCallCount();
    const results = await scanFilesChunked([], scanner);
    expect(results).toEqual([]);
    expect(calls.length).toBe(0);
  });

  it("saveSamplesIndex creates parent dirs and round-trips via loadSamplesIndex", async () => {
    const indexPath = join(tmpDir, "nested", "deeper", "index.json");
    const index: SamplesIndexFile = { version: 1, roots: ["/x"], files: {} };
    await saveSamplesIndex(indexPath, index);
    const loaded = await loadSamplesIndex(indexPath);
    expect(loaded.roots).toEqual(["/x"]);
  });
});
