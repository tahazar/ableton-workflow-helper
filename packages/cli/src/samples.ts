/**
 * M11 sample library: local index, text/trait search, and MFCC-based
 * similarity ranking (docs/design/sample-library.md). Split out from
 * src/index.ts (same convention as duck.ts/op.ts) so the index-build,
 * search, and similarity logic is testable without spawning the CLI.
 *
 * The index NEVER lands inside the repo tree — it's machine-local,
 * absolute-path-keyed, and meaningless off-machine (design doc, "The
 * index"). Default location: `~/.awh/samples-index.json`, overridable via
 * `AWH_SAMPLES_INDEX` (tests must always set this to a tmp path).
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Feature record (mirrors analysis/awh_analysis/samplescan.py's JSON output)
// ---------------------------------------------------------------------------

export type TypeGuess = "loop" | "oneshot";
export type Band = "low" | "mid" | "high";

export interface ScanRecord {
  path: string;
  unreadable: boolean;
  error: string | null;
  duration_s?: number;
  channels?: number;
  sample_rate?: number;
  rms_db?: number;
  peak_db?: number;
  onset_count?: number;
  onset_density_per_s?: number;
  type_guess?: TypeGuess;
  type_guess_basis?: string;
  bpm?: number | null;
  bpm_confidence?: number | null;
  bpm_runner_up?: number | null;
  spectral_centroid_hz?: number;
  spectral_rolloff_hz?: number;
  spectral_flatness?: number;
  mfcc_means?: number[];
  band_energy?: { low: number; mid: number; high: number };
  dominant_band?: Band;
  similarity_vector?: number[];
  low_band_hz?: number;
  high_band_hz?: number;
}

// ---------------------------------------------------------------------------
// Index file
// ---------------------------------------------------------------------------

export const SAMPLE_EXTENSIONS = new Set([".wav", ".wave", ".aif", ".aiff", ".flac", ".mp3"]);

export interface SamplesIndexEntry {
  path: string;
  size: number;
  mtimeMs: number;
  tokens: string[];
  scan: ScanRecord;
}

export interface SamplesIndexFile {
  version: 1;
  roots: string[];
  files: Record<string, SamplesIndexEntry>;
}

function emptyIndex(): SamplesIndexFile {
  return { version: 1, roots: [], files: {} };
}

/** `AWH_SAMPLES_INDEX` if set, else `~/.awh/samples-index.json`. NEVER a
 * repo-relative default — the index is machine-local by design. */
export function resolveSamplesIndexPath(): string {
  const override = process.env.AWH_SAMPLES_INDEX;
  if (override && override.trim()) return resolve(override);
  return join(homedir(), ".awh", "samples-index.json");
}

export async function loadSamplesIndex(path: string): Promise<SamplesIndexFile> {
  if (!existsSync(path)) return emptyIndex();
  const raw = await readFile(path, "utf8");
  try {
    const parsed = JSON.parse(raw) as SamplesIndexFile;
    if (!parsed || typeof parsed !== "object" || !parsed.files) return emptyIndex();
    return { version: 1, roots: parsed.roots ?? [], files: parsed.files };
  } catch {
    throw new Error(
      `samples index at ${path} is not valid JSON — delete it and re-run \`awh samples index\``,
    );
  }
}

export async function saveSamplesIndex(path: string, index: SamplesIndexFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(index, null, 2));
}

// ---------------------------------------------------------------------------
// Path tokens (design: "folder names and filename words, normalized")
// ---------------------------------------------------------------------------

export function pathTokens(path: string): string[] {
  const normalized = path.toLowerCase().replace(/\\/g, "/");
  const parts = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  return [...new Set(parts)];
}

// ---------------------------------------------------------------------------
// Directory walk
// ---------------------------------------------------------------------------

export async function walkSampleFiles(dir: string): Promise<string[]> {
  const absDir = resolve(dir);
  if (!existsSync(absDir) || !statSync(absDir).isDirectory()) {
    throw new Error(`"${dir}" is not a directory (resolved: ${absDir}) — check the path`);
  }
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && SAMPLE_EXTENSIONS.has(extname(e.name).toLowerCase())) {
        out.push(full);
      }
    }
  }
  await walk(absDir);
  return out.sort();
}

// ---------------------------------------------------------------------------
// Incremental plan: (path, size, mtime) keying — see design's "The index"
// ---------------------------------------------------------------------------

export interface FileStat {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface IndexUpdatePlan {
  toScan: string[];
  unchanged: string[];
  toPrune: string[];
}

export function planIndexUpdate(
  index: SamplesIndexFile,
  roots: string[],
  currentFiles: FileStat[],
  opts: { rescan: boolean },
): IndexUpdatePlan {
  const currentByPath = new Map(currentFiles.map((f) => [f.path, f]));
  const toScan: string[] = [];
  const unchanged: string[] = [];
  for (const f of currentFiles) {
    const existing = index.files[f.path];
    if (
      opts.rescan ||
      !existing ||
      existing.size !== f.size ||
      existing.mtimeMs !== f.mtimeMs
    ) {
      toScan.push(f.path);
    } else {
      unchanged.push(f.path);
    }
  }
  const absRoots = roots.map((r) => resolve(r));
  const toPrune: string[] = [];
  for (const p of Object.keys(index.files)) {
    if (currentByPath.has(p)) continue;
    // Only prune entries that fall under one of THIS run's roots — an
    // `index` call scoped to one folder must not silently drop entries
    // indexed from other folders in earlier runs.
    if (absRoots.some((r) => p === r || p.startsWith(`${r}/`))) toPrune.push(p);
  }
  return { toScan, unchanged, toPrune };
}

// ---------------------------------------------------------------------------
// Python scanning — batched (design: "one samplescan invocation per chunk")
// ---------------------------------------------------------------------------

export type ScannerFn = (files: string[]) => Promise<ScanRecord[]>;

export const DEFAULT_SCAN_CHUNK_SIZE = 200;

/** Real scanner: spawns `python -m awh_analysis samplescan`, feeding the
 * chunk's file list on stdin and parsing the JSONL stdout. librosa's
 * ~1s import cost is why this is called once per CHUNK, never per file. */
export function makePythonScanner(python: string, cwd: string): ScannerFn {
  return (files) =>
    new Promise<ScanRecord[]>((resolvePromise, reject) => {
      const child = spawn(python, ["-m", "awh_analysis", "samplescan"], { cwd });
      let out = "";
      let err = "";
      child.stdout.on("data", (d: Buffer) => (out += d.toString()));
      child.stderr.on("data", (d: Buffer) => (err += d.toString()));
      child.on("error", (e) =>
        reject(
          new Error(
            `could not run ${python} (${e.message}) — create the venv per docs/dev-loop.md ` +
              "or set AWH_PYTHON",
          ),
        ),
      );
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`samplescan failed: ${err.trim() || out.trim()}`));
          return;
        }
        try {
          const lines = out
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          resolvePromise(lines.map((l) => JSON.parse(l) as ScanRecord));
        } catch (e) {
          reject(
            new Error(
              `could not parse samplescan output: ${(e as Error).message}\n${out.slice(0, 500)}`,
            ),
          );
        }
      });
      child.stdin.write(`${files.join("\n")}\n`);
      child.stdin.end();
    });
}

export async function scanFilesChunked(
  files: string[],
  scanner: ScannerFn,
  opts: { chunkSize?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<ScanRecord[]> {
  const chunkSize = opts.chunkSize ?? DEFAULT_SCAN_CHUNK_SIZE;
  const results: ScanRecord[] = [];
  for (let i = 0; i < files.length; i += chunkSize) {
    const chunk = files.slice(i, i + chunkSize);
    const chunkResults = await scanner(chunk);
    results.push(...chunkResults);
    opts.onProgress?.(results.length, files.length);
  }
  return results;
}

// ---------------------------------------------------------------------------
// index: walk -> plan -> scan -> prune -> save
// ---------------------------------------------------------------------------

export interface IndexRunResult {
  scanned: number;
  unchanged: number;
  pruned: number;
  unreadable: number;
  totalFiles: number;
  index: SamplesIndexFile;
}

export async function runIndex(
  dirs: string[],
  opts: {
    rescan: boolean;
    indexPath: string;
    scanner: ScannerFn;
    chunkSize?: number;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<IndexRunResult> {
  const absDirs = dirs.map((d) => resolve(d));
  // Validate every dir up front — a missing dir is a loud error, no
  // partial index writes for the dirs that did exist.
  for (let i = 0; i < absDirs.length; i++) {
    if (!existsSync(absDirs[i]!) || !statSync(absDirs[i]!).isDirectory()) {
      throw new Error(`"${dirs[i]}" is not a directory (resolved: ${absDirs[i]}) — check the path`);
    }
  }

  const fileLists = await Promise.all(absDirs.map((d) => walkSampleFiles(d)));
  const allFiles = [...new Set(fileLists.flat())].sort();
  const stats: FileStat[] = allFiles.map((p) => {
    const st = statSync(p);
    return { path: p, size: st.size, mtimeMs: st.mtimeMs };
  });

  const index = await loadSamplesIndex(opts.indexPath);
  for (const d of absDirs) if (!index.roots.includes(d)) index.roots.push(d);

  const plan = planIndexUpdate(index, absDirs, stats, { rescan: opts.rescan });

  const scanned = await scanFilesChunked(plan.toScan, opts.scanner, {
    chunkSize: opts.chunkSize,
    onProgress: opts.onProgress,
  });

  const statByPath = new Map(stats.map((s) => [s.path, s]));
  for (const rec of scanned) {
    const st = statByPath.get(rec.path);
    if (!st) continue;
    index.files[rec.path] = {
      path: rec.path,
      size: st.size,
      mtimeMs: st.mtimeMs,
      tokens: pathTokens(rec.path),
      scan: rec,
    };
  }
  for (const p of plan.toPrune) delete index.files[p];

  await saveSamplesIndex(opts.indexPath, index);

  return {
    scanned: scanned.length,
    unchanged: plan.unchanged.length,
    pruned: plan.toPrune.length,
    unreadable: scanned.filter((r) => r.unreadable).length,
    totalFiles: allFiles.length,
    index,
  };
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

export const DEFAULT_BPM_TOL = 4;

export interface SearchOptions {
  any?: boolean;
  type?: TypeGuess;
  minDurS?: number;
  maxDurS?: number;
  bpm?: number;
  bpmTol?: number;
  band?: Band;
}

export interface SearchHit {
  path: string;
  matchedTerms: number;
  entry: SamplesIndexEntry;
}

/** Token match over normalized path tokens (design: "all terms must hit;
 * `--any` relaxes"), plus trait filters. Unreadable entries never match. */
export function searchIndex(
  index: SamplesIndexFile,
  terms: string[],
  opts: SearchOptions = {},
): SearchHit[] {
  const qTerms = terms.flatMap((t) => pathTokens(t));
  const hits: SearchHit[] = [];
  for (const entry of Object.values(index.files)) {
    if (entry.scan.unreadable) continue;
    const tokenSet = new Set(entry.tokens);
    const matched = qTerms.filter((t) => tokenSet.has(t)).length;
    const passesTerms = qTerms.length === 0 || (opts.any ? matched > 0 : matched === qTerms.length);
    if (!passesTerms) continue;
    if (opts.type && entry.scan.type_guess !== opts.type) continue;
    if (opts.minDurS !== undefined && (entry.scan.duration_s ?? -Infinity) < opts.minDurS) continue;
    if (opts.maxDurS !== undefined && (entry.scan.duration_s ?? Infinity) > opts.maxDurS) continue;
    if (opts.bpm !== undefined) {
      const bpm = entry.scan.bpm;
      const tol = opts.bpmTol ?? DEFAULT_BPM_TOL;
      if (bpm == null || Math.abs(bpm - opts.bpm) > tol) continue;
    }
    if (opts.band && entry.scan.dominant_band !== opts.band) continue;
    hits.push({ path: entry.path, matchedTerms: matched, entry });
  }
  hits.sort((a, b) => b.matchedTerms - a.matchedTerms || a.path.localeCompare(b.path));
  return hits;
}

export interface RelaxationSuggestion {
  terms: string[];
  count: number;
  note: string;
}

/** Zero hits is a STATE (docs/lessons-learned.md #5) — offer the nearest
 * relaxations rather than just reporting the empty result. */
export function suggestRelaxations(
  index: SamplesIndexFile,
  terms: string[],
  opts: SearchOptions,
): RelaxationSuggestion[] {
  const suggestions: RelaxationSuggestion[] = [];

  for (let n = terms.length - 1; n >= 1; n--) {
    const shorter = terms.slice(0, n);
    const count = searchIndex(index, shorter, opts).length;
    suggestions.push({ terms: shorter, count, note: "dropped the last search term" });
    if (count > 0) break;
  }

  if (!opts.any && terms.length > 0) {
    const anyCount = searchIndex(index, terms, { ...opts, any: true }).length;
    suggestions.push({ terms, count: anyCount, note: "--any (match any term instead of all)" });
  }

  const hasFilters =
    opts.type !== undefined ||
    opts.minDurS !== undefined ||
    opts.maxDurS !== undefined ||
    opts.bpm !== undefined ||
    opts.band !== undefined;
  if (hasFilters) {
    const noFilterCount = searchIndex(index, terms, { any: opts.any }).length;
    suggestions.push({ terms, count: noFilterCount, note: "without the trait filters" });
  }

  return suggestions;
}

// ---------------------------------------------------------------------------
// similar — cosine over the normalized feature vector
// ---------------------------------------------------------------------------

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface NormalizationStats {
  mean: number[];
  std: number[];
}

/** Per-dimension z-score stats across a set of vectors — required before
 * cosine similarity is meaningful across features on very different
 * natural scales (Hz-valued spectral stats vs. 0..1 band fractions). */
export function computeNormalizationStats(vectors: number[][]): NormalizationStats {
  const dim = vectors[0]?.length ?? 0;
  const mean = new Array(dim).fill(0) as number[];
  for (const v of vectors) for (let i = 0; i < dim; i++) mean[i]! += v[i]!;
  for (let i = 0; i < dim; i++) mean[i]! /= vectors.length || 1;
  const std = new Array(dim).fill(0) as number[];
  for (const v of vectors) for (let i = 0; i < dim; i++) std[i]! += (v[i]! - mean[i]!) ** 2;
  for (let i = 0; i < dim; i++) std[i] = Math.sqrt(std[i]! / (vectors.length || 1)) || 1; // 0 -> 1 guard
  return { mean, std };
}

export function normalizeVector(v: number[], stats: NormalizationStats): number[] {
  return v.map((x, i) => (x - stats.mean[i]!) / stats.std[i]!);
}

export interface SimilarCandidate {
  path: string;
  vector: number[];
  entry: SamplesIndexEntry;
}

export interface SimilarHit {
  path: string;
  similarity: number;
  entry: SamplesIndexEntry;
}

export function rankSimilar(
  referenceVector: number[],
  candidates: SimilarCandidate[],
  excludePath?: string,
): SimilarHit[] {
  const excludeAbs = excludePath ? resolve(excludePath) : undefined;
  const pool = candidates.filter((c) => c.path !== excludeAbs);
  const stats = computeNormalizationStats([referenceVector, ...pool.map((c) => c.vector)]);
  const refNorm = normalizeVector(referenceVector, stats);
  const hits = pool.map((c) => ({
    path: c.path,
    similarity: cosineSimilarity(refNorm, normalizeVector(c.vector, stats)),
    entry: c.entry,
  }));
  hits.sort((a, b) => b.similarity - a.similarity);
  return hits;
}

/** The reference file's similarity vector: from the index if already
 * indexed, else scanned on the fly (design: "The reference file need not
 * be in the index"). */
export async function resolveReferenceVector(
  index: SamplesIndexFile,
  file: string,
  scanner: ScannerFn,
): Promise<{ vector: number[]; fromIndex: boolean; record: ScanRecord }> {
  const absFile = resolve(file);
  const existing = index.files[absFile];
  if (existing && !existing.scan.unreadable && existing.scan.similarity_vector) {
    return { vector: existing.scan.similarity_vector, fromIndex: true, record: existing.scan };
  }
  if (!existsSync(absFile)) {
    throw new Error(`reference file not found: ${absFile}`);
  }
  const [record] = await scanner([absFile]);
  if (!record || record.unreadable || !record.similarity_vector) {
    throw new Error(
      `could not analyze reference file: ${absFile}${record?.error ? ` (${record.error})` : ""}`,
    );
  }
  return { vector: record.similarity_vector, fromIndex: false, record };
}

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

export interface IndexStats {
  totalFiles: number;
  roots: string[];
  byType: { loop: number; oneshot: number; unreadable: number };
  byBand: { low: number; mid: number; high: number };
  durationStats: { minS: number; maxS: number; meanS: number } | null;
}

export function summarizeIndex(index: SamplesIndexFile): IndexStats {
  const entries = Object.values(index.files);
  const byType = { loop: 0, oneshot: 0, unreadable: 0 };
  const byBand = { low: 0, mid: 0, high: 0 };
  const durations: number[] = [];
  for (const e of entries) {
    if (e.scan.unreadable) {
      byType.unreadable++;
      continue;
    }
    if (e.scan.type_guess === "loop") byType.loop++;
    else if (e.scan.type_guess === "oneshot") byType.oneshot++;
    if (e.scan.dominant_band) byBand[e.scan.dominant_band]++;
    if (e.scan.duration_s !== undefined) durations.push(e.scan.duration_s);
  }
  const durationStats = durations.length
    ? {
        minS: Math.min(...durations),
        maxS: Math.max(...durations),
        meanS: durations.reduce((a, b) => a + b, 0) / durations.length,
      }
    : null;
  return { totalFiles: entries.length, roots: index.roots, byType, byBand, durationStats };
}
