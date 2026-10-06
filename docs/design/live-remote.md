# Design: AWH Remote (M12 — transport, clip launch, lean M4L consolidation)

- Status: built, pending owner validation in Live (2026-08-24). Code, tests,
  and the M4L device/docs are complete. The owner performance protocol and
  the fire/scene/jump/re-init checklist below still need a real Live run;
  see docs/dev-loop.md's "M12 (AWH Remote) owner checklist". Owner asks:
  (1) close the transport / clip-launch gap (the Extensions SDK has neither;
  the LOM does), and (2) fix the Capture Tap's reported performance impact
  on Live.
- Diagnosis first: the committed tap patch is already minimal (24 objects,
  no timers, no UI meters, event-driven throughout). The reported heaviness
  is therefore likely environmental: an unfrozen device, an open Max editor
  window, a freeze that picked up template UI, or plain per-device M4L
  runtime overhead. The rebuild consolidates rather than slims: one device
  instead of an accumulating family, plus a measurement protocol to identify
  the real cause on the owner's machine.

## The device: `m4l/AWH Remote.maxpat` (supersedes the Capture Tap)

Same ports (9720 listen / 9721 reply), superset protocol; existing CLI
capture flows work unchanged:

| Message | Action |
|---|---|
| `/awh/ping` → `/awh/pong <version>` | liveness (version bumps to 2) |
| `/awh/record <path>` / `/awh/stop` | sfrecord~ capture (unchanged) |
| `/awh/loop <startBeat> <lenBeats>` / `/awh/play <0\|1>` | transport (unchanged) |
| `/awh/fire <trackIdx> <slotIdx>` | Session clip slot `call fire` (respects launch quantization) |
| `/awh/scene <sceneIdx>` | scene `call fire` |
| `/awh/stopclips <trackIdx>` (−1 = all) | `call stop_all_clips` on the track / set |
| `/awh/jump <beats>` | set `current_song_time` (arrangement playhead) |
| replies | `/awh/status ...` per action, `/awh/error <text>` on bad indices |

Design-for-lightness rules (also the review checklist for any future AWH
device): zero free-running timers; no UI objects beyond the port number
boxes and the manual re-init button; every LOM object created once and
re-bound only via the re-init button (the Ducker's live.path lesson:
loadbang alone silently breaks on paste-reload); no print objects in the
shipped patch. One AWH device per Set, total.

## Owner performance protocol (before/after, goes in m4l/README.md)

1. Baseline: Live's CPU meter + audio dropout count over 60 s of normal
   playback, no AWH device.
2. Add the frozen device, editor closed: repeat. Then unfrozen / editor
   open: repeat. This isolates patch cost from environment cost.
3. Record the three numbers in the dev-loop checklist. If the frozen device
   still costs meaningfully, that is a real patch problem to escalate. The
   object inventory suggests it will not.

## CLI

- `awh play [--from-bar N]` / `awh stop`: transport. `awh jump <bar>`.
- `awh launch track:N/slot:M` and `awh launch scene:N`: fire, echoing the
  device's reply (or a clear "requires the AWH Remote device on port 9720"
  error offline, same convention as `op verify`).
- `awh stop-clips [track:N]`.
- `awh lib audition <slug> <track> [--keep]`: `lib place` into an empty
  slot, fire it, print what is playing. Without `--keep`, a follow-up
  `awh lib audition --end` (or auditioning the next slug) removes the
  auditioned clip by its exact name (never a prefix sweep).
- All OSC sends ping first with a ~1 s timeout; sockets are closed so the
  process exits (capture-command convention).

## Verification

- Node: OSC encoding for the new messages; full-sequence integration
  against a fake UDP device (reply pong + record messages); negative
  control: no listener → clear error, no hang. `lib audition` end-to-end
  against serve-fake (gateway) + fake UDP device (fire) together;
  zero-empty-slots and unknown-slug states.
- Owner checklist: fire/scene/jump audibly work with launch quantization;
  the re-init button recovers after a paste-reload; performance protocol
  numbers recorded; migration from the old tap (one device replaces it,
  same ports).

## Out of scope

Automation writing (no API anywhere except the LOM's clip envelopes; a
future device could add it, one thing at a time); MIDI-note streaming;
anything that would add a timer to the device.
