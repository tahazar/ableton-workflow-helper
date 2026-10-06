---
slug: operator-recipe-reese-approx
topic: sound-design
tier: draft
tags: [operator, fm-synthesis, reese, bass, detune, unison-limitation, recipe]
sources: ["https://bassgorilla.com/what-is-a-reese-bass/", "https://alijamieson.co.uk/2021/08/14/reeses-pieces-how-to-create-kevin-saundersons-legendary-bass-patch/", "https://blog.native-instruments.com/reese-bass/", "https://blog.landr.com/reese-bass/", "https://www.pressreader.com/australia/future-music-9629/20220111/283223036482209", "https://forum.ableton.com/viewtopic.php?t=237445"]
related: [sound-design/operator-recipe-growl-bass, sound-design/operator-recipe-sub-click, sound-design/dubstep-growl-basics]
---
# Operator recipe: reese-approx (honest detuned-oscillator Reese approximation)

**Sourcing note:** citations come from search-result excerpts of the named
pages, not full-page fetches. **All raw `device.param` values below are
unverified estimates.** Read the caveat block before applying. This entry
is an approximation with a stated ceiling, not a full Reese. Read "The
honest limit" below before treating it as equivalent to a unison-based
synth's Reese patch.

## Craft

The Reese bass has a specific origin: "the Reese bass was created and
used for the first time by techno pioneer Kevin Saunderson in the track
'Just Want Another Chance,' which he released under his Reese alias in
1988," on a Casio CZ-5000 where he "layered two slightly different
sawtooth-like waves and detuned them against each other" (BassGorilla /
Ali Jamieson's write-up of the same story). A Native Instruments explainer
gives the mechanism behind the movement, a beat frequency: "because the
two waves are at slightly different speeds, they constantly drift in and
out of alignment. When they align (in phase), they combine to get louder.
When they oppose each other (out of phase), they cancel each other out.
The result is a 'beat frequency' that equals the difference between the
two oscillators". The slow churn of a Reese is phase interference between
detuned oscillators, not an LFO.

A LANDR guide on Reese construction names the two conventional methods:
"the two most common methods for Reese bass are to either stack several
sawtooth voices in unison and detune them, or to use a mono voice with
**at least two oscillators** (again, one of them detuned)." Operator has
four oscillators and no unison stacking (see below), which rules out the
first method. This recipe uses the second: Operator's independent,
non-FM-routed oscillators, each on a sawtooth-family wave, each tuned a
few cents apart via `Fine`.

## The honest limit

**Operator has no unison feature.** An Ableton Forum discussion of
Live's native synths: "in Operator there is spread but no unison, while in
Analog there is unison but no spread". Analog's `Uni`/`Detune`/`Voices`
controls stack detuned copies per oscillator (a forum thread on Analog's
voice stacking: "the Voices chooser selects between two or four stacked
voices... the Uni switch turns on the unison effect, which stacks multiple
voices for each note played, and the Detune slider adjusts the amount of
tuning variation applied to each stacked voice"). Operator has none of
that. It has `Spread`, which "sets how much panning variation is applied
across... voices" for width, not more detuned copies of an oscillator.

This recipe approximates a Reese with Operator's four oscillators as
independent carriers, each detuned via `Fine`, with no true unison stack.
That is a ≤4-voice detune, coarser and more stepped than the 6-, 8- or
16-voice unison stacks a wavetable synth (Serum, Massive, etc.) would use.
The beat-frequency interference is real and directionally correct, but
thinner and less continuous than a many-voice Reese. `Spread` adds stereo
width by panning existing voices across L/R; it does not add detuned
pitches or recover the missing voice count. Treat this recipe as the
closest Operator can get, not parity with a unison-based Reese. If the
sound needs to be thick, the ceiling is architectural, not a dial.

## Executable

```awh-operator-patch
name: reese-approx
device: Operator
params:
  Algorithm: 0    # display: Alg. 1, parallel carriers, no FM routing between Osc-A/B/C/D (this patch sums detuned layers). Raw range 0-10 (11 quantized steps, `Alg. 1`-`Alg. 11`), confirmed via `device.get`. Alg. 1 (raw 0) as four independent oscillators is general Operator knowledge; confirm in the UI.
  "A Coarse": 1    # display: ratio 1 (unison), the in-tune reference layer. Coarse raw range is 0-48; left at Operator's default (1). The four oscillators only need matching Coarse values, since detuning happens on Fine.
  "A Fine": 0         # display: 0 cents, the untouched reference pitch all other layers detune against.
  "Osc-A Level": 0.85       # display: near full; one of four summed layers, with headroom for the others. Constructed; raw unverified.
  "Ae Attack": 0.0          # display: fast. Raw placeholder, unverified.
  "Ae Decay": 0.2
  "Ae Sustain": 0.85        # display: high; a Reese is a bass and sustains through the note. Inferred param name; raw unverified.
  "Ae Release": 0.25
  "B Coarse": 1    # display: ratio 1, matching A so detuning happens entirely on Fine. Same reasoning as A Coarse.
  "B Fine": 15       # display: ~+18 cents. Fine's raw range is 0-1000 across one octave (1200 cents) per its sourced description, so raw ≈ cents × 0.833, and 18 × 0.833 ≈ 15. The scale is derived, not confirmed by readback or by ear. The 18-cent amount is constructed: sources only say "slightly different" / "a little detuning."
  "Osc-B Level": 0.85
  "Be Attack": 0.0
  "Be Decay": 0.2
  "Be Sustain": 0.85
  "Be Release": 0.25
  "C Coarse": 1    # display: ratio 1. Same reasoning as A/B Coarse.
  "C Fine": 20        # display: ~+24 cents, detuned further than B for three-way beating instead of a single pair. Scale 24 × 0.833 ≈ 20; constructed spacing (see B Fine).
  "Osc-C Level": 0.7        # display: slightly under A/B, so the third layer adds movement without just adding level. Constructed; raw unverified.
  "Ce Attack": 0.0
  "Ce Decay": 0.2
  "Ce Sustain": 0.85
  "Ce Release": 0.25
  "D Coarse": 1    # display: ratio 1. Same reasoning as A/B/C Coarse.
  "D Fine": 7       # display: ~+8 cents, a closer-spaced fourth layer filling the beating between A and B/C. Scale 8 × 0.833 ≈ 7; constructed spacing (see B Fine).
  "Osc-D Level": 0.6        # display: lowest of the four; a filler layer, not a primary voice. Constructed; raw unverified.
  "De Attack": 0.0
  "De Decay": 0.2
  "De Sustain": 0.85
  "De Release": 0.25
  "Filter Freq": 0.55       # display: moderate lowpass, standard Reese practice to keep the top end from getting harsh. Inferred param name, constructed display target; raw unverified.
  "Filter Res": 0.2
  Spread: 40                # display: moderate stereo width, Operator's native width tool for this patch (sourced: "Spread... panning variation across voices"). Adds width, not detuned voices (see "The honest limit" above). Raw range 0-100, confirmed via `device.get`; a 0-1 value such as 0.4 clamps to 0, as `awh op apply`'s read-back reports.
  Volume: 0.65              # confirmed device.get name. Lower than the other recipes because four layers are summed; value unverified.
playNotes: "1|1 F1 1 v115"
```

## Raw values: unverified, read before applying

**Scale bug confirmed via a real `awh op apply` on Operator and corrected in the executable block above (2026-08-20):** `Algorithm`'s real raw range is 0-10 (11 quantized steps, `Alg. 1`-`Alg. 11`) and `Coarse`'s real raw range is 0-48, not the normalized 0-1 range this recipe originally assumed. Fixed from a live `device.get` dump: `Algorithm` set to `0` (Alg. 1, the standard "four independent unmodulated oscillators" topology), and all four `Coarse` params left at Operator's default (`1`) so the oscillators match each other. The patch only needs them in unison, not at a specific ratio, so no ratio-table index had to be guessed. `Fine` had the same class of bug (real range 0-1000, not 0-1), corrected with `raw ≈ cents × (1000/1200)` since Fine is sourced as spanning one octave (1200 cents) over 0-1000. The other params (Volume, `Osc-* Level`, envelope times, `Filter Freq`/`Filter Res`) were confirmed ~0-1 scaled and unaffected.

**Still unverified:** the corrections fix the scale (right order of magnitude, no silent clamp to 0), not the exact sound. No Operator raw↔display pair has been read back into this repo, so treat every number as a starting point to apply, listen to and correct. "Algorithm 1 is parallel oscillators" is general Operator knowledge, not read back from a device instance; confirm with a UI glance.

Standing caveat (same estimation method as the other Operator recipes):
apply, listen against the display comments, correct, and record observed
raw↔display pairs here. Fine is sourced as positive-only (a one-octave
range with "positive amounts only," per the source the other Operator
recipes use), so the "detune the other way" layers are approximated as
larger positive offsets, not true negative detuning. If Operator's Fine
allows negative cents, revisit this sub-stack: bidirectional detuning
(some layers sharp, some flat) is closer to how a Reese unison stack is
normally built. The four cents values (18/24/8/0) are constructed spacing
choices. No source gives a Reese detune amount, only qualitative
"slightly different"/"a little detuning" language.

## Param naming: verified vs inferred

- **Verified-style**: `Algorithm`, `A Coarse`, `A Fine`,
  `Osc-A Level`, `B Coarse`, `B Fine`, `Osc-B Level`, `Ae Attack`,
  `Volume`.
- **Inferred**: `Ae Decay`, `Ae Sustain`, `Ae Release`, and the parallel
  `Be`/`Ce`/`De` and `Osc-C`/`Osc-D` families extended from the A/B
  pattern; `Filter Freq`, `Filter Res`; `Spread` (the control is sourced
  from an Ableton Forum discussion of Operator vs Analog; its exact
  `device.get` spelling is a naming-convention guess). `awh op apply` must
  validate every name against a live `device.get` dump before writing,
  and confirm `Spread` exists as written, since it is the most
  load-bearing inferred name in this recipe.
