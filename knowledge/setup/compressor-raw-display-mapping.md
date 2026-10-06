---
slug: compressor-raw-display-mapping
topic: setup
tier: verified
tags:
  - compressor
  - sidechain
  - duck
  - calibration
  - raw-values
sources: ["owner UI readout, 2026-08-17 (post duck-calibrate verification pass)"]
related: [setup/sidechain-template, docs/research/mixer-calibration.md]
---
# Stock Compressor: raw<->display value mapping

The Extensions SDK exposes only normalized raw 0..1 `device.param` values,
with no display string and no transfer function. `awh mix duck calibrate`
drives Threshold by raw value alone, so it can converge on a target dB depth
without knowing what Live's UI shows. This entry records the owner's UI
readout at one calibrated raw point. `docs/research/mixer-calibration.md`
documents the same gap for `track.mixer`.

**Single-point snapshot, not a curve**: one raw value was read per param. Do
not assume linearity in display units. Threshold's raw range is `[0, 1]` with
`defaultValue` raw 0.85 (an unread point), so raw 0.5 -> -14.0 dB does not
imply raw 0 -> 0 dB or any other extrapolation. Treat each row below as its
own fact, not a formula, until more points are read.

## Executable

Raw -> display, read from Live's Compressor UI on the calibrated Bass + Mels
device (`track:5/dev:0` in the kick/snare/hat/bassline test project) right
after a `duck calibrate` run that converged on this Threshold:

| Param (device.get name) | Raw value | Live UI display |
|---|---|---|
| Threshold | 0.5 | -14.0 dB |
| Ratio | 1.0 (max) | inf:1 |
| Attack | 0.0 (min) | 0.01 ms |
| Release | 0.157 (~0.1569925993680954) | 30.0 ms |

Also visible on the same device but not correlated to a specific raw
`device.param` read (sidechain EQ and metering section, context only):
Freq 80 Hz, Res(onance) 0.71, Expansion ~1.74 dB, Peak -13.4 dB, Knee 6.0 dB,
Out 0.00 dB.

## The rule

- Ratio raw max (1.0) = `inf:1`. `duck setup`'s "Ratio max" preset is a
  hard-limiting ratio, matching the trigger-locked, all-or-nothing duck the
  toolchain is built around.
- Attack raw min (0.0) = 0.01 ms. `duck setup`'s "Attack fastest" preset is
  effectively instant, consistent with the `sidechain-template` fact that a
  working duck starts at the trigger's exact timing with no attack-detection
  latency.
- Release raw ~0.157 = 30.0 ms. This was `duck calibrate`'s starting Release,
  left from an earlier manual dial informed by `duck fit` (`calibrate` only
  moves Threshold). 30 ms is a short release; a reference point for
  hand-tuning Release against a `duck fit` recommendation.
- Threshold raw 0.5 = -14.0 dB, the value that converged this project's duck
  to ~5-7 dB of measured depth against a 6 dB target (see `docs/dev-loop.md`'s
  Duck toolkit checklist). It is specific to this material's levels: a
  reference point, not a rule to reapply elsewhere.
