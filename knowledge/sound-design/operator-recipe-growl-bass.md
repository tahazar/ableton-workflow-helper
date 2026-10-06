---
slug: operator-recipe-growl-bass
topic: sound-design
tier: draft
tags: [operator, fm-synthesis, bass, growl, wobble, lfo, dubstep, recipe]
sources: ["https://www.musicradar.com/tuition/tech/how-to-make-a-growling-bass-sound-using-fm-synthesis-606919", "https://gearspace.com/board/electronic-music-instruments-and-electronic-music-production/1455373-creating-bass-guitar-sound-fm-synthesis.html", "https://forum.ableton.com/viewtopic.php?t=176511", "https://www.ableton.com/en/blog/bass-design-operator-new-tutorial-music-tech-magazine/", "https://musictech.com/tutorials/ableton-live-tutorial-operator/"]
related: [sound-design/dubstep-growl-basics, sound-design/operator-recipe-reese-approx, sound-design/operator-recipe-pluck]
---
# Operator recipe: growl bass (2-op FM growl/talking bass)

**Sourcing note:** built from search-result excerpts tied to named pages,
not full-page fetches (same caveat as
`knowledge/rhythm/dubstep-drum-pattern.md` and
`knowledge/sound-design/dubstep-growl-basics.md`). Quoted where the excerpt
was quotable, paraphrased and flagged where it aggregated. **Every raw
`device.param` value in the Executable block is an unverified estimate.**
Read the caveat block after it before applying.

## Craft

A growl/talking bass is a two-operator FM relationship, not one
oscillator through a filter: a carrier near the played fundamental,
frequency-modulated by a second oscillator at a low, mostly integer ratio.
MusicRadar's FM growl walkthrough gives an anchor: "try setting a carrier
at 55 Hz with a modulator at 110 Hz, then increase the modulator
frequency's amplitude until you hear that signature growl". That is a 2:1
ratio, with the modulator's level (not its pitch) adding the grit. A
Gearspace thread on FM bass patches corroborates the low-ratio approach:
"ratios like 0.500, 1.000, or 1.500 on the modulator relative to the
carrier for focused low-end". The exact ratio is a tone choice; staying
near-integer keeps the result pitched rather than clangorous.

The growl or wobble motion is an LFO driving either the modulator's level
(FM depth, more grit) or the filter cutoff (spectral movement).
`knowledge/sound-design/dubstep-growl-basics` [sourced] has the fuller
citation trail for that half: LFO rate synced to a musical division (1/8
triplet is the canonical wobble), the LFO delayed and retriggered per note
rather than free-running, distortion after the filter so the movement
reads as aggressive. That entry names "FMing two sine waves together" as
one of two conventional techniques for this layer. This recipe is that
technique, with Operator parameter names.

The Operator mechanic that makes the 2-op version work: an oscillator's
Level sets its output level when it is a carrier and its FM depth
(modulation index) when routed as a modulator. A forum discussion of
Operator programming: "if this oscillator is modulating another, its
level has significant influence on the resulting timbre... using an
oscillator's envelope for Level control or the LFO opens up drastic tonal
change". So an LFO or envelope driving Osc-B's Level drives the FM index,
which produces a timbral growl rather than a pitch wobble.

## Executable

```awh-operator-patch
name: growl-bass
device: Operator
params:
  Algorithm: 0.5   # display: 2-operator shape, Osc-B (modulator) into Osc-A (carrier), Osc-C/D off. Algorithm index not identified from sources: pick the "B feeds A, A is the only bottom-row carrier" shape in Live and overwrite. Raw unverified.
  "A Coarse": 0.0159   # display: ratio 1 (carrier = played fundamental). Assumes raw ≈ (ratio-0.5)/31.5 over Coarse's documented ~0.5-32 stepped display range; raw unverified.
  "A Fine": 0.0        # display: 0 cents. Raw unverified.
  "Osc-A Level": 1.0       # display: full carrier output. Raw unverified, assumed raw≈display fraction.
  "Ae Attack": 0.0         # display: ~0 ms, instant. Raw placeholder, unverified (no ms->raw curve known).
  "Ae Decay": 0.3          # display: medium decay into sustain. Inferred param name: only "Ae Attack" is a confirmed device.get name, Decay/Sustain/Release follow its naming convention. Raw placeholder, unverified.
  "Ae Sustain": 0.85       # display: high, the bass holds through the note. Raw unverified, assumed raw≈display.
  "Ae Release": 0.2        # display: short-medium. Inferred param name; raw placeholder, unverified.
  "B Coarse": 0.0476   # display: ratio 2 (2:1 modulator, the MusicRadar 55Hz/110Hz growl example). Same Coarse assumption; raw unverified.
  "B Fine": 0.0        # display: 0 cents. Raw unverified.
  "Osc-B Level": 0.4       # display: moderate FM index ("growl amount"). Constructed starting depth; no source gives a modulator level. Raw unverified.
  "Be Attack": 0.0         # inferred param name (B's envelope, by analogy with Ae). Raw placeholder, unverified.
  "Be Decay": 0.3
  "Be Sustain": 0.8
  "Be Release": 0.2
  "Filter Freq": 0.5       # display: moderate lowpass cutoff to tame upper harmonics. Inferred param name, constructed display target (no sourced number); raw unverified.
  "Filter Res": 0.15       # inferred param name; raw unverified.
  "LFO Type": 0.0      # display: Sine/Triangle. Inferred param name; raw unverified (waveform index unknown).
  "LFO Rate": 0.3          # display: 1/8-note triplet, tempo-synced, the canonical wobble division per dubstep-growl-basics (sourced). Inferred param name; unknown whether Rate encodes the sync division or a separate sync toggle exists (the LFO section's "S"/"L" sync control has no identified device.get name). Raw placeholder: an intent marker, not a value to trust.
  "LFO Amt": 0.5        # display: moderate depth into Osc-B Level (the FM-index route above). Constructed; raw unverified. Unconfirmed whether the LFO destination chooser is device.param-addressable (docs/design/operator-assistant.md: destinations are set via UI choosers); probe before assuming `awh op apply` can route the LFO.
  Volume: 0.7              # display: near-unity output. "Volume" is a confirmed device.get name (knowledge/setup/device-parameter-surface.md); the 0.7 value is unverified for this patch.
playNotes: "1|1 F1 1 v110"
```

## Raw values: unverified, read before applying

**Confirmed scale bug, found via a real `awh op apply` on Operator:** `Algorithm`'s real raw range is 0-10 (11 quantized steps, `Alg. 1`-`Alg. 11`) and `Coarse`'s real raw range is 0-48, not the normalized 0-1 range this recipe assumed. Writing this recipe's 0-1-scaled `Algorithm`/`*Coarse` values to a real device silently rounds/clamps them to 0 (confirmed: read-back mismatch on all three). The other params (Volume, `Osc-* Level`, envelope times, `Filter Freq`/`Filter Res`) are ~0-1 scaled and wrote/read back correctly. Not corrected here: the real range does not give the correct value within it (e.g. which of the 11 algorithms is "2-operator, B into A"). That needs an ear/UI pass; `knowledge/setup/device-parameter-surface.md` has no `displayValue` API to shortcut it.

Standing caveat (applies to every param line above): **all raw values are
unverified estimates, not measurements.** No Operator raw↔display pair has
been read back into this repo. `knowledge/setup/compressor-raw-display-mapping.md`
is the only entry with real raw↔display data, and it covers the stock
Compressor, not Operator. Apply this recipe, listen, correct by ear against
the display comments, and record observed raw↔display pairs here (the
measure→adjust→verify loop that entry documents).

Estimation assumptions (stated, not sourced): Coarse is a stepped
ratio selector assumed linear across Operator's documented ~0.5–32 display
range, so raw ≈ (ratio−0.5)/31.5. Fine spans one octave in cents,
positive-only per a sourced description, so raw ≈ cents/1200. Level,
Sustain, Res and Amount-type 0–1 dials are assumed raw ≈ display.
Attack/Decay/Release times, Filter Freq and LFO Rate have no Operator
scale data in this repo; the numbers above are ordering placeholders (fast
≈ 0.0–0.15, medium ≈ 0.3–0.5, slow ≈ 0.7+), not a curve. The Algorithm
index within the 11 shapes is not identified from sourced material; dial
it by eye first.

## Param naming: verified vs inferred

- **Verified-style** (from `device-parameter-surface.md` / the pinned
  patch-block spec): `Algorithm`, `A Coarse`, `A Fine`,
  `Osc-A Level`, `B Coarse`, `B Fine`, `Osc-B Level`, `Ae Attack`,
  `Volume`.
- **Inferred** (extended from the verified naming convention, not
  individually confirmed against a real `device.get` dump): `Ae Decay`,
  `Ae Sustain`, `Ae Release`, `Be Attack`, `Be Decay`, `Be Sustain`,
  `Be Release`, `Filter Freq`, `Filter Res`, `LFO Type`, `LFO Rate`,
  `LFO Amt`. Before `awh op apply` runs this recipe, it must validate
  every name against a live `device.get` dump and fail loudly on any name
  Operator does not have (per `docs/design/operator-assistant.md`).
