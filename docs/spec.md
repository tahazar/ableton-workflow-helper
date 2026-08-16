# Ableton Workflow Helper — Project Specification (v1)

- Status: DRAFT for owner review
- Date: 2026-08-16
- Governing decision: `docs/decisions/ADR-001-live-bridge.md` (Extensions-SDK-first)
- Research: `docs/research/bridge-landscape.md`, `docs/research/data-driven-mixing.md`

## 1. Vision

A personal, CLI-first workflow accelerator for Ableton Live. Deterministic,
parameterized tools do the tedious work (section building, variation generation,
drum programming, measurement-based mix feedback); an LLM (Claude) orchestrates
them conversationally when wanted, but every capability works without AI. The
tool helps the owner make music faster — it does not make music for them.

Anti-goals: full-track generation (Suno-style), audio synthesis, VST preset
management, real-time performance control, automation editing (v1), Windows (v1).

## 2. Requirements (final, from spec interviews)

| ID | Requirement | Notes |
|----|-------------|-------|
| R1 | Motif → song sections on the Arrangement timeline | create-at-position based (SDK has no move/split); house/techno energy-curve forms + trap switch-up forms |
| R2 | Fast variation ideation: generate N candidate clips from a source clip | auditioning is manual by accepted trade-off; predictable placement/naming makes candidates easy to find |
| R3 | Drum assistance: pattern generation/variation, fills, humanization on Drum Racks | drum-pad (`receivingNote`) aware |
| R4 | CLI-first, LLM-optional | every operation is a deterministic CLI command; Claude drives the same commands via a skill |
| R5 | Measurement-based mixing/mastering feedback | spectrum vs genre targets, LUFS/PSR/dBTP, phase/asymmetry, sidechain verification; ear remains final arbiter |
| R6 | Owner-maintainable | SDK-free core, thin extension shell, contract tests, pinned versions |
| R7 | Both authorship modes, explicit per request | "transform my notes only" vs "co-write new material" — never silently blended |
| R8 | Project scaffolding from templates | .als starter template first; structure-spec and reference-form scaffolding later |

Environment: Live 12 Suite beta (12.4.5+) on macOS, side-by-side with stable Live
for real sessions. Genres: house/techno/electronic + hip-hop/trap.

## 3. Architecture

```
┌─────────────────────────────── outside Live ───────────────────────────────┐
│  Claude Code (skill)  ──drives──►  awh CLI  ──HTTP──►  gateway extension    │
│  human terminal       ──drives──►  (packages/cli)      (packages/extension) │
│                                        │                      │             │
│                                   packages/core          Extensions SDK     │
│                                   (SDK-free: theory,     (only import site) │
│                                   notation, transforms,       │             │
│                                   section planner,       Live Set           │
│                                   LiveBridge iface)                         │
│                                        │                                    │
│                                   packages/analysis (Python: pyloudnorm,    │
│                                   librosa, scipy — reads WAVs, emits JSON)  │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **packages/core** (TypeScript, SDK-free): music theory, `bar|beat` notation
  parser/serializer, variation transforms, section planner, drum engines, the
  `LiveBridge` interface + DTOs. Fully unit-testable without Live.
- **packages/extension** (TypeScript, the ONLY SDK import site): gateway .ablx —
  HTTP server on 127.0.0.1 (token + Origin check, `bridge.json` discovery
  handshake in `storageDirectory`), typed operation registry implementing
  `LiveBridge`, `withinTransaction` per logical operation, dev-gated eval
  escape hatch for prototyping new ops.
- **packages/cli** (`awh`): command suite; talks HTTP to the gateway; renders
  human output and `--json` for LLM/scripting.
- **packages/analysis** (Python, uv): measurement engine over WAV files
  (manual export in v1; `renderPreFxAudio` where pre-FX suffices). Emits a JSON
  report the CLI pretty-prints and Claude reasons over. Bridge-independent.
- **skills/awh**: Claude Code skill — teaches Claude the CLI vocabulary, the two
  authorship modes, and house rules (small steps, verify reads after writes).

### Reuse map (licenses verified 2026-08-16 unless noted)

| Source | License | What we take |
|---|---|---|
| OthmanAdi/loophole | MIT | Code + architecture: monorepo layering, HTTP/token/`bridge.json` bridge, write-queue → one-undo mapping, stable path-id scheme (`track:2/clipslot:4`), E2E checklist pattern |
| aker-dev/ableton-extension-skill | MIT | Claude skill with verified SDK API reference + scaffolding templates (SDK is absent from model training data — this prevents hallucinated APIs) |
| RyanJarv/ableton-extensions-sdk-reference | mirror of official TypeDoc | offline API reference during development |
| jasper-zheng/ableton-sdk-mcp | UNVERIFIED (PROVENANCE.md) | pattern only until license checked: Sucrase-transpiled eval escape hatch |
| Producer Pal | GPL-3.0 (trademarked name) | design only, no code: `bar|beat` notation design, transform DSL semantics, compact set-summary format, per-project context file idea |
| Airwindows PhaseNudge | MIT | reference all-pass phase-rotation implementation |
| pyloudnorm | MIT | BS.1770 LUFS (validated) |
| librosa | ISC | STFT/spectral/rhythm features |
| Matchering | GPL-3.0 | optional subprocess only (no linking): reference-master comparison |
| Composer's Assistant 2 | (paper) | variation control vocabulary model (density, rhythmic conditioning, pitch interest) |

Avoid: Essentia (AGPL-3.0) — librosa/pyloudnorm/scipy cover our needs.
Never vendor the Ableton SDK tarballs (non-redistributable; owner downloads via
Ableton beta program).

## 4. Feature decomposition — milestones

Every milestone ends with a **design-review checkpoint**: reassess against the
requirement it serves, question inherited designs, record deltas in `docs/decisions/`.

### M0 — Foundations
- Owner: join Ableton beta (Centercode), install Live 12.4.5+ beta side-by-side,
  obtain SDK zip, enable Developer Mode.
- Repo: pnpm monorepo scaffold (core/extension/cli), esbuild CJS bundling for the
  extension, vitest for core, `extensions-cli run` dev loop documented.
- Install aker-dev skill (project-scoped) for SDK-grounded development.
- Exit: hello-world gateway — context-menu action + HTTP `/ping` from terminal
  reaches a packaged .ablx AND the dev-mode extension.

### M1 — Gateway core operations (the `LiveBridge` surface)
- Read: compact set summary (tracks, scenes, arrangement clip map, devices,
  drum-rack pad maps, tempo/scale) — token-frugal format (Producer Pal design).
- Write: create/replace MIDI clip notes (session slot, arrangement-at-position,
  take lane); `clearClipsInRange`; track/scene CRUD; mixer params (with
  empirically-mapped dB curve — port loophole's); device insert (stock)/param set;
  DrumRack chain + `receivingNote`; Simpler `replaceSample`; audio clip placement.
- Semantics: one logical op = one `withinTransaction` (create-then-configure = 2
  steps, documented per op); stable path-ids re-resolved per call; typed error
  taxonomy (stale handle, out-of-range, not-found).
- Tests: core unit tests against a `FakeLiveBridge`; live E2E checklist doc.
- Exit: `curl` can read a set summary and write a clip into arrangement bar 33.

### M2 — CLI + notation + skill v0
- `bar|beat` notation parser/serializer in core (our clean-room design, PP-inspired).
- `awh status`, `awh read clip|track|set`, `awh write clip`, `awh render-prefx`.
- `--json` everywhere; `skills/awh` v0 so Claude can drive it.
- Exit: Claude, via the skill, round-trips a clip (read → modify → write) reliably.

### M3 — Variation engine (R2, R7)
- Deterministic transform vocabulary in core (CA2-modeled): density up/down,
  syncopate, straighten, transpose-in-scale, octave moves, contour inversion,
  retrograde, note-length/articulation, velocity shaping, humanize (timing/vel),
  fill-last-bar, thin-to-skeleton, `swing()`/`quant()` math transforms.
- `awh vary <clip> -n 8 --ops "..."` → N candidates written to a predictable
  location (dedicated "Variations" track, labeled `<src>-v1..vN`) for manual
  audition; `awh keep`/`awh sweep` to promote/clean candidates.
- Co-write mode (`--cowrite`): Claude generates new material (countermelody,
  answer phrase, bassline against clip) through the same clip-write pipeline,
  constrained by key/scale/range/density parameters.
- Exit: 8 audition-ready variations of an 8-bar motif in < 30 seconds.

### M4 — Section builder (R1)
- Section spec format (YAML): ordered sections with bar spans, energy level,
  per-track layer directives (add/remove/vary/mute), fill/transition hooks.
- Genre form presets: house/techno energy curve (intro/build/drop/breakdown/outro),
  trap switch-up (8–16 bar flips).
- `awh sections plan` (propose spec from current set + motif) and
  `awh sections apply` (create arrangement clips at positions per spec —
  derived variations via M3, not verbatim tiling).
- Exit: 4-min arrangement skeleton from an 8-bar loop in one command + audition pass.

### M5 — Drum tools (R3)
- Pad-map-aware pattern generation (genre pattern grammars: house/techno grids,
  trap hat rolls/triplets), variation ops specialized for drums, fills,
  groove/humanize against the melodic content's rhythm.
- `awh drums gen|vary|fill|humanize`.

### M6 — Analysis engine v1 (R5)
- `awh mix report <wav...>`: LUFS-I/S, dBTP, PSR (flag < 8 in loudest sections),
  third-octave long-term spectrum vs genre target bands (we measure our own
  reference sets; NOT literal pink noise — masters tilt ≈ -5 dB/oct),
  stereo width + phase correlation (kick/bass band flagged), waveform asymmetry +
  estimated phase-rotation headroom, sidechain pump verification vs BPM grid,
  delivery check per target (club −8..−6 LUFS / streaming −14 / Apple −16, ≤ −1 dBTP).
- Output: JSON + readable report with prioritized, explained findings tied to
  concrete device moves. Claude layer adds interpretation, never invents numbers.
- Exit: report on an owner track matches what trusted meters say.

### M7 — Scaffolding + harmony (R8, stretch)
- `awh new` from owner's .als template (template dir copy + gateway populate).
- Chord/harmony tools (progressions in-scale, voicing spread) via co-write mode.

### Parked (explicitly out of v1)
Automation (offline .als injection experiment, backup-gated) · warp-marker write ·
in-chain post-FX capture (M4L tap vs future SDK) · structure-from-reference-track
scaffolding · Windows · webview UIs · community release/distribution.

## 5. Risks

| Risk | Mitigation |
|---|---|
| SDK beta churn / announced stricter sandbox | thin shell, pinned `minimumApiVersion`, sandbox-safe file access from day one, side-by-side beta |
| SDK never gains transport/automation | accepted for v1; Producer Pal stopgap; .als offline path researched |
| Solo-project stall | each milestone independently useful; M1+M2 alone already beat mouse-only workflows |
| LLM MIDI quality | bar-aligned notation, key/scale/density constraints, validation against grid/range, human audition loop (research-backed) |
| Genre targets folklore | measure our own reference tracks; cite research thresholds only |
