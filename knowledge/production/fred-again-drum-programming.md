---
slug: fred-again-drum-programming
topic: production
tier: sourced
tags: [fred-again, drums, battery, envelope, groove, sidechain]
sources: ["https://www.soundonsound.com/people/fred-gibson-aka-fred-again", "https://www.attackmagazine.com/technique/beat-dissected/breaking-down-how-to-make-beats-inspired-by-fred-again/", "https://www.rollingstone.com/music/music-news/fred-again-wows-zane-lowe-mpc-new-interview-1234618577/"]
related: [production/fred-again-voice-memo-instruments, production/fred-again-texture-chain]
---
# Fred again..: drum feel — envelope-first shaping, glued bus, live-triggered

## Executable
Sound design is envelope-first, not EQ- or distortion-first. Per Sound on
Sound, Fred's habit inside Battery is to pitch the hit down (his example:
"like 20 semitones"), then shape it almost entirely with the ADSR volume
envelope: "90 percent of drum manipulation, I find I just do with the ADSR
[envelope]." Live translation:

1. Load each drum one-shot into its own **Simpler** instance (or Drum Rack
   pad).
2. Transpose first: pitch the hit down toward the −20 st he cites as a
   starting reference. The source does not say whether this applies to
   kicks, snares, or all elements, so treat it as a general habit, not a
   per-drum-type rule.
3. Shape with Simpler's Volume envelope before reaching for EQ or
   saturation: short Attack and short Release for a tight, choppable closed
   hit; longer Release to keep a tail on an open hit. By his own account
   this is the primary sound-design lever, not a polish step.
4. Bus glue: route all drum instances to one "Drums" group track and
   insert a single Compressor on the group. Per Sound on Sound, Battery
   gives him "a good master compression bus for them all" that every hit
   sits under, instead of compressing each drum individually.

Groove and percussion layering, per Attack Magazine's "Breaking Down How To
Make Beats Inspired by Fred Again": producers reconstructing his style apply
one groove/swing template to the percussive elements as a set instead of
hand-adjusting timing per hit. They layer thin shaker/tambourine-type
percussion over the core kit, sidechained from the kick so those layers duck
under each kick hit and stay out of the low end.

5. Groove: pick or capture one Groove (Live's Groove Pool) and apply it to
   every clip in the drum group together, not per clip.
6. Extra percussion (shaker, tambourine, hats beyond the core kit): add a
   Compressor sidechained from the Kick track, fast attack, short release,
   so these layers audibly duck on every kick hit.

Live-performance context, per Rolling Stone's account of his Zane Lowe/Apple
Music 1 interview: he finger-drums and retriggers samples on an MPC/
Maschine-style pad controller in real time instead of only playing back a
fixed pattern ("you can put anything on it"). For building a pattern in
Live: keep drum elements on separate short, loopable clips, not one long
baked arrangement, so the pattern can also be retriggered and recombined
live, the way he treats his own source patterns as a performance surface.

No source gives ADSR ms values, swing percentage, compressor ratio/
threshold, or sidechain release time. Only the order of operations
(pitch → envelope → bus compression; groove applied set-wide; percussion
sidechained off the kick) and the one pitch reference (~−20 semitones) are
sourced.

## The rule
Per Sound on Sound's interview with Fred Gibson: he uses Battery as "the
quickest way you can easily pitch them and add compression." He pitches
hits down, does "90 percent" of the shaping with the ADSR envelope, and
glues the result on "a good master compression bus for them all." Per
Attack Magazine's breakdown of his style: groove/swing is applied across
the percussive elements together, and thin percussion layers are
sidechained from the kick to duck out of its way. Per Rolling Stone's
account of his Zane Lowe interview, his drums are also a live-performance
surface, triggered and recombined on an MPC/Maschine-style controller, not
only a fixed studio pattern.
