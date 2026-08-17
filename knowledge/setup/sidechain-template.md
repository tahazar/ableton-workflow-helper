---
slug: sidechain-template
topic: setup/routing
tier: verified
tags: [sidechain, routing, shaperbox, volume-shaper, template, pump]
sources: ["owner description, 2026-08-17 (M6 verification session)"]
related: [docs/design/analysis-engine.md]
---
# Owner's sidechain template (project default)

The owner's standing project template — READ THIS before designing or
debugging anything sidechain/pump related. This is how their projects are
wired unless stated otherwise.

## Signal routing

- **BASS** and **SAMPLES** (group tracks) → routed into a track named
  **Sidechain** → output to Main.
- **Drums** routes straight to Main (bypasses the Sidechain track entirely).
- A dedicated MIDI track named **Trigger** duplicates the notes from Kick &
  Snare. This MIDI is the trigger source — the shaper is NOT audio-triggered
  from the drum bus.

## Processor: Cableguys ShaperBox 3 (Volume Shaper), on the Sidechain track

Key facts that break compressor-shaped assumptions:

- Volume Shaper is **not a reactive threshold/ratio compressor**. It applies
  a **fixed, user-drawn gain-reduction envelope**, retriggered by the
  incoming MIDI trigger — every hit gets the same programmed dip regardless
  of trigger loudness.
- Trigger-locked, not amplitude-reactive: a correctly-functioning duck
  starts at the **trigger note's exact timing**. There is no
  attack-detection latency to account for.
- Triggers follow the Kick & Snare pattern — often NOT one-per-beat. Any
  detector that assumes "one trough per beat period" is measuring the wrong
  thing on this template.

## Implications for pump detection (evidence-backed)

Live falsification (M6 verification): disabling Volume Shaper entirely on
genuinely sidechained content barely moved the folded-RMS trough offset
(228 ms → 218 ms). The beat-period fold picks up the bass/sample content's
own rhythmic note decay, not the duck.

Redesign direction (owner-proposed, agreed):

1. **Read the actual Trigger clip's note positions** (`clip.get` on the
   Trigger track) instead of assuming beat-grid periodicity.
2. Measure the ducked signal's RMS trough timing **relative to each
   individual trigger note**, not folded against a generic period.
3. Distinguish genuine ducking from natural decay with a **real A/B**
   (shaper on vs Device On → 0), reusing `awh mix ab`'s loudness-matched
   comparison — a real duck shows a sharp, uniform, onset-synced drop that
   natural decay doesn't.
4. Since the dip shape is user-drawn and fixed, once trigger positions are
   known, **fit the programmed envelope** (attack/hold/release) from the
   trigger-aligned averages and report THAT — more accurate than statistical
   depth/recovery inference, and it matches what the device actually does.

Practical notes for capture-based checks on this template:

- The duck lives on the **Sidechain track's** output — a tap on that track
  isolates the ducked signal cleanly; a tap on Main mixes drums back in.
- "Bypass" for A/B = ShaperBox **Device On → 0** on the Sidechain track
  (one `device.param` call — automatable in an `awh` flow).
