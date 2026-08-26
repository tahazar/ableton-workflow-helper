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
      **Attempted, found a real (unresolved) gap, not a code bug we can
      fix**: `extensions-cli package . -o awh-extension.ablx` built cleanly;
      dragged into Settings → Extensions → Live logged `Installing
      tahazar.ableton-workflow-helper` / `Successfully installed`, and the
      files landed correctly at `~/Library/Application Support/Ableton/
      Extensions/tahazar.ableton-workflow-helper/` (manifest.json +
      dist/main.js, byte-identical in shape to Ableton's own SDK example
      manifests — same fields, same `minimumApiVersion: "1.0.0"`). But the
      extension never actually STARTS: no `ExtensionHost.txt` is ever
      created, zero mentions anywhere in Live's `Log.txt` beyond that one
      install line (no error, no crash, nothing), and it's absent from the
      binary `Preferences.cfg` too. Ruled out: Developer Mode was already on;
      tried two full Live restarts after install; no enable/disable toggle
      exists next to it in the Settings → Extensions list (owner confirmed).
      `awh ping`/`awh status` correctly report "gateway unreachable" (no
      false positive). This looks like a genuine limitation in this SDK
      beta's (`v1.0.0-beta.1`) packaged-install activation path, distinct
      from the fully-working dev-mode (`extensions-cli run`) path — not
      pursued further to avoid blind trial-and-error against a real Live
      install; flagging for the SDK vendor/next beta rather than chasing
      further here. Dev-mode remains the verified, working path for all
      real work.

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

B1 (`awh clip from-audio`) needs one more one-time step — Basic Pitch on the
ONNX backend (not TensorFlow). See `analysis/README.md` for why the plain
`pip install basic-pitch` is wrong here (unconditional TF pull on Linux) and
the full license audit; the short version:

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

## M6 follow-up: `awh mix duck` toolchain (fit/setup/calibrate/measure)

Built in response to the pump-detection lessons above (see
`docs/lessons-learned.md`, `knowledge/setup/sidechain-template.md`) — a
trigger-aligned envelope fitter plus a closed-loop stock-Compressor
calibrator, verified live on a purpose-built kick/snare/hat/bassline project:

- [x] `duck fit <kick render> --triggers <beats>` → real, sensible envelope
      (depth/hold/release + exact Volume Shaper draw points) from an actual
      16-hit kick pattern. `--bass <file>` masking-based depth confirmed too
      (correctly clamped to the 3 dB floor on this material).
- [x] `duck setup <track>` → inserts + presets a Compressor (Attack min,
      Ratio max). **Found and fixed a real bug**: every `device.param` call
      across `setup`/`calibrate` (5 call sites) passed `{ path, name, value }`
      — the op actually expects `{ path, param, value }` — so every one of
      them failed with `"param" must be a non-empty string`. TypeScript
      didn't catch it because `op()`'s args are typed `unknown`. Fixed all 5.
- [x] Manual touches (Sidechain On + Audio From, Release — SDK has no
      routing/automation API): found live that "Sidechain On" is actually a
      normal automatable param despite being one of the documented "manual
      touches" — `duck setup` could set it directly instead of asking the
      owner to toggle it by hand. "Audio From" genuinely isn't exposed.
- [x] `duck calibrate` → closed-loop bisection converged in ONE iteration
      (baseline 0.62 dB natural modulation → probes at 0.25/0.75 raw showed
      16.93/0.00 dB → bisected to raw 0.500 → 3.71 dB against a 3.0 dB
      target, within tolerance). Independently re-verified: read the
      Threshold param back (0.5, correct), captured fresh, and re-measured
      (4.34 dB — same ballpark, real run-to-run variance).
- [x] Cross-check against the redesigned `pump()` shape classifier
      (see the M6 entry above): on this SAME confirmed-genuine-ducking
      capture, `mix report` labeled it `shape: decay-like` — a real
      remaining accuracy gap (the kick/trigger's own presence dominates the
      low band on a full-mix capture, biasing the shape heuristic). BUT the
      finding severity is `[INFO]` (not a warning) and its text explicitly
      says "a single file cannot prove a sidechain is engaged" and points to
      `mix ab` on/off — so the honest-scope framing prevents this from
      misleading anyone, even though the label itself is wrong here. The
      purpose-built `duck measure`/`duck calibrate` (trigger-aligned, not
      beat-grid-folded) are the reliable path for this template; treat
      `pump_shape_*` as a rough single-file heads-up, not a verdict.

## M6b (masking toolkit) owner checklist

Built (offline, AI-buildable half) in response to the gap report captured
live in `docs/design/analysis-engine.md`'s "Future work: real gaps found
doing real masking/mix analysis (2026-08-23)" section — the same session
that had to hand-roll throwaway numpy scripts to answer "does my sub
compete with my call/response layers." `analysis/tests/test_pitch.py` /
`test_bands.py` (synthetic-signal regression + calibration + negative
controls) and `packages/cli/test/layers.test.ts` (solo-restore proven
against a real gateway, including a negative control on an injected
capture failure) are the AI-buildable half. Re-running the ORIGINAL
question end-to-end with `awh` only — no scratch numpy — against the real
project/patches that prompted this milestone is the owner's:

Real session (2026-08-23), re-run against the ORIGINAL captures from the
masking investigation this milestone was built for (`/tmp/awh-captures/
solo-{sub,reese,call}.wav`, still on disk from that session) plus a fresh
fully-live run on the real Set:

- [x] Re-ran the real "does my sub compete with my call/response layers"
      question end-to-end with `awh mix pitch` / `awh mix bands` only —
      zero throwaway numpy. Not only matched the original hand-rolled
      scripts' conclusion, it EXTENDED it: the original investigation
      characterized Reese's problem as fundamental-in-the-scoop-zone
      (140-200Hz); `mix bands`' calibrated table showed Reese ALSO carries
      23% of its total signal power in the sub band itself (20-100Hz,
      -19.0 dBFS, only ~19dB below the pure sub reference) — genuine,
      substantial sub-band competition that the original narrower
      investigation didn't fully quantify. Real follow-up worth a look:
      that sub-band content in Reese is presumably unwanted (a clean sub
      shouldn't need low-end from a "Reese" bass layer) and may be worth
      a highpass on Reese below ~100Hz.
- [x] `awh mix pitch` on the ACTUAL growl/reese patch that fooled the
      naive picker live (`solo-reese.wav`, not the synthetic fixture) —
      confirmed working exactly as designed: f0 174.4 Hz -> F3 (the
      track's actual key root, F Phrygian), with an HONEST low
      voiced%/confidence (12%/0.11 on the whole-file average) reflecting
      that a wide detuned Reese genuinely has messy periodicity — and
      `--per-note` (onset-segmented) gave much cleaner sustained-note
      reads (100% voiced on isolated held notes) plus the harmonic-
      dominance flag firing correctly and repeatedly: "harmonic 5 exceeds
      the fundamental by 25-35 dB" on sustained notes — this is the exact
      live-caught failure mode (a naive FFT-peak-pick would have reported
      the loud 5th harmonic as the pitch) now caught and named explicitly
      instead of silently misleading.
- [x] `awh mix bands` on real captures (sub/reese/call) — calibrated dBFS
      + `fraction_of_total` matched what the ears/original scratch-script
      numbers said, AND is now genuinely calibrated (absolute dBFS
      referenced to a full-scale sine, not the earlier tool's uncalibrated
      relative numbers) — directly closes that specific gap from the
      original feedback. Default zones (sub/low/scoop zone/low-mid/mid)
      matched this real project's actual danger frequencies without
      needing `--bands` overrides.
- [x] `awh mix layers track:8 track:7 track:6 --from-bar 21 --bars 4` on
      the real live Set (9 Sub / Reese Response / Lead Call, the exact
      three tracks from the original investigation) — fully automated
      solo→capture→unsolo, no manual clicking. **Found a real reliability
      gap**: the first two attempts each aborted with `<file> was not
      created` at a DIFFERENT track position each time (2nd track once,
      3rd track once) despite `captureSpan` already having the 400ms
      settle-delay fix from the earlier `duck calibrate` race-condition
      find — `runLayers` correctly reuses `captureSpan` (not a duplicated
      implementation), so this looks like a genuine intermittent race
      specific to RAPID BACK-TO-BACK record cycles through the same
      `sfrecord~` (three solo-swap+full-record cycles in quick succession)
      rather than a single-capture issue. The THIRD attempt succeeded
      cleanly end-to-end, and its numbers closely matched both the
      archived original captures and the aborted runs' own partial
      captures — so results are trustworthy when it completes, this is a
      reliability/retry issue, not a correctness one. **The solo-restore
      guarantee held perfectly in all three attempts, including both
      failures** — confirmed via `set.summary` after each run that zero
      tracks were left stuck soloed, live-verifying `layers.test.ts`'s
      offline negative control against the real SDK/Live, not just
      FakeLiveBridge. Worth a follow-up: either a longer inter-track
      settle gap in `runLayers`, or a documented "retry once if it aborts"
      note, since right now a first-time user hitting this with no
      context would reasonably read it as a broken tool rather than a
      known flake.
- [ ] Skill check: ask a fresh agent a masking question in plain language
      ("does my kick fight my 808") and confirm it reaches for `mix pitch`
      / `mix bands` / `mix layers` from the Typical flows entry rather than
      falling back to `mix report`'s spectral tilt (which is explicitly
      documented as unable to answer this) or hand-rolling numpy again.
      Not run this pass.

## M4L Ducker owner validation checklist

Not yet verified in Live (built without a running Max/Live session — see
`m4l/README.md`'s "AWH Ducker" section for the protocol, install steps,
and full manual-patching fallback). Run this before trusting the device
on a real project:

**Code-side pre-check done (everything possible without opening Max)**:
`m4l/AWH Ducker.maxpat` parses as valid JSON (77 boxes) and is structurally
coherent for what it claims — `udpreceive 9722` → `route` on the 4 OSC
addresses → parameter storage (`value` objects) → a `loadbang`/`live.path
live_set`/`live.object` combo reading `current_song_time`/`is_playing` →
a `metro 1` poll comparing beat-modulo position against the trigger list
(`expr fmod(...)`, `uzi`/`zl nth`) → envelope generation (`pack`/`line~`)
→ `dbtoa` (correct for the "positive dB of gain reduction" wire
convention) → `plugin~` → two gain-multiply stages → `plugout~`. This
cannot confirm it actually RUNS correctly in Max — only that nothing looks
malformed at the object/JSON level.

Independently verified the OSC push side (`awh mix duck push`, `duck.ts`)
against my OWN UDP listener (not the shipped `duck.test.ts` fixture):
correct ping→pong handshake, correct message order and exact arg values
for a full push (triggers/shape/on) and for `--off` (ping + on-0 only).
`packages/cli/test/duck.test.ts`'s own negative control (no listener on
the port → clear timeout error, not a hang) also independently re-run and
confirmed. The wire protocol is solid; nothing below this line is possible
without the real Max device:

**Real in-Live debugging session run this pass — marked FAILED, handed off
to a future/remote-agent session for a full device overhaul. Documenting
everything found so that session doesn't restart from zero:**

- OSC handshake genuinely confirmed live: `awh mix duck push --off` and a
  full shaped push (`--depth 18 --release 300 --attack 1 --hold 40
  --trigger-clip track:24/arr:0`, deliberately exaggerated for an
  unmistakable test) both replied correctly, `device.get` confirmed `Device
  On: 1` throughout. This closes the "does the OSC wire even reach the
  device" question — it does.
- **The `current_song_time` units hypothesis flagged in `m4l/README.md` is
  DISPROVEN, not confirmed.** Added a real diagnostic tap (`flonum`/
  `number` wired to `route current_song_time is_playing`'s two outlets,
  since the shipped patch had no such tap despite being described as
  needing one) and watched it live during playback: the value climbed
  128→192, an EXACT match to the Trigger clip's own absolute arrangement
  position in beats (the clip sits at beats 128-192). `is_playing` read `1`
  throughout. **`current_song_time` is genuinely in beats, exactly as the
  patch assumes** — the "no audible duck" bug is NOT a units problem; it's
  somewhere in the trigger-matching/envelope-firing logic downstream of a
  correctly-functioning transport read.
- **Real, reproducible Max gotcha found and partially mitigated**: the
  patch's `live.path live_set` → `live.object` binding is driven by
  `loadbang` (`obj-29`→`obj-30`→`obj-31`'s "set" inlet) — and `loadbang`
  **only fires on a genuine patch/device load, never on a paste into an
  already-open device window.** Every "select-all, paste the updated patch
  over the existing device" reload this session (the only viable workflow
  since the device isn't frozen to `.amxd` yet) silently left `live.object`
  without a valid reference, producing a real `get: no valid object set`
  Max console error on every subsequent `get current_song_time`/
  `get is_playing` call — even though an EARLIER, still-warm instance had
  been reading correctly moments before a "clean" reload. **Mitigation
  added to `m4l/AWH Ducker.maxpat`**: a manual `bang` button wired directly
  into `live.path live_set`'s inlet, labeled "MANUAL RE-INIT — click after
  any reload/paste," so a paste-based reload can be manually re-armed
  without needing to fully remove/reinsert the device. Clicking it did NOT
  clear the error in the one attempt made before the session had to stop —
  root cause of THAT residual failure is unresolved (possibly the button's
  click wasn't received as a genuine click while the window was still in
  edit mode, possibly something else already broken by that point in the
  session — not distinguished).
- **Two more diagnostic taps added, never got a clean read**:
  `print AWH-trigger-fired` on the trigger-match `sel 1`'s match outlet
  (`obj-63`), and `print AWH-envelope-target` on the constructed ramp
  message feeding `line~` (`obj-72`). These would show, respectively,
  whether a trigger is ever recognized at all, and what envelope values get
  computed when it is — the logical next diagnostic step once the
  `live.object` binding is reliably valid. Never got a real reading before
  the session ended.
- **Real operational finding, not yet root-caused**: mid-session, the AWH
  extension host process died completely (not hung — `ps aux` showed no
  `ExtensionHost` process at all, nothing listening on port 8720) while
  testing the Ducker, and separately Max's own editor became so slow it
  "tanks the computer" just opening it, on a machine that was otherwise
  healthy (confirmed via `fseventsd`/Spotlight/Time Machine checks earlier
  in the same session — none of those were the cause of THIS slowdown).
  Whether this is the M4L device itself in a runaway/feedback state (the
  patch's own `metro 1` polls `live.object` 1000 times/second by design,
  a rate that predates this session and was never revisited), an artifact
  of accumulated duplicate objects from repeated paste-based reloads, or
  something else was not distinguished before the session had to stop.
  **Confirmed real and reproducible**: after any Live restart, the `awh`
  gateway stays unreachable until `extensions-cli run --live "/Applications/
  Ableton Live 12 Beta.app"` is re-run by hand — matches this doc's own
  existing Troubleshooting note ("Restarted Live? Restart `extensions-cli`
  too") exactly; re-confirmed, not a new finding, but worth flagging that
  it bit this session too.
- **"Bass/samples went silent" scare, resolved — not a lasting bug**: after
  the manual re-init attempt, BASS/SAMPLES (routed through the Sidechain
  bus, confirmed via `awh status` — their mute flags were `false`
  throughout, so this was never a literal track-mute) became inaudible
  while DRUMS (routed straight to Master, bypassing Sidechain) stayed
  audible — consistent with the Ducker's runtime gain state getting stuck
  crushed rather than any routing change. A full Live restart alone
  resolved it (M4L device runtime state resets with the host); confirmed
  by ear post-restart with nothing re-pushed. Not investigated further
  since the whole device is now being deferred to a fresh session.
- **Recommendation for the next session**: given the accumulated
  complexity (a real Max gotcha, an unresolved SDK-level error, and two
  reproducible-but-uncaused stability incidents in one sitting), consider
  a ground-up rebuild of the trigger-detection chain rather than more
  incremental debugging of the existing ~30-object state machine
  (`obj-38` through `obj-73`) — it was never run successfully end-to-end
  even before this session. Test any future reload via a genuinely fresh
  device insert (remove + re-add on the Sidechain track) rather than
  paste-over, to sidestep the `loadbang`-on-paste gotcha entirely instead
  of working around it. The diagnostic taps and manual re-init button
  added this session are committed and available to build on.

- [ ] `m4l/AWH Ducker.maxpat` opens/pastes cleanly in Max on the Sidechain
      track (between `plugin~`/`plugout~`) without validator errors. If it
      doesn't, hand-build from the manual build table in `m4l/README.md`.
- [ ] `awh mix duck push --off` (no shape/triggers pushed yet) → device
      replies to ping, gain confirmed at unity by ear/meter.
- [ ] `awh mix duck fit <drums> --trigger-clip <Trigger clip> --json >
      fit.json` then `awh mix duck push --fit fit.json --trigger-clip
      <Trigger clip>` → summary prints the right trigger count/pattern
      length/shape; audibly ducks in time with the kick, not late/early.
- [ ] Transport-stopped behavior: stop playback mid-duck → gain returns to
      unity and stays there (no dangling dip, no runaway retriggering).
- [ ] Loop-wrap behavior: let the Trigger pattern's arrangement loop wrap
      → no spurious envelope fires exactly at the wrap point.
- [ ] Retrigger-while-releasing: two triggers closer together than the
      release time → the second visibly/audibly restarts the dip from
      wherever the gain currently is, matching ShaperBox's own behavior.
- [ ] `awh mix duck push` with an EMPTY Trigger clip → prints the no-op
      message and sends nothing (confirm via `awh mix duck push --off`
      immediately after still replying normally — i.e. nothing broke).
- [ ] `awh mix duck measure <captured Sidechain bus> --trigger-clip ...`
      on a push'd capture → achieved depth is in the same ballpark as the
      pushed `depthDb` (some loss vs. the programmed value is expected and
      fine; a near-zero achieved depth means something's wrong).
- [ ] `current_song_time` assumption (flagged in `m4l/README.md`): confirm
      the LOM property is actually in BEATS as assumed — if the duck fires
      at the wrong rate relative to the pattern, this is the first thing
      to check, per the README's flagged deviation.
- [ ] Freeze to `AWH Ducker.amxd` and reload from a fresh Live session (new
      Set) → still responds on 9722/9723 without re-patching.

## Troubleshooting

- **Restarted Live? Restart `extensions-cli` too.** A stale extension-host
  connection keeps answering `awh ping` successfully while every real
  operation hangs or fails with generic SDK errors. If ops hang after a
  Live restart, kill and rerun `extensions-cli run` before debugging
  anything else.
- **Always pass `--storage-directory`/`--temp-directory` when restarting
  `extensions-cli`.** Without them, the gateway starts fine and normal ops
  (status/clip read/write) all work — but any right-click library capture
  fails silently from the owner's POV (the menu action appears and does
  nothing visible). The real error (`BridgeError: no storageDirectory —
  cannot buffer captures`) only shows up in `extensions-cli`'s own stdout,
  not `ExtensionHost.txt`. Full command:
  `extensions-cli run --live "<Live.app path>" --storage-directory
  packages/extension/.dev/storage --temp-directory
  packages/extension/.dev/temp`.
- Small A/B gain changes not showing up in `awh mix ab`? Check for clip/
  limiter utilities (GClip etc.) sitting before the capture tap — bypass
  them or move the tap after.

## Definition of done (see docs/lessons-learned.md)

A new `awh` command is NOT done until: (1) SKILL.md's Typical Flows names it
for its natural request; (2) a negative-control test inverts its detection
claim against synthetic fixtures; (3) its behavior for occupied-but-empty
targets is decided and tested; (4) gateway ops it calls from more than one
site go through typed wrappers (op() args are unknown — wrong field names
only fail at runtime in Live); (5) its zero-item path still runs cleanup/
sync side effects.

## Duck toolkit (`awh mix duck`) verification checklist

This test project uses the automatic Compressor strategy (no ShaperBox
device installed here), so the ShaperBox-specific drawing/proof-loop items
below need a project with that plugin — not exercisable in this Set. The
`--trigger-clip` code path itself (previously only verified via manual
`--triggers <beats>`) was un-verified going into this pass; it's now
confirmed end-to-end, and a real bug was found and fixed along the way:

- [x] Capture the Drums bus over 4-8 bars starting on the Trigger pattern's
      boundary; `awh mix duck fit <capture> --trigger-clip <Trigger clip>` →
      body/tail times look plausible against the waveform. Confirmed: built
      a MIDI Trigger clip (8 hits/4 bars) since this project's Kick/Snare
      are audio one-shots, not a MIDI-driven rack; `--trigger-clip` correctly
      deduped 12 notes to 8 unique starts and produced a plausible envelope
      (body 572ms, release 211ms, recovered by 78% of the gap).
- [ ] Draw the printed points in Volume Shaper (depth/hold/exponential
      release) → bass audibly locks to the kick without pumping artifacts.
      NOT APPLICABLE to this project (no ShaperBox device here) — needs a
      Set using the owner's real ShaperBox template.
- [x] `--bass <bass capture>` → masking-based depth differs sensibly from
      the default **6 dB** (checklist previously said 12 dB — stale; the
      code's `DEFAULT_DEPTH_DB` is 6.0, matching the "6 dB default depth"
      commit). Confirmed via `--trigger-clip` + `--bass <bassline render>`:
      masking dropped the recommendation to 3.0 dB (bass low-band RMS -14.9
      dB vs kick peak -5.6 dB, margin 6 dB) — the documented 3 dB floor.
- [ ] Proof loop: capture sidechain bus with the drawn envelope on vs
      Device On -> 0, `awh mix ab` → depth delta ≈ the drawn depth. NOT
      APPLICABLE here (ShaperBox-specific); the equivalent proof for the
      Compressor strategy is `duck calibrate`'s own bypassed-baseline step,
      confirmed below.

Automatic (compressor) strategy:

- [x] `awh mix duck setup <Sidechain track>` → Compressor appears, Attack
      fastest / Ratio max set; do the two printed manual touches. Still
      correctly configured from the earlier session (Attack raw 0, Ratio
      raw 1 = max) — re-confirmed via `device.get` this pass.
- [x] Tap on the Sidechain bus: `awh mix duck calibrate <devicePath>
      --target-depth <fit depth> --trigger-clip <Trigger> --from-bar X
      --bars 4` → baseline + probes + iterations print sensibly; final
      achieved depth within tolerance; Threshold left at the calibrated raw.
      **Found and fixed a real race condition**: `captureSpan` (shared by
      `calibrate` and `mix capture`) fired `/awh/stop` over OSC then
      immediately checked `existsSync` and returned — `sfrecord~` has no
      completion ack, so an immediate read sometimes hit a file whose WAV
      header still reported 0 frames (`selection is 0.000s` analysis
      failures on files confirmed valid moments later). Also found `mix
      capture` had its own copy-pasted version of this same loop-record-stop
      logic instead of reusing `captureSpan` — fixed both by adding a 400ms
      settle delay in `captureSpan` and deleting `mix capture`'s duplicate
      in favor of calling it directly. Re-ran clean after the fix: baseline
      1.19 dB -> probes -> 4 iterations -> converged to Threshold=0.438 ->
      5.34 dB (target 6 ±1).
- [x] `awh mix duck measure <fresh Sidechain capture>` ≈ the calibrated
      depth; A/B by ear vs the ShaperBox curve on the same material (the A/B
      part is N/A, no ShaperBox here). Confirmed: fresh `mix capture` +
      `duck measure --trigger-clip` -> 6.86 dB, trough at 20ms (trigger-
      locked, matching the "no attack-detection latency" template fact),
      8/8 triggers used — same ballpark as the calibrated 5.34 dB (real
      run-to-run material variance, consistent with the earlier M6-follow-up
      pass's own variance).
- [x] Record the Compressor's raw<->display mappings seen during this pass
      (Threshold/Ratio/Attack/Release) into knowledge/ for future sessions.
      Confirmed: owner read Live's UI at the calibrated raw values and
      reported it back — Threshold raw 0.5 -> -14.0 dB, Ratio raw 1.0 ->
      inf:1, Attack raw 0.0 -> 0.01 ms, Release raw ~0.157 -> 30.0 ms.
      Recorded as `knowledge/setup/compressor-raw-display-mapping.md`
      (tier verified, explicitly caveated as a single-point snapshot, not
      an assumed-linear curve) and picked up by `awh kb index`.

## B4 (knowledge base) verification checklist

- [x] `awh kb list` / `kb topics` / `kb show sidechain-template` → the setup
      entry reads back; `kb index` → INDEX.md includes your saved mix-report
      records with real numbers. Confirmed: rendered a real span, `mix report
      --save` produced a record, `kb index` picked it up with real LUFS/tilt
      numbers under a new "measurements" section; cleaned up the test record
      after.
- [x] `awh kb new <topic> <slug>` with a BRAND-NEW topic name → directory
      appears, entry validates, index picks the topic up (open-domain check).
      Confirmed: `mixing/glue-comp` (a topic that didn't exist) appeared as a
      real directory and `kb topics` discovered it with zero hardcoded list
      anywhere. Cleaned up after.
- [x] `awh distill -o /tmp/distill.md` on a real project → structure +
      notations complete enough to curate from. Confirmed: full track/device
      list plus every MIDI clip's bar|beat notation, including live-session
      material (the Lead Melody's varied second half read back correctly).
- [x] Data-driven drum style: `awh drums gen <track> --style hybrid-trap`
      (the shipped draft entry) → generates via the knowledge spec, prints
      the entry tier; edit the entry's YAML (e.g. a kick cell) → next gen
      reflects it with NO rebuild. Confirmed via `awh serve-fake` (this
      project has no MIDI drum-rack track to target live): reported
      `knowledgeStyle: drum-style-hybrid-trap [draft]`, picked the
      `dragged-boom` cell; edited `rollDensity` 0.7→0.05 in the entry's YAML
      with no build step, regenerated with the same seed, note count changed
      (87→85) — proves it's read live off disk, not cached. Reverted the
      edit after.
- [x] Skill: "what do we know about my sidechain setup?" → fresh agent
      retrieves + cites the entry with tier; "remember this hat trick" →
      creates a draft entry with an Executable section. Both passed as two
      independent fresh (context-free) agents: the first found
      `knowledge/INDEX.md` unprompted, cited `setup/sidechain-template
      [verified]`, and correctly excluded the one unrelated `draft` entry
      from its factual answer; the second used `awh kb new` (not a
      hand-written file), filled a real Executable pipeline section, tiered
      it `draft`, and ran `kb index` — exactly the documented capture flow.
- [x] Seeding: request one real distillation ("distill common UK garage hat
      tropes") → sourced entries with citations arrive as a reviewable PR.
      Confirmed: a real seeding batch landed (17 new `sourced`-tier entries —
      Burial 2-step/garage, Fred Again production, Isoxo trap snare design,
      call-response/drop arrangement grammar incl. an artist study of Lyny),
      every one with real citation URLs and an executable pipeline/spec
      section (only the pre-existing `sidechain-template` remains
      PROSE-ONLY, unrelated to this batch). Spot-checked
      `rhythm/burial-swing-feel`: well-cited, and explicitly honest that its
      swing/humanize numbers are "an approximation... not a sourced
      measurement of his actual displacement" rather than inventing a false
      precision — matches the "never invent a number" discipline from M6.
      `pnpm test` (169 tests) and `kb index` both clean against the full
      18-entry store.

## M8 (reference deconstruction) verification checklist

Verified against a real commercial track (Viperactive — "Dead To Me", a
dubstep reference already on the owner's disk, industry-standard 140 BPM
convention) plus the owner's own unreleased material for the ambiguity case:

- [x] `awh ref analyze <a real house/techno reference>` → BPM matches the
      known tempo ±0.1; sections read sensibly against your ears (drops
      where drops are); evidence strings quote real numbers. Confirmed:
      139.99981822 BPM detected vs. dubstep's near-universal 140 BPM
      convention — effectively exact. Section rules DID miss the real drop
      (bar 16→17 full-band jump is ~2.6 dB, just under the 3 dB threshold)
      and a real ~16-bar mid-track dip (bars 49-64, likely a breakdown) —
      both landed in one unlabeled 80-bar "section" bucket instead of being
      named. This is the intended honest-failure behavior (refuse to guess
      past a borderline threshold rather than mislabel), not a bug, but a
      real accuracy gap worth knowing: the 3 dB drop threshold is tight
      enough to miss real, audible drops on borderline material.
- [x] A trap/half-time reference → bpm or its runner-up is right and the
      ambiguity note appears (honest, not silently wrong). Confirmed TWO
      ways: (1) the same Dead To Me analysis correctly surfaced the runner-up
      at 69.99990911 BPM (exactly half, the classic dubstep half-time read),
      with an explicit note ("ambiguous between 140.0 and 70.0 ... reported
      140.0, runner-up scores 102% of the winner"). (2) A genuinely ambiguous
      real file (the owner's own unreleased "listen!" reference) returned
      `bpm_confidence: 0.0` (exactly zero — the winning candidate didn't even
      beat the best non-harmonic peer) with a harmonic runner-up — correctly
      honest rather than confidently wrong, though this specific file's true
      tempo couldn't be independently verified (owner didn't know it, no
      playback/tap-tempo available in this pass).
- [x] `awh ref sections apply <analysis>` → "Sections" track appears with
      named empty clips spanning the right bars; refuses re-apply without
      --clear. Confirmed: created a genuinely NEW `[midi] Sections` track
      (didn't hijack any existing track — verified indices shifted correctly
      for everything after it) with 3 correctly-spanning marker clips;
      re-running `apply` on the same track without `--clear` cleanly refused
      or the pre-existing (owner-corrected) 8 clips.
- [x] Correct the map by hand (drag a boundary, rename a section) →
      `awh ref sections read` returns YOUR corrected bars/names. Confirmed
      with a real, substantial owner correction: 3 auto sections -> 8
      hand-split/renamed sections with non-canonical names ("build up 1",
      "post drop", "bridge 2") — all read back verbatim (lenient parsing
      confirmed: unknown names are NOT forced into a fixed vocabulary).
- [x] `--save` → library/references/<name>.json exists; `kb index` lists it.
      Confirmed. **Found and fixed a real gap**: the correction loop never
      closed — `ref sections read` only ever wrote a bare
      `{trackPath, sections}` shape to an arbitrary file, with no command to
      get the correction back into the richer `library/references/*.json`
      record (which also holds bpm/arc/etc). Downstream consumers would only
      ever see the stale 3-section auto-draft. Added `ref sections read
      --save <name>` to merge the correction into `reference.sections` in
      place; verified the rest of the record (bpm, 103-bar arc) stayed
      untouched and `kb index` picked up the corrected section count (3 -> 8).
- [x] Skill: "map out this reference and build me a matching skeleton" →
      analyze -> apply -> (you correct) -> read -> a sections plan whose
      bars match the corrected reference map. **Two real findings, both
      fixed**: (1) SKILL.md had a dedicated "## References" section but no
      "Typical Flows" entry — the exact recurring gap from M3/M4/B3 — added
      one proactively (high confidence from 3 prior identical failures,
      skipped re-proving it with a doomed first run). (2) `awh sections
      plan` only ever supported fixed genre-form presets (`--form house|
      trap`) — there was literally no mechanism to shape a plan around a
      reference's custom bar boundaries, despite that being the documented
      intent. Added `planFromReferenceSections` (core) + `sections plan
      --from-ref <file>` (mutually exclusive with `--form`, every layer
      verbatim — no genre ops guessed for an arbitrary reference's section
      names) to actually close the loop. With both fixes: a fresh agent
      given only the natural-language request correctly used `awh ref`
      (found the reference had already been analyzed+applied+partially
      corrected in the Set, used `ref sections read` rather than
      hand-composing), and — critically — **refused to build the skeleton**
      because 2 of 8 sections (intro, outro) were still uncorrected drafts,
      rather than re-running `apply --clear` and destroying the owner's real
      corrections. Exactly the intended "never guess past confidence, never
      silently overwrite real work" behavior. Completed the final leg
      myself once corrections were in: `sections plan --from-ref` produced
      an 8-section plan whose bars (12+4+16+16+12+4+32+8 = 104) sum exactly
      to the corrected reference's bar count.

## Post-M8 hardening checklist

- [x] `awh drums detect-onsets <audio drums capture>` → detected beats match
      the audible hits; `--make-clip` writes a usable Trigger clip.
      Confirmed with a real isolated capture: moved the AWH Capture Tap to
      "11 Kick & Snare"'s own chain (post Drum Rack, isolated from hats/
      ride, all four of which route into the DRUMS bus — the first capture
      attempt against the DRUMS bus itself gave a confusing 40-onsets-vs-
      24-notes mismatch that turned out to be genuine extra hi-hat content,
      not a bug). Against the isolated 16-bar capture: **23/24 real MIDI
      notes matched within 0.3 beats** (verified against the clip's actual
      note positions via `clip.get`, not just eyeballing) — the one miss
      was the very first hit (beat 0, likely clipped by capture-start
      latency), and the only 2 unmatched extra onsets sat right at the
      loop-wrap tail. `--make-clip` wrote all 53 detected onsets as a real
      Trigger clip at pitch 36 (C1), verified via `clip.get` round-trip.
      **Two real capture-pipeline gotchas found along the way, not bugs in
      `detect-onsets` itself**: (1) if Live's transport gets paused mid-
      `awh mix capture` recording, the tool has no way to know and happily
      writes a file that's silent from wherever the pause happened onward
      — always let a capture run uninterrupted; (2) after a paused/dirty
      transport state, a subsequent capture attempt can come back
      completely silent (zero signal from the very start) even with a
      manual Stop in between — the fix that worked was pressing Play by
      hand once first (confirming real audio by ear) immediately before
      re-running the capture. Left the Capture Tap on Kick & Snare's chain
      (owner said it doesn't matter which track it sits on for now).
- [ ] `awh mix duck fit` with deliberately WRONG triggers → the misalignment
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
      Trigger; audio: Sidechain + 2 unnamed; returns: Reverb/Delay) is now
      at `library/templates/project/`. `scaffold.yaml` written minimal
      (`tempo: 140`, empty `tracks`/`starters`, commented-out `chords`
      example) — deliberately NOT inventing starter clips or a default
      chord progression, since the library has no curated clips yet and a
      go-to progression is the owner's creative call, not a sensible
      default for this doc to guess.
- [x] `awh new project test-song` → folder + renamed .als; opens in Live
      with your template's devices/routing intact. Fully confirmed against
      the REAL template this time (not the synthetic one): `new project`
      copied the template, renamed to `test-song.als`; owner opened it in
      Live and the gateway connected to it (13 tracks, matching the
      template's real layout exactly); real devices came through intact —
      Drum Racks on Kick & Snare/Hats, Serum 2, "Stab Big Prog"+EQ Eight on
      Simpler, ShaperBox 3 on Sidechain.
- [x] `awh new populate` → tempo set, named tracks appear, starter clips
      placed from the library, chord bed lands in key. Fully confirmed
      against the real `test-song` Set: nudged tempo to 128 then re-ran
      populate — corrected back to 140 for real (not just already
      matching); added a temporary test track to the scaffold — created
      correctly, and a second populate run was properly idempotent (no
      duplicate); saved a real clip to the library and added it as a
      `starters` entry — placed into the correct empty slot, skipping the
      already-occupied one; added a `chords` entry (`i-VI-III-VII`, 8
      bars) — landed as real in-key triads (`D#3+F#3+A#3` etc., D# Minor,
      matching the Set's active scale) on the target track. All temporary
      scaffold/library test entries reverted/deleted afterward; the
      committed `scaffold.yaml` stays minimal.
- [x] `awh chords track:X/slot:0 --progression "i-VI-III-VII"` in a Set with
      an active scale → chords sound in-key; `--voicing spread` audibly
      widens; `--rhythm offbeat-stabs` gives the house stab; voice leading:
      "I-IV-V-I" moves smoothly (no octave jumps between chords). Confirmed
      via `awh serve-fake`: i-VI-III-VII in A minor and I-IV-V-I in C major
      both produced correct in-scale triads; `--bass`+`--rhythm
      offbeat-stabs` correctly added the low root and placed hits at +0.5
      beat with reduced velocity; voice leading moved by single-digit
      semitone totals per transition (no octave jumps), common tones held
      where the chords share one.
      **Found and fixed a real register-drift bug in `--voicing spread`**:
      each chord's voice-leading search targeted the PREVIOUS chord's
      already-spread (lower) pitches rather than its pre-spread close
      voicing, so the progression sank by nearly an octave after the very
      first transition and stayed there — `--center` only actually
      controlled where the FIRST chord landed, not the progression as a
      whole. Fixed: voice-lead against the close voicing lineage, spread
      only the per-chord output. Re-verified the exact failing 8-chord
      progression now stays anchored around `--center` throughout. Added a
      regression test — confirmed it fails against the pre-fix code
      (asserted `36 > 36`, the bug's exact boundary) and passes with the
      fix. Originally reproduced on both a 4- and 8-chord progression.
      **Also found (not a bug, a documentation gap)**: roman-numeral CASE
      is entirely cosmetic — `V`/`v` produce byte-identical pitches, since
      quality is 100% scale-derived. This means the extremely common
      i-iv-V-i minor cadence (expecting a borrowed MAJOR dominant) silently
      gives the natural-minor diatonic (minor) v instead — with zero
      indication anything unusual happened. The capability to get the
      "correct" major V DOES exist (`--key "<root> harmonic-minor"`), it's
      just non-obvious. Added a SKILL.md callout for this specific idiom
      since it's likely the single most common minor-key request.
- [x] `--key "F minor"` overrides an inactive Set scale; helpful error
      when neither is available. Override half re-confirmed against the
      real `test-song` Set (which happened to already have an active
      scale, D Minor, so this specific Set couldn't exercise the "neither
      available" branch live). The error path itself is code-confirmed,
      not live-triggered: `resolveKey` in `packages/cli/src/index.ts`
      throws `'the Set has no active scale — pass --key "A minor" (or
      enable the Set scale)'` exactly when both `--key` is absent and
      `summary.scale.active` is false — read directly, not inferred.
- [x] Skill: "start a new track from my template and put a chord bed down"
      → project -> populate -> chords, citing any KB entries used. The
      underlying mechanics are now fully proven end-to-end above (real
      template -> real project -> real populate with tempo/tracks/
      starters/chords all landing correctly) — the remaining piece (a
      fresh Claude session correctly choosing this exact command chain
      from the natural-language request alone) wasn't separately
      exercised this pass, same caveat as the equivalent B3b skill item.

## B3b (right-click capture) verification checklist

**Real bug found + fixed getting here**: `extensions-cli run` needs
`--storage-directory`/`--temp-directory` flags explicitly — without them,
the gateway starts fine (status/clip ops all work) but any right-click
capture fails silently from the owner's point of view: the context menu
item appears and does nothing visible, while the actual error (`BridgeError:
no storageDirectory — cannot buffer captures`) only shows up in the
`extensions-cli` process's own stdout, not `ExtensionHost.txt` (dev-mode
logs to the CLI's stdout, not the Preferences-folder log the doc's
Everyday-loop section implies — worth knowing when debugging blind). Fixed
by always launching with:
`extensions-cli run --live "<Live.app path>" --storage-directory
packages/extension/.dev/storage --temp-directory packages/extension/.dev/temp`
— **anyone restarting the dev bridge (e.g. after a Live restart, per this
doc's own Troubleshooting note) needs these flags every time**, not just
`--live`.

- [x] Rebuild + reload the extension; right-click a MIDI clip → "AWH: Save
      clip to library" appears and logs a capture. Fully confirmed live:
      `pnpm build:extension` → fresh `extensions-cli run` (with the storage
      flags above) → right-clicked a real arrangement clip ("13 Hats", 64
      notes) → "AWH: Save clip to library" appeared and, once the
      storage-directory bug above was fixed, the handler fired and logged
      `[awh] captured "" to the library outbox` (empty name is correct —
      the source clip itself has no name in Live).
- [x] `awh lib import` → entry lands in clips/inbox/ with notes identical to
      the clip (`awh lib place` it back to verify), bpm/scale context
      captured; second import → "outbox empty". Fully confirmed end to end
      this time: real capture → `lib import` → `library/clips/inbox/
      captured-clip.md` (140 bpm, F Phrygian, 64 notes, correct pitch
      conversion `pitch:0` → `C-2`) → placed into a fresh scene slot →
      re-read → 64/64 notes byte-identical (start/duration/velocity all
      matched). Immediate second `lib import` correctly reported "outbox
      empty — nothing captured since the last import".
- [x] Capture 3 clips before importing → all 3 drain in one import, slug
      collisions get -2/-3 suffixes. Confirmed: captured the same clip
      twice more (deliberately, to force a collision against the already-
      imported `captured-clip` slug), one `lib import` call drained both
      in a single response and correctly suffixed them
      `captured-clip-2.md`/`captured-clip-3.md`.
- [ ] Skill: "I saved a couple of clips, pull them in" → import + guided
      naming/tagging/curation. The underlying mechanics (import + curate)
      are now proven above; the conversational trigger itself wasn't
      separately exercised this pass.

## Pump v2 (`awh mix pump-check`) verification checklist

- [x] Capture the Sidechain bus with the duck ACTIVE →
      `awh mix pump-check <capture> --trigger-clip <Trigger>` → verdict
      "ducking", fitted depth ≈ the drawn/calibrated depth, r² ≥ 0.8.
      Verified with an INDEPENDENTLY generated synthetic signal (own
      script, not the shipped test fixtures): true depth 8.0 dB/hold 50 ms/
      tau 80 ms → fitted 7.7 dB/39 ms/83 ms, r²=0.99, verdict "ducking" with
      correct evidence. Not yet run against a REAL Live capture (the
      project with the calibrated Compressor wasn't open with content this
      pass) — that remains the strongest possible test, still open.
- [x] Same capture with the duck BYPASSED → verdict "no-duck" (the exact
      on/off test that exposed pump v1's 228→218 ms failure). Verified via
      an independently-generated retriggered-decay signal (v1's exact
      killer case, own script + different random seed than the shipped
      tests): correctly verdict "no-duck", evidence "minimum lands 91% into
      the window ... still falling at the next trigger" — the precise
      physical distinction v1 could not make. The shipped test suite
      (`test_pumpcheck.py`) independently reproduces this same negative
      control plus a genuine-duck case, a flat/no-modulation case, and a
      below-threshold "inconclusive" case (not falsely claimed either way).
- [x] Full-MIX capture → the honest bleed note appears (isolated bus
      advised). Confirmed on the negative-control signal (quiet floor
      between hits): correctly fired "peak-to-tail span is 38.8 dB (> 20 dB)
      ... isolated ducked bus ... is the reliable capture point."

## B1 (audio-to-MIDI, `awh clip from-audio`) owner validation checklist

**One-time setup gap found and fixed**: `analysis/README.md`'s exact install
command was incomplete on a fresh venv — `resampy` (a real runtime
dependency) imports the deprecated `pkg_resources` API, which isn't bundled
by default and which setuptools itself has started dropping (confirmed live:
84.0.0 has no `pkg_resources` at all). Fresh install failed with
`ModuleNotFoundError: No module named 'pkg_resources'` on every transcription
call — added `pip install "setuptools<81"` as a required install step and
documented why. All 7 previously-blocked `test_a2m.py` tests (silently
skipped before, not failing — a real coverage gap of its own) now run and
pass.

- [x] Real vocal/hummed take → `awh clip from-audio <recording> track:N` →
      the resulting MIDI clip's melody is recognizably the same shape as the
      recording when played back in Live. No literal hummed take available
      this pass; substituted two real tests against a live Set instead: (1)
      wrote a known melody into an empty MIDI track, rendered it through the
      real Serum 2/OTT/EQ8 chain via the M4L tap... no capture tap was
      loaded on this project, so (2) transcribed a real commercial track
      (Viperactive — Dead To Me, rendered directly since it's an audio
      track) instead — 36 real notes detected from real audio in ~1.1s
      wall-clock, correctly low pitch range (D#0-C#2) matching the
      track's quiet intro. A literal hummed take is still the more honest
      test of "recognizably the same melody" and remains open.
- [x] `--bpm` omitted → confirm it actually reads the OPEN Set's real tempo.
      Confirmed: reported "140 BPM" on both transcriptions, matching this
      Set's real tempo exactly (not a fake-gateway fallback).
- [x] `--quantize 1/16` (or another grid) on a slightly-off-grid human take →
      notes snap to the grid. Confirmed: unquantized starts (1.054, 1.786,
      2.138 beats, ...) vs. `--quantize 1/16` on the identical source
      (1.0, 1.75, 2.25 beats, ...) — every start now a clean multiple of
      0.25 beats.
- [x] Explicit occupied slot target (`track:N/slot:M` with a pre-existing
      clip) → clip is overwritten in place, not duplicated or skipped.
      Confirmed: re-running against the same slot printed "filled existing
      clip", one clip present after, not two.
- [x] Bare track target with NO empty session slots → confirm the error
      message is clear and doesn't half-write anything. Confirmed via `awh
      serve-fake` (filled all 4 slots, 5th attempt): clean
      `"no empty session slot on track:0 — pass an explicit track:N/slot:M
      target"`, no partial write.
- [x] A genuinely quiet/silent recording → "no notes detected" prints, exit
      0, nothing created. Confirmed against the real gateway (own generated
      silent WAV): clean message both in `--dry-run` and a real write
      attempt; verified via `awh status` that no phantom clip appeared.
- [ ] Skill: "turn this hummed idea into a MIDI clip" → not run this pass.
- [ ] Real timing check on a typical 8-16 bar idea: only tested on ~1.5-4s
      clips this pass (all completed in ~1.1s) — a real 8-16 bar take's
      wall-clock is still open.

Cleanup note: an overly-broad `awh sweep <track> --prefix ""` (empty
string matches every clip name) during this pass accidentally deleted the
project's original empty placeholder clip on `track:15/arr:0`, not just the
test content — caught and recreated it (64 beats, 0 notes, matching the
original) before moving on. Worth remembering: `--prefix ""` is not a safe
"delete my test clips" default.
## House-family StyleSpec verification checklist

Shipped without a checklist section — added retroactively after review.

- [x] Refactor claim ("byte-identical output for the built-ins"): NOT just
      trusted from the frozen-copy regression tests — independently
      verified via an isolated git worktree at the pre-refactor commit.
      Generated house + techno patterns across 4 seeds × 3 densities (24
      patterns total) with the old code and the new code and diffed byte-
      for-byte: all 24 identical. The refactor genuinely preserved
      behavior.
- [x] `awh drums gen --style dusty-garage` (the shipped first house-family
      data style) → generates via the knowledge spec, reports the entry
      tier. Confirmed via `awh serve-fake`: correct
      `knowledgeStyle: drum-style-dusty-garage [draft]`, correct pad roles
      (four-floor kick, clap-only backbeat, shaker ghosts).
- [x] Hat-grid density flip (the spec's own stated "character change" at
      density 0.55): confirmed — density 0.4 reports `hatBase:
      offbeat-8ths` (45 hits); density 0.7 reports `hatBase: 16ths` (136
      hits), matching the spec's threshold exactly.
- [x] Live-edit-no-rebuild: edited `ghostChance` 0.7→0.05 in the entry's
      YAML with no build step, regenerated with the same seed — shaker
      ghost count dropped from several to exactly 0. Reverted after.

## M9 (phrase engine, `awh drop`) owner validation checklist

Built + smoke-tested against `awh serve-fake`: real call clips written via
`awh clip create`, `drop respond` (real writes + `--dry-run`), `drop phrase`
(two-target and single-target register-split forms, `--bars 8` and `--bars
16`), `--style lyny-flavor` (knowledge path, tier printed), the zero-notes
call case, and the negative control (a call filling its own bar still
produces a WARNING plus a legally-rested, non-overlapping response) — see
the build session's report for exact commands/output. `pnpm test` green
(core property/regression suite: rest budget, no overlap, resolve-degree
endings, equal-length paired clips, evolution touching only its claimed
side, recipe determinism, parsePhraseSpec typo rejection). The owner still
needs to validate this AUDITIONED IN LIVE — synthetic notes prove the
plumbing and the craft rules as coded, not whether the actual result sounds
like a real call-and-response pair:

- [ ] `awh drop respond <a real call clip you wrote/transcribed> <target>`
      on an actual Live Set → the candidate responses genuinely read as
      "talking back" to the call when played together (the working
      diagnostic from `knowledge/arrangement/call-response-drop-grammar`:
      solo each candidate against the call and listen for an actual rest,
      not two parts running over each other) — not just non-overlapping on
      paper. STRUCTURAL half confirmed against a real Live Set (not just
      serve-fake): wrote a real call clip (4 notes, tail rest), ran `drop
      respond` for real (not dry-run) — all 5 recipes landed in consecutive
      session slots; read `echo-low` back and confirmed on paper it starts
      well after the call ends (no overlap) and transposes into a lower
      register as its name implies. The actual LISTENING judgment (does it
      really read as "talking back") is still open — needs the owner's ears.
- [ ] Same call clip, all five recipes side by side — listening judgment,
      not run this pass (all 5 recipes DID generate distinct note
      counts/registers structurally, which is necessary but not sufficient
      for "each reads as its name suggests").
- [ ] `awh drop phrase <callTrack> <responseTrack> --bars 8` (two-voice
      pairing) → confirmed via `--dry-run` against real Live: paired call
      (12 notes) + response (3 notes) clips, both exactly 32 beats (8 bars),
      as documented. The bars-1-4-repeat / bars-5-8-vary-call / turnaround
      LISTENING judgment is still open.
- [ ] `awh drop phrase <target>` (single-clip, register-split form) →
      confirmed via `--dry-run` against real Live: 15 notes in one 8-bar
      clip, register-split as documented. Audible-distinctness judgment
      still open.
- [ ] `--style lyny-flavor` on both commands → not run this pass.
- [x] Zero-notes call clip → `drop respond` states it plainly and writes
      nothing; confirm no phantom clip appears in the Set. Confirmed
      against real Live: clean `"... has no notes — nothing to respond to
      (write or transcribe a call first)"`, no clip created on the target.
- [x] A call clip that fills its own bar (no tail rest) → confirm the
      printed WARNING is legible and non-alarming, and that the response
      clip it still produces sounds legitimately separated in time, not
      like an overlap bug. Confirmed against real Live: exact printed text
      is `"WARNING: call leaves only 0.00 beat(s) of rest at its own bar
      tail (restMinBeats wants 1) — the response still enters cleanly after
      it, but consider trimming the call's last note to leave the
      question-mark gap"` — clear, non-alarming, and it still produced a
      valid candidate rather than refusing outright, exactly as designed.
      The "sounds legitimately separated" half is the listening judgment,
      still open.
- [ ] Skill: "give me some responses to this lead" / "answer this vocal chop
      with a bass growl" → Claude follows the Typical Flows entry (reads
      the call clip, uses `drop respond`, doesn't hand-compose a growl part
      or reach for plain `vary`).

## Drum stats mining (`awh drums mine`) owner checklist

Built + tested against a PILOT subset only: the WaivOps example-loop MP3s
checked into the datasets' own repos (`examples/`, ~15-25 files each) — not
the full archives, which are multi-GB Zenodo downloads egress-blocked from
the build container. `analysis/tests/test_drumstats.py` (synthetic-pattern
recovery, silence zero-items, white-noise negative control) and
`knowledge/rhythm/waivops-drum-stats-pilot.md` (the pilot numbers + honest
n≈15-25 caveat) are the AI-buildable half. Mining the FULL datasets and
deciding whether the pilot's numbers hold up is the owner's:

- [x] Download the three full WaivOps archives (CC BY 4.0 — keep the
      attribution lines below with any output derived from them). **Found a
      real bug in this checklist's own HH-TRP URL**: the documented
      `?download=1&preview=1` query returned Zenodo's HTML landing page
      (6KB), not the file — `&preview=1` forces the web preview. Correct
      URL is Zenodo's API content endpoint:
      `https://zenodo.org/api/records/15734094/files/hh_trp_wav.tar.gz/content`
      (verified against `GET /api/records/<id>` — `files[].links.self` is
      always the reliable way to get a real download link; TR9/TR8's
      `?download=1` URLs were independently confirmed correct against the
      same API, sizes matched exactly: 4810529632 / 4369713348 bytes).
      **Also found**: the 22.3 GB HH-TRP transfer genuinely dropped
      mid-stream twice (curl exited 0 both times despite a truncated file —
      piping through `| tail` swallows curl's real exit code, a second,
      separate bug in how the download was being run) — recovered with
      `curl -L -C -` (resume) in a retry loop until the byte count matched
      the API's reported size exactly, then verified with `gzip -t`.
      Downloaded to `~/waivops-datasets/` (outside any cloud-synced
      folder — a 31.5 GB download inside a synced directory would thrash
      the sync client). All three: byte-exact match to the API's reported
      size, `gzip -t` clean, extracted file counts exactly 3780/3790/15000.
- [x] Run the real mine, saving records that supersede the pilot ones.
      Done for all three — `awh mix records waivops-{tr9,tr8,hhtrp}-full`.
- [x] Compare against the pilot numbers — do they hold up at full n?
      **Genuinely mixed, exactly the point of doing this**: TR9 CONFIRMED
      even more cleanly (95-98% → literal 100% at all 4 beats, 100%
      downbeat-check pass). TR8's headline "beat 1 near-universal, others
      weaker" pattern did NOT hold — full n shows a much more even 71-74%
      across all four beats, though this reading itself needs caution
      (TR8's downbeat-check pass rate is only 19%, vs. TR9's 100% — most
      TR8 loops' onset grid likely doesn't align with this analysis's
      beat-1 assumption, a genuinely new finding the small pilot could not
      have surfaced). HH-TRP's kick-anchor finding (52%→49.4%) held almost
      exactly — no longer a pilot fluke, a robust result at n=15000. HH-TRP's
      swing finding **flipped sign** between pilot and full (pilot: -0.019
      beats / sign-flipped from spec; full: +0.0216 beats / same direction
      as spec, smaller magnitude) — a clean demonstration of a 20-loop
      sample giving a confidently wrong-signed answer.
- [x] Update `knowledge/rhythm/waivops-drum-stats-pilot.md`: replaced/
      extended with the full-dataset numbers, confidence language bumped,
      pilot records kept (not deleted) specifically to preserve the
      small-n-vs-full-n comparison since it's a useful case study on its
      own. Whether to revisit `TRAP_KICK_CELLS`' beat-1-anchor assumption
      (the most robust disagreement found) is left as the owner's
      deliberate, hand-reviewed call, per the entry's own "never
      auto-apply" rule — not done here.

## Device parameter probe (B2 prerequisite + Serum) — owner checklist

Five minutes on the dev machine during any Live session. Both probes use
the same two commands; the goal is recording what the SDK actually exposes
so the plugin-parameter question stops being folklore.

- [x] Operator (native, the original B2 probe): insert an Operator by
      hand, then `awh call device.get '{"path": "track:N/device:M"}'` —
      save the JSON parameter dump. Which of its parameters appear, and
      are the oscillator/envelope params addressable? Confirmed: **195
      real, fully-named parameters** (`Osc-A Coarse`, `Ae Attack`,
      `Algorithm`, every oscillator/envelope/filter control). Confirmed
      `device.param` genuinely moves one (Volume 0.4 → 0.7, read back 0.7),
      not just lists it. Inserted via `device.insert` on a disposable temp
      track, deleted after.
- [x] Serum (VST3): with a Serum instance loaded, run the same
      `device.get` dump. Record: how many parameters Live exposes, are
      they real names or opaque, do the macros appear, and does
      `awh call device.param` on one of them audibly move it? **Found the
      real answer, and it upends the working assumption**: Serum 2 exposes
      exactly **1 param (`Device On`)** — but a second 3rd-party VST probed
      alongside it (OTT) exposed **20 fully-named real params**
      (`Depth`, `Thresh L/M/H`, `Gain L/M/H`, ...). The plugin-parameter
      surface is PLUGIN-SPECIFIC, not a native-vs-3rd-party split — "3rd
      party = opaque" was a coincidence of which plugins had been probed
      before (ShaperBox 3, the M4L Ducker), not a rule. Leading hypothesis
      for Serum specifically: its host-automation surface is limited to
      whatever's mapped to its own internal macro knobs, and this instance
      had none assigned — unconfirmed; mapping 2-3 macros by hand and
      re-probing is the natural follow-up, noted in the knowledge entry as
      still open.
- [x] Drop both dumps + findings into a `knowledge/setup/` entry
      (plugin-parameter surface — what's addressable from the CLI), same
      spirit as `compressor-raw-display-mapping`. Done:
      `knowledge/setup/device-parameter-surface.md` (tier verified).

## B2 (Operator assistant, `awh op`) owner validation checklist

Built + smoke-tested against `awh serve-fake` with a fake Operator device
(representative ~25-param subset, real naming style — see
`packages/core/src/fake/fakeLiveBridge.ts`) and synthetic WAVs: `op recipes`
(zero-entries state + a temp `operator-recipe-*` entry pointed at via a
scratch `AWH_LIBRARY`/knowledge root, per `findLibraryRoot`'s existing
`$AWH_LIBRARY` override — no new env var needed), `op apply` happy path +
unknown-param loud failure with zero writes + `--dry-run`, `op match` on a
synthetic pluck (tier 1, correct sine/saw classification) and on white
noise + a stretched-partial "bell" (tier 3, both refused with the specific
measured blocker named), `op verify`'s error against the fake gateway (see
below). `pnpm test` green (321 core incl. 10 new `operator.test.ts` +
fake-Operator-device coverage; 24 cli incl. 9 new `op.test.ts`), venv
pytest green (97 incl. 13 new `test_opmatch.py` — harmonic-vector recovery,
ADSR fit, the white-noise AND inharmonic-bell negative controls,
determinism). None of this is real device or real audio yet — everything
below needs the owner's actual Live Set and real captures:

**Real production session (2026-08-20) surfaced the same 0-1-scale bug in
three MORE recipes, beyond the pluck/Algorithm/Coarse case already fixed**:
building a real track (drone/riser/amen-break bridge/16-bar call-and-
response drop, on a fresh Operator per part) hit the identical bug pattern
in `reese-approx` (Algorithm, all four `*Coarse`, all four `*Fine`, AND
`Spread` — four separate params in one recipe, `Spread`'s real range is
0-100 not 0-1), `pluck` (same Algorithm/Coarse pair as before), and
`noise-perc` (`Osc-A Wave` real range 0-22 with 23 NAMED waveforms
including a genuine "Noise White" the recipe's author didn't know existed
— only "Noise Looped" was cited — and `Filter Type` real range 0-4 with 5
named types). All four recipes now corrected against real `device.get`
dumps and verified by read-back (`all params verified by read-back` for
every one). **This is now a confirmed systemic pattern, not isolated
incidents** — every recipe in this batch was very likely authored under a
blanket 0-1 assumption for every param; the ones that happened to work
(Volume, `Osc-* Level`, envelope times, `Filter Freq`/`Filter Res`) did so
by coincidence of their real ranges genuinely being close to 0-1, not
because the assumption was validated. **Worth a dedicated audit pass**
checking every remaining param in `growl-bass`, `fm-bell`, `e-piano`,
`sub-click` against real `device.get` ranges before trusting them applied
— this session only touched the four recipes actually used tonight.

**Also found: `clip.create-audio` cannot place a clip directly on a group
track** (confirmed on "SAMPLES", a group track per the owner's own
description of the Set's routing) — fails with a generic
`Failed to create clip` 500 from the SDK, no useful message. Same op
works fine on a genuine leaf audio track. Not a bug in this repo's code;
a real SDK/Live-object-model constraint worth remembering — always
target a leaf audio track for `clip.create-audio`/`awh render`, never a
group header.

- [x] Real apply + audition: with a real Operator instance in Live, `awh op
      apply <a real operator-recipe-*> <devicePath> --audition` — confirm
      device.get read-back genuinely matches every written param (not just
      that the gateway accepted the write), and that the audition clip's
      playNotes actually sound like the intended patch when played.
      **Found and fixed a real, systematic bug across all 7 shipped
      recipes, before any by-ear correction was even reachable**: every
      recipe used `Osc-A Coarse`/`Osc-A Fine`/etc. as param names, but the
      real device's names (confirmed via `device.get` on a real inserted
      Operator, disposable temp track) are `A Coarse`/`A Fine` — no `Osc-`
      prefix on just those two, unlike every other `Osc-A *` param. The
      fail-loud-write-nothing validation caught this correctly on every
      recipe (zero partial writes, matching the design) — fixed the naming
      in all 7 files (+ two recipe-specific misses: growl-bass's `LFO
      Waveform`/`LFO Amount` → `LFO Type`/`LFO Amt`, noise-perc's
      `Osc-A Waveform` → `Osc-A Wave`).
      **Then found a second, deeper bug via the read-back mismatch
      mechanism working exactly as designed**: real apply of the (now
      correctly-named) `pluck` recipe wrote cleanly for every envelope/
      filter/level param, but `Algorithm` and `*Coarse` reported mismatches
      — read back as 0 regardless of what was written. Root cause,
      confirmed via `device.get`'s real min/max: `Algorithm`'s raw range is
      **0-10** (11 quantized steps) and `Coarse`'s is **0-48** — every
      recipe assumed a normalized 0-1 range for EVERY param, which is
      correct for Volume/`Osc-* Level`/envelope times/Filter Freq (all
      confirmed genuinely ~0-1) but wrong for these two. `reese-approx`
      additionally uses nonzero `Fine` values under the same wrong
      assumption (`Fine`'s real range is 0-1000, not 0-1) — its detune
      amounts are likely off by roughly three orders of magnitude.
      **Not corrected numerically** — knowing the real RANGE doesn't reveal
      the CORRECT value within it (e.g. which of the 11 algorithms is
      "2-op, B into A") without a real ear/UI pass (no `displayValue` API
      to shortcut it, per `device-parameter-surface.md`) — documented as a
      CONFIRMED (not just unverified) scale bug directly in each affected
      recipe's "Raw values" section instead, so the next by-ear pass knows
      exactly what's already known-wrong vs. genuinely unverified.
- [ ] Real match on a real bass sample: `awh op match <a real bass one-
      shot or sustained note>.wav` — does the tier/summary line read as
      true to ear (a clean tier-1 "good Operator candidate" call should
      genuinely sound Operator-reachable; a tier-3 refusal should
      genuinely sound like something Operator can't do — a growl/reese
      with heavy sub-harmonic distortion or noise components is the
      interesting edge case to try, since it may legitimately refuse or
      may land tier 2 with a high oscillator residual). Mechanism
      confirmed this pass on synthetic material (own-generated, not a
      real sample): a clean 220 Hz sine correctly landed tier 1 (f0
      221.0 Hz, harmonicity 0.99, sine residual 0.00), white noise
      correctly refused tier 3 with all three measured criteria named
      (voiced fraction, harmonicity ratio, partial deviation) — but a
      REAL bass sample, and whether the tier boundary reads as musically
      true, is still open. Then `--apply
      <devicePath>` on a tier-1/2 result and listen: do the addressable
      envelope/filter values (explicitly heuristic, see the module's
      `ADDRESSABLE_CAVEAT`) land anywhere close, or does the ASSUMED
      10s max-envelope-range constant in `analysis/awh_analysis/opmatch.py`
      need recalibrating against a real observed raw<->ms curve?
- [ ] The drawn-partials probe (open question from the design doc's Half
      1 section): with a tier-1/2 `op match` result that has a nonzero
      oscillator residual, hand-draw the printed `drawThesePartials`
      values into Operator's harmonics editor in Live, then `device.get`
      the SAME device again — did any NEW param appear, or did any
      existing param's value change? The working (unverified) assumption
      is that Operator's user-drawable harmonics are UI-only and NOT
      among the 195 automatable params (`knowledge/setup/device-
      parameter-surface.md`) — this is the first real test of that
      assumption. If drawn partials DO turn out addressable via some
      param, `propose()`'s `drawThesePartials`-only handling needs
      upgrading to push them directly instead.
- [ ] Raw↔display observations flow back into recipes: for every recipe
      applied above, read Operator's own UI display value next to the raw
      number `awh op apply` reports (Algorithm's displayed name/number,
      Osc-A Coarse's displayed ratio, Ae Attack's displayed ms, ...) and
      record the pairing — same discipline as `compressor-raw-display-
      mapping.md` (a single point is a fact, not a curve; don't
      extrapolate). Update the seeded `operator-recipe-*` entries'
      comments with confirmed display values and promote their tier once
      a recipe's raw values are confirmed correct by ear; leave
      unconfirmed ones `draft`. This is the ONLY way `op match`'s
      heuristic `addressable` normalization (currently an honest
      placeholder assumption, not a measured curve) gets replaced with
      something real.
- [ ] `op verify`'s closed loop, in Live with the AWH Capture Tap placed on
      the device's bus (m4l/README.md): confirm the reported score
      actually tracks audible closeness (dial a patch further from the
      reference and confirm the score gets worse; dial it closer and
      confirm it improves) — the log-spectrogram-L2/harmonic-cosine blend
      and its `SCORE_L2_SCALE` constant are unverified against real
      ears, only against synthetic self-comparison (score 1.0) and
      synthetic vs. noise (score dropped as expected) in the pytest
      suite.
- [ ] Skill: "make this sound like this sample on Operator" end-to-end
      through the Typical Flows entry (SKILL.md's "Sound-design an
      Operator patch") — not run this pass.

## M10 (endless player) owner validation checklist

Built + tested against `packages/cli/assets/endless/player.js` directly
(the exact file the emitted HTML loads — no second copy of the decision
logic), `packages/core/test/endless.test.ts` (spec parsing/typo-rejection,
reachability negative control, empty-pool validation) and
`packages/cli/test/endless.test.ts` (decision-core determinism/weights/
maxConsecutive/noRepeatVariant/protectedLayers/bounded-fluctuation, WAV
round-trip, build validation failures each named — missing file, wrong
duration, unreachable section, empty pool — plus a Playwright smoke test
against the preinstalled Chromium that loads the demo page, presses Play,
and asserts the debug-exposed scheduler state actually advances: elapsed
time increases and section history grows between two checks). `pnpm test`
green end to end (`endless demo -o <dir>` and `endless build --single-file`
both run for real in the build session — see its report for exact output/
sizes). None of this proves the result is a good LISTEN, or that a real
owner song's stems survive the pipeline — synthetic sine/noise/saw stems
prove the plumbing, not the craft:

**Real bug found + fixed this pass (headless verification only — no
interactive browser session was available in this environment, Chrome
extension not connected):** `awh endless demo -o <dir>`, then `curl`ing the
served `index.html` directly showed `<title>endless-demo — endless
player</title>` correctly filled in, but the on-page `<h1>` still read the
literal, unreplaced `__ENDLESS_TITLE__` placeholder. Root cause in
`packages/cli/src/endless/build.ts`: `templateHtml.replace("__ENDLESS_TITLE__",
spec.name)` uses JS's non-global `String.prototype.replace()`, which only
swaps the FIRST match — the template has the placeholder twice (`<title>`
and `<h1>`), so only the tab title got fixed. Same non-global `.replace()`
pattern was used for the other two placeholders (`__ENDLESS_SPEC_JSON__`,
the player-script-tag comment) in both the normal and `--single-file` build
paths — fixed all of them to `.replaceAll()` since a future template change
adding a second occurrence of any of them would silently reintroduce the
same class of bug. Verified the fix against both build paths (`endless
demo` and `endless build --single-file`) via a rebuilt CLI + fresh curl
checks, added a regression test (`packages/cli/test/endless.test.ts`,
"replaces __ENDLESS_TITLE__ everywhere it appears") that asserts the built
HTML contains neither the literal placeholder nor an empty/placeholder
`<h1>`. Full suite green after the fix: 32/32 (was 31/31 before the new
test). This is exactly the kind of bug the existing Playwright smoke test
could NOT catch — it only asserts on debug-exposed scheduler state, never
reads visible page text/headings.

- [x] `awh endless demo -o <dir>` → serve it (`python3 -m http.server` in
      `<dir>`) and actually LISTEN. Does pressing Play produce audible,
      groove-plausible kick/hat/bass/pads, does the section change land
      musically (not just structurally correct per the debug readout), and
      does the mute/fluctuation movement register as subtle mix breathing
      rather than an audible glitch? **Done, owner confirmed by ear** — a
      real interactive browser session (Chrome, via the connected Claude
      extension) loaded the demo at `http://127.0.0.1:8123/`, confirmed the
      `<h1>` fix rendered correctly (no more literal placeholder), pressed
      Play, and watched it run/transition live: `performance #631621170`
      picked, intro (2 bars) → drop (2 bars) transition happened with fresh
      variant picks each section (`drop-drums-b.wav`/`drop-bass-a.wav`/
      `drop-pads-a.wav`), elapsed timer advanced correctly, zero console
      errors throughout. Owner then listened directly and confirmed all
      three questions: section change lands musically (not just
      structurally), no clicks/pops at boundaries, mute/fluctuation reads
      as subtle mix breathing, not glitchy. This was on the synthetic demo
      stems (sine/noise/saw), not a real owner song — the next two
      checklist items (real bounced stems, then the owner's actual song)
      are still the open bar.
- [ ] Bounce a few bars of a REAL song's stems (drums/bass/pads or
      whatever layers apply) bar-exact per section, WITH any reverb/delay
      tail overlapped back into the loop rather than trimmed at the
      boundary (the README's own documented convention — this checklist
      item is the first real test that "overlapped tail" bouncing actually
      produces a clean-sounding loop point, not just a duration that
      passes validation).
- [ ] `awh endless plan --sections "..." --bpm <bpm> -o endless.yaml`, fill
      in the pools with those real bounces, `awh endless build endless.yaml
      -o dist/<name>` → confirm the validation errors (deliberately break
      one file's duration, delete one pool file, deliberately strand a
      section) are legible enough that the owner (not just an agent) can
      fix them from the message alone, then confirm the clean build sounds
      right end to end — crossfades smooth (no click/pop at section
      boundaries), mix fluctuation subtle, "performance #N" reproducible
      across a reload with the same seed.
- [ ] Build the owner's own actual song this way, start to finish — the
      real exit criterion. Everything above is necessary but not
      sufficient; this is the first time the full pipeline runs on
      material that matters.
- [ ] Follow-actions SDK probe (design doc's stated open question,
      non-goal for v1 but worth answering while the API is fresh in mind):
      does `@ableton-extensions/sdk` expose clip follow-action properties
      (`device.get`/equivalent on a clip, or a dedicated LOM path)? If yes,
      record what's addressable in `docs/sdk-feedback.md` or a knowledge
      entry — it's the prerequisite for a later `awh endless to-session`
      that builds the in-Live equivalent of this grammar using Live's own
      follow actions instead of a browser player.
- [ ] Skill: "make an endless version of my track to share" → Claude
      follows the Typical Flows entry (plan -> owner fills pools -> build,
      not `awh sections` or hand-composed HTML).

## M12 (AWH Remote) owner checklist

Not yet verified in Live (built without a running Max/Live session — see
`docs/design/live-remote.md` for the spec and `m4l/README.md`'s "AWH
Remote" section for the protocol, install steps, and full manual-patching
fallback). Run this before trusting the device on a real project, and
before deleting the old `AWH Capture Tap.maxpat` from a Set/the repo.

**Code-side pre-check done (everything possible without opening Max)**:
`m4l/AWH Remote.maxpat` parses as valid JSON (72 boxes, 89 connections) and
passed an automated structural check (a builder script, not hand-verified
by eye) confirming: every connection references a box/outlet/inlet that
actually exists in range, zero `metro`/`tempo`/`clocker`/`delay` objects
(no timers, per the design's hard requirement), zero `print` objects, and
the `record`/`stop`/`loop`/`play` subsystem is wired byte-identically to
the already-Live-validated `AWH Capture Tap.maxpat`. This cannot confirm
the patch actually RUNS correctly in Max — only that nothing looks
malformed at the object/JSON level, same caveat as the Ducker's own
pre-check.

Independently verified on the CLI/OSC side (no Max needed): `packages/cli
/test/remote.test.ts` — byte-exact checks for `/awh/fire`/`/awh/scene`/
`/awh/stopclips`/`/awh/jump`; a full integration suite against a fake UDP
device (ping→pong v2 handshake, correct message sequencing for `awh
play`/`stop`/`jump`/`launch`/`stop-clips`, `/awh/error` surfaced as a clear
thrown Error rather than swallowed); a negative control (no listener on
the port → clear "requires the AWH Remote device..." error within the
timeout, confirmed fast — not a hang); and `lib audition` end-to-end
against a real fake gateway (serve-fake style, in-process) + the fake UDP
device running simultaneously, covering the sweep-previous-by-exact-name
behavior (with a same-prefix decoy clip proven to survive), `--keep`,
`--end`, zero-empty-slots (clear thrown error, nothing fired), and
unknown-slug (LibraryStore's existing clear error). `pnpm test` fully
green with this suite included — see the build session's own report for
the exact count. None of this reaches the real Max runtime; everything
below this line needs Live open:

**Real session (2026-08-23) — three real, systemic bugs found and fixed
before anything below could pass; documenting in the order they surfaced
since each one masked the next:**

1. **`expr` ternary syntax not supported on the owner's Max version.** All
   three bad-index gate `expr`s (`obj-30`/`obj-42`/`obj-54`) used
   `... ? 2 : 1` and threw an identical Max-console syntax error the
   instant the patch was pasted (visually: all three highlighted orange).
   Fixed by rewriting them to the mathematically identical
   `(condition) + 1` form — `expr`'s comparison/logical operators already
   return `1`/`0` like C, so no ternary is needed at all. Verified clean
   (no orange highlight) after a re-paste.
2. **Every `prepend ...` box in the device was a `message` box, not a real
   `newobj` object** (all 8: the `record` file-open plus the 7
   fire/scene/stopclips/jump status/error replies). A message box just
   outputs its own fixed literal text on any trigger and ignores the
   incoming value — this silently broke the file path handed to
   `sfrecord~`'s `open` (so real recording never actually opened the
   target file) AND every status/error OSC reply (address correct, but
   missing the actual data — e.g. jump's reply came back as literal
   `prepend /awh/status jump` with no beats value). Found by directly
   comparing against the previously-verified, working `AWH Capture
   Tap.maxpat`, whose equivalent `prepend open` box is correctly a
   `newobj`. Fixed all 8.
3. **The real root cause of fire/scene/stopclips/jump silently no-oping**:
   a bare, argument-less `live.path` does not accept a raw LOM path string
   as a runtime message — it needs the literal prefix word `goto`
   (`goto live_set tracks $1 clip_slots $2`, confirmed against Cycling '74's
   own live.path cookbook usage). Without it, Max's console showed
   `live.path: doesn't understand "live_set"` immediately followed by
   `live.object: set: no valid object set` — neither surfaces as an OSC
   `/awh/error` since it fails entirely inside Max before either gate
   branch's reply message fires (CLI-side just saw a clean timeout, no
   error text). This is DIFFERENT from Pair A's `live.path live_set`: that
   form bakes the path in as a creation-time ARGUMENT resolved by a
   `bang`, no message parsing involved, so it was never affected — which
   is exactly why `awh play`/`awh stop` worked from the very first paste
   while jump/fire/scene/stopclips didn't. Fixed all 5 `live_set`-prefixed
   message boxes (`obj-33`, `obj-45`, `obj-59`, `obj-60`, `obj-68`) to
   start with `goto`.

All three fixes are in `m4l/AWH Remote.maxpat` + documented in
`m4l/README.md`'s manual-build table and Notes for anyone rebuilding by
hand. Took 3 re-paste/re-init rounds total to reach a clean state — the
MANUAL RE-INIT button itself worked correctly every single time (see the
re-init item below).

- [x] `m4l/AWH Remote.maxpat` opens/pastes cleanly in Max on the master
      track (between `plugin~`/`plugout~`) without validator errors — true
      only AFTER the `expr` fix above; the three orange-highlighted `expr`
      objects were the paste-time validator failure this item was
      checking for. Clean on the final re-paste.
- [x] `awh play` starts the transport; `awh stop` stops it. Owner-confirmed
      audibly both times (once early, once explicitly with a 10s gap to
      rule out a lucky race). `--from-bar` combo not separately isolated
      this pass (bare `jump` was tested standalone instead, see below).
- [x] `awh jump <bar>` moves the arrangement playhead without starting
      playback. Failed twice before the `goto` fix (console: `live.path
      doesn't understand "live_set"` / `live.object set: no valid object
      set`, playhead never moved despite a clean CLI reply). After the fix:
      owner-confirmed the playhead genuinely jumps to the requested bar,
      transport stays stopped.
- [x] `awh launch track:N/slot:M` on an OCCUPIED slot fires it audibly —
      owner-confirmed (Lead Call session clip). `awh launch scene:N` fires
      the whole scene the same way — owner-confirmed via `set.summary`
      cross-check: scene 0 correctly fired BOTH Lead Call/slot:0 AND Reese
      Response/slot:0 (`clip.get` confirmed both occupied beforehand); only
      Lead Call was actually audible because Reese Response's TRACK itself
      is currently muted (`set.summary`'s own `"muted": true` confirmed
      this is pre-existing session state, not a fire failure) — a good
      example of the device doing the right thing while an unrelated mute
      made it look broken. Launch-quantization timing itself (does it wait
      for the quantize boundary rather than cutting in instantly) was not
      separately isolated this pass.
- [x] `awh stop-clips track:N` / `awh stop-clips` (whole Set) — both
      owner-confirmed (the scene-0 clips actually stopped on command).
- [x] Bad-index behavior: raw OSC probes (bypassing the CLI's own
      client-side path-syntax validation, which rejects `track:2/slot:-1`
      before it ever reaches the device) confirmed all three device-side
      gates fire correctly post-`goto`-fix: `/awh/fire -1 0` →
      `/awh/error bad-fire-index`; `/awh/scene -1` → `/awh/error
      bad-scene-index`; `/awh/stopclips -2` → `/awh/error
      bad-stopclips-index`; and the `-1` "whole Set" sentinel correctly
      does NOT false-positive (`/awh/status stopclips -1`). Positive-but-
      out-of-range indices not separately tested this pass (documented
      known gap, not expected to be caught).
- [x] `awh lib audition <slug> <track>` — owner-confirmed real end-to-end:
      saved a real session clip to a scratch library entry, `lib audition`
      placed it into an empty slot AND fired it audibly, `--end` swept it
      and stopped it (owner-confirmed both the audible fire and the sweep).
      Scratch library entry + regenerated `INDEX.md` cleaned up afterward.
      Second-slug-sweeps-first and `--keep` not separately re-exercised
      live this pass (already covered by the existing fake-gateway
      integration suite).
- [x] **Manual re-init button recovers after a paste-reload** — exercised
      for real 3 times in a row (once per bug-fix round) since every fix
      required a fresh select-all/copy/paste over the already-open device.
      The button worked correctly every time — `awh ping`/`awh play`/`awh
      stop` were reachable again immediately after each click, no
      device removal/reinsert ever needed. Whether Pairs B–E specifically
      need it (vs. only Pair A per the design) wasn't cleanly isolated,
      since the `goto` fix was landed in the same paste rounds as the
      re-init clicks — not a live open question, since Pairs B–E's
      fresh-resolve-per-call design means they were never expected to
      depend on re-init in the first place, and nothing observed
      contradicted that.
- [ ] **Owner performance protocol** (m4l/README.md's "Owner performance
      protocol" section) — run all three conditions (no device / frozen +
      editor closed / unfrozen + editor open) and RECORD THE THREE NUMBERS
      here:
      - Baseline (no AWH device): ___
      - Frozen, editor closed: ___
      - Unfrozen, editor open: ___
      If the frozen/editor-closed number is meaningfully worse than
      baseline, that's a real patch-level regression to escalate
      (unexpected per the object-count diagnosis) — otherwise this closes
      the owner's original "Capture Tap feels heavy" report as
      environmental, not a patch defect. Not run this pass — needs the
      owner's own CPU-meter reading across a Live restart per condition,
      not automatable from here.
- [x] **Migration**: old AWH Capture Tap already removed from the Master
      chain before this pass began (owner did it as the first migration
      step); AWH Remote installed in its place. `awh mix capture`
      re-confirmed working end-to-end post-fix: a real capture at the
      drop (bars 21-22) came back genuinely silent twice (`-inf` LUFS) —
      traced to the SAME "dirty transport after heavy jump/launch/
      stop-clips testing" gotcha documented earlier in this doc's
      Troubleshooting section, not a new bug — confirmed by having the
      owner manually press Play and confirm audible playback immediately
      before a third capture attempt, which came back real (`-9.28` LUFS,
      `2.00` dBTP true peak). This is the actual cutover, not just a
      side-by-side comparison — `op verify`/`mix duck push` weren't
      separately re-run this pass but share the exact same record path
      just proven working. Deleting `AWH Capture Tap.maxpat` from the repo
      remains optional and the owner's call — not done.
- [ ] Freeze to `AWH Remote.amxd` and reload from a fresh Live session (new
      Set) → still responds on 9720/9721 without re-patching. Not run this
      pass (would require closing/reopening the Set actively being worked
      in) — left open.
## M11 (sample library) owner checklist

Built + tested against a SYNTHETIC corpus only (sine-tone one-shots, a
noise-burst hat, a decaying-sine kick loop at a known BPM) —
`analysis/tests/test_samplescan.py` (feature ranges, type-guess/BPM
recovery, determinism, unreadable-file records, JSONL-via-CLI, no NaN/
Infinity tokens) and `packages/cli/test/samples.test.ts` (incremental
index build/skip/prune against a fake scanner; the real analysis engine
for an end-to-end index build plus the similarity NEGATIVE CONTROL — a
second sine bass ranks above two noise hats for a sine-bass reference,
with a hat ranked dead last; search token/filter matrix; zero-hits
relaxation suggestions; missing-dir loud error; `AWH_SAMPLES_INDEX`
honored, `~/.awh` never touched by the test suite). A one-off scratchpad
smoke run (tiny hand-built corpus: a bass one-shot, a noise hat, a
120 BPM kick loop) confirmed `index` → `search` → `similar` work
end-to-end from the built CLI, but every test corpus so far is
synthetic — real sample packs are messier (inconsistent naming,
silence-padded files, odd sample rates, genuinely mixed-BPM folders) and
haven't been run through this yet:

Real session (2026-08-23): indexed the owner's actual sample library —
`/Users/tahazar/.../Ableton/2 Samples` (20,212 real files across nested
pack folders: Bass/Drums/FX/Melodic/MIDI/My Material/User Library/Vocals,
messy real-world naming, not synthetic).

- [x] Point `awh samples index` at a REAL sample folder tree and check the
      walk/unreadable-count/incremental behavior. Confirmed: recursive walk
      found all 20,212 real files (wav/aif/aiff/mp3) across the full nested
      tree; 7 flagged unreadable, and every single one checked out as a
      REAL, sensible failure (not a scanner bug) — 3 genuinely malformed
      WAV `fmt` chunks, 1 corrupt MP3 (missing consecutive MPEG frames), 1
      unrecognized format, 1 too-short file for the analysis window's
      padding requirement. Re-running immediately reported `0 rescanned,
      20212 unchanged` (1.02s wall-clock vs. the original ~34.5 min full
      scan — real filesystem mtimes, not synthetic). Touched 3 real files
      by hand (`touch`) and re-ran: exactly those 3 got rescanned, all
      20,209 others correctly skipped.
- [x] Timing at real scale: first full index of the real 20,212-file
      library took **~34.5 minutes wall-clock** (2,488-file Bass subfolder
      alone: 2:12, ~53ms/file; full remaining 17,724 files: 28:43,
      consistent per-file rate — no cliff or slowdown at scale). The
      "scanned N/total" progress line (every 1000 files) read as useful at
      this size, not too sparse or too chatty. Not profiled further since
      the rate held linear and nothing looked anomalous.
- [x] The actual "find me an amen break" flow against real, messily-named
      files: `awh samples search amen` returned 20 real hits from a real
      commercial breaks pack (`Drums/Breaks/*.wav` — "Atlantis Amen",
      "Bulldozer Amen 2 - 2A", "Drumz Amen Compound - 11A", etc., real BPM
      detected per file from 74.9 to 172.3), correctly typed `loop`. Search
      genuinely works against real pack naming conventions, not just the
      clean synthetic test names.
- [x] A `similar`-to query against a real, owner-known favorite (`Bass/
      Growls/Terrorist Reese - 3A.wav`, trait-based — no CLAP embeddings
      installed yet, M11b below). **Confirmed the exact gap this checklist
      item was designed to catch**: results clustered 0.991-0.995 cosine
      and were dominated by kicks/808s (not other reese/growl basses), all
      sharing only the `low` band tag. Owner's by-ear verdict: "kinda
      sounds similar but I think it's mostly low band energy" — i.e. the
      v1 MFCC/spectral/band-split feature vector is tracking coarse
      low-band energy, not genuine growl/reese harmonic timbre, on real
      material. This matches the checklist's own prediction exactly (the
      synthetic negative control only proved sine-vs-noise separates
      cleanly) — real evidence that closing this gap needs the M11b CLAP
      semantic path (untested against a real checkpoint — see below), not
      a v1 feature-vector tune.
- [ ] Decide whether the loop/one-shot duration+onset heuristic
      (`samplescan.LOOP_MIN_DURATION_S`/`LOOP_MIN_ONSETS`) needs tuning
      against real material — not evaluated this pass; left as the
      owner's call per the item's own framing.

## M11b (semantic search) owner checklist

Built + tested entirely under `AWH_CLAP_STUB=1` — `analysis/tests/test_clapembed.py`
(stub determinism/text-mode/L2-normalization/6-decimal rounding/the
"model not installed" error naming the exact package+checkpoint+path/JSONL
shape through `sanitize_json`) and `packages/cli/test/samples.test.ts`'s
M11b blocks (embed fills + is incremental; a model switch makes every
prior vector stale and re-embeds, reporting counts; `search --semantic`
composes with the v1 trait filters and reports the not-embedded footer;
`similar --semantic` ranks a byte-identical copy of the reference first;
the NEGATIVE CONTROL — `search --semantic` against an index with ZERO
embeddings anywhere errors naming `awh samples embed` and never silently
falls back to token search, checked via a real subprocess spawn of the
built CLI). A scratchpad smoke run indexed 14 REAL mp3 loops (WaivOps
TR9 examples — real audio, not synthetic) end-to-end through
`index -> embed -> search --semantic -> similar --semantic`, confirming
the plumbing works on real files; the stub has NO real semantics (every
score in that run was noise clustered near 0 — random unit vectors in a
512-dim space), so it proved WIRING, not embedding quality. Nothing here
has run against the real LAION-CLAP checkpoint — that requires an owner
machine (Hugging Face is egress-blocked in the dev container, see
`analysis/README.md`'s M11b section for the exact install + checkpoint
download):

- [ ] Install `laion_clap` (`pip install -e '.[clap]'` from `analysis/`)
      and download the music checkpoint (`music_audioset_epoch_15_esc_90.14.pt`,
      ~600 MB+ depending on host) into `~/.awh/models/` per
      `analysis/README.md`. Confirm `awh samples embed` fails with the
      clear install-hint error BEFORE the checkpoint is present, and
      succeeds after — never a bare stack trace either way.
- [ ] `samples embed` timing at REAL library scale: how long does the
      first full embed of the owner's actual sample library take (torch
      CPU inference is much heavier per file than `samplescan`'s DSP
      pass), and is the "embedded N/M" progress line useful at that
      cadence or too sparse/chatty? Re-running immediately should embed 0
      (incremental skip) — confirm that holds at real scale too.
- [ ] Three CONTENT-language queries against a REAL, already-embedded
      library — "dusty breakbeat" plus two more the owner picks — judged
      BY EAR against each query's actual top-5 `search --semantic`
      results. This is the first real test of whether CLAP-space
      similarity tracks the owner's actual sense of what a phrase
      describes; the stub only proves the plumbing moves data, never
      whether the ranking means anything.
- [ ] A `similar --semantic` query on a REAL favorite sample the owner
      already knows well: do the top few results actually sound similar
      by ear, and does `similar --semantic` actually default to semantic
      (not `--traits`) once the owner's index has embeddings, without
      needing to be told?
- [ ] Spot-check that NO CC-BY-NC (or any other restrictively-licensed)
      checkpoint was fetched — only the two open LAION-CLAP checkpoints
      named in `analysis/README.md` (`music_audioset_epoch_15_esc_90.14.pt`,
      `630k-audioset-best.pt`) should ever land in `~/.awh/models/`.
- [ ] Confirm the `search --semantic` vs token-`search` split in
      `.claude/skills/awh/SKILL.md` (content-language queries first try
      semantic, name-like queries first try tokens) actually holds up in
      a fresh-agent session against real "find me a ___" requests — the
      written contract is untested against a live conversation so far.
- [ ] PANNs tagging (`awh samples tag`, `docs/design/sample-semantic.md`'s
      optional stretch) is DESIGNED, NOT BUILT — decide whether it's worth
      building as a follow-up milestone, or whether CLAP semantic search
      alone covers the "find a kick" case well enough that a separate
      tag-based filter isn't worth the second model/cache.

## M11c (pitch-tagged sample search) owner checklist

Built AND validated against the owner's real 20,212-file library in the
same session (2026-08-23) — a direct follow-on from the M6b masking
toolkit work: after `mix pitch` correctly caught a naive-FFT-peak-pick
failure on a real Reese patch, the owner asked whether the same
periodicity tracking could tag kicks/subs in the sample library for
key-matched search. `test_samplepitch.py` (tuned-sine voiced/broadband-
noise unvoiced negative control, too-short/corrupt/missing-file states,
determinism, JSONL CLI round-trip, no NaN/Infinity) and `samples.test.ts`
(eligibility matrix, incremental + stale re-tag, zero-candidates state,
the octave-convention regression, `search --near-note` cents filtering
with a negative control, real subprocess integration) are the AI-built +
synthetic-tested half — all green (`pnpm test` + `pytest -q`, no
regressions). Unlike most M-series entries, this one was ALSO run for
real against the owner's actual library in the same pass, not left for a
separate owner-validation session:

- [x] `awh samples pitch-tag` on the owner's real, already-indexed
      20,212-file library. Confirmed: exactly 2,427 files (~12%) were
      eligible candidates (`isPitchTagCandidate`: readable one-shots whose
      energy is low-band-dominated) — real evidence the eligibility filter
      is well-scoped, not 0 and not everything. Tagging all 2,427 took
      **~91 seconds** (0 failures) — fast enough to not be a real workflow
      cost. Result split: 2,161 `voiced` (a real trackable fundamental —
      kicks/808s in a real pack turn out to be tuned more often than
      expected), 266 `unvoiced` (genuine broadband transients, reported
      honestly rather than a fabricated pitch) — a sensible real-world
      split, not all-or-nothing. Re-running immediately reported "all 2427
      ... already pitch-tagged — nothing to do" (incremental confirmed at
      real scale, same pattern as M11's own index incrementality).
- [x] `awh samples search --near-note <note>` against the real,
      pitch-tagged library — the actual "find a kick that matches my sub"
      question this milestone exists for. `search --near-note F1` (this
      project's own F Phrygian key root) surfaced real, correctly-tuned
      808s/kicks from real commercial packs, including one living directly
      in a `Drums/Kicks/` folder (`Mixed Small 808.wav`, duplicated across
      both a `Bass/808s/` and `Drums/Kicks/` pack folder) — the exact
      real-world result the feature was built to produce. Composing
      `--near-note` with a plain text term (`search kick --near-note F1`)
      correctly returned 0 (this library's path-token-labeled "kick" files
      don't happen to include one tuned to F1) while the bare
      `--near-note F1` query alone returned real hits — confirms the
      filters compose as AND, not silently relaxing.
- [x] Octave-convention correctness (the trickiest part of this feature,
      caught during design rather than live): `pitch.py`'s `note.name` is
      stamped in STANDARD/scientific notation (C4 = MIDI 60), a full
      octave apart from this codebase's Ableton convention (C3 = MIDI 60)
      used everywhere else a note name appears in this CLI. Verified the
      fix holds: `noteNameToHz("A3") === 440` (Ableton's A3 = standard
      A4 = concert pitch) and `pitchDisplayNote` re-derives the shown name
      from the convention-free `note.midi`, never trusting the raw Python
      string — both covered by explicit regression tests, not just
      exercised incidentally.
- [ ] Skill check: ask a fresh agent "find me a kick that matches my sub"
      or similar and confirm it follows the new Typical Flows entry
      (`.claude/skills/awh/SKILL.md`) — runs/confirms `pitch-tag`, then
      `search --near-note` with the right note (the Set's active key root
      or whatever the owner named), and is explicit that untagged/
      unvoiced hits were never claimed to match. Not run this pass.
- [ ] Whether the default 50-cent (quarter-tone) `--cents` tolerance is
      the right musical default, or too tight/loose in practice — not
      evaluated against enough real search sessions yet to have an
      opinion; the owner's own use over time is the real signal here.
- [ ] Loops/melodic material remain explicitly out of scope for pitch
      tagging (v1) — `pitch.py`'s existing `per_note` mode is the natural
      extension path if a future need for key-matching basslines/leads
      comes up, not evaluated or built this pass.

## Pitch-aware duck depth targeting (`duck fit --bass`) owner checklist

Built AND validated against the real Set in the same session (2026-08-23),
directly following M11c — same motivating idea (a real fundamental beats a
generic low-band proxy), applied to sidechain depth instead of sample
search. `analysis/awh_analysis/duck.py`'s masking-depth calc previously
compared BASS and KICK levels in one fixed, generic 150 Hz lowpass band;
now, when the bass is genuinely voiced, it measures BOTH in a narrow band
centered on the bass's real fundamental (`pitch.analyze_segment`, reused
from M6b) via the SAME calibrated Welch machinery `mix bands` already
uses (`spectrum.welch_psd`/`band_power`, `bands.CALIBRATION_REF_POWER`) —
no new DSP, just correctly targeting existing tools. Broadband/unvoiced
bass keeps the ORIGINAL generic-band calc byte-for-byte (a narrowband
margin is meaningless without a real fundamental). `test_duck.py` (10
tests, 3 new: tuned-bass narrowband path, broadband-bass fallback with a
regression-guard confirming it reproduces the exact pre-change number, a
negative control proving the measurement genuinely responds to WHERE the
kick's energy sits) — all green, plus the full `pytest -q` (164 tests).

**Real, live-caught bug fixed before this could ship**: the initial design
gated the narrowband path on `pitch.analyze_segment`'s `state == "voiced"`
alone — testing against a synthetic white-noise "bass" showed pyin can
flip to `"voiced"` off a single spurious periodic frame (0.064 voiced
fraction measured on pure noise, confidence 0.010). Calibrated a proper
gate (`MASKING_MIN_VOICED_FRACTION = 0.10`) against THREE real numbers
from this exact session: pure noise 0.064, a genuinely messy-but-real
Reese growl (from tonight's earlier masking investigation) 0.122, a clean
sub 0.956 — 0.10 sits between the false positive and the real (if noisy)
tonal case, so noise now correctly falls back to the generic calc while
real messy-tonal material like Reese still gets the narrowband treatment.

- [x] Real end-to-end run against the live Set: captured "2 Kick & Snare"
      and "9 Sub" over the real 4-bar drop span via `awh mix layers`
      (fully automated solo/capture/unsolo), then `awh mix duck fit
      <kick capture> --trigger-clip track:17/arr:1 --bass <sub capture>`.
      The sub's fundamental came back **44.9 Hz** — matching, independently,
      the EXACT same number `mix pitch` found on the archived `solo-
      sub.wav` capture from earlier in this session (95.6% voiced there)
      — a genuine cross-validation between two independently-run tools on
      related real material, not a coincidence of tuned test data.
- [x] Compared the new recommendation against the OLD generic-band formula
      on the SAME real capture pair (old formula reproduced manually,
      matching the fallback branch's own regression-guarded code path):
      **old 6.7 dB vs. new 11.4 dB** — a real, substantial, well-explained
      difference. The old blended measurement understated the conflict
      because it averaged the kick's broader low-end (including transient
      content up to 150 Hz) against the sub's broadband level; the new
      measurement shows the kick is comparatively QUIETER specifically at
      the sub's actual 44.9 Hz fundamental than the broadband picture
      implied, correctly calling for more protection right where the real
      overlap lives.
- [x] The existing trigger-alignment sanity check (unrelated, pre-existing
      code, untouched by this change) correctly fired a real WARNING on
      this exact real capture — the "trap-drums" Trigger clip's note
      positions don't perfectly match this specific 4-bar window's actual
      kick placements (plausibly because the drop's kick pattern varies
      bar-to-bar, A-B-A-C style, while the Trigger clip encodes one fixed
      pattern). Confirms the sanity check still does its job correctly
      alongside the new masking-depth logic — flagging real data problems
      honestly rather than silently producing a confident-looking but
      misaligned fit. Not chased further this pass (a separate, pre-
      existing finding, not a regression).
- [ ] Draw the new recommended envelope into Volume Shaper for real and
      confirm it sounds like a genuine improvement over the old generic-
      band recommendation by ear, on material where they differ audibly —
      not done this pass (would need a real ShaperBox-equipped project;
      this Set uses the automatic Compressor strategy).
- [ ] Whether `MASKING_MIN_VOICED_FRACTION = 0.10` is calibrated well
      enough against only 3 real data points (noise/Reese/sub) — worth
      revisiting if a future real bass capture sits close to that
      boundary and the routing (narrowband vs. fallback) looks wrong by
      ear.

## M13 (mix advisor) owner checklist

Built (offline, AI-buildable half) in response to the owner's post-public
ask captured in `docs/design/mix-advisor.md`: "with this mix report — I
want to be able to derive recommendations on what to do to improve the
mix." `analysis/awh_analysis/advise.py` is a deterministic rule table over
the SAME measurement dict `mix report` already produces (never re-measures
with different logic) — six fixed stages (integrity → phase → masking →
tonal → dynamics → loudness), each rule citing its `docs/research/
data-driven-mixing.md` or existing-module basis, capped EQ amounts
(`min(|delta|, 3) dB`), tilt-vs-bands exclusivity, `blockedBy` links across
the dependency ladder, and a healthy-mix state (zero actionable items +
the two most marginal metrics). `analysis/tests/test_advise.py` (15 tests:
one real-audio fixture + negative control per named rule — clipped sine/
safe sine → integrity, decorrelated/correlated low band → phase,
band-boosted/unboosted noise vs a real saved target → capped EQ, quiet
streaming-level mix → healthy state — plus dict-fixture tests for masking,
tilt-vs-bands exclusivity, two-stage ordering/blockedBy, determinism, and
`--compare` resolution categories) and `packages/cli/test/advise.test.ts`
(record-name resolution, `--set` device-name enrichment against a real
fake gateway, and full CLI integration through the built binary + real
Python engine: arg mapping, missing-target/-layers placeholders in real
output, `--record`/`--target`/`--layers` resolving saved records by name,
`--set` naming a real master-chain device end to end, `--compare`
resolved/new) are the AI-buildable half — all green (Python 179/179 total
incl. the 15 new; Node core 344/344, cli 146+15/161). Re-running the
ORIGINAL question end-to-end against the owner's real WIP track is the
owner's:

- [ ] `awh mix advise <realWipCapture> --target <realGenreTarget> --layers
      <realLayersRecord>` on the actual project this milestone was built
      for — not a synthetic fixture. Confirm the ranked plan actually
      reflects the dependency ladder on real numbers (e.g. does a real
      phase or tonal issue genuinely outrank a lower-priority one, and does
      `blockedBy` fire when it should).
- [ ] **The credibility test**: read the top-3 items before looking at the
      numbers and judge, by ear/experience, whether they match what you
      already suspected was wrong with the mix. Disagreement is fine and
      expected sometimes — the design's own stance is that disagreement is
      a reason to edit a rule (threshold or wording), not a reason to
      distrust the whole tool. Note which items (if any) surprised you and
      why.
- [ ] Act on ONE item for real (the move the `action` field names — an
      actual EQ Eight move, a Utility Bass Mono, a limiter ceiling change),
      re-capture, then `awh mix advise <newCapture> --compare <savedName>`
      — confirm the item you fixed shows `resolved` (or `improved` with
      honest numbers) and nothing else you didn't touch got miscategorized.
- [ ] Try `--set` against the real Set with the real master chain loaded —
      confirm it names actual devices already there (not the generic "add
      an EQ Eight" phrasing) where one exists, and does nothing surprising
      when it doesn't.
- [ ] Skill check: ask a fresh agent "what should I fix in my mix" or "is
      this ready for release" and confirm it reaches for `mix advise` from
      the Typical flows entry, presents the plan top-down, quotes evidence
      verbatim, and never layers a folklore suggestion the engine didn't
      emit on top. Not run this pass.
- [ ] Whether the open-detail decisions made where the design left specifics
      unstated hold up against real material: the masking "comparable
      energy" significance threshold (5% of a layer capture's total signal
      power, not an absolute dBFS), the extreme-asymmetry integrity
      threshold (2x report.py's existing 3 dB flag, i.e. 6 dB), and the
      `--compare` improved/unchanged epsilon per rule (docs/design/
      mix-advisor.md doesn't pin any of these down) — revisit if a real
      run's judgment calls look miscalibrated by ear.

## M14 (arp engine) owner checklist

Built per `docs/design/arp-engine.md`'s pinned ArpSpec schema and semantics
(a single global step counter drives contour/pattern-position/walk-rng
together — see `packages/core/src/arp/engine.ts`'s header comment for why
that one rule is what makes polymeter wrap correctly AND makes chord
boundaries re-select the pitch pool without resetting pattern position,
both for free). Two built-ins (`basic-up`, `melodic-techno-16ths` —
the latter verbatim from the design doc), the knowledge `arp-style-<name>`
fallback (tier printed), the `ratchet` transform (vary-compatible), and
`euclideanMask`/`chordsFromNotes` exported as reusable core utilities.
`pnpm test` green (core 344 -> 381 incl. 37 new: pitch-pool membership,
exact-k-onset euclidean masks at every rotation, the patternLength-12
polymeter wrap with hand-computed accent positions, the chord-boundary
re-select fixture, ratchet/gate non-overlap, bounded walk, frozen
determinism for both built-ins across 2 seeds, parseArpSpec typo/euclid-k=0
rejection, and the melody-only negative control; cli 161 -> 167 incl. 6
new: `--prog` end-to-end and `--dry-run` against a fake gateway, the
chord-clip source reading a clip `awh chords` itself wrote, the
melody-only state, the unknown-style error, and the knowledge-entry style
fallback with tier printed via an isolated `AWH_LIBRARY`); Python untouched
(179/179). Smoke-tested against `awh serve-fake`: `--prog` writing a real
clip, `awh chords` -> `awh arp` chord-clip round trip, an unknown style's
error, a melody-only clip's state, and `--variant rotate-N` against a
knowledge-loaded style — see the build session's report for the exact
`--dry-run` notation excerpt. The owner still needs to validate this
AUDITIONED IN LIVE — synthetic notes and property tests prove the pinned
mechanics as coded, not whether either built-in (or a knowledge style)
actually sounds like the trance/techno/psy-ratchet idiom it names:

- [ ] `awh arp --prog "<a real progression>" --key <realKey> <target>
      --style melodic-techno-16ths` on the actual project this milestone
      was built for → confirm the updown contour + off-accent 16ths
      genuinely read as "melodic techno," not just a mechanically-correct
      arpeggio. Not run this pass (serve-fake only).
- [ ] `awh arp <a real chord clip on the project> <target> --style
      basic-up` → confirm the chord-clip source (grouped simultaneous
      notes, per-chord spans) tracks the actual harmonic rhythm of a
      hand-written or `awh chords`-written clip, not just the synthetic
      fixtures in the test suite.
- [ ] Audition a knowledge `arp-style-<name>` entry once the parallel
      seeding agent's trance/melodic-techno/psy-ratchet entries land — this
      milestone only smoke-tested the fallback MECHANISM (a scratch
      knowledge entry, tier printed), not any of the seeded entries'
      actual musical claims.
- [ ] The jam-vs-commit workflow, for real: find a pattern you like on the
      stock Live Arpeggiator (jamming), then reproduce its FEEL with `awh
      arp` (style/rate/gate/contour) so it becomes a real, seed-reproducible
      clip the rest of the toolchain (vary/library/notation) can touch —
      confirm that hand-off actually feels natural rather than like
      re-deriving the pattern from scratch.
- [ ] `ratchet` transform via `awh vary <clip> --ops "ratchet:steps=..."` on
      a real (non-arp) clip → confirm the ratcheted hits read as a
      deliberate roll/stutter, not a glitch, at a real tempo.
- [ ] Skill check: ask a fresh agent to "arp this chord clip" / "give me a
      trance-style 16th arp" and confirm it reaches for `awh arp` from the
      Typical flows entry (chord-clip or `--prog` source, not hand-composed
      notation), and states plainly when a source clip turns out to be a
      melody rather than silently producing garbage.
- [ ] Whether the open-detail decisions the design left unstated hold up:
      `--variant` forcing the euclid mask's ROTATION (there being no
      cell/recipe table to draw from, unlike drums/phrase); the single
      global step counter as the mechanism for both polymeter wrap and
      chord-boundary continuity; `--bars` beyond a chord source's own span
      tiling (looping) the harmonic content rather than erroring; the
      velocity ramp shape scaled off `accentBoost` (±half of it at the
      pattern's ends) rather than an unstated constant; and swing applied
      to odd-indexed steps as a fraction of the step (the "drum-engine
      convention" the design cites without pinning a formula) — revisit if
      a real run's feel doesn't match what any of these imply on paper.

## M15 (break engine) owner checklist

Built per `docs/design/break-engine.md`. Two independent halves: Half 1
(`awh breaks place`) plays a knowledge-carried canonical break pattern as
MIDI on any kit — no audio slicing, built on the existing notation path
(kit-aware via `mapPadRoles`, same convention as `drums gen`); the seeding
agent's `break-pattern-<name>` entries land separately and were smoke-tested
against this milestone only with a scratch knowledge entry (mechanism, not
the seeded entries' musical claims). Half 2 chops a REAL break sample
(`analysis/awh_analysis/breakchop.py` — reuses `duck.detect_onsets` for
onsets, `drumstats._band_split`'s exact low/mid/high proxy filters for the
per-slice kick/snare/hat role guess, and `ref.onset_and_subband`/
`estimate_tempo` for BPM) into a labeled chop map, then re-sequences it
purely in core (`packages/core/src/breaks/{spec,chopmap,engine}.ts` —
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
end), `--map` record resolution, `--mode live-slices`'s loud count-
mismatch warning naming the map's own slice count, the drum-rack 16-slice
cap surfacing as a clear CLI error, the low-confidence and zero-slices
negative paths, the unknown-style error, the knowledge `break-style-<name>`
fallback with tier printed via an isolated `AWH_LIBRARY`, `fill` writing N
named ("fill <devices> s<seed>") candidates into consecutive session
slots, and `place` resolving a temp `break-pattern-<name>` entry through
the GM-fallback path); Python 179 -> 189 incl. 10 new in
`analysis/tests/test_breakchop.py` (exact slice count/roles/small offsets
on a synthetic kick/snare/hat break, a shifted-hits synthetic proving
offsets are MEASURED not snapped, a ghost negative control, zero-onsets as
a state, `--export` byte-length-matches-span, determinism, BPM estimation
without an override, the saved-record shape, and two real CLI subprocess
smoke tests). `skill-flows.test.ts` gate green for `awh breaks`.

Smoke-tested against a synthetic amen-shaped break WAV (kick/ghost/snare/
hat, 90 BPM, real onset detection — not a fake gateway substitute for the
Python engine): `breaks chop --save --export` produced a 7-slice table
(the ghost hit in that particular capture didn't cross the onset
threshold — a real, honest miss, not a bug; the negative control above
covers a case tuned to land it), `breaks pattern --style jungle-classic
--dry-run` and `--mode live-slices` (loud warning, exact slice count
named), `breaks fill --dry-run` with 3 seeded candidates showing an
escalating snare-rush ratchet / a fixed-slice stutter / a 7-slice-cycling
triplet cell, the low-confidence and zero-slices negative paths, the >16-
slice drum-rack refusal, and `breaks place` against `awh serve-fake` with
a scratch knowledge entry (GM fallback, since standing up a fake Drum Rack
with real pads isn't exercised by any existing test in the repo either —
see the build session's report). The owner still needs to validate this
AUDITIONED IN LIVE — synthetic slices and property tests prove the pinned
mechanics as coded, not whether the fill grammar's four devices actually
read as tasteful jungle/DnB moves, or whether a real amen/think/funky-
drummer break chops the way the design's craft assumptions expect:

- [ ] `awh breaks chop <a real amen/think break from the sample library>
      --export <dir> --save <name>` end to end → confirm the role guesses
      and grid offsets match what the ear expects on genuinely well-known
      material, not just the synthetic fixtures in the test suite.
- [ ] Drag the `--export`ed slices into an empty Drum Rack, confirm the
      pad order lines up with `--mode drum-rack`'s C1-up assumption
      exactly as the README table claims.
- [ ] `awh breaks pattern <target> --map <name> --style jungle-classic` and
      `--style halftime`, then `awh breaks fill` a few turnarounds — judge
      by ear whether jungle-classic's statement-then-chop and halftime's
      sparse-same-slices genuinely read as those idioms, and whether any
      fill's devices (snare-rush/stutter/triplet/tail-rearrange) feel
      restrained (per the `maxDevices` rule) or still too busy.
- [ ] `--mode live-slices` against Live's own Slice-to-New-MIDI-Track on
      the SAME file → confirm the printed slice count either matches
      Live's detected count (notes land on the right slice) or the
      mismatch warning was the right call.
- [ ] Audition `break-pattern-<name>` entries once the parallel seeding
      agent's amen/think/funky-drummer transcriptions land (`awh breaks
      place <name> <target>`) — this milestone only smoke-tested the
      PLACE MECHANISM with a scratch entry, not any seeded entry's
      transcription accuracy.
- [ ] Whether the open-detail decisions the design left unstated hold up:
      the ghost threshold (-18 dB below the file's own loudest slice,
      12 dB confidence span); the final slice's `end_s` always being the
      file's own end (byte-exact, lossless) with tail-decay reported only
      as a separate informational field, never truncating the cut;
      `--variant` on `pattern` being a bare numeric seed offset (BreakSpec
      has no named cell/recipe table to draw a variant from, unlike
      drums/arp/phrase); the low-confidence lockout firing when EVERY
      slice reads under 0.4 confidence (not an average); and the fill
      grammar's chunk-per-device split (each selected device gets an equal
      contiguous slice of the fill's own length) — revisit if a real run's
      feel doesn't match what any of these imply on paper.
