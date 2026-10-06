# Design: Sample library (M11 — index, search, similarity)

- Status: built, pending owner validation (2026-08-24); see "M11 (sample
  library) owner checklist" in docs/dev-loop.md. Owner ask: index their own
  sample folders so the CLI (or an LLM driving it) can answer "find me an
  amen break" from material they already own. Search by text, filter by
  audio traits, rank by similarity to a reference sound, then either pick
  confidently or present candidates and ask. Comparable commercial tools
  (Sononym, XLN XO, Waves Cosmos) prove the value; ours is CLI-first,
  local-only, and explainable.

## The index

- `awh samples index <dir...>` walks the given folders (wav/aiff/flac/mp3),
  extracts per-file features via `awh_analysis samplescan`, and writes one
  machine-local index file: `~/.awh/samples-index.json` (override with
  `AWH_SAMPLES_INDEX`). Never committed: it contains absolute paths and is
  meaningless off-machine; nothing under library/ or knowledge/.
- Incremental: files keyed by (path, size, mtime). Unchanged files are
  skipped, deleted files pruned, `--rescan` forces. One progress line per
  1000 files. A per-file decode failure is recorded as `unreadable`, not a
  crash.
- Features per file (deterministic, documented in the record): duration,
  channels, sample rate; RMS and peak dB; onset count and density (reusing
  detect_onsets); a loop/one-shot guess (onsets + duration heuristic,
  stated as a guess); estimated BPM for loop-length files (existing
  autocorr machinery, confidence carried); spectral centroid / rolloff /
  flatness (median over frames); 13 MFCC means (the similarity vector);
  low/mid/high band energy split (the drum-mining bands).
- Text tokens from the path: folder names and filename words, normalized
  (`Amen_Break_170.wav` → amen, break, 170). Pack folder names are often
  the best metadata a sample has, so they are first-class tokens.

## Search and similarity

- `awh samples search <query...>`: token match over path tokens (all terms
  must hit; `--any` relaxes), with filters `--type loop|oneshot`,
  `--min-dur/--max-dur`, `--bpm N --bpm-tol`, `--band low|mid|high`
  (dominant band). Output: ranked table (path, duration, type guess, BPM if
  any, dominant band), `--json` for the skill. Zero hits = state, with the
  nearest relaxations suggested ("0 for 'amen break 174' — 12 for 'amen
  break'").
- `awh samples similar <file> [--count N]`: cosine similarity over the
  normalized feature vector (MFCC means + spectral stats + band split),
  ranked, with per-file traits shown so the ranking is inspectable. The
  reference file need not be in the index.
- `awh samples stats`: index size, roots, type/duration histograms.
- Skill flow (the LLM contract): search first. With one clear winner by
  tokens + filters, use it and say why; with several plausible, present the
  top few with traits and ask the user; never invent a path. With AWH
  Remote's audition, candidates are listenable in Live.

## Pitch tagging (M11c) — closing the "blind to key" gap for kicks/subs

- Status: built and validated against the owner's real 20,212-file library
  (2026-08-23); see the "M11c" checklist in docs/dev-loop.md.
- Motivation: a masking investigation using the M6b masking toolkit
  (`mix pitch`) found that a naive FFT-peak pick can silently report a
  harmonic instead of the fundamental. The owner asked whether the same
  periodicity-tracked pitch detection could tag kicks/subs in the sample
  library, so a matching kick could be found by key instead of guessed from
  a filename.
- `awh samples pitch-tag` is a separate, opt-in enrichment pass on top of
  the base `index` (same shape as the M11b `embed` step below); it does not
  run for every file. Eligibility (`isPitchTagCandidate`,
  `packages/cli/src/samples.ts`): only readable one-shots whose energy is
  low-band-dominated (kicks/subs/808s/bass hits). On the owner's library
  that is 2,427 of 20,212 files (~12%). Running pyin on every hat/vocal/
  melodic loop would slow every `index` run for no benefit, since a single
  fundamental is not meaningful for most of them. Loops (basslines, melodic
  content) are out of scope for v1.
- Each candidate goes through `analysis/awh_analysis/pitch.py`'s
  `analyze_segment` (periodicity-tracked f0 via pyin, never a naive
  FFT-peak pick) via the `samplepitch.py` module/`samplepitch` CLI
  subcommand: f0/note, voiced fraction, confidence, and the
  harmonic-dominance flag, stored per entry as a `pitch` field. Incremental
  (already-tagged files are skipped) and version-stamped
  (`PITCH_ANALYSIS_VERSION`) so an algorithm change can force re-tagging,
  like M11b's CLAP model-label staleness key.
- Real-library result: of the 2,427 eligible files, 2,161 came back
  `voiced` (a trackable fundamental; kicks/808s are tuned more often than
  expected) and 266 `unvoiced` (broadband transients, reported as such
  rather than given a fabricated pitch). A sensible split, not
  all-or-nothing.
- **Octave-convention gotcha**: `pitch.py`'s `note.name` uses
  standard/scientific pitch notation (C4 = MIDI 60), a full octave apart
  from this codebase's Ableton convention (C3 = MIDI 60, `@awh/core`'s
  `pitchToMidi`/`midiToPitch`, used everywhere else a note name appears in
  this CLI). The raw Python name string is never shown to the user or
  parsed back. `--near-note` parses input via `pitchToMidi` (Ableton
  convention) then converts to Hz with the standard A440 MIDI formula, and
  display always re-derives the name from the stored `note.midi` via
  `midiToPitch`. Getting this backwards puts every displayed/typed note name
  off by an octave in the label (never in the measured Hz, which is
  convention-free).
- `awh samples search --near-note <note> [--cents <n>]` (default 50 cents =
  a quarter-tone) filters to voiced, pitch-tagged entries within tolerance.
  It composes with every other filter (`--type`, `--band`, plain text
  terms, `--semantic`). Untagged/unvoiced candidates never silently match;
  `stats` and zero-hit relaxations both surface pitch-tag coverage so a gap
  is visible. Confirmed against the real library:
  `awh samples search --near-note F1` (the root of this project's F
  Phrygian key) surfaced real 808s/kicks tuned to F1, including a file
  directly in a `Drums/Kicks/` folder.

## Limits (v1)

Similarity is timbral statistics, not perception: good for "another break
like this", blind to musical key relationships and to groove feel beyond
onset density. (M11c above closes part of this gap for low-end one-shots,
not for loops or melodic material.) BPM estimates attach only where the
loop heuristic fires, with confidence carried. No waveform GUI in v1. A 2D
similarity map (PCA over the MFCC space, self-contained HTML like the
endless player) is a natural future extension if the index proves useful.

## Verification

- Python: synthetic corpus (sine bass one-shot, noise hat, kick loop at
  known BPM) → features land in expected ranges; loop/one-shot guesses
  correct; BPM recovered within tolerance on the loop; determinism.
- Node: index build on a tmp corpus; incremental skip + prune proven;
  search token/filter matrix; `similar` ranks a second sine bass above the
  noise hat for a sine-bass reference (negative control: the hat ranks
  last); zero-hits state; unreadable-file handling; missing-dir loud error.
- skill-flows gate for the new commands; dev-loop owner checklist (index
  the real sample folders, timing at real scale, an "amen break" end-to-end
  search, a similar-to query against a known favorite).
- M11c pitch tagging: `test_samplepitch.py` (a tuned decaying-sine one-shot
  lands voiced with the correct f0/note; a broadband noise burst lands
  unvoiced as the negative control; too-short/corrupt/missing-file states;
  determinism; JSONL CLI round-trip; no NaN/Infinity tokens).
  `samples.test.ts`: `isPitchTagCandidate` eligibility matrix, incremental
  tagging + stale re-tag on a version bump, zero-candidates state, the
  octave-convention regression (`noteNameToHz("A3") === 440`,
  `pitchDisplayNote` re-derives from `note.midi` and ignores the raw Python
  name), `search --near-note` cents-tolerance filtering (with a negative
  control excluding untagged/unvoiced entries), and a real `samplepitch.py`
  subprocess integration test. Validated end to end against the owner's
  real 20,212-file library (see M11c above).
