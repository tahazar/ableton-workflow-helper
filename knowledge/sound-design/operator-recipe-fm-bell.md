---
slug: operator-recipe-fm-bell
topic: sound-design
tier: draft
tags: [operator, fm-synthesis, bell, inharmonic, chowning, recipe]
sources: ["https://www.modwiggler.com/forum/viewtopic.php?t=226613", "https://musictech.blog/fm-synthesis-explained/", "https://hub.yamaha.com/keyboards/synthesizers/discovering-digital-fm-john-chowning-remembers/", "https://ccrma.stanford.edu/~jos/sasp/Frequency_Modulation_FM_Synthesis.html", "https://web.uvic.ca/~aschloss/course_mat/MU307/MU307%20Labs/Tutorial%20FM.11.htm"]
related: [sound-design/operator-recipe-e-piano, sound-design/operator-recipe-pluck]
---
# Operator recipe: FM bell (inharmonic ~3.5:1 ratio bell)

**Sourcing note:** citations come from search-result excerpts of the named
pages, not full-page fetches. **All raw `device.param` values below are
unverified estimates.** Read the caveat block before applying.

## Craft

FM bells are the textbook FM demonstration: a non-integer
carrier:modulator ratio scatters the sidebands off the carrier's harmonic
series, so the ear can no longer fuse them into one pitch. A MOD WIGGLER
sound-design thread: "in-between ratios like 3.51 and 5.79 scatter
partials into inharmonic places, which is exactly what bells and gongs do
in real life... the ear can no longer fuse them into a single pitch,
making the sound turn clangorous and metallic". That is the source of
this recipe's ~3.5:1 modulator ratio. `musictech.blog`'s FM-synthesis
explainer gives an alternative irrational ratio, 1:1.41 ≈ √2, for "bells,
metallophones, and aggressive lead sounds". Either is a valid start; this
recipe uses 3.5 because it is the requested ratio and the one the MOD
WIGGLER thread ties most directly to bell/gong character.

A ratio alone gives a static clangorous chord of partials, not a strike.
The same MOD WIGGLER source names the second ingredient: "a steady drop in
modulation index from bright to pure and long exponential amplitude
decay", two envelopes moving at different rates. Since "modulation index
is the main determinant of timbre (brightness)... the modulation index is
a prime candidate to be controlled by an envelope" (a Cycling '74 FM
tutorial, echoed in other FM explainers), the standard bell construction
is: the modulator's envelope decays fast (the bright strike collapses
toward a purer tone), and the carrier's amplitude envelope decays slowly
(the long exponential tail reads as a bell ringing out). Per every source
found, the relative speed (modulator fast, carrier slow) matters more
than either absolute time.

## Executable

```awh-operator-patch
name: fm-bell
device: Operator
params:
  Algorithm: 0.5    # display: 2-operator shape, Osc-B (modulator) into Osc-A (carrier), same topology as operator-recipe-growl-bass. Algorithm index not identified from sources: pick the shape in the UI and overwrite. Raw unverified.
  "A Coarse": 0.0159    # display: ratio 1, carrier tracks the played pitch. Coarse scale per the caveat block; raw unverified.
  "A Fine": 0.0
  "Osc-A Level": 1.0        # display: full carrier output. Raw unverified.
  "Ae Attack": 0.0          # display: instant strike. Raw placeholder, unverified.
  "Ae Decay": 0.75          # display: long; the "long exponential amplitude decay" the source calls essential to the bell. Inferred param name (only Ae Attack confirmed). Raw placeholder set toward the slow end so it stays slower than Be Decay; not a ms value.
  "Ae Sustain": 0.15        # display: low; a struck bell has almost no sustain plateau. Raw unverified, assumed raw≈display.
  "Ae Release": 0.6         # display: long ring-out tail. Inferred param name; raw placeholder, unverified.
  "B Coarse": 0.0956    # display: ratio 3.51, the inharmonic modulator ratio (sourced: MOD WIGGLER "3.51 and 5.79... exactly what bells and gongs do"). Same Coarse assumption; raw unverified.
  "B Fine": 0.0
  "Osc-B Level": 0.9        # display: high peak modulation index for the bright strike transient, decaying fast via Be Decay. Constructed magnitude (the source gives the shape of the drop, not an index); raw unverified.
  "Be Attack": 0.0          # display: instant. Raw placeholder, unverified.
  "Be Decay": 0.15          # display: fast; the "steady drop in modulation index from bright to pure", kept faster than Ae Decay per the sourced two-rate bell mechanism. Inferred param name; raw placeholder, unverified.
  "Be Sustain": 0.1         # display: low; the modulator settles to a near-pure tone after the strike ("bright to pure", sourced). Raw unverified, assumed raw≈display.
  "Be Release": 0.2
  Volume: 0.7               # confirmed device.get name (device-parameter-surface.md); the 0.7 value is unverified for this patch.
playNotes: "1|1 C4 1 v100"
```

## Raw values: unverified, read before applying

**Confirmed scale bug, found via a real `awh op apply` on Operator:** `Algorithm`'s real raw range is 0-10 (11 quantized steps, `Alg. 1`-`Alg. 11`) and `Coarse`'s real raw range is 0-48, not the normalized 0-1 range this recipe assumed. Writing this recipe's 0-1-scaled `Algorithm`/`*Coarse` values to a real device silently rounds/clamps them to 0 (confirmed: read-back mismatch on all three). The other params (Volume, `Osc-* Level`, envelope times, `Filter Freq`/`Filter Res`) are ~0-1 scaled and wrote/read back correctly. Not corrected here: the real range does not give the correct value within it (e.g. which of the 11 algorithms is "2-operator, B into A"). That needs an ear/UI pass; `knowledge/setup/device-parameter-surface.md` has no `displayValue` API to shortcut it.

Standing caveat (same estimation method as the other Operator recipes):
**every raw value above is an unverified estimate, not a measurement.** No
Operator raw↔display pair has been read back into this repo
(`knowledge/setup/compressor-raw-display-mapping.md` covers the stock
Compressor only). Apply, listen against the display comments, correct, and
record observed raw↔display pairs here. Coarse is assumed ≈
(ratio−0.5)/31.5 across its ~0.5–32 display range, which puts both the
3.51 and 1 ratios near the low end of Coarse's raw range. If that
assumption is wrong, the two oscillators could land much farther apart or
closer together than intended; verify by ear or readback. Attack/Decay/
Release times are ordering placeholders chosen relative to each other (Ae
Decay slower than Be Decay) to encode the sourced two-rate envelope. None
come from a known ms→raw curve.

## Param naming: verified vs inferred

- **Verified-style**: `Algorithm`, `A Coarse`, `A Fine`,
  `Osc-A Level`, `B Coarse`, `B Fine`, `Osc-B Level`, `Ae Attack`,
  `Volume`.
- **Inferred**: `Ae Decay`, `Ae Sustain`, `Ae Release`, `Be Attack`,
  `Be Decay`, `Be Sustain`, `Be Release`. `awh op apply` must validate
  every name against a live `device.get` dump before writing.
