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

Prerequisite for Operator sound design: what `device.get`/`device.param` can
see and move is plugin-specific. There is no blanket native-vs-3rd-party
split, so no single answer covers all VSTs.

## Executable

Three `device.get` dumps from a live Set (device paths as probed; re-derive
from your own `awh status`, since indices shift):

| Device | Kind | Params exposed | Real names? |
|---|---|---|---|
| Operator | native | **195** | yes: every oscillator/envelope/filter param (`Osc-A Coarse`, `Ae Attack`, `Algorithm`, ...) |
| OTT | 3rd-party VST (Xfer) | 20 | yes: real names (`Depth`, `Time`, `Thresh L/M/H`, `Gain L/M/H`, `Upwd/Dnwd Strgth`, ...) |
| Serum 2 | 3rd-party VST (Xfer) | 1 | only `Device On`: no macros, no filter/osc params |

`device.param` moves a real param, not only reports it: Operator's `Volume`
set 0.4 → 0.7, read back 0.7.

## The rule

- Native Ableton devices (Operator, EQ Eight, Compressor, ...) are fully
  addressable: 195 real params on Operator, matching every native device
  probed before.
- 3rd-party VST3 plugins are not uniformly opaque. OTT exposes its full real
  parameter set, as a native device would. "3rd-party = only Device On" held
  for the earlier probes (ShaperBox 3, the AWH Ducker M4L device) only because
  of which plugins those were.
- Serum 2 exposes almost nothing (1 param). Leading hypothesis, unconfirmed:
  Serum's host-automation surface is limited to what is mapped to its internal
  macro knobs (a long-standing Serum design: internal synth parameters reach
  the host only through a macro slot), and this instance had zero macros
  assigned. Open question: map 2-3 Serum 2 macros by hand in its UI and re-run
  `device.get`. If the exposed param count then matches the macro count, the
  hypothesis holds and the workaround is to map anything you want automatable
  to a macro first. Until then, assume Serum 2 is opaque but treat the root
  cause as unconfirmed.
- Implication for Operator sound design: Operator is fully controllable from
  `awh` today. A Serum-targeting feature (e.g. sound-design co-write via
  `device.param`) needs the macro-mapping workaround confirmed, or is out of
  reach for this synth via the current SDK.
