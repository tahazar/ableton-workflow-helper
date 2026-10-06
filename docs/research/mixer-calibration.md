# Research: `track.mixer` raw↔dB calibration (seed data)

Context: `track.mixer`/`device.param` write the Extensions SDK's raw internal
parameter value (`[min, max]` from `device.get`/`TrackMixer.volume`), not dB.
For volume the range is `[0, 1]`, but the mapping from raw to the dB shown in
Live's UI is a non-linear taper the SDK does not expose. This is seed data for
that mapping; a full curve fit is gateway-core follow-up work, not done here.

## Method

Live 12.4.5 beta, `awh call track.mixer --args '{"path":"track:0","volume":<raw>}'`,
reading the dB shown on that track's volume fader in Live's mixer after each
call. Manual observation (the SDK has no raw→dB accessor).

## Measured points

| raw value | dB shown |
|---:|---:|
| 0.0  | -inf (silence) |
| 0.4  | -18.0 |
| 0.7  | -6.0 |
| 0.85 | 0.0 (unity) |
| 1.0  | +6.0 |

## Observations

- **0.85 = unity (0 dB), 1.0 = +6 dB.** This matches Live's documented fader
  ceiling of +6 dB and the raw↔dB curve informally reverse-engineered by the
  Live API / control-surface-scripting community (e.g. Ableton Live MIDI
  Remote Script authors): the top segment above unity is linear,
  `dB = (raw - 0.85) / 0.15 * 6`.
- Below unity the curve is not linear in this raw range. 0.7→0.85 (0.15 raw)
  spans -6→0 dB (6 dB), while 0.4→0.7 (0.3 raw) spans -18→-6 dB (12 dB). The
  slope (dB per raw unit) roughly doubles as raw decreases, consistent with a
  fader-taper (log-like) curve rather than one linear segment.
- 0.0 clamps to -inf (full mute), not a finite floor.

## Open work (gateway-core follow-up)

- Sample more points (e.g. 0.1, 0.2, 0.5, 0.6, 0.75, 0.9, 0.95) to fit the
  sub-unity segment(s): likely 2-3 piecewise linear segments or one smooth
  curve, not yet determinable from 5 points.
- Decide whether `awh`/ops should expose a `volumeDb` convenience arg that
  converts to raw internally (Producer Pal / loophole precedent), or stay
  raw-only and document the mapping for callers.
- Repeat for `pan` and `sends`, which are not yet measured.
