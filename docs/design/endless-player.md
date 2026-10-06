# Design: Endless player (M10 — Bronze-style infinite song versions)

- Status: built, pending owner validation (2026-08-19). Owner request:
  reconstruct the capability behind Jai Paul x Bronze (jasmine.bronze.ai)
  for their own songs. Research basis (2026-08-19, sourced): Bronze's
  content is entirely pre-supplied artist stems. The procedural aspect is
  (1) arrangement/structure and (2) continuous mix/processing fluctuation.
  It never composes new notes at playback.
- Our stance: the same two playback layers, plus a third that Bronze lacks:
  authoring-time procedural variant pools from our deterministic generators
  (drums/phrase/vary). The pool is procedurally rich while playback stays
  the owner's produced, mixed sounds. Bronze is a proprietary black box;
  here the grammar is a legible spec the owner authors and versions.

## The spec (`endless.yaml` — per-song project file, not a knowledge entry)

```yaml
name: my-song
bpm: 140
sig: 4/4                     # v1: 4/4 only, like the other engines
seed: 0                      # 0/absent = random each load; N = reproducible performance
crossfadeMs: 80              # equal-power fade at section boundaries
layers:                      # logical stems
  - {id: drums, gainDb: 0}
  - {id: bass, gainDb: 0}
  - {id: lead, gainDb: -1}
  - {id: pads, gainDb: -3, fluctuate: {filterHz: [800, 8000]}}
sections:
  - id: intro
    bars: 8
    pools:                   # variant audio files per layer; a layer absent
      drums: [audio/intro-drums-a.wav, audio/intro-drums-b.wav]
      pads:  [audio/pads-a.wav]         # here = silent in this section
  - id: drop
    bars: 16
    pools: { ... }
    layerMuteProbability: 0.15   # occasional one-layer thin-out, never drums+bass together (rule below)
transitions:                 # weighted digraph; every section must be reachable
  intro: [{to: drop, weight: 3}, {to: break, weight: 1}]
  drop:  [{to: break, weight: 2}, {to: drop, weight: 1}]
  ...
rules:
  noRepeatVariant: 2         # a variant can't repeat within its pool's last N picks
  maxConsecutive: 2          # same section at most N times in a row
  protectedLayers: [bass]    # never muted by layerMuteProbability
fluctuation:                 # layer 2 — continuous, slow, bounded random walks
  gainWalkDb: 1.5            # ± bound per layer, multi-second time constant
```

Parsed by `parseEndlessSpec` (typo-rejecting, same conventions as the other
specs). Build-time validation: every pool file exists; every file's
duration matches `bars × sig × 60/bpm` within ±25 ms (loops must be
bar-exact; reverb tails are baked by rendering each loop with its tail
overlapped, documented in the README the build emits); every section is
reachable in the transition graph; zero-variant pools fail loudly, naming
section+layer.

## The player (emitted by `awh endless build`)

- **Output**: a folder with `index.html` + `player.js` (ESM, zero deps) +
  the audio files + `endless-README.md` (how to serve with one command,
  `python3 -m http.server`; browsers block fetch() on file://).
  `--single-file` inlines player + audio as data: URIs into one HTML (for
  small demos / artifact publishing; size warning above 12 MB).
- **Engine (player.js)**: Web Audio with a lookahead scheduler (~25 ms
  tick, ~200 ms horizon, the standard sample-accurate pattern); per-layer
  GainNode (+ BiquadFilter when `fluctuate.filterHz` is set); equal-power
  crossfades at boundaries; seeded PRNG (mulberry32). The UI shows the seed
  as "performance #N", with a fresh random seed each load when seed=0, so
  any performance can be summoned again.
- **Decision core is pure and injectable**: section picker (weights +
  maxConsecutive), variant picker (noRepeatVariant), mute roller
  (protectedLayers), fluctuation walks (bounded, time-constant). All are
  pure functions of (spec, rngState, history) in one module shared verbatim
  between the browser player and vitest (player.js is the module under
  test; no logic duplication).
- **UI**: play/pause, seed/performance display, live readout of the current
  section + chosen variants + active layers (so you can always see what the
  grammar decided), elapsed time.

## CLI (`awh endless` group)

- `awh endless plan -o endless.yaml`: starter spec scaffold from
  `--sections "intro:8,build:8,drop:16,break:8"` or a saved reference record
  (`--from-ref <name>`, reusing M8's section data). Emits a fully commented
  template with empty pools.
- `awh endless build <spec> -o <dir>`: validate + emit the player.
  `--single-file` as above. Zero sections/layers = loud spec error;
  missing/mis-sized audio = loud per-file error before any output.
- `awh endless demo -o <dir>`: generates a small synthetic 4-layer song
  (pure-TS WAV writer: kick/hat patterns, bass notes, detuned-sine pads;
  seeded, ~8 short loops) + a matching spec, and builds it. Purpose: hear
  the engine end-to-end with no owner assets, and CI-testable.

## Verification bar

- Spec parsing typo-rejection; validation failures (missing file, wrong
  duration, unreachable section, empty pool) each loudly named.
- Decision core (vitest, injected RNG): weight distribution over many
  draws; noRepeatVariant honored; maxConsecutive honored; protectedLayers
  never muted; fluctuation walk stays within bounds; same seed → identical
  decision sequence (determinism).
- Build output: demo build emits valid HTML referencing every file;
  --single-file stays self-contained (no external refs).
- Browser smoke (stretch, flag if skipped): Playwright against the
  preinstalled Chromium (executablePath /opt/pw-browsers/chromium): page
  loads, scheduler advances sections, debug state exposes picks.
- Negative control: a spec whose transition graph strands a section is
  rejected, not silently unreachable.

## Non-goals (v1)

No in-browser synthesis or note-level generation at playback (layer 3
happens at authoring time via the existing generators); no ML "most
satisfying path" claims (the grammar is authored, legible, and seeded); no
tempo/key changes mid-performance; 4/4 only; no follow-actions authoring in
Live. Separate probe on the owner checklist: does the SDK expose clip
follow-action properties? If yes, a later `awh endless to-session` could
build the in-Live equivalent.
