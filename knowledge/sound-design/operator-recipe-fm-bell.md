---
slug: operator-recipe-fm-bell
topic: sound-design
tier: draft
tags: [operator, fm-synthesis, bell, inharmonic, chowning, recipe]
sources: ["https://www.modwiggler.com/forum/viewtopic.php?t=226613", "https://musictech.blog/fm-synthesis-explained/", "https://hub.yamaha.com/keyboards/synthesizers/discovering-digital-fm-john-chowning-remembers/", "https://ccrma.stanford.edu/~jos/sasp/Frequency_Modulation_FM_Synthesis.html", "https://web.uvic.ca/~aschloss/course_mat/MU307/MU307%20Labs/Tutorial%20FM.11.htm"]
related: [sound-design/operator-recipe-e-piano, sound-design/operator-recipe-pluck]
---
# Operator recipe: FM bell (inharmonic ~3.5:1 ratio bell)

**Sourcing note:** same WebSearch-excerpt-only method as the other entries
in this batch — WebFetch was egress-blocked for every host tried this
session; citations are tied to named pages via search-tool excerpts, not
raw fetches. **All raw `device.param` values below are unverified
estimates** — read the caveat block before applying.

## Craft

FM bell tones are the textbook demonstration of why FM synthesis exists at
all: a **non-integer** carrier:modulator ratio scatters the modulation
sidebands off the carrier's harmonic series, so the ear can no longer fuse
them into one pitch. A MOD WIGGLER sound-design thread states this
mechanism directly — "in-between ratios like 3.51 and 5.79 scatter partials
into inharmonic places, which is exactly what bells and gongs do in real
life... the ear can no longer fuse them into a single pitch, making the
sound turn clangorous and metallic" — which is where this recipe's ~3.5:1
modulator ratio comes from (an alternative irrational ratio, 1:1.41 ≈ √2,
turns up in a second source, `musictech.blog`'s FM-synthesis explainer, as
a related inharmonic choice for "bells, metallophones, and aggressive lead
sounds" — either is a legitimate starting point; this recipe picks 3.5
specifically since it's the number the task names and the one the MOD
WIGGLER thread anchors most directly to bell/gong character).

A ratio alone gives a static clangorous *chord* of partials, not a bell's
characteristic *strike*: the same MOD WIGGLER source names the second
required ingredient as "a steady drop in modulation index from bright to
pure and long exponential amplitude decay" — i.e. two envelopes moving at
different rates. Because "modulation index is the main determinant of
timbre (brightness)... the modulation index is a prime candidate to be
controlled by an envelope" (a Cycling '74 FM tutorial's framing, echoed
across multiple FM-synthesis explainers found this session), the standard
bell construction is: the **modulator's own envelope decays fast**
(the bright, clangorous strike collapses quickly toward a purer tone),
while the **carrier's amplitude envelope decays slowly** (a long
exponential tail is what makes it read as a bell ringing out rather than a
bell being hit). Getting the *relative* speed of these two envelopes right
— modulator fast, carrier slow — matters more than either one's absolute
time, per every source found here.

## Executable

```awh-operator-patch
name: fm-bell
device: Operator
params:
  Algorithm: 0.5    # display: 2-operator shape — Osc-B (modulator) into Osc-A (carrier), same topology as operator-recipe-growl-bass. Index within the 11 algorithm shapes NOT identified from sourced material — dial by eye and overwrite. RAW UNVERIFIED.
  "Osc-A Coarse": 0.0159    # display: ratio 1 — carrier tracks the played pitch. Coarse-scale assumption per the caveat block — RAW UNVERIFIED.
  "Osc-A Fine": 0.0
  "Osc-A Level": 1.0        # display: full carrier output — RAW UNVERIFIED.
  "Ae Attack": 0.0          # display: instant strike — RAW UNVERIFIED placeholder.
  "Ae Decay": 0.75          # display: long — this is the "long exponential amplitude decay" the source calls out as essential to the bell character. INFERRED param name (only Ae Attack confirmed) — RAW UNVERIFIED placeholder, deliberately set toward the "slow" end of this entry's own placeholder scale to encode "slow relative to Be Decay below," not a real ms value.
  "Ae Sustain": 0.15        # display: low — a struck bell has almost no sustain plateau, it's all decay/release. RAW UNVERIFIED, assumed raw≈display.
  "Ae Release": 0.6         # display: long ring-out tail. INFERRED param name — RAW UNVERIFIED placeholder.
  "Osc-B Coarse": 0.0956    # display: ratio 3.51 — the inharmonic modulator ratio, sourced from the MOD WIGGLER "3.51 and 5.79... exactly what bells and gongs do" claim above. Same Coarse-scale assumption — RAW UNVERIFIED.
  "Osc-B Fine": 0.0
  "Osc-B Level": 0.9        # display: high peak modulation index — the "bright" strike transient, decaying fast via Be Decay below. CONSTRUCTED magnitude (source describes the shape of the drop, not an exact index number) — RAW UNVERIFIED.
  "Be Attack": 0.0          # display: instant — RAW UNVERIFIED placeholder.
  "Be Decay": 0.15          # display: fast — this is the "steady drop in modulation index from bright to pure" itself; deliberately FAST relative to Ae Decay above, per the sourced two-envelope-rate bell mechanism. INFERRED param name — RAW UNVERIFIED placeholder.
  "Be Sustain": 0.1         # display: low — the modulator settles to a near-pure tone after the initial strike, per the sourced "bright to pure" description. RAW UNVERIFIED, assumed raw≈display.
  "Be Release": 0.2
  Volume: 0.7               # confirmed device.get name (device-parameter-surface.md). This 0.7 value is RAW UNVERIFIED for this patch.
playNotes: "1|1 C4 1 v100"
```

## Raw values: unverified — read before applying

Standing caveat (same estimation method as the other entries in this
batch): **every raw value above is an unverified estimate, not a
measurement** — no Operator raw↔display pair has ever been read back into
this repo (`knowledge/setup/compressor-raw-display-mapping.md` covers the
stock Compressor only). Apply, listen against the DISPLAY comments,
correct, and record the observed raw↔display pairs back into this entry.
Coarse assumed ≈ (ratio−0.5)/31.5 across its ~0.5–32 display range (so the
3.51 ratio and the 1 ratio both land near the LOW end of Coarse's raw
range — if that assumption is wrong the two oscillators could end up much
farther apart or closer together in raw terms than intended; verify by
ear/readback before trusting the exact number). Attack/Decay/Release times
are ordering placeholders only, chosen relative to EACH OTHER (Ae Decay
slower than Be Decay) to encode the sourced two-rate-envelope mechanism —
they are not derived from any known ms→raw curve.

## Param naming: verified vs inferred

- **Verified-style**: `Algorithm`, `Osc-A Coarse`, `Osc-A Fine`,
  `Osc-A Level`, `Osc-B Coarse`, `Osc-B Fine`, `Osc-B Level`, `Ae Attack`,
  `Volume`.
- **Inferred**: `Ae Decay`, `Ae Sustain`, `Ae Release`, `Be Attack`,
  `Be Decay`, `Be Sustain`, `Be Release`. `awh op apply` must validate
  every name against a live `device.get` dump before writing anything.
