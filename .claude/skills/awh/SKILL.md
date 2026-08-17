---
name: awh
description: >
  Drive the user's Ableton Live Set through the awh CLI (Ableton Workflow
  Helper). Use whenever the user asks to read or change anything in their
  open Live Set — tracks, MIDI clips, notes, devices, scenes, tempo, mixer —
  or to generate/vary musical material into Live. Trigger on "my set",
  "this clip", "add a bassline", "make variations", track/device names, or
  any Ableton production request. Requires the AWH gateway extension running
  inside Live (or `awh serve-fake` for offline work).
---

# awh — driving Ableton Live from the CLI

AWH exposes the user's open Live Set through a localhost gateway. The `awh`
CLI is the ONLY way you touch Live — every command is deterministic and maps
to one logical, undoable action. There is no AI-special path: anything you
can do, the user can script.

## Ground rules

1. **Read before you write.** Start almost every task with
   `awh status --json` (compact Set summary: tracks, clips, devices, paths).
   Never guess a path or a track's contents.
2. **Paths are addresses, not identities** — `track:0/slot:2`, `track:1/arr:0`,
   `track:0/dev:0/chain:3/dev:1`. Indices shift when the user moves/deletes
   things. Re-read the summary after any structural change (create/delete/
   duplicate of tracks, scenes, clips) before issuing more writes.
3. **Note writes REPLACE the whole clip.** `awh clip write` and `clip.notes`
   overwrite every note. To edit a few notes: `awh clip read` → modify the
   notation → `awh clip write` the full result back.
4. **Verify after writing.** Re-read the clip (or summary) after a write and
   confirm the result matches intent before telling the user it's done.
5. **Authorship mode is explicit.** When varying the user's material, respect
   the mode they asked for: TRANSFORM (rework only their existing notes —
   rhythm, density, octaves, articulation) vs CO-WRITE (invent new melodic
   material). If unstated and it matters, ask.
6. **Undo:** each op is one undo step in Live; clip-create-with-notes is two
   (create, then notes — platform constraint). Tell the user if they'll need
   more than a couple of undos to revert something.
7. **The user is the audition loop.** You cannot hear the Set and cannot press
   play. After writing material, stop and let the user listen and react.
8. If the gateway is unreachable, tell the user to check that Live is running
   with the AWH extension loaded — do not retry endlessly.

## Commands

```sh
awh status [--json]            # Set summary: tempo/scale/tracks/clips/devices
awh ops                        # list every raw gateway op
awh call <op> --args '<json>'  # invoke any raw op (see `awh ops`)

awh clip read  <clipPath>            # MIDI clip -> bar|beat notation
awh clip write <clipPath> [file]     # notation (file or stdin) -> REPLACE notes
awh clip create <target> [file]      # new clip from notation
    # target = slot path (track:0/slot:2), or track path + --at-bar <bar>
    # options: --length <beats> --name <name> --sig <beatsPerBar>

awh render <trackPath> --from <beat> --to <beat>   # audio track pre-FX -> file
awh serve-fake                 # offline gateway with a fake Set (for testing)

awh transforms                 # list the deterministic variation transforms
awh vary <clipPath> --ops "<pipeline>" [-n 8] [--seed N] [--dest track:X]
                               # N seeded variations into empty session slots,
                               # named <prefix>-v1..N for auditioning
awh vary <clipPath> --arrange [--at-bar N] ...
                               # ARRANGEMENT mode: variations laid out
                               # sequentially on the timeline (default: right
                               # after the track's last arrangement clip)
awh sweep <trackPath> --prefix <p>   # delete audition clips by name prefix
                                     # (session AND arrangement)
```

Source clips can come from either view (`track:0/slot:2` or `track:0/arr:1`).
For arrangement-centric users, prefer `--arrange`: they play through the
timeline and hear each variation in sequence — put them at `--at-bar` past the
song's end (or on a spare `--dest` track) to avoid overwriting real material.

## Variations (`awh vary`) — the anti-"tweak forever" loop

`vary` applies a TRANSFORM pipeline N times with different seeds — it reworks
the user's existing notes deterministically (same seed = same result). Use it
for the transform authorship mode; for co-writing, compose notation yourself.

Pipeline spec: space-separated steps, `name:key=value,key=value`:

```
awh vary track:0/slot:1 -n 8 --seed 42 \
  --ops "transpose-scale:degrees=2 syncopate:probability=0.5 humanize"
```

Transform vocabulary (see `awh transforms` for params): pitch —
`transpose`, `transpose-scale` (needs the Set scale or `--scale "C minor"`),
`octave`, `invert`; time — `quantize`, `swing`, `syncopate`, `rotate`,
`stretch`, `retrograde`; texture — `thin`, `densify`, `legato`, `staccato`,
`fill`, `velocity-shape`, `humanize`.

Flow: vary → tell the user which slots to audition → they pick favourites →
`awh sweep` the rest (sweep deletes by name prefix — confirm the prefix with
the user before sweeping anything they might have renamed). Vary needs enough
empty slots; create scenes via `awh call scene.create` if it says there aren't.

## Sections (`awh sections`) — motif -> arrangement skeleton

Build a full arrangement from source loops via an editable YAML plan:

```sh
awh sections plan --form house --role drums=track:0/slot:0 --role bass=track:2/slot:0 -o plan.yaml
# edit plan.yaml (bars, per-section ops, add/remove layers), then:
awh sections apply plan.yaml --seed 42 [--at-bar N] [--clear] [--dry-run]
```

- Forms: `house` (intro/build/drop/breakdown/build/drop/outro, 128 bars),
  `trap` (intro/verse/hook x2/outro, 80 bars). The plan is a STARTING POINT —
  edit bars and ops per section; each layer derives from its source clip via a
  transform pipeline (never verbatim tiling unless ops are omitted).
- apply REFUSES to write over existing arrangement material — offer the user
  `--clear` (clears the span first) or `--at-bar` past the song's end. Always
  `--dry-run` first when the Set has real material, and show the user the plan.
- Deterministic: same plan + seed = identical skeleton. Sections are named
  `<section>-<role>` on the timeline.
- Flow: plan -> user reviews/edits YAML (or asks you to adjust it) -> dry-run
  -> apply -> user auditions -> iterate on the YAML, not the clips.

## Drums (`awh drums`) — pad-aware patterns

```sh
awh drums gen <trackPath> --style house|techno|trap [--bars 4] [--density 0..1]
    [--seed N] [--slot s | --at-bar N]     # CO-WRITE: new pattern from grammar
awh drums fill <clipPath> [--style s]      # TRANSFORM: fill into the last bar
awh drums humanize <clipPath> [--timing 0.02] [--velocity 8]   # role-aware groove
awh drums vary <clipPath> [-n 4] [--amount 0..1]   # role-aware variations
```

- `gen` maps the track's drum-rack pads to roles (kick/snare/clap/hats/...)
  by pad name, GM notes as fallback — it warns when no rack was found; check
  the track has a drum rack first via `awh status`.
- Grooves are CELL-based: the kick figure is a seeded pick from curated
  common variations, held for the whole loop (only velocities/ghosts/rolls
  breathe per bar; every 4th bar is a turnaround with a fill gesture). Trap
  cells are nameable — `--variant hold|double-tap|late-lean|rolling|sparse|
  syncopated` — so "try the other common kick feel" = re-run with a
  different variant, not a different seed. gen prints which cell it chose.
- Use `drums vary` (not plain `vary`) for drum clips: it keeps kick anchors
  and backbeats while re-rolling hats and ghosts. `fill`/`humanize` edit IN
  PLACE — one undo reverts; re-read to show the user what changed.
- density/style requests map naturally: "busier" → higher --density,
  "darker/minimal" → techno at lower density, "half-time/trap" → trap.

## Mix analysis (`awh mix`) — measurements, never vibes

```sh
awh mix capture -o <file> --from-bar N --bars N   # record post-FX via the M4L tap
awh mix report <file> [--bpm N] [--target name] [--delivery club|streaming|apple]
awh mix ab <fileA> <fileB> [--bpm N]              # loudness-matched A/B diff
awh mix target <refFiles...> --save <name>        # measure refs -> genre target
```

- **Quote the numbers; never invent one.** The report's findings each carry
  value/threshold/suggestion — relay them, prioritize alerts, and explain in
  plain producer language. If a measurement isn't in the output, say so.
- Typical loop: capture (or ask the user for an export) → report → discuss →
  user tweaks (or asks you to, e.g. EQ Eight via device ops) → capture again
  → `awh mix ab` old vs new. AB is loudness-matched — tell the user this
  kills the louder-sounds-better illusion.
- Always pass `--bpm` (from `awh status`) so sidechain pump gets verified.
- Targets are the USER'S own measured references (`awh mix target`), stored
  in `library/targets/` — offer to build one from their reference tracks
  before comparing; never compare against a vibe.
- capture requires the AWH Capture Tap M4L device (m4l/README.md) on the
  master; if it fails, fall back to asking the user to export the span and
  run report on that file.

## Library (`awh save` / `awh lib`) — the owner's clip memory

Git-versioned clips under `library/clips/<category>/<slug>.md` (markdown +
frontmatter + executable notation). USE IT: before composing drums/bass/hats
from scratch, check `awh lib list` (or grep `library/clips/INDEX.md`) — placing
the owner's own proven material beats re-inventing it. Cite slug + tier when
you use an entry ("placing rolling-garage-hats-1 [verified]").

```sh
awh save <clipPath> --category hats [--as slug] [--tags garage,shuffle]
    [--tier draft|sourced|verified] [--project name]   # capture from the Set
awh lib list [--category c] [--tag t]     # browse
awh lib show <slug>                       # full entry incl. notation + notes
awh lib place <slug> <target> [--at-bar N]   # write it into the Set —
    # FILLS an existing clip at the target (tiled/truncated to its length)
    # rather than erroring or duplicating; creates fresh only if empty
awh lib index                             # regenerate INDEX.md
```

- Save liberally when the owner likes something ("save that hat loop"); default
  tier is `draft` — the owner promotes to `verified` after real use.
- Slugs are unique across the whole library; `--overwrite` updates an entry.
- Live-browser mirror: `awh lib export-alc` renders every clip to a generated
  Pack of .alc Live Clips (drag into Places once; re-exports auto-re-index).
  Requires a one-time golden template — if it errors about the template, walk
  the owner through: one MIDI clip, no devices on the track, drag to User
  Library, `awh lib capture-template <file>.alc`. Reverse: `awh lib import-alc`
  pulls a .alc into the library.

Raw ops cover everything else (see `awh ops` for the full list + args):
tracks (`track.create/update/delete/duplicate/clear-range/mixer`), scenes,
devices (`device.insert/get/param/delete` — stock Live devices only),
drum racks (`drum.pad-note`), Simpler (`simpler.sample`), `set.tempo`,
audio clips (`clip.create-audio`).

## bar|beat notation

One note (or chord) per line: `bar|beat pitch(es) duration [vN] [pN] [m]`

```
sig 4/4              # optional header (default 4/4)
1|1   C3        1    v100   # bar 1 beat 1, middle C, 1 beat, velocity 100
1|2.5 Eb3       1/2         # fractional beats; velocity defaults to 100
2|1   C3+Eb3+G3 2    v90    # chord ("+" joins pitches)
2|4   D3        1/4  p60 m  # p = probability %, m = muted
```

- **Positions and durations are in BEATS** (quarter notes in 4/4), 1-based:
  `1|1` is the clip start; an eighth note is `1/2` or `0.5`.
- **Pitch names use Ableton's convention: middle C (MIDI 60) = C3.**
  Range C-2..G8. `#` and `b` accidentals.
- `#` starts a comment; blank lines are fine.
- Groove tips: velocity variation (`v90`/`v70` on off-beats) and `p` values
  make parts breathe; keep drum hits short (1/4 beat) on drum-rack tracks
  (pads listed with their MIDI notes under the track's drumPads).

## Typical flows

**Add a bassline to a track** (co-write):
1. `awh status --json` → find the MIDI track, tempo, scale.
2. Compose notation in the Set's key; write with
   `awh clip create track:2/slot:0 <<'EOF' ... EOF` or `--at-bar` for the
   arrangement.
3. Re-read to verify; hand back to the user to audition.

**Vary an existing loop** (transform — "make me N variations", "more
syncopated", "denser", etc. on material that already exists in the Set):
1. `awh status --json` (or `awh clip read`) → confirm the source clip and the
   Set's active scale.
2. Pick a transform pipeline from `awh transforms` that matches the request
   (e.g. "more syncopated" → `syncopate:probability=...` [+ `humanize`]).
   Don't hand-compose new notation for this — `awh vary` deterministically
   reworks the source's own notes, which is both faster and exactly what
   "variations of X" means.
3. `awh vary <sourcePath> -n N --ops "<pipeline>"` → writes N seeded, named
   variations (`--arrange` instead of session slots for arrangement-centric
   users). Re-read one or two to sanity-check before handing back.
4. Tell the user which slots/positions to audition; `awh sweep` the rest once
   they've picked favourites.

**Build an arrangement/skeleton from loops** ("build me a house/trap
skeleton", "turn my drum and bass loops into an arrangement", "lay out the
song structure"):
1. `awh status --json` → identify the source loops (drums/bass/etc.) and the
   Set's active scale.
2. Don't hand-compose section-by-section with `clip create`/`clip write` —
   that's slower, undocumented to the user, and skips the safety checks.
   `awh sections plan --form <house|trap> --role <name>=<sourcePath> ...`
   generates an editable YAML plan from a researched genre-form preset.
3. Show the user the YAML (or the edits you made to it) before writing
   anything — the plan IS the review step.
4. `awh sections apply <plan> --dry-run` → confirm the clip list looks right.
5. `awh sections apply <plan> [--at-bar N] [--clear]` → writes the skeleton.
   It refuses to overwrite existing arrangement material without `--clear`;
   don't fight that by hand-placing clips instead — use `--at-bar` past the
   song's end, or ask the user before `--clear`ing real content.

**Save/place a library clip** ("save that hat loop for later", "place my
garage hats", "use my saved bassline"):
1. Saving: `awh save <clipPath> --category <c> [--tags ...] [--tier ...]` —
   don't hand-copy the notation anywhere yourself, `save` captures the notes
   plus BPM/scale/source context automatically.
2. Placing: `awh lib list`/`grep library/clips/INDEX.md` to find the slug,
   then `awh lib place <slug> <target>` — `<target>` is a session slot path,
   an arrangement clip path, or a track path with `--at-bar`. If the target
   is EMPTY, it creates a new clip at the entry's saved length. If the
   target already holds a clip (e.g. a pre-blocked empty placeholder), it
   FILLS that clip instead — tiling/truncating the entry's notes to match
   the existing clip's length. Either way, one command; don't hand-read the
   entry's notation and `clip write`/tile it yourself.
3. If the request doesn't specify where ("place my garage hats"), don't
   guess a target silently — pick an empty session slot (or an obviously
   matching placeholder clip) on a sensibly-named track, or ask the owner
   where they want it.

**Tweak a device:** `awh call device.get` first (params carry name/min/max/
current value; values are RAW Live-internal numbers — check min/max, not
assumed units), then `device.param`. For mixer moves use `track.mixer`
(volume 0.85 raw = 0 dB unity, 1.0 = +6 dB; see docs/research/
mixer-calibration.md).
