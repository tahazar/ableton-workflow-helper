---
slug: operator-recipe-sub-click
topic: sound-design
tier: draft
tags: [operator, fm-synthesis, bass, sub, click, transient, trap, dubstep, recipe]
sources: ["https://beatkitchen.io/guides/electronic-music/04-bass-design/", "https://unison.audio/transforming-your-808s/", "https://unison.audio/808-sound-design/", "https://forum.ableton.com/viewtopic.php?t=224666", "https://angstromnoises.com/13-advanced-tips-abletons-operator/", "https://www.ableton.com/en/blog/get-deep-make-sub-bass-operator/"]
related: [sound-design/operator-recipe-reese-approx, sound-design/operator-recipe-growl-bass]
---
# Operator recipe: sub + click (clean sub with a transient click layer)

**Sourcing note:** same sourcing method and caveat as
`sound-design/operator-recipe-growl-bass`: citations come from
search-result excerpts of the named pages, not full-page fetches. **All
raw `device.param` values below are unverified estimates.** Read the
caveat block before applying.

## Craft

Sub-heavy low end in dubstep/trap is conventionally two separable layers:
a pure sub tone that never moves, and a short transient on top that gives
the ear an attack to track. A bass-design guide on the sub layer: "start
with your core sub layer — a pure sine or clean sample hitting around
45–55 Hz — and keep that one untouched and mono all the way through". A
companion 808 sound-design article treats the transient as its own job:
"a popular technique is to layer a short, percussive transient (such as a
kick drum click or short pluck) on top of the [sub] to boost attack and
presence while keeping the booming bass sound clean," so that "the kick
transient hit[s] first, then the [sub] bass fades in." The layers are
designed and gain-staged independently, then summed.

**The Operator mechanism for the click:** each oscillator has a Phase
parameter setting where in its cycle the wave starts on each trigger. A
sine starting at its zero-crossing is click-free. Offsetting Phase makes
the waveform jump at note-on, normally a bug but here the transient
source. An Ableton Forum thread on Operator clicking and a synth-tips
roundup both describe it: "if a sinewave waveform starts or finishes
suddenly anywhere other than 0, it can click... this clicking can be used
to your advantage in sound design — if you want a more click-y kick drum,
you can move the phase so the sine does not start at zero." This recipe
keeps the sub oscillator's Phase at 0 (click-free, per the same source:
"to avoid unwanted clicks, keep the Phase at 0") and offsets the click
oscillator's Phase to generate the transient, instead of using a separate
noise or drum sample.

## Executable

```awh-operator-patch
name: sub-click
device: Operator
params:
  Algorithm: 0.2   # display: parallel carriers, Osc-A and Osc-B both carriers with no FM routing between them (this patch sums layers). Algorithm index not identified from sources: pick the "A and B both bottom-row, no lines between them" shape in the UI and overwrite. Raw unverified.
  "A Coarse": 0.0159    # display: ratio 1, the sub carrier tracks the played note (e.g. C1 for a ~33Hz trap sub). Coarse scale per the caveat block; raw unverified.
  "A Fine": 0.0         # display: 0 cents, in tune. Raw unverified.
  "Osc-A Level": 1.0        # display: full sub output. Raw unverified.
  "Osc-A Phase": 0.0        # display: 0 (zero-crossing start), so the sub layer is click-free per the sourced Phase behavior above. Inferred param name: "Phase" is a sourced Operator UI control, its device.get spelling is not. Raw unverified, but 0.0 is the most reliable estimate here since Phase 0 is the zero point of the range.
  "Ae Attack": 0.0          # display: instant. Raw placeholder, unverified.
  "Ae Decay": 0.2           # inferred param name (only Ae Attack is confirmed); raw placeholder, unverified.
  "Ae Sustain": 0.9         # display: high; the sub sustains through the whole note ("keep that one untouched... all the way through"). Raw unverified, assumed raw≈display.
  "Ae Release": 0.25        # inferred param name; raw placeholder, unverified.
  "B Coarse": 0.0159    # display: ratio 1; the click carrier tracks the same fundamental so it reads as part of the sub hit, not a separate pitch. Same Coarse assumption; raw unverified.
  "B Fine": 0.0
  "Osc-B Level": 0.5        # display: click mixed under the sub so it reads as attack, not a second tone ("transient hits first, then the sub fades in, keeping separation", sourced). Constructed level (no sourced mix ratio); raw unverified.
  "Osc-B Phase": 0.35       # display: offset from 0; this is the click generator, per the sourced Operator Phase-click mechanism. Constructed, arbitrary non-zero amount (the source gives the mechanism, not a value); raw unverified. Dial the click by ear.
  "Be Attack": 0.0          # display: instant. Raw placeholder, unverified.
  "Be Decay": 0.05          # display: very short; the click decays out of the sub's way, following the sourced "kick transient hits first, then sub fades in" ordering. Inferred param name, constructed display target; raw unverified.
  "Be Sustain": 0.0         # display: none, pure transient.
  "Be Release": 0.05
  Volume: 0.75              # confirmed device.get name (device-parameter-surface.md); the 0.75 value is unverified for this patch.
playNotes: "1|1 C1 1 v120"
```

## Raw values: unverified, read before applying

**Confirmed scale bug, found via a real `awh op apply` on Operator:** `Algorithm`'s real raw range is 0-10 (11 quantized steps, `Alg. 1`-`Alg. 11`) and `Coarse`'s real raw range is 0-48, not the normalized 0-1 range this recipe assumed. Writing this recipe's 0-1-scaled `Algorithm`/`*Coarse` values to a real device silently rounds/clamps them to 0 (confirmed: read-back mismatch on all three). The other params (Volume, `Osc-* Level`, envelope times, `Filter Freq`/`Filter Res`) are ~0-1 scaled and wrote/read back correctly. Not corrected here: the real range does not give the correct value within it (e.g. which of the 11 algorithms is "2-operator, B into A"). That needs an ear/UI pass; `knowledge/setup/device-parameter-surface.md` has no `displayValue` API to shortcut it.

Standing caveat (same estimation method as `operator-recipe-growl-bass`):
**every raw value above is an unverified estimate, not a measurement.**
Apply, listen against the display comments, correct, and record observed
raw↔display pairs here, following the measure→adjust→verify loop in
`knowledge/setup/compressor-raw-display-mapping.md` (which has real data
for the stock Compressor only, not Operator). Assumptions: Coarse ≈
(ratio−0.5)/31.5 across its ~0.5–32 display range; Level/Sustain ≈
display; Attack/Decay/Release times are ordering placeholders (no ms→raw
curve known). Phase 0.0 as the zero-crossing is the most confident
estimate, since the source describes it as the range's zero. The click
Phase offset (0.35) is an arbitrary non-zero placeholder, not a sourced or
derived click character; dial it by ear.

## Param naming: verified vs inferred

- **Verified-style**: `Algorithm`, `A Coarse`, `A Fine`,
  `Osc-A Level`, `B Coarse`, `B Fine`, `Osc-B Level`, `Ae Attack`,
  `Volume`.
- **Inferred**: `Osc-A Phase` / `Osc-B Phase` (the Phase control is
  sourced from Operator tutorials and forum threads; its exact
  `device.get` spelling is a naming-convention guess), `Ae Decay`,
  `Ae Sustain`, `Ae Release`, `Be Attack`, `Be Decay`, `Be Sustain`,
  `Be Release`. `awh op apply` must validate every name against a live
  `device.get` dump before writing, per `docs/design/operator-assistant.md`.
