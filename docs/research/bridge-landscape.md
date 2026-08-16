# Research: Ways to Programmatically Control Ableton Live (Aug 2026)

Context: choosing the "bridge" layer for an LLM-assisted (but LLM-optional) workflow tool.
User setup: Live 12 Suite, MIDI + drum-rack centric, Arrangement-view workflow,
house/techno + trap. Priorities: motif → song sections, fast variation ideation,
drum assistance; later, data-driven mixing feedback.

## The fundamental constraint

Every third-party approach is a client to the same underlying surface: Live's internal
Python API (`Live` module, used by MIDI Remote Scripts) and its mirror, the Live Object
Model (LOM) exposed to Max for Live. The new Extensions SDK is the first genuinely
separate, officially supported surface — but currently a much smaller one. No tool can
exceed what Ableton exposes; options differ in transport, ergonomics, stability, and
how much of the surface they wrap.

## 1. Approaches

### Max for Live + LOM (the surface Producer Pal builds on)
- Only officially documented route pre-SDK. Full LOM: transport, session + arrangement
  clips, MIDI note editing (probability/MPE), device params, rack chains, undo/redo,
  `duplicate_clip_to_arrangement`, warp markers (read), cue points.
- Live 12.3 (Nov 2025) added `Track.insert_device`, `Chain.insert_chain` etc. —
  device loading finally in the LOM.
- Only M4L can do: undo-free parameter control (`live.remote~`), Live 12 MIDI Tools,
  custom in-device UI, audio-rate processing.
- Gaps (apply to everything LOM-based): no warp-marker write, no clip move/trim/split
  primitives on the timeline (workarounds exist), automation/clip envelopes only
  partially exposed, no render/freeze/consolidate, no VST internals beyond published
  params.
- Refs: https://docs.cycling74.com/apiref/lom/ · Live 12 release notes.

### AbletonOSC (ideoforms) / ableton-js (leolabs)
- Remote-script bridges exposing the LOM over OSC (UDP) / JSON-UDP respectively.
  Both maintained (AbletonOSC commits through Nov 2025; ableton-js v4.x, Live 12 fixed).
- Both thin on exactly what we need most: arrangement editing, browser/device loading.
  AbletonOSC is Session-view-centric; ableton-js is driven by AbleSet's live-performance
  needs.
- Refs: https://github.com/ideoforms/AbletonOSC · https://github.com/leolabs/ableton-js

### Raw MIDI Remote Scripts (Python, undocumented)
- The capability ceiling: full `Live` module incl. `Application.browser` +
  `load_item()`, `begin_undo_step`/`end_undo_step`. This is how the MCP wave
  (ahujasid 2.9k★, bschoepke, LivePilot) is built.
- Zero stability guarantees; Live 12 = Python 3.11 (broke all decompilers); runs on
  Live's main thread (blocking = UI freeze); "NO support" from Ableton.
- bschoepke/ableton-live-mcp is the most interesting architecture: evals arbitrary
  Python against the LOM instead of fixed tools + an "Agent Audio Tap" M4L device for
  in-chain audio capture. Experimental; author warns of Set corruption.
- Refs: https://github.com/gluon/AbletonLive12_MIDIRemoteScripts ·
  https://github.com/bschoepke/ableton-live-mcp · https://github.com/dreamrec/LivePilot

### Ableton Extensions SDK (June 2026) — deep-dive verified from SDK tarballs + full API reference
- TypeScript/Node extensions (`.ablx` zip) running in a real Node.js process
  ("Extension Host") that ships inside Live. **Suite 12.4.5 BETA only** as of Aug 2026
  (latest stable is 12.4); Centercode beta signup required; SDK is non-redistributable
  (not on npm).
- **CLI-bridge feasibility: PROVEN.** Extensions can open sockets, run HTTP/WebSocket
  servers, spawn child processes, use npm packages. Two shipped examples:
  OthmanAdi/loophole (MCP over HTTP on 127.0.0.1:8420+, bearer token, `bridge.json`
  discovery handshake) and jasper-zheng/ableton-sdk-mcp (WebSocket :17890 + external
  stdio shim). So "extension hosts a server, external CLI drives it, LLM optional"
  works today.
- API surface v1.0.0 (complete): song tempo/scale-read/cue points, track CRUD +
  mixer params, MIDI clips (whole-array note replace, probability etc.), audio clip
  creation from file with warp/loop settings, take lanes, `clearClipsInRange`,
  device list/insert (stock devices, default preset only)/delete, racks/drum racks,
  Simpler `replaceSample`, param get/set, `renderPreFxAudio` (audio tracks only,
  pre-FX → WAV), `importIntoProject`, `withinTransaction` (one undo step),
  modal webview UI + context-menu actions + progress dialogs.
- **Confirmed missing (v1.0.0):** transport entirely (no play/stop/fire/playhead),
  automation read/write, MIDI CC, clip gain, routing, browser/preset/VST loading,
  time-signature/scale write, groove pool, warp-marker write, track color, locator
  time write, freeze/flatten/consolidate/export, **any event/observer API** (poll
  only; invocation is menu-click or a server you run yourself), Max for Live
  integration, hardware surfaces.
- Stability: API frozen at 1.0.0-beta but behavior shifting in point releases
  (e.g. 2026-08-12: `renderPreFxAudio` stopped normalizing); a stricter OS file
  sandbox is announced and will break extensions that write outside
  `storageDirectory`/`tempDirectory`. Ableton calls it "an experimental playground"
  and a "starting point".
- Ecosystem: ~31 extensions on https://ablx.live, ~79 GitHub repos in 2 months;
  no store/review/signing; install = drag .ablx + restart Live.
- Refs: https://ableton.github.io/extensions-sdk/ ·
  https://github.com/RyanJarv/ableton-extensions-sdk-reference ·
  https://github.com/OthmanAdi/loophole · https://github.com/jasper-zheng/ableton-sdk-mcp ·
  https://help.ableton.com/hc/en-us/articles/27303428331420-Ableton-Extensions-FAQ

### Producer Pal (adamjmurray/producer-pal) — v2.1.0, Aug 2026
- Single M4L device; Node-for-Max server bridged to the Live API engine over JSON.
  Requires Live 12.3+ w/ M4L (some features 12.4+). GPL-3.0, free, trademarked name.
  Very active solo project (~6,000 commits, monthly minor releases).
- **Three interfaces on port 3350: MCP, plain REST API (AI-optional, curl-able), and
  a browser chat UI** (any provider incl. Ollama). Plus a portable Agent Skill for
  Claude Code that drives the REST API. This is exactly the "CLI-first, LLM-optional"
  model.
- 21 tools: tracks/mixing/routing, MIDI clips in three LLM-oriented notations
  (default `bar|beat`), math-expression transforms (LFO shapes, ramps, `swing()`,
  `quant()`, per-clip broadcast), audio clip placement + warp, **arrangement: place,
  move, split, duplicate, locators, take lanes**, scenes + per-scene tempo, device
  add/read/write incl. deep control of 9 native devices, Drum Rack building,
  browser/library search + sample similarity, transport/playback control, per-project
  memory/context files, presets, subagents.
- Limitations: no automation or clip envelopes at all; no VST/AU internals (manual
  Configure-mode mapping workaround); no audio analysis (offloaded to companion
  skills; mix rendering macOS-only); Live's undo lumps multi-step AI edits; a
  handful of open bugs (batched update timeouts, quantize no-op, drum-pad delete).
- Refs: https://github.com/adamjmurray/producer-pal · roadmap + limitations docs in repo.

### ClyphX Pro
- Commercial action-list scripting; alive for Live 12.1+ but community-carried;
  fixed action vocabulary; fire-and-forget triggers, not a query API. Not a fit as a
  primary bridge; possibly useful as a user-side macro layer later.

## 2. Cross-option gaps that no bridge solves today

| Gap | State |
|---|---|
| Automation / clip envelopes | Absent in Extensions SDK and Producer Pal; partially reachable via LOM/remote scripts (buggy in the MCPs that tried); offline `.als` XML editing is a proven-but-risky workaround (Hurliman, Dec 2025) |
| Warp-marker write | Nowhere (SDK reads them; LOM reads them; write is WIP behind a Producer Pal debug flag) |
| Post-FX audio capture via API | Nowhere directly. Options: manual export, M4L audio-tap device (bschoepke pattern), macOS-only companion skills, or SDK pre-FX render + freeze/flatten by hand |
| Rendering/export/freeze | No API anywhere |
| VST/AU preset + parameter internals | Published/configured params only, everywhere |

## 3. Lessons from the ecosystem (recurring across the strongest projects)

1. Give the agent **ears**: measurement of rendered audio is the #1 gap everyone hits.
2. Deterministic, validated tools beat piles of ad-hoc LLM actions for reliability;
   eval-a-language beats fixed tools for coverage. Best projects offer both.
3. Map every mutation to Live's undo stack (one logical action = one undo step).
4. Validate names (devices, samples) against an index to stop hallucination.
5. Keep state summaries compact — token cost is a real constraint in practice.
6. Community consensus: AI as assistant/iterator is valued; one-shot "make me a track"
   is universally panned. Producer Pal's philosophy ("help people make music, not make
   it for them") matches our goals.

## 4. LLM + symbolic music findings (for the generation layer, bridge-independent)

- Frontier LLMs are strong on symbolic/MIDI reasoning when the representation is
  bar-aligned, explicitly quantized text (ABC or note lists); they are near-ceiling on
  rhythm/melody/harmony tasks given symbolic input but cannot audit results by ear
  (arXiv 2510.22455).
- Failure modes: weak long-range structure, format mis-selection. Mitigations:
  constrain with scale/key/density parameters, validate against grid/range, keep a
  human audition loop tight (exactly our "generate N variations, I pick" workflow).
- Composer's Assistant 2 (REAPER) is the reference for track-measure infilling with
  explicit controls (rhythmic conditioning, note density, pitch interest) —
  a model for our variation-parameter vocabulary. arXiv 2407.14700.
- Ableton Live 12's native MIDI Tools (Generators/Transformations) cover simple
  rhythmic/arp generation; our value-add is motif-aware, arrangement-aware operations
  they can't do.
