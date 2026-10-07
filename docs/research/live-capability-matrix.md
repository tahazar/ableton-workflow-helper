# Live capability matrix: manual vs SDK vs M4L vs `awh`

- Status: draft, 2026-10-07
- Inputs: the Live 12 manual's chapter structure
  (`https://www.ableton.com/en/live-manual/12/`), the Extensions SDK API
  reference as vendored in `.claude/skills/ableton-extension/references/api.md`
  (API version `1.0.0`, verified against `@ableton-extensions/sdk@1.0.0-beta.1`
  dist types on the dev machine; `packages/extension/types/ableton-sdk-shim.d.ts`
  mirrors the subset we use), `m4l/README.md` (AWH Remote OSC protocol),
  `packages/core/src/bridge/{types,ops}.ts` (the op registry) and
  `packages/cli/src` (the `awh` commands), plus `docs/sdk-feedback.md`.
- Purpose: answer "can a terminal do what the GUI does?" per manual chapter,
  so the gap list is concrete. This is the first step of the "parity" track
  discussed on 2026-10-07; it is a research doc, not a spec.

## Sourcing caveats (read before trusting a row)

1. **The manual and SDK docs could not be fetched from the session that
   wrote this.** `ableton.com`, `ableton.github.io` and `help.ableton.com`
   are blocked by the cloud session's egress proxy, and the shared
   `google.com/goto` link resolves through a blocked host too. Chapter
   titles below come from the Live 12 manual as it is known to the author
   and from search-result snippets (which confirmed "3. Live Concepts",
   "6. Arrangement View", "26. Automation" as Live 12 numbering); chapter
   numbers are omitted for the rest. **Owner action:** open the manual
   link once on the dev machine and correct any chapter title here.
2. **The SDK column is API `1.0.0` as of `1.0.0-beta.1`.** The latest
   published docs (`ableton.github.io/extensions-sdk`) were unreachable;
   a web search found no `beta.2` or later. `pnpm setup:sdk` on the dev
   machine is the authority: if `EXTENSIONS_API_VERSIONS` lists anything
   above `1.0.0`, re-check every "SDK: no" row below.
3. **The M4L column is what `AWH Remote` implements today**, not what the
   Live Object Model (LOM) could do. A "could" note marks rows where the
   LOM has the call and only a patch change is needed; those are cheap.
4. **`awh` column** is the op registry plus the CLI commands that wrap it.
   "op only" means the bridge op exists (`awh call <op>`) but no friendly
   command wraps it.

Legend: **yes** = covered; **part** = covered with a listed restriction;
**no** = not possible through that layer; **could** (M4L only) = the LOM
has it, the patch doesn't yet.

## 1. Summary

| Layer | Manual chapters fully reachable | Partly | Not at all |
|---|---|---|---|
| SDK `1.0.0` alone | 0 | 11 | 10 |
| SDK + AWH Remote (M4L) as built | 0 | 14 | 7 |
| SDK + M4L at LOM ceiling (everything "could") | 2 | 15 | 4 |

Counts are the author's tally over the 21 producer-facing chapters in
sections 2 to 7 (setup, Push, video, fact sheets and shortcuts excluded)
and move by one or two depending on how "partly" is drawn; the rows are the
record, the counts are a reading aid. Full GUI parity is not
reachable: no layer can do automation writing, browser/preset/VST loading,
clip move/split, or anything the "no" rows list. Parity with the API
ceiling is reachable and is the sensible target: everything marked
**could** is a patch-level change, and everything the SDK already offers
but `awh` lacks (section 8) is a bridge method plus a fake.

## 2. Set, files and transport

| Manual chapter / GUI action | SDK 1.0.0 | M4L (AWH Remote) | `awh` today | Gap / note |
|---|---|---|---|---|
| **Live Concepts / First Steps** — open, create, save a Set | no | could (`live_app` has no save; LOM can't open Sets either) | no | Live's file menu is unreachable from every layer. Out of scope: the owner opens the Set. |
| Set tempo | yes (`Song.tempo`) | could | yes (`set.tempo`) | |
| Time signature | no (scene signature read-only) | could (`live_set signature_numerator`) | no | |
| Scale / root note | read only (`rootNote`, `scaleIntervals`, `scaleName`, `scaleMode`) | could (settable in LOM) | read (`set.summary`) | Setting the scale is a one-line M4L addition. |
| Arrangement grid | read only (`gridQuantization`, `gridIsTriplet`) | could | no | Low value. |
| Launch quantization, metronome, loop brace | no | part: loop brace yes (`/awh/loop`); quantization/metronome **could** | loop via `mix capture` only | |
| **Transport**: play, stop, continue, position | no | yes (`/awh/play`, `/awh/jump`) | yes (`awh play/stop/jump`) | SDK blocking gap #1. |
| Record (arm + transport record) | arm yes (`Track.arm`); record **no** | could (`record_mode`, `session_record`) | arm via `track.update` | |
| Punch in/out, overdub, count-in | no | could | no | |
| Undo / redo | implicit (each mutation is an undo step; `withinTransaction` groups) | could (`live_set` `undo`/`redo`) | per-op grouping only | An explicit `awh undo` is an M4L one-liner and worth having. |
| **Managing Files and Sets** — browser, Collections, Places, Packs | no | no (LOM has no browser) | no | Hard ceiling. `awh lib` indexes the owner's own sample folders instead. |
| Import a file into the project folder | yes (`importIntoProject`) | n/a | yes (via `clip.create-audio`) | |
| Export audio / render | pre-FX only (`renderPreFxAudio`, audio tracks) | post-FX capture via `/awh/record` | `track.render-prefx`, `mix capture` | Export dialog (stems, full mix, normalise) unreachable; the tap is the workaround. |
| Freeze / flatten track | no | no (not in the LOM) | no | Hard ceiling. |

## 3. Arrangement and Session

| Manual chapter / GUI action | SDK 1.0.0 | M4L (AWH Remote) | `awh` today | Gap / note |
|---|---|---|---|---|
| **Arrangement View** — create a clip at a position | yes (`createMidiClip(start, dur)`, `createAudioClip`) | n/a | yes (`clip.create-midi` arrangement target, `clip.create-audio`) | |
| Move, split, consolidate, resize, crop a clip | no (`startTime`/`endTime` read-only after creation) | no (`start_time` is read-only in the LOM too; `duplicate_region`/crop are not exposed) | no | Accepted in ADR-001. Workaround stays "create at the new place, clear the old range". |
| Delete clips in a time range | yes (`clearClipsInRange`, truncates overlaps) | n/a | yes (`track.clear-range`) | |
| Locators (cue points): list, rename | yes (`cuePoints`, `CuePoint.name`) | could (`jump`, `time` settable) | **no** | SDK has it, bridge doesn't wire it (section 8). |
| Create / delete locator | yes (`createCuePoint(time)`, `deleteCuePoint`) | could | no | section 8 |
| Jump to locator / loop brace | no | yes/part (`/awh/jump <beats>`; loop via `/awh/loop`) | yes | |
| Take lanes / comping | part: list `takeLanes`, create lane, create clips in a lane; **no** comp selection | could (partial) | no (bridge reads `takeLanes` count only) | section 8 |
| Track grouping, folding, colour | `groupTrack` read only; no colour, no create group | could (colour yes; group creation **not in LOM**) | no | |
| Track reorder | no | no (the LOM moves devices, not tracks) | no | Hard ceiling. |
| **Session View** — create a clip in a slot | yes (`ClipSlot.createMidiClip/createAudioClip`) | n/a | yes | |
| Fire a clip / scene, stop clips | no | yes (`/awh/fire`, `/awh/scene`, `/awh/stopclips`) | yes (`awh launch`, `stop-clips`) | |
| Scenes: create, delete, duplicate, rename | yes | could | yes (`scene.*`); rename **no** | section 8 |
| Scene tempo / signature | read only | could (settable) | no | |
| Follow actions, launch mode, legato, velocity-sensitive launch | no | could (`live_clip` `launch_mode`, `follow_action_*`) | no | Entirely an M4L extension; medium value for performance workflows, low for production. |
| Capture MIDI | no | could (`live_set` `capture_midi`) | no | One M4L message; worth adding. |
| Arrangement/session selection | only as a context-menu input (`*.ArrangementSelection`, `ClipSlotSelection`) | could (`live_set view` `selected_track`, `selected_scene`, `detail_clip`) | no | A "what is selected" read via M4L would let `awh` default its target to the GUI selection. |

## 4. Clips

| Manual chapter / GUI action | SDK 1.0.0 | M4L (AWH Remote) | `awh` today | Gap / note |
|---|---|---|---|---|
| **Clip View** — name, colour, mute | yes | could | name/mute yes; **colour no** | section 8 |
| Loop on/off, loop/start/end markers | `looping` settable; markers **read only** (settable only at audio-clip creation through `loopSettings`) | could (`loop_start`, `loop_end`, `start_marker`, `end_marker` all settable) | `looping` only | The biggest clip gap that M4L can close cheaply. |
| Clip gain, transpose, detune, RAM mode, reverse | no | could (`gain`, `pitch_coarse`, `pitch_fine`, `ram_mode`; reverse **no**) | no | |
| Clip signature, groove, velocity amount | no | could (groove via `live_set` `groove_pool` is read-mostly) | no | |
| **Audio Clips, Tempo and Warping** — warp on/off, warp mode | yes (`warping`, `warpMode`) | could | **no** (bridge reads `warping` only) | section 8 |
| Warp markers: read / add / move | read only (`warpMarkers`) | could (`add_warp_marker`, `move_warp_marker`, `remove_warp_marker`) | no | |
| Complex/Pro settings, Hi-Q, Fade | no | could (`hiq`? no; fades no) | no | |
| **Editing MIDI Notes** — read / replace all notes | yes (`MidiClip.notes` get/set, with velocity, deviation, release velocity, probability, mute) | could (`get_notes_extended`, `apply_note_modifications`) | yes (`clip.notes`, `clip read/write/fill/vary/humanize/arp`) | The SDK replaces the whole note list; per-note edit by id needs M4L. Fine for a generator workflow. |
| MIDI note chance, velocity deviation, release velocity | yes (fields on `NoteDescription`) | could | yes | |
| **MIDI Tools** (Live 12 generators / transformations) | no | no (not in LOM) | partly re-implemented in `@awh/core` (`arp`, `transforms`, `phrase`) | Not reachable, not needed: the CLI's own generators are the point. |
| **Converting Audio to MIDI** (harmony/melody/drums to MIDI) | no | no | own engine (`awh from-audio`, `analysis/`) | |
| **Using Grooves** — apply, extract, commit | no | could (`live_clip` `groove`? read; `live_set.groove_pool` read) | `humanize` approximates | Ceiling; the CLI's humanise/swing covers the use. |
| **Clip Envelopes** (modulation per clip) | no | could (`live_clip` `automation_envelope`/`create_automation_envelope`, Live 11+) | no | Same gap as automation below; LOM can write envelopes, SDK can't. |

## 5. Tracks, routing and mixing

| Manual chapter / GUI action | SDK 1.0.0 | M4L (AWH Remote) | `awh` today | Gap / note |
|---|---|---|---|---|
| **Routing and I/O** — input/output type and channel, monitor | no | could (`input_routing_type`, `output_routing_type`, `current_monitoring_state`) | no | SDK blocking gap #3. All in LOM, so an M4L `/awh/route` closes it, including sidechain source selection on a compressor (`live_device` parameters expose the sidechain **toggle**, the **source** is a routing). |
| Sends, returns, main | `mixer.sends`, `returnTracks`, `mainTrack` | could | yes (`track.mixer`) | Creating a return track: SDK **no**, LOM `create_return_track` **could**. |
| **Mixing** — volume, pan, sends | yes (normalised raw, no dB) | could (`live.object` exposes `str_for_value`; display strings **available**) | yes, calibrated by hand (`docs/research/mixer-calibration.md`) | SDK gap #2 (no raw↔display). M4L can read display strings, so a `/awh/param-display` would fix every "what does it say in the UI" question. |
| Mute, solo, arm | yes | could | yes | |
| Crossfader, cue out | no | could | no | Low value. |
| Track delay | no | could (not exposed in LOM either, verify) | no | |
| **Recording New Clips** — record into slot / arrangement | arm only | could (`session_record`, `record_mode`, `overdub`) | no | |
| Resampling / audio-from-track routing | no | could (routing above) | no | |

## 6. Devices, racks, automation

| Manual chapter / GUI action | SDK 1.0.0 | M4L (AWH Remote) | `awh` today | Gap / note |
|---|---|---|---|---|
| **Working with Instruments and Effects** — insert a built-in device by name | yes (`insertDevice(name, index)` on tracks and chains; built-ins only) | could (`live_app` browser? **no**; LOM can't insert devices either) | yes (`device.insert`; Simpler fails, see sdk-feedback #9) | Third-party VST/AU insert: **no layer**. Presets (.adv/.adg) load: **no layer**. Hard ceiling; a template-Set strategy (`knowledge/setup/sidechain-template.md`) is the workaround. |
| Delete, duplicate, reorder devices | delete yes, duplicate yes, **move no** | could (`move_device`) | delete yes; duplicate **no** | section 8 |
| Device on/off | via the `Device On` parameter | could | yes (`device.param`) | |
| Read / set a parameter by name | yes (normalised; `min`, `max`, `defaultValue`, `isQuantized`, `valueItems`) | could, with display strings | yes (`device.get`, `device.param`, `op apply/verify/calibrate`) | Native devices expose everything (Operator: 195 params); Serum 2 exposes only `Device On` (`knowledge/setup/device-parameter-surface.md`). VST parameter visibility depends on the plug-in's "Configure" list and is the same in LOM. |
| **Instrument, Drum and Effect Racks** — list chains | yes (`chains`) | could | yes (drum pads via `set.summary`/`device.get`) | |
| Create a chain | yes (`RackDevice.insertChain(index)`) | could? (LOM `insert_chain` **not available**) | **no** | section 8. This is the primitive "build a rack with x, y, z" needs. |
| Insert devices into a chain | yes (`Chain.insertDevice`) | no | **no** | section 8 |
| Chain mixer (volume, pan, sends), chain name | mixer yes; **name no** (DrumChain has no name, sdk-feedback #6) | could (`live_chain` `name` settable) | no | |
| Chain select zones, key/velocity zones, chain selector | no | could (`live_chain` zones? **not exposed**) | no | Ceiling. |
| Macro controls: map, name, value | value via `parameters` (Macro 1..16 are parameters); **mapping no**, naming no | could (`live_device` macros are parameters; mapping **not in LOM**) | value via `device.param` | Mapping a macro to a chain parameter is GUI-only on every layer. |
| Drum rack: pad note, replace Simpler sample | yes (`receivingNote`, `Simpler.replaceSample`) | could | yes (`drum.pad-note`, `simpler.sample`) | |
| Drum rack: choke groups, pad name, copy/paste pad | no | could (choke via `live_drum_pad`? `choke_group` yes; name read) | no | |
| Simpler/Sampler: slice, warp, playback mode, start/end | `sample.filePath` only | could (`live_simpler_device` `playback_mode`, `slicing_*`, `sample` object with `start_marker`, `slices`) | no | Medium value for the sample workflows; M4L-only. |
| **Automation** — read / write envelopes, arm, re-enable | **no** | could (`live_clip`/`live_track` `automation_envelope`, `AutomationEnvelope.insert_step`; Live 11+ LOM) | no | SDK blocking gap #4. The LOM write path exists and `AWH Ducker` already proves parameter-driving from M4L; a `/awh/automation` message is the natural next sidecar feature. |
| Modulation (Live 12 device modulators, LFO/envelope MIDI tools) | no | no | no | Ceiling. |
| **Live Device References** (instruments, audio FX, MIDI FX) | per-device parameter surface via `device.get` | same | `device.get`, `op recipes` | The manual's device chapters are the one place a distilled reference helps the agent: parameter names and ranges **as the API exposes them**. Generate it from `device.get` dumps, not from the manual text (licence, and the manual names differ from the parameter names). |
| **Max for Live** — load a device, read its UI parameters | load no; parameters yes once loaded | n/a | yes | |

## 7. Not reachable from any layer (and stays that way)

| GUI capability | Why | What `awh` does instead |
|---|---|---|
| Browser, presets, Packs, VST/AU loading | No browser API in SDK or LOM | Template Sets; built-in devices by name |
| Clip move/split/consolidate/crop, track reorder, group tracks | Not in SDK; not in LOM | Create-at-position + clear-range (ADR-001) |
| Export Audio dialog, freeze/flatten | Not in SDK; not in LOM | `renderPreFxAudio`, M4L capture |
| Macro mapping, chain zones, modulators | Not in SDK; not in LOM | Recipes target parameters directly |
| Open/save/close Set | Not in SDK; not in LOM | Owner does it |
| MIDI Tools, Audio-to-MIDI, Groove extraction | Live-internal features with no API | Own engines in `@awh/core` and `analysis/` |

## 8. SDK surface the bridge does not wire yet

Each is a `LiveBridge` method, a `fakeLiveBridge` counterpart and an op;
no M4L involved. Ordered by what the discussed workflows need first.

1. `RackDevice.insertChain` and `Chain.insertDevice` — racks with chains:
   the "build a rack with x, y, z" primitive. Needs a chain path form
   (`track:0/device:1/chain:2` already parses for drum pads) and a decision
   on where chain-level `insertDevice` lives in the op registry.
2. `duplicateDevice` (track and chain).
3. `Clip.color`, `AudioClip.warpMode`, `warpMarkers` read, `warping` set.
4. Cue points: list, create, delete, rename.
5. `Scene.name` set, scene tempo/signature read.
6. Take lanes: create, create clip in lane.
7. `Song.gridQuantization` read, `Track.groupTrack` in summaries.
8. `Song.createCuePoint` paired with M4L `/awh/jump` gives "jump to
   locator by name".

## 9. M4L "could" items worth adding to AWH Remote

Ordered by value to the workflows in `docs/quality-plan.md`:

1. **Parameter display strings** (`str_for_value`, `value` → display):
   closes SDK gap #2 for every device, not just the calibrated ones.
2. **Routing** (`input_routing_type/channel`, `output_routing_*`,
   monitoring): closes gap #3 and the sidechain-source click.
3. **Automation / clip envelopes** write: closes gap #4.
4. **Clip markers** (`loop_start`, `loop_end`, `start_marker`,
   `end_marker`), clip gain and transpose.
5. **Capture MIDI**, explicit **undo/redo**, record mode.
6. **Selection read** (`selected_track`, `selected_scene`, `detail_clip`)
   so commands can default to what the owner has selected.
7. Scale set, scene tempo/signature set, chain names, drum choke groups.

Every one of these is an OSC message in the existing `route`/`live.path`
pattern; the cost is Max patching and the `remote.ts` client, plus a fake
for tests.

## 10. What to ask Ableton for (feeds `docs/sdk-feedback.md`)

Already filed: transport/launch, raw↔display, routing, automation. This
matrix adds: clip markers settable after creation, clip colour on create,
chain names, `moveDevice`, `createReturnTrack`, selection read, preset
(`.adg`/`.adv`) loading by path, scale set.

## 11. Suggested next steps

1. Owner verifies the chapter titles against the manual and the SDK
   column against the vendored SDK's `.d.ts` (one `grep` of
   `EXTENSIONS_API_VERSIONS` and the class list); fix this file in the same
   commit.
2. Open a dev-groundwork feature "devices and racks" covering section 8
   items 1 and 2 and the Simpler insert failure; its acceptance test is a
   recipe that builds a rack with named devices in named chains on the
   fake and on a real Set.
3. Open a second feature "remote v3" for section 9 items 1 to 3.
4. Generate `knowledge/setup/device-reference/<device>.md` from
   `device.get` dumps for the stock devices the recipes use; that, not a
   manual distillation, is the agent reference.
