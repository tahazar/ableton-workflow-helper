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
