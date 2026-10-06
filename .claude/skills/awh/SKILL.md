---
name: awh
description: >
  Drive the user's Ableton Live Set through the awh CLI (Ableton Workflow
  Helper). Use whenever the user asks to read or change anything in their
  open Live Set (tracks, MIDI clips, notes, devices, scenes, tempo, mixer)
  or to generate/vary musical material into Live. Trigger on "my set",
  "this clip", "add a bassline", "make variations", track/device names, or
  any Ableton production request. Requires the AWH gateway extension running
  inside Live (or `awh serve-fake` for offline work).
---

# awh: driving Ableton Live from the CLI

AWH exposes the user's open Live Set through a localhost gateway. The `awh`
CLI is the only way you touch Live. Every command is deterministic and maps
to one logical, undoable action. There is no agent-only path: anything you
can do, the user can script.

## Ground rules

1. **Read before you write.** Start almost every task with
   `awh status --json` (compact Set summary: tracks, clips, devices, paths).
   Never guess a path or a track's contents.
2. Paths are addresses, not identities: `track:0/slot:2`, `track:1/arr:0`,
   `track:0/dev:0/chain:3/dev:1`. Indices shift when the user moves or
   deletes things. Re-read the summary after any structural change
   (create/delete/duplicate of tracks, scenes, clips) before more writes.
3. Note writes replace the whole clip. `awh clip write` and `clip.notes`
   overwrite every note. To edit a few notes: `awh clip read`, modify the
   notation, then `awh clip write` the full result back.
4. Verify after writing. Re-read the clip (or summary) and confirm the
   result matches intent before telling the user it's done.
5. Authorship mode is explicit. When varying the user's material, respect
   the mode they asked for: TRANSFORM (rework only their existing notes:
   rhythm, density, octaves, articulation) or CO-WRITE (invent new melodic
   material). If unstated and it matters, ask.
6. Undo: each op is one undo step in Live; clip-create-with-notes is two
   (create, then notes; a platform constraint). Tell the user if reverting
   will take more than a couple of undos.
7. The user is the audition loop. You cannot hear the Set or press play
   (except through AWH Remote). After writing material, stop and let the
   user listen and react.
8. If the gateway is unreachable, tell the user to check that Live is
   running with the AWH extension loaded. Do not retry endlessly.

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
                               # arrangement mode: variations laid out in
                               # sequence on the timeline (default: right
                               # after the track's last arrangement clip)
awh sweep <trackPath> --prefix <p>   # delete audition clips by name prefix
                                     # (session and arrangement)

awh play [--from-bar N] / awh stop / awh jump <bar>   # transport (AWH Remote M4L device)
awh launch track:0/slot:0 | scene:1                    # fire a clip slot or scene
awh stop-clips [track:N]                               # call stop_all_clips
awh lib audition <slug> <track> [--keep] / --end       # place + press play on a library clip
```

Source clips can come from either view (`track:0/slot:2` or `track:0/arr:1`).
For arrangement-centric users, prefer `--arrange`: they play through the
timeline and hear each variation in sequence. Put the variations at
`--at-bar` past the song's end (or on a spare `--dest` track) so real
material is not overwritten.

## Variations (`awh vary`): the anti-"tweak forever" loop

`vary` applies a transform pipeline N times with different seeds. It
reworks the user's existing notes deterministically (same seed, same
result). Use it for the transform authorship mode; for co-writing, compose
notation yourself.

Pipeline spec: space-separated steps, `name:key=value,key=value`:

```
awh vary track:0/slot:1 -n 8 --seed 42 \
  --ops "transpose-scale:degrees=2 syncopate:probability=0.5 humanize"
```

Transform vocabulary (see `awh transforms` for params):
- pitch: `transpose`, `transpose-scale` (needs the Set scale or
  `--scale "C minor"`), `octave`, `invert`
- time: `quantize`, `swing`, `syncopate`, `rotate`, `stretch`, `retrograde`
- texture: `thin`, `densify`, `legato`, `staccato`, `fill`,
  `velocity-shape`, `humanize`

Flow: vary, tell the user which slots to audition, they pick favourites,
then `awh sweep` the rest. Sweep deletes by name prefix, so confirm the
prefix with the user before sweeping anything they might have renamed.
Vary needs enough empty slots; if it says there aren't, create scenes via
`awh call scene.create`.

## Audio-to-MIDI (`awh clip from-audio`): melodic transcription

```sh
awh clip from-audio <audioFile> <target> [--bpm N] [--quantize 1/4|1/8|1/16|1/32|off]
    [--onset-thresh N] [--frame-thresh N] [--min-len ms] [--min-freq Hz] [--max-freq Hz]
    [--name <name>] [--dry-run]
    # target = track path (auto-picks an empty session slot) or an explicit
    # session slot (track:0/slot:2)
```

- Transcribes melodic audio (a vocal take, hummed idea, synth/bass
  recording) into a MIDI clip via Basic Pitch (polyphonic pitch estimate).
  Report note count, pitch range, duration and the params used. The result
  is a starting point to audition and correct, not ground truth.
- Not for drums. For drum-hit timing use `awh drums detect-onsets`, which
  finds onset positions, not pitches.
- `--bpm` converts seconds to beats. If omitted it reads the Set's tempo,
  so you rarely need it. `--quantize` defaults to `off` (raw performance
  timing); turn it on when the user wants a grid-snapped result instead of
  the human feel.
- Zero notes detected (silence, quiet recording, wrong thresholds) is a
  normal outcome: it says so and creates nothing. Don't retry blindly; ask
  the user whether the file and thresholds are right.
- An explicit slot target that holds a clip is overwritten in place (same
  convention as `awh lib place`). If the transcription is longer than the
  existing clip it is clamped to that length (the gateway can't resize a
  clip), and the output says so.
- Always end by telling the user this is an estimate to audition, fixing
  wrong notes and octaves before treating it as done.

## Sections (`awh sections`): motif to arrangement skeleton

Build a full arrangement from source loops via an editable YAML plan:

```sh
awh sections plan --form house --role drums=track:0/slot:0 --role bass=track:2/slot:0 -o plan.yaml
# edit plan.yaml (bars, per-section ops, add/remove layers), then:
awh sections apply plan.yaml --seed 42 [--at-bar N] [--clear] [--dry-run]
```

- Forms: `house` (intro/build/drop/breakdown/build/drop/outro, 128 bars),
  `trap` (intro/verse/hook x2/outro, 80 bars). The plan is a starting
  point: edit bars and ops per section. Each layer derives from its source
  clip via a transform pipeline (verbatim tiling only when ops are omitted).
- apply refuses to write over existing arrangement material. Offer the user
  `--clear` (clears the span first) or `--at-bar` past the song's end. When
  the Set has real material, always `--dry-run` first and show the plan.
- Deterministic: same plan + seed gives an identical skeleton. Sections are
  named `<section>-<role>` on the timeline.
- Flow: plan, user reviews/edits the YAML (or asks you to), dry-run, apply,
  user auditions, then iterate on the YAML rather than the clips.

## Drums (`awh drums`): pad-aware patterns

```sh
awh drums gen <trackPath> --style house|techno|trap [--bars 4] [--density 0..1]
    [--seed N] [--slot s | --at-bar N]     # CO-WRITE: new pattern from grammar
awh drums fill <clipPath> [--style s]      # TRANSFORM: fill into the last bar
awh drums humanize <clipPath> [--timing 0.02] [--velocity 8]   # role-aware groove
awh drums vary <clipPath> [-n 4] [--amount 0..1]   # role-aware variations
awh drums mine <dir...> [--bpm N | --no-bpm-from-name] [--grid 16] [--save name]
    # research: band-split rhythm-stat mining from a folder of drum loops;
    # reports numbers to compare against the built-in specs, never edits them
```

- `gen` maps the track's drum-rack pads to roles (kick/snare/clap/hats/...)
  by pad name, with GM notes as fallback. It warns when no rack was found;
  check the track has a drum rack first via `awh status`.
- Grooves are cell-based. The kick figure is a seeded pick from curated
  common variations, held for the whole loop. Only velocities, ghosts and
  rolls change per bar, and every 4th bar is a turnaround with a fill
  gesture. Trap cells are nameable (`--variant hold|double-tap|late-lean|
  rolling|sparse|syncopated`), so "try the other common kick feel" means
  re-running with a different variant, not a different seed. gen prints
  which cell it chose.
- Use `drums vary` (not plain `vary`) for drum clips: it keeps kick anchors
  and backbeats while re-rolling hats and ghosts. `fill` and `humanize`
  edit in place; one undo reverts. Re-read to show the user what changed.
- Map requests to flags: "busier" is higher `--density`, "darker/minimal"
  is techno at lower density, "half-time/trap" is trap.
- `mine` measures real drum loops (a folder of audio files, BPM from the
  filename by default). It runs band-split onset detection
  (<120Hz/120Hz-2kHz/>2kHz, a kick/snare-clap/hat proxy, not source
  separation) folded onto a 16th grid, giving per-position hit-probability
  tables, density, and a swing estimate. It only reports. It never edits
  `packages/core/src/drums/grammars.ts` or `styleSpec.ts`; those built-in
  specs are hand-authored and locked. `--save <name>` writes a measurement
  record into `library/measurements/` (same convention as
  `mix report --save`; `awh mix records` lists and shows both kinds). Zero
  audio files in the directory is a normal result (exit 0, states it,
  writes nothing). See `knowledge/rhythm/waivops-drum-stats-pilot.md` for a
  worked example (pilot numbers vs. the built-in `HOUSE_STYLE_SPEC`/
  `TECHNO_STYLE_SPEC`/`TRAP_STYLE_SPEC` assumptions), and quote its
  pilot-sample-size caveat whenever you cite it.

## Phrase engine (`awh drop`): call-and-response drop writing

```sh
awh drop respond <callClip> <target> [--recipe r] [--seed N] [-n count] [--key k]
    [--style s] [--dry-run]
    # Core feature: answer an existing call clip. <target> = a track path;
    # candidates land in consecutive empty session slots, named
    # "resp <recipe> s<seed>". Default: one candidate per recipe.
awh drop phrase <target> [responseTarget] [--bars 8|16] [--style s] [--seed N]
    [--variant v] [--key k] [--at-bar N] [--dry-run]
    # CO-WRITE: cold-start an 8/16-bar call/response skeleton from a spec.
    # Two targets = paired call/response clips (equal length, each voice
    # silent during the other's bars). One target = single clip,
    # register-split (both voices in the same clip).
```

- Two contrasting voices trade phrases: a bright/high call and a low
  growl/stab response, never a stacked, unrelated riff. The response always
  enters after a rest (the "question mark"), never on top of the call, and
  resolves to a stable low-register pitch (tonic/fifth by default) as the
  "answer" gesture. This is general call-and-response craft
  (`knowledge/arrangement/call-response-drop-grammar`,
  `call-response-rest-placement`), not a specific artist's technique unless
  a style entry says otherwise.
- `respond` is the everyday tool. Point it at a call clip the owner wrote
  (or transcribed via `awh clip from-audio`) and it proposes several named,
  reproducible candidate responses to audition. Never present one as final.
  A call clip with zero notes is a normal result (nothing to respond to
  yet): it says so and writes nothing, like `clip from-audio`'s zero-notes
  case.
- `phrase` starts from nothing. It generates both voices from a spec's
  weighted call cells, applies the spec's evolution plan (state the pair
  verbatim, then vary the call only while the response anchors; see
  `knowledge/arrangement/drop-phrase-evolution`), and adds a turnaround
  reset cue at each phrase boundary. `--variant` pins a named call cell
  (`awh kb show <phrase-style slug>` or the built-in's `callCells` names),
  like `drums gen --variant`.
- A target that already holds a clip is filled in place (notes clamped to
  its length), the same occupied-target convention as `awh lib place`. It is
  never skipped or duplicated.
- `--style`: the built-in `bass-music-cr`, or a knowledge entry with slug
  `phrase-style-<name>` and an ```awh-phrase-spec``` block. Same data-driven
  convention as drum styles: adding a style means writing knowledge, not
  code. Prints the entry's tier when used; never present a `draft` style's
  flavor as fact about a real artist.
- Always end by reminding the owner that candidates and skeletons are
  starting points to audition, not a finished part.

## Arp & rhythm engine (`awh arp`): MIDI arpeggiator that writes notes

```sh
awh arp <chordClip> <target> [--style s] [--seed N] [--variant v]
    [--rate 1/16] [--gate 0.8] [--bars N] [--name n] [--at-bar N] [--dry-run]
    # chord-clip source: reads simultaneous notes from an existing clip
    # (e.g. one `awh chords` wrote) and arpeggiates each chord over its span.
awh arp --prog "i-VI-III-VII" --key "A minor" <target> [--voicing close|spread]
    [--center 60] [same style/seed/variant/rate/gate/bars/dry-run options]
    # --prog source: runs the harmony engine inline, then arpeggiates the
    # voiced result. <target> is the only positional in this form.
```

- This is the committing tool: it writes real MIDI notes, so `awh vary`,
  the library, phrases and notation can all work on the result. The stock
  Live Arpeggiator stays the jamming tool for auditioning ideas in real
  time; it produces no notes a downstream tool can see, by design. When the
  owner says "I found a good arp pattern on the device, commit it",
  reproduce the feel with `awh arp` (style/rate/gate/contour). Don't try to
  read the device's state.
- Two chord sources: an existing chord clip (pass its path as the first
  argument), or `--prog "<roman numerals>"`, which runs
  `parseProgression`/`voiceProgression` inline with the same progression
  grammar as `awh chords` (see that section for the roman-numeral rules).
  With `--prog`, `<target>` is the only positional; don't also pass a clip
  path.
- A clip with only single notes (no simultaneities) is a normal result: it
  says "this looks like a melody" and writes nothing. Don't retry with a
  different style; point it at an actual chord clip (`awh chords`, or a
  clip with stacked notes).
- `contour` (up/down/updown/downup/converge/diverge/walk/as-voiced) orders
  pitches drawn from the chord voicing extended upward by `octaves`
  (`as-voiced` ignores the octave extension and cycles the voicing as
  given). `patternLength` sets how many steps run before
  accents/rests/ratchets repeat. When it doesn't match the bar length (e.g.
  12 at 1/16 in 4/4) that is deliberate polymeter: it keeps riding through
  chord changes without resetting. `euclid: {k, n}` thins the step grid to
  `k` onsets per `n` steps (k=n means no thinning). `ratchets` subdivide a
  step into fast repeats without overlapping.
- `--style`: the built-ins `basic-up` (plain ascending, full mask) and
  `melodic-techno-16ths` (updown, 2 octaves, off-accent 16ths), or a
  knowledge entry with slug `arp-style-<name>` and an ```awh-arp-spec```
  block (same data-driven convention as drum/phrase styles). Prints the
  entry's tier when used. `--variant` forces the euclid mask's rotation
  (listable, like a drum kick-cell variant): `rotate-0`, `rotate-1`, ... up
  to `euclid.n - 1`.
- `--rate`/`--gate` override the resolved style's step rate and gate. Use
  them before writing a new knowledge style for a one-off tempo/density
  tweak. `--dry-run` shows the bar|beat notation preview before committing.
- The `ratchet` transform (in `awh transforms`, usable with `awh vary`) is
  the note-level sibling of the engine's ratchets field. It can subdivide
  selected notes in any clip, not only arp output.

## Break engine (`awh breaks`): chop a real break, then re-sequence it

```sh
awh breaks chop <break.wav> [--save [name]] [--export <dir>] [--bpm N]
    # onset-slice a break sample: per-slice role guess (kick/snare/hat/ghost
    # + confidence), BPM (with confidence), and measured 16th-grid offset
    # (a sloppy break reports sloppy; it is never snapped to 0).
    # --export cuts <nn>-<role>.wav + a README mapping table. Fastest path:
    # drag the slices into an empty Drum Rack.
awh breaks pattern <target> --map <name> [--style jungle-classic|halftime]
    [--seed N] [--variant N] [--bars N] [--mode drum-rack|live-slices]
    [--at-bar N] [--dry-run]
    # BreakSpec-driven re-sequencing: a verbatim "statement" (bar 1 by
    # default), then a "turnaround" that chops/substitutes/displaces
    # snares/ghost-shuffles per the style. jungle-classic = state, then chop
    # the tail; halftime = sparse placement of the same slices.
awh breaks fill <target> --map <name> [--beats 2] [--seed N] [--count N]
    [--at-bar N] [--dry-run]
    # Turnaround-fill grammar: snare-rush (ratchet), stutter/retrigger,
    # triplet, and tail-rearrange cells, at most 2 device types per
    # candidate (restraint rule). N seeded candidates go into consecutive
    # session slots (or --at-bar arrangement positions), named
    # "fill <devices> s<seed>" for quick A/B audition.
awh breaks place <break-pattern-name> <target> [--at-bar N]
    # resolve a break-pattern-<name> knowledge entry's canonical amen/
    # think/funky-drummer notation (GM drum mapping) and write it. Kit-aware
    # via mapPadRoles when the target has a drum rack (same convention as
    # `drums gen`); GM fallback with a plain note otherwise.
```

- The two halves don't mix. Half 1 (`breaks place`) plays a canonical break
  pattern carried in knowledge (a sourced transcription) as MIDI on any kit,
  with no audio slicing. Half 2 (`chop`/`pattern`/`fill`) re-sequences a
  real break sample's own slices via onset analysis; the notes it writes
  only make sense against that exact chopped file. "Give me an amen
  pattern" is Half 1; "chop my amen WAV and vary it" is Half 2. Ask which
  the owner means if it's ambiguous.
- **Simpler constraint**: the SDK cannot configure Simpler's slice points
  (not addressable), so `pattern`/`fill` never touch Simpler. `--mode
  drum-rack` (default) assumes the `--export`ed slices are dropped into a
  Drum Rack's pads in order (00, 01, 02, ...), capped at 16 pads. A chop map
  with more slices is refused rather than wrapping two slices onto one pad.
  `--mode live-slices` targets Live's Slice-to-New-MIDI-Track chromatic
  convention instead (no 16-slice cap) but always prints a warning naming
  the chop map's slice count. Live's transient detector may find a
  different count at the owner's sensitivity, and a mismatch means these
  notes trigger the wrong slice. Relay that warning verbatim; don't
  reassure the owner past it.
- `chop --save <name>` writes a chop-map record (`library/measurements/`,
  listable via `mix records`, kind "chopmap") that `pattern --map <name>`/
  `fill --map <name>` resolve by name. Don't hand-parse the JSON.
- Role guesses (kick/snare/hat/ghost) are a band-energy proxy with a
  confidence. Always relay both; never state a role as fact. If a chop
  map's confidence is uniformly low, `pattern` warns and restricts itself to
  same-slice tricks (stutter/retrigger only, never a role swap). If the
  owner asks for more variation, explain why and point them at a cleaner
  chop or a manual `--map` edit.
- `--style`: built-ins `jungle-classic`/`halftime`, or a knowledge entry
  with slug `break-style-<name>` and an ```awh-break-spec``` block (same
  data-driven convention as drum/phrase/arp styles). `fill` has no
  `--style`: its grammar is built in, and the restraint rule is a spec
  field that is not yet authorable via knowledge.
- `--dry-run` on `pattern` and `fill` shows the bar|beat notation preview
  (every candidate, for `fill`) before committing. Default to it when the
  owner hasn't heard the result yet.

## 808 bass patterns (`awh bass`): melodic-rhythmic 808 basslines

```sh
awh bass 808 <target> --key "A minor" [--style s] [--seed N] [--variant v]
    [--bars N] [--slides on|off] [--name n] [--at-bar N] [--dry-run]
```

- Melodic-rhythmic 808 bassline patterns (long holds, syncopated pickups,
  slides, triplet flows), not TR-808 drum patterns (`awh drums --style trap`
  covers those). `--key` (or the Set's active scale, same `resolveKey`
  convention as `awh arp`/`awh chords`) sets the root. Every step's pitch is
  `root + a degree`, where a degree is a semitone offset (e.g.
  octave/fifth/minor-seventh), not a scale-degree walk. Only the root is
  octave-fitted into the style's register; degrees are not re-folded, so an
  octave answer can land above the register on purpose.
- **The glide contract**: `slide: true` steps are emitted legato, extended
  to overlap the next sounding note's start by a small, exact overlap
  (crossing bar boundaries when the next note is in the next bar; a slide
  with no following note keeps its written length). Pair the output with a
  mono synth with glide on so the slides audibly glide instead of playing
  back-to-back. `awh op apply glide-bass <devicePath>` is the ready-made
  recipe. `--slides off` trims every step to plain gates (zero overlaps).
- `--style`: built-ins `trap-long` (sparse, long anchors, one slide pickup
  per 1-2 bars), `trap-syncopated` (off-beat doubles, more slides, a
  turnaround-bar resolution), `triplet-flow` (8th-triplet run cells,
  denser, the modern flow idiom), or a knowledge entry with slug
  `808-style-<name>` and an ```awh-808-spec``` block (same data-driven
  convention as drum/phrase/arp/break styles). Prints the entry's tier when
  used. `--variant` forces a named cell for every bar (listable). A style's
  turnaround bars (every Nth bar, when the style defines turnaround cells)
  ignore `--variant` and draw their own turnaround cell.
- `--dry-run` shows the bar|beat notation preview (including slide
  overlaps) before committing. Default to it when the owner hasn't heard
  the result yet.

## Mix analysis (`awh mix`): measurements, never vibes

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

- **Quote the numbers; never invent one.** Each report finding carries
  value/threshold/suggestion. Relay them, prioritize alerts, and explain in
  plain producer language. If a measurement isn't in the output, say so.
- Typical loop: capture (or ask the user for an export), report, discuss,
  user tweaks (or asks you to, e.g. EQ Eight via device ops), capture again,
  then `awh mix ab` old vs new. AB is loudness-matched; tell the user this
  removes the louder-sounds-better illusion.
- Always pass `--bpm` (from `awh status`) so sidechain pump gets verified.
- Targets are the user's own measured references (`awh mix target`),
  stored in `library/targets/`. Offer to build one from their reference
  tracks before comparing.
- capture requires the AWH Capture Tap M4L device (m4l/README.md) on the
  master. If it fails, ask the user to export the span and run report on
  that file.
- Masking toolkit ("does my sub fight my bassline", "is this patch's
  fundamental where the note name says", "compare these layers"):
  - `mix pitch` tracks f0 by periodicity (pyin), never the loudest FFT bin.
    It also reports `harmonic_dominance` when a partial outgrows the
    fundamental (e.g. a growl mid-note); relay both, not only f0.
    `--per-note` breaks a melody into onset-bounded notes instead of one
    average.
  - `mix bands` gives calibrated dBFS per named zone (sub/low/scoop
    zone/low-mid/mid by default, or `--bands "lo-hi,..."`). 0 dBFS is a
    full-scale sine, so numbers compare across sessions.
  - `mix layers` automates solo, capture, unsolo across a track list and
    runs `mix bands` on the results. It restores each track's prior solo
    state even if a capture fails partway, so it's safe mid-session.
- Mix advisor ("what should I fix", "give me a prioritized plan", "how do I
  get this ready for release"): `mix advise` runs the same measurement
  pipeline as `mix report` through a deterministic rule engine
  (`analysis/awh_analysis/advise.py`) and returns a ranked plan rather than
  a flat findings list. Ranking follows a fixed dependency ladder:
  integrity (clipping/headroom), phase (low-band correlation), masking
  (needs `--layers`), tonal balance (needs `--target`), dynamics (PSR),
  loudness (LUFS vs `--preset`). An earlier stage's problems make later
  measurements unreliable (a phasey low end makes tonal deltas meaningless
  until it's fixed).
  - **The contract**: present the plan top-down by rank, quote each item's
    evidence numbers verbatim (never rounded or restated), run an item's
    `verify` command when the owner asks you to confirm a fix landed, and
    never add a move the engine didn't emit (no folklore EQ advice on top).
  - A `blockedBy` list names the ranks of earlier-stage items still open;
    tell the owner to fix those first. "Re-measure after #1" comes from the
    engine, not your paraphrase.
  - Missing `--target`/`--layers` appears as its own ranked item (what
    running `mix target`/`mix layers --save` would unlock), not silence.
  - Zero actionable items is the healthy state. Say so plainly and don't
    invent problems; the engine still names the two metrics closest to
    tripping so the owner knows where the headroom is.
  - `--set` additively names real devices already on the master chain in
    actions (e.g. "your existing EQ Eight" instead of "add an EQ Eight").
    Advise works without the gateway. `--save [name]` writes an advice
    record (`mix records`); `--compare <name>` diffs a fresh run against a
    saved one into resolved/improved/unchanged/new per item, for the
    before/after loop once the owner acts on something.

## AWH Remote (`awh play` / `awh stop` / `awh jump` / `awh launch` / `awh stop-clips` / `awh lib audition`): transport + clip launch

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

- The SDK has no transport or clip-launch API (docs/sdk-feedback.md).
  Every command above is OSC to the AWH Remote M4L device (m4l/README.md),
  which supersedes the AWH Capture Tap on the same 9720/9721 ports
  (`mix capture`/`op verify`/`mix duck` work unchanged against it). The
  device must be loaded once by hand. If it isn't, the error says so
  ("requires the AWH Remote device..."). Don't retry blindly; point the
  user to m4l/README.md's Install section.
- `launch`/`jump`/`stop-clips` respect Live's launch quantization and print
  the device's echoed reply. A bad index (a track/slot/scene that doesn't
  exist) comes back as a clear error from the device, not a hang.
- `lib audition` is the "make me hear this now" primitive: it places (using
  `lib place`'s empty-slot logic) and fires in one command. By default the
  clip is ephemeral: auditioning the next slug (or `awh lib audition --end`)
  sweeps this one first by its exact clip name (never a prefix sweep, so a
  similarly named clip the owner kept is untouched). Pass `--keep` when the
  owner wants to keep what they're hearing; it then behaves like a normal
  `lib place` and won't be auto-swept.
- No empty session slots on the target track throws a clear error (same
  convention as `lib place`/`drop respond`). Tell the user to free one up or
  pick a different track; don't guess a slot to overwrite.

## Operator assistant (`awh op`): recipes + audio-sample sound matching

```sh
awh op recipes                                  # list operator-recipe-* knowledge entries
awh op apply <recipe> <devicePath> [--dry-run] [--audition]
                                                 # write a recipe's params to a live Operator
awh op match <sample.wav> [--apply <devicePath>]
                                                 # analyze a sample -> tiered Operator patch proposal
awh op verify <ref.wav> <devicePath>            # closed-loop: audition + capture + compare
```

- `apply` validates every param name against `device.get` before writing.
  An unknown or mistyped name (e.g. from a hand-edited recipe) fails loudly
  and writes nothing, never a partial patch. `--dry-run` prints the moves;
  `--audition` writes the recipe's `playNotes` to an empty session slot on
  the device's track for the owner to press play.
- `match` is tiered. Tier 3 ("outside Operator's reachable set") is a normal
  result, not an error: say so, quote the measured property that blocks it
  (harmonicity/pitch drift/inharmonic partials), and don't push the owner
  toward a patch that can't get there. Tiers 1-2 always include a
  `drawThesePartials` list (16 amplitudes). Operator's user-drawable
  harmonics are believed to be UI-only (unverified, not among the 195
  automatable params), so hand the list to the owner to draw in 30s
  whenever the stock-wave residual is high. `--apply <devicePath>` pushes
  only the proposal's `addressable` subset (same validate-first flow as
  `apply`). Those raw values are a labeled heuristic, not a calibrated
  curve; say so.
- `verify` is the closed loop (owner machine only). It needs the AWH Capture
  Tap M4L device (m4l/README.md) on the device's track/bus. It does not
  auto-iterate: report the score, let the owner tweak, then re-verify.
- Raw `device.param` values have no verified display-unit curve beyond a
  single Volume point (`knowledge/setup/device-parameter-surface.md`,
  `compressor-raw-display-mapping.md`). Never claim a raw number means a
  specific ms/Hz/dB unless a knowledge entry says so.

## References (`awh ref`): deconstruct, mark, correct

```sh
awh ref analyze <audio> [--save name]     # BPM/grid + bar energy arc +
                                          # rule-based intro/build/drop/breakdown
awh ref sections apply <analysis.json|audio>  # draft map -> named empty clips
                                          # on a "Sections" track
awh ref sections read <trackPath> [-o f]  # owner's corrections -> JSON
```

- The map is a draft. Tell the owner the confidence values and that they
  should drag/rename the marker clips to correct it, then `read` the
  corrections back. Never treat low-confidence sections as fact.
- Half/double-time ambiguity (common in trap) is surfaced in
  `bpm_runner_up` and notes. Mention it when present; don't silently pick.
- `--save` stores the reference in the knowledge surface
  (library/references/); its embedded measurement profile feeds
  `mix target` comparisons.
- apply refuses a non-empty Sections track without `--clear` (usual rule).
- Building an arrangement against a reference: analyze, apply, owner
  corrects, read, then use the corrected bars to shape an `awh sections`
  plan (bars per section come from the reference map).

## Scaffolding + chords (`awh new` / `awh chords`): start from the owner's template

```sh
awh new project <name> [--template dir]  # copy the owner's template project
                                         # (disk only; they open it in Live)
awh new populate [scaffold.yaml]         # then: tempo, named tracks, starter
                                         # clips from the library, a chord bed
awh chords <target> --progression "i-VI-III-VII" [--key "A minor"]
    [--bars 8] [--voicing close|spread] [--rhythm whole|half|quarters|offbeat-stabs]
    [--bass] [--at-bar N]                # CO-WRITE: in-scale chord clip
```

- Progressions are roman numerals resolved against the Set's scale (or
  `--key`). Qualities come from stacking the scale, so everything stays
  in key. Supported: `7`, `sus2/4`, `dim/aug`, `b/#` borrowing, and
  explicit-quality `maj`/`min` suffixes. The output lists the voiced
  pitches; read them back to the owner.
- Case is cosmetic: `V` and `v` produce identical pitches, and quality is
  always scale-derived. So the common minor-key cadence `i-iv-V-i`
  (expecting a borrowed major dominant) silently gives the natural-minor
  diatonic (minor) v. For that idiom, use `--key "<root> harmonic-minor"`,
  which makes V major, or write `i-iv-Vmaj-i`.
- Voice leading is on by default (minimal movement between chords);
  `spread` widens with the root low. "Chords too muddy": raise `--center`.
  "Too thin": `--bass` adds the root an octave down.
- The scaffold (library/templates/scaffold.yaml) is the owner's own recipe.
  Starters reference library slugs, so `new populate` places their
  material, not invented content.

## Knowledge base (`awh kb` / `awh distill`): read before you reason

`knowledge/<topic>/<slug>.md`: tiered (verified/sourced/draft),
executable-first entries. Topics are open-ended (new domain = new
directory). Saved mix reports (`library/measurements/`) are part of the
same surface.

```sh
awh kb list [--topic t] [--tag t] [--tier t]   # browse entries
awh kb topics / awh kb show <slug> / awh kb index
awh kb new <topic> <slug>            # scaffold a well-formed draft entry
awh distill [-o file]                # dump the open project for curation
```

- Retrieval first: before genre/technique/setup tasks, grep
  `knowledge/INDEX.md` (or `awh kb list --topic <t>`). Read setup entries
  (e.g. `sidechain-template`) before designing anything touching that part
  of the studio. Cite `slug [tier]` when applying an entry; never present a
  `draft` as fact.
- Capture: when the owner says "remember this" or "save what we learned",
  run `awh kb new` and fill in Executable + rule. For end-of-session
  distillation, `awh distill`, then curate notable clips into `awh save`
  and rules into entries. Entries you author are tier `draft` (or `sourced`
  with citations), never `verified`; only the owner promotes.
- Data-driven drum styles: a `drum-style-<name>` entry with an
  ```awh-style-spec``` block makes `awh drums gen --style <name>` work for
  styles beyond the built-ins. gen prints the entry's tier when it uses one.

## Library (`awh save` / `awh lib`): the owner's clip memory

Git-versioned clips under `library/clips/<category>/<slug>.md` (markdown +
frontmatter + executable notation). Before composing drums/bass/hats from
scratch, check `awh lib list` (or grep `library/clips/INDEX.md`): placing
the owner's proven material beats reinventing it. Cite slug + tier when you
use an entry ("placing rolling-garage-hats-1 [verified]").

```sh
awh save <clipPath> --category hats [--as slug] [--tags garage,shuffle]
    [--tier draft|sourced|verified] [--project name]   # capture from the Set
awh lib list [--category c] [--tag t]     # browse
awh lib show <slug>                       # full entry incl. notation + notes
awh lib place <slug> <target> [--at-bar N]   # write it into the Set;
    # fills an existing clip at the target (tiled/truncated to its length)
    # rather than erroring or duplicating; creates fresh only if empty
awh lib index                             # regenerate INDEX.md
```

- Save liberally when the owner likes something ("save that hat loop").
  Default tier is `draft`; the owner promotes to `verified` after real use.
- Right-click captures: the owner can run 'AWH: Save clip to library' on
  any MIDI clip in Live. Run `awh lib import` at session start (and when
  they mention having captured things) to drain those into clips/inbox/
  drafts, then help name, tag and re-categorize them.
- Slugs are unique across the whole library; `--overwrite` updates an entry.
- Live-browser mirror: `awh lib export-alc` renders every clip to a
  generated Pack of .alc Live Clips (drag into Places once; re-exports
  re-index automatically). It requires a one-time golden template. If it
  errors about the template, walk the owner through: one MIDI clip, no
  devices on the track, drag to User Library, then
  `awh lib capture-template <file>.alc`. Reverse: `awh lib import-alc`
  pulls a .alc into the library.

Raw ops cover everything else (see `awh ops` for the full list + args):
tracks (`track.create/update/delete/duplicate/clear-range/mixer`), scenes,
devices (`device.insert/get/param/delete`, stock Live devices only), drum
racks (`drum.pad-note`), Simpler (`simpler.sample`), `set.tempo`, audio
clips (`clip.create-audio`).

## Sample library (`awh samples`): index, search, similarity

A machine-local index of the owner's own sample folders (not their in-Live
library clips; that's `awh lib`), so "find me an amen break" is answered
from material they already own.

```sh
awh samples index <dir...> [--rescan]   # walk folders (wav/aiff/flac/mp3),
    # extract features, write ~/.awh/samples-index.json (override with
    # AWH_SAMPLES_INDEX). Incremental by path+size+mtime; deleted files
    # under the given folders are pruned; --rescan forces a full re-scan.
awh samples embed [--model music|general]  # compute missing/stale CLAP
    # embeddings for the whole index (batch, incremental: already-embedded
    # files are skipped; a model switch re-embeds everything, reporting
    # counts). Zero un-embedded files is a normal "up to date" state.
    # Must run before --semantic works.
awh samples pitch-tag                    # pitch-tag eligible kick/sub/808
    # one-shots (periodicity-tracked f0 via mix pitch, never a naive
    # FFT-peak pick); enables `search --near-note`. Incremental, opt-in;
    # only one-shots whose energy is low-band-dominated are eligible
    # (hats/vocals/melodic loops never are, by design).
awh samples search <query...> [--any] [--type loop|oneshot]
    [--min-dur s] [--max-dur s] [--bpm N --bpm-tol N] [--band low|mid|high]
    [--near-note <note> --cents N]
    # token match over normalized path tokens (all terms by default),
    # plus trait filters; ranked table, --json for machine use.
    # --near-note (Ableton convention, e.g. "F1"): filter to pitch-tagged
    # kick/sub one-shots within --cents (default 50, a quarter-tone) of
    # that note; needs `pitch-tag` first.
awh samples search --semantic "<phrase>" [--type ...] [--min-dur ...]
    [--bpm ...] [--band ...]                # embeds the phrase (CLAP) and
    # ranks by cosine similarity to audio content, not filename tokens.
    # Composes with the same trait filters as token search (filter first,
    # rank semantically), but not with plain query terms in the same call.
    # Files without an embedding are excluded and counted in a footer
    # ("N of M files not embedded — run awh samples embed"). If the index
    # has zero embeddings, this is a loud error naming `awh samples embed`;
    # it never falls back to token search.
awh samples similar <file> [--count N] [--semantic | --traits]
    # ranks indexed samples against a reference file (which need not be
    # indexed; it is embedded/scanned on the fly). Semantic (CLAP) is the
    # default once the index has any embeddings; --traits forces the
    # MFCC/spectral/band-split vector; --semantic forces CLAP even when the
    # default would pick traits (e.g. no embeddings yet, in which case it
    # errors rather than using traits).
awh samples stats                        # index size, roots, histograms
```

- **Which search tool first.** For a content-language query describing
  what the sound is or does ("dusty breakbeat", "dark growl bass",
  "something like a four-on-the-floor techno drum loop"), try
  `search --semantic` first (after confirming the index has embeddings; run
  `awh samples embed` if not). For a name-like query (the owner names a
  pack, filename fragment, or exact trait: "the Vengeance snare", "amen
  break", "anything at 128 BPM"), token `search` comes first; it's exact
  and free, and semantic search adds nothing when the owner knows the name.
  Either way, search first and never invent a path. If the search narrows
  to one clear winner, use it and say why ("used `amen-break-170.wav`, the
  only hit for 'amen break'; 170 BPM matches the Set's tempo", or for
  semantic: "used `<path>`, top score 0.34 for 'dusty breakbeat', closest
  in the library"). If several are plausible, present the top few with
  their traits (duration/type/BPM/band) and their score if semantic, and
  ask the owner which one. With AWH Remote's audition, candidates can be
  heard in Live before committing.
- Scores are shown, never overclaimed. A semantic score means "closest in
  the library": a relative ranking, not confidence that it's a match or
  the right sound. Relay it as a number for the owner to judge, as with
  `bpm_confidence` below.
- `index` must run before `search`/`similar` do anything useful. If asked
  to find a sample and the index is empty (or plainly stale, e.g. the owner
  mentions a folder never indexed), run `awh samples index <folder>` first
  rather than reporting "not found". `embed` is a separate step on top of
  `index`; semantic search and similarity do nothing until it has run once.
- Zero hits is a normal result. Relay the printed relaxation suggestions
  (fewer terms, `--any`, dropped filters) for token search, or the
  not-embedded footer for semantic search, rather than silently retrying
  with a guessed query.
- Token search matches path/folder text; semantic search matches audio
  content (CLAP embeddings); `similar --traits` matches timbral statistics
  (MFCCs + spectral shape + band split). None of these is musical key
  matching. `search --near-note` is real key matching, scoped narrowly to
  pitch-tagged kick/sub/808 one-shots (`pitch-tag` first), never loops or
  melodic material. Say so if the owner expects a lead/pad/vocal to be
  key-filterable; that is out of scope.
- "Find a kick that matches my sub": run (or confirm already run)
  `awh samples pitch-tag`, then `search --near-note <key root>`. The note
  is the Set's active key/scale root or whatever note the owner names, in
  Ableton convention. A hit with no pitch shown was never pitch-tagged or
  came back unvoiced (a broadband kick); don't claim it matches a key.
- BPM only appears when the loop heuristic fires (duration + onset count).
  A one-shot or ambiguous file legitimately has no BPM; don't invent one.
  Relay `bpm_confidence` rather than presenting an estimate as certain.
- The index (and its embeddings) is machine-local and never committed
  (absolute paths, meaningless off-machine). Don't suggest saving it to the
  repo or `awh lib`. To keep a sample for reuse across projects, use
  `awh save`/`awh lib place` after the owner has picked it.

## Endless player (`awh endless`): seeded, ever-different arrangements

A standalone deliverable, separate from everything above. It builds a
static, offline HTML+JS player from the owner's own produced/mixed audio
stems (not notes written into Live): an endless, never-repeating
performance of one song, Bronze-style (docs/design/endless-player.md).
There is no in-browser composition. The "endless" part is authoring-time
variant pools (optionally from `awh drums`/`awh vary` renders) plus a
seeded arrangement/mix grammar that picks which pre-produced loop plays
next.

```sh
awh endless plan --sections "intro:8,build:8,drop:16,break:8" --bpm 140 -o endless.yaml
    # or: awh endless plan --from-ref <name> -o endless.yaml   (bars/bpm from
    # a saved reference's corrected section map; see `awh ref`)
    # edit endless.yaml: fill in each section's pools with your bounced
    # audio file paths, add/rename layers, adjust transitions/rules. Refuses
    # to overwrite an existing file without --force
awh endless build endless.yaml -o dist/my-song [--single-file]
    # validates first and reports every problem before writing anything:
    # every pool file exists, every file's duration is bar-exact (+-25ms)
    # to bars*4*60/bpm, every section reachable, no empty pools
awh endless demo -o dist/demo
    # zero-asset sanity check: synthesizes a tiny kick/hat+bass+pads song
    # and builds it, so the engine can be heard with none of the owner's
    # material yet
```

- Loops must be bar-exact. If a bounced stem has a reverb/delay tail,
  render it with the tail overlapped back onto the loop, not trimmed off.
  `awh endless build` checks duration, not tail cleanliness, so a clipped
  tail passes validation and still sounds wrong. Say this when helping
  bounce stems.
- `build` writes `index.html` + `player.js` (zero deps) + the audio pools +
  `endless-README.md` into the output dir. The README's serve instruction
  (`python3 -m http.server`) is required because browsers block `fetch()`
  on `file://`; don't tell the owner to double-click `index.html` for a
  multi-file build. `--single-file` inlines everything as `data:` URIs into
  one HTML (fine for demos/sharing; warns above 12 MB).
- This is not `awh sections`. `sections` writes an arrangement into the
  Live Set from source clips; `endless` builds a standalone web player from
  already-bounced audio, outside Live. "Build me a live arrangement
  skeleton" is `awh sections`; "build me an endless/infinite version of my
  song to share" is `awh endless`.
- Never hand-edit the emitted `player.js` to fix playback. It's a literal
  copy of `packages/cli/assets/endless/player.js`; report a bug instead of
  patching a build artifact.

## bar|beat notation

One note (or chord) per line: `bar|beat pitch(es) duration [vN] [pN] [m]`

```
sig 4/4              # optional header (default 4/4)
1|1   C3        1    v100   # bar 1 beat 1, middle C, 1 beat, velocity 100
1|2.5 Eb3       1/2         # fractional beats; velocity defaults to 100
2|1   C3+Eb3+G3 2    v90    # chord ("+" joins pitches)
2|4   D3        1/4  p60 m  # p = probability %, m = muted
```

- Positions and durations are in beats (quarter notes in 4/4), 1-based:
  `1|1` is the clip start; an eighth note is `1/2` or `0.5`.
- **Pitch names use Ableton's convention: middle C (MIDI 60) = C3.**
  Range C-2..G8. `#` and `b` accidentals.
- `#` starts a comment; blank lines are fine.
- Groove tips: velocity variation (`v90`/`v70` on off-beats) and `p` values
  make parts breathe. Keep drum hits short (1/4 beat) on drum-rack tracks
  (pads are listed with their MIDI notes under the track's drumPads).

## Typical flows

**Add a bassline to a track** (co-write):
1. `awh status --json`: find the MIDI track, tempo, scale.
2. Compose notation in the Set's key; write with
   `awh clip create track:2/slot:0 <<'EOF' ... EOF` or `--at-bar` for the
   arrangement.
3. Re-read to verify; hand back to the user to audition.

**Turn a recorded/hummed idea into a MIDI clip** ("transcribe this vocal
take", "turn my hummed idea into notes", "get the melody out of this audio
file"):
1. Get the audio file (owner-provided, or rendered/captured from the Set).
   Get the tempo from `awh status` unless the user gives `--bpm`.
2. `awh clip from-audio <audioFile> <target>`. Don't hand-transcribe pitches
   or reach for `clip create`; this runs the transcription model (Basic
   Pitch) and does the seconds-to-beats and clip-length math. Use
   `--dry-run` first if the user wants to see the note count and pitch
   range before anything is written.
3. Zero notes is a normal result (silence, quiet take, wrong thresholds): it
   says so and writes nothing. Don't retry blindly; ask about the file or
   loosen `--onset-thresh`/`--frame-thresh` if the user expects notes.
4. Tell the user this is an estimate (polyphonic pitch detection, not
   ground truth) to audition and fix wrong notes/octaves, not a finished
   transcript. For drum-hit timing instead of pitches, use
   `awh drums detect-onsets`.

**Vary an existing loop** (transform: "make me N variations", "more
syncopated", "denser", etc. on material already in the Set):
1. `awh status --json` (or `awh clip read`): confirm the source clip and the
   Set's active scale.
2. Pick a transform pipeline from `awh transforms` that matches the request
   (e.g. "more syncopated" maps to `syncopate:probability=...`
   [+ `humanize`]). Don't hand-compose new notation: `awh vary` reworks the
   source's own notes deterministically, which is faster and is what
   "variations of X" means.
3. `awh vary <sourcePath> -n N --ops "<pipeline>"` writes N seeded, named
   variations (`--arrange` instead of session slots for arrangement-centric
   users). Re-read one or two to sanity-check before handing back.
4. Tell the user which slots/positions to audition; `awh sweep` the rest
   once they've picked favourites.

**Build an arrangement/skeleton from loops** ("build me a house/trap
skeleton", "turn my drum and bass loops into an arrangement", "lay out the
song structure"):
1. `awh status --json`: identify the source loops (drums/bass/etc.) and the
   Set's active scale.
2. Don't hand-compose section by section with `clip create`/`clip write`;
   that is slower, opaque to the user, and skips the safety checks.
   `awh sections plan --form <house|trap> --role <name>=<sourcePath> ...`
   generates an editable YAML plan from a researched genre-form preset.
3. Show the user the YAML (or your edits to it) before writing anything.
   The plan is the review step.
4. `awh sections apply <plan> --dry-run`: confirm the clip list looks right.
5. `awh sections apply <plan> [--at-bar N] [--clear]` writes the skeleton.
   It refuses to overwrite existing arrangement material without `--clear`.
   Don't work around that by hand-placing clips; use `--at-bar` past the
   song's end, or ask the user before `--clear`ing real content.

**Map out a reference track / build a matching skeleton** ("map out this
reference and build me a matching skeleton", "structure my track like
<reference>", "what's the arrangement of this reference song"):
1. Get the reference audio (owner-provided file, or a track/clip already in
   the Set; render it with `awh render` if it's on an audio track).
2. `awh ref analyze <audio> [--save <name>]`: BPM/grid + a rule-based draft
   section map. This is not `awh sections` (which builds skeletons from the
   owner's own loops); `awh ref` deconstructs someone else's track first.
3. `awh ref sections apply <analysis.json|audio>`: named empty clips on a
   "Sections" track. Tell the owner the per-section confidence and that
   low-confidence/unlabeled stretches are expected; the rules decline to
   guess past their evidence rather than mislabel. Never present a
   low-confidence section as settled.
4. The owner corrects by dragging boundaries/renaming clips in Live. Then
   `awh ref sections read <trackPath> [--save <name>]` pulls the correction
   back. `--save` merges it into the saved reference record (otherwise
   `analyze`'s file only holds what was true at analyze time). Names are
   parsed leniently; don't "fix" a non-standard name the owner chose.
5. To build a matching skeleton: `awh sections plan --from-ref <file> --role
   <role>=<sourceClip> ...`, where `<file>` is the `-o` output of `ref
   sections read` (or a saved `library/references/*.json`). Bars come from
   the reference's corrected map and every layer is verbatim (no genre ops
   guessed, since an arbitrary reference has no known convention). Mutually
   exclusive with `--form`. Same review-before-apply flow as the preset
   path: show the YAML, `apply --dry-run`, then apply.

**Save/place a library clip** ("save that hat loop for later", "place my
garage hats", "use my saved bassline"):
1. Saving: `awh save <clipPath> --category <c> [--tags ...] [--tier ...]`.
   Don't hand-copy the notation; `save` captures the notes plus
   BPM/scale/source context.
2. Placing: `awh lib list` or `grep library/clips/INDEX.md` to find the
   slug, then `awh lib place <slug> <target>`. `<target>` is a session slot
   path, an arrangement clip path, or a track path with `--at-bar`. An empty
   target gets a new clip at the entry's saved length. A target that holds a
   clip (e.g. a pre-blocked empty placeholder) is filled instead, with the
   entry's notes tiled/truncated to the existing clip's length. Either way
   it's one command; don't read the notation and `clip write`/tile it
   yourself.
3. If the request doesn't say where ("place my garage hats"), don't guess
   silently. Pick an empty session slot (or an obviously matching
   placeholder clip) on a sensibly named track, or ask the owner.

**Find a sample from the owner's own folders** ("find me an amen break",
"got any deep house kicks in my packs", "find something dusty and
breakbeat-y", "find something like this sample", "what samples do I have
in this folder"):
1. If the folder has never been indexed (or the owner mentions one you
   haven't seen), run `awh samples index <folder...>` first. It's
   incremental (unchanged files are skipped), so re-indexing is cheap and
   safe whenever unsure.
2. Pick token or semantic search by query shape (see "Which search tool
   first" in the Sample library section). A content-language description
   ("dusty breakbeat", "dark growl bass"): `awh samples embed` (only if the
   index has no embeddings yet), then `awh samples search --semantic
   "<phrase>" [--type ...] [--bpm ...] [--band ...]`. A name-like query
   (pack name, filename fragment, exact trait like a BPM): `awh samples
   search <query terms...> [--type loop|oneshot] [--bpm N --bpm-tol N]
   [--band low|mid|high]`, a token search over path/folder names (pack
   folder names are often the best metadata a sample has). Zero hits is
   normal either way. Relay the printed relaxation suggestions (token: fewer
   terms, `--any`, dropped filters) or the not-embedded footer (semantic)
   instead of guessing a different query or switching modes unasked.
3. The contract: one clear winner (by tokens+filters, or a top semantic
   score well ahead of the rest), use it and tell the owner why ("used
   `amen-break-170.wav`, the only hit for 'amen break', and 170 matches the
   Set's tempo", or "used `<path>`, the clear top semantic score for 'dusty
   breakbeat'"). Several plausible candidates: present the top few with
   their traits (duration/type/BPM/dominant band) and score if semantic,
   and ask the owner which one. Never pick silently among equally good
   options, and never invent a path that didn't come from search/similar.
   Semantic scores are relative ranking ("closest in the library"), never a
   match or a confidence level.
4. "Something like this sample": `awh samples similar <refFile>
   [--count N]`. Semantic (CLAP) by default once the index has embeddings;
   timbral (MFCC/spectral/band features) otherwise or with `--traits`. The
   reference doesn't need to be indexed. Neither is musical key matching;
   say so if the owner seems to expect harmonic matching.
5. "Find a kick/808 that matches my sub", or any note-specific request for
   a low-end one-shot: run `awh samples pitch-tag` if it hasn't been run
   (check the pitch coverage line in `awh samples stats`), then
   `search --near-note <note>` with the note the owner names or the Set's
   active key root, combined with any other filters/terms (e.g.
   `search kick --near-note F1`). This is real key matching, but only for
   pitch-tagged kick/sub/808 one-shots, never loops or melodic material
   (see the Sample library section).
6. Once picked, hand off to whatever the owner wants to do with it:
   audition via AWH Remote if available, `awh clip from-audio` for melodic
   material, `awh drums detect-onsets`/`awh op match` for drum and
   sound-design uses, or report the path back.

**Generate or rework a drum pattern** ("give me a house groove", "make this
beat trap", "humanize my drums", "variations of my drum loop"):
1. `awh status --json`: find the drum-rack track (drum tracks list
   drumPads). Don't hand-compose drum notation; the drum tools are
   pad-aware and idiomatic.
2. New pattern: `awh drums gen <trackPath> --style house|techno|trap`
   (`--variant` for a specific named kick cell). Rework existing:
   `awh drums vary` (variations), `awh drums fill` (last-bar fill),
   `awh drums humanize` (groove), not plain `vary` or hand edits.
3. Audition loop as with vary: name the slots, let the owner listen, sweep.

**Mine rhythm stats from real drum loops / check the drum grammar against
real data** ("how do real house kicks sit on the grid", "check our trap
pattern against real loops", "mine this sample pack for rhythm stats"):
1. Confirm there's a folder of drum-loop audio files, not a single file.
   `mine` aggregates across a directory for a meaningful
   position-probability table.
2. `awh drums mine <dir> --dataset <name> [--bpm N | --no-bpm-from-name]
   [--save <name> --attribution "<license/credit line>"]`. BPM comes from
   the filename by default (e.g. `138bpm_...`); pass `--bpm` for packs that
   don't encode it. Use `--save` only when the dataset's license permits
   reuse, and put the exact required credit line in `--attribution`,
   verbatim.
3. Relay the printed per-band position-probability table (low/mid/high, a
   kick/snare-clap/hat proxy; say so), density, and swing estimate
   verbatim. Never invent a number the tool didn't print. Zero audio files
   found is a normal result (exit 0, states it).
4. This is reporting only. Never edit `HOUSE_STYLE_SPEC`/
   `TECHNO_STYLE_SPEC`/`TRAP_STYLE_SPEC` in `grammars.ts`/`styleSpec.ts`
   from a mining result; those are hand-authored and locked. If the numbers
   are worth acting on, write or extend a `knowledge/rhythm/` entry
   comparing them to the built-in assumptions (see
   `waivops-drum-stats-pilot` for the format) and let the owner decide on
   any spec change separately, as its own reviewed edit.
5. Always state the sample size. A folder of a few dozen loops is a
   starting hypothesis, not a verdict; caveat small-n pilots as suggestive.

**Answer a call clip with a response** ("give me some responses to this
lead", "answer this vocal chop with a bass growl", "write a call and
response for my drop"):
1. `awh status --json`: find the call clip (or write one first:
   `awh clip from-audio` for a hummed/recorded idea, `awh clip create` for
   hand notation) and a target track for the response voice. Use a
   different sound/track than the call; this is a pair, not a stack.
2. `awh drop respond <callClip> <targetTrack>`. Don't hand-compose a low
   growl part; this reads the call's notes and derives several reproducible
   candidates (default: one per recipe), each respecting the
   rest-before-entry and resolve-to-tonic/fifth rules. Zero notes in the
   call clip is a normal result: it says so and writes nothing. Use
   `--dry-run` first to preview note counts before filling slots.
3. Name the candidate slots for the owner (`resp <recipe> s<seed>`) and let
   them audition; `awh sweep <targetTrack> --prefix resp` clears the rest
   once they've picked a favorite.

**Cold-start a call-and-response drop skeleton** ("write me a dubstep drop
from scratch", "give me an 8-bar call and response idea", "build a
call/response skeleton in this key"):
1. `awh status --json`: the Set's scale (or plan a `--key`), and two empty
   targets on different tracks/sounds for the two-voice pairing (or one,
   for the single-clip register-split form).
2. `awh drop phrase <callTarget> [responseTarget] --bars 8|16 [--style s]`
   generates both voices from a spec (weighted call cells, an evolution plan
   that varies the call while the response anchors, a turnaround reset at
   the phrase boundary) rather than one flat loop. `--dry-run` first;
   `--variant` to pin a specific call-cell feel.
3. Tell the owner this is a skeleton to audition and shape, not a finished
   drop. The engine writes notes, not sound design; the growl/chop timbre
   is theirs to pick.

**Arpeggiate a chord progression / commit an arp pattern** ("arp this chord
clip", "give me a trance-style 16th arp over i-VI-III-VII", "I like the
Arpeggiator's feel here, print it as real notes"):
1. Chord source: an existing chord clip (`awh status --json` to find it, or
   write one first with `awh chords <target> --progression "..."`), or skip
   the clip and pass `--prog "i-VI-III-VII" --key "A minor"`. Don't
   hand-render the progression; `awh arp --prog` runs the same harmony
   engine as `awh chords`.
2. `awh arp <chordClip> <target> --style <s>` (clip source) or
   `awh arp --prog "..." --key k <target> --style <s>` (progression source;
   `<target>` is the only positional). `--dry-run` first to see the
   bar|beat notation; `--variant` to try a different euclid rotation
   without a new seed.
3. A clip with no simultaneous notes (a melody, not a chord clip) is a
   normal result: it says so and writes nothing. Point it at real chord
   material instead of retrying with a different style/seed.
4. This writes real notes, unlike the stock Arpeggiator device (which the
   Set can't inspect), so the result composes with `awh vary`, `awh save`,
   and every notation-reading tool downstream.

**Chop a break sample and re-sequence it** ("chop this amen break", "give me
a jungle pattern from my own break sample", "I need a fill on this break",
"turn this drum break into a Drum Rack"):
1. First tell the two halves apart. A canonical pattern request with no
   sample ("give me an amen pattern") is `awh breaks place
   <break-pattern-name> <target>`: no audio file needed, it plays a sourced
   MIDI pattern from knowledge. A real sample the owner has ("chop this
   wav") is the flow below.
2. `awh breaks chop <break.wav> --save <name> --export <dir>` onset-slices
   the file into a labeled chop map (role guess + confidence, BPM, measured
   grid offsets) and writes `<nn>-<role>.wav` files + a README into
   `<dir>`. Tell the owner to drag those files into an empty Drum Rack's
   pads in order; `--mode drum-rack`, the default, assumes that layout.
3. `awh breaks pattern <target> --map <name> --style jungle-classic|halftime
   --at-bar N --dry-run` first: show the notation preview, then drop
   `--dry-run` to commit. `awh breaks fill <target> --map <name> --dry-run`
   for turnaround fills (N seeded candidates at once). Audition via AWH
   Remote (`awh lib audition`-style transport) and keep favourites.
4. If the owner plans to use Live's Slice-to-New-MIDI-Track instead of a
   Drum Rack, pass `--mode live-slices` and relay its count-match warning
   verbatim (the chop map's slice count vs. what Live's transient detector
   finds). Never reassure them past a real mismatch risk.
5. Low role-confidence across a chop map is a normal, reported state:
   `pattern` warns and falls back to same-slice tricks only. Suggest a
   cleaner source break or a different `--bpm` override rather than
   insisting the current chop is wrong.

**Write an 808 bassline** ("give me an 808 for this beat", "add a trap 808
with slides", "I need a triplet-flow 808 bass in this key"):
1. `awh status --json`: the Set's scale (or plan a `--key`) and an empty
   target (session slot, or a track + `--at-bar`).
2. `awh bass 808 <target> --key "<key>" --style trap-long|trap-syncopated|
   triplet-flow --dry-run` first: show the notation preview (point out the
   overlapping slide pairs), then drop `--dry-run` to commit.
   `--variant <cellName>` pins a specific cell feel instead of the seeded
   weighted draw.
3. Tell the owner the result is written legato on purpose: the slides only
   audibly glide on a mono synth with glide on. Point them at
   `awh op apply glide-bass <devicePath>` (or their own 808/mono patch),
   not a plain sampler. `--slides off` is the fallback for a synth or
   workflow that can't glide.
4. This is generated material to audition and shape, like any other `awh`
   pattern generator, not a finished, mixed 808. Tone, saturation and
   sidechain remain the owner's sound-design steps.

**Mix feedback / "how does my mix measure?"** ("check my low end", "is this
loud enough for clubs", "did that EQ change help"):
1. Get audio: `awh mix capture` (tap on the master, see m4l/README.md) or
   ask the owner for an export. Get the tempo from `awh status`.
2. `awh mix report <file> --bpm <tempo> [--target <name>] [--delivery club]`.
   Quote the findings' numbers verbatim; never state a measurement the
   report didn't print. Offer `--save` so the measurement becomes a
   retrievable record (`awh mix records`).
3. Comparisons: `awh mix ab <before> <after>` (loudness-matched). For
   sidechain verification use `awh mix pump-check <SidechainBusCapture>
   --trigger-clip <Trigger>`: a trigger-locked fit with a
   ducking/no-duck/inconclusive verdict. Capture the isolated ducked bus;
   it warns on full-mix bleed. The on/off `ab` pair remains the strongest
   proof.
4. No target yet? Offer `awh mix target <owner's reference tracks> --save
   <genre>` first, so comparisons run against their references, not
   folklore.

**Get a prioritized fix list / "what should I fix first", "is this ready to
release"** (a ranked plan, not a flat findings list):
1. Get audio (capture or export) as above. `awh mix advise <file>` alone
   works; the dependency-ladder ranking and healthy-state check don't need
   `--target`/`--layers`.
2. Offer to unlock more of the ladder: `--target <name>` (build one first
   with `awh mix target` if the owner has none) for the tonal-balance stage,
   `--layers <name>` (from `awh mix layers ... --save <name>`) for the
   inter-element masking stage. A missing one appears as its own ranked item
   saying what running it would unlock; don't treat that as an error or
   skip the stage.
3. Present the ranked plan top-down, quote every evidence number verbatim,
   and relay `blockedBy` as "fix #N first; this may change once you do."
   Never add a move the engine didn't emit, not even a "usually you'd
   also..." aside. The value is a legible, cited rule table.
4. Zero actionable items is the healthy state, not a failure. Say so and
   relay the two metrics closest to tripping (with their margins) so the
   owner knows where the headroom is.
5. `--set` (needs the gateway) additively names real master-chain devices
   in the actions instead of "add an EQ Eight". Offer it when the owner is
   in Live, skip it offline, never block on it.
6. After the owner (or you, on request) acts on one item: re-capture, then
   `awh mix advise <newFile> --compare <savedAdviceName>`. Relay
   resolved/improved/unchanged/new per item instead of re-explaining the
   whole plan. `--save [name]` on the first run is what makes `--compare`
   possible later, so offer it up front.

**Masking / "does my sub fight my bassline", "is this patch's fundamental
where I think it is", "compare these layers"** (narrowband/masking
diagnosis; `mix report`'s spectral tilt is broad-spectrum and can't answer
this by design):
1. Pitch check on one sample/patch: `awh mix pitch <file> [--per-note]`.
   f0 comes from periodicity tracking, never the loudest FFT bin. Relay
   `harmonic_dominance` too when flagged (a partial outgrew the fundamental
   partway through; real information, not a detector error). Use
   `--per-note` on a melodic phrase/growl that changes note to note.
2. Narrowband energy compare: `awh mix bands <fileA> [fileB...] [--bands
   "20-100,140-200,200-500"]`. Calibrated dBFS (0 dBFS = a full-scale sine,
   so it's comparable across sessions) per named danger zone, plus each
   band's fraction of the file's total energy. Multiple files get an
   aligned table with deltas vs. the first.
3. Comparing several live tracks/layers (not pre-rendered files):
   `awh mix layers <track:N> <track:M>... [--bars N --from-bar N]`. One
   command solos each track, captures it, restores every track's prior solo
   state (even if a capture fails partway, so the Set is never left
   soloed), then runs `mix bands` across the results. Needs the AWH Capture
   Tap; if it's not loaded the error says so and solo state is still
   restored.
4. Zero tracks passed to `layers` prints a state ("nothing to
   solo/capture/compare"), not an error.

**Press play, launch a clip/scene, or audition a library clip from chat**
("play this back", "start from bar 33", "launch that drop clip", "trigger
scene 2", "stop everything", "let me hear that garage hat loop on drums"):
1. This needs the AWH Remote M4L device (m4l/README.md); the SDK has no
   transport or clip-launch API. If a command fails with "requires the AWH
   Remote device...", tell the owner to load it once (Install section).
   Don't retry blindly or fake success.
2. Transport: `awh play [--from-bar N]` / `awh stop` / `awh jump <bar>`.
   jump sets the arrangement playhead (`current_song_time`); play jumps
   first when given `--from-bar`.
3. Launch: `awh launch track:2/slot:0` (session clip slot) or `awh launch
   scene:1` (scene), respecting Live's launch quantization. `awh stop-clips
   [track:N]` stops one track's clips or, with no arg, the whole Set.
4. "Let me hear my saved X on this track": `awh lib audition <slug>
   <track>` places (empty-slot logic, same as `lib place`) and fires in one
   command. It's ephemeral by default: auditioning the next slug (or `awh
   lib audition --end`) sweeps this one first by its exact clip name (never
   a prefix, so a similarly named clip the owner kept is safe). Pass
   `--keep` if the owner wants to keep what they heard.
5. A bad track/slot/scene index comes back from the device as a clear
   error, not a hang or silence. Relay it; don't guess a different index.

**Sound-design an Operator patch** ("give me a growl bass on Operator",
"make this sound like <sample>", "dial in a pluck patch"):
1. From craft knowledge: `awh op recipes`, pick a slug, then
   `awh op apply <recipe> <devicePath> [--dry-run] [--audition]`. It
   validates every param name against the live device first and, on a
   mistyped/missing param, fails loudly and writes nothing. `--audition`
   drops the recipe's playNotes into an empty session slot to press play.
2. From a reference sound: get the audio (owner-provided, or
   rendered/captured from the Set), then `awh op match <sample.wav>`, a
   tiered proposal. Tier 3 ("outside Operator's reachable set") is a normal,
   expected result for noisy/inharmonic/formant-heavy material. Relay the
   measured reason (harmonicity/pitch drift/inharmonic partials) and don't
   push the owner toward a patch Operator can't produce.
3. On a tier-1/2 match: relay the oscillator/envelope/filter targets and
   the confidence (residual). Always hand the owner the
   `drawThesePartials` list too. Operator's user-drawable harmonics are
   believed to be UI-only (unverified, not automatable), so drawing them is
   a 30-second manual step when the stock-wave residual is high.
   `--apply <devicePath>` pushes only the addressable subset (same
   validate-first flow as `apply`). Its raw values are a labeled heuristic,
   not a calibrated curve; say so and don't claim precision it lacks.
4. To verify against the real sound (owner's machine, needs the AWH Capture
   Tap on the device's bus, m4l/README.md): `awh op verify <ref.wav>
   <devicePath>`. It does not auto-iterate: report the score, let the owner
   tweak, then re-verify (measure, adjust, verify, as in mixing).

**Sidechain ducking** ("tune my sidechain", "duck the bass to my kick",
"set up sidechaining"). Read knowledge/setup/sidechain-template.md first:
the owner's template routes BASS/SAMPLES through a Sidechain bus with a
MIDI "Trigger" track. Always start from the fit, then pick a strategy:
1. Fit (all strategies): capture the DRUMS bus over a span starting on the
   Trigger pattern's boundary, then
   `awh mix duck fit <drumsCapture> --trigger-clip <Trigger clip>`
   (add `--bass <bassCapture>` for masking-based depth). Output: measured
   kick body/tail + depth/hold/release + points. No MIDI Trigger clip
   (audio one-shot kits)? Derive real positions first:
   `awh drums detect-onsets <drumsCapture> [--make-clip <target>]`. Never
   guess trigger beats. fit warns when triggers don't match real hits (peak
   far from window start, absurd peak-over-floor); treat those warnings as
   a stop.
2. Automatic strategy (default when the owner says "automatic" or has no
   ShaperBox on the track): `awh mix duck setup <Sidechain track>` inserts
   a preset stock Compressor and prints the two manual touches (enable
   Sidechain + Audio From = trigger source; Release dial). The SDK cannot
   set routing; don't pretend otherwise. Then, with the tap on the ducked
   bus: `awh mix duck calibrate <devicePath> --target-depth <fit depth>
   --trigger-clip ... --from-bar N --bars 4`. It captures, measures and
   adjusts Threshold in a closed loop and reports the achieved depth.
3. ShaperBox strategy (owner's classic template): read the fit numbers as
   drawing instructions. Mechanics (docs/research/shaperbox-preset-format
   .md): LFO Length in ms = the printed gap, MIDI Trigger "On",
   sharp-corner points for dip/hold, smooth for release; Favorites /
   LFO copy-paste for reuse. Preset files cannot be generated; never offer
   to write one.
4. M4L Ducker strategy (full-auto, no routing clicks): needs the AWH Ducker
   device placed once by hand on the Sidechain bus (m4l/README.md; the SDK
   cannot insert M4L devices). `awh mix duck fit <drumsCapture>
   --trigger-clip <Trigger clip> --json > fit.json`, then `awh mix duck push
   --fit fit.json --trigger-clip <Trigger clip>`. It pings the device,
   pushes the envelope + trigger pattern over OSC, and turns it on. `--off`
   bypasses it (unity gain). No Trigger clip? `--pattern "0,1,2,3" --length
   4` (raw beats). An empty Trigger clip is a no-op: it says so and sends
   nothing.
5. Verify (any strategy): `awh mix duck measure <SidechainBusCapture>
   --trigger-clip ...` (achieved depth) or an on/off `awh mix ab` pair (for
   the M4L Ducker, on/off = `duck push` / `duck push --off`). If the
   measured kick tail forces a groove-killing duck, suggest tightening the
   kick's own decay.

Volume-automation ducking is not possible via the gateway (no automation
API). Say so if asked; don't improvise workarounds into real projects.

**Start a new track / add a chord bed** ("new project", "start something
in F minor", "give me chords under this"):
1. New project: `awh new project <name>` (their template). If it errors
   about a missing template, walk them through copying their starting-point
   project folder to library/templates/project once. They open it in Live;
   then `awh new populate` applies their scaffold. Show what it did.
2. Chords: `awh status` for the scale, then `awh chords <target>
   --progression <spec>`. Pick progressions that fit the genre (the KB's
   arrangement/rhythm entries may name idiomatic ones; cite if used). Read
   the voiced pitches back; offer `--voicing`/`--rhythm` variants rather
   than re-guessing.

**Answer from / add to the knowledge base** ("what do we know about X",
"how does <artist> do Y", "remember this", "save what we learned today"):
1. Retrieval: `awh kb list --topic <t>` or grep `knowledge/INDEX.md` first.
   If an entry covers it, `awh kb show <slug>`, apply its Executable
   section, and cite `slug [tier]`. Reason from scratch only when the KB is
   silent, and say so.
2. Capture: `awh kb new <topic> <slug>` (topics are open-ended; create a
   directory if none fits), fill in Executable + rule. Your entries are
   `draft` (or `sourced` with citations), never `verified`.
3. End of session: `awh distill -o /tmp/distill.md` dumps the project;
   curate the notable clips into `awh save` and the lessons into entries.

**Build an endless/infinite web version of a song to share** ("make an
endless version of my track", "build me a Bronze-style infinite player",
"I want a version of this song that's different every time"):
1. This is outside the Live Set. Don't reach for `awh sections` (which
   writes an arrangement into Live from source clips) or hand-compose
   anything; it's a standalone static web page built from the owner's own
   bounced/mixed audio stems.
2. Confirm the owner has (or will bounce) bar-exact loops per section per
   layer. If they're unsure what "bar-exact" means, offer `awh endless demo
   -o <dir>` first so they can hear the engine with zero real assets.
3. `awh endless plan --sections "intro:8,drop:16,..." --bpm <bpm> -o
   endless.yaml` (or `--from-ref <name>` if they have a corrected reference
   section map from `awh ref`) produces an editable, commented scaffold
   with empty pools. Don't skip to `build`; the owner fills in real audio
   file paths first.
4. `awh endless build endless.yaml -o dist/<name>` validates every
   file/duration/reachability/pool before writing anything. Relay every
   listed problem (missing file, wrong duration, unreachable section, empty
   pool) rather than guessing a fix. `--single-file` for a single shareable
   HTML.
5. Point them at the emitted `endless-README.md`'s serve instruction: a
   multi-file build needs `python3 -m http.server`, not double-clicking
   `index.html` (browsers block `fetch()` on `file://`).

**Tweak a device:** `awh call device.get` first (params carry
name/min/max/current value; values are raw Live-internal numbers, so check
min/max rather than assuming units), then `device.param`. For mixer moves
use `track.mixer` (volume 0.85 raw = 0 dB unity, 1.0 = +6 dB; see
docs/research/mixer-calibration.md).
