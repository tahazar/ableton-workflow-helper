---
slug: operator-recipe-pluck
topic: sound-design
tier: draft
tags: [operator, fm-synthesis, pluck, arp, recipe]
sources: ["https://blog.landr.com/fm-synthesis/", "https://www.pluginboutique.com/articles/1873-FM-Synthesis-Cookbook-Five-Classic-FM-Sounds-and-How-They-Work", "https://www.modwiggler.com/forum/viewtopic.php?t=256309"]
related: [sound-design/operator-recipe-growl-bass, sound-design/operator-recipe-fm-bell]
---
# Operator recipe: pluck (fast-decay filtered pluck)

**Sourcing note:** same WebSearch-excerpt-only method as the other entries
in this batch — WebFetch was egress-blocked for every host tried this
session; citations are tied to named pages via search-tool excerpts, not
raw fetches. **All raw `device.param` values below are unverified
estimates** — read the caveat block before applying.

## Craft

An FM pluck is the growl-bass 2-operator relationship (carrier + low-ratio
modulator) with the envelope shapes inverted for percussive decay instead
of sustain. A search-aggregated FM-synthesis guide states the core
mechanism: "a basic but effective patch uses an envelope with zero attack
and fairly quick decay to modulate the modulation depth of the modulator
on the carrier. For trance-style plucks, try a modulator-to-carrier ratio
of 2:1 with a fast attack and short decay on the modulator envelope" — the
same 2:1 ratio this session's `dubstep-growl-basics`[sourced] entry cites
for the low-end-movement layer of a growl, repurposed here with a much
faster modulator decay so the FM brightness collapses almost immediately
instead of sustaining. A second source gives an actual sourced number for
that decay: "for arpeggios, set the modulator envelope to a fast decay
(**50ms**) and carrier ratio to 2:1 for bright, cutting plucks" — the one
envelope-time number in this recipe that comes from a real citation rather
than being constructed by this entry.

The carrier's own amplitude envelope needs the classic percussive shape,
not the modulator's: "a percussive envelope can be set with Attack and
Sustain at 0, Decay to [a short-to-medium position] and Release to [a
moderate position]" (MOD WIGGLER forum, a thread on creative envelope
uses) — zero attack, zero sustain, all of the sound's duration living in
Decay and Release. Applied to Operator: the CARRIER's envelope (`Ae *`)
gets this percussive Attack=0/Sustain=0 shape for the overall note
duration, while the MODULATOR's envelope (`Be *`) gets its OWN, typically
faster, decay so the bright FM edge is only present in the first
milliseconds of the pluck and the tail is a purer, softer tone — the same
"modulator decays faster than carrier" relationship
`operator-recipe-fm-bell` uses for a bell strike, here compressed to a much
shorter overall timescale.

## Executable

```awh-operator-patch
name: pluck
device: Operator
params:
  Algorithm: 1    # display: Alg. 2 — 2-operator shape, Osc-B (modulator) into Osc-A (carrier), same topology as operator-recipe-growl-bass. CORRECTED 2026-08-20: Algorithm's real raw range is 0-10 (11 quantized steps), not 0-1 — raw 1 (Alg. 2) is general Operator knowledge for the standard "B modulates A" 2-operator chain, NOT read back from this specific device instance — worth a UI glance to confirm before trusting blindly.
  "A Coarse": 1    # display: ratio 1 — carrier tracks the played pitch. CORRECTED: Coarse's real raw range is 0-48, not 0-1; left at Operator's own default (1), which a freshly-inserted device very plausibly already reports as ratio 1.00 — UNVERIFIED by ear/UI, but no longer wrong by three orders of magnitude.
  "A Fine": 0.0
  "Osc-A Level": 1.0        # display: full carrier output — RAW UNVERIFIED.
  "Ae Attack": 0.0          # display: 0 — sourced directly ("Attack and Sustain at 0" for a percussive envelope). RAW UNVERIFIED placeholder, though the DISPLAY intent (zero) is sourced with unusual confidence.
  "Ae Decay": 0.35          # display: short-to-medium ("Decay to 9 o'clock" per the sourced description — qualitative position, not a number this entry can convert precisely). INFERRED param name (only Ae Attack confirmed) — RAW UNVERIFIED placeholder.
  "Ae Sustain": 0.0         # display: 0 — sourced directly, same percussive-envelope description as Ae Attack above.
  "Ae Release": 0.45        # display: moderate ("Release to 1 o'clock" per the source — qualitative, not a number). INFERRED param name — RAW UNVERIFIED placeholder.
  "B Coarse": 2    # display: ratio 2 (2:1 modulator) — sourced from both FM-pluck sources above. CORRECTED scale (0-48 real range, not 0-1); raw value 2 is a BEST-EFFORT guess at "ratio 2.00" assuming a roughly-linear low-end mapping from Operator's default (raw 1 ≈ ratio 1.00) — genuinely UNVERIFIED, needs an ear/UI pass to confirm the actual ratio this produces before trusting the "2:1" claim.
  "B Fine": 0.0
  "Osc-B Level": 0.55       # display: moderate-high peak modulation index for a bright, cutting attack. CONSTRUCTED magnitude (sources describe the envelope shape and ratio, not an exact index) — RAW UNVERIFIED.
  "Be Attack": 0.0          # display: fast attack, sourced ("fast attack... on the modulator envelope"). RAW UNVERIFIED placeholder.
  "Be Decay": 0.08          # display: ~50ms — the ONE sourced numeric envelope time in this recipe ("fast decay (50ms)... for bright, cutting plucks"). Deliberately the FASTEST decay in this patch, faster than Ae Decay, so the bright FM edge is heard only at the very start of the pluck. INFERRED param name — RAW UNVERIFIED placeholder; 50ms is sourced, but this raw number is still a guess at what raw value produces 50ms since no Operator time-scale curve exists in this repo.
  "Be Sustain": 0.05        # display: near-zero — the modulator settles to almost pure tone quickly, leaving a clean carrier tail. RAW UNVERIFIED, assumed raw≈display.
  "Be Release": 0.1
  "Filter Freq": 0.6        # display: moderately open lowpass, letting the bright transient through before the amp envelope closes the note. INFERRED param name, CONSTRUCTED display target — RAW UNVERIFIED.
  "Filter Res": 0.25        # display: light resonance for a bit of "cutting" edge, matching the sourced "bright, cutting plucks" description. INFERRED param name — RAW UNVERIFIED.
  Volume: 0.7               # confirmed device.get name. This 0.7 value is RAW UNVERIFIED for this patch.
playNotes: "1|1 C4 1 v105"
```

## Raw values: unverified — read before applying

**CONFIRMED (not just unverified) scale bug, found via a real `awh op apply` on Operator**: `Algorithm`'s real raw range is **0-10** (11 quantized steps, `Alg. 1`-`Alg. 11`), and `Coarse`'s real raw range is **0-48** — NOT the normalized 0-1 range this recipe assumed for every param. Writing this recipe's 0-1-scaled values for `Algorithm`/`*Coarse` against a real device silently round/clamp to 0 (confirmed: read-back mismatch on all three). Every OTHER param in this recipe (Volume, `Osc-* Level`, envelope times, `Filter Freq`/`Filter Res`) genuinely IS ~0-1 scaled and wrote/read back correctly — this is specifically an `Algorithm`/`Coarse` problem, not a whole-recipe one. Not corrected here: knowing the real RANGE doesn't tell us the CORRECT value within it (e.g. which of the 11 algorithms is "2-operator, B into A") — that still needs a real ear/UI pass, `knowledge/setup/device-parameter-surface.md` has no `displayValue` API to shortcut it.

Standing caveat (same estimation method as the other entries in this
batch): **every raw value above is an unverified estimate, not a
measurement.** No Operator raw↔display pair has ever been read back into
this repo. Apply, listen against the DISPLAY comments, correct, and record
observed raw↔display pairs back into this entry. Coarse assumed ≈
(ratio−0.5)/31.5 across its ~0.5–32 display range. `Be Decay`'s DISPLAY
comment (50ms) is a real sourced number — unusual for this batch, most
Decay/Release DISPLAY comments elsewhere are qualitative or constructed —
but its RAW value is still a guess, since no ms→raw mapping for Operator's
envelope time knobs exists anywhere in this repo. Treat `Ae Decay` and
`Ae Release`'s qualitative "9 o'clock"/"1 o'clock" source descriptions as
ORDERING hints only (short-ish decay, moderate release), not values this
entry could faithfully convert to a number.

## Param naming: verified vs inferred

- **Verified-style**: `Algorithm`, `A Coarse`, `A Fine`,
  `Osc-A Level`, `B Coarse`, `B Fine`, `Osc-B Level`, `Ae Attack`,
  `Volume`.
- **Inferred**: `Ae Decay`, `Ae Sustain`, `Ae Release`, `Be Attack`,
  `Be Decay`, `Be Sustain`, `Be Release`, `Filter Freq`, `Filter Res`.
  `awh op apply` must validate every name against a live `device.get` dump
  before writing anything.
