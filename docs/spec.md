# Ableton Workflow Helper: Project Specification (v1)

- Status: draft for owner review
- Date: 2026-08-16
- Governing decision: `docs/decisions/ADR-001-live-bridge.md` (Extensions-SDK-first)
- Research: `docs/research/bridge-landscape.md`, `docs/research/data-driven-mixing.md`

## 1. Vision

A personal, CLI-first workflow accelerator for Ableton Live. Deterministic,
parameterized tools do the tedious work (section building, variation
generation, drum programming, measurement-based mix feedback). An LLM can
orchestrate them conversationally, but every capability works without AI.
The tool helps the owner make music faster; it does not make music for them.

Anti-goals: full-track generation (Suno-style), audio synthesis, VST preset
management, real-time performance control, automation editing (v1), Windows (v1).

## 2. Requirements (final, from spec interviews)

| ID | Requirement | Notes |
|----|-------------|-------|
| R1 | Motif → song sections on the Arrangement timeline | create-at-position based (SDK has no move/split); house/techno energy-curve forms + trap switch-up forms |
| R2 | Fast variation ideation: generate N candidate clips from a source clip | auditioning is manual by accepted trade-off; predictable placement/naming makes candidates easy to find |
| R3 | Drum assistance: pattern generation/variation, fills, humanization on Drum Racks | drum-pad (`receivingNote`) aware |
| R4 | CLI-first, LLM-optional | every operation is a deterministic CLI command; an LLM agent drives the same commands via a skill |
| R5 | Measurement-based mixing/mastering feedback | spectrum vs genre targets, LUFS/PSR/dBTP, phase/asymmetry, sidechain verification; the ear is the final arbiter |
| R6 | Owner-maintainable | SDK-free core, thin extension shell, contract tests, pinned versions |
| R7 | Both authorship modes, explicit per request | "transform my notes only" vs "co-write new material", never silently blended |
| R8 | Project scaffolding from templates | .als starter template first; structure-spec and reference-form scaffolding later |
| R9 | Reference-track deconstruction | deterministic-first (bar grid, energy arc, rule-based energy events, full-mix profile); ML section labels only as drafts with easy correction (owner prefers manual over hallucinated). See `docs/research/reference-track-analysis.md` |
| R10 | Post-FX capture without manual export | via M4L capture-tap sidecar (SDK has no post-FX or export API); enables fast A/B measurement loops |

Environment: Live 12 Suite beta (12.4.5+) on macOS, side-by-side with stable Live
for real sessions. Genres: house/techno/electronic + hip-hop/trap.

## 3. Architecture

```
┌─────────────────────────────── outside Live ───────────────────────────────┐
│  LLM agent (skill)    ──drives──►  awh CLI  ──HTTP──►  gateway extension    │
│  human terminal       ──drives──►  (packages/cli)      (packages/extension) │
│                                        │                      │             │
│                                   packages/core          Extensions SDK     │
│                                   (SDK-free: theory,     (only import site) │
│                                   notation, transforms,       │             │
│                                   section planner,       Live Set           │
│                                   LiveBridge iface)                         │
│                                        │                                    │
│                                   packages/analysis (Python: pyloudnorm,    │
│                                   librosa, scipy; reads WAVs, emits JSON)   │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **packages/core** (TypeScript, SDK-free): music theory, `bar|beat` notation
  parser/serializer, variation transforms, section planner, drum engines, the
  `LiveBridge` interface + DTOs. Unit-testable without Live.
- **packages/extension** (TypeScript, the only SDK import site): gateway .ablx.
  HTTP server on 127.0.0.1 (token + Origin check, `bridge.json` discovery
  handshake in `storageDirectory`), typed operation registry implementing
  `LiveBridge`, `withinTransaction` per logical operation, dev-gated eval
  escape hatch for prototyping new ops.
- **packages/cli** (`awh`): command suite; talks HTTP to the gateway; renders
  human output and `--json` for LLM/scripting.
- **packages/analysis** (Python, uv): measurement engine over WAV files
  (manual export in v1; `renderPreFxAudio` where pre-FX suffices). Emits a JSON
  report the CLI pretty-prints and an LLM can reason over. Bridge-independent.
- **skills/awh**: agent skill teaching the CLI vocabulary, the two authorship
  modes, and house rules (small steps, verify reads after writes).

### Reuse map (licenses verified 2026-08-16 unless noted)

| Source | License | What we take |
|---|---|---|
| OthmanAdi/loophole | MIT | Code + architecture: monorepo layering, HTTP/token/`bridge.json` bridge, write-queue → one-undo mapping, stable path-id scheme (`track:2/clipslot:4`), E2E checklist pattern |
| aker-dev/ableton-extension-skill | MIT | Agent skill with verified SDK API reference + scaffolding templates (the SDK is absent from model training data, so this prevents hallucinated APIs) |
| RyanJarv/ableton-extensions-sdk-reference | mirror of official TypeDoc | offline API reference during development |
| jasper-zheng/ableton-sdk-mcp | unverified (PROVENANCE.md) | pattern only until license checked: Sucrase-transpiled eval escape hatch |
| Producer Pal | GPL-3.0 (trademarked name) | design only, no code: `bar|beat` notation design, transform DSL semantics, compact set-summary format, per-project context file idea |
| Airwindows PhaseNudge | MIT | reference all-pass phase-rotation implementation |
| pyloudnorm | MIT | BS.1770 LUFS (validated) |
| librosa | ISC | STFT/spectral/rhythm features |
| Beat This! (CPJKU) | MIT (code and weights) | beat/downbeat/tempo for reference analysis; not madmom (CC BY-NC models) or allin1-as-shipped (depends on madmom models) |
| EDMFormer / Raveform | CC-BY-4.0 / MIT | optional draft section labeling with EDM vocabulary; Raveform = fine-tune dataset |
| libkeyfinder | GPL-3 | key detection as isolated subprocess only (~90% on dance music) |
| bschoepke Agent Audio Tap | pattern | M4L capture-tap sidecar design (post-FX capture + transport) |
| Matchering | GPL-3.0 | optional subprocess only (no linking): reference-master comparison |
| Composer's Assistant 2 | (paper) | variation control vocabulary model (density, rhythmic conditioning, pitch interest) |

Avoid: Essentia (AGPL-3.0); librosa/pyloudnorm/scipy cover our needs.
Never vendor the Ableton SDK tarballs (non-redistributable; the owner
downloads them via the Ableton beta program).

## 4. Feature decomposition: milestones

Every milestone ends with a design-review checkpoint: reassess against the
requirement it serves, question inherited designs, record deltas in
`docs/decisions/`.

### M0: Foundations
- Owner: join Ableton beta (Centercode), install Live 12.4.5+ beta side-by-side,
  obtain SDK zip, enable Developer Mode.
- Repo: pnpm monorepo scaffold (core/extension/cli), esbuild CJS bundling for the
  extension, vitest for core, `extensions-cli run` dev loop documented.
- Install aker-dev skill (project-scoped) for SDK-grounded development.
- Exit: hello-world gateway. Context-menu action + HTTP `/ping` from terminal
  reaches a packaged .ablx and the dev-mode extension.

### M1: Gateway core operations (the `LiveBridge` surface)
- Read: compact set summary (tracks, scenes, arrangement clip map, devices,
  drum-rack pad maps, tempo/scale) in a token-frugal format (Producer Pal design).
- Write: create/replace MIDI clip notes (session slot, arrangement-at-position,
  take lane); `clearClipsInRange`; track/scene CRUD; mixer params (with an
  empirically mapped dB curve, ported from loophole); device insert (stock)/param
  set; DrumRack chain + `receivingNote`; Simpler `replaceSample`; audio clip
  placement.
- Semantics: one logical op = one `withinTransaction` (create-then-configure = 2
  steps, documented per op); stable path-ids re-resolved per call; typed error
  taxonomy (stale handle, out-of-range, not-found).
- Tests: core unit tests against a `FakeLiveBridge`; live E2E checklist doc.
- Exit: `curl` can read a set summary and write a clip into arrangement bar 33.

### M2: CLI + notation + skill v0
- `bar|beat` notation parser/serializer in core (clean-room design, PP-inspired).
- `awh status`, `awh read clip|track|set`, `awh write clip`, `awh render-prefx`.
- `--json` everywhere; `skills/awh` v0 so an LLM agent can drive it.
- Exit: an agent, via the skill, round-trips a clip (read → modify → write) reliably.

### M3: Variation engine (R2, R7)
- Deterministic transform vocabulary in core (CA2-modeled): density up/down,
  syncopate, straighten, transpose-in-scale, octave moves, contour inversion,
  retrograde, note-length/articulation, velocity shaping, humanize (timing/vel),
  fill-last-bar, thin-to-skeleton, `swing()`/`quant()` math transforms.
- `awh vary <clip> -n 8 --ops "..."` → N candidates written to a predictable
  location (dedicated "Variations" track, labeled `<src>-v1..vN`) for manual
  audition; `awh keep`/`awh sweep` to promote/clean candidates.
- Co-write mode (`--cowrite`): the LLM generates new material (countermelody,
  answer phrase, bassline against clip) through the same clip-write pipeline,
  constrained by key/scale/range/density parameters.
- Exit: 8 audition-ready variations of an 8-bar motif in < 30 seconds.

### M4: Section builder (R1)
- Section spec format (YAML): ordered sections with bar spans, energy level,
  per-track layer directives (add/remove/vary/mute), fill/transition hooks.
- Genre form presets: house/techno energy curve (intro/build/drop/breakdown/outro),
  trap switch-up (8–16 bar flips).
- `awh sections plan` (propose spec from current set + motif) and
  `awh sections apply` (create arrangement clips at positions per spec, using
  derived variations via M3 instead of verbatim tiling).
- Exit: 4-min arrangement skeleton from an 8-bar loop in one command + audition pass.

### M5: Drum tools (R3)
- Pad-map-aware pattern generation (genre pattern grammars: house/techno grids,
  trap hat rolls/triplets), variation ops specialized for drums, fills,
  groove/humanize against the melodic content's rhythm.
- `awh drums gen|vary|fill|humanize`.

### M6: Analysis engine v1 (R5, R10)
- **M4L capture-tap sidecar** (we have Suite; a small purpose-built device,
  not a second bridge): sits on master or any chain end, records post-FX audio
  to WAV on trigger, and, because M4L has full LOM transport access, can
  start/stop playback over a chosen loop. Triggered by the CLI (localhost
  socket). Removes the manual-export step from the measure→adjust→verify loop
  and partially restores programmatic audition (accepted as lost in ADR-001).
- `awh mix ab`: capture A → apply change (e.g. EQ Eight move) → capture B →
  loudness-matched measurement diff (level matching counters the
  louder-sounds-better bias).
- `awh mix report <wav...>`: LUFS-I/S, dBTP, PSR (flag < 8 in loudest sections),
  third-octave long-term spectrum vs genre target bands (we measure our own
  reference sets, not literal pink noise; masters tilt ≈ -5 dB/oct),
  stereo width + phase correlation (kick/bass band flagged), waveform asymmetry +
  estimated phase-rotation headroom, sidechain pump verification vs BPM grid,
  delivery check per target (club −8..−6 LUFS / streaming −14 / Apple −16, ≤ −1 dBTP).
- Output: JSON + readable report with prioritized, explained findings tied to
  concrete device moves. The LLM layer adds interpretation and never invents
  numbers.
- Exit: report on an owner track matches what trusted meters say.

### M7: Scaffolding + harmony (R8, stretch)
- `awh new` from owner's .als template (template dir copy + gateway populate).
- Chord/harmony tools (progressions in-scale, voicing spread) via co-write mode.

### M8: Reference-track deconstruction (R9)
- `awh ref analyze <audio>`: tempo + bar grid (Beat This!), bar-synced energy arc
  (short-term LUFS + sub-band <100 Hz), rule-based drop/build/breakdown events
  (deterministic on 4/4; trap gets adapted heuristics + lower confidence),
  full-mix measurement profile (spectrum/loudness/DR/stereo) for M6 comparisons.
- `awh ref sections`: writes the draft section map into the Live set as named/
  colored empty clips on a dedicated "Sections" marker track (cue-point times are
  read-only in the SDK, so marker clips replace locators). The owner corrects by
  moving/renaming clips; we read corrections back. Draft-with-correction is the
  proven product pattern here (rekordbox Phrase Analysis).
- Optional, confidence-tagged extras: EDM-vocabulary ML section labels
  (EDMFormer class), key detection (libkeyfinder subprocess, Camelot neighbors
  shown), stem presence lanes (verified-license separation model only).
- Explicit non-features (hallucination risk, per research): generic pop section
  labels on electronic music, fine per-stem spectral comparisons, "other"-stem
  measurements, chord-level analysis of sparse electronic tracks.

### Backlog candidates (researched, owner-approved, awaiting scheduling)

**B1: Audio-to-MIDI ("convert to melody", better than Ableton's).**
Research: `docs/research/audio-to-midi.md`. Two modes: polyphonic via Spotify
Basic Pitch (Apache-2.0 code and weights, Node-capable; ONNX + onnxruntime-node
preferred, per NeuralNote's production validation) and monophonic via CREPE
Notes/SwiftF0-style segmentation (MIT, beats Basic Pitch by +7–10% F on mono
material). Quality is won in post-processing: note-split sensitivity, time
quantization, scale snapping (Set scale from `set.summary`). No new gateway
ops needed: `clip.get` (file path) → transcribe → `clip.create-midi`. Add a
right-click "AWH: Convert to MIDI" context-menu action on AudioClip. Later:
chain with Live 12.3 stem separation; spectrogram review UI (the one good
NoteGrabber 2 idea). Natural fit after M3; well-bounded, so a good
delegation candidate.

**B2: Operator sound-design assistant.**
Rides the generic M1 device surface (`device.insert`/`get`/`param`). FM
synthesis is parametric and theory-heavy, a good LLM fit. Two loops: blind
(the LLM sets a patch from FM theory, human audition) now; ears loop (capture
tap → spectrum/envelope measurement vs described/reference timbre) after M6.
Deliverable includes JSON parameter-snapshot presets (design → snapshot →
versionable, re-applicable patch library), which work for any stock device,
not only Operator. Prerequisite probe (2 commands on the dev machine, during
any Live session): insert an Operator, `device.get`, record which parameters
the SDK exposes (drawn-partials editing expected missing; that bounds the
feature). Constraint: starts from the default preset, since the SDK has no
preset loading.

**B3: Clip library ("save that clip for later").**
Design: `docs/design/library-kb.md`. Git-versioned `library/` in this repo:
clips as markdown + YAML frontmatter with executable bar|beat notation
(notes + tempo/scale/tags/source-project context; audio clips reference
sample paths, no media in git), device chains as param-snapshot recipes.
Commands: `awh save`, `awh chain save`, `awh lib list/show/place/index`,
`awh distill` (batch, LLM-guided capture from the open project).
Right-click capture via the extension **outbox** pattern (sandbox-safe:
the menu action buffers in storageDirectory, `awh lib import` drains to the
repo). No new bridge capabilities needed beyond the outbox op. Phases: B3a
CLI save/list/place (buildable today) → B3b right-click outbox → B3c distill
→ B3d Live-browser mirror: library clips exported as `.alc` Live Clips in a
generated directory Pack with Live 12 XMP tags (`PackRevision` bump =
re-index). Research done, design firm: `docs/research/alc-live-library.md`.

**B4: Knowledge base (deterministic production wiki).**
Design: `docs/design/library-kb.md`. Domains are open-ended (new topic =
new directory, discovered from the tree, never hardcoded), and measurement
records (`library/measurements/` mix reports) are first-class knowledge:
indexed and retrievable alongside entries, citable as evidence.
`knowledge/<topic>/<slug>.md`, tiered (`verified`/`sourced`/`draft`), with a
mandatory **Executable section** (notation patterns, transform pipeline
specs, device recipes) wherever the knowledge can be expressed as one;
prose-only is a last resort. The agent cites slug + tier when applying an
entry. Seeded by research agents distilling cited external sources (genre
tropes, artist techniques) into reviewable PRs; grown from own projects via
`awh distill` and end-of-session capture; promoted to `verified` only after
real use in Live. Retrieval = grep + tags + generated INDEX (no vector search
until that demonstrably fails). This serves the determinism principle:
predefined accurate references over per-session re-reasoning.

### Parked (out of v1)
Automation (offline .als injection experiment, backup-gated) · warp-marker write ·
structure-spec + reference-form project scaffolding (builds on M8) · Windows ·
webview UIs · community release/distribution (would require resolving stem-model
weight provenance and CC-BY attribution).

## 5. Risks

| Risk | Mitigation |
|---|---|
| SDK beta churn / announced stricter sandbox | thin shell, pinned `minimumApiVersion`, sandbox-safe file access from day one, side-by-side beta |
| SDK never gains transport/automation | accepted for v1; Producer Pal stopgap; .als offline path researched |
| Solo-project stall | each milestone independently useful; M1+M2 alone beat mouse-only workflows |
| LLM MIDI quality | bar-aligned notation, key/scale/density constraints, validation against grid/range, human audition loop (research-backed) |
| Genre targets folklore | measure our own reference tracks; cite research thresholds only |
