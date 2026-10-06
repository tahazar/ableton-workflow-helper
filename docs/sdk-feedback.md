# Extensions SDK feedback (for Ableton's beta channel)

Limitations hit while building AWH against `@ableton-extensions/sdk`
v1.0.0-beta.1 on Live 12.4/12.5 beta (macOS). Each is reproducible in this
repo; file paths show where we hit it. To be submitted through the beta
program's feedback channel.

## Blocking gaps (features we could not build)

1. **No transport control and no session clip-launch API.** No
   play/stop/position, no firing a session clip slot or scene, no
   `stop_all_clips`. This is the SDK's clearest gap: "press play" is core to
   any DAW automation, and the LOM has had all of it (`Song.
   start_playing`/`stop_playing`/`current_song_time`, `ClipSlot.fire()`,
   `Scene.fire()`, `Track.stop_all_clips()`) for years. None of it is
   exposed through `@ableton-extensions/sdk` v1.0.0-beta.1. We work around
   it with an M4L device over OSC (`m4l/AWH Remote.maxpat`), which also
   covers post-FX capture (superseding the AWH Capture Tap). Every one of
   these operations then needs a sidecar Max device loaded by hand in every
   Set, only to reach LOM surface the SDK could expose directly. Ask:
   `Song.startPlaying()`/`stopPlaying()`/`currentSongTime`,
   `ClipSlot.fire()`/`Scene.fire()`/`Track.stopAllClips()` (or equivalent)
   on the SDK's own object model.
2. **No raw↔display mapping for DeviceParameter.** Only normalized raw
   values are exposed: no display string, no transfer function. Effect:
   `awh mix duck calibrate` can converge on a measured target but cannot
   report what Threshold reads in Live's UI, and `track.mixer` volume needed
   empirical calibration (raw 0.85 = 0 dB; docs/research/mixer-calibration.md,
   knowledge/setup/compressor-raw-display-mapping.md). Ask: a
   `displayValue` accessor (or value↔display conversion) on DeviceParameter.
3. **No routing API.** A compressor's sidechain Audio From (or any
   input/output routing) cannot be set. Effect: "automatic sidechain" keeps
   one manual click. Ask: read/write routing on tracks/devices.
4. **No automation / clip-envelope API.** Volume-automation ducking,
   envelope following, and any parameter automation writing are out.
   (Accepted in ADR-001; the biggest capability gap besides #1.)
5. **Packaged .ablx never activates** (v1.0.0-beta.1). manifest.json +
   dist/main.js install correctly to the extensions folder and match the
   SDK's examples, but the extension never starts: no ExtensionHost.txt,
   nothing in Log.txt, no error, with Developer Mode on and multiple
   restarts. Dev-mode (`extensions-cli run`) works fully. (First hit:
   2026-08-17.)

## Paper cuts

6. **DrumChain has no name accessor.** Pad names must be inferred from the
   chain's first device name (packages/extension/src/sdkLiveBridge.ts).
7. **Session clip `duration` is unreliable.** endMarker − startMarker is
   the working formula for session clips; `duration` behaves for arrangement
   clips only.
8. **Node globals need explicit imports.** The Extension Host sandbox
   requires explicit imports for Node globals (e.g. `URL`) that are ambient
   in normal Node. If intentional, the SDK guide should document it.
   (`sfrecord~`-style completion acks are a Max issue, not covered here.)
9. **`device.insert` fails with a generic error for Simpler** while other
   stock devices work. Unclear whether the name string differs or it is
   unsupported (under investigation).

## Nice-to-haves

- Eventing/observers (poll-free change notification), browser/preset access,
  clip move/split, cue-point write access (we fake section markers with
  named empty clips because cue points are read-only).
