---
slug: operator-recipe-e-piano
topic: sound-design
tier: draft
tags: [operator, fm-synthesis, keys, epiano, dx7, recipe]
sources: ["https://musictech.blog/fm-synthesis-explained/", "https://www.kvraudio.com/forum/viewtopic.php?t=223022", "https://www.attackmagazine.com/technique/tutorials/fm-electric-piano/", "https://djjondent.blogspot.com/2019/10/yamaha-dx7-algorithms.html", "https://patchstorage.com/dx7-piano/"]
related: [sound-design/operator-recipe-fm-bell, sound-design/operator-recipe-pluck]
---
# Operator recipe: e-piano (DX-style FM electric piano)

**Sourcing note:** same WebSearch-excerpt-only method as the other entries
in this batch — WebFetch was egress-blocked for every host tried this
session; citations are tied to named pages via search-tool excerpts, not
raw fetches. **All raw `device.param` values below are unverified
estimates** — read the caveat block before applying.

## Craft

The DX7 electric piano is arguably THE canonical FM patch, and the sourced
descriptions of how it's built converge on the same two-part structure: a
**1:1 body pair** plus a **high-ratio bell-attack pair**, layered together.
`musictech.blog`'s FM-synthesis explainer states the body mechanism plainly
— "a 1:1 ratio produces harmonically related sidebands suitable for basses,
pianos, and organs. One pair of operators with a 1:1 frequency ratio
creates the body of the sound in classic DX7 electric piano patches" — and
names the attack element separately: "the [next] pair is responsible for
the bell-like attack sound and uses a modulator-carrier frequency-ratio of
14:1." The two layers do different timbral jobs: the 1:1 pair gives the
sustained, slightly-bell-toned body tone electric pianos are known for; the
14:1 pair is a short, high, metallic transient that only reads during the
attack, giving the classic "tine hit" percussive edge.

**Reachability note** (this matters for Operator specifically): the DX7
had 6 operators (3 modulator-carrier pairs); a KVR Audio "reconstructing
that FM E.Piano" thread describes a common DX7 patch structure where "the
second modulator-carrier pair usually does the same as the first with only
a little detuning" — i.e. a THIRD full pair, mainly for chorus-like width,
on top of the two functional pairs above. Operator has only 4 oscillators
(2 pairs), so this recipe keeps the two functionally-distinct pairs (body,
bell-attack) and drops the DX7's third detuned-duplicate pair — that width
effect is out of reach on Operator's 4-oscillator architecture and would
need Operator's own `Spread` control or an external chorus/unison effect
instead, not a claim this recipe fabricates a workaround for.

The brightness-over-time shaping that makes an FM e-piano sound like a
struck instrument rather than a static tone comes from the modulator's OWN
envelope, not a filter: "a classic FM electric piano patch uses a
modulation index envelope that starts high (bright and percussive on the
attack) and decays rapidly (leaving a softer, less harmonically complex
sustain) — the modulator envelope effectively controls the brightness
envelope of the sound, a function served by the filter envelope in
subtractive synthesis" (same KVR thread). This recipe encodes that as a
fast-decaying modulator envelope on BOTH pairs — sharpest/fastest on the
14:1 bell-attack pair, since that layer's entire job is to be present only
at the strike.

## Executable

```awh-operator-patch
name: e-piano
device: Operator
params:
  Algorithm: 0.7    # display: two independent 2-operator pairs mixed in parallel — Osc-B modulates Osc-A (body pair), Osc-D modulates Osc-C (bell-attack pair), both A and C are bottom-row carriers summed to the output. Index within the 11 algorithm shapes NOT identified from sourced material — dial to the "two separate stacked pairs side by side" shape by eye and overwrite. RAW UNVERIFIED.
  "A Coarse": 0.0159    # display: ratio 1 — body carrier. Coarse-scale assumption per the caveat block — RAW UNVERIFIED.
  "A Fine": 0.0
  "Osc-A Level": 1.0        # display: full body-carrier output — RAW UNVERIFIED.
  "Ae Attack": 0.0          # display: instant strike — RAW UNVERIFIED placeholder.
  "Ae Decay": 0.4           # display: moderate initial decay into the sustained body tone — INFERRED param name (only Ae Attack confirmed) — RAW UNVERIFIED placeholder.
  "Ae Sustain": 0.6         # display: moderate — electric pianos sustain longer than a plucked/bell tone but still decay slowly under a held note. RAW UNVERIFIED, assumed raw≈display.
  "Ae Release": 0.35        # INFERRED param name — RAW UNVERIFIED placeholder.
  "B Coarse": 0.0159    # display: ratio 1 — the 1:1 body-pair modulator, sourced directly from the musictech.blog claim above. Same Coarse assumption — RAW UNVERIFIED.
  "B Fine": 0.0
  "Osc-B Level": 0.5        # display: moderate peak modulation index for the body pair. CONSTRUCTED magnitude (source describes ratio and envelope shape, not an exact index) — RAW UNVERIFIED.
  "Be Attack": 0.0
  "Be Decay": 0.2           # display: fast — the modulation-index envelope that "starts high... and decays rapidly," per the sourced KVR description, giving the percussive-then-soft brightness curve. INFERRED param name — RAW UNVERIFIED placeholder.
  "Be Sustain": 0.15        # display: low — settles to a softer, less harmonically complex sustain, per the same source. RAW UNVERIFIED, assumed raw≈display.
  "Be Release": 0.2
  "C Coarse": 0.0159    # display: ratio 1 — second carrier, part of the bell-attack pair's OUTPUT (carrier, not the 14:1 element itself — the 14:1 ratio belongs to its modulator, Osc-D, below). RAW UNVERIFIED.
  "C Fine": 0.0
  "Osc-C Level": 0.7        # display: bell-attack layer mixed under the body pair, present but not dominant. CONSTRUCTED — RAW UNVERIFIED.
  "Ce Attack": 0.0
  "Ce Decay": 0.35
  "Ce Sustain": 0.5
  "Ce Release": 0.3
  "D Coarse": 0.4286    # display: ratio 14 — the bell-like-attack modulator ratio, sourced directly from the musictech.blog "14:1... bell-like attack sound" claim above. Same Coarse-scale assumption — RAW UNVERIFIED (note this assumption is especially shaky at the high end of Coarse's range; verify against a real readback before trusting this number at all).
  "D Fine": 0.0
  "Osc-D Level": 0.6        # display: strong peak index for the bright metallic strike. CONSTRUCTED — RAW UNVERIFIED.
  "De Attack": 0.0
  "De Decay": 0.08          # display: very fast — this layer's whole job is to be present only at the strike ("the bell-like attack sound"), so it decays out fastest of all four envelopes in this patch. INFERRED param name — RAW UNVERIFIED placeholder, deliberately the fastest of the four Decay values here to encode the sourced "attack element only" role.
  "De Sustain": 0.0         # display: none — no sustained bell tone, attack-only.
  "De Release": 0.1
  Volume: 0.7               # confirmed device.get name. This 0.7 value is RAW UNVERIFIED for this patch.
playNotes: "1|1 C3 1 v95"
```

## Raw values: unverified — read before applying

**CONFIRMED (not just unverified) scale bug, found via a real `awh op apply` on Operator**: `Algorithm`'s real raw range is **0-10** (11 quantized steps, `Alg. 1`-`Alg. 11`), and `Coarse`'s real raw range is **0-48** — NOT the normalized 0-1 range this recipe assumed for every param. Writing this recipe's 0-1-scaled values for `Algorithm`/`*Coarse` against a real device silently round/clamp to 0 (confirmed: read-back mismatch on all three). Every OTHER param in this recipe (Volume, `Osc-* Level`, envelope times, `Filter Freq`/`Filter Res`) genuinely IS ~0-1 scaled and wrote/read back correctly — this is specifically an `Algorithm`/`Coarse` problem, not a whole-recipe one. Not corrected here: knowing the real RANGE doesn't tell us the CORRECT value within it (e.g. which of the 11 algorithms is "2-operator, B into A") — that still needs a real ear/UI pass, `knowledge/setup/device-parameter-surface.md` has no `displayValue` API to shortcut it.

Standing caveat (same estimation method as the other entries in this
batch): **every raw value above is an unverified estimate, not a
measurement.** No Operator raw↔display pair has ever been read back into
this repo. Apply, listen against the DISPLAY comments, correct, and record
observed raw↔display pairs back into this entry. Coarse assumed ≈
(ratio−0.5)/31.5 across its ~0.5–32 display range — flagged as especially
uncertain for `D Coarse` (ratio 14, near the top of that assumed
range) since this recipe has zero real data points anywhere near that end
of the scale. The four envelope Decay values are ordering placeholders set
RELATIVE TO EACH OTHER (`De Decay` fastest, `Be Decay` next, `Ae`/`Ce`
Decay slowest) to encode the sourced "attack pair decays fastest" shape —
none are derived from a real ms→raw curve.

## Param naming: verified vs inferred

- **Verified-style**: `Algorithm`, `A Coarse`, `A Fine`,
  `Osc-A Level`, `B Coarse`, `B Fine`, `Osc-B Level`, `Ae Attack`,
  `Volume`.
- **Inferred**: `Ae Decay`, `Ae Sustain`, `Ae Release`, `Be Attack`,
  `Be Decay`, `Be Sustain`, `Be Release`, and the entire `Osc-C`/`Ce`/
  `Osc-D`/`De` families (extended from the `Osc-A`/`Ae` pattern to
  oscillators C and D — no source confirms Operator actually names its C
  and D oscillator/envelope params this way, though it would be a strange
  break from the observed A/B convention if it didn't). `awh op apply`
  must validate every name against a live `device.get` dump before writing
  anything.
