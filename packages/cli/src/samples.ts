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
import { midiToPitch, pitchToMidi } from "@awh/core";

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

/** M11b (docs/design/sample-semantic.md): one CLAP embedding, L2-normalized
 * and 6-decimal-rounded by clapembed.py before it ever reaches Node. `model`
 * is the mismatch-detection key — see `CLAP_MODEL_LABELS`/`expectedClapModelLabel`
 * below, kept in sync with clapembed.py's `_CHECKPOINTS[*]['label']`/
 * `STUB_MODEL_LABEL` by hand (comment on both sides). */
export interface ClapVector {
  model: string;
  dim: number;
  v: number[];
}

/** M11c (`awh samples pitch-tag`): one `mix pitch`-style periodicity-tracked
 * f0 record, mirroring `analysis/awh_analysis/pitch.py`'s `analyze_segment`
 * output (via `samplepitch.pitch_for_sample`). `note.midi` is the ONLY
 * octave-safe field here — `note.name` is stamped by the Python side using
 * STANDARD/scientific pitch notation (C4 = MIDI 60), a full octave apart
 * from this codebase's Ableton convention (C3 = MIDI 60, `@awh/core`'s
 * `pitchToMidi`/`midiToPitch`). Never display `note.name` directly to the
 * user — always re-derive the display name via `midiToPitch(note.midi)` so
 * it matches every other note name this CLI ever prints. */
export interface PitchInfo {
  analysisVersion: number;
  state: "voiced" | "unvoiced" | "too_short";
  f0Hz: number | null;
  note: { name: string; midi: number; cents: number } | null;
  voicedFraction: number;
  confidence: number;
  f0StabilitySemitones: number | null;
  harmonicDominance: {
    flagged: boolean;
    harmonic: number | null;
    ratioDb: number | null;
    timeS: number | null;
    fractionOfVoicedFrames: number;
  };
}

/** Ableton-convention display name for a pitch-tagged entry's fundamental —
 * the one place `note.midi` should be turned back into a note name. */
export function pitchDisplayNote(info: PitchInfo): string | null {
  if (info.note === null) return null;
  return midiToPitch(info.note.midi);
}

export interface SamplesIndexEntry {
  path: string;
  size: number;
  mtimeMs: number;
  tokens: string[];
  scan: ScanRecord;
  clap?: ClapVector;
  pitch?: PitchInfo;
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
// M11c: pitch tagging (kicks/subs/808s -> f0/note, for key-matched search).
// Separate, OPT-IN enrichment pass on top of the base M11 scan — same shape
// as M11b's `clap` field/`embed` command below, not folded into `runIndex`
// (running pyin on every file, including hats/vocals/melodic loops where a
// single fundamental isn't meaningful, would slow down every `index` run
// for no benefit). Built in response to a real request while validating the
// M6b masking toolkit (2026-08-23): "find kicks tuned to match my sub."
// ---------------------------------------------------------------------------

/** Only one-shots whose energy is dominated by the low band are pitch-tag
 * CANDIDATES — kicks/subs/808s/bass hits, not the whole library. Checked
 * against the owner's real 20,212-file library: 2,427 files (~12%)
 * qualify. Loops (basslines, melodic content) are out of scope for v1. */
export function isPitchTagCandidate(entry: SamplesIndexEntry): boolean {
  return (
    !entry.scan.unreadable &&
    entry.scan.type_guess === "oneshot" &&
    entry.scan.dominant_band === "low"
  );
}

/** Bumped in lockstep with `analysis/awh_analysis/samplepitch.py`'s
 * `PITCH_ANALYSIS_VERSION` — a stored `analysisVersion` below this is
 * STALE and gets re-tagged by `runPitchTag`, same spirit as M11b's
 * CLAP model-label staleness key. */
export const PITCH_ANALYSIS_VERSION = 1;

/** Raw per-file record shape from `python -m awh_analysis samplepitch`
 * (snake_case, mirrors samplepitch.py's JSON output verbatim). */
export interface RawPitchRecord {
  path: string;
  unreadable: boolean;
  error: string | null;
  pitch_analysis_version?: number;
  state?: "voiced" | "unvoiced" | "too_short";
  f0_hz?: number | null;
  note?: { name: string; midi: number; cents: number } | null;
  voiced_fraction?: number;
  confidence?: number;
  f0_stability_semitones?: number | null;
  harmonic_dominance?: {
    flagged: boolean;
    harmonic: number | null;
    ratio_db: number | null;
    time_s: number | null;
    fraction_of_voiced_frames: number;
  };
}

function toPitchInfo(rec: RawPitchRecord): PitchInfo {
  return {
    analysisVersion: rec.pitch_analysis_version ?? PITCH_ANALYSIS_VERSION,
    state: rec.state ?? "unvoiced",
    f0Hz: rec.f0_hz ?? null,
    note: rec.note ?? null,
    voicedFraction: rec.voiced_fraction ?? 0,
    confidence: rec.confidence ?? 0,
    f0StabilitySemitones: rec.f0_stability_semitones ?? null,
    harmonicDominance: {
      flagged: rec.harmonic_dominance?.flagged ?? false,
      harmonic: rec.harmonic_dominance?.harmonic ?? null,
      ratioDb: rec.harmonic_dominance?.ratio_db ?? null,
      timeS: rec.harmonic_dominance?.time_s ?? null,
      fractionOfVoicedFrames: rec.harmonic_dominance?.fraction_of_voiced_frames ?? 0,
    },
  };
}

/** files -> per-file pitch records, one `samplepitch` subprocess call per
 * chunk (same batching contract as ScannerFn/makePythonScanner). */
export type PitchTagFn = (files: string[]) => Promise<RawPitchRecord[]>;

export const DEFAULT_PITCH_CHUNK_SIZE = 200;

/** Real tagger: spawns `python -m awh_analysis samplepitch`, feeding the
 * chunk's file list on stdin and parsing the JSONL stdout — identical shape
 * to `makePythonScanner`, no amortized model-load cost to batch around
 * (pyin has no expensive one-time checkpoint, unlike CLAP). */
export function makePythonPitchTagger(python: string, cwd: string): PitchTagFn {
  return (files) =>
    new Promise<RawPitchRecord[]>((resolvePromise, reject) => {
      const child = spawn(python, ["-m", "awh_analysis", "samplepitch"], { cwd });
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
          reject(new Error(`samplepitch failed: ${err.trim() || out.trim()}`));
          return;
        }
        try {
          const lines = out
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          resolvePromise(lines.map((l) => JSON.parse(l) as RawPitchRecord));
        } catch (e) {
          reject(
            new Error(
              `could not parse samplepitch output: ${(e as Error).message}\n${out.slice(0, 500)}`,
            ),
          );
        }
      });
      child.stdin.write(`${files.join("\n")}\n`);
      child.stdin.end();
    });
}

export interface PitchTagRunResult {
  tagged: number;
  neverTagged: number;
  stale: number;
  upToDate: number;
  notCandidate: number;
  unreadable: number;
  totalCandidates: number;
  index: SamplesIndexFile;
}

/** load -> find CANDIDATES (isPitchTagCandidate) missing/stale a pitch tag
 * -> tag in chunks -> save. Zero candidates is a normal STATE the caller
 * reports, not an error (docs/lessons-learned.md #5). */
export async function runPitchTag(opts: {
  indexPath: string;
  tagger: PitchTagFn;
  chunkSize?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<PitchTagRunResult> {
  const index = await loadSamplesIndex(opts.indexPath);

  const allEntries = Object.values(index.files);
  const candidates = allEntries.filter(isPitchTagCandidate);
  const toTag = candidates.filter(
    (e) => !e.pitch || e.pitch.analysisVersion < PITCH_ANALYSIS_VERSION,
  );
  const stale = toTag.filter((e) => e.pitch).length;
  const neverTagged = toTag.length - stale;
  const upToDate = candidates.length - toTag.length;

  const chunkSize = opts.chunkSize ?? DEFAULT_PITCH_CHUNK_SIZE;
  const paths = toTag.map((e) => e.path);
  let tagged = 0;
  let unreadable = 0;
  for (let i = 0; i < paths.length; i += chunkSize) {
    const chunk = paths.slice(i, i + chunkSize);
    const records = await opts.tagger(chunk);
    for (const rec of records) {
      const entry = index.files[rec.path];
      if (!entry) continue;
      if (rec.unreadable) {
        unreadable++;
        continue;
      }
      entry.pitch = toPitchInfo(rec);
      tagged++;
    }
    opts.onProgress?.(Math.min(i + chunk.length, paths.length), paths.length);
  }

  await saveSamplesIndex(opts.indexPath, index);

  return {
    tagged,
    neverTagged,
    stale,
    upToDate,
    notCandidate: allEntries.length - candidates.length,
    unreadable,
    totalCandidates: candidates.length,
    index,
  };
}

// ---------------------------------------------------------------------------
// M11b: CLAP embeddings (docs/design/sample-semantic.md) — batch embed,
// incremental, model-mismatch re-embed. Reuses the SAME index file as M11
// (a `clap` field added per entry), never a second index.
// ---------------------------------------------------------------------------

export type ClapModel = "music" | "general";
export const DEFAULT_CLAP_MODEL: ClapModel = "music";

/** Mirrors clapembed.py's `_CHECKPOINTS[*]['label']` / `STUB_MODEL_LABEL` —
 * kept here (by hand, comment on both sides) so `runEmbed` can decide which
 * entries are STALE (need re-embedding) without spawning python first. */
export const CLAP_MODEL_LABELS: Record<ClapModel, string> = {
  music: "clap-music-v1",
  general: "clap-general-v1",
};
export const CLAP_STUB_MODEL_LABEL = "stub-v1";

/** The `clap.model` label a freshly-embedded vector for `model` will carry
 * in THIS process — honors AWH_CLAP_STUB the same way clapembed.py does, so
 * a Node test running under the stub sees the exact stamp the subprocess
 * will actually produce. */
export function expectedClapModelLabel(model: ClapModel): string {
  return process.env.AWH_CLAP_STUB === "1" ? CLAP_STUB_MODEL_LABEL : CLAP_MODEL_LABELS[model];
}

export interface ClapEmbedRecord {
  path: string;
  unreadable: boolean;
  error: string | null;
  clap: ClapVector | null;
}

/** files -> per-file embed records, one `clapembed` subprocess call per
 * chunk (mirrors ScannerFn/makePythonScanner's batching contract). */
export type ClapEmbedFn = (files: string[], model: ClapModel) => Promise<ClapEmbedRecord[]>;

/** text phrase -> its CLAP vector (the `--text` subcommand mode). */
export type ClapTextEmbedFn = (text: string, model: ClapModel) => Promise<ClapVector>;

/** CLAP inference is heavier per file than samplescan's DSP pass, but each
 * chunk still pays a multi-second checkpoint-load cost in real (non-stub)
 * mode — smaller than DEFAULT_SCAN_CHUNK_SIZE so a batch failure (one
 * corrupt file) re-embeds less on the per-file fallback inside
 * clapembed.embed_audio_batch, larger than 1 so the load cost is still
 * amortized across many files. */
export const DEFAULT_EMBED_CHUNK_SIZE = 100;

/** Real embedder: spawns `python -m awh_analysis clapembed --model <m>`,
 * feeding the chunk's file list on stdin and parsing the JSONL stdout —
 * same shape as makePythonScanner. Honors AWH_CLAP_STUB via the child's
 * inherited environment (clapembed.py itself reads the env var; nothing
 * Node-side needs to branch on it beyond `expectedClapModelLabel`). */
export function makePythonClapEmbedder(python: string, cwd: string): ClapEmbedFn {
  return (files, model) =>
    new Promise<ClapEmbedRecord[]>((resolvePromise, reject) => {
      const child = spawn(python, ["-m", "awh_analysis", "clapembed", "--model", model], { cwd });
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
          reject(new Error(`clapembed failed: ${err.trim() || out.trim()}`));
          return;
        }
        try {
          const lines = out
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          resolvePromise(lines.map((l) => JSON.parse(l) as ClapEmbedRecord));
        } catch (e) {
          reject(
            new Error(
              `could not parse clapembed output: ${(e as Error).message}\n${out.slice(0, 500)}`,
            ),
          );
        }
      });
      child.stdin.write(`${files.join("\n")}\n`);
      child.stdin.end();
    });
}

/** Real text embedder: `python -m awh_analysis clapembed --model <m> --text
 * "<phrase>"`. No stdin needed — the phrase is a CLI arg (spawn's argv
 * array, never a shell, so special characters are safe). */
export function makePythonClapTextEmbedder(python: string, cwd: string): ClapTextEmbedFn {
  return (text, model) =>
    new Promise<ClapVector>((resolvePromise, reject) => {
      const child = spawn(
        python,
        ["-m", "awh_analysis", "clapembed", "--model", model, "--text", text],
        { cwd },
      );
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
          reject(new Error(`clapembed --text failed: ${err.trim() || out.trim()}`));
          return;
        }
        try {
          const obj = JSON.parse(out.trim()) as { text: string; clap: ClapVector };
          resolvePromise(obj.clap);
        } catch (e) {
          reject(
            new Error(
              `could not parse clapembed --text output: ${(e as Error).message}\n${out.slice(0, 500)}`,
            ),
          );
        }
      });
      child.stdin.end();
    });
}

export interface EmbedRunResult {
  embedded: number;
  neverEmbedded: number;
  stale: number;
  upToDate: number;
  unreadable: number;
  totalCandidates: number;
  modelLabel: string;
  index: SamplesIndexFile;
}

/** load -> find candidates missing/stale for `opts.model` -> embed in
 * chunks -> save. "Candidate" = any readable (non-unreadable-scan) indexed
 * file; STALE = has a `clap` vector but under a DIFFERENT model label
 * (a prior `embed --model general` run, say); zero candidates needing
 * embedding is a normal STATE the caller reports, not an error. */
export async function runEmbed(opts: {
  indexPath: string;
  model: ClapModel;
  embedder: ClapEmbedFn;
  chunkSize?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<EmbedRunResult> {
  const index = await loadSamplesIndex(opts.indexPath);
  const expectedLabel = expectedClapModelLabel(opts.model);

  const readable = Object.values(index.files).filter((e) => !e.scan.unreadable);
  const toEmbed = readable.filter((e) => !e.clap || e.clap.model !== expectedLabel);
  const stale = toEmbed.filter((e) => e.clap).length;
  const neverEmbedded = toEmbed.length - stale;
  const upToDate = readable.length - toEmbed.length;

  const chunkSize = opts.chunkSize ?? DEFAULT_EMBED_CHUNK_SIZE;
  const paths = toEmbed.map((e) => e.path);
  let embedded = 0;
  let unreadable = 0;
  for (let i = 0; i < paths.length; i += chunkSize) {
    const chunk = paths.slice(i, i + chunkSize);
    const records = await opts.embedder(chunk, opts.model);
    for (const rec of records) {
      const entry = index.files[rec.path];
      if (!entry) continue;
      if (rec.unreadable || !rec.clap) {
        unreadable++;
        continue;
      }
      entry.clap = rec.clap;
      embedded++;
    }
    opts.onProgress?.(Math.min(i + chunk.length, paths.length), paths.length);
  }

  await saveSamplesIndex(opts.indexPath, index);

  return { embedded, neverEmbedded, stale, upToDate, unreadable, totalCandidates: readable.length, modelLabel: expectedLabel, index };
}

/** The reference file's CLAP vector for `similar --semantic`: from the
 * index if already embedded under `model`, else embedded on the fly
 * (design: "Reference file embedded on the fly") — mirrors
 * `resolveReferenceVector`'s from-index-or-scan-on-the-fly shape. */
export async function resolveReferenceClapVector(
  index: SamplesIndexFile,
  file: string,
  embedder: ClapEmbedFn,
  model: ClapModel,
): Promise<{ vector: ClapVector; fromIndex: boolean }> {
  const absFile = resolve(file);
  const expectedLabel = expectedClapModelLabel(model);
  const existing = index.files[absFile];
  if (existing && !existing.scan.unreadable && existing.clap && existing.clap.model === expectedLabel) {
    return { vector: existing.clap, fromIndex: true };
  }
  if (!existsSync(absFile)) {
    throw new Error(`reference file not found: ${absFile}`);
  }
  const [record] = await embedder([absFile], model);
  if (!record || record.unreadable || !record.clap) {
    throw new Error(
      `could not embed reference file: ${absFile}${record?.error ? ` (${record.error})` : ""}`,
    );
  }
  return { vector: record.clap, fromIndex: false };
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

export const DEFAULT_BPM_TOL = 4;
export const DEFAULT_CENTS_TOL = 50; // a quarter-tone

/** "F1" (Ableton convention, same as every other note name this CLI takes —
 * `@awh/core`'s `pitchToMidi`) -> its equal-tempered A440 frequency. The
 * MIDI-to-Hz step is convention-independent (standard A440 formula); only
 * the NAME-to-MIDI step needs to agree with the rest of the codebase, which
 * `pitchToMidi` already handles. */
export function noteNameToHz(name: string): number {
  const midi = pitchToMidi(name);
  return 440 * 2 ** ((midi - 69) / 12);
}

function centsBetween(hzA: number, hzB: number): number {
  return 1200 * Math.log2(hzA / hzB);
}

export interface SearchOptions {
  any?: boolean;
  type?: TypeGuess;
  minDurS?: number;
  maxDurS?: number;
  bpm?: number;
  bpmTol?: number;
  band?: Band;
  /** M11c: only entries with a VOICED pitch tag within `centsTol` (default
   * `DEFAULT_CENTS_TOL`) of this frequency. Untagged/unvoiced/broadband
   * entries never match — same "never silently ignore missing data"
   * discipline as `search --semantic`'s not-embedded gate. */
  nearNoteHz?: number;
  centsTol?: number;
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
    if (opts.nearNoteHz !== undefined) {
      const f0 = entry.pitch?.state === "voiced" ? entry.pitch.f0Hz : null;
      if (f0 == null) continue;
      const tol = opts.centsTol ?? DEFAULT_CENTS_TOL;
      if (Math.abs(centsBetween(f0, opts.nearNoteHz)) > tol) continue;
    }
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
    opts.band !== undefined ||
    opts.nearNoteHz !== undefined;
  if (hasFilters) {
    const noFilterCount = searchIndex(index, terms, { any: opts.any }).length;
    suggestions.push({ terms, count: noFilterCount, note: "without the trait filters" });
  }

  if (opts.nearNoteHz !== undefined) {
    const candidateCount = Object.values(index.files).filter(isPitchTagCandidate).length;
    const taggedCount = Object.values(index.files).filter(
      (e) => isPitchTagCandidate(e) && e.pitch,
    ).length;
    if (taggedCount < candidateCount) {
      suggestions.push({
        terms,
        count: candidateCount - taggedCount,
        note: `${candidateCount - taggedCount} eligible kick/sub one-shot(s) not yet pitch-tagged — run \`awh samples pitch-tag\``,
      });
    }
  }

  return suggestions;
}

// ---------------------------------------------------------------------------
// M11b: semantic search — filter first (reuses searchIndex's trait filters
// with terms=[]), rank the survivors by CLAP cosine similarity to the
// embedded query phrase (docs/design/sample-semantic.md).
// ---------------------------------------------------------------------------

/** Any readable entry embedded under `model`'s current label — the
 * NEGATIVE CONTROL gate: `search --semantic` refuses to run (loud error,
 * never a silent token-search fallback) when this is false. */
export function indexHasClapEmbeddings(index: SamplesIndexFile, model: ClapModel): boolean {
  const expectedLabel = expectedClapModelLabel(model);
  return Object.values(index.files).some(
    (e) => !e.scan.unreadable && e.clap && e.clap.model === expectedLabel,
  );
}

export interface SemanticHit {
  path: string;
  score: number;
  entry: SamplesIndexEntry;
}

export interface SemanticSearchResult {
  hits: SemanticHit[];
  /** Readable files anywhere in the index NOT embedded under `model`'s
   * current label — index-wide, independent of the trait filters, per the
   * design's footer ("312 of 9,400 files not embedded"). */
  notEmbeddedInIndex: number;
  totalReadableInIndex: number;
}

export function searchSemantic(
  index: SamplesIndexFile,
  queryVector: number[],
  model: ClapModel,
  filterOpts: SearchOptions = {},
): SemanticSearchResult {
  const expectedLabel = expectedClapModelLabel(model);
  const allReadable = Object.values(index.files).filter((e) => !e.scan.unreadable);
  const embeddedInSpace = allReadable.filter((e) => e.clap && e.clap.model === expectedLabel).length;

  // filter first: reuse searchIndex's trait-filter logic with an empty
  // token query (matches everything token-wise, same as `search --band low`
  // with no terms today).
  const filtered = searchIndex(index, [], filterOpts);
  const hits = filtered
    .filter((h) => h.entry.clap && h.entry.clap.model === expectedLabel)
    .map((h) => ({ path: h.path, score: cosineSimilarity(queryVector, h.entry.clap!.v), entry: h.entry }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  return {
    hits,
    notEmbeddedInIndex: allReadable.length - embeddedInSpace,
    totalReadableInIndex: allReadable.length,
  };
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

export interface SemanticCandidate {
  path: string;
  vector: ClapVector;
  entry: SamplesIndexEntry;
}

/** CLAP-space `similar --semantic` ranking: plain cosine over the ALREADY
 * L2-normalized vectors — unlike `rankSimilar`'s MFCC/spectral feature
 * vector (mixed natural scales, so it needs the z-score normalization
 * step), CLAP embeddings are directly comparable dimension-for-dimension,
 * and re-normalizing them per-dimension would destroy the space's own
 * geometry rather than make it more comparable. */
export function rankSimilarSemantic(
  referenceVector: number[],
  candidates: SemanticCandidate[],
  excludePath?: string,
): SemanticHit[] {
  const excludeAbs = excludePath ? resolve(excludePath) : undefined;
  const hits = candidates
    .filter((c) => c.path !== excludeAbs)
    .map((c) => ({ path: c.path, score: cosineSimilarity(referenceVector, c.vector.v), entry: c.entry }));
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
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
  /** M11c: pitch-tag coverage over ELIGIBLE candidates (isPitchTagCandidate)
   * only — never over the whole library, since most files (hats, vocals,
   * melodic loops) were never candidates in the first place. */
  pitchTag: { candidates: number; tagged: number; voiced: number; unvoiced: number; tooShort: number };
}

export function summarizeIndex(index: SamplesIndexFile): IndexStats {
  const entries = Object.values(index.files);
  const byType = { loop: 0, oneshot: 0, unreadable: 0 };
  const byBand = { low: 0, mid: 0, high: 0 };
  const durations: number[] = [];
  const pitchTag = { candidates: 0, tagged: 0, voiced: 0, unvoiced: 0, tooShort: 0 };
  for (const e of entries) {
    if (e.scan.unreadable) {
      byType.unreadable++;
      continue;
    }
    if (e.scan.type_guess === "loop") byType.loop++;
    else if (e.scan.type_guess === "oneshot") byType.oneshot++;
    if (e.scan.dominant_band) byBand[e.scan.dominant_band]++;
    if (e.scan.duration_s !== undefined) durations.push(e.scan.duration_s);
    if (isPitchTagCandidate(e)) {
      pitchTag.candidates++;
      if (e.pitch) {
        pitchTag.tagged++;
        if (e.pitch.state === "voiced") pitchTag.voiced++;
        else if (e.pitch.state === "unvoiced") pitchTag.unvoiced++;
        else pitchTag.tooShort++;
      }
    }
  }
  const durationStats = durations.length
    ? {
        minS: Math.min(...durations),
        maxS: Math.max(...durations),
        meanS: durations.reduce((a, b) => a + b, 0) / durations.length,
      }
    : null;
  return { totalFiles: entries.length, roots: index.roots, byType, byBand, durationStats, pitchTag };
}
