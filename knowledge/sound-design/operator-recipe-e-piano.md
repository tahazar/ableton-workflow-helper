---
slug: operator-recipe-e-piano
topic: sound-design
tier: draft
tags: [operator, fm-synthesis, keys, epiano, dx7, recipe]
sources: ["https://musictech.blog/fm-synthesis-explained/", "https://www.kvraudio.com/forum/viewtopic.php?t=223022", "https://www.attackmagazine.com/technique/tutorials/fm-electric-piano/", "https://djjondent.blogspot.com/2019/10/yamaha-dx7-algorithms.html", "https://patchstorage.com/dx7-piano/"]
related: [sound-design/operator-recipe-fm-bell, sound-design/operator-recipe-pluck]
---
# Operator recipe: e-piano (DX-style FM electric piano)

**Sourcing note:** citations come from search-result excerpts of the named
pages, not full-page fetches. **All raw `device.param` values below are
unverified estimates.** Read the caveat block before applying.

## Craft

The DX7 electric piano is the canonical FM patch. Sourced descriptions
agree on a two-part structure: a 1:1 body pair plus a high-ratio
bell-attack pair, layered. `musictech.blog`'s FM-synthesis explainer
describes the body: "a 1:1 ratio produces harmonically related sidebands
suitable for basses, pianos, and organs. One pair of operators with a 1:1
frequency ratio creates the body of the sound in classic DX7 electric
piano patches". It names the attack element separately: "the [next] pair
is responsible for the bell-like attack sound and uses a
modulator-carrier frequency-ratio of 14:1." The 1:1 pair gives the
sustained, slightly bell-toned body. The 14:1 pair is a short, high,
metallic transient heard only during the attack, the "tine hit" edge.

**Reachability note:** the DX7 had 6 operators (3 modulator-carrier
pairs). A KVR Audio "reconstructing that FM E.Piano" thread describes a
common DX7 structure where "the second modulator-carrier pair usually does
the same as the first with only a little detuning", a third full pair
mainly for chorus-like width. Operator has 4 oscillators (2 pairs), so
this recipe keeps the body and bell-attack pairs and drops the detuned
duplicate. That width needs Operator's `Spread` control or an external
chorus/unison effect; this recipe does not attempt a workaround.

The brightness-over-time that makes an FM e-piano sound struck comes from
the modulator's own envelope, not a filter: "a classic FM electric piano
patch uses a modulation index envelope that starts high (bright and
percussive on the attack) and decays rapidly (leaving a softer, less
harmonically complex sustain) — the modulator envelope effectively
controls the brightness envelope of the sound, a function served by the
filter envelope in subtractive synthesis" (same KVR thread). This recipe
encodes that as a fast-decaying modulator envelope on both pairs, fastest
on the 14:1 bell-attack pair, whose only job is to sound at the strike.

## Executable

```awh-operator-patch
name: e-piano
device: Operator
params:
  Algorithm: 0.7    # display: two parallel 2-operator pairs. Osc-B modulates Osc-A (body), Osc-D modulates Osc-C (bell attack); A and C are carriers summed to the output. Algorithm index not identified from sources: pick the "two stacked pairs side by side" shape in the UI and overwrite. Raw unverified.
  "A Coarse": 0.0159    # display: ratio 1, body carrier. Coarse scale per the caveat block; raw unverified.
  "A Fine": 0.0
  "Osc-A Level": 1.0        # display: full body-carrier output. Raw unverified.
  "Ae Attack": 0.0          # display: instant strike. Raw placeholder, unverified.
  "Ae Decay": 0.4           # display: moderate decay into the sustained body tone. Inferred param name (only Ae Attack confirmed); raw placeholder, unverified.
  "Ae Sustain": 0.6         # display: moderate; electric pianos sustain longer than a pluck or bell but still decay under a held note. Raw unverified, assumed raw≈display.
  "Ae Release": 0.35        # inferred param name; raw placeholder, unverified.
  "B Coarse": 0.0159    # display: ratio 1, the 1:1 body-pair modulator (sourced: the musictech.blog claim above). Same Coarse assumption; raw unverified.
  "B Fine": 0.0
  "Osc-B Level": 0.5        # display: moderate peak modulation index for the body pair. Constructed magnitude (the source gives ratio and envelope shape, not an index); raw unverified.
  "Be Attack": 0.0
  "Be Decay": 0.2           # display: fast; the modulation-index envelope that "starts high... and decays rapidly" (sourced, KVR), giving a percussive-then-soft brightness curve. Inferred param name; raw placeholder, unverified.
  "Be Sustain": 0.15        # display: low; settles to a softer, less harmonically complex sustain (same source). Raw unverified, assumed raw≈display.
  "Be Release": 0.2
  "C Coarse": 0.0159    # display: ratio 1, second carrier and the output of the bell-attack pair. The 14:1 ratio belongs to its modulator, Osc-D, below. Raw unverified.
  "C Fine": 0.0
  "Osc-C Level": 0.7        # display: bell-attack layer mixed under the body pair, present but not dominant. Constructed; raw unverified.
  "Ce Attack": 0.0
  "Ce Decay": 0.35
  "Ce Sustain": 0.5
  "Ce Release": 0.3
  "D Coarse": 0.4286    # display: ratio 14, the bell-attack modulator ratio (sourced: musictech.blog "14:1... bell-like attack sound"). Same Coarse assumption, least reliable at the high end of the range; verify against a readback before trusting. Raw unverified.
  "D Fine": 0.0
  "Osc-D Level": 0.6        # display: strong peak index for the bright metallic strike. Constructed; raw unverified.
  "De Attack": 0.0
  "De Decay": 0.08          # display: very fast; this layer only sounds at the strike ("the bell-like attack sound"), so it has the shortest of the four Decay values. Inferred param name; raw placeholder, unverified.
  "De Sustain": 0.0         # display: none, attack only.
  "De Release": 0.1
  Volume: 0.7               # confirmed device.get name; the 0.7 value is unverified for this patch.
playNotes: "1|1 C3 1 v95"
```

## Raw values: unverified, read before applying

**Confirmed scale bug, found via a real `awh op apply` on Operator:** `Algorithm`'s real raw range is 0-10 (11 quantized steps, `Alg. 1`-`Alg. 11`) and `Coarse`'s real raw range is 0-48, not the normalized 0-1 range this recipe assumed. Writing this recipe's 0-1-scaled `Algorithm`/`*Coarse` values to a real device silently rounds/clamps them to 0 (confirmed: read-back mismatch on all three). The other params (Volume, `Osc-* Level`, envelope times, `Filter Freq`/`Filter Res`) are ~0-1 scaled and wrote/read back correctly. Not corrected here: the real range does not give the correct value within it (e.g. which of the 11 algorithms is "2-operator, B into A"). That needs an ear/UI pass; `knowledge/setup/device-parameter-surface.md` has no `displayValue` API to shortcut it.

Standing caveat (same estimation method as the other Operator recipes):
**every raw value above is an unverified estimate, not a measurement.** No
Operator raw↔display pair has been read back into this repo. Apply,
listen against the display comments, correct, and record observed
raw↔display pairs here. Coarse is assumed ≈ (ratio−0.5)/31.5 across its
~0.5–32 display range, especially uncertain for `D Coarse` (ratio 14, near
the top of that range, with no real data points nearby). The four
envelope Decay values are ordering placeholders set relative to each
other (`De Decay` fastest, `Be Decay` next, `Ae`/`Ce` Decay slowest) to
encode the sourced "attack pair decays fastest" shape. None come from a
real ms→raw curve.

## Param naming: verified vs inferred

- **Verified-style**: `Algorithm`, `A Coarse`, `A Fine`,
  `Osc-A Level`, `B Coarse`, `B Fine`, `Osc-B Level`, `Ae Attack`,
  `Volume`.
- **Inferred**: `Ae Decay`, `Ae Sustain`, `Ae Release`, `Be Attack`,
  `Be Decay`, `Be Sustain`, `Be Release`, and the `Osc-C`/`Ce`/
  `Osc-D`/`De` families (extended from the `Osc-A`/`Ae` pattern; no source
  confirms Operator names its C and D params this way, though the A/B
  convention suggests it). `awh op apply` must validate every name against
  a live `device.get` dump before writing.
