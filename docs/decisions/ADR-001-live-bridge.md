# ADR-001: Which bridge connects the tool to Ableton Live?

- Status: **ACCEPTED** (owner decision, 2026-08-16) — see "Decision" below
- Date: 2026-08-15 (proposed) / 2026-08-16 (accepted)
- Inputs: `docs/research/bridge-landscape.md`, `docs/research/data-driven-mixing.md`

## Decision

**Build on the Ableton Extensions SDK** (Option A), overriding the original
Producer-Pal-first recommendation, with these owner-accepted trade-offs and
amendments from review:

1. **Accepted losses:** no programmatic transport/audition (owner will play/move
   clips manually) and no clip move/split (section building uses create-at-position
   + `clearClipsInRange`). These were the recommendation's main objections; with
   them explicitly accepted, ownership + official API + TypeScript DX win.
2. **Architecture amendment:** NOT a suite of server extensions — **one thin
   gateway extension** (HTTP server, token handshake, typed operation registry,
   dev-gated eval escape hatch) + a **CLI tool suite** (`awh`) where all
   pure-computation tools live (variation, countermelody, section planning,
   analysis). Extensions have no IPC/eventing; chaining happens in the CLI/LLM
   layer. Small right-click convenience extensions may come later, calling the
   same gateway.
3. **Leverage-first:** reuse existing projects wherever licenses allow —
   loophole (**MIT — code reuse OK**, and its SDK-free-core/SDK-coupled-shell
   layering is adopted), aker-dev ableton-extension-skill (**MIT**) for
   SDK-grounded Claude development, jasper-zheng eval pattern (**license
   unverified — pattern-reuse only until checked**), Producer Pal (**GPL-3.0 —
   design-port only, no code**: bar|beat notation design, transform DSL
   semantics, compact context format). Re-evaluate design at every step rather
   than adopting wholesale.
4. **Platform:** macOS primary; Live 12 Suite beta (12.4.5+) side-by-side with
   stable for real sessions. Windows later, if ever.
5. **Producer Pal remains an optional stopgap** the owner may run alongside for
   transport/clip-moving during sessions; nothing in our stack depends on it.
6. **Constraints designed-in from day one:** repo stays SDK-free (SDK is
   non-redistributable — the .ablx build imports it locally only); file access
   confined to `storageDirectory`/`tempDirectory` + `importIntoProject`
   (stricter OS sandbox is pre-announced); tool granularity respects the
   create-then-configure two-undo-step quirk; analysis engine stays
   bridge-independent (operates on WAVs).

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

## Original recommendation (superseded by the Decision above; kept for the record)

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

## Consequences (of the accepted decision)

- The bridge sits behind a `LiveBridge`-style interface in the SDK-free core
  (loophole's pattern), so the SDK-coupled shell stays swappable and the core
  stays testable without Live.
- Owner must join Ableton's beta program (Centercode) to obtain Live 12.4.5+
  beta and the SDK zip; the SDK cannot be committed to this repo.
- v1 mixing features constrained to exported/`renderPreFxAudio` WAV analysis;
  in-chain post-FX capture is a later milestone with its own decision.
- Automation editing is out of scope for v1 (the SDK has none); revisit via
  offline `.als` injection experiment behind a backup-first safety gate.
- Variation auditioning is manual (no transport API); mitigate with predictable
  clip placement/naming conventions so candidates are easy to find and play.
- SDK churn risk is carried knowingly: pin `minimumApiVersion`, keep the
  extension shell thin, expect the announced sandbox tightening.
