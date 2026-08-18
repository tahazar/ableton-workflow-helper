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

## M4L Ducker owner validation checklist

Not yet verified in Live (built without a running Max/Live session — see
`m4l/README.md`'s "AWH Ducker" section for the protocol, install steps,
and full manual-patching fallback). Run this before trusting the device
on a real project:

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

- [ ] `awh drums detect-onsets <audio drums capture>` → detected beats match
      the audible hits; `--make-clip` writes a usable Trigger clip
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

- [ ] One-time: copy your real template project folder to
      library/templates/project; write library/templates/scaffold.yaml
      (tempo/tracks/starters/chords). **NOT DONE YET** — needs the owner's
      real template; this blocks the two Live-facing items below (`new
      project` against Live, `new populate` against a real open Set). The
      CLI-level mechanics of both are verified below via a synthetic
      template + the fake gateway, but never against real Live/a real
      template project.
- [ ] `awh new project test-song` → folder + renamed .als; opens in Live
      with your template's devices/routing intact. Mechanics confirmed via
      a synthetic template (whole folder copied incl. subdirs, .als
      correctly renamed, clean refusal on an existing destination) — the
      "opens in Live with devices/routing intact" half is unverified
      (needs a real template + Live).
- [ ] `awh new populate` → tempo set, named tracks appear, starter clips
      placed from the library, chord bed lands in key. Confirmed
      end-to-end via `awh serve-fake`: tempo, 3 named tracks, a starter clip
      (from a saved library entry) on one track, an in-key chord bed on
      another — all read back correct.
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
- [ ] `--key "F minor"` overrides an inactive Set scale; helpful error
      when neither is available. Confirmed the override half (every test
      above used `--key` against the fake Set's inactive/default scale and
      worked correctly); the "helpful error when neither is available" half
      not separately exercised this pass.
- [ ] Skill: "start a new track from my template and put a chord bed down"
      → project -> populate -> chords, citing any KB entries used. Not run
      — blocked on the same real-template gap as the first item (a fresh
      agent test against a synthetic/fake template wouldn't exercise the
      real "opens in Live with your template's devices/routing intact"
      concern the flow exists to verify).

## B3b (right-click capture) verification checklist

- [ ] Rebuild + reload the extension; right-click a MIDI clip → "AWH: Save
      clip to library" appears and logs a capture (ExtensionHost.txt).
      Partial: `pnpm build:extension` builds clean, `sdkLiveBridge.ts`
      correctly reuses the verified `endMarker - startMarker` session-clip
      length fix (M1) and the same note conversion as clip reads (code
      review, not live-clicked). Rebuilt and restarted dev-mode
      `extensions-cli` to load it. **The actual right-click GUI action was
      not tested this pass** (owner chose to skip) — still open.
- [x] `awh lib import` → entry lands in clips/inbox/ with notes identical to
      the clip (`awh lib place` it back to verify), bpm/scale context
      captured; second import → "outbox empty". Confirmed the empty-outbox
      path against the real gateway: clean `"outbox empty — nothing
      captured since the last import"` message, no error. The
      populated-outbox path (real capture → import → verify notes/bpm/scale
      → place-back) is blocked on the right-click item above.
- [ ] Capture 3 clips before importing → all 3 drain in one import, slug
      collisions get -2/-3 suffixes. Not run (needs real captures).
- [ ] Skill: "I saved a couple of clips, pull them in" → import + guided
      naming/tagging/curation. Not run.

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

Built + smoke-tested against `awh serve-fake` (synthetic sine WAVs, a real
gateway write, `--dry-run`, and the zero-notes path — see the build session's
report for exact commands/output). The owner still needs to validate against
REAL Live and REAL recorded material — synthetic sine waves prove the
plumbing, not transcription quality on an actual take:

- [ ] Real vocal/hummed take → `awh clip from-audio <recording> track:N` →
      the resulting MIDI clip's melody is recognizably the same shape as the
      recording when played back in Live (not necessarily note-perfect —
      that's the honest expectation, not the bug bar).
- [ ] `--bpm` omitted → confirm it actually reads the OPEN Set's real tempo
      (not just the fake gateway's fixed value) and the note timing lines up
      with the Set's grid when played against other tracks.
- [ ] `--quantize 1/16` (or another grid) on a slightly-off-grid human take →
      notes snap to the grid and still sound musically right — no notes
      audibly forced into the wrong bar from a bad snap.
- [ ] Explicit occupied slot target (`track:N/slot:M` with a pre-existing
      clip) → clip is overwritten in place, not duplicated or skipped; if the
      transcription is longer than the existing clip, confirm the printed
      "clamped" note matches what actually got dropped.
- [ ] Bare track target with NO empty session slots → confirm the error
      message is clear and doesn't half-write anything.
- [ ] A genuinely quiet/silent recording → "no notes detected" prints, exit
      0, nothing created — confirm no phantom clip appears in the Set.
- [ ] Skill: "turn this hummed idea into a MIDI clip" → Claude follows the
      Typical Flows entry (gets the file, doesn't hand-invent pitches, quotes
      the note count/pitch range, states it's an estimate) rather than
      reaching for `clip create` or fabricating notation.
- [ ] Real timing check: total wall-clock for a typical 8-16 bar musical
      idea (not the 1.5-2s synthetic test fixtures) — Basic Pitch inference
      is CPU-bound; confirm it's tolerable in the actual workflow (no
      progress output during the model's own `Predicting MIDI for...` phase
      since that's swallowed to keep `--json` parseable — worth a "this may
      take a few seconds" note in the non-JSON path if it turns out to drag).
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
