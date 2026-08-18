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

The Extensions SDK exposes only normalized raw 0..1 `device.param` values —
no display string, no transfer function. `awh mix duck calibrate` drives
Threshold by raw value alone, so it can converge on a target dB depth
without ever knowing what Live's UI actually shows. This entry is the
owner's real UI readout at one specific calibrated raw point, the same gap
`docs/research/mixer-calibration.md` documents for `track.mixer`.

**Single-point snapshot, not a curve**: only one raw value was read per
param here. Do NOT assume linearity in display units from a single point —
e.g. Threshold's raw range is `[0, 1]` with `defaultValue` raw 0.85 (an
unread point), so raw 0.5 -> -14.0 dB does not imply raw 0 -> 0 dB or any
other extrapolation. Treat every row below as its own fact, not a formula,
until more points are read.

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

Also visible on the same device but not yet correlated to a specific raw
`device.param` read (sidechain EQ / metering section, for context only):
Freq 80 Hz, Res(onance) 0.71, Expansion ~1.74 dB, Peak -13.4 dB, Knee 6.0 dB,
Out 0.00 dB.

## The rule

- **Ratio raw max (1.0) = `inf:1`** — confirms `duck setup`'s "Ratio max"
  preset is a hard-limiting ratio, not just "very high": matches the
  intended trigger-locked, all-or-nothing duck behavior the toolchain is
  built around.
- **Attack raw min (0.0) = 0.01 ms** — confirms `duck setup`'s "Attack
  fastest" preset is effectively instant, consistent with the
  `sidechain-template` fact that a correctly-functioning duck starts at the
  trigger's exact timing with no attack-detection latency.
- **Release raw ~0.157 = 30.0 ms** — this was `duck calibrate`'s starting
  Release value (left over from an earlier `duck fit`-informed manual dial,
  not touched by `calibrate` itself — `calibrate` only ever moves Threshold).
  30 ms is short/tight for a release; useful reference point for anyone
  hand-tuning Release against a `duck fit` recommendation on future tracks.
- **Threshold raw 0.5 = -14.0 dB**, the value that converged this project's
  duck to ~5-7 dB of measured depth against a 6 dB target (see
  `docs/dev-loop.md`'s Duck toolkit checklist). Not a universal number —
  it's specific to this material's levels, kept here as a real reference
  point rather than a rule to reapply elsewhere.
