# Design: Semantic sample search (M11b — CLAP embeddings over the index)

- Status: built (CLAP) — 2026-08-24, stacked on M11 (the index/CLI
  substrate). `clapembed.py` (batch + `--text` modes, `~/.awh/models/`
  checkpoint resolution, `AWH_CLAP_STUB=1` stub), the `clap` index field,
  `awh samples embed`/`search --semantic`/`similar --semantic`, and the
  SKILL.md contract update all shipped; see `docs/dev-loop.md`'s "M11b
  (semantic search) owner checklist" for what's verified (stub-mode only
  so far) vs. still needs a real checkpoint + real library to check.
  PANNs tagging (the optional stretch below) is DESIGNED, NOT BUILT.
  Owner priority, still true: this layer over the v1 trait machinery — text queries
  should rank actual audio content ("dusty breakbeat", "dark growl
  bass"), not filename tokens; similarity should be perceptual, not
  timbral statistics. Research basis (chat, sourced): LAION-CLAP
  (Apache-2.0 code, open checkpoints incl. a music-tuned variant) embeds
  audio and text in one space; 2026 work shows pretrained CLAP-class
  embeddings align with human similarity judgments without fine-tuning.
- License stance: LAION-CLAP code + checkpoints only (Apache/open). No
  CC-BY-NC weights in the recommended path. Essentia/Gaia (AGPL)
  excluded. No vector database — brute-force cosine in numpy is
  milliseconds at sample-library scale.

## Index schema addition

Each indexed file MAY gain:

```json
"clap": {"model": "larger_clap_music", "dim": 512, "v": [/* float32 */]}
```

- Vectors are stored L2-normalized, rounded to 6 decimals (size), in the
  same machine-local index file. Model name recorded per vector; a model
  change means re-embedding (embed detects mismatches and reports).

## Python side (analysis/awh_analysis/clapembed.py)

- Wraps `laion_clap` (torch CPU — torch is already in the venv). Loads
  the checkpoint once per invocation; batches audio files; emits JSONL
  (path → vector) through sanitize_json. `--text "query"` mode embeds a
  text string instead. Deterministic per model version (eval mode, no
  augmentation), and the model+version is stamped on every vector.
- Checkpoint resolution: `~/.awh/models/` cache; if absent, print the
  exact download instruction and exit with a clear "model not installed"
  error. Hugging Face is egress-blocked in the dev container, so the
  first download happens on the owner's machine — same pattern as the
  Basic Pitch install. NEVER auto-download silently.
- The embedder is INJECTABLE for tests: the CLI/Node layer talks to a
  subcommand contract (`clapembed` in __main__.py), and tests substitute
  a deterministic stub embedder (hash-derived vectors) via
  AWH_CLAP_STUB=1 handled inside clapembed.py itself — so every Node
  test runs without torch ever loading, and the stub is honest about
  being a stub in its model field ("stub-v1").

## CLI

- `awh samples embed [--model music|general]` — compute missing/stale
  vectors for the whole index in batches; progress; summary (embedded /
  cached / unreadable). Zero un-embedded files = state.
- `awh samples search --semantic "<phrase>"` — embed the phrase, cosine
  against all audio vectors, ranked table (path, score, the v1 traits
  for context). Composes with the v1 filters (--type, --min-dur, --bpm):
  filter first, rank semantically. Files without vectors are excluded
  and COUNTED in a footer ("312 of 9,400 files not embedded — run awh
  samples embed"). Without any embeddings at all: clear error naming the
  embed command, not silence.
- `awh samples similar <file> --semantic` — CLAP-space ranking (default
  becomes semantic when embeddings exist; `--traits` forces the v1
  vector). Reference file embedded on the fly.
- Skill contract update: semantic search is the FIRST tool for
  content-language queries ("find something like a dusty break"); token
  search remains first for name-like queries ("the Vengeance snare");
  the present-and-ask rule is unchanged; scores are shown, never
  overclaimed ("closest in the library" not "a match").

## Optional stretch (implement only if the core lands cleanly)

PANNs (Apache-2.0) tag pass — `awh samples tag` adding top-k AudioSet
labels per file as filterable metadata (--tag kick). Separate model,
separate cache, same stub pattern. If skipped, record it as designed-
not-built in this doc's status line.

## Verification

- Python: stub-mode determinism (same file → same vector); text-vs-audio
  cosine sanity in stub space; model-not-installed error path; batch
  JSONL shape through sanitize_json.
- Node (all under AWH_CLAP_STUB=1): embed fills the index and is
  incremental (second run embeds 0); search --semantic ranks by stub
  cosine and composes with filters; the not-embedded footer counts
  correctly; similar --semantic ranks a stub-identical file first;
  NEGATIVE CONTROL: --semantic without any embeddings errors with the
  embed instruction, and never falls back silently to token search.
- Owner checklist: real checkpoint download + `samples embed` timing at
  real library scale; "dusty breakbeat" and two more content-language
  queries judged by ear against the top-5; a similar-to query on a
  known favorite; spot-check that NC-licensed checkpoints were not
  fetched.
