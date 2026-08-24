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
awh clip from-audio <audioFile> <target> [--bpm N] [--quantize 1/16] [--dry-run]
    # melodic audio -> MIDI clip (Basic Pitch transcription, see below)

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

awh play [--from-bar N] / awh stop / awh jump <bar>   # transport (AWH Remote M4L device)
awh launch track:0/slot:0 | scene:1                    # fire a clip slot or scene
awh stop-clips [track:N]                               # call stop_all_clips
awh lib audition <slug> <track> [--keep] / --end       # place + press play on a library clip
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

## Audio-to-MIDI (`awh clip from-audio`) — melodic transcription

```sh
awh clip from-audio <audioFile> <target> [--bpm N] [--quantize 1/4|1/8|1/16|1/32|off]
    [--onset-thresh N] [--frame-thresh N] [--min-len ms] [--min-freq Hz] [--max-freq Hz]
    [--name <name>] [--dry-run]
    # target = track path (auto-picks an empty session slot) or an explicit
    # session slot (track:0/slot:2)
```

- Transcribes MELODIC audio (a vocal take, hummed idea, synth/bass recording)
  into a MIDI clip via Basic Pitch (polyphonic pitch estimate). Give the user
  the estimate honestly: note count, pitch range, duration, and the params
  used — this is a starting point to audition and correct, NOT ground truth.
- **NOT for drums** — for drum-hit timing use `awh drums detect-onsets`
  instead (it finds onset positions, not pitches).
- `--bpm` converts seconds to beats; if omitted it reads the Set's tempo, so
  usually you don't need to pass it. `--quantize` is `off` by default (raw
  performance timing) — turn it on when the user wants a cleaned-up grid-snapped
  result instead of the human feel.
- Zero notes detected (silence, quiet recording, wrong thresholds) is a
  normal outcome, not an error: it says so and creates nothing — don't retry
  blindly, ask the user if the file/thresholds are right.
- Explicit slot target with an existing clip: overwritten in place (same
  convention as `awh lib place`) — clamped to the existing clip's length if
  the transcription is longer (the gateway can't resize a clip), and it
  tells you if that happened.
- Always end with: this is an estimate — the user should audition and fix
  wrong notes/octaves before treating it as done.

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
awh drums mine <dir...> [--bpm N | --no-bpm-from-name] [--grid 16] [--save name]
    # RESEARCH: band-split rhythm-stat mining from a folder of drum loops —
    # reports numbers to compare against the built-in specs, never edits them
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
- `mine` measures REAL drum loops (a folder of audio files, BPM from the
  filename by default) — band-split (<120Hz/120Hz-2kHz/>2kHz, a kick/
  snare-clap/hat PROXY, not source separation) onset detection folded onto
  a 16th-grid, giving per-position hit-probability tables, density, and a
  swing estimate. It ONLY reports; it never edits
  `packages/core/src/drums/grammars.ts`/`styleSpec.ts` — those built-in
  specs are hand-authored and locked. `--save <name>` writes a measurement
  record into `library/measurements/` (same convention as `mix report
  --save`; `awh mix records` lists/shows both kinds). Zero audio files in
  the directory is a normal result (exit 0, states it, writes nothing) —
  not an error. See `knowledge/rhythm/waivops-drum-stats-pilot.md` for a
  worked example (pilot numbers vs. the built-in `HOUSE_STYLE_SPEC`/
  `TECHNO_STYLE_SPEC`/`TRAP_STYLE_SPEC` assumptions) and always quote its
  own pilot-sample-size caveat when citing it.

## Phrase engine (`awh drop`) — call-and-response drop writing

```sh
awh drop respond <callClip> <target> [--recipe r] [--seed N] [-n count] [--key k]
    [--style s] [--dry-run]
    # THE core feature: answer an EXISTING call clip. <target> = a track
    # path; candidates land in consecutive empty session slots, named
    # "resp <recipe> s<seed>". Default: one candidate per recipe.
awh drop phrase <target> [responseTarget] [--bars 8|16] [--style s] [--seed N]
    [--variant v] [--key k] [--at-bar N] [--dry-run]
    # CO-WRITE: cold-start an 8/16-bar call/response skeleton from a spec.
    # Two targets = paired call/response clips (equal length, each voice
    # silent during the other's bars). One target = single clip,
    # register-split (both voices in the same clip).
```

- Two contrasting voices trade phrases — a bright/high CALL and a low
  growl/stab RESPONSE — never a stacked, unrelated riff. The response
  always enters AFTER a rest (the "question mark"), never on top of the
  call, and always resolves to a stable low-register pitch (tonic/fifth by
  default) — the "answer" gesture. This is general call-and-response craft
  (`knowledge/arrangement/call-response-drop-grammar`,
  `call-response-rest-placement`), not a specific artist's technique unless
  a style entry says otherwise.
- `respond` is the everyday tool: point it at a call clip the owner already
  wrote (or transcribed via `awh clip from-audio`) and it proposes several
  named, reproducible candidate responses to audition — never presents one
  as final. Zero notes in the call clip is a normal result (nothing to
  respond to yet): it says so and writes nothing, same convention as
  `clip from-audio`'s zero-notes case.
- `phrase` is for starting from nothing: it generates BOTH voices from a
  spec's weighted call cells, applies the spec's evolution plan (state the
  pair verbatim, then vary the call only while the response anchors — see
  `knowledge/arrangement/drop-phrase-evolution`), and a turnaround reset cue
  at each phrase boundary. Use `--variant` to pin a named call cell
  (`awh kb show <phrase-style slug>` or the built-in's own `callCells`
  names), same idea as `drums gen --variant`.
- A target that already holds a clip is FILLED in place (notes clamped to
  its length), same occupied-target convention as `awh lib place` — never
  skipped or duplicated.
- `--style`: the built-in `bass-music-cr`, or a knowledge entry with slug
  `phrase-style-<name>` and an ```awh-phrase-spec``` block — same
  data-driven convention as drum styles (adding a style = writing
  knowledge, not code). Prints the entry's tier when used; never present a
  `draft` style's flavor as fact about a real artist.
- Always end with the honest reminder: candidates/skeletons are starting
  points to audition, never a finished part.

## Mix analysis (`awh mix`) — measurements, never vibes

```sh
awh mix capture -o <file> --from-bar N --bars N   # record post-FX via the M4L tap
awh mix report <file> [--bpm N] [--target name] [--delivery club|streaming|apple]
awh mix ab <fileA> <fileB> [--bpm N]              # loudness-matched A/B diff
awh mix target <refFiles...> --save <name>        # measure refs -> genre target
awh mix pitch <file> [--per-note]                 # periodicity-tracked f0 + harmonic-dominance flag
awh mix bands <fileA> [fileB...] [--bands "lo-hi,..."]  # calibrated per-band dBFS (masking compare)
awh mix layers <track:N> <track:M>... [--bars N --from-bar N]  # solo->capture->unsolo per track, then bands
awh mix advise <capture.wav | --record name> [--target name] [--layers name] [--preset club|streaming|apple] [--set] [--save [name]] [--compare name]
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
- **Masking toolkit** ("does my sub fight my bassline", "is this patch's
  fundamental where the note name says", "compare these layers"):
  `mix pitch` tracks f0 by periodicity (pyin), never the loudest FFT bin —
  it ALSO reports `harmonic_dominance` when a partial outgrows the
  fundamental (e.g. a growl mid-note); relay both, don't just relay f0.
  `--per-note` breaks a melody into onset-bounded notes instead of one
  average. `mix bands` gives calibrated dBFS per named zone (sub/low/scoop
  zone/low-mid/mid by default, or `--bands "lo-hi,..."`) — 0 dBFS = a
  full-scale sine, so numbers compare across sessions, not just within
  one. `mix layers` automates solo→capture→unsolo across a track list and
  runs `mix bands` on the results — it restores each track's PRIOR solo
  state (not just "unsoloed") even if a capture fails partway, so it's
  safe to run mid-session without risking a track left soloed.
- **Mix advisor** ("what should I fix", "give me a prioritized plan", "how
  do I get this ready for release") — `mix advise` runs the SAME
  measurement pipeline as `mix report` through a deterministic rule engine
  (`analysis/awh_analysis/advise.py`) and returns a RANKED plan, not a flat
  findings list. Ranking follows a fixed dependency ladder — integrity
  (clipping/headroom) → phase (low-band correlation) → masking (needs
  `--layers`) → tonal balance (needs `--target`) → dynamics (PSR) →
  loudness (LUFS vs `--preset`) — because an earlier stage's problems make
  later measurements unreliable (a phasey low end makes tonal deltas
  meaningless until it's fixed). **THE CONTRACT**: present the plan
  TOP-DOWN by rank, quote each item's evidence numbers VERBATIM (never
  round differently or restate a number the item didn't print), run an
  item's `verify` command when the owner asks you to confirm a fix landed,
  and NEVER add a move the engine didn't emit — no folklore EQ advice
  layered on top. A `blockedBy` list on an item names the ranks of
  earlier-stage items still open — tell the owner to fix those first;
  "re-measure after #1" is the engine's own honesty, not your paraphrase.
  Missing `--target`/`--layers` shows up as its OWN ranked item (what
  running `mix target`/`mix layers --save` would unlock), not silence.
  Zero actionable items is the HEALTHY state — say so plainly, don't
  invent problems to fill space; the engine still names the two metrics
  closest to tripping so the owner knows where the headroom actually is.
  `--set` additively names real devices already on the master chain in
  actions (e.g. "your existing EQ Eight" instead of "add an EQ Eight") —
  works fine without the gateway. `--save [name]` writes an advice record
  (`mix records`); `--compare <name>` diffs a fresh run against a saved
  one into resolved/improved/unchanged/new per item — the before/after
  loop after the owner acts on something.

## AWH Remote (`awh play` / `awh stop` / `awh jump` / `awh launch` / `awh stop-clips` / `awh lib audition`) — transport + clip launch

```sh
awh play [--from-bar N] [--sig beatsPerBar]   # start the transport (optionally
                                               # jumping the playhead first)
awh stop                                      # stop the transport
awh jump <bar> [--sig beatsPerBar]            # set current_song_time (arrangement playhead)
awh launch track:2/slot:0                     # fire a session clip slot
awh launch scene:1                            # fire a scene
awh stop-clips [track:N]                      # call stop_all_clips (omit track = whole Set)
awh lib audition <slug> <track> [--keep]      # place a library clip + press play on it
awh lib audition --end                        # sweep the pending (non---keep) audition
```

- The SDK has NO transport or clip-launch API at all (docs/sdk-feedback.md)
  — every command above is OSC to the **AWH Remote** M4L device
  (m4l/README.md), which supersedes the older AWH Capture Tap (same 9720/9721
  ports; `mix capture`/`op verify`/`mix duck` keep working unchanged against
  it). Requires that device loaded once by hand; if it's not, the error says
  so plainly ("requires the AWH Remote device...") — don't retry blindly,
  tell the user to load it (m4l/README.md's Install section).
- `launch`/`jump`/`stop-clips` respect Live's launch quantization and print
  the device's echoed reply; a bad index (e.g. a track/slot/scene that
  doesn't exist) comes back as a clear error from the device, not a hang.
- `lib audition` is the "make me hear this now" primitive: it places (`lib
  place`'s empty-slot logic) AND fires in one command. By default the
  clip is EPHEMERAL — auditioning the next slug (or `awh lib audition --end`)
  sweeps THIS one first, by its exact clip name (never a prefix sweep, so a
  similarly-named clip the owner kept is never touched). Pass `--keep` when
  the owner wants to keep what they're hearing — it then behaves like a
  normal `lib place` and won't be auto-swept.
- Zero empty session slots on the target track is a clear thrown error (same
  convention as `lib place`/`drop respond`) — tell the user to free one up or
  pick a different track, don't guess a slot to overwrite.

## Operator assistant (`awh op`) — recipes + audio-sample sound matching

```sh
awh op recipes                                  # list operator-recipe-* knowledge entries
awh op apply <recipe> <devicePath> [--dry-run] [--audition]
                                                 # write a recipe's params to a live Operator
awh op match <sample.wav> [--apply <devicePath>]
                                                 # analyze a sample -> tiered Operator patch proposal
awh op verify <ref.wav> <devicePath>            # closed-loop: audition + capture + compare
```

- `apply` validates EVERY param name against `device.get` before writing
  anything — an unknown/mistyped name (e.g. from a hand-edited recipe)
  fails loudly and writes NOTHING, never a partial patch. `--dry-run`
  prints the moves; `--audition` writes the recipe's `playNotes` to an
  empty session slot on the device's track for the owner to press play.
- `match` is TIERED, and tier 3 ("outside Operator's reachable set") is a
  NORMAL result, not an error — say so plainly, quote the specific
  measured property that's the blocker (harmonicity/pitch drift/inharmonic
  partials), and don't push the owner toward a patch that can't actually
  get there. Tiers 1-2 always include a `drawThesePartials` list (16
  amplitudes) — Operator's user-drawable harmonics are believed UI-only
  (unverified, not in the 195 automatable params), so hand this to the
  owner to draw in 30s whenever the stock-wave residual is high.
  `--apply <devicePath>` pushes only the proposal's `addressable` subset
  (same validate-first flow as `apply`) — those raw values are an
  explicitly-labeled HEURISTIC, not a calibrated curve; say so, don't
  present them as exact.
- `verify` is the closed loop (owner machine only) — needs the AWH Capture
  Tap M4L device (m4l/README.md) on the device's track/bus; it is NOT
  auto-iterated, report the score and let the owner tweak, then re-verify.
- Raw `device.param` values have NO verified display-unit curve beyond a
  single Volume point (`knowledge/setup/device-parameter-surface.md`,
  `compressor-raw-display-mapping.md`) — never claim a raw number means a
  specific ms/Hz/dB unless a knowledge entry says so.

## References (`awh ref`) — deconstruct, mark, correct

```sh
awh ref analyze <audio> [--save name]     # BPM/grid + bar energy arc +
                                          # rule-based intro/build/drop/breakdown
awh ref sections apply <analysis.json|audio>  # draft map -> named empty clips
                                          # on a "Sections" track
awh ref sections read <trackPath> [-o f]  # owner's corrections -> JSON
```

- The map is a DRAFT: always tell the owner the confidence values and that
  they should drag/rename the marker clips to correct it — then `read` the
  corrections back. Never treat low-confidence sections as fact.
- Half/double-time ambiguity (trap!) is surfaced in `bpm_runner_up` and
  notes — mention it when present, don't silently pick.
- `--save` makes the reference a knowledge citizen (library/references/);
  its embedded measurement profile feeds `mix target` comparisons.
- apply refuses a non-empty Sections track without --clear (usual rule).
- Building an arrangement against a reference: analyze -> apply -> owner
  corrects -> read -> use the corrected bars to shape an `awh sections`
  plan (bars per section come straight from the reference map).

## Scaffolding + chords (`awh new` / `awh chords`) — start from YOUR template

```sh
awh new project <name> [--template dir]  # copy the owner's template project
                                         # (disk only; they open it in Live)
awh new populate [scaffold.yaml]         # then: tempo, named tracks, starter
                                         # clips from the library, a chord bed
awh chords <target> --progression "i-VI-III-VII" [--key "A minor"]
    [--bars 8] [--voicing close|spread] [--rhythm whole|half|quarters|offbeat-stabs]
    [--bass] [--at-bar N]                # CO-WRITE: in-scale chord clip
```

- Progressions are roman numerals resolved against the SET's scale (or
  --key): qualities come from stacking the scale, so everything stays
  in-key; `7`, `sus2/4`, `dim/aug`, `b/#` borrowing, and explicit-quality
  `maj`/`min` suffixes supported — `i-iv-Vmaj-i` is how you get the
  conventional major dominant in natural minor (case is cosmetic;
  quality never comes from capitalization). The
  output lists the voiced pitches — read them back to the owner.
- CASE IS COSMETIC — `V` and `v` produce identical pitches; quality is
  100% scale-derived, never picked by case. This means the very common
  minor-key cadence `i-iv-V-i` (expecting a borrowed MAJOR dominant) gives
  the natural-minor diatonic (minor) v instead, silently. For that idiom,
  use `--key "<root> harmonic-minor"` instead — it correctly makes V major.
- Voice leading is on by default (minimal movement between chords);
  `spread` widens with the root low. "Chords too muddy" -> raise --center;
  "too thin" -> --bass adds the root an octave down.
- The scaffold (library/templates/scaffold.yaml) is the owner's own
  recipe — starters reference library slugs, so `new populate` places
  THEIR material, not invented content.

## Knowledge base (`awh kb` / `awh distill`) — read before you reason

`knowledge/<topic>/<slug>.md`: tiered (verified/sourced/draft), executable-
first entries. Topics are OPEN-ENDED (new domain = new directory). Saved mix
reports (`library/measurements/`) are part of the same surface.

```sh
awh kb list [--topic t] [--tag t] [--tier t]   # browse entries
awh kb topics / awh kb show <slug> / awh kb index
awh kb new <topic> <slug>            # scaffold a well-formed draft entry
awh distill [-o file]                # dump the open project for curation
```

- **Retrieval-first**: BEFORE genre/technique/setup tasks, grep
  `knowledge/INDEX.md` (or `awh kb list --topic <t>`). Setup entries (e.g.
  `sidechain-template`) are read before designing anything touching that
  part of the studio. Cite `slug [tier]` when applying an entry; NEVER
  present a `draft` as fact.
- **Capture**: when the owner says "remember this" / "save what we learned",
  `awh kb new` + fill in Executable + rule; end-of-session distillation via
  `awh distill` → curate notable clips into `awh save` and rules into
  entries. New entries you author are tier `draft` (or `sourced` WITH
  citations) — never `verified`; only the owner promotes.
- **Data-driven drum styles**: a `drum-style-<name>` entry with an
  ```awh-style-spec``` block makes `awh drums gen --style <name>` work for
  styles beyond the built-ins — adding a style = writing knowledge, not
  code. gen prints the entry's tier when it uses one.

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
- Right-click captures: the owner can 'AWH: Save clip to library' on any
  MIDI clip in Live — run `awh lib import` at session start (and whenever
  they mention having captured things) to drain those into
  clips/inbox/ drafts, then help name/tag/re-categorize them.
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

## Sample library (`awh samples`) — index, search, similarity

A machine-local index of the owner's OWN sample folders — never their
in-Live library clips (that's `awh lib`) — so "find me an amen break" can
be answered from material they already own instead of guessed at.

```sh
awh samples index <dir...> [--rescan]   # walk folders (wav/aiff/flac/mp3),
    # extract features, write ~/.awh/samples-index.json (override with
    # AWH_SAMPLES_INDEX). Incremental by path+size+mtime; deleted files
    # under the given folders are pruned; --rescan forces a full re-scan.
awh samples embed [--model music|general]  # M11b: compute missing/stale CLAP
    # embeddings for the whole index (batch, incremental — already-embedded
    # files are skipped; a model switch re-embeds everything, reporting
    # counts). Zero un-embedded files is a normal "up to date" state, not
    # an error. Must run before --semantic works at all.
awh samples pitch-tag                    # M11c: pitch-tag eligible kick/sub/
    # 808 one-shots (periodicity-tracked f0 via mix pitch, never a naive
    # FFT-peak pick) — enables `search --near-note`. Incremental, opt-in;
    # only one-shots whose energy is low-band-dominated are eligible
    # (hats/vocals/melodic loops are never candidates, by design).
awh samples search <query...> [--any] [--type loop|oneshot]
    [--min-dur s] [--max-dur s] [--bpm N --bpm-tol N] [--band low|mid|high]
    [--near-note <note> --cents N]
    # token match over normalized path tokens (ALL terms by default),
    # plus trait filters; ranked table, --json for the skill.
    # --near-note (M11c, Ableton convention e.g. "F1"): filter to
    # pitch-tagged kick/sub one-shots within --cents (default 50, a
    # quarter-tone) of that note — needs `pitch-tag` first.
awh samples search --semantic "<phrase>" [--type ...] [--min-dur ...]
    [--bpm ...] [--band ...]                # M11b: embeds the phrase (CLAP),
    # ranks by cosine similarity to actual audio CONTENT, not filename
    # tokens. Composes with the same trait filters as token search (filter
    # first, rank semantically) — NOT with plain query terms in the same
    # call. Files without an embedding are excluded and counted in a
    # footer ("N of M files not embedded — run awh samples embed"). If the
    # index has ZERO embeddings at all, this is a loud error naming
    # `awh samples embed` — it NEVER silently falls back to token search.
awh samples similar <file> [--count N] [--semantic | --traits]
    # ranks indexed samples against a reference file (need not be indexed
    # itself — embedded/scanned on the fly). Semantic (CLAP) is the
    # DEFAULT once the index has any embeddings; --traits forces the v1
    # MFCC/spectral/band-split vector; --semantic forces CLAP even if the
    # default would have picked traits (e.g. no embeddings yet, in which
    # case it errors rather than silently using traits).
awh samples stats                        # index size, roots, histograms
```

- **THE LLM CONTRACT — which search tool first**: for a CONTENT-language
  query — describing what the sound IS or DOES ("dusty breakbeat", "dark
  growl bass", "something like a four-on-the-floor techno drum loop") —
  try `search --semantic` FIRST (after confirming the index has
  embeddings; run `awh samples embed` first if not). For a NAME-like query
  — the owner names a pack, filename fragment, or exact trait ("the
  Vengeance snare", "amen break", "anything at 128 BPM") — token
  `search` remains first; it's exact and free, semantic search adds
  nothing when the owner already knows the name. Either way: search
  first, never invent a path. If the search narrows to ONE clear winner,
  use it and say why ("used `amen-break-170.wav` — the only hit for
  'amen break', 170 BPM matches the Set's tempo", or for semantic: "used
  `<path>` — top score 0.34 for 'dusty breakbeat', closest in the
  library"). If SEVERAL are plausible, present the top few with their
  traits (duration/type/BPM/band) AND their score if semantic, and ASK
  the owner which one — never silently pick among several equally-good
  candidates. Combined with AWH Remote's audition, candidates become
  listenable in Live before committing to one.
- **Scores are shown, never overclaimed.** A semantic score is "closest
  in the library" — relative ranking, not a confidence that it's "a
  match" or "the right sound." Relay it as a number for the owner to
  judge, the same spirit as `bpm_confidence` below.
- `index` must run before `search`/`similar` do anything useful — if asked
  to find a sample and the index is empty (or plainly stale — the owner
  mentions a folder that was never indexed), run `awh samples index
  <folder>` first rather than reporting "not found" against an empty index.
  `embed` is a separate, additional step on top of `index` — semantic
  search/similarity do nothing until it's run at least once.
- Zero hits is a normal result, not an error: relay the printed
  relaxation suggestions (fewer terms, `--any`, dropped filters) for
  token search, or the not-embedded footer for semantic search, rather
  than silently retrying with a guessed query.
- Token search matches PATH/FOLDER text; semantic search matches AUDIO
  CONTENT (CLAP embeddings); `similar --traits` matches TIMBRAL
  statistics (MFCCs + spectral shape + band split) — none of these three
  is musical key matching. `search --near-note` (M11c) IS real key
  matching, but scoped narrowly: only pitch-TAGGED kick/sub/808 one-shots
  (`pitch-tag` first), never loops or melodic material — say so if the
  owner expects a lead/pad/vocal to be key-filterable too, that's out of
  scope for now.
- **"Find a kick that matches my sub"**: run (or confirm already-run)
  `awh samples pitch-tag`, then `search --near-note <key root>` — the note
  is the SET's active key/scale root or whatever note the owner names, in
  Ableton convention (same as everywhere else in this CLI). A hit with NO
  pitch shown was never pitch-tagged or came back unvoiced (a genuinely
  broadband kick) — don't claim it matches a key either way.
- BPM only appears when the loop heuristic actually fires (duration +
  onset count); a one-shot or an ambiguous file legitimately has no BPM —
  don't invent one. Relay `bpm_confidence` rather than presenting an
  estimate as certain.
- The index (and its embeddings) is machine-local and never committed
  (absolute paths, meaningless off-machine) — don't suggest saving it to
  the repo or `awh lib`; if the owner wants a sample kept for reuse
  across projects, that's still `awh save`/`awh lib place` after they've
  picked it.

## Endless player (`awh endless`) — seeded, ever-different arrangements

A standalone deliverable, separate from everything above: it builds a
static, offline HTML+JS player from the owner's OWN produced/mixed audio
stems (not notes it writes into Live) — an endless, never-repeating
performance of one song, Bronze-style (docs/design/endless-player.md).
There's no in-browser composition: the "endless" part is authoring-time
variant pools (optionally from `awh drums`/`awh vary` renders) plus a
seeded arrangement/mix grammar that picks which pre-produced loop plays
next, forever.

```sh
awh endless plan --sections "intro:8,build:8,drop:16,break:8" --bpm 140 -o endless.yaml
    # or: awh endless plan --from-ref <name> -o endless.yaml   (bars/bpm from
    # a saved reference's corrected section map, M8 — see `awh ref`)
    # edit endless.yaml: fill in each section's pools with your bounced
    # audio file paths, add/rename layers, adjust transitions/rules — refuses
    # to overwrite an existing file without --force
awh endless build endless.yaml -o dist/my-song [--single-file]
    # validates LOUDLY first — every pool file exists, every file's duration
    # is bar-exact (+-25ms) to bars*4*60/bpm, every section reachable, no
    # empty pools — reports every problem before writing anything
awh endless demo -o dist/demo
    # zero-asset sanity check: synthesizes a tiny kick/hat+bass+pads song
    # and builds it, so you can hear the engine work with nothing of the
    # owner's yet
```

- Loops must be bar-exact — if a bounced stem has a reverb/delay tail,
  render it with the tail OVERLAPPED back onto the loop (not trimmed off);
  `awh endless build` checks duration, not tail cleanliness, so a clipped
  tail passes validation and still sounds wrong. Say this plainly when
  helping bounce stems.
- `build` writes `index.html` + `player.js` (zero deps) + the audio pools +
  `endless-README.md` into the output dir; the README's own one-command
  serve instruction (`python3 -m http.server`) is required because browsers
  block `fetch()` on `file://` — don't tell the owner to just double-click
  `index.html` for a multi-file build. `--single-file` inlines everything
  as `data:` URIs into one HTML (fine for demos/sharing; warns above 12 MB).
- This is NOT `awh sections` — `sections` writes an arrangement INTO the
  Live Set from source clips; `endless` builds a standalone web player from
  already-bounced audio files, outside Live entirely. Don't confuse a
  request to "build me a live arrangement skeleton" (→ `awh sections`) with
  "build me an endless/infinite version of my song to share" (→ `awh
  endless`).
- Never hand-edit the emitted `player.js` output to "fix" playback — it's a
  literal copy of `packages/cli/assets/endless/player.js`; report a bug
  instead of patching a build artifact.

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

**Turn a recorded/hummed idea into a MIDI clip** ("transcribe this vocal
take", "turn my hummed idea into notes", "get the melody out of this audio
file"):
1. Get the audio file (owner-provided, or rendered/captured from the Set).
   Get the tempo from `awh status` unless the user gives `--bpm` explicitly.
2. `awh clip from-audio <audioFile> <target>` — don't hand-transcribe pitches
   yourself or reach for `clip create`; this runs the real transcription
   model (Basic Pitch) and does the seconds→beats/clip-length math for you.
   `--dry-run` first if the user wants to see the note count/pitch range
   before committing anything to the Set.
3. Zero notes is a normal result (silence, quiet take, wrong thresholds) —
   it says so and writes nothing; don't retry blindly, ask about the file or
   loosen `--onset-thresh`/`--frame-thresh` if the user expects notes.
4. Tell the user plainly this is an ESTIMATE (polyphonic pitch detection,
   not ground truth) and to audition + fix wrong notes/octaves — never
   present it as a finished transcript. For drum-hit timing instead of
   pitches, use `awh drums detect-onsets`, not this command.

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

**Map out a reference track / build a matching skeleton** ("map out this
reference and build me a matching skeleton", "structure my track like
<reference>", "what's the arrangement of this reference song"):
1. Get the reference audio (owner-provided file, or a track/clip already in
   the Set — render it with `awh render` if it's on an audio track).
2. `awh ref analyze <audio> [--save <name>]` → BPM/grid + a rule-based DRAFT
   section map. This is NOT `awh sections` (that builds skeletons from the
   owner's OWN loops) — `awh ref` deconstructs someone else's track first.
3. `awh ref sections apply <analysis.json|audio>` → named empty clips on a
   "Sections" track. Tell the owner the per-section confidence and that
   low-confidence/unlabeled stretches are expected — the rules refuse to
   guess past their evidence rather than mislabel. Never present a
   low-confidence section as settled fact.
4. Owner corrects by dragging boundaries/renaming clips in Live. Then
   `awh ref sections read <trackPath> [--save <name>]` pulls the correction
   back — `--save` merges it into the saved reference record (`analyze`'s
   file only ever holds what was true at analyze time otherwise). Names are
   parsed leniently; don't "fix" a non-standard name the owner chose.
5. To build a matching skeleton: `awh sections plan --from-ref <file> --role
   <role>=<sourceClip> ...` where `<file>` is the `-o` output of `ref
   sections read` (or a saved `library/references/*.json`) — bars come
   straight from the reference's corrected map, every layer verbatim (no
   genre ops guessed, since an arbitrary reference has no known convention
   to apply). Mutually exclusive with `--form`. Same review-before-apply
   flow as the preset path: show the YAML, `apply --dry-run`, then apply.

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

**Find a sample from the owner's own folders** ("find me an amen break",
"got any deep house kicks in my packs", "find something dusty and
breakbeat-y", "find something like this sample", "what samples do I have
in this folder"):
1. If the relevant folder has never been indexed (or the owner mentions a
   folder you haven't seen before), `awh samples index <folder...>` first —
   it's incremental (unchanged files are skipped on repeat runs), so
   re-indexing a folder the owner already indexed is cheap and safe to do
   whenever unsure.
2. **Pick token or semantic search first, by query SHAPE** (see the
   Sample library section's LLM CONTRACT above): a CONTENT-language
   description ("dusty breakbeat", "dark growl bass") → `awh samples
   embed` (if the index has no embeddings yet — skip if it already does)
   then `awh samples search --semantic "<phrase>" [--type ...] [--bpm ...]
   [--band ...]`. A NAME-like query (pack name, filename fragment, exact
   trait like a BPM) → `awh samples search <query terms...> [--type
   loop|oneshot] [--bpm N --bpm-tol N] [--band low|mid|high]` — token
   search over path/folder names (pack folder names are often the best
   metadata a sample has). Zero hits is normal either way: relay the
   printed relaxation suggestions (token search: fewer terms, `--any`,
   dropped filters) or the not-embedded footer (semantic search) instead
   of silently guessing a different query or switching modes unasked.
3. **THE CONTRACT**: one clear winner (by tokens+filters, or top semantic
   score well ahead of the rest) → use it and tell the owner why ("used
   `amen-break-170.wav` — the only hit for 'amen break', and 170 matches
   the Set's tempo", or "used `<path>` — the clear top semantic score for
   'dusty breakbeat'"). Several plausible candidates → present the top few
   WITH their traits (duration/type/BPM/dominant band) and score if
   semantic, and ASK the owner which one — never silently pick among
   several equally-good options, never invent a path that didn't come out
   of search/similar. Semantic scores are relative ranking ("closest in
   the library"), never presented as "a match" or a confidence level.
4. For "something like this sample": `awh samples similar <refFile>
   [--count N]` — semantic (CLAP) by default once the index has
   embeddings, timbral (MFCC/spectral/band features) otherwise or with
   `--traits` forced; the reference doesn't need to be indexed itself.
   Neither is musical key matching — say so if the owner seems to expect
   harmonic matching.
5. For "find a kick/808 that matches my sub" or any note-specific request
   for a low-end one-shot (M11c): run `awh samples pitch-tag` first if it
   hasn't been run (check `awh samples stats`' pitch coverage line), then
   `search --near-note <note>` with the note the owner names or the Set's
   active key root, composed with whatever other filters/terms apply
   (e.g. `search kick --near-note F1`). This IS real key matching, but
   ONLY for pitch-tagged kick/sub/808 one-shots — never for loops or
   melodic material (those aren't eligible candidates, see the Sample
   library section above).
6. Once picked, hand off to whatever the owner actually wants to DO with
   it — audition via AWH Remote if available, `awh clip from-audio` for
   melodic material, `awh drums detect-onsets`/`awh op match` for
   drum/sound-design uses, or just report the path back.

**Generate or rework a drum pattern** ("give me a house groove", "make this
beat trap", "humanize my drums", "variations of my drum loop"):
1. `awh status --json` → find the drum-rack track (drum tracks list
   drumPads). Don't hand-compose drum notation — the drum tools are
   pad-aware and idiomatic.
2. New pattern → `awh drums gen <trackPath> --style house|techno|trap`
   (`--variant` for a specific named kick cell). Rework existing →
   `awh drums vary` (variations), `awh drums fill` (last-bar fill),
   `awh drums humanize` (groove) — NOT plain `vary`/hand edits.
3. Audition loop as with vary: name the slots, let the owner listen, sweep.

**Mine rhythm stats from real drum loops / check the drum grammar against
real data** ("how do real house kicks actually sit on the grid", "check our
trap pattern against real loops", "mine this sample pack for rhythm
stats"):
1. Confirm there's a folder of drum-loop audio files (not a single file —
   `mine` aggregates across a whole directory for a statistically
   meaningful position-probability table).
2. `awh drums mine <dir> --dataset <name> [--bpm N | --no-bpm-from-name]
   [--save <name> --attribution "<license/credit line>"]` — BPM comes from
   the filename by default (e.g. `138bpm_...`); pass `--bpm` for packs that
   don't encode it. `--save` only when the dataset's license permits
   reuse — put the EXACT required credit line in `--attribution`, verbatim,
   not paraphrased.
3. Relay the printed per-band (low/mid/high — a kick/snare-clap/hat PROXY,
   say so) position-probability table, density, and swing estimate
   verbatim — never invent a number the tool didn't print. Zero audio files
   found is a normal result (exit 0, states it) — not an error.
4. This is REPORTING ONLY: never edit `HOUSE_STYLE_SPEC`/
   `TECHNO_STYLE_SPEC`/`TRAP_STYLE_SPEC` in `grammars.ts`/`styleSpec.ts`
   from a mining result — those are hand-authored and locked. If the
   numbers are worth acting on, write/extend a `knowledge/rhythm/` entry
   comparing them to the built-in assumptions (see
   `waivops-drum-stats-pilot` for the format) and let the owner decide on
   any spec change separately, as its own reviewed edit.
5. Always state the sample size and caveat small-n pilots as suggestive,
   not definitive — a folder of a few dozen loops is a starting hypothesis,
   not a verdict.

**Answer a call clip with a response** ("give me some responses to this
lead", "answer this vocal chop with a bass growl", "write a call and
response for my drop"):
1. `awh status --json` → find the call clip (or transcribe/write one first
   — `awh clip from-audio` for a hummed/recorded idea, `awh clip create`
   for hand notation) and a target TRACK for the response voice (a
   different sound/track than the call — this is a PAIR, not a stack).
2. `awh drop respond <callClip> <targetTrack>` — don't hand-compose a low
   growl part yourself; this reads the call's actual notes and derives
   several reproducible candidates (default: one per recipe), each
   respecting the rest-before-entry and resolve-to-tonic/fifth rules. Zero
   notes in the call clip is a normal result (nothing to respond to yet) —
   it says so and writes nothing. `--dry-run` first to preview note counts
   before committing slots.
3. Name the candidate slots for the owner (`resp <recipe> s<seed>`) and let
   them audition; `awh sweep <targetTrack> --prefix resp` clears the rest
   once they've picked a favorite.

**Cold-start a call-and-response drop skeleton** ("write me a dubstep drop
from scratch", "give me an 8-bar call and response idea", "build a
call/response skeleton in this key"):
1. `awh status --json` → the Set's scale (or plan a `--key`), and two empty
   targets (or one, for the single-clip register-split form) — two
   different tracks/sounds for the two-voice pairing.
2. `awh drop phrase <callTarget> [responseTarget] --bars 8|16 [--style s]` —
   generates BOTH voices from a spec (weighted call cells, an evolution
   plan that varies the call while the response anchors, a turnaround reset
   at the phrase boundary) rather than one flat loop. `--dry-run` first;
   `--variant` to pin a specific call-cell feel.
3. Tell the owner plainly this is a SKELETON to audition and shape, never a
   finished drop — the engine writes notes, not sound design (the growl/
   chop timbre is still theirs to pick).

**Mix feedback / "how does my mix measure?"** ("check my low end", "is this
loud enough for clubs", "did that EQ change help"):
1. Get audio: `awh mix capture` (tap on the master, see m4l/README.md) or
   ask the owner for an export. Get the tempo from `awh status`.
2. `awh mix report <file> --bpm <tempo> [--target <name>] [--delivery club]`
   — quote the findings' numbers verbatim; never state a measurement the
   report didn't print. Offer `--save` so the measurement becomes a
   retrievable record (`awh mix records`).
3. Comparisons: `awh mix ab <before> <after>` (loudness-matched). For
   sidechain verification use `awh mix pump-check <SidechainBusCapture>
   --trigger-clip <Trigger>` — trigger-locked fit with a ducking/no-duck/
   inconclusive verdict (capture the ISOLATED ducked bus; it warns on
   full-mix bleed). The on/off `ab` pair remains the gold-standard proof.
4. No target yet? Offer `awh mix target <owner's reference tracks> --save
   <genre>` first — comparisons run against THEIR references, not folklore.

**Get a prioritized fix list / "what should I fix first", "is this ready to
release"** (a ranked plan, not a flat findings list):
1. Get audio (capture or export) as above. `awh mix advise <file>` alone
   already works — the dependency-ladder ranking and healthy-state check
   don't need `--target`/`--layers`.
2. Offer to unlock more of the ladder: `--target <name>` (build one first
   with `awh mix target` if the owner doesn't have one) for the tonal-
   balance stage, `--layers <name>` (from `awh mix layers ... --save
   <name>`) for the inter-element masking stage. Missing either shows up
   as its own ranked item telling the owner what running it would unlock
   — don't treat that as an error or silently skip the stage.
3. Present the ranked plan TOP-DOWN, quote every evidence number verbatim,
   and relay `blockedBy` as "fix #N first — this may change once you do."
   Never add a move the engine didn't emit, even a "usually you'd also…"
   aside — the whole point is a legible, cited rule table, not vibes.
4. Zero actionable items is the HEALTHY state, not a failure — say so, and
   relay the two metrics closest to tripping (with their margins) so the
   owner knows where the real headroom is.
5. `--set` (needs the gateway) additively names real master-chain devices
   in the actions instead of "add an EQ Eight" — offer it when the owner
   is in Live, skip it offline, never block on it.
6. After the owner (or you, on request) acts on one item: re-capture,
   `awh mix advise <newFile> --compare <savedAdviceName>` — relay resolved/
   improved/unchanged/new per item instead of re-explaining the whole plan
   from scratch. `--save [name]` on the FIRST run is what makes `--compare`
   possible later — offer it up front.

**Masking / "does my sub fight my bassline", "is this patch's fundamental
where I think it is", "compare these layers"** (narrowband/masking
diagnosis — `mix report`'s spectral tilt is broad-spectrum and can't
answer this by design):
1. Pitch check on one sample/patch: `awh mix pitch <file> [--per-note]` —
   f0 via periodicity tracking (never the loudest FFT bin); relay
   `harmonic_dominance` too when it's flagged (a partial outgrew the
   fundamental partway through — real information, not a detector error).
   `--per-note` on a melodic phrase/growl that changes note-to-note.
2. Narrowband energy compare: `awh mix bands <fileA> [fileB...] [--bands
   "20-100,140-200,200-500"]` — calibrated dBFS (0 dBFS = a full-scale
   sine, so it's comparable across sessions, not just within one) per
   named danger zone, plus each band's fraction of that file's total
   energy. Multiple files get an aligned table with deltas vs. the first.
3. Comparing several LIVE tracks/layers (not pre-rendered files):
   `awh mix layers <track:N> <track:M>... [--bars N --from-bar N]` — one
   command solos each track alone, captures it, restores its and every
   other track's PRIOR solo state (even if a capture fails partway — never
   leaves the Set soloed), then runs `mix bands` across the results.
   Needs the AWH Capture Tap; if it's not loaded the error says so
   plainly, solo state is still restored.
4. Zero tracks passed to `layers` is a printed state ("nothing to
   solo/capture/compare"), not an error — don't treat it as a failure.

**Press play, launch a clip/scene, or audition a library clip from chat**
("play this back", "start from bar 33", "launch that drop clip", "trigger
scene 2", "stop everything", "let me hear that garage hat loop on drums"):
1. This needs the AWH Remote M4L device (m4l/README.md) — the SDK has no
   transport or clip-launch API at all. If a command fails with "requires
   the AWH Remote device...", tell the owner to load it once (Install
   section); don't retry blindly or fake success.
2. Transport: `awh play [--from-bar N]` / `awh stop` / `awh jump <bar>` —
   jump sets the arrangement playhead (`current_song_time`), play optionally
   jumps first via `--from-bar`.
3. Launch: `awh launch track:2/slot:0` (session clip slot) or `awh launch
   scene:1` (scene) — respects Live's launch quantization; `awh stop-clips
   [track:N]` stops one track's clips or (no arg) the whole Set.
4. "Let me hear my saved X on this track": `awh lib audition <slug> <track>`
   — one command that places (empty-slot logic, same as `lib place`) AND
   fires. It's EPHEMERAL by default: auditioning the next slug (or `awh lib
   audition --end`) sweeps this one first, by its EXACT clip name (never a
   prefix — a similarly-named clip the owner kept is safe). Pass `--keep` if
   the owner wants to keep what they just heard.
5. A bad track/slot/scene index comes back from the device as a clear error,
   not a hang or silence — relay it, don't guess a different index.

**Sound-design an Operator patch** ("give me a growl bass on Operator",
"make this sound like <sample>", "dial in a pluck patch"):
1. Starting from craft knowledge: `awh op recipes` → pick a slug, then
   `awh op apply <recipe> <devicePath> [--dry-run] [--audition]` — validates
   every param NAME against the live device before writing anything (fails
   loudly, writes nothing, on a mistyped/missing param); `--audition` drops
   the recipe's playNotes into an empty session slot to press play.
2. Starting from a reference sound: get the audio (owner-provided, or
   rendered/captured from the Set), then `awh op match <sample.wav>` — a
   TIERED proposal, never a guess dressed as certainty. Tier 3 ("outside
   Operator's reachable set") is a NORMAL, expected result for
   noisy/inharmonic/formant-heavy material — relay the specific measured
   reason (harmonicity/pitch drift/inharmonic partials), don't push the
   owner toward a patch Operator can't actually produce.
3. On a tier-1/2 match: relay the oscillator/envelope/filter targets and
   the honest confidence (residual). ALWAYS hand the owner the
   `drawThesePartials` list too — Operator's user-drawable harmonics are
   believed UI-only (unverified, not automatable), a 30-second manual step
   when the stock-wave residual is high. `--apply <devicePath>` pushes only
   the addressable subset (same validate-first flow as `apply`); its raw
   values are an explicitly-labeled heuristic, not a calibrated curve — say
   so plainly, don't claim precision the system doesn't have.
4. To verify against the real sound (owner's machine, needs the AWH Capture
   Tap on the device's bus, m4l/README.md): `awh op verify <ref.wav>
   <devicePath>` — NOT auto-iterated; report the score, let the owner
   tweak, then re-verify (measure→adjust→verify, same discipline as mixing).

**Sidechain ducking** ("tune my sidechain", "duck the bass to my kick",
"set up sidechaining"). Read knowledge/setup/sidechain-template.md first —
the owner's template routes BASS/SAMPLES through a Sidechain bus with a
MIDI "Trigger" track. Always start from the fit, then pick a strategy:
1. FIT (both strategies): capture the DRUMS bus over a span starting on the
   Trigger pattern's boundary, then
   `awh mix duck fit <drumsCapture> --trigger-clip <Trigger clip>`.
   No MIDI Trigger clip (audio one-shot kits)? Derive real positions first:
   `awh drums detect-onsets <drumsCapture> [--make-clip <target>]` — NEVER
   guess trigger beats; fit now warns when triggers don't match real hits
   (peak far from window start / absurd peak-over-floor) — treat those
   warnings as a stop, not noise.
   (`--bass <bassCapture>` → masking-based depth) → measured kick body/tail
   + depth/hold/release + points.
2. AUTOMATIC strategy (default when the owner says "automatic" or has no
   ShaperBox on the track): `awh mix duck setup <Sidechain track>` inserts
   a preset stock Compressor and prints the TWO manual touches (enable
   Sidechain + Audio From = trigger source; Release dial) — the SDK cannot
   set routing, don't pretend otherwise. Then with the tap on the ducked
   bus: `awh mix duck calibrate <devicePath> --target-depth <fit depth>
   --trigger-clip ... --from-bar N --bars 4` — it captures/measures/adjusts
   Threshold in a closed loop and reports the achieved depth.
3. SHAPERBOX strategy (owner's classic template): read the fit numbers as
   drawing instructions. Mechanics (docs/research/shaperbox-preset-format
   .md): LFO Length in ms = the printed gap, MIDI Trigger "On",
   sharp-corner points for dip/hold, smooth for release; Favorites /
   LFO copy-paste for reuse. Preset FILES cannot be generated — never
   offer to write one.
4. M4L DUCKER strategy (full-auto, no routing clicks): needs the AWH
   Ducker device placed ONCE by hand on the Sidechain bus (m4l/README.md —
   this one manual step remains, the SDK cannot insert M4L devices).
   `awh mix duck fit <drumsCapture> --trigger-clip <Trigger clip> --json >
   fit.json` then `awh mix duck push --fit fit.json --trigger-clip
   <Trigger clip>` — pings the device, pushes the envelope + trigger
   pattern over OSC, and turns it on. `--off` bypasses it (unity gain).
   No Trigger clip? `--pattern "0,1,2,3" --length 4` (raw beats). An empty
   Trigger clip is a no-op — it says so and sends nothing, not an error.
5. VERIFY (any strategy): `awh mix duck measure <SidechainBusCapture>
   --trigger-clip ...` (achieved depth) or an on/off `awh mix ab` pair
   (for the M4L Ducker, "on/off" = `duck push` / `duck push --off`).
   If the measured kick tail forces a groove-killing duck, suggest
   tightening the kick's own decay.
Volume-automation ducking is NOT possible via the gateway (no automation
API) — say so if asked; don't improvise workarounds into real projects.

**Start a new track / add a chord bed** ("new project", "start something
in F minor", "give me chords under this"):
1. New project: `awh new project <name>` (their template; if it errors about
   a missing template, walk them through copying their starting-point
   project folder to library/templates/project once). They open it in Live;
   then `awh new populate` applies their scaffold — show what it did.
2. Chords: `awh status` for the scale, then `awh chords <target>
   --progression <spec>` — pick progressions that fit the genre (the KB's
   arrangement/rhythm entries may name idiomatic ones; cite if used).
   Read the voiced pitches back; offer --voicing/--rhythm variants rather
   than re-guessing.

**Answer from / add to the knowledge base** ("what do we know about X",
"how does <artist> do Y", "remember this", "save what we learned today"):
1. Retrieval: `awh kb list --topic <t>` or grep `knowledge/INDEX.md` FIRST —
   if an entry covers it, `awh kb show <slug>`, apply its Executable
   section, and cite `slug [tier]`. Only reason from scratch when the KB is
   genuinely silent (and say so).
2. Capture: `awh kb new <topic> <slug>` (topics are open-ended — invent a
   directory if none fits), fill in Executable + rule; your entries are
   `draft` (or `sourced` with citations), never `verified`.
3. End-of-session: `awh distill -o /tmp/distill.md` dumps the project;
   curate the notable clips into `awh save` and the lessons into entries.

**Build an endless/infinite web version of a song to share** ("make an
endless version of my track", "build me a Bronze-style infinite player",
"I want a version of this song that's different every time"):
1. This is OUTSIDE the Live Set entirely — don't reach for `awh sections`
   (that writes an arrangement INTO Live from source clips) or hand-compose
   anything; it's a standalone static web page built from the owner's own
   bounced/mixed audio stems.
2. Confirm the owner has (or will bounce) bar-exact loops per section per
   layer — if unsure what "bar-exact" means here, offer `awh endless demo -o
   <dir>` first so they can hear the engine work with zero real assets.
3. `awh endless plan --sections "intro:8,drop:16,..." --bpm <bpm> -o
   endless.yaml` (or `--from-ref <name>` if they have a corrected reference
   section map from `awh ref`) → an editable, fully-commented scaffold with
   EMPTY pools. Don't skip straight to `build` — the owner fills in real
   audio file paths first.
4. `awh endless build endless.yaml -o dist/<name>` → validates every file/
   duration/reachability/pool loudly before writing anything; relay every
   listed problem plainly (missing file, wrong duration, unreachable
   section, empty pool) rather than guessing a fix. `--single-file` for a
   single shareable HTML.
5. Point them at the emitted `endless-README.md`'s serve instruction — a
   multi-file build needs `python3 -m http.server`, not double-clicking
   `index.html` (browsers block `fetch()` on `file://`).

**Tweak a device:** `awh call device.get` first (params carry name/min/max/
current value; values are RAW Live-internal numbers — check min/max, not
assumed units), then `device.param`. For mixer moves use `track.mixer`
(volume 0.85 raw = 0 dB unity, 1.0 = +6 dB; see docs/research/
mixer-calibration.md).
