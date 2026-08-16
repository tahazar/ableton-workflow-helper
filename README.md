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

**M0 done · M1 done (validated in Live) · M2 built (awaiting in-Live pass)** —
the gateway serves 23 operations; the `awh` CLI speaks bar|beat notation
(`clip read/write/create`, `render`), and the `awh` Claude Code skill lets a
local session drive the Set conversationally. Next: M3 (variation engine).
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
