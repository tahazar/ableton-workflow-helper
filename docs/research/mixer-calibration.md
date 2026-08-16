# Research: `track.mixer` raw↔dB calibration (seed data)

Context: `track.mixer`/`device.param` write the Extensions SDK's RAW internal
parameter value (`[min, max]` from `device.get`/`TrackMixer.volume`), not dB.
For the volume parameter this range is `[0, 1]`, but the mapping from raw to
the dB Live's UI displays is a non-linear taper, not exposed by the SDK. This
is seed data for that mapping — a full curve fit is M1 follow-up work, not
done here.

## Method

Live 12.4.5 beta, `awh call track.mixer --args '{"path":"track:0","volume":<raw>}'`,
reading the dB shown on that track's volume fader in Live's mixer after each
call. Manual observation (SDK doesn't expose a raw→dB accessor).

## Measured points

| raw value | dB shown |
|---:|---:|
| 0.0  | -inf (silence) |
| 0.4  | -18.0 |
| 0.7  | -6.0 |
| 0.85 | 0.0 (unity) |
| 1.0  | +6.0 |

## Observations

- **0.85 = unity (0 dB), 1.0 = +6 dB** — matches Live's documented fader
  ceiling of +6 dB, and is consistent with the raw↔dB curve informally
  reverse-engineered by the Live API / control-surface-scripting community
  (e.g. Ableton Live MIDI Remote Script authors): the top segment above unity
  is linear, `dB = (raw - 0.85) / 0.15 * 6`.
- Below unity the curve is **not linear** in this raw range: 0.7→0.85 (0.15
  raw) spans -6→0 dB (6 dB), while 0.4→0.7 (0.3 raw) spans -18→-6 dB (12 dB) —
  the slope (dB per raw unit) roughly doubles as raw decreases, consistent
  with a fader-taper (log-like) curve rather than a single linear segment.
- 0.0 clamps to -inf (full mute), not a finite floor.

## Open work (M1 follow-up)

- Sample more points (e.g. 0.1, 0.2, 0.5, 0.6, 0.75, 0.9, 0.95) to fit the
  sub-unity segment(s) properly — likely 2-3 piecewise linear or one smooth
  curve, not yet determined from 5 points.
- Decide whether `awh`/ops should expose a `volumeDb` convenience arg that
  converts to raw internally (Producer Pal / loophole precedent), or leave
  raw-only and document the mapping for callers.
- Repeat the same exercise for `pan` and `sends` — not yet measured at all.
