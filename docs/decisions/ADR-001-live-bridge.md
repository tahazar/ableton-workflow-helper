# ADR-001: Which bridge connects the tool to Ableton Live?

- Status: **PROPOSED — awaiting decision**
- Date: 2026-08-15
- Inputs: `docs/research/bridge-landscape.md`, `docs/research/data-driven-mixing.md`

## Decision frame

The differentiated value of this project is the **workflow layer** (motif → sections,
variation ideation, drum assistance, measurement-based mixing feedback) and the
**analysis engine** — not the plumbing into Live. The bridge is infrastructure; every
option below is judged by how much of our effort it redirects away from the workflow
layer, and by whether it can execute our v1 features at all.

Requirement recap (from spec interviews):
- R1: Arrangement-view operations (place/move/duplicate/split clips, sections, locators)
- R2: Fast MIDI write + **programmatic audition** (fire/play) for the variation loop
- R3: Drum-rack aware operations
- R4: CLI-first, LLM-optional (deterministic tools an LLM happens to call)
- R5: Path to measurement-based mixing feedback
- R6: Low maintenance burden; user is one person building a personal tool

## Options — adversarial pros/cons

### A. Build our own extension on the Ableton Extensions SDK

**For:**
- Official, versioned, typed API; clearly Ableton's strategic direction.
- Real Node.js host: sockets, child processes, npm. The CLI-bridge model is proven
  (loophole, jasper-zheng). TypeScript matches the user's web-dev fluency; hot reload
  + VS Code debugging is the best DX of any option.
- `withinTransaction` = clean one-action-one-undo semantics, better than every
  LOM-based option.
- First-class (if limited) audio hook: `renderPreFxAudio` + `importIntoProject`.
- Single-file .ablx install; no Node-for-Max fragility.

**Against (adversarial):**
- **Kills R2 dead today: no transport API at all** — cannot play, stop, or fire a clip.
  The variation-audition loop would be "Claude writes clips, human hunts for them and
  presses play" with no programmatic loop-cueing.
- Weak on R1: can create arrangement clips and clear ranges, but clip start/end/loop
  are read-only after creation; no move/split; locator times read-only. Our #1 feature
  would be built on the API's thinnest area.
- No automation, CC, clip gain, routing, browser/preset/VST loading, no observers.
- **Beta-gated**: requires Live 12.4.5 Suite BETA (Centercode signup); not in any
  stable Live as of Aug 2026. Behavior is changing in point releases and a stricter
  OS sandbox is pre-announced (will break naive file access). Betas on your production
  music machine are a real workflow risk.
- Rebuilding state summaries, notation, error handling, name validation that Producer
  Pal already spent ~6,000 commits refining — months of effort before first value.
- SDK license is non-redistributable → awkward open-source CI.

### B. Adopt Producer Pal as the bridge; build our workflow layer on its REST API

**For:**
- **Already ships the exact architecture we sketched for R4**: a documented REST API
  (`GET /api/tools`, `POST /api/tools/{name}`) with no AI required, plus MCP and a
  Claude Code Agent Skill. Our CLI shells onto REST; any LLM — or no LLM — drives it.
- Strongest option for R1 by far: arrangement place/move/split/duplicate, locators,
  take lanes. Strong R2 (transport + clip/scene fire) and R3 (Drum Rack building,
  drum-pad maps, Simpler sample loading). Deep control of 9 native devices.
- `bar|beat` notation + math-expression transforms (LFO/ramps/swing/quant) are
  purpose-built for LLM-accurate MIDI and for our variation engine.
- Runs on stable Live 12.3+/12.4. Hours to first value; 100% of our effort goes to
  the differentiated layer.
- GPL-3.0 and free; active development (v2.1 Aug 2026), responsive solo maintainer.

**Against (adversarial):**
- **Upstream dependency on one person's GPL project.** If Adam Murray burns out or
  pivots, we inherit a large Max-for-Live + Node-for-Max codebase we didn't write.
  Mitigations: pin versions; our layer talks only to the documented REST contract
  (small surface to re-implement or swap); GPL is irrelevant for personal use.
- No automation/clip envelopes (same as SDK); no VST internals; mix-render companion
  is macOS-only. Known bugs: batched-update timeouts, undo lumping.
- The M4L device must live in the Set (template solves this); Node-for-Max adds a
  moving part that occasionally needs a device reload.
- Their roadmap ≠ our roadmap; features we need upstream (warp-marker write is behind
  a debug flag) arrive on their schedule — though the REST layer means we can also
  ship our own remote-script sidecar for true gaps.

### C. Build on raw MIDI Remote Scripts (fork/extend an MCP like bschoepke's)

**For:** highest capability ceiling (browser + `load_item`, undo grouping, transport,
everything Push can do); Python-eval pattern = unlimited coverage; audio-tap M4L
pattern for real in-chain measurement.

**Against (adversarial):** undocumented API with zero stability guarantees; Live 12
broke all decompilers (Python 3.11) so the reference is bytecode archaeology; scripts
run on Live's main thread (a bug freezes Live mid-session); the strongest exemplar
warns of Set corruption; every Live update is a potential emergency. Worst possible
choice against R6 for a personal tool. Viable later as a narrow *sidecar* for specific
gaps, not as the primary bridge.

### D. Build on AbletonOSC or ableton-js

**For:** maintained, simple, language-agnostic; no beta, no GPL entanglement.

**Against (adversarial):** weakest on R1 (both are Session-view centric — our core
feature would fight the bridge); no browser/device loading; we'd still write the
entire tool layer, notation, and state model ourselves — Option A's build cost with a
lower ceiling and none of its official support.

### E. Offline `.als` manipulation (parse/edit the gzipped XML project file)

**For:** touches things NO live API can (automation lanes, warp markers, anything);
no bridge at all; great for scaffolding projects from templates.

**Against (adversarial):** undocumented format; requires Live to reload the Set on
every change (kills iteration speed — fails R2 completely); corruption risk on the
user's actual projects. Rejected as primary; **retained as a targeted complement**
(e.g., template scaffolding, automation injection) with mandatory backup copies.

## Recommendation

**Hybrid, Producer-Pal-first (Option B + E-as-complement, C-as-sidecar-if-needed, A-later):**

1. Bridge = Producer Pal's REST API on stable Live 12.4. All mutations flow through it.
2. Our repo = the workflow layer: a TypeScript CLI (`awh`) exposing deterministic,
   parameterized commands (sections, variations, drums, analysis) + a thin Claude Code
   skill so Claude drives the same CLI a human can script. Contract tests against the
   REST surface pin the upstream dependency.
3. Analysis engine = our own Python/librosa/pyloudnorm toolchain over rendered audio
   (manual export in v1; audio-tap or SDK render later). Bridge-independent by design.
4. Re-evaluate the Extensions SDK in ~2 quarters: if transport + arrangement editing +
   automation land and it reaches stable Live, port the bridge adapter — our CLI and
   analysis layers carry over unchanged.

The recommendation optimizes for: fastest path to the features that motivated the
project, minimum non-differentiated engineering, and a clean migration path that
doesn't marry us to any single bridge.

## Consequences (if accepted)

- Add "bridge adapter" as an explicit interface in the architecture so Producer Pal
  is swappable (REST client behind our own tool-facade).
- v1 mixing features constrained to manual-export analysis; in-chain capture is a
  later milestone with its own decision (M4L tap vs SDK render vs macOS companion).
- Automation editing is out of scope for v1 (no bridge supports it); revisit via
  offline `.als` injection experiment behind a backup-first safety gate.
