---
slug: operator-recipe-glide-bass
topic: sound-design
tier: draft
tags:
  - operator
  - bass
  - glide
  - portamento
  - legato
  - funk
  - recipe
sources: ["https://www.syntorial.com/preset-recipe/jai-paul-jasmine-demo-bass/", "https://en.wikipedia.org/wiki/A._K._Paul", "https://gearspace.com/board/electronic-music-instruments-and-electronic-music-production/1076920-jai-paul-jasmine-what-makes-production-so-awesome.html", "https://onthetrackofficial.com/understanding-portamento-glide-in-synthesizers/"]
related: [sound-design/operator-recipe-growl-bass, sound-design/operator-recipe-sub-click, sound-design/operator-recipe-reese-approx]
---
# Operator recipe: glide bass (portamento/legato mono bass)

The gliding mono bass behind Jai Paul's "Jasmine" and the Yeezus-era
slide basses: a monophonic, legato-phrased bass whose pitch slides between
notes (portamento/glide) instead of stepping, with heavy saturation and
slight deliberate pitch instability. Sourcing note: built from
search-result excerpts, not full-page fetches (same caveat as
`rhythm/dubstep-drum-pattern`).

## The craft (sourced)

- The "Jasmine" synth layer, per Syntorial's remake analysis: two
  medium-width pulse waves an octave apart plus noise, a rounded, driven
  low-pass, a slow saw-shaped LFO on pitch (the slightly out-of-tune
  wobble), distortion for grit, chorus for unstable width
  (syntorial.com). The record is a hybrid: A.K. Paul is credited with
  bass guitar and sound design (Wikipedia), so part of the slink is a
  bassist's slides. The synth recipe approximates that gesture.
- Portamento/glide: pitch moves continuously between consecutive notes.
  In legato mode it fires only when notes overlap
  (onthetrackofficial.com), so the MIDI must be written legato. Short
  times (~40-80 ms) read funky and tight; long times (150-400 ms) read
  theatrical (the aggressive, distorted long-glide flavor associated with
  "Hold My Liquor"; a characterization, not a sourced patch breakdown).
- Limitation: Operator's square-family waves are not true
  variable-pulse-width, so the Jasmine layer's PWM character is
  approximated. For literal PWM use Analog/Serum with the same logic (two
  pulses an octave apart, drive, wobble, chorus).

## Executable

```awh-operator-patch
name: glide-bass
device: Operator
params:
  Algorithm: 10          # display: all-parallel carriers (raw range 0-10, live-verified); this algorithm pick is unverified
  "Osc-A Wave": 0.5      # display: a square-family wave; raw unverified (wave list mapping unknown; set Sq in the UI if wrong)
  "A Coarse": 1          # display: ratio 1 (fundamental); raw range 0-48 live-verified, this value unverified
  "Osc-A Level": 0.85    # display: strong carrier
  "Osc-B Wave": 0.5      # display: square-family, octave layer; raw unverified
  "B Coarse": 2          # display: ratio 2 (octave up); value unverified
  "Osc-B Level": 0.5     # display: octave layer under the fundamental
  "Osc-D Wave": 0.9      # display: noise ("Noise White" exists per the live noise-perc check); raw unverified
  "Osc-D Level": 0.12    # display: just a breath of noise
  "Ae Attack": 0         # display: instant
  "Ae Decay": 0.6        # display: medium
  "Ae Sustain": 0.8      # display: high, the bass sustains under legato lines
  "Ae Release": 0.35     # display: short-medium
  "Filter On": 1
  "Filter Freq": 0.45    # display: LP rounded low; drive into the filter is part of the tone
  "Filter Res": 0.25
  "LFO Type": 0.4        # display: saw-ish LFO; raw unverified (type list mapping unknown)
  "LFO Amt": 0.06        # display: barely-perceptible pitch wobble (the out-of-tune character)
  "Glide On": 1          # inferred name for Operator's pitch-section glide; verify via device.get
  "Glide Time": 0.25     # display: ~60 ms funky (raise toward 0.5 for long theatrical slides); scale unverified
  Volume: 0.7
playNotes: "1|1 F1 1.15 v110\n1|2 G#1 1.15 v100\n1|3 F1 1.65 v112\n1|4.5 C2 0.6 v98"
```

The playNotes phrase is legato: every note overlaps the next start,
which makes the glide fire. If the audition sounds stepped, the glide is
not engaged (check Glide On or the real param name) or the notes were
shortened.

## Raw values: unverified, read before applying

Standing caveat per `setup/compressor-raw-display-mapping`'s workflow:
raw values are estimates, with display intent in comments. The only
live-verified facts are the ranges (Algorithm 0-10, Coarse 0-48, Fine
0-1000, most dials ~0-1) and the naming quirks ("A Coarse"/"B Coarse"
without the Osc- prefix; "LFO Type"/"LFO Amt"; "Osc-A Wave"). "Glide
On"/"Glide Time" are inferred names. Run `awh call device.get` on a real
Operator, correct any wrong name, apply, listen, correct values, and
record observed raw↔display pairs here. After the synth: Saturator
(drive to taste; the Yeezus flavor uses a lot), subtle Chorus, and for
the Jasmine sheen a dark EQ shelf or Redux. Duck against the kick via
`awh mix duck`.

## Param naming: verified-style vs inferred

Verified-style (seen in live dumps): Algorithm, "A Coarse"/"B Coarse",
"Osc-A/B/D Wave", "Osc-A/B/D Level", "Ae *", "Filter Freq/Res/On",
"LFO Type"/"LFO Amt", Volume. Inferred (correct on first live pass):
"Glide On", "Glide Time".
