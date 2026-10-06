# Development Loop

## One-time setup (dev machine: macOS, Live 12 Suite beta 12.4.5+)

1. Install the Live beta side-by-side with stable (Centercode / Ableton beta
   program). Keep real sessions in stable Live.
2. In the **beta's** Settings → Extensions, enable Developer Mode.
3. Download the Extensions SDK zip from the beta program and extract it under
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

Extension logs (`console.*`) land in `ExtensionHost.txt` in the Live beta's
Preferences folder.

Verify the chain from a terminal:

```sh
awh ping                  # gateway alive? which bridge?
awh status                # tempo/tracks/scenes of the open set
awh ops                   # list operations
awh call set.summary      # raw op invocation
```

Development without Live (any machine without Live installed):

```sh
awh serve-fake &          # gateway backed by FakeLiveBridge
awh ping                  # same commands, fake data
```

## First-build verification checklist (M0 exit criteria)

The SDK exists only on the dev machine, so parts of the extension are written
against a best-effort type shim. On the first successful `pnpm setup:sdk`:

- [x] Diff `packages/extension/types/ableton-sdk-shim.d.ts` against the real
      SDK's `.d.ts` files in `vendor/ableton-sdk/sdk/package/`; fix any drift.
- [x] Search the repo for `VERIFY-ON-MACHINE` comments and resolve each one
      (accessor shapes in `sdkLiveBridge.ts`, command/menu registration in
      `main.ts`, manifest fields).
- [x] Install the aker-dev `ableton-extension-skill` (MIT) into
      `.claude/skills/` locally so agent sessions on the Mac have a verified
      API reference (the SDK is absent from model training data).
- [x] `extensions-cli run` with the Live beta open, then: `awh ping` returns
      the SDK bridge, `awh status` shows the real set's tempo, and
      right-clicking a MIDI track shows "AWH: Hello" (logs to ExtensionHost.txt).
- [ ] Package a `.ablx` (SDK CLI), install it via Settings → Extensions,
      restart, and repeat the `awh ping` check against the packaged install.
      Attempted; found an unresolved gap outside our code.
      `extensions-cli package . -o awh-extension.ablx` built cleanly. Dragged
      into Settings → Extensions, Live logged `Installing
      tahazar.ableton-workflow-helper` / `Successfully installed`, and the
      files landed at `~/Library/Application Support/Ableton/
      Extensions/tahazar.ableton-workflow-helper/` (manifest.json +
      dist/main.js, same shape as Ableton's own SDK example manifests: same
      fields, same `minimumApiVersion: "1.0.0"`). The extension never starts:
      no `ExtensionHost.txt` is created, Live's `Log.txt` has nothing beyond
      that install line (no error, no crash), and it is absent from the
      binary `Preferences.cfg`. Ruled out: Developer Mode was on; two full
      Live restarts after install; no enable/disable toggle exists next to it
      in Settings → Extensions (owner confirmed). `awh ping`/`awh status`
      correctly report "gateway unreachable" (no false positive). This looks
      like a limitation in the packaged-install activation path of SDK
      `v1.0.0-beta.1`, distinct from the working dev-mode
      (`extensions-cli run`) path. Not pursued further to avoid blind
      trial-and-error against a real Live install; flagged for the SDK
      vendor/next beta. Dev mode remains the verified path for all real work.

When all boxes tick, M0 is done and M1 (real gateway operations) starts.

## M1 in-Live verification checklist

Unit tests against `FakeLiveBridge` cover the M1 op surface, and the SDK
adapter typechecks against the machine-verified shim. The fake cannot catch
Extension Host runtime quirks (missing globals, transaction timing, param
value scales). Run this once in the Live beta after pulling M1 (an agent
session on the dev machine can drive it, as for M0):

- [x] `pnpm build:extension` + `extensions-cli run` with a throwaway Set open
- [x] `awh status` shows the real Set (tracks/clips/devices with names)
- [x] `awh call clip.create-midi --args '{"target":{"type":"arrangement","trackPath":"track:0","startBeat":128},"lengthBeats":4,"notes":[{"pitch":60,"start":0,"duration":1}]}'`
      → clip appears at bar 33 on the first (MIDI) track; one undo step for
      the create, a second for the notes (documented create-then-configure split)
- [x] `awh call clip.get --args '{"path":"track:0/arr:0"}'` returns the notes
- [x] `awh call track.clear-range` on a range overlapping a clip → truncation
      matches Live's behavior (boundary clips truncated, not deleted)
- [x] `awh call device.insert --args '{"ownerPath":"track:0","name":"EQ Eight"}'`
      then `device.get` → params list with real min/max; `device.param` moves
      a band frequency audibly/visibly
- [x] `awh call track.mixer --args '{"path":"track:0","volume":0.85}'` → note
      the dB the volume slider shows; record raw-value↔dB pairs at 0.0, 0.4,
      0.7, 0.85, 1.0 into `docs/research/mixer-calibration.md` (seed data for
      the dB mapping, M1 follow-up)
- [x] Drum Rack: `drum.pad-note` verified against an existing rack's pad chain.
      `simpler.sample` is still unverified: `device.insert --args
      '{"...","name":"Simpler"}'` fails with a generic "Failed to insert
      device" (the SDK's insert-device callback carries no error detail).
      Unclear whether "Simpler" is the wrong device name string or Live's API
      cannot insert an empty Simpler this way. Needs follow-up research, then
      a freshly inserted (non-destructive) device to test `simpler.sample`
      against.
- [x] Errors: `awh call clip.get --args '{"path":"track:99/slot:0"}'` → clean
      404-style error, no extension crash, nothing in ExtensionHost.txt beyond
      the logged message
- [x] Fix whatever drifts (shim + adapter), commit to the branch, push.
      Found and fixed one: the shim declared a `name` getter on `DrumChain`
      that does not exist on the SDK class (only `receivingNote` does), which
      silently dropped pad names from `set.summary`. See commit history.

## M2 in-Live verification checklist

M2 is mostly SDK-free (notation + CLI + skill) and unit-tested:

- [x] `awh clip create track:<midi>/slot:<empty> <<'EOF' ... EOF` with bar|beat
      notation → clip appears with correct pitches/positions in Live's editor
      (spot-check middle C: notation C3 must land on Live's C3). Confirmed
      visually. track:0 (Splice Bridge) is not a valid target for a musical
      check even though clip.create-midi succeeds against it; used track:3.
- [x] `awh clip read` on a clip written by hand in Live → notation matches
      the piano roll. Confirmed down to per-note velocity: a hand-drawn
      16th-note run had one note visibly quieter in the velocity lane, and
      the notation read it back as `v1` vs `v100` on the rest.
- [x] read → edit notation → `awh clip write` → piano roll updates. Confirmed
      visually (octave transpose + velocity fix on the same clip).
- [x] `awh render track:<audio> --from 0 --to 8` → WAV exists, correct length.
      Rendered track:6 112-120 beats → .aif (Live's configured format, not
      .wav), 3.4286s duration = exactly 8 beats @ 140 BPM.
- [x] Skill: in an agent session in the repo, ask "read the clip at
      track:0/slot:0 and transpose it up a fifth". It should use the awh
      skill (`.claude/skills/awh`), round-trip cleanly, and verify its own
      write (M2 exit criterion). Passed. A fresh agent, given only that
      sentence, found `.claude/skills/awh/SKILL.md` on its own, read the
      seeded C3/E3/G3/C4 clip, wrote back G3/B3/D4/G4 (+7 semitones), and
      verified its write. Re-confirmed independently against the live Set.

## Running the M0 checklist on the Mac

The checklist above is meant to be executed by an agent session (using the
skills in `.claude/skills/`) opened in this repo on the dev machine. Machines
without Live cannot see `vendor/ableton-sdk/` or the running Live beta.

Human-only steps (GUI, ~5 minutes):
- Enable Developer Mode in the Live **beta**: Settings → Extensions.
- Keep the beta open with a throwaway set during verification.
- The right-click "AWH: Hello" check, and installing the packaged `.ablx`
  (drag into Settings → Extensions, restart Live).

Everything else an agent can execute. Kickoff prompt:

> Read `docs/dev-loop.md` and execute the "First-build verification
> checklist": run `pnpm install` and `pnpm setup:sdk`; install the SDK dev
> CLI it prints; fetch the MIT-licensed `aker-dev/ableton-extension-skill` into
> `.claude/skills/` (project-scoped) and use its verified API reference (the
> Extensions SDK is absent from your training data, so do not write SDK calls
> from memory). Diff `packages/extension/types/ableton-sdk-shim.d.ts` against
> the real SDK types in `vendor/ableton-sdk/sdk/package/`, fix the shim and
> every `VERIFY-ON-MACHINE` marker in `packages/extension/src/`, then
> `pnpm build && pnpm test && pnpm build:extension` and start dev mode with
> `extensions-cli run`. Tell me when you need me to click something in Live.
> Verify with `awh ping` and `awh status` against my open set, check
> ExtensionHost.txt for errors, then commit the fixes and push. Never
> commit anything under vendor/ (non-redistributable SDK).

Once those fixes are pushed, machines without Live pull the corrected shim
and continue M1 development against it.

## Design guardrails (from ADR-001/002)

- Only `packages/extension` may import `@ableton-extensions/sdk`.
- Never commit anything under `vendor/ableton-sdk/` (non-redistributable).
- Extension file writes: only `environment.storageDirectory` / `tempDirectory`
  (a stricter OS sandbox is pre-announced).
- One logical operation = one `withinTransaction` (create-then-configure is
  unavoidably two undo steps; document per op).
- No GPL/AGPL code in the tree; GPL tools as subprocesses only.

## M3 in-Live verification checklist

M3 is SDK-free (transforms run in the CLI; writes go through the validated
clip ops), so this is a musical sanity pass, not an API one:

- [x] `awh vary <a real 4/8-bar loop> -n 8 --seed 1 --ops "transpose-scale:degrees=2 humanize"`
      with the Set scale active → 8 named clips in empty slots, in key,
      audibly related to the source. Confirmed: a seeded 4-bar E-minor loop's
      pitches all shifted by exactly +2 scale degrees (E→G, G→B, B→D, A→C),
      humanize jitter on timing/velocity as expected.
- [x] Same command, same seed, after `awh sweep` → identical variations
      (determinism end-to-end). Confirmed byte-for-byte identical across two
      full round-trips through the real Extension Host.
- [x] A rhythm pipeline (`syncopate:probability=0.5 swing:amount=0.7`) on a
      straight drum-rack loop → grooves, and drum pitches (pad notes) survive
      untouched. Confirmed: pitches stayed exactly `{0,1}` (kick/snare) in
      every variation while onsets shifted off the strict quarter-note grid.
- [x] `awh sweep` with the prefix → only the audition clips vanish. Also
      confirmed for arrangement mode (`vary --arrange` + `sweep` covering
      arrangement clips); see below.
- [x] Skill flow: ask an agent session "make me 6 variations of the bass
      loop, more syncopated, keep it in key" → it picks a sensible pipeline,
      runs vary, and says which slots to audition (M3 exit criterion).
      The first attempt failed the intent, not the mechanism: a fresh agent
      hand-composed 6 new basslines via `clip create` instead of running
      `awh vary`. Cause: `SKILL.md`'s "Vary an existing loop" example never
      mentioned `awh vary` and told the agent to hand-produce variations,
      contradicting the dedicated `awh vary` section in the same file. Fixed
      the example and re-ran with a second fresh agent, which ran
      `awh vary ... --ops "syncopate:... humanize"`. Verified independently:
      6 clips, all 16 notes (matching the source, unlike the first attempt's
      16-40 note counts), same pitch set as the source, timing shifted
      off-grid.
- [x] Arrangement-mode `vary --arrange`/`--at-bar` and `sweep` covering the
      arrangement (added post-M3, spec R1's arrangement-first workflow).
      Default placement lands sequentially right after the track's last
      arrangement clip with no overlap (verified via the API and visually in
      Arrangement view), and `sweep` removes exactly the swept clips without
      touching real content.

## M4 in-Live verification checklist

SDK-free (renders through validated clip ops); a musical + safety pass:

- [x] `awh sections plan --form house --role drums=<real loop> --role bass=<real loop> -o plan.yaml`
      → YAML reads sensibly; edit a section's bars/ops. Confirmed: house preset
      is 128 bars (16/16/32/16/8/32/8), edited breakdown 16→8 bars cleanly.
- [x] `awh sections apply plan.yaml --dry-run` → clip list matches the plan.
      Confirmed: 12 clips, correct cumulative bar positions reflecting the
      edit.
- [x] apply on an empty arrangement span → skeleton appears; play through:
      intro is thinned, builds ramp, drops hit full, sections named on timeline.
      Confirmed via the API (positions/spans byte-accurate: bar N = beat
      (N-1)×4) and note density (intro/breakdown thinned, drops full, bass
      "off" sections skipped).
- [x] Re-apply same plan+seed at a different --at-bar → identical material.
      Confirmed byte-for-byte identical (both tracks, all clips) across two
      full apply round-trips through the real Extension Host.
- [x] Safety: apply over existing clips without --clear → refuses with the
      clear/at-bar hint; with --clear → span cleared then written. Confirmed
      both: clean refusal with zero partial writes, then `--clear` replaced
      the span (verified via different random-seed content, not a duplicate
      write).
- [x] Skill: ask an agent session "build me a house skeleton from my drum and
      bass loops" → it plans, shows the YAML, dry-runs, applies (M4 exit
      criterion). The first attempt again failed the intent, not the
      mechanism: a fresh agent bypassed `awh sections` and hand-wrote a
      skeleton onto two real tracks via `clip create`/`clip write`. Same root
      cause as M3: `SKILL.md`'s "Typical flows" had an entry for varying
      loops but none for building a skeleton, although `awh sections` is a
      documented feature. Nothing pre-existing was destroyed (it filled an
      empty placeholder and used empty timeline space), but there was no plan
      shown, no dry-run, and no `awh sections`. Removed that content, added a
      "Build an arrangement/skeleton from loops" flow entry to SKILL.md, and
      re-ran with a second fresh agent: it ran `awh sections plan
      --form house` → `apply --seed 42` and produced the full 128-bar
      skeleton with the tool's naming convention (`intro-drums`,
      `drop1-drums`, …). Verified independently against the live Set
      (positions, note density, in-scale pitches).

## B3 (library) + B3d (.alc mirror) verification checklist

Library round-trip (SDK-free, validated clip ops underneath):

- [x] `awh save <a real clip> --category hats --tags <...>` → markdown entry
      appears under `library/clips/hats/`, INDEX.md regenerated, bpm/scale
      context captured from the Set. Confirmed, including a false alarm: the
      captured scale looked wrong against stale memory of an earlier run, but
      the Set's active scale had changed since then.
- [x] `awh lib list` / `awh lib show <slug>` → entry reads sensibly. Confirmed.
- [x] `awh lib place <slug> <empty slot or --at-bar>` → clip lands in Live and
      sounds identical to the saved source. Confirmed byte-identical.
- [x] Skill: "save that hat loop for later" then, in a new Set, "place my
      garage hats" → the agent captures/places via the library, citing
      slug+tier. The save half passed first try. The place half found a gap:
      two fresh agents, asked to place into a Set full of pre-blocked empty
      placeholder clips, both hand-tiled the entry into an existing
      placeholder via `clip write` instead of `lib place`, because `lib
      place` could not do that (it only called `clip.create-midi`, so
      targeting an occupied slot/position would have errored or duplicated).
      Extended `lib place` to fill an existing clip at the target
      (tile/truncate to its length), reusing the tested `tileNotes` from the
      M4 sections renderer. A third fresh agent then used `lib place`
      directly. Verified independently against the live Set.

.alc mirror (new Live-facing ground; take it slowly):

- [x] Golden template: in Live 12, put one MIDI clip (a few notes) on a
      device-free track, drag it into the User Library, then
      `awh lib capture-template "<User Library>/Clips/<name>.alc"` →
      reports Live's real Creator string + note schema. Confirmed: "Ableton
      Live 12.4.5b11", schema Time/Duration/Velocity/OffVelocity/NoteId.
- [x] `awh lib export-alc` → `live-mirror/AWH Library/` appears with
      `<category>/<slug>.alc` files + `Ableton Folder Info/`. Confirmed.
- [x] Drag the `AWH Library` folder into Live's Places → clips browse, preview
      (double-click), and drag into a track; notes/length/name all correct.
      Confirmed. The browser preview plays Live's generic default sound, not
      the owner's instrument, by design: the golden template is captured
      device-free so no instrument rides along in every export. Dragged onto
      the Drum Rack track it sounds correct.
- [x] Tags: browser Filter view shows an `AWH` group with your categories
      (+ `AWH Tags`) after Live indexes the pack. Confirmed.
- [x] Re-export after editing an entry (`--overwrite` save or hand-edit) →
      without re-dragging, Live picks up the change (PackRevision bump; may
      need a moment or a browser rescan; note which). Content edits
      auto-update with no rescan (confirmed: added a bar to a saved clip,
      re-exported, Live showed the new version immediately). Full removal
      differs. Found and fixed a bug: when the library (or a `--category`
      slice) became empty, `export-alc` threw "No MIDI library clips to
      export" and returned before calling `writePack`, leaving stale `.alc`
      files in Live's browser. It now proceeds with 0 items, and `writePack`'s
      wipe-stale-content logic clears the pack (verified on disk). Live's
      browser still showed the stale clip after the fix, even after a manual
      rescan. This is a Live-side caching limitation (the files are gone on
      disk); deletions apparently need more than a folder rescan to clear
      from Live's browser cache (possibly a full library rebuild; not chased
      further).
- [x] Reverse: drag a new clip from a Set into the User Library by hand, then
      `awh lib import-alc <that file> --category <c>` → entry matches the
      clip. Confirmed (3 notes, matching the golden-template capture step's
      note count for the same file).
- [x] Safety spot-check: `live-mirror/` is gitignored; nothing outside it was
      touched; `library/mirror.json` revision incremented. Confirmed.

## M5 (drums) in-Live verification checklist

- [x] `awh drums gen <drum-rack track> --style house --bars 4` into an empty
      slot → pads mapped to sensible roles (kick/clap/hats), pattern grooves.
      Confirmed: kick (pad note 0) four-on-the-floor, snare (pad note 1) on
      the backbeat, mapped from the real pad names.
- [x] `--style techno` and `--style trap` → idiomatic (trap: beat-3 snare,
      hat rolls); different `--seed` → different ghost placement. Techno:
      driving kick plus low-velocity/low-probability ghost kicks (rolling
      feel). Trap: snare locked to beat 3 every bar; `--variant` forces a
      named kick cell (reports which it picked, e.g. "kickCell: rolling ·
      hatBase: straight-8ths"); without a forced variant, different seeds
      pick different cells/hat bases (sparse, double-tap, etc.), giving
      different grooves rather than ghost jitter alone.
- [x] Track without a drum rack → GM fallback notes, warning printed.
      Confirmed: correct GM note numbers (36 kick, 38 snare, 39 clap, 42/46
      closed/open hi-hat), warning text printed as documented.
- [x] `awh drums fill <clip>` → last bar gets a fill, crescendos into the loop.
      Confirmed: bars 1-3 untouched, bar 4 becomes a 16th-note roll with a
      velocity crescendo (60→115) into the loop restart.
- [x] `awh drums humanize <clip>` → kick stays tight, hats loosen; still
      grooves. Confirmed on a kick+snare rack (no separate hats pad): snare
      timing deviation averaged ~2x the kick's (0.0054 vs 0.0030 beats), so
      role-aware behavior generalizes without a dedicated hats role.
- [x] `awh drums vary <clip>` → recognizably the same pattern, reworked.
      Confirmed: all 16 kick-hit positions identical across the source and
      4 variations (kick anchor preserved); note counts shifted slightly
      (24→26/26/25/25) as the non-kick elements were reworked.
- [x] Skill: "give me a darker techno groove on my drum rack" → gen + audition
      loop works end to end. Passed. A fresh agent ran
      `drums gen --style techno --density 0.35` (reading "darker" as
      sparse/no-snare) followed by `drums humanize` across both active
      drum-rack tracks, and declined to touch a third track whose only pad
      looked like a mislabeled leftover. Verified independently: kick-only
      four-on-the-floor (16 notes, no snare) and off-beat 8th-note hats, both
      humanized.

## M6 (analysis engine) setup + verification checklist

One-time setup (dev machine):

```sh
python3 -m venv .venv
.venv/bin/pip install numpy scipy soundfile pyloudnorm pytest
cd analysis && ../.venv/bin/pytest -q && cd ..   # engine self-test
```

B1 (`awh clip from-audio`) needs one more one-time step: Basic Pitch on the
ONNX backend (not TensorFlow). `analysis/README.md` explains why a plain
`pip install basic-pitch` is wrong here (unconditional TF pull on Linux) and
has the full license audit. Short version:

```sh
.venv/bin/pip install "basic-pitch==0.4.0" --no-deps
.venv/bin/pip install onnxruntime librosa "mir_eval>=0.6" "pretty_midi>=0.2.9" \
    "resampy>=0.2.2,<0.4.3" scikit-learn typing_extensions
```

M4L capture tap: follow `m4l/README.md` (Max Audio Effect on the master,
paste/build the patch, save). Suite includes Max.

- [x] `awh mix report <any exported wav/aiff> --bpm <tempo>` → LUFS/dBTP/PSR
      match a trusted meter (Live's own LUFS meter, Youlean, etc.) within
      ~0.5 LU / 0.3 dB; findings read sensibly and quote real numbers.
      Confirmed against a real render (Kick & Snare bounce, MF Gabhru
      project), owner-checked against Live's meter, within tolerance.
- [x] `awh mix target <2-3 reference tracks> --save house` →
      `library/targets/house.json` appears; `report --target house` adds
      per-band deltas that match what your ears/eyes say about the balance.
      Confirmed mechanically (one reference track; genre-tag naming caught
      and corrected, see below). Per-band deltas made sense: an isolated drum
      stem showed large low/high-end deviations against a full mixed master
      reference, as expected for a non-full-mix source.
      Naming gotcha: the reference was saved under `--save house`, but the
      reference track and the project are both trap. Renamed
      `library/targets/house.json` → `trap.json`. `--save <name>` does not
      validate the name against the reference's genre, so mislabeling is easy.
- [x] Capture tap: device loads with no Max errors; `awh mix capture
      --from-bar X --bars 4 -o /tmp/cap.wav` loops the right span, records,
      stops; the file plays back as the mixdown. Confirmed. Built the device
      by drag/paste per `m4l/README.md` (File→Open did not appear in the menu
      for the owner; Cmd+O and drag-and-drop both worked). It captures
      whatever is playing (solo state included) and was used for the rest of
      this checklist.
- [x] `awh mix ab <before> <after>` on a deliberate change (e.g. +3 dB shelf)
      → the band deltas show the change and only the change (loudness match
      working: overall LUFS delta ≈ 0). Took two corrections to test cleanly:
      (1) the first attempt targeted an EQ8 band configured as a Low Pass
      filter, where Gain does nothing, so a High Shelf band was used instead;
      (2) a +3dB change on one track was too diluted across 40+ simultaneous
      tracks to show a clear delta, so the target track was soloed for an
      isolated A/B. Once isolated: `lufs_integrated` delta ≈ 0.00, and the
      only flagged finding was `band_change_15849hz: +3.0 dB`, the boosted
      shelf frequency. Also found a master-bus clipper (GClip) before the
      capture tap that can absorb small gain changes; bypassed it for the
      test and restored it after.
- [x] Pump: on a sidechained loop, report `--bpm` shows depth/alignment;
      break the sidechain → report reflects it. Found a limitation rather
      than a simple bug. On sidechained content (BASS/SAMPLES ducked by a
      MIDI-triggered compressor), `pump_misalign_full/low` fired at ~228ms
      offset from the beat grid. Disabling the sidechain device and
      re-capturing the same span still showed ~218ms. A 10ms difference,
      where the finding should have changed meaningfully or disappeared.
      Root cause (in `analysis/awh_analysis/dynamics.py`): the detector
      measures RMS-envelope periodicity folded over the beat period, which
      cannot distinguish sidechain ducking from a bass/sample note's natural
      decay. Both produce a rhythmic RMS trough near the end of each beat
      cycle on rhythmic material. Needs an algorithmic rework (e.g. comparing
      against a bypassed/reference capture, or detecting a compressor-specific
      release-curve signature). Not attempted; flagged for follow-up.
- [x] Skill: "how's my low end vs my references?" → the agent captures/asks
      for a render, runs report --target, quotes numbers, suggests concrete
      moves. Passed. A fresh agent declined to fabricate a comparison: it
      found the then-mislabeled `house.json` target, reasoned that a house
      profile would be an unfair yardstick for this trap/dhol/tumbi project,
      looked for reference audio, found none it was confident about, and
      asked rather than guessed (the "never invent a number" principle from
      `docs/design/analysis-engine.md`). Completed the loop manually with the
      correctly labeled `trap.json`: per-band findings (25/32/40/50Hz all
      well above target, PSR below the clean-loudness guideline) with
      concrete EQ Eight moves suggested.

## M6 follow-up: `awh mix duck` toolchain (fit/setup/calibrate/measure)

Built in response to the pump-detection lessons above (see
`docs/lessons-learned.md`, `knowledge/setup/sidechain-template.md`): a
trigger-aligned envelope fitter plus a closed-loop stock-Compressor
calibrator, verified live on a purpose-built kick/snare/hat/bassline project.

- [x] `duck fit <kick render> --triggers <beats>` → sensible envelope
      (depth/hold/release + exact Volume Shaper draw points) from a 16-hit
      kick pattern. `--bass <file>` masking-based depth confirmed too
      (clamped to the 3 dB floor on this material).
- [x] `duck setup <track>` → inserts + presets a Compressor (Attack min,
      Ratio max). Found and fixed a bug: every `device.param` call across
      `setup`/`calibrate` (5 call sites) passed `{ path, name, value }`, but
      the op expects `{ path, param, value }`, so each failed with `"param"
      must be a non-empty string`. TypeScript did not catch it because
      `op()`'s args are typed `unknown`. Fixed all 5.
- [x] Manual touches (Sidechain On + Audio From, Release; the SDK has no
      routing/automation API): "Sidechain On" turned out to be a normal
      automatable param despite being listed as a manual touch, so
      `duck setup` could set it directly. "Audio From" is not exposed.
- [x] `duck calibrate` → closed-loop bisection converged in one iteration
      (baseline 0.62 dB natural modulation → probes at 0.25/0.75 raw showed
      16.93/0.00 dB → bisected to raw 0.500 → 3.71 dB against a 3.0 dB
      target, within tolerance). Re-verified independently: read the
      Threshold param back (0.5, correct), captured fresh, and re-measured
      (4.34 dB, same ballpark, normal run-to-run variance).
- [x] Cross-check against the redesigned `pump()` shape classifier (see the
      M6 entry above): on this confirmed-ducking capture, `mix report`
      labeled it `shape: decay-like`. That is a remaining accuracy gap (the
      kick/trigger's own presence dominates the low band on a full-mix
      capture, biasing the shape heuristic). The finding severity is
      `[INFO]` (not a warning), and its text says "a single file cannot prove
      a sidechain is engaged" and points to `mix ab` on/off, so the scoping
      keeps the wrong label from misleading anyone. The purpose-built
      `duck measure`/`duck calibrate` (trigger-aligned, not
      beat-grid-folded) are the reliable path for this template; treat
      `pump_shape_*` as a rough single-file heads-up, not a verdict.

## M6b (masking toolkit) owner checklist

Built (the offline half) in response to the gap report in
`docs/design/analysis-engine.md`'s "Future work: real gaps found doing real
masking/mix analysis (2026-08-23)" section, written after an investigation
that needed throwaway numpy scripts to answer "does my sub compete with my
call/response layers." The offline half is `analysis/tests/test_pitch.py` /
`test_bands.py` (synthetic-signal regression + calibration + negative
controls) and `packages/cli/test/layers.test.ts` (solo-restore proven
against a real gateway, including a negative control on an injected capture
failure). The owner's half is re-running the original question end-to-end
with `awh` only, no scratch numpy, against the project/patches that prompted
this milestone.

Run on 2026-08-23 against the original captures from that masking
investigation (`/tmp/awh-captures/solo-{sub,reese,call}.wav`, still on disk)
plus a fresh fully-live run on the real Set:

- [x] Re-ran "does my sub compete with my call/response layers" end-to-end
      with `awh mix pitch` / `awh mix bands` only, zero throwaway numpy. It
      matched the original scripts' conclusion and extended it: the original
      investigation characterized Reese's problem as
      fundamental-in-the-scoop-zone (140-200Hz); `mix bands`' calibrated
      table showed Reese also carries 23% of its total signal power in the
      sub band (20-100Hz, -19.0 dBFS, only ~19dB below the pure sub
      reference). That is substantial sub-band competition the original
      investigation did not quantify. Follow-up: that sub-band content in
      Reese is presumably unwanted (a clean sub should not need low end from
      a "Reese" layer); consider a highpass on Reese below ~100Hz.
- [x] `awh mix pitch` on the growl/reese patch that fooled the naive picker
      live (`solo-reese.wav`, not the synthetic fixture). Works as designed:
      f0 174.4 Hz -> F3 (the track's key root, F Phrygian), with low
      voiced%/confidence (12%/0.11 on the whole-file average) reflecting that
      a wide detuned Reese has messy periodicity. `--per-note`
      (onset-segmented) gave much cleaner sustained-note reads (100% voiced
      on isolated held notes), and the harmonic-dominance flag fired
      repeatedly: "harmonic 5 exceeds the fundamental by 25-35 dB" on
      sustained notes. This is the live-caught failure mode (a naive
      FFT-peak-pick would report the loud 5th harmonic as the pitch), now
      named explicitly.
- [x] `awh mix bands` on real captures (sub/reese/call). Calibrated dBFS +
      `fraction_of_total` matched the ears and the original scratch-script
      numbers, and are calibrated (absolute dBFS referenced to a full-scale
      sine, unlike the earlier tool's uncalibrated relative numbers), which
      closes that gap from the original feedback. Default zones
      (sub/low/scoop zone/low-mid/mid) matched this project's danger
      frequencies without `--bands` overrides.
- [x] `awh mix layers track:8 track:7 track:6 --from-bar 21 --bars 4` on the
      live Set (9 Sub / Reese Response / Lead Call, the three tracks from the
      original investigation): automated solo→capture→unsolo, no manual
      clicking. Found a reliability gap. The first two attempts each aborted
      with `<file> was not created` at a different track position (2nd track
      once, 3rd track once), although `captureSpan` already has the 400ms
      settle-delay fix from the `duck calibrate` race condition.
      `runLayers` reuses `captureSpan`, so this looks like an intermittent
      race specific to rapid back-to-back record cycles through the same
      `sfrecord~` (three solo-swap+full-record cycles in quick succession)
      rather than a single-capture issue. The third attempt succeeded
      end-to-end, and its numbers closely matched both the archived
      captures and the aborted runs' partial captures. Results are
      trustworthy when it completes; this is a reliability/retry issue, not
      a correctness one. The solo-restore guarantee held in all three
      attempts, including both failures: `set.summary` after each run
      showed zero tracks stuck soloed, live-verifying `layers.test.ts`'s
      offline negative control against the real SDK/Live. Follow-up: either
      a longer inter-track settle gap in `runLayers` or a documented "retry
      once if it aborts" note, since a first-time user would read this flake
      as a broken tool.
- [ ] Skill check: ask a fresh agent a masking question in plain language
      ("does my kick fight my 808") and confirm it reaches for `mix pitch`
      / `mix bands` / `mix layers` from the Typical flows entry rather than
      falling back to `mix report`'s spectral tilt (documented as unable to
      answer this) or hand-rolling numpy. Not run yet.

## M4L Ducker owner validation checklist

Not yet verified in Live (built without a running Max/Live instance; see
`m4l/README.md`'s "AWH Ducker" section for the protocol, install steps, and
manual-patching fallback). Run this before trusting the device on a real
project.

Code-side pre-check (everything possible without opening Max):
`m4l/AWH Ducker.maxpat` parses as valid JSON (77 boxes) and is structurally
coherent: `udpreceive 9722` → `route` on the 4 OSC addresses → parameter
storage (`value` objects) → a `loadbang`/`live.path live_set`/`live.object`
combo reading `current_song_time`/`is_playing` → a `metro 1` poll comparing
beat-modulo position against the trigger list (`expr fmod(...)`,
`uzi`/`zl nth`) → envelope generation (`pack`/`line~`) → `dbtoa` (correct
for the "positive dB of gain reduction" wire convention) → `plugin~` → two
gain-multiply stages → `plugout~`. This cannot confirm it runs correctly in
Max, only that nothing is malformed at the object/JSON level.

The OSC push side (`awh mix duck push`, `duck.ts`) was verified
independently against a separate UDP listener (not the shipped
`duck.test.ts` fixture): correct ping→pong handshake, correct message order
and exact arg values for a full push (triggers/shape/on) and for `--off`
(ping + on-0 only). `packages/cli/test/duck.test.ts`'s negative control (no
listener on the port → clear timeout error, not a hang) was re-run and
confirmed. The wire protocol is solid; everything below needs the real Max
device.

An in-Live debugging run was marked failed and deferred to a later full
device overhaul. Findings, so that work does not restart from zero:

- OSC handshake confirmed live: `awh mix duck push --off` and a full shaped
  push (`--depth 18 --release 300 --attack 1 --hold 40
  --trigger-clip track:24/arr:0`, exaggerated for an unmistakable test) both
  replied correctly, and `device.get` showed `Device On: 1` throughout. The
  OSC wire reaches the device.
- The `current_song_time` units hypothesis flagged in `m4l/README.md` is
  disproven. A diagnostic tap (`flonum`/`number` wired to `route
  current_song_time is_playing`'s two outlets; the shipped patch had no such
  tap though it was described as needing one) showed the value climbing
  128→192 during playback, an exact match to the Trigger clip's absolute
  arrangement position in beats (the clip sits at beats 128-192).
  `is_playing` read `1` throughout. `current_song_time` is in beats, as the
  patch assumes. The "no audible duck" bug is not a units problem; it is in
  the trigger-matching/envelope-firing logic downstream of a working
  transport read.
- Reproducible Max gotcha, partially mitigated: the patch's `live.path
  live_set` → `live.object` binding is driven by `loadbang`
  (`obj-29`→`obj-30`→`obj-31`'s "set" inlet), and `loadbang` only fires on
  a patch/device load, never on a paste into an already-open device window.
  Every "select-all, paste the updated patch over the existing device"
  reload (the only workable workflow while the device is not frozen to
  `.amxd`) left `live.object` without a valid reference, producing a `get:
  no valid object set` Max console error on every later `get
  current_song_time`/`get is_playing` call, even though an earlier, still-warm
  instance had been reading correctly moments before a "clean" reload.
  Mitigation added to `m4l/AWH Ducker.maxpat`: a manual `bang` button wired
  into `live.path live_set`'s inlet, labeled "MANUAL RE-INIT — click after
  any reload/paste," so a paste-based reload can be re-armed without
  removing/reinserting the device. Clicking it did not clear the error in
  the one attempt made before the run stopped. The cause of that residual
  failure is unresolved (possibly the click was not received while the
  window was in edit mode, possibly something else was already broken by
  then; not distinguished).
- Two more diagnostic taps added, never read cleanly:
  `print AWH-trigger-fired` on the trigger-match `sel 1`'s match outlet
  (`obj-63`), and `print AWH-envelope-target` on the constructed ramp
  message feeding `line~` (`obj-72`). These would show whether a trigger is
  ever recognized, and what envelope values are computed when it is. They
  are the next diagnostic step once the `live.object` binding is reliably
  valid.
- Operational finding, not root-caused: mid-run, the AWH extension host
  process died (not hung: `ps aux` showed no `ExtensionHost` process,
  nothing listening on port 8720) while testing the Ducker. Separately,
  Max's editor became slow enough to stall the whole machine just opening
  it, on a machine that was otherwise healthy (`fseventsd`/Spotlight/Time
  Machine checks earlier in the run ruled those out). Not distinguished:
  the M4L device in a runaway/feedback state (the patch's `metro 1` polls
  `live.object` 1000 times/second by design, a rate never revisited),
  accumulated duplicate objects from repeated paste-based reloads, or
  something else. Confirmed and reproducible: after any Live restart, the
  `awh` gateway stays unreachable until `extensions-cli run --live
  "/Applications/Ableton Live 12 Beta.app"` is re-run by hand. This matches
  the existing Troubleshooting note ("Restarted Live? Restart
  `extensions-cli` too"); not new, but it bit this run too.
- "Bass/samples went silent" scare, resolved, not a lasting bug: after the
  manual re-init attempt, BASS/SAMPLES (routed through the Sidechain bus;
  `awh status` showed their mute flags `false` throughout, so not a track
  mute) became inaudible while DRUMS (routed straight to Master, bypassing
  Sidechain) stayed audible. Consistent with the Ducker's runtime gain state
  getting stuck crushed rather than a routing change. A full Live restart
  resolved it (M4L device runtime state resets with the host); confirmed by
  ear post-restart with nothing re-pushed. Not investigated further since
  the device is deferred.
- Recommendation for the next attempt: given the accumulated complexity (a
  Max gotcha, an unresolved SDK-level error, and two reproducible but
  uncaused stability incidents in one sitting), consider a ground-up
  rebuild of the trigger-detection chain rather than more incremental
  debugging of the existing ~30-object state machine (`obj-38` through
  `obj-73`). It never ran successfully end-to-end. Test any future reload
  via a fresh device insert (remove + re-add on the Sidechain track) rather
  than paste-over, to sidestep the `loadbang`-on-paste gotcha. The
  diagnostic taps and manual re-init button are committed and available to
  build on.

- [ ] `m4l/AWH Ducker.maxpat` opens/pastes cleanly in Max on the Sidechain
      track (between `plugin~`/`plugout~`) without validator errors. If not,
      hand-build from the manual build table in `m4l/README.md`.
- [ ] `awh mix duck push --off` (no shape/triggers pushed yet) → device
      replies to ping, gain confirmed at unity by ear/meter.
- [ ] `awh mix duck fit <drums> --trigger-clip <Trigger clip> --json >
      fit.json` then `awh mix duck push --fit fit.json --trigger-clip
      <Trigger clip>` → summary prints the right trigger count/pattern
      length/shape; audibly ducks in time with the kick, not late/early.
- [ ] Transport-stopped behavior: stop playback mid-duck → gain returns to
      unity and stays there (no dangling dip, no runaway retriggering).
- [ ] Loop-wrap behavior: let the Trigger pattern's arrangement loop wrap
      → no spurious envelope fires at the wrap point.
- [ ] Retrigger-while-releasing: two triggers closer together than the
      release time → the second restarts the dip from wherever the gain
      currently is, matching ShaperBox's behavior.
- [ ] `awh mix duck push` with an empty Trigger clip → prints the no-op
      message and sends nothing (confirm via `awh mix duck push --off`
      immediately after still replying normally).
- [ ] `awh mix duck measure <captured Sidechain bus> --trigger-clip ...`
      on a pushed capture → achieved depth is in the same ballpark as the
      pushed `depthDb` (some loss against the programmed value is expected;
      a near-zero achieved depth means something is wrong).
- [ ] `current_song_time` assumption (flagged in `m4l/README.md`): confirm
      the LOM property is in beats as assumed. If the duck fires at the
      wrong rate relative to the pattern, check this first, per the README's
      flagged deviation.
- [ ] Freeze to `AWH Ducker.amxd` and reload in a new Live Set → still
      responds on 9722/9723 without re-patching.

## Troubleshooting

- **Restarted Live? Restart `extensions-cli` too.** A stale extension-host
  connection keeps answering `awh ping` while every real operation hangs or
  fails with generic SDK errors. If ops hang after a Live restart, kill and
  rerun `extensions-cli run` before debugging anything else.
- Always pass `--storage-directory`/`--temp-directory` when restarting
  `extensions-cli`. Without them the gateway starts and normal ops
  (status/clip read/write) work, but any right-click library capture fails
  silently from the owner's view (the menu action appears and does nothing
  visible). The error (`BridgeError: no storageDirectory — cannot buffer
  captures`) only shows in `extensions-cli`'s stdout, not
  `ExtensionHost.txt`. Full command:
  `extensions-cli run --live "<Live.app path>" --storage-directory
  packages/extension/.dev/storage --temp-directory
  packages/extension/.dev/temp`.
- Small A/B gain changes not showing up in `awh mix ab`? Check for clip/
  limiter utilities (GClip etc.) before the capture tap; bypass them or move
  the tap after.

## Definition of done (see docs/lessons-learned.md)

A new `awh` command is not done until: (1) SKILL.md's Typical Flows names it
for its natural request; (2) a negative-control test inverts its detection
claim against synthetic fixtures; (3) its behavior for occupied-but-empty
targets is decided and tested; (4) gateway ops it calls from more than one
site go through typed wrappers (op() args are unknown, so wrong field names
only fail at runtime in Live); (5) its zero-item path still runs cleanup/
sync side effects.

## Duck toolkit (`awh mix duck`) verification checklist

This test project uses the automatic Compressor strategy (no ShaperBox
device installed), so the ShaperBox drawing/proof-loop items below need a
project with that plugin. The `--trigger-clip` code path (until then only
verified via manual `--triggers <beats>`) is confirmed end-to-end; one bug
was found and fixed along the way.

- [x] Capture the Drums bus over 4-8 bars starting on the Trigger pattern's
      boundary; `awh mix duck fit <capture> --trigger-clip <Trigger clip>` →
      body/tail times look plausible against the waveform. Confirmed: built
      a MIDI Trigger clip (8 hits/4 bars) since this project's Kick/Snare
      are audio one-shots, not a MIDI-driven rack; `--trigger-clip` deduped
      12 notes to 8 unique starts and produced a plausible envelope (body
      572ms, release 211ms, recovered by 78% of the gap).
- [ ] Draw the printed points in Volume Shaper (depth/hold/exponential
      release) → bass audibly locks to the kick without pumping artifacts.
      Not applicable to this project (no ShaperBox device); needs a Set using
      the owner's ShaperBox template.
- [x] `--bass <bass capture>` → masking-based depth differs sensibly from
      the default 6 dB (the code's `DEFAULT_DEPTH_DB` is 6.0, matching the
      "6 dB default depth" commit). Confirmed via `--trigger-clip` +
      `--bass <bassline render>`: masking dropped the recommendation to
      3.0 dB (bass low-band RMS -14.9 dB vs kick peak -5.6 dB, margin 6 dB),
      the documented 3 dB floor.
- [ ] Proof loop: capture sidechain bus with the drawn envelope on vs
      Device On -> 0, `awh mix ab` → depth delta ≈ the drawn depth. Not
      applicable here (ShaperBox-specific); the Compressor-strategy
      equivalent is `duck calibrate`'s bypassed-baseline step, confirmed
      below.

Automatic (compressor) strategy:

- [x] `awh mix duck setup <Sidechain track>` → Compressor appears, Attack
      fastest / Ratio max set; do the two printed manual touches. Still
      configured from the earlier run (Attack raw 0, Ratio raw 1 = max);
      re-confirmed via `device.get`.
- [x] Tap on the Sidechain bus: `awh mix duck calibrate <devicePath>
      --target-depth <fit depth> --trigger-clip <Trigger> --from-bar X
      --bars 4` → baseline + probes + iterations print sensibly; final
      achieved depth within tolerance; Threshold left at the calibrated raw.
      Found and fixed a race condition: `captureSpan` (shared by `calibrate`
      and `mix capture`) fired `/awh/stop` over OSC, then immediately checked
      `existsSync` and returned. `sfrecord~` has no completion ack, so an
      immediate read sometimes hit a file whose WAV header still reported 0
      frames (`selection is 0.000s` analysis failures on files that were
      valid moments later). `mix capture` also had its own copy of this
      loop-record-stop logic instead of reusing `captureSpan`. Fixed both:
      a 400ms settle delay in `captureSpan`, and `mix capture` now calls it
      directly. Re-ran clean: baseline 1.19 dB -> probes -> 4 iterations ->
      converged to Threshold=0.438 -> 5.34 dB (target 6 ±1).
- [x] `awh mix duck measure <fresh Sidechain capture>` ≈ the calibrated
      depth; A/B by ear vs the ShaperBox curve on the same material (the A/B
      part is N/A, no ShaperBox here). Confirmed: fresh `mix capture` +
      `duck measure --trigger-clip` -> 6.86 dB, trough at 20ms
      (trigger-locked, matching the "no attack-detection latency" template
      fact), 8/8 triggers used. Same ballpark as the calibrated 5.34 dB
      (normal run-to-run variance, consistent with the M6 follow-up pass).
- [x] Record the Compressor's raw<->display mappings seen during this pass
      (Threshold/Ratio/Attack/Release) into knowledge/ for later reference.
      Confirmed: the owner read Live's UI at the calibrated raw values:
      Threshold raw 0.5 -> -14.0 dB, Ratio raw 1.0 -> inf:1, Attack raw 0.0
      -> 0.01 ms, Release raw ~0.157 -> 30.0 ms. Recorded as
      `knowledge/setup/compressor-raw-display-mapping.md` (tier verified,
      caveated as a single-point snapshot, not an assumed-linear curve) and
      picked up by `awh kb index`.

## B4 (knowledge base) verification checklist

- [x] `awh kb list` / `kb topics` / `kb show sidechain-template` → the setup
      entry reads back; `kb index` → INDEX.md includes your saved mix-report
      records with real numbers. Confirmed: rendered a real span, `mix report
      --save` produced a record, `kb index` picked it up with real LUFS/tilt
      numbers under a new "measurements" section; test record removed after.
- [x] `awh kb new <topic> <slug>` with a brand-new topic name → directory
      appears, entry validates, index picks the topic up (open-domain check).
      Confirmed: `mixing/glue-comp` (a new topic) appeared as a directory and
      `kb topics` discovered it with no hardcoded list anywhere. Cleaned up
      after.
- [x] `awh distill -o /tmp/distill.md` on a real project → structure +
      notations complete enough to curate from. Confirmed: full track/device
      list plus every MIDI clip's bar|beat notation, including material
      written live (the Lead Melody's varied second half read back
      correctly).
- [x] Data-driven drum style: `awh drums gen <track> --style hybrid-trap`
      (the shipped draft entry) → generates via the knowledge spec, prints
      the entry tier; edit the entry's YAML (e.g. a kick cell) → next gen
      reflects it with no rebuild. Confirmed via `awh serve-fake` (this
      project has no MIDI drum-rack track to target live): reported
      `knowledgeStyle: drum-style-hybrid-trap [draft]`, picked the
      `dragged-boom` cell; edited `rollDensity` 0.7→0.05 in the entry's YAML
      with no build step, regenerated with the same seed, note count changed
      (87→85), so it is read live off disk, not cached. Reverted the edit.
- [x] Skill: "what do we know about my sidechain setup?" → fresh agent
      retrieves + cites the entry with tier; "remember this hat trick" →
      creates a draft entry with an Executable section. Both passed with two
      independent context-free agents. The first found `knowledge/INDEX.md`
      unprompted, cited `setup/sidechain-template [verified]`, and excluded
      the one unrelated `draft` entry from its factual answer. The second
      used `awh kb new` (not a hand-written file), filled an Executable
      pipeline section, tiered it `draft`, and ran `kb index`: the
      documented capture flow.
- [x] Seeding: request one real distillation ("distill common UK garage hat
      tropes") → sourced entries with citations arrive as a reviewable PR.
      Confirmed: a seeding batch landed (17 new `sourced`-tier entries:
      Burial 2-step/garage, Fred Again production, Isoxo trap snare design,
      call-response/drop arrangement grammar incl. an artist study of Lyny),
      each with citation URLs and an executable pipeline/spec section (only
      the pre-existing `sidechain-template` remains prose-only, unrelated to
      this batch). Spot-checked `rhythm/burial-swing-feel`: well-cited, and
      states that its swing/humanize numbers are "an approximation... not a
      sourced measurement of his actual displacement" rather than inventing
      precision, matching the "never invent a number" rule from M6.
      `pnpm test` (169 tests) and `kb index` both clean against the full
      18-entry store.

## M8 (reference deconstruction) verification checklist

Verified against a commercial track (Viperactive, "Dead To Me", a dubstep
reference already on the owner's disk, industry-standard 140 BPM
convention) plus the owner's unreleased material for the ambiguity case:

- [x] `awh ref analyze <a real house/techno reference>` → BPM matches the
      known tempo ±0.1; sections read sensibly against your ears (drops
      where drops are); evidence strings quote real numbers. Confirmed:
      139.99981822 BPM detected vs. dubstep's near-universal 140 BPM
      convention. Section rules did miss the real drop (the bar 16→17
      full-band jump is ~2.6 dB, just under the 3 dB threshold) and a
      ~16-bar mid-track dip (bars 49-64, likely a breakdown); both landed in
      one unlabeled 80-bar "section" bucket instead of being named. This is
      the intended failure behavior (refuse to guess past a borderline
      threshold rather than mislabel), not a bug, but it is an accuracy gap:
      the 3 dB drop threshold is tight enough to miss audible drops on
      borderline material.
- [x] A trap/half-time reference → bpm or its runner-up is right and the
      ambiguity note appears (not silently wrong). Confirmed two ways:
      (1) the same Dead To Me analysis surfaced the runner-up at 69.99990911
      BPM (exactly half, the classic dubstep half-time read), with an
      explicit note ("ambiguous between 140.0 and 70.0 ... reported 140.0,
      runner-up scores 102% of the winner"). (2) An ambiguous file (the
      owner's unreleased "listen!" reference) returned `bpm_confidence: 0.0`
      (exactly zero: the winning candidate did not beat the best
      non-harmonic peer) with a harmonic runner-up. Correctly uncertain
      rather than confidently wrong, though this file's true tempo could not
      be verified (owner did not know it; no playback/tap-tempo available).
- [x] `awh ref sections apply <analysis>` → "Sections" track appears with
      named empty clips spanning the right bars; refuses re-apply without
      --clear. Confirmed: created a new `[midi] Sections` track (did not
      hijack an existing track; indices shifted correctly for everything
      after it) with 3 correctly spanning marker clips; re-running `apply`
      on the same track without `--clear` refused, protecting the
      pre-existing (owner-corrected) 8 clips.
- [x] Correct the map by hand (drag a boundary, rename a section) →
      `awh ref sections read` returns your corrected bars/names. Confirmed
      with a substantial owner correction: 3 auto sections -> 8
      hand-split/renamed sections with non-canonical names ("build up 1",
      "post drop", "bridge 2"), all read back verbatim (lenient parsing:
      unknown names are not forced into a fixed vocabulary).
- [x] `--save` → library/references/<name>.json exists; `kb index` lists it.
      Confirmed. Found and fixed a gap: the correction loop never closed.
      `ref sections read` only wrote a bare `{trackPath, sections}` shape to
      an arbitrary file, with no command to get the correction into the
      richer `library/references/*.json` record (which also holds
      bpm/arc/etc), so downstream consumers only saw the stale 3-section
      auto-draft. Added `ref sections read --save <name>` to merge the
      correction into `reference.sections` in place; verified the rest of
      the record (bpm, 103-bar arc) stayed untouched and `kb index` picked
      up the corrected section count (3 -> 8).
- [x] Skill: "map out this reference and build me a matching skeleton" →
      analyze -> apply -> (you correct) -> read -> a sections plan whose
      bars match the corrected reference map. Two findings, both fixed:
      (1) SKILL.md had a "## References" section but no "Typical Flows"
      entry, the same recurring gap as M3/M4/B3. Added one up front (after
      three identical prior failures, a first run to re-prove it was
      skipped). (2) `awh sections plan` only supported fixed genre-form
      presets (`--form house|trap`), with no way to shape a plan around a
      reference's custom bar boundaries, although that was the documented
      intent. Added `planFromReferenceSections` (core) + `sections plan
      --from-ref <file>` (mutually exclusive with `--form`, every layer
      verbatim, no genre ops guessed for an arbitrary reference's section
      names). With both fixes, a fresh agent given only the request used
      `awh ref` (found the reference already analyzed+applied+partially
      corrected in the Set, used `ref sections read` rather than
      hand-composing), and refused to build the skeleton because 2 of 8
      sections (intro, outro) were still uncorrected drafts, rather than
      re-running `apply --clear` and destroying the owner's corrections.
      This is the intended "never guess past confidence, never silently
      overwrite real work" behavior. The final leg was completed by hand
      once corrections were in: `sections plan --from-ref` produced an
      8-section plan whose bars (12+4+16+16+12+4+32+8 = 104) sum exactly to
      the corrected reference's bar count.

## Post-M8 hardening checklist

- [x] `awh drums detect-onsets <audio drums capture>` → detected beats match
      the audible hits; `--make-clip` writes a usable Trigger clip.
      Confirmed with an isolated capture: moved the AWH Capture Tap to
      "11 Kick & Snare"'s own chain (post Drum Rack, isolated from
      hats/ride; all four route into the DRUMS bus). The first capture
      against the DRUMS bus gave a confusing 40-onsets-vs-24-notes mismatch
      that turned out to be extra hi-hat content, not a bug. Against the
      isolated 16-bar capture: 23/24 MIDI notes matched within 0.3 beats
      (checked against the clip's note positions via `clip.get`). The one
      miss was the first hit (beat 0, likely clipped by capture-start
      latency), and the only 2 unmatched extra onsets sat at the loop-wrap
      tail. `--make-clip` wrote all 53 detected onsets as a Trigger clip at
      pitch 36 (C1), verified via `clip.get` round-trip.
      Two capture-pipeline gotchas found, not bugs in `detect-onsets`:
      (1) if Live's transport is paused mid-`awh mix capture`, the tool
      cannot tell and writes a file that is silent from the pause onward;
      let a capture run uninterrupted. (2) After a paused/dirty transport
      state, the next capture can come back completely silent even with a
      manual Stop in between. What worked: press Play by hand once
      (confirming audio by ear) immediately before re-running the capture.
      The Capture Tap stays on Kick & Snare's chain (owner: which track it
      sits on does not matter for now).
- [ ] `awh mix duck fit` with deliberately wrong triggers → the misalignment
      warning fires (the silent-nonsense case from the M8 pass is now loud)
- [ ] `awh mix duck setup` → "S/C On"-style param found and enabled
      automatically; only Audio From + Release remain manual
- [ ] Sections likely-tier: re-analyze the commercial dubstep track that hit
      the threshold gap → the ~2.6 dB drop and mid-track dip now appear as
      likely-* sections with shortfall-stating evidence
- [ ] `awh ref analyze --hint-bpm <known tempo>` on the ambiguous unreleased
      reference → hint resolves the 0.0-confidence tie via the runner-up swap

## M7 (scaffolding + harmony) verification checklist

- [x] One-time: copy your real template project folder to
      library/templates/project; write library/templates/scaffold.yaml
      (tempo/tracks/starters/chords). Done: the owner's "VR Sidechain
      Template.als" (140 BPM; MIDI: Kick & Snare/Hats/Serum/Simpler/
      Trigger; audio: Sidechain + 2 unnamed; returns: Reverb/Delay) is at
      `library/templates/project/`. `scaffold.yaml` is minimal
      (`tempo: 140`, empty `tracks`/`starters`, commented-out `chords`
      example). It does not invent starter clips or a default chord
      progression: the library has no curated clips yet, and a go-to
      progression is the owner's creative call.
- [x] `awh new project test-song` → folder + renamed .als; opens in Live
      with your template's devices/routing intact. Confirmed against the
      real template (not the synthetic one): `new project` copied the
      template and renamed it to `test-song.als`; the owner opened it in
      Live and the gateway connected (13 tracks, matching the template's
      layout); devices came through intact: Drum Racks on Kick &
      Snare/Hats, Serum 2, "Stab Big Prog"+EQ Eight on Simpler, ShaperBox 3
      on Sidechain.
- [x] `awh new populate` → tempo set, named tracks appear, starter clips
      placed from the library, chord bed lands in key. Confirmed against the
      `test-song` Set: nudged tempo to 128 then re-ran populate, which set
      it back to 140; added a temporary test track to the scaffold, which
      was created, and a second populate run was idempotent (no duplicate);
      saved a clip to the library and added it as a `starters` entry, which
      was placed into the correct empty slot, skipping the occupied one;
      added a `chords` entry (`i-VI-III-VII`, 8 bars), which landed as
      in-key triads (`D#3+F#3+A#3` etc., D# Minor, matching the Set's active
      scale) on the target track. All temporary scaffold/library test
      entries were reverted/deleted; the committed `scaffold.yaml` stays
      minimal.
- [x] `awh chords track:X/slot:0 --progression "i-VI-III-VII"` in a Set with
      an active scale → chords sound in-key; `--voicing spread` audibly
      widens; `--rhythm offbeat-stabs` gives the house stab; voice leading:
      "I-IV-V-I" moves smoothly (no octave jumps between chords). Confirmed
      via `awh serve-fake`: i-VI-III-VII in A minor and I-IV-V-I in C major
      both produced correct in-scale triads; `--bass`+`--rhythm
      offbeat-stabs` added the low root and placed hits at +0.5 beat with
      reduced velocity; voice leading moved by single-digit semitone totals
      per transition (no octave jumps), holding common tones where chords
      share one.
      Found and fixed a register-drift bug in `--voicing spread`: each
      chord's voice-leading search targeted the previous chord's
      already-spread (lower) pitches rather than its pre-spread close
      voicing, so the progression sank by nearly an octave after the first
      transition and stayed there. `--center` only controlled where the
      first chord landed. Fix: voice-lead against the close-voicing lineage
      and spread only the per-chord output. Re-verified that the failing
      8-chord progression stays anchored around `--center` throughout.
      Added a regression test that fails against the pre-fix code (asserted
      `36 > 36`, the bug's exact boundary) and passes with the fix.
      Reproduced on both a 4- and 8-chord progression.
      Also found a documentation gap (not a bug): roman-numeral case is
      cosmetic. `V`/`v` produce byte-identical pitches, since quality is
      fully scale-derived. So the common i-iv-V-i minor cadence (expecting a
      borrowed major dominant) silently gives the natural-minor diatonic
      (minor) v, with no indication. The major V is available via
      `--key "<root> harmonic-minor"`, but that is non-obvious. Added a
      SKILL.md callout for this idiom, likely the most common minor-key
      request.
- [x] `--key "F minor"` overrides an inactive Set scale; helpful error
      when neither is available. Override half re-confirmed against the
      `test-song` Set (which already had an active scale, D Minor, so it
      could not exercise the "neither available" branch live). The error
      path is code-confirmed, not live-triggered: `resolveKey` in
      `packages/cli/src/index.ts` throws `'the Set has no active scale —
      pass --key "A minor" (or enable the Set scale)'` exactly when `--key`
      is absent and `summary.scale.active` is false (read directly, not
      inferred).
- [x] Skill: "start a new track from my template and put a chord bed down"
      → project -> populate -> chords, citing any KB entries used. The
      mechanics are proven end-to-end above (real template -> real project
      -> real populate with tempo/tracks/starters/chords all landing). A
      fresh agent choosing this command chain from the natural-language
      request alone was not separately exercised, same caveat as the
      equivalent B3b skill item.

## B3b (right-click capture) verification checklist

Bug found and fixed first: `extensions-cli run` needs explicit
`--storage-directory`/`--temp-directory` flags. Without them the gateway
starts (status/clip ops work) but any right-click capture fails silently
from the owner's view: the context menu item appears and does nothing
visible. The error (`BridgeError: no storageDirectory — cannot buffer
captures`) only shows in the `extensions-cli` process's stdout, not
`ExtensionHost.txt` (dev mode logs to the CLI's stdout, not the
Preferences-folder log the Everyday-loop section implies; useful to know
when debugging blind). Always launch with:
`extensions-cli run --live "<Live.app path>" --storage-directory
packages/extension/.dev/storage --temp-directory packages/extension/.dev/temp`.
Anyone restarting the dev bridge (e.g. after a Live restart, per
Troubleshooting) needs these flags every time, not only `--live`.

- [x] Rebuild + reload the extension; right-click a MIDI clip → "AWH: Save
      clip to library" appears and logs a capture. Confirmed live:
      `pnpm build:extension` → fresh `extensions-cli run` (with the storage
      flags above) → right-clicked an arrangement clip ("13 Hats", 64
      notes) → "AWH: Save clip to library" appeared and, once the
      storage-directory bug was fixed, the handler fired and logged
      `[awh] captured "" to the library outbox` (empty name is correct: the
      source clip has no name in Live).
- [x] `awh lib import` → entry lands in clips/inbox/ with notes identical to
      the clip (`awh lib place` it back to verify), bpm/scale context
      captured; second import → "outbox empty". Confirmed end to end:
      capture → `lib import` → `library/clips/inbox/captured-clip.md` (140
      bpm, F Phrygian, 64 notes, correct pitch conversion `pitch:0` →
      `C-2`) → placed into a fresh scene slot → re-read → 64/64 notes
      byte-identical (start/duration/velocity all matched). An immediate
      second `lib import` reported "outbox empty — nothing captured since
      the last import".
- [x] Capture 3 clips before importing → all 3 drain in one import, slug
      collisions get -2/-3 suffixes. Confirmed: captured the same clip twice
      more (to force a collision against the imported `captured-clip`
      slug); one `lib import` call drained both and suffixed them
      `captured-clip-2.md`/`captured-clip-3.md`.
- [ ] Skill: "I saved a couple of clips, pull them in" → import + guided
      naming/tagging/curation. The mechanics (import + curate) are proven
      above; the conversational trigger was not separately exercised.

## Pump v2 (`awh mix pump-check`) verification checklist

- [x] Capture the Sidechain bus with the duck active →
      `awh mix pump-check <capture> --trigger-clip <Trigger>` → verdict
      "ducking", fitted depth ≈ the drawn/calibrated depth, r² ≥ 0.8.
      Verified with an independently generated synthetic signal (separate
      script, not the shipped test fixtures): true depth 8.0 dB/hold 50 ms/
      tau 80 ms → fitted 7.7 dB/39 ms/83 ms, r²=0.99, verdict "ducking" with
      correct evidence. Not yet run against a real Live capture (the
      project with the calibrated Compressor was not open with content);
      that remains the strongest test and is still open.
- [x] Same capture with the duck bypassed → verdict "no-duck" (the on/off
      test that exposed pump v1's 228→218 ms failure). Verified via an
      independently generated retriggered-decay signal (v1's failure case,
      separate script and a different random seed from the shipped tests):
      verdict "no-duck", evidence "minimum lands 91% into the window ...
      still falling at the next trigger", the physical distinction v1 could
      not make. The shipped suite (`test_pumpcheck.py`) reproduces this
      negative control plus a genuine-duck case, a flat/no-modulation case,
      and a below-threshold "inconclusive" case (not falsely claimed either
      way).
- [x] Full-mix capture → the bleed note appears (isolated bus advised).
      Confirmed on the negative-control signal (quiet floor between hits):
      fired "peak-to-tail span is 38.8 dB (> 20 dB) ... isolated ducked bus
      ... is the reliable capture point."

## B1 (audio-to-MIDI, `awh clip from-audio`) owner validation checklist

One-time setup gap found and fixed: `analysis/README.md`'s install command
was incomplete on a fresh venv. `resampy` (a runtime dependency) imports the
deprecated `pkg_resources` API, which is not bundled by default and which
setuptools has started dropping (84.0.0 has no `pkg_resources` at all). A
fresh install failed with `ModuleNotFoundError: No module named
'pkg_resources'` on every transcription call. Added `pip install
"setuptools<81"` as a required install step and documented why. All 7
previously blocked `test_a2m.py` tests (silently skipped, not failing: a
coverage gap of its own) now run and pass.

- [x] Real vocal/hummed take → `awh clip from-audio <recording> track:N` →
      the resulting MIDI clip's melody is recognizably the same shape as the
      recording when played back in Live. No hummed take was available, so
      two substitutes against a live Set were tried: (1) write a known
      melody into an empty MIDI track and render it through the Serum 2/
      OTT/EQ8 chain via the M4L tap, but no capture tap was loaded on this
      project, so instead (2) transcribed a commercial track (Viperactive,
      Dead To Me, rendered directly since it is an audio track): 36 notes
      detected from real audio in ~1.1s wall-clock, low pitch range
      (D#0-C#2) matching the track's quiet intro. A hummed take remains the
      better test of "recognizably the same melody" and is still open.
- [x] `--bpm` omitted → confirm it reads the open Set's real tempo.
      Confirmed: reported "140 BPM" on both transcriptions, matching the
      Set's tempo (not a fake-gateway fallback).
- [x] `--quantize 1/16` (or another grid) on a slightly off-grid human take →
      notes snap to the grid. Confirmed: unquantized starts (1.054, 1.786,
      2.138 beats, ...) vs. `--quantize 1/16` on the same source (1.0, 1.75,
      2.25 beats, ...); every start is a multiple of 0.25 beats.
- [x] Explicit occupied slot target (`track:N/slot:M` with a pre-existing
      clip) → clip is overwritten in place, not duplicated or skipped.
      Confirmed: re-running against the same slot printed "filled existing
      clip", one clip present after, not two.
- [x] Bare track target with no empty session slots → the error message is
      clear and nothing is half-written. Confirmed via `awh serve-fake`
      (filled all 4 slots, 5th attempt): clean
      `"no empty session slot on track:0 — pass an explicit track:N/slot:M
      target"`, no partial write.
- [x] A quiet/silent recording → "no notes detected" prints, exit 0,
      nothing created. Confirmed against the real gateway (a generated
      silent WAV): clean message in both `--dry-run` and a real write
      attempt; `awh status` showed no phantom clip.
- [ ] Skill: "turn this hummed idea into a MIDI clip" → not run yet.
- [ ] Real timing check on a typical 8-16 bar idea: only tested on ~1.5-4s
      clips (all completed in ~1.1s); a real 8-16 bar take's wall-clock is
      still open.

Cleanup note: an overly broad `awh sweep <track> --prefix ""` (empty string
matches every clip name) deleted the project's original empty placeholder
clip on `track:15/arr:0` along with the test content. It was recreated (64
beats, 0 notes, matching the original). `--prefix ""` is not a safe "delete
my test clips" default.

## House-family StyleSpec verification checklist

- [x] Refactor claim ("byte-identical output for the built-ins"): verified
      beyond the frozen-copy regression tests via an isolated git worktree
      at the pre-refactor commit. Generated house + techno patterns across 4
      seeds × 3 densities (24 patterns) with the old and new code and diffed
      byte-for-byte: all 24 identical.
- [x] `awh drums gen --style dusty-garage` (the first shipped house-family
      data style) → generates via the knowledge spec, reports the entry
      tier. Confirmed via `awh serve-fake`:
      `knowledgeStyle: drum-style-dusty-garage [draft]`, correct pad roles
      (four-floor kick, clap-only backbeat, shaker ghosts).
- [x] Hat-grid density flip (the spec's stated "character change" at
      density 0.55): density 0.4 reports `hatBase: offbeat-8ths` (45 hits);
      density 0.7 reports `hatBase: 16ths` (136 hits), matching the spec's
      threshold.
- [x] Live-edit-no-rebuild: edited `ghostChance` 0.7→0.05 in the entry's
      YAML with no build step, regenerated with the same seed; shaker ghost
      count dropped from several to exactly 0. Reverted after.

## M9 (phrase engine, `awh drop`) owner validation checklist

Built + smoke-tested against `awh serve-fake`: call clips written via
`awh clip create`, `drop respond` (real writes + `--dry-run`), `drop phrase`
(two-target and single-target register-split forms, `--bars 8` and `--bars
16`), `--style lyny-flavor` (knowledge path, tier printed), the zero-notes
call case, and the negative control (a call filling its own bar still
produces a WARNING plus a legally rested, non-overlapping response).
`pnpm test` green (core property/regression suite: rest budget, no overlap,
resolve-degree endings, equal-length paired clips, evolution touching only
its claimed side, recipe determinism, parsePhraseSpec typo rejection). The
owner still needs to audition this in Live: synthetic notes prove the
plumbing and the craft rules as coded, not whether the result sounds like a
call-and-response pair.

- [ ] `awh drop respond <a real call clip you wrote/transcribed> <target>`
      on an actual Live Set → the candidate responses read as "talking
      back" to the call when played together (the diagnostic from
      `knowledge/arrangement/call-response-drop-grammar`: solo each
      candidate against the call and listen for an actual rest, not two
      parts running over each other), not only non-overlapping on paper.
      Structural half confirmed against a real Live Set (not serve-fake):
      wrote a call clip (4 notes, tail rest), ran `drop respond` for real
      (not dry-run); all 5 recipes landed in consecutive session slots.
      `echo-low` read back starts well after the call ends (no overlap) and
      transposes into a lower register as its name implies. The listening
      judgment (does it read as "talking back") is still open and needs the
      owner's ears.
- [ ] Same call clip, all five recipes side by side: listening judgment, not
      run yet (all 5 recipes did generate distinct note counts/registers
      structurally, which is necessary but not sufficient for "each reads as
      its name suggests").
- [ ] `awh drop phrase <callTrack> <responseTrack> --bars 8` (two-voice
      pairing) → confirmed via `--dry-run` against real Live: paired call
      (12 notes) + response (3 notes) clips, both exactly 32 beats (8 bars),
      as documented. The bars-1-4-repeat / bars-5-8-vary-call / turnaround
      listening judgment is still open.
- [ ] `awh drop phrase <target>` (single-clip, register-split form) →
      confirmed via `--dry-run` against real Live: 15 notes in one 8-bar
      clip, register-split as documented. Audible-distinctness judgment
      still open.
- [ ] `--style lyny-flavor` on both commands → not run yet.
- [x] Zero-notes call clip → `drop respond` states it plainly and writes
      nothing; confirm no phantom clip appears in the Set. Confirmed
      against real Live: clean `"... has no notes — nothing to respond to
      (write or transcribe a call first)"`, no clip created on the target.
- [x] A call clip that fills its own bar (no tail rest) → the printed
      WARNING is legible and non-alarming, and the response clip it still
      produces sounds separated in time, not like an overlap bug. Confirmed
      against real Live: the printed text is `"WARNING: call leaves only
      0.00 beat(s) of rest at its own bar tail (restMinBeats wants 1) — the
      response still enters cleanly after it, but consider trimming the
      call's last note to leave the question-mark gap"`. Clear,
      non-alarming, and it still produced a valid candidate rather than
      refusing, as designed. The "sounds separated" half is the listening
      judgment, still open.
- [ ] Skill: "give me some responses to this lead" / "answer this vocal chop
      with a bass growl" → the agent follows the Typical Flows entry (reads
      the call clip, uses `drop respond`, does not hand-compose a growl part
      or reach for plain `vary`).

## Drum stats mining (`awh drums mine`) owner checklist

Built + tested against a pilot subset only: the WaivOps example-loop MP3s
checked into the datasets' own repos (`examples/`, ~15-25 files each), not
the full archives, which are multi-GB Zenodo downloads egress-blocked from
the build container. The offline half is `analysis/tests/test_drumstats.py`
(synthetic-pattern recovery, silence zero-items, white-noise negative
control) and `knowledge/rhythm/waivops-drum-stats-pilot.md` (the pilot
numbers + n≈15-25 caveat). Mining the full datasets and deciding whether
the pilot's numbers hold up is the owner's:

- [x] Download the three full WaivOps archives (CC BY 4.0; keep the
      attribution lines below with any output derived from them). Found a
      bug in this checklist's HH-TRP URL: the documented
      `?download=1&preview=1` query returned Zenodo's HTML landing page
      (6KB), not the file, because `&preview=1` forces the web preview. The
      correct URL is Zenodo's API content endpoint:
      `https://zenodo.org/api/records/15734094/files/hh_trp_wav.tar.gz/content`
      (verified against `GET /api/records/<id>`; `files[].links.self` is the
      reliable way to get a download link. TR9/TR8's `?download=1` URLs were
      confirmed correct against the same API, sizes matched exactly:
      4810529632 / 4369713348 bytes).
      Also: the 22.3 GB HH-TRP transfer dropped mid-stream twice, and curl
      exited 0 both times despite a truncated file (piping through `| tail`
      swallowed curl's exit code, a separate bug in how the download was
      run). Recovered with `curl -L -C -` (resume) in a retry loop until the
      byte count matched the API's reported size, then verified with
      `gzip -t`. Downloaded to `~/waivops-datasets/` (outside any
      cloud-synced folder; a 31.5 GB download inside a synced directory
      would thrash the sync client). All three: byte-exact match to the
      API's reported size, `gzip -t` clean, extracted file counts exactly
      3780/3790/15000.
- [x] Run the real mine, saving records that supersede the pilot ones.
      Done for all three: `awh mix records waivops-{tr9,tr8,hhtrp}-full`.
- [x] Compare against the pilot numbers: do they hold up at full n?
      Mixed, which is why this was worth doing. TR9 confirmed more cleanly
      (95-98% → 100% at all 4 beats, 100% downbeat-check pass). TR8's
      headline "beat 1 near-universal, others weaker" pattern did not hold:
      full n shows an even 71-74% across all four beats, though this needs
      caution (TR8's downbeat-check pass rate is only 19%, vs. TR9's 100%;
      most TR8 loops' onset grid likely does not align with this analysis's
      beat-1 assumption, a finding the small pilot could not have surfaced).
      HH-TRP's kick-anchor finding (52%→49.4%) held almost exactly, a stable
      result at n=15000. HH-TRP's swing finding flipped sign between pilot
      and full (pilot: -0.019 beats / sign-flipped from spec; full: +0.0216
      beats / same direction as spec, smaller magnitude), a clear case of a
      20-loop sample giving a confidently wrong-signed answer.
- [x] Update `knowledge/rhythm/waivops-drum-stats-pilot.md`: replaced/
      extended with the full-dataset numbers, confidence language raised,
      pilot records kept (not deleted) to preserve the small-n-vs-full-n
      comparison as a case study. Whether to revisit `TRAP_KICK_CELLS`'
      beat-1-anchor assumption (the most consistent disagreement found) is left
      as the owner's hand-reviewed call, per the entry's "never auto-apply"
      rule; not done here.

## Device parameter probe (B2 prerequisite + Serum) — owner checklist

Five minutes on the dev machine with Live running. Both probes use the same
two commands; the goal is recording what the SDK exposes so the
plugin-parameter question stops being folklore.

- [x] Operator (native, the original B2 probe): insert an Operator by
      hand, then `awh call device.get '{"path": "track:N/device:M"}'` and
      save the JSON parameter dump. Which parameters appear, and are the
      oscillator/envelope params addressable? Confirmed: 195 fully named
      parameters (`Osc-A Coarse`, `Ae Attack`, `Algorithm`, every
      oscillator/envelope/filter control). `device.param` moves one (Volume
      0.4 → 0.7, read back 0.7), not only lists it. Inserted via
      `device.insert` on a disposable temp track, deleted after.
- [x] Serum (VST3): with a Serum instance loaded, run the same
      `device.get` dump. Record how many parameters Live exposes, whether
      they have real names or are opaque, whether the macros appear, and
      whether `awh call device.param` on one audibly moves it. The answer
      overturns the working assumption: Serum 2 exposes exactly 1 param
      (`Device On`), but a second third-party VST probed alongside it (OTT)
      exposed 20 fully named params (`Depth`, `Thresh L/M/H`, `Gain L/M/H`,
      ...). The plugin-parameter surface is plugin-specific, not a
      native-vs-third-party split. "Third party = opaque" was a coincidence
      of which plugins had been probed before (ShaperBox 3, the M4L Ducker),
      not a rule. Leading hypothesis for Serum: its host-automation surface
      is limited to whatever is mapped to its internal macro knobs, and this
      instance had none assigned. Unconfirmed; mapping 2-3 macros by hand
      and re-probing is the follow-up, noted as open in the knowledge entry.
- [x] Drop both dumps + findings into a `knowledge/setup/` entry
      (plugin-parameter surface: what is addressable from the CLI), same
      approach as `compressor-raw-display-mapping`. Done:
      `knowledge/setup/device-parameter-surface.md` (tier verified).

## B2 (Operator assistant, `awh op`) owner validation checklist

Built + smoke-tested against `awh serve-fake` with a fake Operator device
(representative ~25-param subset, real naming style; see
`packages/core/src/fake/fakeLiveBridge.ts`) and synthetic WAVs: `op recipes`
(zero-entries state + a temp `operator-recipe-*` entry pointed at via a
scratch `AWH_LIBRARY`/knowledge root, using `findLibraryRoot`'s existing
`$AWH_LIBRARY` override, so no new env var), `op apply` happy path +
unknown-param loud failure with zero writes + `--dry-run`, `op match` on a
synthetic pluck (tier 1, correct sine/saw classification) and on white
noise + a stretched-partial "bell" (tier 3, both refused with the specific
measured blocker named), and `op verify`'s error against the fake gateway
(see below). `pnpm test` green (321 core incl. 10 new `operator.test.ts` +
fake-Operator-device coverage; 24 cli incl. 9 new `op.test.ts`), venv
pytest green (97 incl. 13 new `test_opmatch.py`: harmonic-vector recovery,
ADSR fit, the white-noise and inharmonic-bell negative controls,
determinism). None of this touches a real device or real audio; everything
below needs the owner's Live Set and real captures.

A production session on 2026-08-20 surfaced the same 0-1-scale bug in three
more recipes beyond the pluck/Algorithm/Coarse case already fixed. Building
a track (drone/riser/amen-break bridge/16-bar call-and-response drop, a
fresh Operator per part) hit the same pattern in `reese-approx` (Algorithm,
all four `*Coarse`, all four `*Fine`, and `Spread`; `Spread`'s real range
is 0-100, not 0-1), `pluck` (same Algorithm/Coarse pair as before), and
`noise-perc` (`Osc-A Wave` real range 0-22 with 23 named waveforms,
including a "Noise White" the recipe's author missed, citing only "Noise
Looped"; and `Filter Type` real range 0-4 with 5 named types). All four
recipes are corrected against real `device.get` dumps and verified by
read-back (`all params verified by read-back` for each). This is a
systemic pattern: every recipe in this batch was likely authored under a
blanket 0-1 assumption, and the params that worked (Volume, `Osc-* Level`,
envelope times, `Filter Freq`/`Filter Res`) did so because their real
ranges happen to be close to 0-1. A dedicated audit should check every
remaining param in `growl-bass`, `fm-bell`, `e-piano`, `sub-click` against
real `device.get` ranges before trusting them; only the four recipes used
that night were touched.

`clip.create-audio` cannot place a clip directly on a group track
(confirmed on "SAMPLES", a group track per the owner's description of the
Set's routing). It fails with a generic `Failed to create clip` 500 from
the SDK and no useful message. The same op works on a leaf audio track.
This is an SDK/Live-object-model constraint, not a bug in this repo: always
target a leaf audio track for `clip.create-audio`/`awh render`, never a
group header.

- [x] Real apply + audition: with an Operator instance in Live, `awh op
      apply <a real operator-recipe-*> <devicePath> --audition`. Confirm
      device.get read-back matches every written param (not only that the
      gateway accepted the write), and that the audition clip's playNotes
      sound like the intended patch.
      Found and fixed a systematic bug across all 7 shipped recipes before
      any by-ear correction was reachable: every recipe used `Osc-A
      Coarse`/`Osc-A Fine`/etc. as param names, but the device's names
      (confirmed via `device.get` on an inserted Operator, disposable temp
      track) are `A Coarse`/`A Fine`, with no `Osc-` prefix on those two,
      unlike every other `Osc-A *` param. The fail-loud-write-nothing
      validation caught this on every recipe (zero partial writes, as
      designed). Fixed the naming in all 7 files, plus two recipe-specific
      misses: growl-bass's `LFO Waveform`/`LFO Amount` → `LFO Type`/`LFO
      Amt`, noise-perc's `Osc-A Waveform` → `Osc-A Wave`.
      The read-back mismatch check then found a second, deeper bug: applying
      the correctly named `pluck` recipe wrote cleanly for every
      envelope/filter/level param, but `Algorithm` and `*Coarse` reported
      mismatches, reading back as 0 regardless of the written value. Root
      cause, from `device.get`'s real min/max: `Algorithm`'s raw range is
      0-10 (11 quantized steps) and `Coarse`'s is 0-48. Every recipe assumed
      a normalized 0-1 range for every param, which is correct for
      Volume/`Osc-* Level`/envelope times/Filter Freq (all confirmed ~0-1)
      but wrong for these two. `reese-approx` also uses nonzero `Fine`
      values under the same assumption (`Fine`'s real range is 0-1000, not
      0-1), so its detune amounts are likely off by about three orders of
      magnitude.
      Not corrected numerically: knowing the range does not reveal the
      correct value within it (e.g. which of the 11 algorithms is "2-op, B
      into A") without an ear/UI pass (no `displayValue` API to shortcut it,
      per `device-parameter-surface.md`). Documented as a confirmed scale
      bug in each affected recipe's "Raw values" section instead, so the
      next by-ear pass knows what is known-wrong vs. unverified.
- [ ] Real match on a real bass sample: `awh op match <a real bass one-
      shot or sustained note>.wav`. Does the tier/summary line ring true to
      the ear? A clean tier-1 "good Operator candidate" should sound
      Operator-reachable; a tier-3 refusal should sound like something
      Operator cannot do. A growl/reese with heavy sub-harmonic distortion
      or noise components is the interesting edge case, since it may
      legitimately refuse or land tier 2 with a high oscillator residual.
      Mechanism confirmed on synthetic material (generated, not a real
      sample): a clean 220 Hz sine landed tier 1 (f0 221.0 Hz, harmonicity
      0.99, sine residual 0.00); white noise refused tier 3 with all three
      measured criteria named (voiced fraction, harmonicity ratio, partial
      deviation). A real bass sample, and whether the tier boundary is
      musically true, is still open. Then `--apply <devicePath>` on a
      tier-1/2 result and listen: do the addressable envelope/filter values
      (heuristic, see the module's `ADDRESSABLE_CAVEAT`) land close, or does
      the assumed 10s max-envelope-range constant in
      `analysis/awh_analysis/opmatch.py` need recalibrating against an
      observed raw<->ms curve?
- [ ] The drawn-partials probe (open question from the design doc's Half
      1 section): with a tier-1/2 `op match` result that has a nonzero
      oscillator residual, hand-draw the printed `drawThesePartials` values
      into Operator's harmonics editor, then `device.get` the same device
      again. Did any new param appear, or any existing value change? The
      working (unverified) assumption is that Operator's user-drawable
      harmonics are UI-only and not among the 195 automatable params
      (`knowledge/setup/device-parameter-surface.md`); this is the first
      real test of it. If drawn partials turn out addressable via some
      param, `propose()`'s `drawThesePartials`-only handling should push
      them directly instead.
- [ ] Raw↔display observations flow back into recipes: for every recipe
      applied above, read Operator's UI display value next to the raw
      number `awh op apply` reports (Algorithm's displayed name/number,
      Osc-A Coarse's displayed ratio, Ae Attack's displayed ms, ...) and
      record the pairing, same discipline as `compressor-raw-display-
      mapping.md` (a single point is a fact, not a curve; do not
      extrapolate). Update the seeded `operator-recipe-*` entries' comments
      with confirmed display values and promote their tier once a recipe's
      raw values are confirmed by ear; leave unconfirmed ones `draft`. This
      is the only way `op match`'s heuristic `addressable` normalization (a
      placeholder assumption, not a measured curve) gets replaced with
      something real.
- [ ] `op verify`'s closed loop, in Live with the AWH Capture Tap on the
      device's bus (m4l/README.md): confirm the reported score tracks
      audible closeness (dial a patch further from the reference and the
      score should get worse; closer and it should improve). The
      log-spectrogram-L2/harmonic-cosine blend and its `SCORE_L2_SCALE`
      constant are unverified against real ears, only against synthetic
      self-comparison (score 1.0) and synthetic vs. noise (score dropped as
      expected) in the pytest suite.
- [ ] Skill: "make this sound like this sample on Operator" end-to-end
      through the Typical Flows entry (SKILL.md's "Sound-design an
      Operator patch"); not run yet.

## M10 (endless player) owner validation checklist

Built + tested against `packages/cli/assets/endless/player.js` directly
(the file the emitted HTML loads; no second copy of the decision logic),
`packages/core/test/endless.test.ts` (spec parsing/typo rejection,
reachability negative control, empty-pool validation) and
`packages/cli/test/endless.test.ts` (decision-core determinism/weights/
maxConsecutive/noRepeatVariant/protectedLayers/bounded-fluctuation, WAV
round-trip, each build validation failure named (missing file, wrong
duration, unreachable section, empty pool), plus a Playwright smoke test
against the preinstalled Chromium that loads the demo page, presses Play,
and asserts the debug-exposed scheduler state advances: elapsed time
increases and section history grows between two checks). `pnpm test` green
end to end (`endless demo -o <dir>` and `endless build --single-file` both
run for real at build time). None of this proves the result is a good
listen, or that a real song's stems survive the pipeline: synthetic
sine/noise/saw stems prove the plumbing, not the craft.

Bug found and fixed with headless verification only (no interactive browser
was available at the time): `awh endless demo -o <dir>`, then `curl`ing the
served `index.html` showed `<title>endless-demo — endless player</title>`
filled in, but the on-page `<h1>` still read the literal
`__ENDLESS_TITLE__` placeholder. Root cause in
`packages/cli/src/endless/build.ts`: `templateHtml.replace("__ENDLESS_TITLE__",
spec.name)` uses JS's non-global `String.prototype.replace()`, which only
swaps the first match. The template has the placeholder twice (`<title>`
and `<h1>`), so only the tab title was filled. The same non-global
`.replace()` was used for the other two placeholders
(`__ENDLESS_SPEC_JSON__`, the player-script-tag comment) in both the normal
and `--single-file` build paths. All now use `.replaceAll()`, since a
future template adding a second occurrence of any of them would reintroduce
the bug. Verified against both build paths (`endless demo` and `endless
build --single-file`) via a rebuilt CLI + fresh curl checks, and added a
regression test (`packages/cli/test/endless.test.ts`, "replaces
__ENDLESS_TITLE__ everywhere it appears") that asserts the built HTML
contains neither the literal placeholder nor an empty/placeholder `<h1>`.
Full suite green after the fix: 32/32 (31/31 before the new test). The
Playwright smoke test could not catch this: it asserts only on
debug-exposed scheduler state, never on visible page text/headings.

- [x] `awh endless demo -o <dir>` → serve it (`python3 -m http.server` in
      `<dir>`) and listen. Does pressing Play produce audible,
      groove-plausible kick/hat/bass/pads, does the section change land
      musically (not only structurally correct per the debug readout), and
      does the mute/fluctuation movement register as subtle mix breathing
      rather than an audible glitch? Done, owner confirmed by ear. An
      interactive Chrome session (driven through a browser-automation
      extension) loaded the demo at `http://127.0.0.1:8123/`, confirmed the
      `<h1>` fix rendered (no literal placeholder), pressed Play, and
      watched it run/transition live: `performance #631621170` picked,
      intro (2 bars) → drop (2 bars) transition with fresh variant picks
      each section (`drop-drums-b.wav`/`drop-bass-a.wav`/
      `drop-pads-a.wav`), elapsed timer advanced, zero console errors. The
      owner then listened and confirmed all three: the section change lands
      musically, no clicks/pops at boundaries, mute/fluctuation reads as
      subtle mix breathing. This used the synthetic demo stems
      (sine/noise/saw), not a real song; the next two items (real bounced
      stems, then the owner's song) are still open.
- [ ] Bounce a few bars of a real song's stems (drums/bass/pads or
      whatever layers apply) bar-exact per section, with any reverb/delay
      tail overlapped back into the loop rather than trimmed at the
      boundary (the README's documented convention; this is the first real
      test that "overlapped tail" bouncing produces a clean-sounding loop
      point, not only a duration that passes validation).
- [ ] `awh endless plan --sections "..." --bpm <bpm> -o endless.yaml`, fill
      in the pools with those real bounces, `awh endless build endless.yaml
      -o dist/<name>` → confirm the validation errors (break one file's
      duration, delete one pool file, strand a section) are legible enough
      for the owner (not only an agent) to fix from the message alone, then
      confirm the clean build sounds right end to end: crossfades smooth (no
      click/pop at section boundaries), mix fluctuation subtle,
      "performance #N" reproducible across a reload with the same seed.
- [ ] Build the owner's own song this way, start to finish: the real exit
      criterion. Everything above is necessary but not sufficient; this is
      the first run of the full pipeline on material that matters.
- [ ] Follow-actions SDK probe (the design doc's open question, a non-goal
      for v1): does `@ableton-extensions/sdk` expose clip follow-action
      properties (`device.get`/equivalent on a clip, or a dedicated LOM
      path)? If yes, record what is addressable in `docs/sdk-feedback.md` or
      a knowledge entry. It is the prerequisite for a later
      `awh endless to-session` that builds the in-Live equivalent of this
      grammar using Live's follow actions instead of a browser player.
- [ ] Skill: "make an endless version of my track to share" → the agent
      follows the Typical Flows entry (plan -> owner fills pools -> build,
      not `awh sections` or hand-composed HTML).

## M12 (AWH Remote) owner checklist

Built without a running Max/Live instance; see `docs/design/live-remote.md`
for the spec and `m4l/README.md`'s "AWH Remote" section for the protocol,
install steps, and manual-patching fallback. Run this before trusting the
device on a real project, and before deleting the old
`AWH Capture Tap.maxpat` from a Set/the repo.

Code-side pre-check (everything possible without opening Max):
`m4l/AWH Remote.maxpat` parses as valid JSON (72 boxes, 89 connections) and
passed an automated structural check (a builder script, not hand-verified)
confirming: every connection references a box/outlet/inlet that exists in
range, zero `metro`/`tempo`/`clocker`/`delay` objects (no timers, per the
design's hard requirement), zero `print` objects, and the
`record`/`stop`/`loop`/`play` subsystem is wired byte-identically to the
Live-validated `AWH Capture Tap.maxpat`. This cannot confirm the patch runs
correctly in Max, only that nothing is malformed at the object/JSON level
(same caveat as the Ducker's pre-check).

Verified on the CLI/OSC side (no Max needed): `packages/cli
/test/remote.test.ts`: byte-exact checks for `/awh/fire`/`/awh/scene`/
`/awh/stopclips`/`/awh/jump`; a full integration suite against a fake UDP
device (ping→pong v2 handshake, correct message sequencing for `awh
play`/`stop`/`jump`/`launch`/`stop-clips`, `/awh/error` surfaced as a clear
thrown Error rather than swallowed); a negative control (no listener on the
port → clear "requires the AWH Remote device..." error within the timeout,
fast, not a hang); and `lib audition` end-to-end against an in-process fake
gateway (serve-fake style) + the fake UDP device running simultaneously,
covering sweep-previous-by-exact-name (a same-prefix decoy clip survives),
`--keep`, `--end`, zero-empty-slots (clear thrown error, nothing fired),
and unknown-slug (LibraryStore's existing clear error). `pnpm test` fully
green with this suite included. None of this reaches the Max runtime;
everything below needs Live open.

Run on 2026-08-23. Three systemic bugs were found and fixed before anything
below could pass, listed in the order they surfaced since each masked the
next:

1. `expr` ternary syntax is not supported on the owner's Max version. All
   three bad-index gate `expr`s (`obj-30`/`obj-42`/`obj-54`) used
   `... ? 2 : 1` and threw the same Max-console syntax error as soon as the
   patch was pasted (all three highlighted orange). Rewritten to the
   equivalent `(condition) + 1` form: `expr`'s comparison/logical operators
   return `1`/`0` like C, so no ternary is needed. Verified clean (no orange
   highlight) after a re-paste.
2. Every `prepend ...` box in the device was a `message` box, not a
   `newobj` object (all 8: the `record` file-open plus the 7
   fire/scene/stopclips/jump status/error replies). A message box outputs
   its own fixed text on any trigger and ignores the incoming value. This
   broke the file path handed to `sfrecord~`'s `open` (recording never
   opened the target file) and every status/error OSC reply (address
   correct, data missing; e.g. jump's reply came back as literal `prepend
   /awh/status jump` with no beats value). Found by comparing against the
   working `AWH Capture Tap.maxpat`, whose `prepend open` box is a
   `newobj`. Fixed all 8.
3. Root cause of fire/scene/stopclips/jump silently no-oping: a bare,
   argument-less `live.path` does not accept a raw LOM path string as a
   runtime message. It needs the prefix word `goto` (`goto live_set tracks
   $1 clip_slots $2`, confirmed against Cycling '74's live.path cookbook
   usage). Without it, Max's console showed `live.path: doesn't understand
   "live_set"` followed by `live.object: set: no valid object set`. Neither
   surfaces as an OSC `/awh/error`, since it fails inside Max before either
   gate branch's reply fires (the CLI saw a clean timeout with no error
   text). Pair A's `live.path live_set` differs: it bakes the path in as a
   creation-time argument resolved by a `bang`, with no message parsing, so
   it was never affected. That is why `awh play`/`awh stop` worked from the
   first paste while jump/fire/scene/stopclips did not. Fixed all 5
   `live_set`-prefixed message boxes (`obj-33`, `obj-45`, `obj-59`,
   `obj-60`, `obj-68`) to start with `goto`.

All three fixes are in `m4l/AWH Remote.maxpat` and documented in
`m4l/README.md`'s manual-build table and Notes for anyone rebuilding by
hand. Reaching a clean state took 3 re-paste/re-init rounds; the MANUAL
RE-INIT button worked every time (see the re-init item below).

- [x] `m4l/AWH Remote.maxpat` opens/pastes cleanly in Max on the master
      track (between `plugin~`/`plugout~`) without validator errors. True
      only after the `expr` fix above; the three orange-highlighted `expr`
      objects were the paste-time validator failure this item checks for.
      Clean on the final re-paste.
- [x] `awh play` starts the transport; `awh stop` stops it. Owner confirmed
      audibly both times (once early, once with a 10s gap to rule out a
      lucky race). The `--from-bar` combo was not isolated (bare `jump` was
      tested standalone instead, see below).
- [x] `awh jump <bar>` moves the arrangement playhead without starting
      playback. Failed twice before the `goto` fix (console: `live.path
      doesn't understand "live_set"` / `live.object set: no valid object
      set`; the playhead never moved despite a clean CLI reply). After the
      fix: owner confirmed the playhead jumps to the requested bar and the
      transport stays stopped.
- [x] `awh launch track:N/slot:M` on an occupied slot fires it audibly
      (owner confirmed, Lead Call session clip). `awh launch scene:N` fires
      the whole scene the same way, owner confirmed via `set.summary`
      cross-check: scene 0 fired both Lead Call/slot:0 and Reese
      Response/slot:0 (`clip.get` confirmed both occupied beforehand). Only
      Lead Call was audible because the Reese Response track is muted
      (`set.summary`'s `"muted": true`, pre-existing Set state, not a fire
      failure): the device did the right thing while an unrelated mute made
      it look broken. Launch-quantization timing (does it wait for the
      quantize boundary rather than cutting in) was not isolated.
- [x] `awh stop-clips track:N` / `awh stop-clips` (whole Set): both owner
      confirmed (the scene-0 clips stopped on command).
- [x] Bad-index behavior: raw OSC probes (bypassing the CLI's client-side
      path-syntax validation, which rejects `track:2/slot:-1` before it
      reaches the device) confirmed all three device-side gates fire
      correctly after the `goto` fix: `/awh/fire -1 0` →
      `/awh/error bad-fire-index`; `/awh/scene -1` → `/awh/error
      bad-scene-index`; `/awh/stopclips -2` → `/awh/error
      bad-stopclips-index`; and the `-1` "whole Set" sentinel does not
      false-positive (`/awh/status stopclips -1`). Positive-but-out-of-range
      indices were not tested (documented known gap, not expected to be
      caught).
- [x] `awh lib audition <slug> <track>`: owner confirmed end-to-end. Saved a
      session clip to a scratch library entry; `lib audition` placed it
      into an empty slot and fired it audibly; `--end` swept and stopped it
      (owner confirmed both the audible fire and the sweep). Scratch library
      entry + regenerated `INDEX.md` cleaned up afterward.
      Second-slug-sweeps-first and `--keep` were not re-exercised live
      (covered by the fake-gateway integration suite).
- [x] Manual re-init button recovers after a paste-reload. Exercised 3
      times in a row (once per bug-fix round), since every fix required a
      fresh select-all/copy/paste over the open device. It worked each
      time: `awh ping`/`awh play`/`awh stop` were reachable immediately
      after each click, with no device removal/reinsert. Whether Pairs B–E
      need it (vs. only Pair A per the design) was not isolated, since the
      `goto` fix landed in the same paste rounds as the re-init clicks. Not
      an open question: Pairs B–E resolve fresh per call by design, so they
      were never expected to depend on re-init, and nothing observed
      contradicted that.
- [ ] Owner performance protocol (m4l/README.md's "Owner performance
      protocol" section): run all three conditions (no device / frozen +
      editor closed / unfrozen + editor open) and record the three numbers
      here:
      - Baseline (no AWH device): ___
      - Frozen, editor closed: ___
      - Unfrozen, editor open: ___
      If the frozen/editor-closed number is meaningfully worse than
      baseline, that is a patch-level regression to escalate (unexpected
      per the object-count diagnosis). Otherwise this closes the owner's
      original "Capture Tap feels heavy" report as environmental, not a
      patch defect. Not run: it needs the owner's CPU-meter reading across a
      Live restart per condition and cannot be automated.
- [x] Migration: the old AWH Capture Tap was removed from the Master chain
      before this pass (the owner's first migration step); AWH Remote is
      installed in its place. `awh mix capture` re-confirmed end-to-end
      after the fixes. A capture at the drop (bars 21-22) came back silent
      twice (`-inf` LUFS), traced to the "dirty transport after heavy
      jump/launch/stop-clips testing" gotcha documented earlier in this doc,
      not a new bug. Confirmed by having the owner press Play and confirm
      audible playback immediately before a third attempt, which came back
      real (`-9.28` LUFS, `2.00` dBTP true peak). This is the actual
      cutover, not a side-by-side comparison. `op verify`/`mix duck push`
      were not re-run but share the same record path. Deleting
      `AWH Capture Tap.maxpat` from the repo is optional and the owner's
      call; not done.
- [ ] Freeze to `AWH Remote.amxd` and reload in a new Live Set → still
      responds on 9720/9721 without re-patching. Not run (it would require
      closing/reopening the Set in use); left open.

## M11 (sample library) owner checklist

Built + tested against a synthetic corpus only (sine-tone one-shots, a
noise-burst hat, a decaying-sine kick loop at a known BPM):
`analysis/tests/test_samplescan.py` (feature ranges, type-guess/BPM
recovery, determinism, unreadable-file records, JSONL-via-CLI, no NaN/
Infinity tokens) and `packages/cli/test/samples.test.ts` (incremental index
build/skip/prune against a fake scanner; the real analysis engine for an
end-to-end index build plus the similarity negative control: a second sine
bass ranks above two noise hats for a sine-bass reference, with a hat
ranked last; search token/filter matrix; zero-hits relaxation suggestions;
missing-dir loud error; `AWH_SAMPLES_INDEX` honored, `~/.awh` never touched
by the test suite). A one-off smoke run (tiny hand-built corpus: a bass
one-shot, a noise hat, a 120 BPM kick loop) confirmed `index` → `search` →
`similar` work end-to-end from the built CLI. Real sample packs are messier
(inconsistent naming, silence-padded files, odd sample rates, mixed-BPM
folders), so the items below use a real library.

Run on 2026-08-23: indexed the owner's sample library,
`/Users/tahazar/.../Ableton/2 Samples` (20,212 real files across nested
pack folders: Bass/Drums/FX/Melodic/MIDI/My Material/User Library/Vocals,
with messy real-world naming).

- [x] Point `awh samples index` at a real sample folder tree and check the
      walk/unreadable-count/incremental behavior. Confirmed: recursive walk
      found all 20,212 files (wav/aif/aiff/mp3) across the nested tree; 7
      flagged unreadable, each a sensible failure, not a scanner bug: 3
      malformed WAV `fmt` chunks, 1 corrupt MP3 (missing consecutive MPEG
      frames), 1 unrecognized format, 1 file too short for the analysis
      window's padding requirement. Re-running immediately reported `0
      rescanned, 20212 unchanged` (1.02s wall-clock vs. the original ~34.5
      min full scan; real filesystem mtimes). Touched 3 files by hand
      (`touch`) and re-ran: exactly those 3 were rescanned, all 20,209
      others skipped.
- [x] Timing at real scale: the first full index of the 20,212-file library
      took ~34.5 minutes wall-clock (2,488-file Bass subfolder alone: 2:12,
      ~53ms/file; remaining 17,724 files: 28:43, consistent per-file rate,
      no slowdown at scale). The "scanned N/total" progress line (every
      1000 files) was useful at this size, neither too sparse nor too
      chatty. Not profiled further since the rate held linear.
- [x] The "find me an amen break" flow against messily named files:
      `awh samples search amen` returned 20 hits from a commercial breaks
      pack (`Drums/Breaks/*.wav`: "Atlantis Amen", "Bulldozer Amen 2 - 2A",
      "Drumz Amen Compound - 11A", etc., BPM detected per file from 74.9 to
      172.3), typed `loop`. Search works against real pack naming
      conventions, not only clean synthetic test names.
- [x] A `similar`-to query against an owner-known favorite (`Bass/
      Growls/Terrorist Reese - 3A.wav`, trait-based; no CLAP embeddings
      installed yet, see M11b). Confirmed the gap this item was designed to
      catch: results clustered at 0.991-0.995 cosine and were dominated by
      kicks/808s (not other reese/growl basses), all sharing only the `low`
      band tag. Owner's by-ear verdict: "kinda sounds similar but I think
      it's mostly low band energy". The v1 MFCC/spectral/band-split feature
      vector tracks coarse low-band energy, not growl/reese harmonic timbre,
      on real material. This matches the checklist's prediction (the
      synthetic negative control only proved sine-vs-noise separates
      cleanly). Closing the gap needs the M11b CLAP semantic path (untested
      against a real checkpoint, see below), not a v1 feature-vector tune.
- [ ] Decide whether the loop/one-shot duration+onset heuristic
      (`samplescan.LOOP_MIN_DURATION_S`/`LOOP_MIN_ONSETS`) needs tuning
      against real material. Not evaluated; left as the owner's call.

## M11b (semantic search) owner checklist

Built + tested under `AWH_CLAP_STUB=1`: `analysis/tests/test_clapembed.py`
(stub determinism/text-mode/L2-normalization/6-decimal rounding/the "model
not installed" error naming the exact package+checkpoint+path/JSONL shape
through `sanitize_json`) and `packages/cli/test/samples.test.ts`'s M11b
blocks (embed fills + is incremental; a model switch makes every prior
vector stale and re-embeds, reporting counts; `search --semantic` composes
with the v1 trait filters and reports the not-embedded footer;
`similar --semantic` ranks a byte-identical copy of the reference first;
the negative control: `search --semantic` against an index with zero
embeddings errors naming `awh samples embed` and never silently falls back
to token search, checked via a subprocess spawn of the built CLI). A smoke
run indexed 14 real mp3 loops (WaivOps TR9 examples) end-to-end through
`index -> embed -> search --semantic -> similar --semantic`, confirming the
plumbing works on real files. The stub has no real semantics (every score
in that run was noise clustered near 0: random unit vectors in a 512-dim
space), so it proved wiring, not embedding quality. Nothing here has run
against the real LAION-CLAP checkpoint. That needs an owner machine
(Hugging Face is egress-blocked in the dev container; see
`analysis/README.md`'s M11b section for the install + checkpoint download):

- [ ] Install `laion_clap` (`pip install -e '.[clap]'` from `analysis/`)
      and download the music checkpoint (`music_audioset_epoch_15_esc_90.14.pt`,
      ~600 MB+ depending on host) into `~/.awh/models/` per
      `analysis/README.md`. Confirm `awh samples embed` fails with the
      clear install-hint error before the checkpoint is present and
      succeeds after, never a bare stack trace.
- [ ] `samples embed` timing at real library scale: how long does the
      first full embed of the owner's library take (torch CPU inference is
      much heavier per file than `samplescan`'s DSP pass), and is the
      "embedded N/M" progress line useful at that cadence? Re-running
      immediately should embed 0 (incremental skip); confirm that holds at
      real scale.
- [ ] Three content-language queries against a real, embedded library
      ("dusty breakbeat" plus two the owner picks), judged by ear against
      each query's top-5 `search --semantic` results. This is the first
      real test of whether CLAP-space similarity tracks the owner's sense of
      what a phrase describes; the stub only proves the plumbing moves data.
- [ ] A `similar --semantic` query on a favorite sample the owner knows
      well: do the top few results sound similar by ear, and does
      `similar --semantic` default to semantic (not `--traits`) once the
      index has embeddings, without being told?
- [ ] Spot-check that no CC-BY-NC (or other restrictively licensed)
      checkpoint was fetched. Only the two open LAION-CLAP checkpoints
      named in `analysis/README.md` (`music_audioset_epoch_15_esc_90.14.pt`,
      `630k-audioset-best.pt`) should land in `~/.awh/models/`.
- [ ] Confirm the `search --semantic` vs token-`search` split in
      `.claude/skills/awh/SKILL.md` (content-language queries try semantic
      first, name-like queries try tokens first) holds up with a fresh
      agent against real "find me a ___" requests. The written contract is
      untested against a live conversation.
- [ ] PANNs tagging (`awh samples tag`, `docs/design/sample-semantic.md`'s
      optional stretch) is designed, not built. Decide whether to build it
      as a follow-up milestone, or whether CLAP semantic search covers the
      "find a kick" case well enough that a separate tag-based filter is
      not worth the second model/cache.

## M11c (pitch-tagged sample search) owner checklist

Built and validated against the owner's 20,212-file library on 2026-08-23,
as a follow-on from the M6b masking toolkit: after `mix pitch` caught a
naive-FFT-peak-pick failure on a Reese patch, the owner asked whether the
same periodicity tracking could tag kicks/subs in the sample library for
key-matched search. `test_samplepitch.py` (tuned-sine voiced/broadband-noise
unvoiced negative control, too-short/corrupt/missing-file states,
determinism, JSONL CLI round-trip, no NaN/Infinity) and `samples.test.ts`
(eligibility matrix, incremental + stale re-tag, zero-candidates state, the
octave-convention regression, `search --near-note` cents filtering with a
negative control, subprocess integration) are the synthetic-tested half,
all green (`pnpm test` + `pytest -q`, no regressions). Unlike most entries,
this one was also run against the owner's library in the same pass:

- [x] `awh samples pitch-tag` on the owner's indexed 20,212-file library.
      Exactly 2,427 files (~12%) were eligible candidates
      (`isPitchTagCandidate`: readable one-shots whose energy is
      low-band-dominated), so the eligibility filter is well-scoped (not 0,
      not everything). Tagging all 2,427 took ~91 seconds (0 failures), not
      a meaningful workflow cost. Split: 2,161 `voiced` (a trackable
      fundamental; kicks/808s in real packs are tuned more often than
      expected), 266 `unvoiced` (broadband transients, reported as such
      rather than with a fabricated pitch). Re-running immediately reported
      "all 2427 ... already pitch-tagged — nothing to do" (incremental at
      real scale, same as M11's index).
- [x] `awh samples search --near-note <note>` against the pitch-tagged
      library: the "find a kick that matches my sub" question this
      milestone exists for. `search --near-note F1` (this project's F
      Phrygian key root) surfaced correctly tuned 808s/kicks from
      commercial packs, including one in a `Drums/Kicks/` folder
      (`Mixed Small 808.wav`, duplicated across a `Bass/808s/` and a
      `Drums/Kicks/` pack folder). Composing `--near-note` with a text term
      (`search kick --near-note F1`) returned 0 (none of this library's
      path-token "kick" files is tuned to F1) while bare `--near-note F1`
      returned hits, so the filters compose as AND without silently
      relaxing.
- [x] Octave-convention correctness (the trickiest part, caught during
      design rather than live): `pitch.py`'s `note.name` is in
      standard/scientific notation (C4 = MIDI 60), an octave apart from
      this codebase's Ableton convention (C3 = MIDI 60) used everywhere
      else a note name appears in the CLI. The fix holds:
      `noteNameToHz("A3") === 440` (Ableton's A3 = standard A4 = concert
      pitch), and `pitchDisplayNote` re-derives the shown name from the
      convention-free `note.midi`, never trusting the raw Python string.
      Both covered by explicit regression tests.
- [ ] Skill check: ask a fresh agent "find me a kick that matches my sub"
      or similar and confirm it follows the Typical Flows entry
      (`.claude/skills/awh/SKILL.md`): runs/confirms `pitch-tag`, then
      `search --near-note` with the right note (the Set's active key root
      or whatever the owner named), and says that untagged/unvoiced hits
      were never claimed to match. Not run yet.
- [ ] Whether the default 50-cent (quarter-tone) `--cents` tolerance is
      the right musical default or too tight/loose in practice. Not enough
      real search use yet to judge; the owner's use over time is the
      signal.
- [ ] Loops/melodic material remain out of scope for pitch tagging (v1).
      `pitch.py`'s `per_note` mode is the extension path if key-matching
      basslines/leads is needed later; not evaluated or built.

## Pitch-aware duck depth targeting (`duck fit --bass`) owner checklist

Built and validated against the real Set on 2026-08-23, following M11c with
the same idea (a real fundamental beats a generic low-band proxy) applied to
sidechain depth instead of sample search. When the bass is voiced,
`analysis/awh_analysis/duck.py`'s masking-depth calc measures both bass and
kick in a narrow band centered on the bass's fundamental
(`pitch.analyze_segment`, reused from M6b) via the same calibrated Welch
machinery `mix bands` uses (`spectrum.welch_psd`/`band_power`,
`bands.CALIBRATION_REF_POWER`); no new DSP. Broadband/unvoiced bass keeps
the generic calc (one fixed 150 Hz lowpass band) byte-for-byte, since a
narrowband margin is meaningless without a real fundamental. `test_duck.py`
(10 tests, 3 new: tuned-bass narrowband path, broadband-bass fallback with
a regression guard confirming it reproduces the exact pre-change number,
and a negative control proving the measurement responds to where the
kick's energy sits) is green, plus the full `pytest -q` (164 tests).

Bug caught live and fixed before shipping: the initial design gated the
narrowband path on `pitch.analyze_segment`'s `state == "voiced"` alone.
Testing against a synthetic white-noise "bass" showed pyin can flip to
`"voiced"` off a single spurious periodic frame (0.064 voiced fraction on
pure noise, confidence 0.010). A gate (`MASKING_MIN_VOICED_FRACTION =
0.10`) was calibrated against three numbers measured that day: pure noise
0.064, a messy but real Reese growl (from the earlier masking
investigation) 0.122, a clean sub 0.956. 0.10 sits between the false
positive and the real (if noisy) tonal case, so noise falls back to the
generic calc while messy tonal material like Reese still gets the
narrowband treatment.

- [x] Real end-to-end run against the live Set: captured "2 Kick & Snare"
      and "9 Sub" over the 4-bar drop span via `awh mix layers` (automated
      solo/capture/unsolo), then `awh mix duck fit <kick capture>
      --trigger-clip track:17/arr:1 --bass <sub capture>`. The sub's
      fundamental came back 44.9 Hz, the same number `mix pitch` found
      independently on the archived `solo-sub.wav` capture earlier that day
      (95.6% voiced there): a cross-validation between two independently
      run tools on related real material.
- [x] Compared the new recommendation against the old generic-band formula
      on the same capture pair (old formula reproduced by hand, matching
      the fallback branch's regression-guarded code path): old 6.7 dB vs.
      new 11.4 dB. The old blended measurement understated the conflict
      because it averaged the kick's broader low end (including transient
      content up to 150 Hz) against the sub's broadband level. The new
      measurement shows the kick is comparatively quieter at the sub's
      44.9 Hz fundamental than the broadband picture implied, so it calls
      for more protection where the overlap lives.
- [x] The existing trigger-alignment sanity check (unrelated, untouched by
      this change) fired a WARNING on this capture: the "trap-drums"
      Trigger clip's note positions do not match this 4-bar window's kick
      placements (plausibly because the drop's kick pattern varies
      bar-to-bar, A-B-A-C style, while the Trigger clip encodes one fixed
      pattern). The sanity check still flags data problems alongside the
      new masking-depth logic rather than producing a confident but
      misaligned fit. Not chased further (a separate, pre-existing finding,
      not a regression).
- [ ] Draw the new recommended envelope into Volume Shaper and confirm by
      ear it improves on the old generic-band recommendation, on material
      where they differ audibly. Not done (needs a ShaperBox-equipped
      project; this Set uses the automatic Compressor strategy).
- [ ] Whether `MASKING_MIN_VOICED_FRACTION = 0.10` is calibrated well
      enough against only 3 real data points (noise/Reese/sub). Revisit if
      a future bass capture sits close to that boundary and the routing
      (narrowband vs. fallback) sounds wrong.

## M13 (mix advisor) owner checklist

Built (the offline half) in response to the owner's request recorded in
`docs/design/mix-advisor.md`: "with this mix report — I want to be able to
derive recommendations on what to do to improve the mix."
`analysis/awh_analysis/advise.py` is a deterministic rule table over the
same measurement dict `mix report` produces (it never re-measures with
different logic): six fixed stages (integrity → phase → masking → tonal →
dynamics → loudness), each rule citing its `docs/research/
data-driven-mixing.md` or existing-module basis, capped EQ amounts
(`min(|delta|, 3) dB`), tilt-vs-bands exclusivity, `blockedBy` links across
the dependency ladder, and a healthy-mix state (zero actionable items + the
two most marginal metrics). The offline half is
`analysis/tests/test_advise.py` (15 tests: one real-audio fixture +
negative control per named rule (clipped sine/safe sine → integrity,
decorrelated/correlated low band → phase, band-boosted/unboosted noise vs a
real saved target → capped EQ, quiet streaming-level mix → healthy state),
plus dict-fixture tests for masking, tilt-vs-bands exclusivity, two-stage
ordering/blockedBy, determinism, and `--compare` resolution categories) and
`packages/cli/test/advise.test.ts` (record-name resolution, `--set`
device-name enrichment against a fake gateway, and full CLI integration
through the built binary + real Python engine: arg mapping,
missing-target/-layers placeholders in real output,
`--record`/`--target`/`--layers` resolving saved records by name, `--set`
naming a real master-chain device end to end, `--compare` resolved/new).
All green (Python 179/179 total incl. the 15 new; Node core 344/344, cli
146+15/161). Re-running the original question end-to-end against the
owner's WIP track is the owner's:

- [ ] `awh mix advise <realWipCapture> --target <realGenreTarget> --layers
      <realLayersRecord>` on the project this milestone was built for, not
      a synthetic fixture. Confirm the ranked plan reflects the dependency
      ladder on real numbers (e.g. does a real phase or tonal issue outrank
      a lower-priority one, and does `blockedBy` fire when it should).
- [ ] The credibility test: read the top-3 items before looking at the
      numbers and judge, by ear/experience, whether they match what you
      already suspected was wrong with the mix. Disagreement is expected
      sometimes; the design treats it as a reason to edit a rule (threshold
      or wording), not to distrust the whole tool. Note which items (if
      any) surprised you and why.
- [ ] Act on one item (the move the `action` field names: an EQ Eight
      move, a Utility Bass Mono, a limiter ceiling change), re-capture, then
      `awh mix advise <newCapture> --compare <savedName>`. Confirm the
      fixed item shows `resolved` (or `improved` with real numbers) and
      nothing you did not touch got miscategorized.
- [ ] Try `--set` against the real Set with the real master chain loaded.
      Confirm it names devices already there (not the generic "add an EQ
      Eight" phrasing) where one exists, and does nothing surprising when
      it does not.
- [ ] Skill check: ask a fresh agent "what should I fix in my mix" or "is
      this ready for release" and confirm it reaches for `mix advise` from
      the Typical flows entry, presents the plan top-down, quotes evidence
      verbatim, and never adds a folklore suggestion the engine did not
      emit. Not run yet.
- [ ] Whether the decisions made where the design left specifics unstated
      hold up against real material: the masking "comparable energy"
      significance threshold (5% of a layer capture's total signal power,
      not an absolute dBFS), the extreme-asymmetry integrity threshold (2x
      report.py's existing 3 dB flag, i.e. 6 dB), and the `--compare`
      improved/unchanged epsilon per rule (docs/design/mix-advisor.md does
      not pin these down). Revisit if a real run's judgment calls sound
      miscalibrated.

## M14 (arp engine) owner checklist

Built per `docs/design/arp-engine.md`'s pinned ArpSpec schema and
semantics. A single global step counter drives contour/pattern-position/
walk-rng together; `packages/core/src/arp/engine.ts`'s header comment
explains why that one rule makes polymeter wrap correctly and makes chord
boundaries re-select the pitch pool without resetting pattern position.
Two built-ins (`basic-up`, `melodic-techno-16ths`, the latter verbatim from
the design doc), the knowledge `arp-style-<name>` fallback (tier printed),
the `ratchet` transform (vary-compatible), and
`euclideanMask`/`chordsFromNotes` exported as reusable core utilities.
`pnpm test` green (core 344 -> 381 incl. 37 new: pitch-pool membership,
exact-k-onset euclidean masks at every rotation, the patternLength-12
polymeter wrap with hand-computed accent positions, the chord-boundary
re-select fixture, ratchet/gate non-overlap, bounded walk, frozen
determinism for both built-ins across 2 seeds, parseArpSpec typo/euclid-k=0
rejection, and the melody-only negative control; cli 161 -> 167 incl. 6
new: `--prog` end-to-end and `--dry-run` against a fake gateway, the
chord-clip source reading a clip `awh chords` wrote, the melody-only state,
the unknown-style error, and the knowledge-entry style fallback with tier
printed via an isolated `AWH_LIBRARY`); Python untouched (179/179).
Smoke-tested against `awh serve-fake`: `--prog` writing a clip, `awh
chords` -> `awh arp` chord-clip round trip, an unknown style's error, a
melody-only clip's state, and `--variant rotate-N` against a
knowledge-loaded style. The owner still needs to audition this in Live:
synthetic notes and property tests prove the pinned mechanics as coded, not
whether either built-in (or a knowledge style) sounds like the
trance/techno/psy-ratchet idiom it names.

- [ ] `awh arp --prog "<a real progression>" --key <realKey> <target>
      --style melodic-techno-16ths` on the project this milestone was built
      for → confirm the updown contour + off-accent 16ths read as "melodic
      techno," not only a mechanically correct arpeggio. Not run
      (serve-fake only).
- [ ] `awh arp <a real chord clip on the project> <target> --style
      basic-up` → confirm the chord-clip source (grouped simultaneous
      notes, per-chord spans) tracks the harmonic rhythm of a hand-written
      or `awh chords`-written clip, not only the synthetic test fixtures.
- [ ] Audition a knowledge `arp-style-<name>` entry once the seeded
      trance/melodic-techno/psy-ratchet entries land. This milestone only
      smoke-tested the fallback mechanism (a scratch knowledge entry, tier
      printed), not any seeded entry's musical claims.
- [ ] The jam-vs-commit workflow: find a pattern you like on the stock Live
      Arpeggiator (jamming), then reproduce its feel with `awh arp`
      (style/rate/gate/contour) so it becomes a seed-reproducible clip the
      rest of the toolchain (vary/library/notation) can touch. Confirm the
      hand-off feels natural rather than like re-deriving the pattern from
      scratch.
- [ ] `ratchet` transform via `awh vary <clip> --ops "ratchet:steps=..."` on
      a real (non-arp) clip → confirm the ratcheted hits read as a
      deliberate roll/stutter, not a glitch, at a real tempo.
- [ ] Skill check: ask a fresh agent to "arp this chord clip" / "give me a
      trance-style 16th arp" and confirm it reaches for `awh arp` from the
      Typical flows entry (chord-clip or `--prog` source, not hand-composed
      notation), and says plainly when a source clip turns out to be a
      melody rather than silently producing garbage.
- [ ] Whether the decisions the design left unstated hold up: `--variant`
      forcing the euclid mask's rotation (there is no cell/recipe table to
      draw from, unlike drums/phrase); the single global step counter as
      the mechanism for both polymeter wrap and chord-boundary continuity;
      `--bars` beyond a chord source's span tiling (looping) the harmonic
      content rather than erroring; the velocity ramp shape scaled off
      `accentBoost` (±half of it at the pattern's ends) rather than an
      unstated constant; and swing applied to odd-indexed steps as a
      fraction of the step (the "drum-engine convention" the design cites
      without pinning a formula). Revisit if a real run's feel does not
      match what these imply on paper.

## M15 (break engine) owner checklist

Built per `docs/design/break-engine.md`, in two independent halves. Half 1
(`awh breaks place`) plays a knowledge-carried canonical break pattern as
MIDI on any kit, with no audio slicing, on the existing notation path
(kit-aware via `mapPadRoles`, same convention as `drums gen`). The seeded
`break-pattern-<name>` entries land separately; this milestone smoke-tested
the mechanism only with a scratch knowledge entry, not the seeded entries'
musical claims. Half 2 chops a real break sample
(`analysis/awh_analysis/breakchop.py`, reusing `duck.detect_onsets` for
onsets, `drumstats._band_split`'s low/mid/high proxy filters for the
per-slice kick/snare/hat role guess, and `ref.onset_and_subband`/
`estimate_tempo` for BPM) into a labeled chop map, then re-sequences it in
core only (`packages/core/src/breaks/{spec,chopmap,engine}.ts`:
BreakSpec-driven `pattern` generation and a fixed built-in `fill` grammar,
chop map in/notes out, no Python needed to test it).

`pnpm test` green (core 382 -> 416 incl. 34 new: `parseBreakSpec` typo/
range rejection + built-in round-trips, `parseChopMap`'s snake_case
adapter, `sliceNote`'s drum-rack 16-pad cap vs. live-slices' uncapped
range, the statement phase's byte-exact/rng-independent verbatim output,
role-substitution-honors-roles and snare-displacement property tests, the
all-low-confidence negative control (warns, restricts to same-slice
tricks), zero-slices states for both `pattern` and `fill`, the fill
restraint rule (never >`maxDevices` distinct device types) across 20
seeded candidates, frozen determinism for both built-ins, and a chop-map-
record `knowledge.test.ts` case; cli 167 -> 182 incl. 15 new: a real
`awh_analysis.breakchop` subprocess run against a synthetic break wav
(`--save`/`--export`/`mix records` rendering the "chopmap" kind end to
end), `--map` record resolution, `--mode live-slices`'s loud
count-mismatch warning naming the map's slice count, the drum-rack
16-slice cap surfacing as a clear CLI error, the low-confidence and
zero-slices negative paths, the unknown-style error, the knowledge
`break-style-<name>` fallback with tier printed via an isolated
`AWH_LIBRARY`, `fill` writing N named ("fill <devices> s<seed>")
candidates into consecutive session slots, and `place` resolving a temp
`break-pattern-<name>` entry through the GM-fallback path); Python 179 ->
189 incl. 10 new in `analysis/tests/test_breakchop.py` (exact slice
count/roles/small offsets on a synthetic kick/snare/hat break, a
shifted-hits synthetic proving offsets are measured, not snapped, a ghost
negative control, zero-onsets as a state, `--export`
byte-length-matches-span, determinism, BPM estimation without an override,
the saved-record shape, and two CLI subprocess smoke tests).
`skill-flows.test.ts` gate green for `awh breaks`.

Smoke-tested against a synthetic amen-shaped break WAV (kick/ghost/snare/
hat, 90 BPM, real onset detection through the Python engine, not a fake
substitute): `breaks chop --save --export` produced a 7-slice table (the
ghost hit in that capture did not cross the onset threshold, a real miss,
not a bug; the negative control above covers a case tuned to land it),
`breaks pattern --style jungle-classic --dry-run` and `--mode live-slices`
(loud warning, exact slice count named), `breaks fill --dry-run` with 3
seeded candidates showing an escalating snare-rush ratchet / a fixed-slice
stutter / a 7-slice-cycling triplet cell, the low-confidence and
zero-slices negative paths, the >16-slice drum-rack refusal, and `breaks
place` against `awh serve-fake` with a scratch knowledge entry (GM
fallback, since no existing test in the repo stands up a fake Drum Rack
with real pads). The owner still needs to audition this in Live: synthetic
slices and property tests prove the pinned mechanics as coded, not whether
the fill grammar's four devices read as tasteful jungle/DnB moves, or
whether a real amen/think/funky-drummer break chops the way the design's
craft assumptions expect.

- [ ] `awh breaks chop <a real amen/think break from the sample library>
      --export <dir> --save <name>` end to end → confirm the role guesses
      and grid offsets match what the ear expects on well-known material,
      not only the synthetic test fixtures.
- [ ] Drag the `--export`ed slices into an empty Drum Rack and confirm the
      pad order lines up with `--mode drum-rack`'s C1-up assumption as the
      README table claims.
- [ ] `awh breaks pattern <target> --map <name> --style jungle-classic` and
      `--style halftime`, then `awh breaks fill` a few turnarounds. Judge
      by ear whether jungle-classic's statement-then-chop and halftime's
      sparse-same-slices read as those idioms, and whether any fill's
      devices (snare-rush/stutter/triplet/tail-rearrange) feel restrained
      (per the `maxDevices` rule) or still too busy.
- [ ] `--mode live-slices` against Live's own Slice-to-New-MIDI-Track on
      the same file → confirm the printed slice count either matches
      Live's detected count (notes land on the right slice) or the
      mismatch warning was the right call.
- [ ] Audition `break-pattern-<name>` entries once the seeded
      amen/think/funky-drummer transcriptions land (`awh breaks place
      <name> <target>`). This milestone only smoke-tested the place
      mechanism with a scratch entry, not any seeded entry's transcription
      accuracy.
- [ ] Whether the decisions the design left unstated hold up: the ghost
      threshold (-18 dB below the file's loudest slice, 12 dB confidence
      span); the final slice's `end_s` always being the file's end
      (byte-exact, lossless), with tail-decay reported only as a separate
      informational field, never truncating the cut; `--variant` on
      `pattern` being a bare numeric seed offset (BreakSpec has no named
      cell/recipe table to draw a variant from, unlike drums/arp/phrase);
      the low-confidence lockout firing when every slice reads under 0.4
      confidence (not an average); and the fill grammar's chunk-per-device
      split (each selected device gets an equal contiguous slice of the
      fill's length). Revisit if a real run's feel does not match what these
      imply on paper.

## M16 (808 bass) owner checklist

Built per `docs/design/bass-808.md`'s pinned Bass808Spec schema and
semantics: a per-bar weighted cell draw (`packages/core/src/bass/
engine.ts`'s `generate808`), degree-relative pitches with only the root
octave-fitted into `register` (degrees deliberately not re-folded), and the
legato-glide contract: `slide: true` steps are extended to overlap the next
sounding note's start by exactly `slideOverlapBeats` (bar-crossing
included; a slide with no successor falls back to its written length).
`--slides off` reverts every step to plain gates. Three built-ins:
`trap-long` (the design doc's example spec, verbatim), `trap-syncopated`
(off-beat/"and"-heavy cells, more slides, exercises `turnaroundCells`), and
`triplet-flow` (8th-triplet-grid run cells, denser). They are grounded in
the WaivOps HH-TRP full-n mining record (`library/measurements/
waivops-hhtrp-full.json`, n=15,000): beat-1 anchoring in trap low-end
material reads only 49.4% (`stats.per_band.low.position_prob[0]`), and the
off-beat "&" positions read 18-27% across all four beats. Non-anchor
placement is common, which grounds `trap-long`'s octave-answer cell and
`trap-syncopated`'s off-beat cells (comments in
`packages/core/src/bass/spec.ts` cite the figures). The knowledge
`808-style-<name>` fallback (tier printed) mirrors drums/phrase/arp/breaks
and reuses `pickWeighted`/`fitPitchToRegister` from the phrase engine
(`packages/core/src/phrase/util.ts`) rather than re-deriving them.

`pnpm test` green (core 416 -> 450 incl. 34 new: `parseBass808Spec` typo/
degree-outside-degrees/empty-cells rejection + the built-in trap-long
round-trip verbatim from the design doc; a hand-built single-cell fixture
that pins the exact bar-crossing slide overlap, the last-note-no-successor
fallback, and that nothing else overlaps; the `--slides off` negative
control across all three built-ins (zero overlaps, no zero-length/
negative-gap notes); root-fit-without-re-folding (a degree pushing the
pitch outside a narrow register on purpose); the degree-membership property
across all three built-ins and 5 seeds; `--variant` pinning a cell and
being ignored on turnaround bars; turnaround-cell draws landing on exactly
the `turnaroundBar`-th bars; triplet-flow's triplet-grid exactness; and
frozen seeded regressions for all three built-ins across 2 seeds plus a
pinned single-bar note-array anchor; +1 `skill-flows.test.ts` case for the
new section; cli 182 -> 190 incl. 8 new: an end-to-end write against a fake
gateway showing the meta line and the glide-contract note, `--dry-run`'s
notation preview, a `--slides on` vs `off` diff, a malformed `--slides`
value, the unknown-style error naming the `808-style-<name>` convention,
the knowledge-entry style fallback with tier printed via an isolated
`AWH_LIBRARY` (same isolation pattern as `arp.test.ts`/`op.test.ts`, never
the repo's real `knowledge/`), the Set-has-no-scale error, and the
missing-`--at-bar` error); Python untouched (no analysis/python files
changed by this milestone). `skill-flows.test.ts` gate green for `awh bass`.

Smoke-tested against `awh serve-fake`, A minor: all three styles'
`--dry-run` excerpts (trap-long's first bar shows the slide overlap
directly: `1|3 A1 1.05` where the written length was 0.75, extended to
overlap the next note, `1|4 A0 1`, by exactly the spec's 0.05-beat
`slideOverlapBeats`), a write to a session slot that round-trips
byte-identical through `awh clip read`, a `--slides off` diff on the same
seed (`1|3 A1 1.05` -> `1|3 A1 3/4`, the written length restored), an
unknown-style error, and the knowledge-style fallback + an unknown-variant
error through a temp `AWH_LIBRARY` root only (never the repo's real
`knowledge/`). The owner still needs to audition this in Live: synthetic
notes and property tests prove the pinned mechanics as coded, not whether
any of the three built-ins reads as its named idiom, or whether the glide
sounds right on a real mono synth.

- [ ] `awh bass 808 <a real 808/mono-synth track> --key <realKey> --style
      trap-long|trap-syncopated|triplet-flow` on the project this milestone
      was built for, then `awh op apply glide-bass <devicePath>` (or the
      owner's own glide-capable patch) → confirm the slides audibly glide,
      not only play back-to-back. Property tests cannot make this claim:
      they prove the notes overlap by the right amount, not that the ear
      hears a glide.
- [ ] With the same pattern, toggle `--slides off` and re-audition → confirm
      the difference is real and the gated version sounds like a normal
      stepped bassline, not a broken one.
- [ ] Confirm each built-in reads as its named idiom: `trap-long` as
      sparse/held, `trap-syncopated` as busier/off-beat-pushed (including
      its turnaround-bar resolution every 4th bar), `triplet-flow` as the
      modern triplet-run flow, not only mechanically correct MIDI.
- [ ] Audition a knowledge `808-style-<name>` entry once the seeded entry
      lands. This milestone only smoke-tested the fallback mechanism (a
      scratch temp-root entry, tier printed), not any seeded entry's
      musical claims.
- [ ] Skill check: ask a fresh agent to "give me an 808 for this beat" /
      "add a trap 808 with slides" and confirm it reaches for `awh bass 808`
      from the Typical flows entry (not hand-composed notation), states the
      legato-glide contract unprompted, and points at `awh op apply
      glide-bass` (or asks about the owner's synth) rather than assuming
      any patch will do.
- [ ] Whether the decisions the design left unstated hold up: `--variant`
      forcing a named cell (not a rotation/offset, since Bass808Spec has a
      real cell table, unlike arp/breaks) and being ignored on turnaround
      bars (which always draw from `turnaroundCells` when the style defines
      them); the bar-local accent (`accentFirst`) applying only to steps at
      bar-local pos 0, not to every downbeat-ish position; `swing` (all
      three built-ins ship 0) nudging only the "and" of a beat by a plain
      beat delay, the one schema field with no semantics pinned beyond its
      type. Revisit if a real run's feel does not match what these imply on
      paper.
