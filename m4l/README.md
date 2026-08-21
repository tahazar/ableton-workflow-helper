# AWH Max for Live devices

Two tiny M4L devices drive Live from the CLI over localhost OSC — no
manual dialing, no clicking through routing. Each is committed as a
`.maxpat` (JSON), built/frozen to `.amxd` in Max on the owner's machine
(Suite includes Max), with a full manual-patching fallback here in case
the generated JSON fights Max's validator.

- **AWH Capture Tap** — audio passthrough + recorder, closes the
  measure→adjust→verify loop.
- **AWH Ducker** — transport-synced sidechain gain envelope, the full-auto
  duck strategy from `docs/design/analysis-engine.md`.

---

## AWH Capture Tap (Max for Live)

A tiny M4L **audio effect** that closes the measure→adjust→verify loop:
it passes audio through untouched, records its input to a file on command,
and (because M4L has full LOM access) starts/stops Live's transport over a
chosen arrangement loop. Driven by `awh mix capture` over OSC on localhost.

Put it **last on the Main/master chain** to capture the mixdown, or at the
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
   `plugin~` and `plugout~` if present — delete the duplicates so only one
   pair remains, keeping the paste's connections).
   *If the .maxpat refuses to open or paste cleanly, build it by hand from
   the table below — it's ~20 objects.*
3. Save (⌘S) — Live now shows the device in the set. Optionally
   File → "Freeze Device" and save as `AWH Capture Tap.amxd` into your User
   Library for reuse.
4. Verify: `awh mix capture` should record; `node -e` one-liner or
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

- Recording format: whatever `sfrecord~`'s default is for the path
  extension (`.wav` recommended; 24-bit is Max's default WAV depth — fine
  for measurement).
- The tap never touches the audio (straight passthrough) — safe to leave on
  the master.
- Ports are hardcoded in the patch (9720/9721); change both the patch and
  `--tap-port` if they collide with something.
- This device is intentionally dumb: all sequencing lives in the CLI, so
  the patch never needs to change as workflows evolve.

---

## AWH Ducker (Max for Live)

The full-auto duck strategy from `docs/design/analysis-engine.md`'s Duck
strategies section: a transport-synced gain-envelope **audio effect** that
fires a programmed attack/hold/release dip whenever Live's playhead
crosses one of the pushed trigger beats (modulo a pattern length, so it
loops with the Trigger clip). No compressor threshold-fumbling, no
ShaperBox hand-drawing, no routing clicks — the CLI pushes the fitted
envelope straight into the device over OSC.

**Where it sits**: on the **Sidechain** bus, per
`knowledge/setup/sidechain-template.md` (BASS/SAMPLES → Sidechain →
Main). It replaces ShaperBox on that track, or — if the owner wants to
keep ShaperBox available as a fallback — sits after it with ShaperBox's
Device On set to 0. Either way, only one duck strategy should be live at
once (both stacking would double-duck).

Because Max cannot be scripted from outside Live, **this one placement is
still a manual step** — same limit as every strategy in the Duck
strategies table. Everything after that (shape, triggers, on/off) is
OSC-driven from the CLI.

### Protocol (UDP, localhost)

Listens on **9722**; replies go to **9723**.

| Message | Action |
|---|---|
| `/awh/duck/ping` | replies `/awh/duck/pong <version>` on 9723 |
| `/awh/duck/shape <attackMs> <holdMs> <releaseMs> <depthDb>` | set the envelope. `depthDb` is a **positive** number — dB of gain reduction at the trough |
| `/awh/duck/triggers <patternLengthBeats> <beat0> <beat1> ...` | trigger positions in **beats**, within one loop of the pattern (floats, e.g. `4.0 0.0 1.0 2.0 3.0`) |
| `/awh/duck/on <0\|1>` | enable / bypass. Bypass snaps gain to unity **instantly**, not via the release ramp |
| `/awh/duck/status` | replies `/awh/duck/status <on> <attackMs> <holdMs> <releaseMs> <depthDb> <nTriggers>` on 9723 |

Engine behavior (what the patch implements — see the algorithm below):

- Polls Live's transport position at ~1 ms resolution (`metro 1`; enable
  "Scheduler in Audio Interrupt" in Max's Audio preferences for the
  tightest timing, though plain overdrive is usually enough for a few-ms
  attack).
- **Transport stopped** → gain snaps to unity, no triggering.
- **Position jumping backwards** (loop wrap / restart) → treated as a
  fresh cycle; the tick that sees the jump does NOT scan for crossings
  (no spurious envelope at the wrap point).
- **Retrigger while a previous envelope is still releasing** → the new
  envelope restarts from wherever the gain currently is (ShaperBox's
  behavior, and what `duck fit`'s numbers assume).

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
   `push` pings the device first (~1 s timeout) — if there's no reply it
   exits with a clear "device not loaded" error instead of hanging. Then
   it sends the trigger pattern, the shape, and `on 1`, and prints a
   summary (trigger count, pattern length, shape values, port).
   No MIDI Trigger clip? Use raw beats: `--pattern "0,1,2,3" --length 4`.
   An **empty** Trigger clip is a no-op, not an error: `push` says so and
   sends nothing (not even a ping) — see `docs/lessons-learned.md` rule 5.
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
   and `plugout~` if present — delete the duplicates so only one pair
   remains, keeping the paste's connections).
   *This patch is substantially bigger than the capture tap's (~75
   objects — real-time transport polling and a variable-length trigger
   list need more machinery than a passthrough recorder). If it doesn't
   paste cleanly, build it by hand from the tables below — they describe
   every object and connection, organized by subsystem.*
3. Save (⌘S) — Live now shows the device on the Sidechain track.
   Optionally File → "Freeze Device" and save as `AWH Ducker.amxd` into
   your User Library for reuse across projects.
4. Verify: `awh mix duck push --fit fit.json --trigger-clip <clip>`
   should report the device replied to ping and print the pushed summary;
   `awh mix duck push --off` should snap it to unity.

### Manual build table (fallback)

The patch has four subsystems. Every `[value NAME]` object is Max's
standard named-storage idiom — any number of `[value NAME]` boxes sharing
a name share state automatically, so "write" and "read" instances below
are separate boxes with the same text, not a typo. Every `t` (trigger)
object fires its outlets **right to left** — the tables below rely on
that (Max's own documented behavior) to sequence cold-inlet setup before
a hot-inlet trigger, exactly like the capture tap's `t b f` for its loop
message.

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
| `value trigbeats` (write) | the **whole** beats list, stored directly (also fed from the slice's right outlet — `value` can hold a list) |
| `value on` (write) | from the `on` route outlet (already a bare 0/1) |
| `sel 0` (on the same `on` route outlet) → message `1.` | instant-bypass snap: `on 0` forces gain to unity right away, not via the release ramp |
| `udpsend 127.0.0.1 9723` | shared OSC out for pong + status |

#### 2. Status reply

| Object/message | Notes |
|---|---|
| `t b b b b b b` | fed by the `status` route outlet (bangs on a bare `/awh/duck/status`) |
| 6× `value NAME` (read instances of trigcount, depth, release, hold, attack, on) | one bang each, from the `t`'s 6 outlets |
| `pack 0 0. 0. 0. 0. 0` | 6 inlets: on(int) attack hold release depth(floats) trigcount(int) — wire the `t`'s outlets to pack **right-to-left matching pack's inlets right-to-left** (outlet5→inlet5 trigcount ... outlet0→inlet0 on) so the hot inlet (0, `on`) fires last, after every cold inlet is set |
| `prepend /awh/duck/status` → `udpsend 127.0.0.1 9723` | assembles and sends the reply |

#### 3. Transport polling → beat position

| Object/message | Notes |
|---|---|
| `loadbang` → `live.path live_set` → id into `live.object`'s **right** inlet | same binding idiom as the capture tap |
| `loadbang` → message `1` → `metro 1` left inlet | starts the poll clock on load (runs continuously — bypass/stop is handled by forcing gain to unity each tick, not by stopping the metro) |
| `loadbang` → message `-1.` → `value prevbeat` (write) | initial sentinel so the very first tick after load can't misfire |
| `metro 1` → `t b b` | **right outlet fires first** → message `get is_playing` → `live.object` left inlet; **left outlet fires second** → message `get current_song_time` → `live.object` left inlet. This order matters: is_playing must be fresh before the current_song_time chain reads it |
| `live.object` outlet → `route current_song_time is_playing` | LOM replies come back as `<propname> <value>` |
| `is_playing` outlet → `value isplaying` (write) | |
| `current_song_time` outlet → `expr fmod($f1,$f2)` inlet 0 (hot) | `patlen` is pre-loaded into inlet 1 (cold) directly from the shape/trigger-storage `unpack 0.` (subsystem 1) — no separate re-read needed, it only changes when `/awh/duck/triggers` arrives |
| `expr fmod` output → `t b f` | **right outlet (float) fires first** → `value curmod` (write); **left outlet (bang) fires second** → `value isplaying` (read) — curmod is safely stored before anything downstream reads it |

> **Assumption flagged for owner verification**: this uses the Live Object
> Model's `Song.current_song_time` property (beats, via `get
> current_song_time` on `live.object` bound to `live_set`) rather than the
> task's originally-suggested `[transport]` object + tick math, because it
> reuses the tap's own already-proven `live.path`/`live.object` idiom
> instead of inventing a new one. If `current_song_time` doesn't behave as
> expected in Max, the `[transport]`-object approach (poll ticks, divide by
> 480/quarter) is the documented alternative — swap this one block.

#### 4. Wrap check → crossing detection → envelope fire

| Object/message | Notes |
|---|---|
| `value isplaying` (read) → `sel 0` | **stopped branch** (outlet 0, matched): message `1.` → `line~` (unity snap) AND message `-1.` → `value prevbeat` (write, resets the sentinel so resuming starts a fresh cycle) |
| `sel 0` outlet 1 (not stopped = playing) → `t b b` | **right outlet fires first** → `value curmod` (read, a dedicated preload instance) → feeds the wrap-check `expr`'s cold inlet 1 AND the crossing `expr`'s cold inlet 2; **left outlet fires second** → `value prevbeat` (read, a dedicated preload instance) → feeds the wrap-check `expr`'s hot inlet 0 AND the crossing `expr`'s cold inlet 1 |
| `expr ($f1 < 0) \|\| ($f2 < $f1)` → `sel 1` | wrap/fresh-cycle test ($f1=prevbeat, $f2=curmod). Outlet 0 (matched=wrap): bang → **another, separate** `value curmod` (read) instance → `value prevbeat` (write) — just resync, no firing. **Do not** reuse the preload-read instance for this store; wiring one `value curmod` (read) box to both the comparator preloads and the prevbeat store creates a race that clobbers prevbeat before the comparisons read it |
| `sel 1` outlet 1 (not wrap) → `t b` → `t b b` | **right outlet fires first** → `value trigcount` (read) → `uzi`'s right (count) inlet; **left outlet fires second** → bang → `uzi`'s left inlet, starting the burst |
| `uzi 0 0` outlet 0 (index, fires N times) → `t b i` | **right outlet (int index) fires first** → `zl nth`'s right (index) inlet; **left outlet (bang) fires second** → `value trigbeats` (read) → `zl nth`'s left (list) inlet, which triggers the output = the beat value at that index |
| `zl nth` output (`bi`) → `expr ($f1 > $f2) && ($f1 <= $f3)` | inlet 0 = `bi` (hot); inlet 1 = prevbeat (cold, preloaded above); inlet 2 = curmod (cold, preloaded above). 1 = this trigger was crossed since the last tick |
| → `sel 1` (crossing found?) → `value on` (read) → `sel 1` (on == 1?) | both must match to fire — a crossing while bypassed does nothing |
| `uzi` outlet 1 ("done", after all N indices) → the dedicated resync `value curmod` (read) → `value prevbeat` (write) | end-of-tick resync, same dedicated instance as the wrap path |
| Fire (bang) → `t b b b b` | 4 outlets, right-to-left: release, hold, attack (cold `pack` inlets 3/2/1) then depth (hot) — depth's read feeds `* -1.` → `dbtoa` → `pack`'s hot inlet 0 |
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
- The transport-polling/crossing-detection subsystem (#4 above) is the
  most intricate part of this device and the part most worth checking
  first in Max if the generated `.maxpat` doesn't paste or behave cleanly
  — the algorithm is fully specified in the table above (and in
  `docs/design/analysis-engine.md`'s protocol section) so it can be
  rebuilt from scratch even if nothing about the generated JSON survives.
- `depthDb` is always sent as a **positive** number end to end (CLI → OSC
  → patch); the patch negates it (`* -1.`) right before `dbtoa` to get the
  trough's linear gain.
- Like the capture tap, this device is intentionally "dumb" about
  anything beyond envelope playback — shape/trigger decisions live in the
  CLI (`awh mix duck fit`/`push`), so the patch shouldn't need to change
  as the fitting logic evolves.
