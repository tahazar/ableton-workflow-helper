# AWH Capture Tap (Max for Live)

A tiny M4L **audio effect** that closes the measure→adjust→verify loop:
it passes audio through untouched, records its input to a file on command,
and (because M4L has full LOM access) starts/stops Live's transport over a
chosen arrangement loop. Driven by `awh mix capture` over OSC on localhost.

Put it **last on the Main/master chain** to capture the mixdown, or at the
end of any bus/track chain to capture that signal post-FX.

## Protocol (UDP, localhost)

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

## Install

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

## Manual build table (fallback)

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

## Notes

- Recording format: whatever `sfrecord~`'s default is for the path
  extension (`.wav` recommended; 24-bit is Max's default WAV depth — fine
  for measurement).
- The tap never touches the audio (straight passthrough) — safe to leave on
  the master.
- Ports are hardcoded in the patch (9720/9721); change both the patch and
  `--tap-port` if they collide with something.
- This device is intentionally dumb: all sequencing lives in the CLI, so
  the patch never needs to change as workflows evolve.
