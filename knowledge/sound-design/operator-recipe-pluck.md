---
slug: operator-recipe-pluck
topic: sound-design
tier: draft
tags: [operator, fm-synthesis, pluck, arp, recipe]
sources: ["https://blog.landr.com/fm-synthesis/", "https://www.pluginboutique.com/articles/1873-FM-Synthesis-Cookbook-Five-Classic-FM-Sounds-and-How-They-Work", "https://www.modwiggler.com/forum/viewtopic.php?t=256309"]
related: [sound-design/operator-recipe-growl-bass, sound-design/operator-recipe-fm-bell]
---
# Operator recipe: pluck (fast-decay filtered pluck)

**Sourcing note:** citations come from search-result excerpts of the named
pages, not full-page fetches. **All raw `device.param` values below are
unverified estimates.** Read the caveat block before applying.

## Craft

An FM pluck is the growl-bass 2-operator relationship (carrier plus
low-ratio modulator) with envelopes shaped for percussive decay instead of
sustain. A search-aggregated FM-synthesis guide states the mechanism: "a
basic but effective patch uses an envelope with zero attack and fairly
quick decay to modulate the modulation depth of the modulator on the
carrier. For trance-style plucks, try a modulator-to-carrier ratio of 2:1
with a fast attack and short decay on the modulator envelope". That is the
same 2:1 ratio `dubstep-growl-basics`[sourced] cites for a growl's
low-end-movement layer, here with a much faster modulator decay so the FM
brightness collapses almost at once. A second source gives a number for
that decay: "for arpeggios, set the modulator envelope to a fast decay
(**50ms**) and carrier ratio to 2:1 for bright, cutting plucks". It is the
only envelope time in this recipe taken from a citation rather than
constructed.

The carrier's amplitude envelope takes the classic percussive shape: "a
percussive envelope can be set with Attack and Sustain at 0, Decay to [a
short-to-medium position] and Release to [a moderate position]" (MOD
WIGGLER forum, a thread on creative envelope uses). Zero attack, zero
sustain, the whole duration in Decay and Release. In Operator, the
carrier's envelope (`Ae *`) gets this Attack=0/Sustain=0 shape for the
note duration, and the modulator's envelope (`Be *`) gets its own, faster
decay, so the bright FM edge lasts only the first milliseconds and the
tail is a purer, softer tone. This is the "modulator decays faster than
carrier" relationship `operator-recipe-fm-bell` uses for a bell strike,
on a much shorter timescale.

## Executable

```awh-operator-patch
name: pluck
device: Operator
params:
  Algorithm: 1    # display: Alg. 2, 2-operator shape, Osc-B (modulator) into Osc-A (carrier), same topology as operator-recipe-growl-bass. Raw range 0-10 (11 quantized steps). Raw 1 = Alg. 2 is general Operator knowledge for the standard B-modulates-A chain, not read back from a device; confirm in the UI.
  "A Coarse": 1    # display: ratio 1, carrier tracks the played pitch. Coarse raw range is 0-48; 1 is Operator's default, which likely reads as ratio 1.00. Unverified by ear or UI.
  "A Fine": 0.0
  "Osc-A Level": 1.0        # display: full carrier output. Raw unverified.
  "Ae Attack": 0.0          # display: 0, sourced ("Attack and Sustain at 0" for a percussive envelope). Display intent sourced; raw placeholder unverified.
  "Ae Decay": 0.35          # display: short-to-medium ("Decay to 9 o'clock", sourced; a knob position, not a number). Inferred param name (only Ae Attack confirmed); raw placeholder, unverified.
  "Ae Sustain": 0.0         # display: 0, sourced (same percussive-envelope description as Ae Attack).
  "Ae Release": 0.45        # display: moderate ("Release to 1 o'clock", sourced; a knob position, not a number). Inferred param name; raw placeholder, unverified.
  "B Coarse": 2    # display: ratio 2 (2:1 modulator), sourced from both FM-pluck sources above. Raw 2 is a best-effort guess at ratio 2.00, assuming a roughly linear low end from the default (raw 1 ≈ ratio 1.00) on the 0-48 range. Unverified; check the ratio by ear or in the UI.
  "B Fine": 0.0
  "Osc-B Level": 0.55       # display: moderate-high peak modulation index for a bright, cutting attack. Constructed magnitude (sources give envelope shape and ratio, not an index); raw unverified.
  "Be Attack": 0.0          # display: fast attack, sourced ("fast attack... on the modulator envelope"). Raw placeholder, unverified.
  "Be Decay": 0.08          # display: ~50ms, the only sourced envelope time in this recipe ("fast decay (50ms)... for bright, cutting plucks"). Faster than Ae Decay so the FM edge is heard only at the start of the pluck. Inferred param name; 50ms is sourced, the raw value is a guess (no Operator time-scale curve in this repo).
  "Be Sustain": 0.05        # display: near zero; the modulator settles to almost pure tone, leaving a clean carrier tail. Raw unverified, assumed raw≈display.
  "Be Release": 0.1
  "Filter Freq": 0.6        # display: moderately open lowpass, letting the bright transient through before the amp envelope closes the note. Inferred param name, constructed display target; raw unverified.
  "Filter Res": 0.25        # display: light resonance for a cutting edge (sourced: "bright, cutting plucks"). Inferred param name; raw unverified.
  Volume: 0.7               # confirmed device.get name; the 0.7 value is unverified for this patch.
playNotes: "1|1 C4 1 v105"
```

## Raw values: unverified, read before applying

**Confirmed scale bug, found via a real `awh op apply` on Operator:** `Algorithm`'s real raw range is 0-10 (11 quantized steps, `Alg. 1`-`Alg. 11`) and `Coarse`'s real raw range is 0-48, not the normalized 0-1 range this recipe assumed. Writing this recipe's 0-1-scaled `Algorithm`/`*Coarse` values to a real device silently rounds/clamps them to 0 (confirmed: read-back mismatch on all three). The other params (Volume, `Osc-* Level`, envelope times, `Filter Freq`/`Filter Res`) are ~0-1 scaled and wrote/read back correctly. Not corrected here: the real range does not give the correct value within it (e.g. which of the 11 algorithms is "2-operator, B into A"). That needs an ear/UI pass; `knowledge/setup/device-parameter-surface.md` has no `displayValue` API to shortcut it.

Standing caveat (same estimation method as the other Operator recipes):
**every raw value above is an unverified estimate, not a measurement.** No
Operator raw↔display pair has been read back into this repo. Apply,
listen against the display comments, correct, and record observed
raw↔display pairs here. Coarse is assumed ≈ (ratio−0.5)/31.5 across its
~0.5–32 display range. `Be Decay`'s display comment (50ms) is a sourced
number, unlike most Decay/Release display comments in the other recipes,
which are qualitative or constructed. Its raw value is still a guess,
since no ms→raw mapping for Operator's envelope times exists in this repo.
Treat the qualitative "9 o'clock"/"1 o'clock" descriptions behind `Ae
Decay` and `Ae Release` as ordering hints only (short-ish decay, moderate
release), not values that convert faithfully to numbers.

## Param naming: verified vs inferred

- **Verified-style**: `Algorithm`, `A Coarse`, `A Fine`,
  `Osc-A Level`, `B Coarse`, `B Fine`, `Osc-B Level`, `Ae Attack`,
  `Volume`.
- **Inferred**: `Ae Decay`, `Ae Sustain`, `Ae Release`, `Be Attack`,
  `Be Decay`, `Be Sustain`, `Be Release`, `Filter Freq`, `Filter Res`.
  `awh op apply` must validate every name against a live `device.get` dump
  before writing.
