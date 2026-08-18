# Research: MIDI-RWKV integration scope (`drop respond --engine ml`)

- Status: scoped (2026-08-18) from a source inspection of the actual repos,
  not the README. Build gated on M9 (deterministic phrase engine) being
  owner-validated first — the ML engine is an ADDITION to the recipe
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
