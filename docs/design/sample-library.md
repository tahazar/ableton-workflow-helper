# Design: Sample library (M11 — index, search, similarity)

- Status: built, pending owner validation (2026-08-24) — see "M11 (sample
  library) owner checklist" in docs/dev-loop.md. Owner ask: index their own
  sample
  folders so the CLI (or an LLM driving it) can answer "find me an amen
  break" from material they already own — search by text, filter by
  audio traits, rank by similarity to a reference sound — and either pick
  confidently or present candidates and ask. Comparable commercial tools
  (Sononym, XLN XO, Waves Cosmos) prove the value; ours is CLI-first,
  local-only, and explainable.

## The index

- `awh samples index <dir...>` walks the given folders (wav/aiff/flac/mp3),
  extracts per-file features via `awh_analysis samplescan`, and writes ONE
  machine-local index file: `~/.awh/samples-index.json` (override with
  `AWH_SAMPLES_INDEX`). Never committed — it contains absolute paths and
  is meaningless off-machine; nothing under library/ or knowledge/.
- Incremental: files keyed by (path, size, mtime); unchanged files are
  skipped, deleted files pruned, `--rescan` forces. Progress line per
  1000 files; a per-file decode failure is recorded as `unreadable`, not
  a crash.
- Features per file (deterministic, documented in the record):
  duration, channels, sample rate; RMS and peak dB; onset count and
  density (reuse detect_onsets); a loop/one-shot guess (onsets + duration
  heuristic, stated as a guess); estimated BPM for loop-length files
  (existing autocorr machinery, confidence carried); spectral centroid /
  rolloff / flatness (median over frames); 13 MFCC means — the similarity
  vector; low/mid/high band energy split (the drum-mining bands).
- Text tokens from the path: folder names and filename words, normalized
  (`Amen_Break_170.wav` → amen, break, 170). Pack folder names are often
  the best metadata a sample has; treat them as first-class tokens.

## Search and similarity

- `awh samples search <query...>` — token match over path tokens (all
  terms must hit; `--any` relaxes), with filters: `--type loop|oneshot`,
  `--min-dur/--max-dur`, `--bpm N --bpm-tol`, `--band low|mid|high`
  (dominant band). Output: ranked table (path, duration, type guess, BPM
  if any, dominant band), `--json` for the skill. Zero hits = state, with
  the nearest relaxations suggested ("0 for 'amen break 174' — 12 for
  'amen break'").
- `awh samples similar <file> [--count N]` — cosine similarity over the
  normalized feature vector (MFCC means + spectral stats + band split),
  ranked, with the per-file traits shown so the ranking is inspectable.
  The reference file need not be in the index.
- `awh samples stats` — index size, roots, type/duration histograms.
- Skill flow (the LLM contract): search first; if one clear winner by
  tokens + filters, use it and say why; if several plausible, present the
  top few with traits and ASK the user; never invent a path. Combined
  with AWH Remote's audition, candidates become listenable in Live.

## Honest limits (v1)

Similarity is timbral statistics, not perception — good for "another
break like this," blind to musical key relationships and groove feel
beyond onset density. BPM estimates only attach where the loop heuristic
fires, with confidence carried. No waveform GUI in v1; a 2D similarity
map (PCA over the MFCC space, self-contained HTML like the endless
player) is the natural M11b if the index proves useful.

## Verification

- Python: synthetic corpus (sine bass one-shot, noise hat, kick loop at
  known BPM) → features land in expected ranges; loop/one-shot guesses
  correct; BPM recovered within tolerance on the loop; determinism.
- Node: index build on a tmp corpus; incremental skip + prune proven;
  search token/filter matrix; `similar` ranks a second sine bass above
  the noise hat for a sine-bass reference (negative control: the hat
  ranks last); zero-hits state; unreadable-file handling; missing-dir
  loud error.
- skill-flows gate for the new commands; dev-loop owner checklist
  (index the real sample folders, timing at real scale, an "amen break"
  end-to-end search, a similar-to query against a known favorite).
