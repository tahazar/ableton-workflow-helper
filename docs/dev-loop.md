# Development Loop

## One-time setup (dev machine: macOS, Live 12 Suite beta 12.4.5+)

1. Install the Live beta side-by-side with stable (Centercode / Ableton beta
   program). Keep real sessions in stable Live.
2. In the **beta's** Settings → Extensions: enable **Developer Mode**.
3. Download the Extensions SDK zip from the beta program; extract it under
   `vendor/ableton-sdk/` in this repo.
4. Node ≥ 24 (the SDK dev CLI requires it; core/cli only need ≥ 22) and pnpm.
5. From the repo root:

   ```sh
   pnpm install
   pnpm setup:sdk          # extracts SDK to vendor/ableton-sdk/sdk/, prints CLI install cmd
   npm install -g <cli tarball printed by setup:sdk>
   ```

## Everyday loop

```sh
pnpm test                 # core unit tests (no Live needed)
pnpm build                # core + cli
pnpm build:extension      # bundles packages/extension/dist/main.js (needs SDK)
```

Run inside Live (dev mode, hot-loads into the running beta):

```sh
cd packages/extension
extensions-cli run        # see SDK README for flags; --inspect attaches VS Code debugger
```

Logs (`console.*` from the extension) land in `ExtensionHost.txt` in the Live
beta's Preferences folder.

Verify the chain from a terminal:

```sh
awh ping                  # gateway alive? which bridge?
awh status                # tempo/tracks/scenes of the open set
awh ops                   # list operations
awh call set.summary      # raw op invocation
```

Development without Live (any machine, e.g. remote Claude sessions):

```sh
awh serve-fake &          # gateway backed by FakeLiveBridge
awh ping                  # same commands, fake data
```

## First-build verification checklist (M0 exit criteria)

The SDK exists only on the dev machine, so parts of the extension are written
against a best-effort type shim. On the FIRST successful `pnpm setup:sdk`:

- [x] Diff `packages/extension/types/ableton-sdk-shim.d.ts` against the real
      SDK's `.d.ts` files in `vendor/ableton-sdk/sdk/package/`; fix any drift.
- [x] Search the repo for `VERIFY-ON-MACHINE` comments and resolve each one
      (accessor shapes in `sdkLiveBridge.ts`, command/menu registration in
      `main.ts`, manifest fields).
- [x] Install the aker-dev `ableton-extension-skill` (MIT) into
      `.claude/skills/` locally so Claude sessions on the Mac have the verified
      API reference — the SDK is absent from model training data.
- [x] `extensions-cli run` with the Live beta open, then: `awh ping` returns
      the SDK bridge, `awh status` shows the real set's tempo, and
      right-clicking a MIDI track shows "AWH: Hello" (logs to ExtensionHost.txt).
- [ ] Package a `.ablx` (SDK CLI), install it via Settings → Extensions,
      restart, and repeat the `awh ping` check against the packaged install.
      (Not yet done — dev-mode verification above is complete, but the
      packaged-install path is still unverified.)

When all boxes tick, M0 is done and M1 (real gateway operations) starts.

## M1 in-Live verification checklist

The M1 op surface is fully covered by unit tests against `FakeLiveBridge`, and
the SDK adapter typechecks against the (machine-verified) shim — but the fake
cannot catch Extension Host runtime quirks (missing globals, transaction
timing, param value scales). Run this once in the Live beta after pulling M1
(a local Claude Code session can drive it; same handoff pattern as M0):

- [x] `pnpm build:extension` + `extensions-cli run` with a throwaway Set open
- [x] `awh status` shows the real Set (tracks/clips/devices with names)
- [x] `awh call clip.create-midi --args '{"target":{"type":"arrangement","trackPath":"track:0","startBeat":128},"lengthBeats":4,"notes":[{"pitch":60,"start":0,"duration":1}]}'`
      → clip appears at bar 33 on the first (MIDI) track; ONE undo step for the
      create, a second for the notes (documented create-then-configure split)
- [x] `awh call clip.get --args '{"path":"track:0/arr:0"}'` returns the notes
- [x] `awh call track.clear-range` on a range overlapping a clip → truncation
      matches Live's behavior (boundary clips truncated, not deleted)
- [x] `awh call device.insert --args '{"ownerPath":"track:0","name":"EQ Eight"}'`
      then `device.get` → params list with real min/max; `device.param` moves
      a band frequency audibly/visibly
- [x] `awh call track.mixer --args '{"path":"track:0","volume":0.85}'` → note
      the dB the volume slider shows; RECORD raw-value↔dB pairs at 0.0, 0.4,
      0.7, 0.85, 1.0 into `docs/research/mixer-calibration.md` (seed data for
      the dB mapping — M1 follow-up)
- [x] Drum Rack: `drum.pad-note` verified against an existing rack's pad chain.
      `simpler.sample` still unverified — `device.insert --args
      '{"...","name":"Simpler"}'` fails with a generic "Failed to insert
      device" (the real SDK's insert-device callback carries no error detail).
      Unclear yet whether "Simpler" is the wrong device name string or Live's
      API just can't insert an empty Simpler this way — needs follow-up
      research, then a real (non-destructive, freshly-inserted) device to test
      `simpler.sample` against.
- [x] Errors: `awh call clip.get --args '{"path":"track:99/slot:0"}'` → clean
      404-style error, no extension crash, nothing in ExtensionHost.txt beyond
      the logged message
- [x] Fix whatever drifts (shim + adapter), commit to the branch, push —
      found and fixed a real one: the shim fabricated a `name` getter on
      `DrumChain` that doesn't exist on the real SDK class (only
      `receivingNote` does), which silently dropped pad names from
      `set.summary`. See commit history for the fix.

## M2 in-Live verification checklist

Short — M2 is mostly SDK-free (notation + CLI + skill), all unit-tested:

- [x] `awh clip create track:<midi>/slot:<empty> <<'EOF' ... EOF` with bar|beat
      notation → clip appears with correct pitches/positions in Live's editor
      (spot-check middle C: notation C3 must land on Live's C3). Confirmed
      visually — note track:0 (Splice Bridge) isn't a valid target for a real
      musical check even though clip.create-midi succeeds against it; used
      track:3 instead.
- [x] `awh clip read` on a clip you wrote BY HAND in Live → notation matches
      what you see in the piano roll. Confirmed down to per-note velocity: a
      hand-drawn 16th-note run had one note visibly quieter in the velocity
      lane, and the notation read it back as `v1` vs `v100` on the rest.
- [x] read → edit notation → `awh clip write` → piano roll updates. Confirmed
      visually (octave transpose + velocity fix on the same clip).
- [x] `awh render track:<audio> --from 0 --to 8` → WAV exists, correct length.
      Rendered track:6 112-120 beats → .aif (Live's configured format, not
      literally .wav), 3.4286s duration = exactly 8 beats @ 140 BPM.
- [x] Skill: open a local Claude Code session in the repo, ask it to "read the
      clip at track:0/slot:0 and transpose it up a fifth" — it should use the
      awh skill, round-trip cleanly, and verify its own write (M2 exit
      criterion). **Passed.** A fresh agent, given only that sentence and no
      other context, found `.claude/skills/awh/SKILL.md` on its own, read the
      seeded C3/E3/G3/C4 clip, wrote back G3/B3/D4/G4 (+7 semitones), and
      verified its own write — independently re-confirmed against the live
      Set afterward.

## Running the M0 checklist with Claude on the Mac

The checklist above is designed to be executed by a **local Claude Code
session** (desktop app or `claude` in the terminal) opened in this repo on the
dev machine — the remote/cloud sessions that built this scaffold cannot see
`vendor/ableton-sdk/` or the running Live beta.

Human-only steps (GUI, ~5 minutes):
- Enable Developer Mode in the Live **beta**: Settings → Extensions.
- Keep the beta open with a throwaway set during verification.
- The right-click "AWH: Hello" check, and installing the packaged `.ablx`
  (drag into Settings → Extensions, restart Live).

Everything else is Claude-executable. Kickoff prompt for the local session:

> Check out branch `claude/ableton-integration-brainstorm-p4xjxl` and read
> `docs/dev-loop.md`. Execute the "First-build verification checklist": run
> `pnpm install` and `pnpm setup:sdk`; install the SDK dev CLI it prints;
> fetch the MIT-licensed `aker-dev/ableton-extension-skill` into
> `.claude/skills/` (project-scoped) and use its verified API reference — the
> Extensions SDK is absent from your training data, so do NOT write SDK calls
> from memory. Diff `packages/extension/types/ableton-sdk-shim.d.ts` against
> the real SDK types in `vendor/ableton-sdk/sdk/package/`, fix the shim and
> every `VERIFY-ON-MACHINE` marker in `packages/extension/src/`, then
> `pnpm build && pnpm test && pnpm build:extension` and start dev mode with
> `extensions-cli run`. Tell me when you need me to click something in Live.
> Verify with `awh ping` and `awh status` against my open set, check
> ExtensionHost.txt for errors, then commit the fixes to the same branch and
> push. Never commit anything under vendor/ (non-redistributable SDK).

After the local session pushes its fixes, remote sessions pull the corrected
shim and can continue M1 development against it.

## Design guardrails (from ADR-001/002)

- Only `packages/extension` may import `@ableton-extensions/sdk`.
- Never commit anything under `vendor/ableton-sdk/` (non-redistributable).
- Extension file writes: only `environment.storageDirectory` / `tempDirectory`
  (a stricter OS sandbox is pre-announced).
- One logical operation = one `withinTransaction` (create-then-configure is
  unavoidably two undo steps — document per op).
- No GPL/AGPL code in the tree; GPL tools as subprocesses only.

## M3 in-Live verification checklist

M3 is entirely SDK-free (transforms run in the CLI; writes go through the
already-validated clip ops), so this is a musical sanity pass, not an API one:

- [x] `awh vary <a real 4/8-bar loop> -n 8 --seed 1 --ops "transpose-scale:degrees=2 humanize"`
      with the Set scale active → 8 named clips in empty slots, in key,
      audibly related to the source. Confirmed: a seeded 4-bar E-minor loop's
      pitches all shifted by exactly +2 scale degrees (E→G, G→B, B→D, A→C),
      humanize jitter on timing/velocity as expected.
- [x] Same command, same seed, after `awh sweep` → IDENTICAL variations
      (determinism end-to-end). Confirmed byte-for-byte identical across two
      full round-trips through the real Extension Host.
- [x] A rhythm pipeline (`syncopate:probability=0.5 swing:amount=0.7`) on a
      straight drum-rack loop → grooves, and drum pitches (pad notes) survive
      untouched. Confirmed: pitches stayed exactly `{0,1}` (kick/snare) in
      every variation while onsets shifted off the strict quarter-note grid.
- [x] `awh sweep` with the prefix → only the audition clips vanish. Also
      confirmed for the newer arrangement mode (`vary --arrange` + `sweep`
      covering arrangement clips) — see below.
- [x] Skill flow: ask a local Claude session "make me 6 variations of the bass
      loop, more syncopated, keep it in key" → it picks a sensible pipeline,
      runs vary, and tells you which slots to audition (M3 exit criterion).
      **First attempt failed the intent** (not the mechanism): a fresh agent
      hand-composed 6 new basslines via `clip create` instead of running
      `awh vary` — traced to `SKILL.md`'s own "Vary an existing loop" example,
      which never mentioned `awh vary` and told the agent to hand-produce
      variations, contradicting the dedicated `awh vary` section elsewhere in
      the same file. Fixed the example; re-ran with a second fresh agent,
      which then correctly ran `awh vary ... --ops "syncopate:... humanize"` —
      independently verified: 6 clips, all 16 notes (matching the source,
      unlike the first attempt's 16-40 varying note counts from hand-composed
      material), same pitch set as the source, timing shifted off-grid.
- [x] Arrangement-mode `vary --arrange`/`--at-bar` and `sweep` covering the
      arrangement (added post-M3, spec R1's arrangement-first workflow):
      confirmed default placement lands sequentially right after the track's
      last arrangement clip with no overlap (verified both via the API and
      visually in Live's Arrangement view), and `sweep` removes exactly the
      swept clips from the arrangement without touching real content.

## M4 in-Live verification checklist

SDK-free (renders through validated clip ops); this is a musical + safety pass:

- [x] `awh sections plan --form house --role drums=<real loop> --role bass=<real loop> -o plan.yaml`
      → YAML reads sensibly; edit a section's bars/ops. Confirmed: house preset
      is 128 bars (16/16/32/16/8/32/8), edited breakdown 16→8 bars cleanly.
- [x] `awh sections apply plan.yaml --dry-run` → clip list matches the plan.
      Confirmed exactly: 12 clips, correct cumulative bar positions reflecting
      the edit.
- [x] apply on an EMPTY arrangement span → skeleton appears; play through:
      intro is thinned, builds ramp, drops hit full, sections named on timeline.
      Confirmed via the API (positions/spans byte-accurate — bar N = beat
      (N-1)×4 exactly) and note density (intro/breakdown thinned, drops full,
      bass "off" sections correctly skipped).
- [x] Re-apply same plan+seed at a different --at-bar → identical material.
      Confirmed byte-for-byte identical (both tracks, all clips) across two
      full apply round-trips through the real Extension Host.
- [x] Safety: apply over existing clips WITHOUT --clear → refuses with the
      clear/at-bar hint; with --clear → span cleared then written. Confirmed
      both: clean refusal with zero partial writes, then `--clear` genuinely
      replaced the span (verified via different random-seed content, not just
      a duplicate write).
- [x] Skill: ask a local session "build me a house skeleton from my drum and
      bass loops" → it plans, shows you the YAML, dry-runs, applies (M4 exit
      criterion). **First attempt failed the intent** (not the mechanism,
      again): a fresh agent bypassed `awh sections` entirely and hand-wrote a
      skeleton directly onto two REAL tracks via `clip create`/`clip write` —
      same root cause as the M3 bug: `SKILL.md`'s "Typical flows" section had
      an entry for varying loops but none at all for building a skeleton,
      despite `awh sections` being a whole dedicated, documented feature.
      Nothing pre-existing was destroyed (it filled an empty placeholder and
      used empty timeline space), but it was unreviewed — no plan shown, no
      dry-run, no `awh sections` at all. Removed that content, added a
      "Build an arrangement/skeleton from loops" flow entry to SKILL.md, and
      re-ran with a second fresh agent: it correctly ran `awh sections plan
      --form house` → `apply --seed 42`, produced the full 128-bar skeleton
      with the tool's own naming convention (`intro-drums`, `drop1-drums`,
      …) — independently verified against the live Set (positions, note
      density, in-scale pitches all correct).

## B3 (library) + B3d (.alc mirror) verification checklist

Library round-trip (SDK-free, validated clip ops underneath):

- [x] `awh save <a real clip> --category hats --tags <...>` → markdown entry
      appears under `library/clips/hats/`, INDEX.md regenerated, bpm/scale
      context captured from the Set. Confirmed (including catching a false
      alarm: the captured scale looked wrong against stale memory of an
      earlier session — it was correct, the Set's active scale had genuinely
      changed since then).
- [x] `awh lib list` / `awh lib show <slug>` → entry reads sensibly. Confirmed.
- [x] `awh lib place <slug> <empty slot or --at-bar>` → clip lands in Live and
      sounds identical to the saved source. Confirmed byte-identical.
- [x] Skill: "save that hat loop for later" then, in a NEW Set, "place my
      garage hats" → Claude captures/places via the library, citing slug+tier.
      Save half passed cleanly first try. Place half found a real gap: two
      independent fresh agents, asked to place into a Set full of pre-blocked
      empty placeholder clips, both hand-tiled the entry into an existing
      placeholder via `clip write` instead of `lib place` — because `lib
      place` genuinely couldn't do that (traced in code: it only ever called
      `clip.create-midi`, so targeting an occupied slot/position would have
      errored or duplicated). Extended `lib place` to fill an existing clip
      at the target (tile/truncate to its length) when one is there, reusing
      the already-tested `tileNotes` from the M4 sections renderer. A third
      fresh agent then correctly used `lib place` directly — independently
      verified against the live Set.

.alc mirror (THE Live-facing new ground — take it slowly):

- [x] Golden template: in Live 12, put one MIDI clip (a few notes) on a
      device-free track, drag it into the User Library, then
      `awh lib capture-template "<User Library>/Clips/<name>.alc"` →
      reports Live's real Creator string + note schema. Confirmed: "Ableton
      Live 12.4.5b11", schema Time/Duration/Velocity/OffVelocity/NoteId.
- [x] `awh lib export-alc` → `live-mirror/AWH Library/` appears with
      `<category>/<slug>.alc` files + `Ableton Folder Info/`. Confirmed.
- [x] Drag the `AWH Library` folder into Live's Places → clips browse, PREVIEW
      (double-click), and drag into a track; notes/length/name all correct.
      Confirmed — note the browser PREVIEW plays Live's generic default
      sound, not the owner's instrument (by design: the golden template is
      captured device-free specifically so no instrument rides along in
      every export); dragged onto the real Drum Rack track it sounds correct.
- [x] Tags: browser Filter view shows an `AWH` group with your categories
      (+ `AWH Tags`) after Live indexes the pack. Confirmed.
- [x] Re-export after editing an entry (`--overwrite` save or hand-edit) →
      WITHOUT re-dragging, Live picks up the change (PackRevision bump; may
      need a moment or a browser rescan — note which). **Content edits: auto-
      updates with no rescan needed** (confirmed — added a bar to a saved
      clip, re-exported, Live showed the new version immediately). **Full
      removal is different**: found and fixed a real bug where `export-alc`
      threw "No MIDI library clips to export" and returned before calling
      `writePack` when the library (or a `--category` slice of it) went back
      to empty — silently leaving stale `.alc` files in Live's browser
      instead of syncing. Fixed: it now proceeds with 0 items, and
      `writePack`'s existing wipe-stale-content logic correctly clears the
      pack (verified on disk). **Live's browser still showed the stale clip
      after the fix, even after a manual rescan** — this is a genuine Live-
      side caching limitation (the exported files are correctly gone on
      disk), not a bug in our code; deletions apparently need something
      stronger than a folder rescan to clear from Live's browser cache
      (possibly a full library rebuild — not chased further this pass).
- [x] Reverse: drag a NEW clip from a Set into the User Library by hand, then
      `awh lib import-alc <that file> --category <c>` → entry matches the
      clip. Confirmed (3 notes, matching the golden-template capture step's
      own note count for the same file).
- [x] Safety spot-check: `live-mirror/` is gitignored; nothing outside it was
      touched; `library/mirror.json` revision incremented. Confirmed.

## M5 (drums) in-Live verification checklist

- [x] `awh drums gen <drum-rack track> --style house --bars 4` into an empty
      slot → pads mapped to sensible roles (kick/clap/hats), pattern grooves.
      Confirmed: kick (pad note 0) four-on-the-floor, snare (pad note 1) on
      the backbeat — textbook house, correctly mapped from the real pad names.
- [x] `--style techno` and `--style trap` → idiomatic (trap: beat-3 snare,
      hat rolls); different `--seed` → different ghost placement. Techno:
      driving kick plus low-velocity/low-probability ghost kicks (classic
      rolling feel). Trap: snare locked to beat 3 every bar as expected;
      `--variant` forces a named kick cell (reports which it picked, e.g.
      "kickCell: rolling · hatBase: straight-8ths"); without a forced
      variant, different seeds pick different cells/hat bases (sparse,
      double-tap, etc.) — genuinely different grooves, not just ghost jitter.
- [x] Track WITHOUT a drum rack → GM fallback notes, warning printed.
      Confirmed: correct GM note numbers (36 kick, 38 snare, 39 clap, 42/46
      closed/open hi-hat), warning text printed as documented.
- [x] `awh drums fill <clip>` → last bar gets a fill, crescendos into the loop.
      Confirmed: bars 1-3 untouched, bar 4 becomes a 16th-note roll with a
      clean velocity crescendo (60→115) into the loop restart.
- [x] `awh drums humanize <clip>` → kick stays tight, hats loosen; still
      grooves. Confirmed quantitatively on a kick+snare rack (no separate
      hats pad): snare timing deviation averaged ~2x the kick's (0.0054 vs
      0.0030 beats) — role-aware behavior generalizes correctly even without
      a dedicated hats role.
- [x] `awh drums vary <clip>` → recognizably the same pattern, reworked.
      Confirmed: all 16 kick-hit positions identical across the source and
      4 variations (kick anchor fully preserved); note counts shifted
      slightly (24→26/26/25/25) as the non-kick elements were reworked.
- [x] Skill: "give me a darker techno groove on my drum rack" → gen + audition
      loop works end to end. **Passed.** A fresh agent correctly ran
      `drums gen --style techno --density 0.35` (interpreting "darker" as
      sparse/no-snare) followed by `drums humanize`, across both active
      drum-rack tracks — and explicitly declined to touch a third track
      whose only pad looked like a mislabeled leftover rather than guessing.
      Independently verified: kick-only four-on-the-floor (16 notes, no
      snare) and off-beat 8th-note hats, both humanized.

## M6 (analysis engine) setup + verification checklist

One-time setup (dev machine):

```sh
python3 -m venv .venv
.venv/bin/pip install numpy scipy soundfile pyloudnorm pytest
cd analysis && ../.venv/bin/pytest -q && cd ..   # engine self-test
```

M4L capture tap: follow `m4l/README.md` (Max Audio Effect on the master,
paste/build the patch, save). Suite includes Max.

- [x] `awh mix report <any exported wav/aiff> --bpm <tempo>` → LUFS/dBTP/PSR
      match a trusted meter (Live's own LUFS meter, Youlean, etc.) within
      ~0.5 LU / 0.3 dB; findings read sensibly and quote real numbers.
      Confirmed against a real render (Kick & Snare bounce, MF Gabhru
      project) — owner-checked against Live's own meter, within tolerance.
- [x] `awh mix target <2-3 reference tracks> --save house` →
      `library/targets/house.json` appears; `report --target house` adds
      per-band deltas that match what your ears/eyes say about the balance.
      Confirmed mechanically (one reference track; genre-tag naming caught
      and corrected — see note below). Per-band deltas made intuitive sense:
      an isolated drum stem showed large low/high-end deviations vs. a full
      mixed master reference, exactly as expected for a non-full-mix source.
      **Naming gotcha**: saved the reference under `--save house`, but the
      actual reference track was trap, not house, and the project itself is
      trap — renamed `library/targets/house.json` → `trap.json` to match.
      Worth remembering: `--save <name>` doesn't validate the name against
      the reference's actual genre, so it's easy to mislabel.
- [x] Capture tap: device loads with no Max errors; `awh mix capture
      --from-bar X --bars 4 -o /tmp/cap.wav` loops the right span, records,
      stops; the file plays back as the mixdown. Confirmed — built the
      device by drag/paste per `m4l/README.md` (File→Open didn't appear in
      the menu for the owner; Cmd+O and drag-and-drop both worked as
      fallbacks), verified it captures whatever's actually playing
      (solo-state and all), and used it successfully for the rest of this
      checklist once built.
- [x] `awh mix ab <before> <after>` on a deliberate change (e.g. +3 dB shelf)
      → the band deltas show the change and ONLY the change (loudness match
      working: overall LUFS delta ≈ 0). Took two corrections to test cleanly:
      (1) first attempt targeted an EQ8 band configured as a Low Pass filter,
      where Gain does nothing — picked an actual High Shelf band instead;
      (2) even then, a +3dB change on ONE track was too diluted across 40+
      simultaneous tracks in the full mix to show a clear delta — soloed the
      target track for an isolated A/B. Once isolated: confirmed exactly as
      specified — `lufs_integrated` delta ≈ 0.00, and the ONLY flagged
      finding was `band_change_15849hz: +3.0 dB`, precisely the boosted
      shelf frequency. Also incidentally discovered a master-bus clipper
      (GClip) sitting before the capture tap that can absorb small gain
      changes — bypassed it for a clean test, restored after.
- [x] Pump: on a sidechained loop, report `--bpm` shows depth/alignment;
      break the sidechain → report reflects it. **Found a real limitation,
      not a simple bug**: on genuine sidechained content (BASS/SAMPLES ducked
      by a MIDI-triggered compressor), `pump_misalign_full/low` fired at
      ~228ms offset from the beat grid. Disabling the actual sidechain
      device and re-capturing the identical span still showed ~218ms — a
      negligible 10ms difference, when the finding should have changed
      meaningfully or disappeared. Root cause (read in
      `analysis/awh_analysis/dynamics.py`): the detector measures RMS-
      envelope periodicity folded over the beat period, which can't
      distinguish genuine sidechain ducking from a bass/sample note's own
      natural decay — both produce a rhythmic RMS trough near the end of
      each beat cycle on rhythmic material. Needs a real algorithmic rework
      (e.g. comparing against a bypassed/reference capture, or detecting a
      compressor-specific release-curve signature) — not attempted this
      pass; flagging for follow-up rather than a rushed fix.
- [x] Skill: "how's my low end vs my references?" → Claude captures/asks for
      a render, runs report --target, quotes numbers, suggests concrete
      moves. **Passed, with good judgment shown**: a fresh agent correctly
      declined to fabricate a comparison — it found the (at-the-time)
      mislabeled `house.json` target on its own and correctly reasoned a
      house profile would be an unfair yardstick for this trap/dhol/tumbi
      project, checked for real reference audio, found none it was
      confident about, and asked rather than guessed — exactly the "never
      invent a number" principle from `docs/design/analysis-engine.md`.
      Completed the loop manually afterward with the correctly-labeled
      `trap.json`: real per-band findings (25/32/40/50Hz all well above
      target, PSR below the clean-loudness guideline) with concrete
      EQ Eight moves suggested.

## Troubleshooting

- **Restarted Live? Restart `extensions-cli` too.** A stale extension-host
  connection keeps answering `awh ping` successfully while every real
  operation hangs or fails with generic SDK errors. If ops hang after a
  Live restart, kill and rerun `extensions-cli run` before debugging
  anything else.
- Small A/B gain changes not showing up in `awh mix ab`? Check for clip/
  limiter utilities (GClip etc.) sitting before the capture tap — bypass
  them or move the tap after.

## Definition of done (see docs/lessons-learned.md)

A new `awh` command is NOT done until: (1) SKILL.md's Typical Flows names it
for its natural request; (2) a negative-control test inverts its detection
claim against synthetic fixtures; (3) its behavior for occupied-but-empty
targets is decided and tested; (4) its zero-item path still runs cleanup/
sync side effects.

## Duck-fit (`awh mix duck`) verification checklist

- [ ] Capture the Drums bus over 4-8 bars starting on the Trigger pattern's
      boundary; `awh mix duck <capture> --trigger-clip <Trigger clip>` →
      body/tail times look plausible against the waveform
- [ ] Draw the printed points in Volume Shaper (depth/hold/exponential
      release) → bass audibly locks to the kick without pumping artifacts
- [ ] `--bass <bass capture>` → masking-based depth differs sensibly from
      the default 12 dB
- [ ] Proof loop: capture sidechain bus with the drawn envelope on vs
      Device On -> 0, `awh mix ab` → depth delta ≈ the drawn depth
