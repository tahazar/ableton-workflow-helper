---
slug: fred-again-vocal-chop-hooks
topic: production
tier: sourced
tags: [fred-again, vocal-chop, arrangement, hook, earworm]
sources: ["https://www.thefader.com/2022/10/27/fred-again-the-fader-interview-actual-life-3", "https://www.musicradar.com/artists/the-best-feeling-is-when-you-play-back-the-thing-youve-made-that-day-and-you-actually-feel-good-about-it-thats-the-drug-im-chasing-every-day-unlocking-the-production-tricks-that-fred-again-swears-by", "https://www.npr.org/2022/11/12/1136054396/how-fred-again-transforms-the-sounds-of-social-media-into-rave-worthy-beauty"]
related: [production/fred-again-voice-memo-instruments, production/fred-again-texture-chain]
---
# Fred again..: the vocal chop as the melodic hook, and building the whole song around it

## Executable
Arrangement habit, per the FADER interview: he does not write one
arrangement per idea. He takes a single found vocal line and builds "loads
of versions" of the song around it before picking one. His example is the
"Delilah" line, "You know how to calm me down and pull me out of this,"
which he tried "in lots of different emotional frameworks" until one stuck.
In practice: don't discard a chop-hook that isn't working in the first
arrangement. Re-house it (new chords, new tempo feel, new drum energy)
before writing a new hook from scratch.

Live workflow for turning a found phrase into a chopped melodic hook:

1. Warp the vocal phrase (Complex or Complex Pro) and lay it on the grid at
   its natural tempo before any chopping.
2. Slice at word/syllable boundaries: right-click the clip → **Slice to New
   MIDI Track** (creates a Drum Rack of slices), or place Warp Markers at
   each slice point to keep working in one audio clip.
3. Re-sequence the slices into a repeating rhythmic/melodic pattern that
   does not follow the original spoken word order. The hook is a new
   cadence built from the source's syllables, not a replay of the sentence.
4. Iterate arrangements around the same chop (the "Delilah" pattern above):
   duplicate the arrangement, try the hook over a different chord loop or
   drum energy, and keep the version that lands emotionally, not the first
   one that's technically finished.

Reverb/delay on the hook, per MusicRadar: he treats space as a
compositional tool applied to specific words, not a blanket vocal-bus
effect. The article describes him "trying words at the ends of phrases" for
reverb and automating the send level instead of using a static send, so the
reverb can "fill the space" after a phrase and build to a swell. In Live:
put the reverb on a return track, keep the vocal chop dry by default, and
automate the Send knob up on phrase-ending slices/hits instead of setting
one fixed send level for the whole clip.

No source gives semitone amounts, delay times, or automation curve shapes
for the chop-hook. Only the two moves (re-sequence out of spoken order;
automate the reverb send per phrase end instead of statically) are sourced.

Illustrative only, not sourced numbers: a generic shape that re-sequences 4
word-slices out of their spoken order into a repeating hook, for reference
when building a chop-hook clip.

```awh-notation
sig 4/4
1|1   C3   1/2   v100   # slice 1
1|1.5 D3   1/2   v90    # slice 3 (out of order)
1|2   Eb3  1/2   v100   # slice 2
1|2.5 D3   1/2   v90    # slice 3 repeated
1|3   C3   1     v100   # slice 1, held
```

## The rule
Per the FADER interview: Fred spent "a lot of time making different songs"
around the "Delilah" vocal, building "loads of versions around that line"
and trying it "in lots of different emotional frameworks" before settling on
one. The vocal hook is fixed first; the arrangement is what gets iterated.
Per MusicRadar's "Unlocking the production tricks that Fred Again swears
by": his reverb use is precise and additive, applied to specific
words/phrase ends instead of the whole vocal, with the send level automated
(not static) to create a "reverb swell." Per NPR, his description of the
source material as a "collaborative diary" explains why the hook itself
(the specific person's voice, slightly broken up) carries the emotional
weight more than the surrounding production.
