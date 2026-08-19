---
slug: operator-recipe-growl-bass
topic: sound-design
tier: draft
tags: [operator, fm-synthesis, bass, growl, wobble, lfo, dubstep, recipe]
sources: ["https://www.musicradar.com/tuition/tech/how-to-make-a-growling-bass-sound-using-fm-synthesis-606919", "https://gearspace.com/board/electronic-music-instruments-and-electronic-music-production/1455373-creating-bass-guitar-sound-fm-synthesis.html", "https://forum.ableton.com/viewtopic.php?t=176511", "https://www.ableton.com/en/blog/bass-design-operator-new-tutorial-music-tech-magazine/", "https://musictech.com/tutorials/ableton-live-tutorial-operator/"]
related: [sound-design/dubstep-growl-basics, sound-design/operator-recipe-reese-approx, sound-design/operator-recipe-pluck]
---
# Operator recipe: growl bass (2-op FM growl/talking bass)

**Sourcing note:** WebFetch is egress-blocked in this container for the hosts
checked this session, so this entry is built from WebSearch-tool excerpts
tied to named pages, not raw page fetches — same honesty caveat as
`knowledge/rhythm/dubstep-drum-pattern.md` and
`knowledge/sound-design/dubstep-growl-basics.md`. Quoted where the search
tool returned a quotable phrase, paraphrased/flagged where it aggregated.
**Every raw `device.param` value in the Executable block below is an
unverified estimate** — see the caveat block after it before applying.

## Craft

A growl/talking bass is a two-operator FM relationship, not a single
oscillator with a filter on it: a carrier near the played fundamental,
modulated in frequency by a second oscillator at a low, mostly-integer
ratio. MusicRadar's FM growl walkthrough gives a concrete anchor point —
"try setting a carrier at 55 Hz with a modulator at 110 Hz, then increase
the modulator frequency's amplitude until you hear that signature growl,"
i.e. a 2:1 ratio, with the modulator's *level* (not its pitch) doing the
work of adding grit. A Gearspace thread on FM bass guitar/bass patches
corroborates the low-ratio approach, suggesting "ratios like 0.500, 1.000,
or 1.500 on the modulator relative to the carrier for focused low-end" —
the exact ratio is a tone choice, but staying near-integer keeps the result
harmonic (pitched) rather than clangorous.

The "growl" or "wobble" motion itself is a low-frequency oscillator (LFO)
driving either the modulator's level (FM depth — more grit) or the filter
cutoff (spectral movement), and `knowledge/sound-design/dubstep-growl-basics`
[sourced] is the fuller citation trail for that half of the patch: LFO rate
synced to a musical division (1/8 triplet is the canonical wobble), the LFO
delayed and retriggered per note rather than free-running, distortion
placed after the filter to make the movement read as aggressive. That
entry's low-end-movement section names "FMing two sine waves together" as
one of exactly two conventional techniques for this layer — this recipe is
that technique, built out with Operator-specific parameter names.

Operator-specific mechanics that make the 2-op version work: an
oscillator's **Level** sets both its own output level when it's a carrier
*and* its FM depth (modulation index) when it's routed as a modulator into
another oscillator — a forum discussion of Operator programming states this
plainly ("if this oscillator is modulating another, its level has
significant influence on the resulting timbre... using an oscillator's
envelope for Level control or the LFO opens up drastic tonal change"). That
is the mechanism this recipe leans on: LFO (or an envelope) driving
Osc-B's Level *is* driving the FM index, which is what produces the
timbral "growl" rather than a pitch wobble.

## Executable

```awh-operator-patch
name: growl-bass
device: Operator
params:
  Algorithm: 0.5   # display: 2-operator shape — Osc-B (modulator) into Osc-A (carrier), Osc-C/D unused/off. Which of Operator's 11 algorithm shapes carries this index is NOT identified from sourced material — dial to the "B feeds down into A, A is the only bottom-row carrier" shape by eye in Live and overwrite this placeholder. RAW UNVERIFIED.
  "Osc-A Coarse": 0.0159   # display: ratio 1 (carrier = played fundamental). Assumed raw ≈ (ratio-0.5)/31.5 across Coarse's documented ~0.5-32 stepped display range — RAW UNVERIFIED, stated assumption only.
  "Osc-A Fine": 0.0        # display: 0 cents — RAW UNVERIFIED.
  "Osc-A Level": 1.0       # display: full carrier output — RAW UNVERIFIED, assumed raw≈display fraction.
  "Ae Attack": 0.0         # display: ~0 ms, instant — RAW UNVERIFIED placeholder (no ms->raw curve known).
  "Ae Decay": 0.3          # display: medium decay into sustain — INFERRED param name (only "Ae Attack" is a confirmed device.get name; Decay/Sustain/Release for the A envelope are extended by naming-convention guess). RAW UNVERIFIED placeholder.
  "Ae Sustain": 0.85       # display: high — bass holds through the note. RAW UNVERIFIED, assumed raw≈display.
  "Ae Release": 0.2        # display: short-medium — INFERRED param name. RAW UNVERIFIED placeholder.
  "Osc-B Coarse": 0.0476   # display: ratio 2 (2:1 modulator — the MusicRadar 55Hz/110Hz growl example). Same Coarse assumption as above — RAW UNVERIFIED.
  "Osc-B Fine": 0.0        # display: 0 cents — RAW UNVERIFIED.
  "Osc-B Level": 0.4       # display: moderate FM index / "growl amount". CONSTRUCTED — no source gives one exact modulator-level number for this effect; this is a reasonable starting depth chosen by this entry, not a sourced value. RAW UNVERIFIED.
  "Be Attack": 0.0         # INFERRED param name (B's envelope, by extension of the Ae pattern). RAW UNVERIFIED placeholder.
  "Be Decay": 0.3
  "Be Sustain": 0.8
  "Be Release": 0.2
  "Filter Freq": 0.5       # display: moderate lowpass cutoff to tame upper harmonics. INFERRED param name, CONSTRUCTED display target (no source number) — RAW UNVERIFIED.
  "Filter Res": 0.15       # INFERRED param name — RAW UNVERIFIED.
  "LFO Waveform": 0.0      # display: Sine/Triangle. INFERRED param name — RAW UNVERIFIED (waveform index unknown).
  "LFO Rate": 0.3          # display: 1/8-note triplet, tempo-synced — the canonical wobble division per dubstep-growl-basics[sourced]. INFERRED param name AND unconfirmed whether Rate itself encodes sync division vs a separate sync toggle exists (search found an "S"/"L" sync control in the LFO section whose device.get name was not identified). RAW UNVERIFIED placeholder — treat this whole line as a rough intent marker, not a value to trust.
  "LFO Amount": 0.5        # display: moderate modulation depth into Osc-B Level (the FM-index route described above) — CONSTRUCTED, RAW UNVERIFIED. Whether the LFO's destination-chooser is itself device.param-addressable is UNCONFIRMED (per docs/design/operator-assistant.md, destinations are set via UI choosers) — probe this before assuming `awh op apply` can route the LFO at all.
  Volume: 0.7              # display: near-unity output. "Volume" IS a confirmed device.get name (knowledge/setup/device-parameter-surface.md). This specific 0.7 value/display pairing is still RAW UNVERIFIED for this patch.
playNotes: "1|1 F1 1 v110"
```

## Raw values: unverified — read before applying

Standing caveat (applies to every param line above): **all raw values are
unverified estimates, not measurements.** No Operator raw↔display pair has
ever been read back into this repo — `knowledge/setup/compressor-raw-display-mapping.md`
is the only entry with real raw↔display data, and it covers the stock
Compressor, not Operator. Apply this recipe, listen, correct by ear against
the DISPLAY comments above, and record the observed raw↔display pairs back
into this entry — the same measure→adjust→verify loop that entry documents.

Estimation assumptions used (stated, not sourced): **Coarse** is a stepped
ratio selector assumed linear across Operator's documented ~0.5–32 display
range → raw ≈ (ratio−0.5)/31.5. **Fine** spans one octave in cents,
positive-only per a sourced description → raw ≈ cents/1200. **Level /
Sustain / Res / Amount**-type 0–1 dials → assumed raw ≈ display directly.
**Attack/Decay/Release times, Filter Freq, LFO Rate** → no scale data
exists anywhere in this repo for Operator; the numbers above are ordering
placeholders (fast ≈ 0.0–0.15, medium ≈ 0.3–0.5, slow ≈ 0.7+), not a curve.
**Algorithm** index within the 11 shapes is not identified from sourced
material at all — dial by eye, first.

## Param naming: verified vs inferred

- **Verified-style** (from `device-parameter-surface.md` / the pinned
  patch-block spec): `Algorithm`, `Osc-A Coarse`, `Osc-A Fine`,
  `Osc-A Level`, `Osc-B Coarse`, `Osc-B Fine`, `Osc-B Level`, `Ae Attack`,
  `Volume`.
- **Inferred** (extended from the verified naming convention, NOT
  individually confirmed against a real `device.get` dump): `Ae Decay`,
  `Ae Sustain`, `Ae Release`, `Be Attack`, `Be Decay`, `Be Sustain`,
  `Be Release`, `Filter Freq`, `Filter Res`, `LFO Waveform`, `LFO Rate`,
  `LFO Amount`. Before `awh op apply` runs this recipe, it must validate
  every name against a live `device.get` dump first and fail loudly on any
  name Operator doesn't actually have (per `docs/design/operator-assistant.md`).
