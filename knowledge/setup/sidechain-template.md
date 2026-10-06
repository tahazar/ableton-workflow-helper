---
slug: sidechain-template
topic: setup
tier: verified
tags: [sidechain, routing, shaperbox, volume-shaper, template, pump]
sources: ["owner description, 2026-08-17 (M6 verification session)"]
related: [docs/design/analysis-engine.md]
---
# Owner's sidechain template (project default)

The owner's standing project template. Read this before designing or
debugging anything sidechain or pump related. Projects are wired this way
unless stated otherwise.

## Signal routing

- **BASS** and **SAMPLES** (group tracks) → a track named **Sidechain** →
  Main.
- **Drums** routes straight to Main, bypassing the Sidechain track.
- A MIDI track named **Trigger** duplicates the Kick & Snare notes. This MIDI
  is the trigger source; the shaper is not audio-triggered from the drum bus.

## Processor: Cableguys ShaperBox 3 (Volume Shaper), on the Sidechain track

Facts that break compressor-shaped assumptions:

- Volume Shaper is not a reactive threshold/ratio compressor. It applies a
  fixed, user-drawn gain-reduction envelope, retriggered by the incoming MIDI
  trigger. Every hit gets the same programmed dip regardless of trigger
  loudness.
- Trigger-locked, not amplitude-reactive: a working duck starts at the
  trigger note's exact timing, with no attack-detection latency.
- Triggers follow the Kick & Snare pattern, often not one per beat. A
  detector that assumes one trough per beat period measures the wrong thing on
  this template.

## Implications for pump detection (evidence-backed)

Live falsification during pump-detection verification: disabling Volume
Shaper entirely on sidechained content barely moved the folded-RMS trough
offset (228 ms → 218 ms). The beat-period fold picks up the bass/sample
content's own rhythmic note decay, not the duck.

Redesign direction (owner-proposed, agreed):

1. Read the Trigger clip's note positions (`clip.get` on the Trigger track)
   instead of assuming beat-grid periodicity.
2. Measure the ducked signal's RMS trough timing relative to each trigger
   note, not folded against a generic period.
3. Separate ducking from natural decay with an A/B (shaper on vs Device On →
   0), reusing `awh mix ab`'s loudness-matched comparison. A real duck shows a
   sharp, uniform, onset-synced drop that natural decay does not.
4. The dip shape is user-drawn and fixed, so once trigger positions are known,
   **fit the programmed envelope** (attack/hold/release) from the
   trigger-aligned averages and report that. It is more accurate than
   statistical depth/recovery inference and matches what the device does.

Capture-based checks on this template:

- The duck lives on the Sidechain track's output. A tap there isolates the
  ducked signal; a tap on Main mixes drums back in.
- "Bypass" for A/B = ShaperBox Device On → 0 on the Sidechain track (one
  `device.param` call, automatable in an `awh` flow).

## Ducking strategies (owner decision 2026-08-17: ShaperBox = one option)

| Strategy | Automation level | How |
|---|---|---|
| **ShaperBox Volume Shaper** | manual draw, fitted numbers | `awh mix duck fit` → draw the printed points (preset files are unwritable, see docs/research/shaperbox-preset-format.md) |
| **Stock Compressor (sidechain)** | near-automatic | `awh mix duck setup <Sidechain track>` inserts and presets it (fastest attack, max ratio). Two manual touches (SDK has no routing API): enable Sidechain + Audio From = trigger source, and dial Release to the fitted ms. Then `awh mix duck calibrate` closes the loop: capture → measure achieved depth → adjust Threshold → repeat until it hits the fitted target |
| **AWH M4L Ducker** | fully automatic | `m4l/AWH Ducker.maxpat`: a transport-synced gain-envelope device, placed once by hand on the Sidechain track (replacing, or after, a bypassed Volume Shaper), then driven over OSC: `awh mix duck fit ... --json > fit.json` then `awh mix duck push --fit fit.json --trigger-clip <Trigger clip>`. No routing clicks or manual dial-turning; see `m4l/README.md` |
| **Volume automation** | not writable | the Extensions SDK has no automation/clip-envelope API (ADR-001 accepted loss); the parked offline-.als-injection experiment is the only other path |

Verification is strategy-independent: `awh mix duck measure` on a Sidechain-
bus capture (achieved depth), or an on/off `awh mix ab` pair.
