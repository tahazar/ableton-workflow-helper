---
slug: device-parameter-surface
topic: setup
tier: verified
tags:
  - device-param
  - serum
  - operator
  - ott
  - sdk
  - b2
sources: ["own analysis: awh call device.get against a real Live Set, 2026-08-18"]
related: [docs/sdk-feedback.md]
---
# Device parameter surface: native vs 3rd-party VST

B2 prerequisite: what `device.get`/`device.param` can actually see and move
is **plugin-specific, not a blanket native-vs-3rd-party split** — the
original "is the plugin-parameter question folklore" framing assumed one
answer would cover all VSTs. It doesn't.

## Executable

Three real `device.get` dumps from a live Set (device paths as probed,
re-derive from your own `awh status` since indices shift):

| Device | Kind | Params exposed | Real names? |
|---|---|---|---|
| Operator | native | **195** | yes — every oscillator/envelope/filter param (`Osc-A Coarse`, `Ae Attack`, `Algorithm`, ...) |
| OTT | 3rd-party VST (Xfer) | **20** | yes — real names (`Depth`, `Time`, `Thresh L/M/H`, `Gain L/M/H`, `Upwd/Dnwd Strgth`, ...) |
| Serum 2 | 3rd-party VST (Xfer) | **1** | only `Device On` — nothing else, no macros, no filter/osc params |

`device.param` confirmed to genuinely move a real param, not just report
it: set Operator's `Volume` 0.4 → 0.7, read back 0.7.

## The rule

- **Native Ableton devices (Operator, EQ Eight, Compressor, ...): fully
  addressable.** Confirmed again here (195 real params on Operator);
  matches every native device probed in earlier milestones.
- **3rd-party VST3 plugins are NOT uniformly opaque.** OTT (3rd-party)
  exposes its full real parameter set, same as a native device would.
  Assuming "3rd-party = only Device On" (the prior working assumption) is
  wrong — it happened to be true for every 3rd-party plugin probed before
  this pass (ShaperBox 3, the AWH Ducker M4L device) by coincidence of
  which plugins those were, not because 3rd-party plugins are inherently
  opaque to the SDK.
- **Serum 2 specifically exposes almost nothing (1 param).** Leading
  hypothesis, not yet confirmed: Serum's host-automation surface is
  limited to whatever's explicitly mapped to its own internal "macro"
  knobs (a long-standing Serum design — the plugin doesn't expose every
  internal synth parameter to the host, only what's patched to a macro
  slot), and this probed instance had zero macros assigned. **Open
  question for a follow-up pass**: map 2-3 Serum 2 macros by hand in its
  own UI, then re-run `device.get` — if the macro count then matches the
  exposed param count, this confirms the hypothesis and gives a real
  workaround (map what you want automatable to a macro first). Until that
  follow-up runs, treat "Serum 2 is opaque" as the safer assumption but
  the ROOT CAUSE as unconfirmed.
- **Practical implication for B2 (Operator sound design)**: Operator is
  fully controllable from `awh` today — no blocker. A `Serum`-targeting
  feature (e.g. sound-design co-write via `device.param`) would need
  either the macro-mapping workaround confirmed above, or would simply be
  out of reach for this specific synth via the current SDK.
