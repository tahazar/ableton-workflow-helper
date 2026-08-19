---
slug: operator-recipe-sub-click
topic: sound-design
tier: draft
tags: [operator, fm-synthesis, bass, sub, click, transient, trap, dubstep, recipe]
sources: ["https://beatkitchen.io/guides/electronic-music/04-bass-design/", "https://unison.audio/transforming-your-808s/", "https://unison.audio/808-sound-design/", "https://forum.ableton.com/viewtopic.php?t=224666", "https://angstromnoises.com/13-advanced-tips-abletons-operator/", "https://www.ableton.com/en/blog/get-deep-make-sub-bass-operator/"]
related: [sound-design/operator-recipe-reese-approx, sound-design/operator-recipe-growl-bass]
---
# Operator recipe: sub + click (clean sub with a transient click layer)

**Sourcing note:** same WebSearch-excerpt-only sourcing method and caveat as
`sound-design/operator-recipe-growl-bass` — WebFetch is egress-blocked for
every host tried this session; citations below are tied to named pages via
the search tool, not raw fetches. **All raw `device.param` values below are
unverified estimates** — read the caveat block before applying.

## Craft

Sub-heavy low end in dubstep/trap production is conventionally built as two
separable layers, not one patch: a pure, untouched sub tone that never moves,
and a short transient on top that gives the ear something to attack-track.
A bass-design guide states the sub layer plainly — "start with your core sub
layer — a pure sine or clean sample hitting around 45–55 Hz — and keep that
one untouched and mono all the way through" — while a companion 808
sound-design article frames the transient as its own job: "a popular
technique is to layer a short, percussive transient (such as a kick drum
click or short pluck) on top of the [sub] to boost attack and presence while
keeping the booming bass sound clean," with the goal that "the kick
transient hit[s] first, then the [sub] bass fades in." The two layers are
designed and gain-staged independently, then summed.

**Operator-specific mechanism for the click itself**: Operator's oscillators
have a **Phase** parameter setting where in its cycle the wave starts on
each trigger. A sine that starts exactly at its zero-crossing is click-free;
offsetting Phase away from zero makes the waveform jump discontinuously at
note-on, which is normally a bug to avoid but is exactly the mechanism this
recipe wants for the transient layer — an Ableton Forum thread on Operator
clicking behavior and a synth-tips roundup both describe this directly:
"if a sinewave waveform starts or finishes suddenly anywhere other than 0,
it can click... this clicking can be used to your advantage in sound
design — if you want a more click-y kick drum, you can move the phase so
the sine does not start at zero." This recipe therefore keeps the SUB
oscillator's Phase at 0 (click-free, per the same source's other half —
"to avoid unwanted clicks, keep the Phase at 0") and deliberately offsets
the CLICK oscillator's Phase to generate its transient, rather than reaching
for a separate noise/drum sample.

## Executable

```awh-operator-patch
name: sub-click
device: Operator
params:
  Algorithm: 0.2   # display: parallel-carrier shape — Osc-A and Osc-B both act as independent carriers with no FM routing between them (this patch needs summed layers, not modulation). Index within the 11 algorithm shapes NOT identified from sourced material — dial to the "A and B both bottom-row, no lines between them" shape by eye and overwrite. RAW UNVERIFIED.
  "Osc-A Coarse": 0.0159    # display: ratio 1 — the sub carrier tracks the played note directly (e.g. C1 for a ~33Hz-ish trap sub). Coarse-scale assumption per the caveat block — RAW UNVERIFIED.
  "Osc-A Fine": 0.0         # display: 0 cents, perfectly in tune — RAW UNVERIFIED.
  "Osc-A Level": 1.0        # display: full sub output — RAW UNVERIFIED.
  "Osc-A Phase": 0.0        # display: 0 (zero-crossing start) — kept at 0 deliberately so the sub layer is click-free, per the sourced Phase behavior above. INFERRED param name (extends the Osc-A Coarse/Fine/Level convention; "Phase" as an Operator UI control is sourced, its exact device.get spelling is not). RAW UNVERIFIED but 0.0 is the one estimate this recipe is most confident in, since "Phase 0" is described as literally the zero point of the range.
  "Ae Attack": 0.0          # display: instant — RAW UNVERIFIED placeholder.
  "Ae Decay": 0.2           # INFERRED param name (only Ae Attack is confirmed) — RAW UNVERIFIED placeholder.
  "Ae Sustain": 0.9         # display: high — the sub is meant to sustain through the whole note, per "keep that one untouched... all the way through". RAW UNVERIFIED, assumed raw≈display.
  "Ae Release": 0.25        # INFERRED param name — RAW UNVERIFIED placeholder.
  "Osc-B Coarse": 0.0159    # display: ratio 1 — the click carrier tracks the same fundamental so it reads as "part of" the sub hit, not a separate pitch. RAW UNVERIFIED, same Coarse assumption.
  "Osc-B Fine": 0.0
  "Osc-B Level": 0.5        # display: click mixed under the sub so it reads as attack, not a second tone — matches the sourced "transient hits first, then the sub fades in, keeping separation" framing. CONSTRUCTED level (no source gives an exact mix ratio) — RAW UNVERIFIED.
  "Osc-B Phase": 0.35       # display: deliberately offset from 0 — this is the click generator, per the sourced Operator-specific Phase-click mechanism. CONSTRUCTED offset amount (source describes the mechanism, not a specific phase value) — RAW UNVERIFIED, arbitrary non-zero placeholder; the actual click character should be dialed by ear.
  "Be Attack": 0.0          # display: instant — RAW UNVERIFIED placeholder.
  "Be Decay": 0.05          # display: very short — the click must decay out of the way fast so it doesn't compete with the sub's body, mirroring the sourced "kick transient hits first, then sub fades in" ordering. INFERRED param name, CONSTRUCTED display target — RAW UNVERIFIED.
  "Be Sustain": 0.0         # display: none — pure transient, no sustained tail.
  "Be Release": 0.05
  Volume: 0.75              # confirmed device.get name (device-parameter-surface.md). This 0.75 value is RAW UNVERIFIED for this patch.
playNotes: "1|1 C1 1 v120"
```

## Raw values: unverified — read before applying

Standing caveat (same estimation method as `operator-recipe-growl-bass`):
**every raw value above is an unverified estimate, not a measurement.**
Apply, listen against the DISPLAY comments, correct, and record the
observed raw↔display pairs back into this entry — the
`compressor-raw-display-mapping` measure→adjust→verify loop
(`knowledge/setup/compressor-raw-display-mapping.md`), which so far has
real data for the stock Compressor only, not Operator. Assumptions: Coarse
≈ (ratio−0.5)/31.5 across its ~0.5–32 display range; Level/Sustain ≈
display directly; Attack/Decay/Release times are ordering placeholders
only (no ms→raw curve known); Phase 0.0 = the zero-crossing point is the
one value estimated with real confidence, since the source describes it as
literally the range's zero; the non-zero click Phase offset (0.35) is an
arbitrary placeholder standing in for "some offset," not a specific
sourced or derived click character — dial this one entirely by ear.

## Param naming: verified vs inferred

- **Verified-style**: `Algorithm`, `Osc-A Coarse`, `Osc-A Fine`,
  `Osc-A Level`, `Osc-B Coarse`, `Osc-B Fine`, `Osc-B Level`, `Ae Attack`,
  `Volume`.
- **Inferred**: `Osc-A Phase` / `Osc-B Phase` (the Phase *control* is
  sourced from Operator tutorials/forum threads; its exact `device.get`
  spelling is a naming-convention guess), `Ae Decay`, `Ae Sustain`,
  `Ae Release`, `Be Attack`, `Be Decay`, `Be Sustain`, `Be Release`.
  `awh op apply` must validate every name against a live `device.get` dump
  before writing anything, per `docs/design/operator-assistant.md`.
