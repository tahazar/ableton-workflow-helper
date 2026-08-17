# Ableton Workflow Helper (awh)

CLI-first workflow accelerator for Ableton Live: deterministic tools for the
tedious parts of producing — section building, variation ideation, drum
programming, measurement-based mix feedback — orchestrated conversationally by
an LLM when you want, fully scriptable without one.

Built on the [Ableton Extensions SDK](https://ableton.github.io/extensions-sdk/)
(Live 12 Suite beta): one thin **gateway extension** inside Live exposes typed
operations over localhost HTTP; the **`awh` CLI** and analysis tooling do the
real work outside.

## Status

**M0–M6 + B3 done (all validated in Live) · B4 (knowledge base) in build** —
the gateway serves 23 ops; the `awh` CLI speaks bar|beat notation; the `awh`
Claude skill drives the Set conversationally; `awh vary` generates seeded,
reproducible variations through a 17-transform pipeline vocabulary; `awh
sections` builds a 4-minute seeded arrangement skeleton from source loops via
editable YAML plans; `awh save`/`awh lib` grow a git-versioned clip library
that mirrors into Live's own browser as a tagged Pack of .alc Live Clips; and
`awh drums` generates/reworks pad-aware drum patterns (house/techno/trap).
`awh mix` (M6, validated) — a Python measurement engine (LUFS/dBTP/PSR,
third-octave spectrum vs measured genre targets, stereo/phase, pump
verification) + an M4L capture tap for post-FX renders and loudness-matched
A/B (`docs/design/analysis-engine.md`); the `awh mix duck` toolkit fits
sidechain envelopes to the owner's drums (ShaperBox drawing instructions or
closed-loop stock-Compressor calibration). B4 (in build): `awh kb` — the
tiered, executable-first knowledge base with open-ended domains, measurement
records as citizens, and data-driven drum styles.
Backlog candidates B1 (audio-to-MIDI) and B2 (Operator sound design) are
researched and queued — see `docs/spec.md`.
See [`docs/spec.md`](docs/spec.md) for requirements + milestones,
[`docs/decisions/`](docs/decisions/) for ADRs, and
[`docs/research/`](docs/research/) for the landscape/mixing/reference research.

## Layout

| Path | What |
|---|---|
| `packages/core` | SDK-free heart: `LiveBridge` interface, gateway server, op registry, (soon) notation + transforms. Fully testable without Live |
| `packages/extension` | The ONLY SDK import site; thin shell wiring activation → gateway server; builds to `.ablx` |
| `packages/cli` | `awh` — ping/status/ops/call/serve-fake (grows per milestone) |
| `analysis/` | Python measurement engine (`awh_analysis`) behind `awh mix` — BS.1770 loudness, spectrum, phase, dynamics |
| `m4l/` | AWH Capture Tap: M4L device for post-FX capture + transport, OSC-driven |
| `library/` | Git-versioned clip library (+ measured mix targets); mirrors into Live's browser |
| `scripts/setup-sdk.mjs` | Extracts the (never-committed) SDK from `vendor/ableton-sdk/` |
| `docs/dev-loop.md` | Setup + everyday development loop + M0 verification checklist |

## Quickstart (no Live needed)

```sh
pnpm install && pnpm build && pnpm test
node packages/cli/dist/index.js serve-fake &
node packages/cli/dist/index.js ping
```

For the real thing (Live 12 Suite beta + SDK): see
[`docs/dev-loop.md`](docs/dev-loop.md).

## License

MIT (see [LICENSE](LICENSE) and [ADR-002](docs/decisions/ADR-002-licensing.md)).
The Ableton Extensions SDK is not included and must be obtained from Ableton's
beta program.
