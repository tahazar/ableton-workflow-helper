# Ableton Workflow Helper (awh)

A command-line toolkit for Ableton Live. It automates the tedious parts of
producing a track: drum programming, phrase writing, arrangement building,
sound design starting points, and measurement-based mix feedback. Output is
deterministic and seeded, so any result can be regenerated exactly. An LLM
agent can drive it through the agent skill in `.claude/skills/awh`, but
nothing requires one.

Built on the [Ableton Extensions SDK](https://ableton.github.io/extensions-sdk/)
(Live 12 Suite, currently in beta). A small gateway extension runs inside
Live and exposes typed operations over localhost HTTP. The `awh` CLI, a
Python analysis engine, and two Max for Live devices work from outside.

## What it does

Writing and generating:

- `awh drums`: pad-aware drum patterns for house, techno, trap, and
  dubstep, built from style specs you edit as YAML without recompiling.
  Pattern statistics mined from a 22,000-loop open dataset back the styles'
  assumptions (or contradict them, which is recorded too).
- `awh drop`: call-and-response phrase writing for drops. Write a short
  call and `drop respond` answers with candidates built from named
  gestures (echo low, truncate to a stab, invert the contour).
  `drop phrase` writes two-voice 8/16-bar skeletons.
- `awh chords`: in-scale progressions with voice leading and roman numeral
  input.
- `awh vary` / `awh sweep`: seeded variations of existing clips through a
  17-transform vocabulary.
- `awh clip from-audio`: melodic audio-to-MIDI via Basic Pitch. Hum an
  idea, get a clip.
- `awh op`: Operator sound design. Apply recipe patches from the knowledge
  base, or analyze an audio sample for a patch proposal. When a sound is
  outside Operator's reach, it reports the measurement that shows it
  instead of returning a bad patch.

Arranging and referencing:

- `awh sections`: build an arrangement skeleton from source loops via an
  editable YAML plan.
- `awh ref`: deconstruct a reference track (tempo, energy arc, section
  boundaries with confidence tags) into correctable marker clips in Live
  that can drive your own arrangement plan.
- `awh endless`: build an infinite, never-identical browser player for
  your song from bounced stems and a small grammar file: weighted section
  transitions, per-layer variant pools, continuous mix fluctuation. Any
  performance can be reproduced from its seed.

Mixing and measurement:

- `awh mix`: a Python measurement engine. BS.1770 loudness, true peak,
  PSR, third-octave spectrum against genre targets measured from your own
  reference tracks, stereo and phase checks, and loudness-matched A/B.
  Findings come with numbers.
- `awh mix duck`: sidechain tooling. Fit the ideal duck envelope to your
  drums, auto-calibrate a stock Compressor in a closed loop, or verify a
  ShaperBox-style pump against the trigger clip.
- The AWH Capture Tap (Max for Live) records post-FX audio and drives the
  transport, so measurements close the loop without manual bouncing.

Library and knowledge:

- `awh lib`: a git-versioned clip library that mirrors into Live's browser
  as a tagged Pack of `.alc` Live Clips. A right-click menu item in Live
  captures any clip into it.
- `awh kb`: a tiered knowledge base (verified / sourced / draft) of
  production craft with executable sections: drum style specs, phrase
  specs, Operator recipes, measurement records. Entries cite their sources
  and state what they could not verify.

## How it fits together

```
Ableton Live ── gateway extension (HTTP, localhost) ──┐
Live audio ──── AWH Capture Tap (M4L, OSC) ───────────┼── awh CLI (Node)
any audio ─────────────────────────────────────────────┴── awh_analysis (Python)
```

| Path | Contents |
|---|---|
| `packages/core` | SDK-free core: bridge interface, op registry, notation, transforms, generators. Testable without Live. |
| `packages/extension` | The only SDK import site. Builds to the gateway `.ablx`. |
| `packages/cli` | The `awh` command. |
| `analysis/` | Python measurement and analysis engine (`awh_analysis`). |
| `m4l/` | Max for Live devices: Capture Tap, Ducker (work in progress). |
| `knowledge/` | The knowledge base. `library/` holds clips, templates, and measurement records. |
| `docs/` | Spec, design docs, ADRs, research notes, validation checklists. |

## Getting started

Requirements: Live 12 Suite (beta) with the Extensions SDK enabled, Node 20+
with pnpm, Python 3.11+.

```sh
pnpm install && pnpm build
python3 -m venv .venv && .venv/bin/pip install -e analysis
# Basic Pitch (audio-to-MIDI) needs extra steps: see analysis/README.md
```

The Extensions SDK is not distributed with this repo; obtain it from
Ableton (see CONTRIBUTING.md). Run the gateway inside Live with the SDK's
`extensions-cli`, using the storage flags documented in `docs/dev-loop.md`
Troubleshooting. Without Live, `awh serve-fake` starts an in-memory Set
with the full op surface. The test suite and most development use it.

```sh
awh ping                      # is the gateway up?
awh status                    # tracks, clips, tempo
awh drums gen track:0 --style dubstep --seed 3
awh drop respond track:0/slot:0 track:1 --key "F minor"
awh endless demo -o /tmp/endless && cd /tmp/endless && python3 -m http.server
```

## Design principles

- Measurements and named gestures. Every generator output carries the
  seed, style, and recipe that produced it; every mix finding carries its
  number.
- Stated limits. Detectors ship with negative controls. When the tool
  cannot know something (one audio file cannot prove a sidechain is
  engaged; a sound can be outside a synth's gamut) it says so instead of
  guessing.
- Styles are data. Drum styles, phrase styles, and synth recipes live in
  knowledge entries as YAML you can edit and re-run without touching code.
- Ears decide. The tools propose, measure, and verify; they do not
  auto-apply taste.

## Status

Personal project, developed against the Live 12 Suite beta. Core features
are built and validated in a real Live set; per-feature validation
checklists are in `docs/dev-loop.md`. The SDK is in beta, so breakage on new
SDK drops is expected and tracked in `docs/sdk-feedback.md`. Start with
[`docs/spec.md`](docs/spec.md) for the requirement map and
[`docs/decisions/`](docs/decisions/) for the architecture decisions.

## License

MIT. The Ableton Extensions SDK, Ableton's documentation, and referenced
datasets are not included and carry their own licenses.
