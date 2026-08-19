# Research: MIDI-RWKV integration scope (`drop respond --engine ml`)

- Status: scoped + ML-0 spike RUN (2026-08-18, container — results at the
  bottom: conditional go). ML-1 build gated on M9 (deterministic phrase
  engine) being owner-validated first — the ML engine is an ADDITION to the recipe
  engine, never a replacement, and is always labeled as the
  non-explainable option.
- Upstream: https://github.com/christianazinn/MIDI-RWKV (MIT, weights
  `midi_rwkv.pth` 67 MB included in-repo) + the author's forks of
  `rwkv.cpp` (GGML CPU inference), `RWKV-PEFT` (state tuning / LoRA),
  `MIDIMetrics`. Paper: arXiv 2506.13001 (Zhou-Zheng & Pasquier,
  Metacreation Lab — the MMM / GigaMIDI group).

## What the source inspection established

- **Model**: RWKV-7, 12 layers, hidden 384, ~38 M params. Weights ship in
  the MIT repo — no gated download for inference.
- **Tokenizer**: MidiTok's **MMM** tokenization (`miditok` 3.0.4 +
  `symusic`, both MIT, plain pip installs), config committed as
  `train/tokenizer/tokenizer.json`: pitch range 21–109, beat resolution
  up to 12 subdivisions/beat, 24 velocity levels, and — the important
  part — explicit special tokens `Infill_Bar`, `Infill_Track`,
  `FillBar_Start/End`, plus MMM **attribute controls** (per-bar/track
  density, polyphony, etc. via `miditok.attribute_controls`).
- **Inference interface** (fork's `rwkv.cpp/python/config.py`,
  `InferenceConfig`): `bars_to_generate = {track_idx: [(bar_start,
  bar_end, [attribute controls], ...)]}` — per-track bar-range infilling
  where ALL tracks condition the generation — and `new_tracks =
  [(program, [controls])]` — generate an entirely new track against the
  existing arrangement. `context_length` (bars of surrounding context,
  default 4). Both map directly onto call-and-response: "fill these
  response bars given the call" or "write a response track."
- **Inference runtime**: the fork's `rwkv_cpp` python bindings over a
  GGML binary (`convert_pytorch_to_ggml.py`, FP16/FP32) — CPU-only is
  the intended path. `generate.py` already warns/refuses when the infill
  region has no surrounding context (their own honesty guard).
- **Fine-tuning**: RWKV-PEFT state tuning optimizes ~294 k params (vs
  LoRA r=4 ≈ 331 k, r=32 ≈ 2.7 M) — small enough to attempt on the
  owner's Mac; training stack is pytorch-lightning 1.9.5 + DeepSpeed
  (the DeepSpeed dependency is the likely Mac friction point — needs a
  spike).

## Integration phases

### ML-0 — spike (go/no-go, one session, owner machine or container)
1. `awh ml setup` prototype script (not yet a CLI command): clone the two
   forks into a gitignored cache (`.mlcache/` at repo root), `cmake`
   build librwkv, convert `midi_rwkv.pth` → GGML FP16, `pip install
   miditok==3.0.4 symusic` into the existing venv.
2. Round-trip proof: gateway clip notes → MIDI file (two tracks: call +
   empty-response), `InferenceConfig(bars_to_generate=...)`, infill, MIDI
   back → notes. Success = musically plausible bars landing in the right
   place, ~seconds per candidate on CPU.
3. Determinism check: fixed sampling seed + same build → identical
   output? Record the answer; if not seedable, candidates get content
   hashes in meta instead of reproducibility claims.

### ML-1 — `awh drop respond --engine ml`
- Python side lives in `analysis/awh_analysis/mlinfill.py` (same venv,
  same `--json` subcommand conventions, `sanitize_json`), guarded by a
  clear "ml extras not installed" error pointing at the setup script.
- Flow: call clip + neighbor context tracks → MIDI → infill the response
  region on the response track, N candidates by re-sampling → clips into
  session slots exactly like the recipe engine, meta labeled
  `engine: ml (midi-rwkv)` with sampling params. Attribute controls
  exposed sparingly (`--density low|med|high` at most, mapped to MMM
  bar-level controls).
- The recipe engine stays the default; `--engine ml` is opt-in and the
  output honesty line states it is a sampled model, not a named gesture.

### ML-2 — state tuning on the owner's own material (experiment)
- Corpus: B3b outbox captures + library clips exported to MIDI (we
  already have verified note round-tripping). Realistic corpus size is
  tens-to-hundreds of clips — small; state tuning (not LoRA) is the
  right-sized tool per the paper's own numbers.
- Success criterion: A/B respond candidates (base vs tuned state) on the
  same call, blind-auditioned by the owner. If the tuned state doesn't
  win audibly, park it — no sunk-cost promotion.
- Risk: the RWKV-PEFT training stack on macOS (DeepSpeed). Fallback:
  tune in this container (CPU, small model) and ship the state file back.

### ML-2 corpus plan (owner asked: "not a lot of clips — public data?")

State tuning is the few-shot-friendly method, but the corpus defines the
deliverable: public data gives GENRE ADAPTATION (a bass-music-leaning
prior), only the owner's material gives personalization. Two stages:

1. **Back-catalog harvest (the corpus the owner already owns).** Every
   past Ableton project is full of MIDI clips; `.als` is gzipped XML —
   structurally what the `.alc` work already parses. Build
   `awh lib harvest <projects-dir>`: walk the project history offline,
   extract every MIDI clip into the library (dedup by note-content hash,
   tag with source project). Plausibly hundreds of clips with zero manual
   capture, and valuable far beyond ML (personal motif library for
   `drop respond`, pattern mining). Build this FIRST — it pays even if
   ML-2 never ships.
2. **Public data, tiered honestly:**
   - Producer MIDI packs (free + owned Splice/Cymatics/etc.): BEST
     license fit — royalty-free for use in the owner's productions;
     training a private production tool sits closest to intended use.
   - Lakh / GigaMIDI: research-terms gray zone (GigaMIDI is also the
     pretraining data — only a genre-filtered subset would add anything).
     Knowing use only, nothing derived gets distributed.
   - Song-transcription rips (BitMidi-style): NO — clear copyrights, no
     license.

Sequence: tune a GENRE state on packs + harvest, then continue from it on
the personal corpus as B3b captures grow it; re-tune cheaply whenever the
corpus doubles. Eval unchanged (blind A/B vs base, park on no audible
win). Tuned state files are PRIVATE artifacts — gitignored, never in the
repo — because their training data carries no redistribution rights.
Pre-req spike: prove the RWKV-PEFT state-tuning loop runs at all on
container CPU (DeepSpeed friction) before promising timelines.

## Licensing position

- Code + weights: MIT end to end (MIDI-RWKV repo, forks, miditok,
  symusic). Nothing enters our repo tree except setup scripting and the
  wrapper — model + forks live in the gitignored cache, downloaded from
  upstream at setup time. Consistent with the Basic Pitch precedent.
- The WEIGHTS were pretrained on GigaMIDI (see below). We consume the
  author's MIT-published weights; we do not redistribute them.

## GigaMIDI for our knowledge base — the honest answer

GigaMIDI (~1.05 M MIDI files, TISMIR 2025, Metacreation Lab) is
**gated**: access is requested per-user on Hugging Face, and the terms
are **non-commercial research or education use**, distributed under
Canadian Fair Dealing. Also: huggingface.co is egress-blocked from this
dev container, so any GigaMIDI work happens on the owner's machine with
the owner's HF account.

What that means for us, per use:

| Use | Verdict |
|---|---|
| Committing MIDI files / excerpts into this MIT repo | **No.** License-incompatible and the underlying files carry ordinary song copyrights (same reasoning as the gitignored Live manual). |
| Local mining for AGGREGATE statistics (e.g. onset-density histograms, rest ratios, velocity spreads per genre subset) recorded as measurement-record-style KB entries with provenance | **Gray, leaning yes** — derived numerical facts, in the spirit of our measured-genre-targets rule. Keep such entries clearly provenance-stamped ("computed from GigaMIDI subset X, n=…") and be aware the dataset's non-commercial framing sits awkwardly next to commercial music-making; statistics about a corpus are not the corpus, but this is our call to make knowingly, not silently. |
| Verbatim phrases/patterns lifted into library/ clips | **No.** That is the corpus, not statistics about it. |
| Benefiting from it via MIDI-RWKV's pretrained weights | **Yes** — that laundering question was the author's to settle, and they published under MIT. |

Practical note: the expressive-performance metadata (the dataset's actual
research contribution) is also the most KB-useful part — e.g. measured
velocity/microtiming distributions for "human feel" could ground
`humanize` defaults in data instead of folklore. If the owner requests
access, a one-session mining script producing 2–3 sourced KB entries
(aggregate stats only) is the right first bite.

## Recommendation

ML-0 spike after M9 validates; ML-1 only if the spike's quality is worth
the setup burden it imposes on a fresh machine; ML-2 as the genuinely
novel experiment (personalized infill on the owner's own writing). Keep
all of it opt-in and labeled — the deterministic recipes remain the
product's spine.

## ML-0 spike results (2026-08-18, container)

Ran the full spike protocol in this dev container against the author's
`rwkv.cpp` fork (commit `9122097`) and the `midi_rwkv.pth` weights already
in the gitignored scratch cache. All work happened under scratch; nothing
in `analysis/`, `packages/`, `knowledge/`, or `m4l/` was touched.

### Build

- `rwkv.cpp`'s own `ggml` submodule (`https://github.com/ggerganov/ggml`)
  is a plain HTTPS submodule and cloned cleanly with
  `git submodule update --init --depth 1 ggml` — no ssh key needed, unlike
  the `MIDI-RWKV` repo's own submodules (`rwkv.cpp`, `RWKV-PEFT`,
  `MIDIMetrics`, all `git@github.com:...`), which is why those had to be
  cloned separately ahead of time.
- `cmake -B build -DCMAKE_BUILD_TYPE=Release -DRWKV_STANDALONE=ON` then
  `cmake --build build -j4`: **clean build, zero patches to CMakeLists or
  C/C++ sources.** Configure 0.8 s, build 17.8 s wall (4 cores, gcc 13.3,
  x86_64, AVX2 auto-detected, no ccache). Output:
  `rwkv.cpp/build/librwkv.so` (not `build/bin/` — the python loader's
  search path already covers `build/<name>` as a fallback, so no extra
  wiring needed).
- Python deps: `pip install miditok==3.0.4 symusic transformers` worked
  straight from PyPI. `pip install torch --index-url
  https://download.pytorch.org/whl/cpu` **failed** — this container's
  egress proxy returns 403 on `download.pytorch.org` (policy denial, see
  `/root/.ccr/README.md`); `pypi.org`/`files.pythonhosted.org` are
  proxy-exempt, so plain `pip install torch` worked but pulled the default
  CUDA-bundled build (~3 GB of `nvidia-*` wheels this CPU-only container
  will never use, vs. the intended ~200 MB CPU wheel). Purged pip's
  download cache afterward (freed 3.3 GB) to stay inside the disk
  allowance; net disk use ended around 14 GB/252 GB.

### Convert

- `convert_pytorch_to_ggml.py midi_rwkv.pth rcpp.bin FP16`: 1.8 s, **zero
  patches**. `midi_rwkv.pth` is a bare `state_dict` (not a wrapped
  checkpoint) with the `blocks.N.*` / RWKV-7 key shapes the script
  expects (`att.k_k`, `att.a1/a2`, etc. all present) — detected as
  "RWKV v7.0" automatically.
- Output size: **70,311,276 bytes (67.05 MB)** vs. 70,224,852 bytes
  (66.97 MB) input — GGML FP16 is effectively the same size as the
  source checkpoint here (small model, most tensors already stored as
  FP16-eligible and the FP32-kept 1-D/`.time_*` tensors are a small
  fraction of the 38 M params).
- Loaded the converted file with `rwkv_cpp_model.RWKVModel`:
  `n_layer=12, n_embed=384, n_vocab=16000` — matches the doc's
  architecture claim exactly.

### Tokenizer round-trip

- Built the requested 2-track test MIDI programmatically with `symusic`:
  track 0 = G4/A4/G4 call motif repeating across bars 1-4, track 1 = bass
  with two notes in bar 1, one note in bar 2, **bars 3-4 genuinely empty**
  (no notes, no bar markers).
- `tokenizer.encode(score, concatenate_track_sequences=False)` then
  round-tripped with `tokenizer.base_tokenizer._tokens_to_score(toks)`
  (not `tokenizer.decode()` — see shim list below) reproduced every note
  byte-for-byte: same pitches, starts, durations, velocities, on both
  tracks. Basic round-trip is solid.
- Bug found in the process: `tokenizer.decode(toks)` (the public MMM API)
  **crashes** (`AttributeError: 'list' object has no attribute 'ids'`) on
  the exact `list[TokSequence]` shape that `tokenizer.encode(...,
  concatenate_track_sequences=False)` returns — the fork's own
  `inference.py` already knows this and calls
  `tokenizer.base_tokenizer._tokens_to_score(input_tokens)` directly
  instead, bypassing the wrapper. Worth remembering for ML-1: never call
  the convenience `.decode()`, always the base-tokenizer path.

### Infill

**It works, but needed three shims to get there — and none of the three
would have been caught by the fork's own test harness.** In order
encountered:

1. **Trailing empty bars are invisible to the token stream, and nothing
   guards against it.** MMM's per-track tokenization stops emitting
   events at a track's *last note* — a bar with zero notes gets a
   `Bar_None`/`TimeSig_4/4` marker pair only if it's sandwiched *between*
   notes (verified by hand); a bar with zero notes *after* the last note
   is simply absent from `TokSequence.events`, even though
   `TokSequence._ticks_bars` (computed score-wide) still lists it.
   `inference.py`'s `_adapt_prompt_for_infilling` indexes into `.events`
   by `bars_ticks[start_bar_idx]` with no bounds check, so infilling a
   track whose empty region runs to the end of the arrangement — exactly
   the call-and-response shape this integration needs — raises an
   uncaught `IndexError`. **Shim**: before infilling, pad the target
   track's `.ids` and `.events` with explicit `Bar_None`/`TimeSig_4/4`
   marker pairs for each missing trailing bar, reconstructed to match
   exactly what miditok emits for a genuine empty *middle* bar (confirmed
   by encoding a hand-built middle-empty-bar MIDI and diffing the
   tokens). ~25 lines, see `pad_trailing_empty_bars()` in the spike
   driver.
2. **`StopLogitsProcessor.__call__` receives a plain Python list, not an
   ndarray**, and does `np.where(input_ids == vocab_id)` — for a Python
   list this is `list == int`, which evaluates to a single `False`
   rather than an elementwise mask, so `np.where` raises
   `ValueError: Calling nonzero on 0d arrays...`. `cpp_model.py`'s
   `CustomGenerator.generate()` passes `current_sequence` (a raw list) to
   the logits processor every single decode step. **Shim**: wrap it in
   `np.array(...)` at the call site.
3. **Same function, second bug**: `fill_start_idx = np.where(...)[0]` is
   left as an array of match indices, then used directly in arithmetic
   and slicing (`input_ids[fill_start_idx + ... :]`), which fails with
   `TypeError: only integer scalar arrays can be converted to a scalar
   index`. `inference.py`'s own later, unrelated use of the identical
   `np.where(... == FillBar_Start)` pattern correctly takes `[0][0]`;
   `logits_processor.py` only takes `[0]`. **Shim**: add the missing
   `[0]`. Exactly one `FillBar_Start`/`Infill_Track` token is guaranteed
   present (it's placed in the prompt prefix by
   `_adapt_prompt_for_infilling` before generation starts), so taking a
   scalar is safe.

All three bugs live on the `bars_to_generate` (bar-infill) code path
specifically — and that path is only ever exercised in the fork's
`generate.py` inside a blanket `try/except Exception` that prints and
silently retries on a different random test MIDI file. That harness can
report "N successful generations" while never once completing a real
decode loop; nothing in the repo's own testing would have surfaced any
of this. Treat `generate.py`/`test_generate()`'s apparent track record as
unverified until you've driven the `InferenceConfig` path directly, as
this spike did.

With all three shims applied: infilling bass bars 3-4 (0-indexed 2-3,
`context_length=4`, so the full 4-bar call track + bars 1-2 of the bass
track condition the generation) **produced notes, in the right track, in
the requested bars**, across every seed tried (42, 7, 123) — track 0 (the
call motif) came back byte-identical to the input in all runs, confirming
the infill is correctly scoped to the target track only. Wall-clock:
**~0.19-0.24 s per candidate** on this container's CPU (4 cores, no
threading tuned), generating 7-19 tokens per candidate depending on how
much content the model chose to emit → roughly **30-80 tokens/sec**,
dominated by a ~150-180 ms fixed cost to eval the context prompt once
before the per-token decode loop starts. For a 2-4 candidate `--engine
ml` request this is comfortably sub-second-to-low-seconds end to end on
CPU.

### Determinism

`torch.manual_seed(42)` before each `CustomGenerator.generate()` call,
identical `GenerationConfig` (temp 1.0, rep-penalty 1.2, top-k 20, top-p
0.95), same build, same process invocation twice: **byte-identical
output** (`sha256sum` of both dumped `.mid` files matched exactly,
`64ae4b6a...`). The sampling path (`torch.multinomial` in
`cpp_model.py`) is not itself seeded or exposed as a parameter anywhere
in the fork's API — determinism is purely a side effect of seeding
torch's global RNG before the call, so ML-1 must do the same explicitly
(and must not let anything else in-process consume `torch`'s RNG between
seeding and generation, or determinism silently breaks).

### Quality gut-check

Three candidates, same call context (bars 1-4 of the G4/A4/G4 motif) and
same original bass bars 1-2 (G2 half, G2 half, F2 whole), different
seeds:

- **seed 42** — bar 3: `Eb2, start=192, dur=48` (an eighth note);
  bar 4: `C3, start=292, dur=96` (roughly a quarter note, landing
  slightly off the downbeat). Single note per bar, stays in a plausible
  bass register (D#2-C3, close to the source material's G2/F2), rhythm
  is plausible if a little loose.
- **seed 7** — bar 3: `E2, start=192, dur=48`. **Bar 4 got nothing** —
  the model terminated the fill after one bar's worth of content this
  time. Notes/right-bars is not a hard guarantee per candidate; a caller
  needs to handle "fewer bars than requested came back."
  (`bars_ticks` in the reconstructed score correspondingly only listed 4
  bar boundaries instead of 5, i.e. the output track really is shorter.)
- **seed 123** — bar 3: `G2, start=240, dur=48` (very late in the bar);
  bar 4: `C2, start=288, dur=96` then two extra notes at `start=378,
  dur=4, pitch=A#1` and `start=380, dur=4, pitch=B1` — a two-tick,
  four-tick-long chromatic flurry stacked almost on top of each other at
  the very end of the region. That's not a played bass gesture; it reads
  as tokenizer/sampling noise the model happened to emit near the
  `FillBar_End` boundary.

Honest read: at 12 layers / 38 M params and CPU FP16, the model reliably
stays in the right track, the right bar range, and a plausible bass
register (everything generated fell between A#1 and C3, i.e. it never
wandered into melody-register pitches) — that part is a genuine, useful
constraint the model has clearly learned. But the *musical* content
ranges from "plausible, if generic, sustained bass note per bar" (seed
42) to "gave up early" (seed 7) to "brief noodly artifact right at the
fill boundary" (seed 123). Across 3 candidates none produced a bassline
a human would call intentional-sounding without editing; they read as
statistically-plausible filler rather than a composed response. That's
consistent with a 38 M-param model and a 4-bar/8-note prompt — not
surprising, but worth being honest about in the ML-1 output's "sampled,
not a named gesture" disclosure line.

### Go / no-go for ML-1

**Conditional go.** The mechanical path — build, convert, tokenize,
infill, reconstruct MIDI, determinism — all work and are fast enough
(sub-second per candidate on CPU) to be a real `--engine ml` option. But:

- The three shims above are not optional polish; without them the
  bar-infill path **cannot run at all** for exactly the call-and-response
  shape (`response track empty, condition on context`) this integration
  exists to serve. `analysis/awh_analysis/mlinfill.py` needs to vendor
  equivalents of all three (the padding helper, the `np.array()` cast,
  the `[0]` index fix) rather than assuming the upstream fork "just
  works" — pin to the exact fork commit and carry the patches as a small
  diff or monkeypatch applied at setup time, with a comment pointing back
  here.
- "Notes in the right bars" is probabilistic, not guaranteed (seed 7
  above) — ML-1's candidate generation needs to check the output actually
  populated the requested bar range and silently retry/drop candidates
  that came back short, rather than trusting the region blindly.
  Attribute-control targets (density/duration/polyphony) were passed as
  hand/computed values here and the model visibly tracked them loosely
  (single sustained notes, right register) but not tightly (seed 123's
  boundary artifact suggests the AC-injection logic in `cpp_model.py`
  can still produce a rough edge right at `FillBar_End`).
- Musical quality is real but modest at this model size — worth shipping
  as the clearly-labeled, opt-in, non-explainable option the doc already
  scopes it as, not worth over-investing polish into before the owner has
  auditioned it. ML-1's honesty line ("sampled model, not a named
  gesture") is doing real work here, not just covering the team
  legally — the seed-123-style artifacts are exactly what it needs to set
  expectations for.
- Recommend building ML-1 with the three shims vendored, N=3-4 candidates
  per request (cheap at ~0.2s/candidate) with a simple "did it fill the
  requested bars" post-check, and let the owner's own blind audition (the
  doc's ML-2 success criterion, informally, applied one step earlier)
  decide whether it's worth polishing further before ML-2's state-tuning
  work begins.

### What differs on macOS (untested here)

- **CPU wheel install should just work there.** This container's 403 on
  `download.pytorch.org` is a container-specific egress policy, not a
  torch/PyPI issue — the owner's Mac has no such proxy, and
  `pip install torch --index-url https://download.pytorch.org/whl/cpu`
  (or, on Apple Silicon, plain `pip install torch`, which already ships a
  lean CPU/MPS build with no CUDA weight) should avoid the ~3 GB
  CUDA-bundle download this container was forced into.
  `RWKV_ACCELERATE` (Apple's Accelerate framework, `ON` by default in
  `CMakeLists.txt`) and `RWKV_METAL` (off by default, opt-in) are both
  real options on macOS with no container equivalent — neither was
  exercised here since this is a generic x86_64/AVX2 Linux build.
- **Different CPU architecture entirely.** This build is x86_64 with
  ggml's AVX2 CPU backend auto-detected; the owner's Mac is Apple Silicon
  (arm64/NEON) unless it's an older Intel Mac. ggml auto-detects and
  branches per-architecture in `ggml-cpu`, so a clean build is expected,
  but none of this spike's wall-clock/tokens-per-second numbers transfer
  — they need to be re-measured on the actual target hardware, especially
  since Metal/Accelerate could plausibly change the CPU-only numbers
  measured here materially (faster, probably, given Apple Silicon's
  memory-bandwidth advantage for small models — but that's a guess, not
  measured).
- **Submodule auth.** This container could not `git submodule update`
  the `ssh`-form submodules on `MIDI-RWKV` itself (`RWKV-PEFT`,
  `MIDIMetrics`, and `MIDI-RWKV`'s own nested `rwkv.cpp` pointer) or clone
  those repos directly — hence the task's own setup already worked around
  it by shallow-cloning the `rwkv.cpp` fork separately over HTTPS. The
  owner's Mac, with their own GitHub SSH key, should be able to run the
  straightforward `git submodule update --init --recursive` the upstream
  README documents, which this container fundamentally cannot regardless
  of the egress-proxy fixes in `/root/.ccr/README.md` (it's an SSH-key
  problem, not a TLS/proxy one).
- **RWKV-PEFT / DeepSpeed (ML-2 concern, not exercised in ML-0 at all)**:
  the doc's existing risk note about DeepSpeed-on-macOS friction is
  unaffected by anything this spike measured — ML-0 never touched
  RWKV-PEFT or training-side code, only the inference (`rwkv.cpp`) path.
