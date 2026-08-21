---
slug: dubstep-growl-basics
topic: sound-design
tier: sourced
tags: [dubstep, growl, wobble, fm, formant, lfo, resampling, sound-design]
sources: ["https://growl.miraheze.org/wiki/The_Growl", "https://gearspace.com/board/electronic-music-instruments-and-electronic-music-production/1144312-dubstep-growl-scream-monster-vowel-bass-fm.html", "https://www.musicradar.com/how-to/lfo-wobble-bass", "https://www.musicradar.com/how-to/create-wobble-bass-logic-es2-synth", "https://www.soundonsound.com/techniques/dubstep-secrets", "https://kansamples.com/blogs/learn/sound-design-dnb-dubstep", "https://www.kvraudio.com/forum/viewtopic.php?t=404832"]
related: [rhythm/dubstep-drum-pattern, arrangement/phrase-style-dubstep-cr, sound-design/isoxo-snare-pitch-resample]
---
# Dubstep growl/wobble basics: FM, formant movement, and resampling chains

PROSE-ONLY: this is a sound-design description of how a growl/wobble patch
is built and processed, not notes or a pattern — there is nothing here for
`awh` to write into a clip, so no Executable block. Same sourcing-method
caveat as `rhythm/dubstep-drum-pattern` [sourced]: WebFetch was blocked at
the network egress layer for every host tried this session, so the
citations below are built from web-search-tool excerpts tied to named
pages rather than raw page fetches — quoted where the search tool returned
a quotable phrase, paraphrased and flagged as aggregate where it summarized
across a small batch of pages instead.

## Three components, not one sound

A growl patch is conventionally broken into three layers that get designed
and processed somewhat independently: "the low end movement, the midrange
vowel, and the high end texture" (growl.miraheze.org, "The Growl"). Treat a
growl as a small signal chain producing all three, not a single oscillator
with a filter on it — the "vowel" character specifically comes from formants
(the resonant spectral peaks that shape vowel sounds in speech), applied to
a bass waveform rather than a voice.

## Low-end movement: two named methods, both simple at the source

The wiki names exactly two common techniques for the low-end-movement layer:
"FMing two sine waves together, or bandpassing a saw wave" — concretely, a
sine wave FMing another sine wave at a 2:1 frequency ratio with the FM
amount automated over time, or a saw wave run through a steep (24dB/oct)
bandpass filter swept roughly 50-500Hz (growl.miraheze.org; corroborated by
a Gearspace forum thread specifically on FM-based dubstep growl/vowel bass
technique). Both sources agree the BASE patch should stay simple — "two
sines FMing or a bandpass filtered sawtooth" — with "the majority of the
tone" coming from processing applied afterward, not from a complex source
patch. This matches `sound-design/isoxo-snare-pitch-resample` [sourced]'s
general finding for a different drum sound: simple source, most of the
character built downstream.

## LFO rate is a musical division, not a random wobble speed

The modulation that produces "wobble" is a low-frequency oscillator (LFO)
driving the filter cutoff (or the FM amount, for the growl variant), and
its rate is conventionally tempo-synced to a musical note division rather
than set to an arbitrary Hz value — sync the LFO to "1/4, 1/8, or 1/16
notes for slow, medium, or fast wobbles," with an eighth-note triplet
division ("1/8 trip") called out specifically for the classic wobble feel
(musicradar.com, "How to build an LFO wobble bass" and "Create the famous
wobble bass sound... using Logic's ES2 synth"). Two further refinements
both articles/threads agree on:

- **Delay the LFO's onset per note.** MusicRadar's ES2 walkthrough sets the
  Delay parameter to a specific value ("48") so the wobble doesn't start
  the instant a note fires — described as what "provides the classic
  dubstep sound," i.e. a beat of stillness before the modulation kicks in,
  not modulation from note-on.
- **Retrigger the LFO on every note.** Sound on Sound's "Dubstep Secrets"
  names LFO-retrigger-per-note as part of "the secret of dubstep bass"
  alongside distortion, and ES2's Retrig mode is built specifically to
  restart the LFO on every note-on rather than letting it free-run — so
  each new note gets the same wobble shape from its own downbeat, not a
  phase-drifted continuation of the previous note's cycle.

A separate finding from the growl-specific research: the filter/formant
movement is deliberately layered with a SECOND modulation source and
distortion placed after the filter, "so the vowel movement gets more
aggressive" — i.e. the LFO shapes the spectral movement, and distortion
downstream is what makes that movement read as aggressive rather than
just filtered.

## Resampling chains: the production workflow, not just the patch

Both a dedicated production-technique article and a sound-design forum
thread describe modern bass-heavy genres (dubstep and drum & bass named
specifically) as built on resampling as a WORKFLOW, not an occasional
trick: "modern DnB, dubstep and neurofunk bass design are built almost
entirely on resampling chains — each stage takes the previous stage's
output, processes it further, prints the result to audio, and uses that
audio as the source for the next stage" (kansamples.com, "Sound Design for
Drum & Bass and Dubstep"). The same article gives a rough practical bound:
"2-3 rounds of resampling is the sweet spot... more than that and
artefacts accumulate; less than that and you lose creative possibilities."
A KVR Audio sound-design forum thread on Skrillex/Datsik-style bass work
corroborates the mechanism (repeatedly bouncing to audio and reprocessing
the bounce) but pushes back on treating it as mandatory: resampling
"commits" a sound and frees the session from stacking live inserts/sends,
but is "more of a workflow thing than anything" rather than the only route
to the characteristic tone — i.e. the destination timbre isn't uniquely
reachable only via resampling, but resampling is how most described
workflows reach it in practice. This mirrors
`sound-design/isoxo-snare-pitch-resample` [sourced]'s bounce-then-resample
technique for a completely different drum sound — the same "commit, then
reprocess the commitment" habit shows up across unrelated bass-music sound
design, for whatever that pattern is worth.

## What this entry does NOT claim

No source gave a specific FM ratio beyond the 2:1 sine example, a specific
bandpass Q, a specific distortion type/amount, or a specific number of
resampling passes beyond the "2-3 rounds" rule of thumb — treat any more
precise number encountered elsewhere as someone's personal preset choice,
not a documented convention, unless it comes with its own citation.
