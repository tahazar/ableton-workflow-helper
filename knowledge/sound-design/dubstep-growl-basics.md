---
slug: dubstep-growl-basics
topic: sound-design
tier: sourced
tags: [dubstep, growl, wobble, fm, formant, lfo, resampling, sound-design]
sources: ["https://growl.miraheze.org/wiki/The_Growl", "https://gearspace.com/board/electronic-music-instruments-and-electronic-music-production/1144312-dubstep-growl-scream-monster-vowel-bass-fm.html", "https://www.musicradar.com/how-to/lfo-wobble-bass", "https://www.musicradar.com/how-to/create-wobble-bass-logic-es2-synth", "https://www.soundonsound.com/techniques/dubstep-secrets", "https://kansamples.com/blogs/learn/sound-design-dnb-dubstep", "https://www.kvraudio.com/forum/viewtopic.php?t=404832"]
related: [rhythm/dubstep-drum-pattern, arrangement/phrase-style-dubstep-cr, sound-design/isoxo-snare-pitch-resample]
---
# Dubstep growl/wobble basics: FM, formant movement, and resampling chains

PROSE-ONLY: this entry describes how a growl/wobble patch is built and
processed. It contains no notes or pattern for `awh` to write into a clip,
so it has no Executable block. Same sourcing caveat as
`rhythm/dubstep-drum-pattern` [sourced]: the cited pages could not be
fetched directly, so the citations are built from web-search excerpts tied
to named pages. Phrases are quoted where the excerpt was quotable, and
paraphrased and flagged as aggregate where the excerpt summarized a small
batch of pages.

## Three components, not one sound

A growl patch is conventionally split into three layers designed and
processed somewhat independently: "the low end movement, the midrange
vowel, and the high end texture" (growl.miraheze.org, "The Growl"). Treat a
growl as a small signal chain producing all three, not a single oscillator
with a filter. The "vowel" character comes from formants (the resonant
spectral peaks that shape vowel sounds in speech), applied to a bass
waveform instead of a voice.

## Low-end movement: two named methods, both simple at the source

The wiki names two common techniques for the low-end-movement layer:
"FMing two sine waves together, or bandpassing a saw wave." Concretely: a
sine wave FMing another sine at a 2:1 frequency ratio with the FM amount
automated over time, or a saw wave through a steep (24dB/oct) bandpass
filter swept roughly 50-500Hz (growl.miraheze.org; corroborated by a
Gearspace forum thread on FM-based dubstep growl/vowel bass). Both sources
agree the base patch should stay simple ("two sines FMing or a bandpass
filtered sawtooth"), with "the majority of the tone" coming from processing
applied afterward. This matches `sound-design/isoxo-snare-pitch-resample`
[sourced]'s finding for a different drum sound: simple source, most of the
character built downstream.

## LFO rate is a musical division, not a random wobble speed

The "wobble" comes from a low-frequency oscillator (LFO) driving the filter
cutoff (or the FM amount, for the growl variant). Its rate is
conventionally tempo-synced to a note division, not set to an arbitrary Hz
value: sync the LFO to "1/4, 1/8, or 1/16 notes for slow, medium, or fast
wobbles," with an eighth-note triplet ("1/8 trip") called out for the
classic wobble feel (musicradar.com, "How to build an LFO wobble bass" and
"Create the famous wobble bass sound... using Logic's ES2 synth"). Two
further refinements the articles/threads agree on:

- **Delay the LFO's onset per note.** MusicRadar's ES2 walkthrough sets the
  Delay parameter to "48" so the wobble doesn't start the instant a note
  fires. It describes this as what "provides the classic dubstep sound": a
  beat of stillness before the modulation kicks in.
- **Retrigger the LFO on every note.** Sound on Sound's "Dubstep Secrets"
  names LFO retrigger per note as part of "the secret of dubstep bass,"
  alongside distortion. ES2's Retrig mode restarts the LFO on every note-on
  instead of letting it free-run, so each note gets the same wobble shape
  from its own downbeat, not a phase-drifted continuation of the previous
  note's cycle.

From the growl-specific research: the filter/formant movement is layered
with a second modulation source, and distortion is placed after the filter
"so the vowel movement gets more aggressive." The LFO shapes the spectral
movement; the downstream distortion makes that movement read as aggressive
instead of merely filtered.

## Resampling chains: the production workflow, not only the patch

A production-technique article and a sound-design forum thread both
describe modern bass-heavy genres (dubstep and drum & bass named) as built
on resampling as a workflow, not an occasional trick: "modern DnB, dubstep
and neurofunk bass design are built almost entirely on resampling chains —
each stage takes the previous stage's output, processes it further, prints
the result to audio, and uses that audio as the source for the next stage"
(kansamples.com, "Sound Design for Drum & Bass and Dubstep"). The same
article gives a rough bound: "2-3 rounds of resampling is the sweet spot...
more than that and artefacts accumulate; less than that and you lose
creative possibilities."

A KVR Audio sound-design thread on Skrillex/Datsik-style bass corroborates
the mechanism (repeatedly bouncing to audio and reprocessing the bounce)
but pushes back on treating it as mandatory. Resampling "commits" a sound
and frees the project from stacking live inserts/sends, but is "more of a
workflow thing than anything." The target timbre is reachable without
resampling; resampling is how most described workflows reach it in
practice. This mirrors `sound-design/isoxo-snare-pitch-resample`
[sourced]'s bounce-then-resample technique for an unrelated drum sound: the
same "commit, then reprocess the commitment" habit appears across
different bass-music sound design.

## What this entry does not claim

No source gave an FM ratio beyond the 2:1 sine example, a bandpass Q, a
distortion type/amount, or a number of resampling passes beyond the "2-3
rounds" rule of thumb. Treat any more precise number found elsewhere as a
personal preset choice, not a documented convention, unless it carries its
own citation.
