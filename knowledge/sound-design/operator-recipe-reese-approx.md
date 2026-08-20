---
slug: operator-recipe-reese-approx
topic: sound-design
tier: draft
tags: [operator, fm-synthesis, reese, bass, detune, unison-limitation, recipe]
sources: ["https://bassgorilla.com/what-is-a-reese-bass/", "https://alijamieson.co.uk/2021/08/14/reeses-pieces-how-to-create-kevin-saundersons-legendary-bass-patch/", "https://blog.native-instruments.com/reese-bass/", "https://blog.landr.com/reese-bass/", "https://www.pressreader.com/australia/future-music-9629/20220111/283223036482209", "https://forum.ableton.com/viewtopic.php?t=237445"]
related: [sound-design/operator-recipe-growl-bass, sound-design/operator-recipe-sub-click, sound-design/dubstep-growl-basics]
---
# Operator recipe: reese-approx (honest detuned-oscillator Reese approximation)

**Sourcing note:** same WebSearch-excerpt-only method as the other entries
in this batch — WebFetch was egress-blocked for every host tried this
session; citations are tied to named pages via search-tool excerpts, not
raw fetches. **All raw `device.param` values below are unverified
estimates** — read the caveat block before applying. This entry is
explicitly an APPROXIMATION with a stated ceiling, not a full Reese — see
"The honest limit" below before treating it as equivalent to a
unison-based synth's Reese patch.

## Craft

The Reese bass is named for a specific origin: "the Reese bass was created
and used for the first time by techno pioneer Kevin Saunderson in the
track 'Just Want Another Chance,' which he released under his Reese alias
in 1988," using a Casio CZ-5000 where he "layered two slightly different
sawtooth-like waves and detuned them against each other" (BassGorilla /
Ali Jamieson's write-up of the same story). The mechanism a Native
Instruments explainer gives for WHY detuning two waveforms produces the
Reese's signature movement is a beat frequency: "because the two waves are
at slightly different speeds, they constantly drift in and out of
alignment. When they align (in phase), they combine to get louder. When
they oppose each other (out of phase), they cancel each other out. The
result is a 'beat frequency' that equals the difference between the two
oscillators" — the slow, churning wobble of a Reese isn't an LFO at all,
it's pure phase interference between detuned oscillators.

A LANDR guide on Reese construction names the two conventional build
methods directly: "the two most common methods for Reese bass are to
either stack several sawtooth voices in unison and detune them, or to use
a mono voice with **at least two oscillators** (again, one of them
detuned)." Operator has exactly four oscillators and no unison-voice
stacking (see below), which rules out the first method and points this
recipe squarely at the second: several of Operator's own independent,
non-FM-routed oscillators, each carrying a sawtooth-family wave, each
tuned a few cents apart via `Fine`.

## The honest limit

**Operator has no unison feature.** An Ableton Forum discussion of the
asymmetry between Live's native synths states this plainly: "in Operator
there is spread but no unison, while in Analog there is unison but no
spread" — Analog's `Uni`/`Detune`/`Voices` controls stack multiple detuned
copies PER oscillator (a forum thread on Analog's own voice-stacking
describes "the Voices chooser selects between two or four stacked voices...
the Uni switch turns on the unison effect, which stacks multiple voices
for each note played, and the Detune slider adjusts the amount of tuning
variation applied to each stacked voice" — none of that exists on
Operator). What Operator DOES have is `Spread`, which "sets how much
panning variation is applied across... voices" for width, not a way to add
more detuned copies of a single oscillator.

This recipe therefore approximates a Reese with Operator's **four separate
oscillators used as independent carriers**, each individually detuned via
`Fine`, rather than any form of true unison stack. Concretely, that is an
honest **≤4-voice** detune, coarser and more discretely-steppy than the
6-, 8-, or 16-voice unison stacks a wavetable synth (Serum, Massive, etc.)
would throw at the same technique — the beat-frequency interference this
recipe produces is real and directionally correct, but thinner and less
continuous than a "real" many-voice Reese. `Spread` can be layered on top
for stereo width, but it duplicates existing voices across L/R for panning
variation, not additional detuned pitches — it doesn't buy back the voice
count Operator is missing. Treat this recipe as "the closest Operator can
get," not as parity with a unison-based Reese; if the sound needs to be
genuinely thick, that ceiling is architectural, not a dial to turn harder.

## Executable

```awh-operator-patch
name: reese-approx
device: Operator
params:
  Algorithm: 0.2    # display: parallel-carrier shape — Osc-A/B/C/D all act as independent carriers with NO FM routing between them (this patch needs summed detuned layers, not modulation), same topology idea as operator-recipe-sub-click. Index within the 11 algorithm shapes NOT identified from sourced material — dial to the "all four bottom-row, no lines between them" shape by eye and overwrite. RAW UNVERIFIED.
  "A Coarse": 0.0159    # display: ratio 1 — reference layer, in tune. Coarse-scale assumption per the caveat block — RAW UNVERIFIED.
  "A Fine": 0.0         # display: 0 cents — the untouched reference pitch all other layers detune against.
  "Osc-A Level": 0.85       # display: near-full — one of four summed layers, headroom left for the others. CONSTRUCTED — RAW UNVERIFIED.
  "Ae Attack": 0.0          # display: fast — RAW UNVERIFIED placeholder.
  "Ae Decay": 0.2
  "Ae Sustain": 0.85        # display: high — a Reese sustains through the note, this is a bass, not a pluck. INFERRED param name — RAW UNVERIFIED.
  "Ae Release": 0.25
  "B Coarse": 0.0159    # display: ratio 1 — same pitch class as A, detuning happens on Fine below, not Coarse. RAW UNVERIFIED.
  "B Fine": 0.015       # display: +18 cents. Assumed raw ≈ cents/1200 per the caveat block (Fine documented as a one-octave, positive-only, cents-calibrated range) — RAW UNVERIFIED. The DETUNE AMOUNT ITSELF (18 cents) is CONSTRUCTED — no source gives an exact Reese cents value, only "slightly different" / "a little detuning."
  "Osc-B Level": 0.85
  "Be Attack": 0.0
  "Be Decay": 0.2
  "Be Sustain": 0.85
  "Be Release": 0.25
  "C Coarse": 0.0159    # display: ratio 1. RAW UNVERIFIED.
  "C Fine": 0.02        # display: +24 cents — detuned the OTHER direction in spirit from B by being a larger offset, giving three-way beat interference rather than a single simple pair. CONSTRUCTED — RAW UNVERIFIED. (Fine is documented as positive-only, so "detuning the other direction" is approximated here as a larger positive offset, not a true negative offset — see the caveat block.)
  "Osc-C Level": 0.7        # display: slightly under A/B — a third layer, kept a bit lower so the stack doesn't just get louder without adding movement. CONSTRUCTED — RAW UNVERIFIED.
  "Ce Attack": 0.0
  "Ce Decay": 0.2
  "Ce Sustain": 0.85
  "Ce Release": 0.25
  "D Coarse": 0.0159    # display: ratio 1. RAW UNVERIFIED.
  "D Fine": 0.007       # display: +8 cents — a fourth, closer-spaced layer, filling in the beat-frequency texture between A and B/C. CONSTRUCTED — RAW UNVERIFIED.
  "Osc-D Level": 0.6        # display: lowest of the four — a filler layer, not a primary voice. CONSTRUCTED — RAW UNVERIFIED.
  "De Attack": 0.0
  "De Decay": 0.2
  "De Sustain": 0.85
  "De Release": 0.25
  "Filter Freq": 0.55       # display: moderate lowpass, standard Reese practice of keeping the top end from getting harsh. INFERRED param name, CONSTRUCTED display target — RAW UNVERIFIED.
  "Filter Res": 0.2
  Spread: 0.4               # display: moderate — the one real Operator-native stereo-width tool for this patch, per the sourced "Spread... panning variation across voices" description. Does NOT add detuned voices, only stereo width to the existing ones (see "The honest limit" above). INFERRED param name (the control is sourced, its exact device.get spelling is not) — RAW UNVERIFIED.
  Volume: 0.65              # confirmed device.get name. Lower than other recipes since four oscillator layers are summed here — RAW UNVERIFIED for this value.
playNotes: "1|1 F1 1 v115"
```

## Raw values: unverified — read before applying

**CONFIRMED (not just unverified) scale bug, found via a real `awh op apply` on Operator**: `Algorithm`'s real raw range is **0-10** (11 quantized steps, `Alg. 1`-`Alg. 11`), and `Coarse`'s real raw range is **0-48** — NOT the normalized 0-1 range this recipe assumed for every param. Writing this recipe's 0-1-scaled values for `Algorithm`/`*Coarse` against a real device silently round/clamp to 0 (confirmed: read-back mismatch on all three). Every OTHER param in this recipe (Volume, `Osc-* Level`, envelope times, `Filter Freq`/`Filter Res`) genuinely IS ~0-1 scaled and wrote/read back correctly — this is specifically an `Algorithm`/`Coarse` problem, not a whole-recipe one. Not corrected here: knowing the real RANGE doesn't tell us the CORRECT value within it (e.g. which of the 11 algorithms is "2-operator, B into A") — that still needs a real ear/UI pass, `knowledge/setup/device-parameter-surface.md` has no `displayValue` API to shortcut it.

**Also applies to `Fine`** (this recipe uses nonzero values): the real raw range is **0-1000**, not 0-1 — the `raw ≈ cents/1200` formula this recipe used is built on the same wrong assumption as `Coarse` above, so the detune amounts are likely off by roughly three orders of magnitude, not just musically imprecise.

Standing caveat (same estimation method as the other entries in this
batch): **every raw value above is an unverified estimate, not a
measurement.** No Operator raw↔display pair has ever been read back into
this repo. Apply, listen against the DISPLAY comments, correct, and record
observed raw↔display pairs back into this entry. Coarse assumed ≈
(ratio−0.5)/31.5 across its ~0.5–32 display range; Fine assumed ≈
cents/1200, and because Fine is sourced as positive-only (a one-octave
range with "positive amounts only," per the same source used in the other
entries in this batch), the "detune the other way" layers here are
approximated as larger POSITIVE offsets rather than true negative
detuning — if Operator's real Fine behavior allows negative cents this
whole sub-stack should be revisited, since true bidirectional detuning
(some layers sharp, some flat) is closer to how a real Reese's unison
stack is normally built than one-directional detuning is. The four exact
cents values (18/24/8/0) are CONSTRUCTED spacing choices, not sourced from
any Reese-specific citation — no source in this batch gives an exact
detune-amount number, only qualitative "slightly different"/"a little
detuning" language.

## Param naming: verified vs inferred

- **Verified-style**: `Algorithm`, `A Coarse`, `A Fine`,
  `Osc-A Level`, `B Coarse`, `B Fine`, `Osc-B Level`, `Ae Attack`,
  `Volume`.
- **Inferred**: `Ae Decay`, `Ae Sustain`, `Ae Release`, and the parallel
  `Be`/`Ce`/`De` and `Osc-C`/`Osc-D` families extended from the A/B
  pattern; `Filter Freq`, `Filter Res`; `Spread` (the CONTROL is sourced
  from an Ableton Forum discussion of Operator vs Analog, its exact
  `device.get` spelling is a naming-convention guess). `awh op apply` must
  validate every name against a live `device.get` dump before writing
  anything — and specifically confirm `Spread` exists as written here,
  since it is the single most load-bearing inferred name in this recipe.
