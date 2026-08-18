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
Sound design is envelope-first, not EQ/distortion-first. Per Sound on
Sound, Fred's stated habit inside Battery is: pitch the hit down (his
example: "like 20 semitones"), then shape it almost entirely with the
ADSR volume envelope — "90 percent of drum manipulation, I find I just do
with the ADSR [envelope]." Live translation:

1. Load each drum one-shot into its own **Simpler** instance (or Drum Rack
   pad).
2. Transpose first: pitch the hit down toward the −20 st he cites as a
   starting reference point (unstated whether this is typical for kicks,
   snares, or all elements alike — treat as a general habit, not a
   per-drum-type rule).
3. Shape with Simpler's **Volume envelope** before reaching for EQ or
   saturation: short Attack + short Release for a tight, choppable closed
   hit; longer Release to keep a tail on an open hit. This is the primary
   sound-design lever per his own account, not a secondary polish step.
4. Bus glue: route all drum instances to one "Drums" group track and
   insert a single **Compressor** on the group — per Sound on Sound, Battery
   gives him "a good master compression bus for them all" that all hits sit
   under, rather than compressing each drum individually.

Groove and percussion layering, per Attack Magazine's "Breaking Down How To
Make Beats Inspired by Fred Again": producers reconstructing his style pull
a groove/swing template and apply it to the percussive elements as a set,
rather than hand-adjusting timing per hit, and layer thin
shaker/tambourine-type percussion on top of the core kit with sidechain
compression from the kick so those layers duck under each kick hit and
don't clutter the low end.

5. Groove: pick or capture one Groove (Live's Groove Pool) and apply it to
   every clip in the drum group together, rather than per-clip.
6. Extra percussion (shaker, tambourine, hats beyond the core kit): add a
   Compressor sidechained from the Kick track, fast attack, short release,
   so these layers visibly duck on every kick hit.

Live-performance context, per Rolling Stone's account of his Zane Lowe/Apple
Music 1 interview: he finger-drums and retriggers samples on an MPC/
Maschine-style pad controller in real time rather than only ever pressing
play on a fixed pattern — "you can put anything on it, it's so infinitely
powerful." Practical implication for building a pattern in Live: keep drum
elements on separate short, loopable clips (not one long baked arrangement)
so a pattern built for a track can also be retriggered/recombined live, the
way his own source patterns are treated as a performance surface.

No source gives ADSR ms values, swing percentage, compressor ratio/
threshold, or sidechain release time — only the order of operations
(pitch → envelope → bus compression; groove applied set-wide; percussion
sidechained off the kick) and the one concrete pitch reference (~−20
semitones) are sourced.

## The rule
Per Sound on Sound's interview with Fred Gibson: his drum sound design in
Battery is "the quickest way you can easily pitch them and add
compression," built around pitching hits down and then doing "90 percent"
of the shaping with the ADSR envelope, glued afterward on "a good master
compression bus for them all." Per Attack Magazine's breakdown of his
style: groove/swing is extracted and applied across the percussive
elements together, and thin percussion layers are sidechained from the kick
to duck out of its way. Per Rolling Stone's account of his Zane Lowe
interview, his drums are also a live-performance surface — triggered and
recombined on an MPC/Maschine-style controller — not only a studio-fixed
pattern.
