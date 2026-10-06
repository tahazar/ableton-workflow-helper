# AWH Max for Live devices

Small M4L devices let the CLI drive Live over localhost OSC, with no manual
dialing or routing clicks. Each is committed as a `.maxpat` (JSON) and
built/frozen to `.amxd` in Max on the owner's machine (Suite includes Max).
Each section below includes a manual-patching fallback in case the
generated JSON fights Max's validator.

- **AWH Remote** (current): audio passthrough + recorder (same job as the
  tap below) plus transport (play/stop/jump) and clip launch (fire a
  session slot or scene, stop all clips). The SDK has no API for any of
  that, so this device is how `awh` closes the "press play" gap. Supersedes
  AWH Capture Tap: same 9720/9721 ports, one superset protocol.
- **AWH Capture Tap** (superseded; kept for reference and migration, see
  the migration note under AWH Remote): audio passthrough + recorder only,
  closes the measure→adjust→verify loop.
- **AWH Ducker**: transport-synced sidechain gain envelope, the full-auto
  duck strategy from `docs/design/analysis-engine.md`.

**Load only one of AWH Remote / AWH Capture Tap per Set.** Both listen on
ports 9720/9721, and whichever loads second fails to bind (`udpreceive
9720` already in use). New Sets should use AWH Remote; existing Sets should
swap the Capture Tap for it (see "Migrating from the AWH Capture Tap"
below). Deleting `AWH Capture Tap.maxpat` from the repo is the owner's
call. `mix capture`/`op verify`/`mix duck` work unchanged against AWH
Remote's superset protocol, so nothing in the CLI depends on the old file.

---

## AWH Remote (Max for Live)

A small M4L **audio effect** and the one AWH device a Set needs. It passes
audio through untouched, records its input to a file on command (same job
as the Capture Tap it supersedes), starts/stops Live's transport, jumps
the arrangement playhead, and fires session clip slots/scenes or stops all
clips. The Extensions SDK has no API for any of this
(`docs/sdk-feedback.md`'s #1 blocking gap). Driven over OSC on localhost
by `awh play`/`awh stop`/`awh jump`/`awh launch`/`awh stop-clips`/`awh lib
audition` and `awh mix capture`/`op verify`/`mix duck`.

Put it last on the Main/master chain (same placement as the Capture Tap) to
capture the mixdown, or at the end of any bus/track chain to capture that
signal post-FX. Transport/clip-launch messages work on any chain, since
Live routes them to the Song/LOM, not the audio signal.

### Protocol (UDP, localhost)

Listens on **9720**; replies go to **9721**. Same ports as the AWH Capture
Tap: a drop-in superset, not a new device family.

| Message | Action | Reply |
|---|---|---|
| `/awh/ping` | liveness check | `/awh/pong 2` (version bumped from the tap's `1`) |
| `/awh/record <absolute path>` | open the file in `sfrecord~`, start recording ~100 ms later | none (unchanged from the tap) |
| `/awh/stop` | stop recording | none (unchanged) |
| `/awh/loop <startBeat> <lengthBeats>` | set the arrangement loop brace + enable loop | none (unchanged) |
| `/awh/play <1\|0>` | start / stop the transport | none (unchanged) |
| `/awh/fire <trackIdx> <slotIdx>` | session clip slot `call fire` (respects launch quantization) | `/awh/status fire <trackIdx> <slotIdx>` or `/awh/error <text>` on a negative index |
| `/awh/scene <sceneIdx>` | scene `call fire` | `/awh/status scene <sceneIdx>` or `/awh/error <text>` |
| `/awh/stopclips <trackIdx>` (`-1` = whole Set) | `call stop_all_clips` on the track (or `live_set` itself for `-1`) | `/awh/status stopclips <trackIdx>` or `/awh/error <text>` |
| `/awh/jump <beats>` | set `current_song_time` (arrangement playhead, in beats) | `/awh/status jump <beats>` |

The fire/scene/stopclips/jump messages always reply. The CLI's `remote.ts`
pings first (~1s timeout, "requires the AWH Remote device..." error if
nothing answers), then awaits `/awh/status` or `/awh/error` before printing
anything, so a bad index is reported instead of dropped or hung on.
`record`/`stop`/`loop`/`play` keep the tap's fire-and-forget behavior (no
reply beyond the ping's pong).

**Bad-index checking is partial, by design.** The patch rejects a negative
index locally (no LOM round trip) but does not query `live_set`'s track or
scene count before firing. A positive but out-of-range index (e.g. `fire
99 0` on an 8-track Set) goes straight to `live.path`/`live.object`, and
Live does whatever it does with an unresolvable path (most likely a silent
no-op); it will not come back as a clean `/awh/error`. Checking real
bounds would need a `get num_tracks`-style round trip before every fire,
which conflicts with the zero-timer, minimal-round-trip goal. The CLI
already validates against `awh status`'s track/scene list when it has that
context (e.g. `lib audition`), so the gap mostly matters for hand-typed
`awh launch` targets.

### Install

1. In Live (Suite), drop a **Max Audio Effect** onto the master track and
   click its edit (patch cord) button to open Max.
2. In Max: File → Open → `m4l/AWH Remote.maxpat`, select-all, copy, then
   paste into the device's patcher window (between its default `plugin~`
   and `plugout~` if present; delete the duplicates so only one pair
   remains, keeping the paste's connections).
   *If the .maxpat refuses to open or paste cleanly, build it by hand from
   the tables below, which describe every object and connection.*
3. Save (⌘S). Live now shows the device in the set. Optionally
   File → "Freeze Device" and save as `AWH Remote.amxd` into your User
   Library for reuse across projects (also needed for the performance
   measurement below; see the Owner performance protocol).
4. Click the **MANUAL RE-INIT** button once after any load/paste (see
   "Notes" below; it is the same `live.path` lesson as AWH Ducker.maxpat).
5. Verify: `awh play` should start the transport; `awh mix capture` should
   still record (unchanged protocol); `awh launch track:0/slot:0` (on an
   occupied slot) should fire it audibly.

### Migrating from the AWH Capture Tap

If a Set already has the Capture Tap loaded:

1. Remove the AWH Capture Tap device from the Set. It and AWH Remote can't
   both bind port 9720, and whichever loads second fails silently (usually
   no console error, just no reply to `/awh/ping` from the failed one).
2. Install AWH Remote in its place (steps above). Same placement (end of
   the master/bus chain) and same ports, so `awh mix capture`/`op
   verify`/`mix duck` keep working with no CLI-side changes.
3. The `record`/`stop`/`loop`/`play` wire format is unchanged, and so is
   the behavior of `awh mix capture` and related commands. The only visible
   difference is that `/awh/pong` replies `2` instead of `1` (informational;
   no current CLI code checks it).
4. Deleting `AWH Capture Tap.maxpat` from the repo is optional and the
   owner's call. Nothing in the CLI reads that file (it's a Max source, not
   a runtime dependency), so keeping it as a reference costs nothing.

### Manual build table (fallback)

The patch has five subsystems: OSC in/routing + record/stop/loop/play
(identical to the Capture Tap) + ping/pong, then four
fire/scene/stopclips/jump branches sharing one pattern. Each branch gates
out a bad (negative) index locally, resolves the target via a
dynamically built `live_set ...` path string sent to a **shared,
once-created** `live.path`/`live.object` pair, then `call`s/`set`s it and
echoes a status reply. For lightness, every LOM object is created once per
branch and reused for every message of that type, never recreated per
call. Every `t` (trigger) object fires its outlets right to left (same
idiom as the Capture Tap's `t b f` and the Ducker's subsystem 4). It is
used throughout to sequence "resolve the LOM id" before "issue the call",
and "compute the bad-index gate control" before "let the data through".

#### 1. OSC in, routing, ping/pong (Capture Tap layout + 4 new outlets)

| Object/message | Notes |
|---|---|
| `udpreceive 9720` | OSC in |
| `route /awh/record /awh/stop /awh/loop /awh/play /awh/ping /awh/fire /awh/scene /awh/stopclips /awh/jump` | 9 matched outlets in that order + reject |
| message `/awh/pong 2` | ping reply → `udpsend 127.0.0.1 9721` (shared by every reply in this patch: pong, status, error) |
| `udpsend 127.0.0.1 9721` | the single shared OSC-out object |

#### 2. record/stop/loop/play (wiring byte-identical to AWH Capture Tap.maxpat)

Same as the tap (see its manual-build table if rebuilding from scratch):
`t b s` → `prepend open` (**object**, not a message box; see the callout at
the end of this section) / `del 100`+message `1` → `sfrecord~ 2`; message
`0` → `sfrecord~ 2`; `unpack 0. 0.` → messages `set loop_start $1`/`set
loop_length $1`/`set loop 1` (via `t b f` so length is set before loop 1)
→ the transport `live.object`'s left inlet; `sel 1 0` → messages `call
start_playing`/`call stop_playing` → same `live.object`.
`plugin~`/`plugout~` device I/O, L/R into both `plugout~` and `sfrecord~`.

#### 3. Transport `live_set` binding (Pair A: loadbang + manual re-init)

| Object/message | Notes |
|---|---|
| `loadbang` → `live.path live_set` → id → `live.object`'s **right** inlet | same binding idiom as the Capture Tap |
| **button** (small bang UI object) → `live.path live_set`'s inlet, in parallel with `loadbang` | **MANUAL RE-INIT**: click after any reload/paste. `loadbang` alone does not refire on a paste-into-open-device reload (found while building AWH Ducker; see `docs/dev-loop.md`'s Ducker checklist), so this UI element is required |
| `live.object` | receives the loop/play `set`/`call` messages from subsystem 2; the one live.object shared by record/stop/loop/play and jump |

#### 4. FIRE: `/awh/fire <trackIdx> <slotIdx>`

| Object/message | Notes |
|---|---|
| `t l l` (fed by route's fire outlet, a 2-element list) | right outlet fires first (bad-index gate), left outlet fires second (preserves the list for the gate's data inlet) |
| right branch: `unpack 0 0` → `expr (($i1 < 0) \|\| ($i2 < 0)) + 1` | wire unpack's outlet 1 (slotIdx) to expr's cold inlet 1 and outlet 0 (trackIdx) to expr's hot inlet 0; unpack fires right-to-left, so slotIdx lands before trackIdx triggers evaluation. Output: `1` = good, `2` = bad. **Owner-found gotcha (2026-08-23)**: the ternary form `... ? 2 : 1` threw a Max `expr` syntax error on the owner's Max version (all three bad-index `expr` objects in this device failed the same way). `expr`'s comparison/logical operators return `1`/`0` like C, so `(condition) + 1` is equivalent without ternary support. Use the `+ 1` form everywhere below, not `?:`. |
| → `gate 2` inlet 0 (control) | must be set before the data arrives, which the outer `t l l`'s ordering guarantees |
| left branch (the preserved list) → `gate 2` inlet 1 (data) | |
| `gate 2` outlet 0 (good, list passes through) → `t l l` | right outlet fires first (resolve id), left outlet fires second (call + reply) |
| resolve-id branch: message `goto live_set tracks $1 clip_slots $2` (fed the list, $1/$2 auto-substituted) → **`live.path`** (bare, no creation argument; this is Pair B, dedicated to fire, created once and re-resolved on every fire call via fresh path messages, never re-instantiated) → id → **`live.object`** (Pair B's partner)'s right inlet | |
| call+reply branch: message `call fire` → `live.object` (Pair B) left inlet; **object** `prepend /awh/status fire` (fed the list) → `udpsend` | both fed by the same outlet; their relative order doesn't matter, only that they fire after the id is set, which the outer `t l l` guarantees |
| `gate 2` outlet 1 (bad) → **object** `prepend /awh/error bad-fire-index` → `udpsend` | |

#### 5. SCENE: `/awh/scene <sceneIdx>`

Same shape as FIRE with one index instead of two: `t l l` → (right)
`unpack 0` → `expr ($i1 < 0) + 1` → `gate 2` control; (left) → `gate 2`
data. Good outlet → `t l l` → (right) message `goto live_set scenes $1` →
**`live.path`** (Pair C, dedicated to scene) → id → **`live.object`**
(Pair C) right inlet; (left) message `call fire` → `live.object` left
inlet, and **object** `prepend /awh/status scene` → `udpsend`. Bad outlet
→ **object** `prepend /awh/error bad-scene-index` → `udpsend`.

#### 6. STOPCLIPS: `/awh/stopclips <trackIdx>` (`-1` = whole Set)

Same gate shape as FIRE/SCENE, but the bad check is `expr ($i1 < -1) + 1`
(only indices below `-1` are rejected; `-1` is the valid "all" sentinel),
and the good path has an extra branch to pick the LOM path before
resolving: `unpack 0` → `sel -1` → outlet 0 (matched, `-1`) → message
`goto live_set` (targets the Song itself); outlet 1 (unmatched,
passthrough `trackIdx`) → message `goto live_set tracks $1`. Both feed the
same **`live.path`** (Pair D, dedicated to stopclips) → id →
**`live.object`** (Pair D) right inlet. Then (from the outer `t l l`'s
left/second outlet) message `call stop_all_clips` → `live.object` left
inlet, and **object** `prepend /awh/status stopclips` → `udpsend`. Bad
outlet → **object** `prepend /awh/error bad-stopclips-index` → `udpsend`.

#### 7. JUMP: `/awh/jump <beats>`

No bad-index gate: any beat position is a valid `current_song_time` (Live
clamps on its side, and a continuous beat position has no "negative index"
analog). `t l l` (fed by route's jump outlet, a 1-element list) → right
outlet fires first: message `goto live_set` → **`live.path`** (Pair E,
dedicated to jump) → id → **`live.object`** (Pair E) right inlet; left
outlet fires second: message `set current_song_time $1` (fed the beats
value) → `live.object` left inlet, and **object** `prepend /awh/status
jump` (fed the beats value) → `udpsend`.

**Owner-found gotcha (2026-08-23): `prepend` must be an object box.** All
8 `prepend ...` boxes in this device (the `record` file-open plus the 7
fire/scene/stopclips/jump status/error replies) must be real object boxes
(`newobj`), not message boxes. A message box outputs its own fixed text on
any trigger and ignores the incoming value. That breaks the file path
passed to `sfrecord~`'s `open` (so `awh mix capture`/`op verify`/`duck`
recording never opens the real file) and every status/error OSC reply
(the reply has the right address but no data; e.g. jump's reply came back
as literal `prepend /awh/status jump` with no beats value, and
fire/scene/stopclips/jump all dropped their reply args the same way).
Confirmed by comparison with the verified `AWH Capture Tap.maxpat`, whose
`prepend open` box is a `newobj`. When rebuilding by hand, type
`prepend <fixed prefix words>` into a plain object box (`n` shortcut or
Object from the palette), never a message box (`m` shortcut). Object boxes
have straight corners; message boxes have a notched right edge.

**Owner-found gotcha (2026-08-23): dynamic `live.path` messages need
`goto`.** This was the root cause of fire/scene/stopclips/jump all
silently no-oping. A bare, argument-less `live.path` (used by every Pair
B–E dynamic resolve, e.g. `goto live_set tracks $1 clip_slots $2`) does
not accept a raw LOM path string as its message. It needs the prefix word
`goto` (`goto live_set ...`, per Cycling '74's live.path cookbook usage).
Without it, `live.path` prints `doesn't understand "live_set"` in the Max
console and never outputs an id, so `live.object` prints `set: no valid
object set` (or a `call` does nothing). No OSC `/awh/error` results, since
this happens inside Max before either gate branch's status/error message
fires. Pair A's `live.path live_set` is unaffected: it bakes the path in as
a creation-time argument (resolved by a `bang`, no message parsing), so it
never needs `goto`. All five `live_set`-prefixed message boxes in this
device (`obj-33`, `obj-45`, `obj-59`, `obj-60`, `obj-68` in the shipped
`.maxpat`) start with `goto`. When rebuilding any Pair B–E branch by hand,
always prefix the dynamic path message with `goto`.

### Notes

- **Five independent `live.path`/`live.object` pairs**, not one shared
  pair (Pair A = transport+ping's fixed `live_set` binding,
  loadbang/button-bound; Pairs B/C/D/E = fire/scene/stopclips/jump, each
  re-resolved on every call to that message type). One pair re-targeted
  between "live_set" and "live_set tracks N clip_slots M" on alternating
  messages would work in principle (live.path accepts a fresh path message
  any time), but correctness would then depend on cross-branch ordering
  everywhere. Five narrowly scoped pairs are easier to reason about and to
  rebuild from this table, and still create every LOM object once: each
  pair's objects are created at patch load, and only the path string sent
  to them varies per call, which is the intended way to use `live.path`
  for a dynamic index.
- **The manual re-init button only rebinds Pair A** (the transport/ping
  binding). Pairs B–E never need re-init: they hold no persistent binding,
  since every fire/scene/stopclips/jump call resolves a fresh path. If
  `awh launch`/`awh jump` work but `awh play`/`awh mix capture` don't (or
  vice versa) right after a reload, that is consistent with this design:
  re-init and retest.
- No timers in this patch (unlike the Ducker's `metro 1` poll). Remote
  never polls transport position; it only reacts to incoming OSC.
- Ports are hardcoded (9720/9721); change both the patch and
  `--remote-port`/`--remote-reply-port` if they collide with something.
- Recording format/behavior: same as the Capture Tap (see that section's
  Notes).

### Owner performance protocol (before/after)

The owner reported the Capture Tap had a noticeable CPU/performance impact
on Live. The tap patch is minimal (~24 objects, zero timers, event-driven
throughout), so a per-object cost large enough to notice seems unlikely.
More probable causes are environmental: an unfrozen device, an open Max
editor window using CPU, a freeze that picked up template UI overhead, or
the baseline runtime cost of any M4L device. This protocol isolates the
cause on the owner's machine:

1. **Baseline**: Live's CPU meter (bottom-right) + audio dropout indicator,
   over 60 seconds of normal playback, with no AWH device loaded. Record
   the number.
2. **Frozen, editor closed**: freeze AWH Remote to `.amxd` (Install step
   3), load the frozen device, close any open Max editor window, repeat the
   60-second measurement.
3. **Unfrozen, editor open**: unfreeze (or load the unfrozen `.maxpat`
   directly) with its Max editor window open, repeat the measurement.
4. **Record all three numbers** in `docs/dev-loop.md`'s "M12 (AWH Remote)
   owner checklist". If step 2 (frozen, editor closed, the configuration a
   real session should use) is meaningfully worse than step 1, that is a
   patch-level problem to investigate. Given the object count, the
   expectation is that it won't be, and that the earlier complaint traces
   to the step 1→3 delta (editor-open / unfrozen overhead). Either outcome
   is useful data; the protocol isolates the answer without presupposing
   it.

---

## AWH Capture Tap (Max for Live)

**Superseded by AWH Remote (above).** Same ports, one superset protocol,
so a Set should load one of the two, not both. This section is kept for
reference and for Sets not yet migrated; see "Migrating from the AWH
Capture Tap" above for the swap.

A small M4L **audio effect** that closes the measure→adjust→verify loop.
It passes audio through untouched, records its input to a file on command,
and (because M4L has full LOM access) starts/stops Live's transport over a
chosen arrangement loop. Driven by `awh mix capture` over OSC on localhost.

Put it last on the Main/master chain to capture the mixdown, or at the
end of any bus/track chain to capture that signal post-FX.

### Protocol (UDP, localhost)

Listens on **9720**; replies go to **9721**.

| Message | Action |
|---|---|
| `/awh/record <absolute path>` | open the file in `sfrecord~` and start recording ~100 ms later |
| `/awh/stop` | stop recording |
| `/awh/loop <startBeat> <lengthBeats>` | set the arrangement loop brace + enable loop |
| `/awh/play <1\|0>` | start / stop the transport |
| `/awh/ping` | replies `/awh/pong 1` on 9721 |

`awh mix capture -o out.wav --from-bar 33 --bars 8` sends
loop → record → play, waits the loop length (tempo read from the gateway)
plus a tail, then play 0 → stop.

### Install

1. In Live (Suite), drop a **Max Audio Effect** onto the master track and
   click its edit (patch cord) button to open Max.
2. In Max: File → Open → `m4l/AWH Capture Tap.maxpat`, select-all, copy,
   then paste into the device's patcher window (between its default
   `plugin~` and `plugout~` if present; delete the duplicates so only one
   pair remains, keeping the paste's connections).
   *If the .maxpat refuses to open or paste cleanly, build it by hand from
   the table below (~20 objects).*
3. Save (⌘S). Live now shows the device in the set. Optionally
   File → "Freeze Device" and save as `AWH Capture Tap.amxd` into your User
   Library for reuse.
4. Verify: `awh mix capture` should record; use a `node -e` one-liner or
   `awh mix capture --bars 1 --from-bar 1 -o /tmp/tap-test.wav` end to end.

### Manual build table (fallback)

Objects (create with `n` for objects, `m` for messages):

| # | Object/message | Notes |
|---|---|---|
| 1 | `udpreceive 9720` | OSC in |
| 2 | `route /awh/record /awh/stop /awh/loop /awh/play /awh/ping` | |
| 3 | `t b s` | record: open first, then delayed start |
| 4 | `prepend open` | → sfrecord~ |
| 5 | `del 100` → message `1` | start recording after the open |
| 6 | message `0` | stop recording |
| 7 | `sfrecord~ 2` | the recorder |
| 8 | `plugin~`, `plugout~` | device I/O (usually already in the patch) |
| 9 | `unpack 0. 0.` | loop args |
| 10 | messages `set loop_start $1`, `set loop_length $1`, `set loop 1` | to live.object; use `t b f` on unpack's right outlet so length is set before loop 1 |
| 11 | `sel 1 0` → messages `call start_playing`, `call stop_playing` | transport |
| 12 | `loadbang` → `live.path live_set` | id → live.object **right** inlet |
| 13 | `live.object` | receives all the set/call messages |
| 14 | message `/awh/pong 1` → `udpsend 127.0.0.1 9721` | ping reply |

Connections: `plugin~` L/R → `plugout~` L/R **and** → `sfrecord~` L/R.
`route` outlets, in order: record → (3); stop → (6); loop → (9);
play → (11); ping → (14). All `set …`/`call …` messages → `live.object`
left inlet.

### Notes

- Recording format: `sfrecord~`'s default for the path extension (`.wav`
  recommended; 24-bit is Max's default WAV depth, fine for measurement).
- The tap never touches the audio (straight passthrough), so it is safe to
  leave on the master.
- Ports are hardcoded in the patch (9720/9721); change both the patch and
  `--tap-port` if they collide with something.
- The device has no logic of its own: all sequencing lives in the CLI, so
  the patch never needs to change as workflows evolve.

---

## AWH Ducker (Max for Live)

The full-auto duck strategy from `docs/design/analysis-engine.md`'s Duck
strategies section: a transport-synced gain-envelope **audio effect** that
fires a programmed attack/hold/release dip whenever Live's playhead
crosses one of the pushed trigger beats (modulo a pattern length, so it
loops with the Trigger clip). No compressor threshold tuning, no ShaperBox
hand-drawing, no routing clicks: the CLI pushes the fitted envelope to the
device over OSC.

**Where it sits**: on the Sidechain bus, per
`knowledge/setup/sidechain-template.md` (BASS/SAMPLES → Sidechain →
Main). It replaces ShaperBox on that track, or, to keep ShaperBox available
as a fallback, sits after it with ShaperBox's Device On set to 0. Only one
duck strategy should be live at once (stacking both would double-duck).

Max cannot be scripted from outside Live, so this placement is a manual
step, the same limit as every strategy in the Duck strategies table.
Everything after that (shape, triggers, on/off) is OSC-driven from the CLI.

### Protocol (UDP, localhost)

Listens on **9722**; replies go to **9723**.

| Message | Action |
|---|---|
| `/awh/duck/ping` | replies `/awh/duck/pong <version>` on 9723 |
| `/awh/duck/shape <attackMs> <holdMs> <releaseMs> <depthDb>` | set the envelope. `depthDb` is a **positive** number: dB of gain reduction at the trough |
| `/awh/duck/triggers <patternLengthBeats> <beat0> <beat1> ...` | trigger positions in beats, within one loop of the pattern (floats, e.g. `4.0 0.0 1.0 2.0 3.0`) |
| `/awh/duck/on <0\|1>` | enable / bypass. Bypass snaps gain to unity instantly, not via the release ramp |
| `/awh/duck/status` | replies `/awh/duck/status <on> <attackMs> <holdMs> <releaseMs> <depthDb> <nTriggers>` on 9723 |

Engine behavior (implemented by the patch; see the algorithm below):

- Polls Live's transport position at ~1 ms resolution (`metro 1`). Enable
  "Scheduler in Audio Interrupt" in Max's Audio preferences for the
  tightest timing, though plain overdrive is usually enough for a few-ms
  attack.
- **Transport stopped** → gain snaps to unity, no triggering.
- **Position jumping backwards** (loop wrap / restart) → treated as a
  fresh cycle; the tick that sees the jump does not scan for crossings
  (no spurious envelope at the wrap point).
- **Retrigger while a previous envelope is still releasing** → the new
  envelope restarts from the current gain (ShaperBox's behavior, and what
  `duck fit`'s numbers assume).

### Usage walkthrough

1. Place the device once (Install, below) on the Sidechain bus.
2. Fit the envelope from the drums, saving the JSON `push` reads:
   ```sh
   awh mix duck fit <drumsCapture> --trigger-clip <Trigger clip> --json > fit.json
   ```
3. Push it:
   ```sh
   awh mix duck push --fit fit.json --trigger-clip <Trigger clip>
   ```
   `push` pings the device first (~1 s timeout); with no reply it exits
   with a "device not loaded" error instead of hanging. It then sends the
   trigger pattern, the shape, and `on 1`, and prints a summary (trigger
   count, pattern length, shape values, port).
   No MIDI Trigger clip? Use raw beats: `--pattern "0,1,2,3" --length 4`.
   An empty Trigger clip is a no-op, not an error: `push` says so and
   sends nothing (not even a ping); see `docs/lessons-learned.md` rule 5.
4. Bypass it any time with `awh mix duck push --off` (ping + `on 0`).
5. **Verify** the achieved depth by capturing the Sidechain bus post-Ducker
   with the AWH Capture Tap and measuring it:
   ```sh
   awh mix capture -o duck.wav --from-bar N --bars 4
   awh mix duck measure duck.wav --trigger-clip <Trigger clip>
   ```
   or an on/off pair (`duck push` / `duck push --off`, capture both,
   `awh mix ab`) for a loudness-matched A/B.

### Install

1. In Live (Suite), drop a **Max Audio Effect** onto the **Sidechain**
   track and click its edit (patch cord) button to open Max.
2. In Max: File → Open → `m4l/AWH Ducker.maxpat`, select-all, copy, then
   paste into the device's patcher window (between its default `plugin~`
   and `plugout~` if present; delete the duplicates so only one pair
   remains, keeping the paste's connections).
   *This patch is much bigger than the capture tap's (~75 objects:
   real-time transport polling and a variable-length trigger list need more
   machinery than a passthrough recorder). If it doesn't paste cleanly,
   build it by hand from the tables below, which describe every object and
   connection by subsystem.*
3. Save (⌘S). Live now shows the device on the Sidechain track.
   Optionally File → "Freeze Device" and save as `AWH Ducker.amxd` into
   your User Library for reuse across projects.
4. Verify: `awh mix duck push --fit fit.json --trigger-clip <clip>`
   should report that the device replied to ping and print the pushed
   summary; `awh mix duck push --off` should snap it to unity.

### Manual build table (fallback)

The patch has four subsystems. `[value NAME]` is Max's named-storage idiom:
any number of `[value NAME]` boxes sharing a name share state, so the
"write" and "read" instances below are separate boxes with the same text.
Every `t` (trigger) object fires its outlets right to left (Max's
documented behavior); the tables rely on that to set cold inlets before a
hot-inlet trigger, like the capture tap's `t b f` for its loop message.

#### 1. OSC in, routing, ping/pong, shape + trigger storage

| Object/message | Notes |
|---|---|
| `udpreceive 9722` | OSC in |
| `route /awh/duck/ping /awh/duck/shape /awh/duck/triggers /awh/duck/on /awh/duck/status` | 5 matched outlets in that order + reject |
| message `/awh/duck/pong 1` | ping reply → `udpsend 127.0.0.1 9723` |
| `unpack 0. 0. 0. 0.` | shape args → 4 floats: attack, hold, release, depth |
| `value attack`, `value hold`, `value release`, `value depth` (write) | one each, fed by the unpack outlets in order |
| `zl slice 1` | splits the triggers list into `[patternLengthBeats]` (left) and `[beat0 beat1 ...]` (right) |
| `unpack 0.` → `value patlen` (write) | pattern length, from the slice's left outlet |
| `zl len` → `value trigcount` (write) | count of the beats list, from the slice's right outlet |
| `value trigbeats` (write) | the whole beats list, stored directly (also fed from the slice's right outlet; `value` can hold a list) |
| `value on` (write) | from the `on` route outlet (already a bare 0/1) |
| `sel 0` (on the same `on` route outlet) → message `1.` | instant-bypass snap: `on 0` forces gain to unity immediately, not via the release ramp |
| `udpsend 127.0.0.1 9723` | shared OSC out for pong + status |

#### 2. Status reply

| Object/message | Notes |
|---|---|
| `t b b b b b b` | fed by the `status` route outlet (bangs on a bare `/awh/duck/status`) |
| 6× `value NAME` (read instances of trigcount, depth, release, hold, attack, on) | one bang each, from the `t`'s 6 outlets |
| `pack 0 0. 0. 0. 0. 0` | 6 inlets: on(int) attack hold release depth(floats) trigcount(int). Wire the `t`'s outlets to pack's inlets right-to-left (outlet5→inlet5 trigcount ... outlet0→inlet0 on) so the hot inlet (0, `on`) fires last, after every cold inlet is set |
| `prepend /awh/duck/status` → `udpsend 127.0.0.1 9723` | assembles and sends the reply |

#### 3. Transport polling → beat position

| Object/message | Notes |
|---|---|
| `loadbang` → `live.path live_set` → id into `live.object`'s **right** inlet | same binding idiom as the capture tap |
| `loadbang` → message `1` → `metro 1` left inlet | starts the poll clock on load (runs continuously; bypass/stop is handled by forcing gain to unity each tick, not by stopping the metro) |
| `loadbang` → message `-1.` → `value prevbeat` (write) | initial sentinel so the first tick after load can't misfire |
| `metro 1` → `t b b` | right outlet fires first → message `get is_playing` → `live.object` left inlet; left outlet fires second → message `get current_song_time` → `live.object` left inlet. is_playing must be fresh before the current_song_time chain reads it |
| `live.object` outlet → `route current_song_time is_playing` | LOM replies come back as `<propname> <value>` |
| `is_playing` outlet → `value isplaying` (write) | |
| `current_song_time` outlet → `expr fmod($f1,$f2)` inlet 0 (hot) | `patlen` is preloaded into inlet 1 (cold) directly from the shape/trigger-storage `unpack 0.` (subsystem 1); no re-read needed, since it only changes when `/awh/duck/triggers` arrives |
| `expr fmod` output → `t b f` | right outlet (float) fires first → `value curmod` (write); left outlet (bang) fires second → `value isplaying` (read), so curmod is stored before anything downstream reads it |

> **Assumption for owner verification**: this uses the Live Object
> Model's `Song.current_song_time` property (beats, via `get
> current_song_time` on `live.object` bound to `live_set`) instead of a
> `[transport]` object + tick math, because it reuses the tap's proven
> `live.path`/`live.object` idiom. If `current_song_time` doesn't behave as
> expected in Max, the `[transport]`-object approach (poll ticks, divide by
> 480/quarter) is the documented alternative; swap this one block.

#### 4. Wrap check → crossing detection → envelope fire

| Object/message | Notes |
|---|---|
| `value isplaying` (read) → `sel 0` | **stopped branch** (outlet 0, matched): message `1.` → `line~` (unity snap) and message `-1.` → `value prevbeat` (write, resets the sentinel so resuming starts a fresh cycle) |
| `sel 0` outlet 1 (not stopped = playing) → `t b b` | right outlet fires first → `value curmod` (read, a dedicated preload instance) → feeds the wrap-check `expr`'s cold inlet 1 and the crossing `expr`'s cold inlet 2; left outlet fires second → `value prevbeat` (read, a dedicated preload instance) → feeds the wrap-check `expr`'s hot inlet 0 and the crossing `expr`'s cold inlet 1 |
| `expr ($f1 < 0) \|\| ($f2 < $f1)` → `sel 1` | wrap/fresh-cycle test ($f1=prevbeat, $f2=curmod). Outlet 0 (matched=wrap): bang → a **separate** `value curmod` (read) instance → `value prevbeat` (write); resync only, no firing. Do not reuse the preload-read instance for this store: wiring one `value curmod` (read) box to both the comparator preloads and the prevbeat store creates a race that clobbers prevbeat before the comparisons read it |
| `sel 1` outlet 1 (not wrap) → `t b` → `t b b` | right outlet fires first → `value trigcount` (read) → `uzi`'s right (count) inlet; left outlet fires second → bang → `uzi`'s left inlet, starting the burst |
| `uzi 0 0` outlet 0 (index, fires N times) → `t b i` | right outlet (int index) fires first → `zl nth`'s right (index) inlet; left outlet (bang) fires second → `value trigbeats` (read) → `zl nth`'s left (list) inlet, which outputs the beat value at that index |
| `zl nth` output (`bi`) → `expr ($f1 > $f2) && ($f1 <= $f3)` | inlet 0 = `bi` (hot); inlet 1 = prevbeat (cold, preloaded above); inlet 2 = curmod (cold, preloaded above). 1 = this trigger was crossed since the last tick |
| → `sel 1` (crossing found?) → `value on` (read) → `sel 1` (on == 1?) | both must match to fire; a crossing while bypassed does nothing |
| `uzi` outlet 1 ("done", after all N indices) → the dedicated resync `value curmod` (read) → `value prevbeat` (write) | end-of-tick resync, same dedicated instance as the wrap path |
| Fire (bang) → `t b b b b` | 4 outlets, right-to-left: release, hold, attack (cold `pack` inlets 3/2/1) then depth (hot); depth's read feeds `* -1.` → `dbtoa` → `pack`'s hot inlet 0 |
| `pack 0. 0. 0. 0.` (troughGain, attackMs, holdMs, releaseMs) → message `$1 $2, $1 $3, 1. $4` | builds a 3-segment `line~` ramp: trough over `attackMs`, hold at trough for `holdMs` (a zero-delta segment = a hold), then unity over `releaseMs` |
| → `line~` | also fed directly by the shared unity-snap message `1.` (subsystem 1's bypass snap and this subsystem's stopped-branch snap both target it) |

#### 5. Audio path

| Object | Notes |
|---|---|
| `plugin~` | device audio in, L/R |
| `*~` × 2 (one per channel) | left inlet = `plugin~`'s L/R (signal); right inlet = `line~`'s output (signal, shared mono gain ramp on both channels) |
| `plugout~` | device audio out, L/R, fed by the two `*~` |

### Notes

- Ports are hardcoded in the patch (9722/9723); change both the patch and
  `--duck-port`/`--duck-reply-port` if they collide with something.
- The transport-polling/crossing-detection subsystem (#4 above) is the most
  intricate part of this device and the first to check in Max if the
  generated `.maxpat` doesn't paste or behave cleanly. The algorithm is
  fully specified in the table above (and in
  `docs/design/analysis-engine.md`'s protocol section), so it can be
  rebuilt from scratch even if none of the generated JSON survives.
- `depthDb` is a positive number end to end (CLI → OSC → patch); the patch
  negates it (`* -1.`) right before `dbtoa` to get the trough's linear
  gain.
- Like the capture tap, this device only plays back envelopes:
  shape/trigger decisions live in the CLI (`awh mix duck fit`/`push`), so
  the patch shouldn't need to change as the fitting logic evolves.
