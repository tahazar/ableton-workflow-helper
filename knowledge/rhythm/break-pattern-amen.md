---
slug: break-pattern-amen
topic: rhythm
tier: sourced
tags: [break, amen, jungle, dnb, breakbeat, funk, transcription, gregory-coleman]
sources: ["https://en.wikipedia.org/wiki/Amen_break", "https://www.musicradar.com/tuition/tech/how-to-program-an-amen-style-break-637374", "https://www.ethanhein.com/wp/2023/building-the-amen-break/", "https://www.drumstheword.com/free-drum-lesson-amen-break-best-drum-beats-ever-amen-brother-gregory-coleman/", "https://www.elephantdrums.co.uk/blog/guides-and-resources/amen-break-drum-groove/"]
related: [rhythm/break-pattern-think, rhythm/break-pattern-funky-drummer, rhythm/break-chop-craft, rhythm/arp-style-ratchet, rhythm/dubstep-drum-pattern]
---
# Break pattern: the Amen break

**Sourcing note:** sources were consulted through search excerpts tied to
named pages (Wikipedia, musicradar.com, ethanhein.com, drumstheword.com,
elephantdrums.co.uk), not full-page reads. Several pages converge on the
same 16th-note positions for bars 3-4. Wikipedia's "Amen break" structural
description and MusicRadar's "How to program an Amen-style break" agree
closely enough to describe the same transcription, so those positions are
cited as sourced. Where the excerpts leave gaps (most of the kick lattice
outside the two quoted kick hits, and some bar-4 details past the sourced
anchors) this entry fills in a plausible groove and marks it as such.

## Executable

```awh-notation
sig 4/4
# The canonical Amen break: bars 3-4 of Gregory Coleman's 4-bar solo in
# "Amen, Brother" (The Winstons, 1969), the syncopated half that
# jungle/DnB chopping treats as the amen pattern (see
# rhythm/break-chop-craft). Bars 1-2 of the original are a straighter funk
# groove (same ride/snare backbone, no displacement) and are not notated
# here. Each hit is marked sourced or constructed; read "What's directly
# sourced" and "What's constructed, and why" below before trusting a note.

# --- Bar 1 (= original amen bar 3) ---
1|1     D#2  1/8  v90            # ride, sourced: "ride cymbal throughout"
1|1     C1   1/4  v100 m         # kick on 1, constructed (generic funk fill)
1|1     F#1  1/8  v35            # pedalled hat, faint: sourced presence, constructed velocity
1|1.5   D#2  1/8  v88
1|2     D#2  1/8  v90
1|2     D1   1/4  v127           # snare backbeat on 2, sourced
1|2     F#1  1/8  v35
1|2.5   D#2  1/8  v88
1|2.75  D1   1/8  v82            # snare pickup, "a" of beat 2, sourced
1|3     D#2  1/8  v90
1|3     F#1  1/8  v35
1|3.25  D1   1/8  v82            # snare pickup, "e" of beat 3, sourced
1|3.5   D#2  1/8  v88
1|3.5   C1   1/4  v105           # kick, "+" of beat 3, sourced (one kick here in bar 3, not two)
1|4     D#2  1/8  v90
1|4     F#1  1/8  v35
1|4.5   D#2  1/8  v88
1|4.5   D1   1/4  v120           # backbeat displaced from beat 4 to "+" of 4, sourced; the key bar-3/4 move
1|4.75  D1   1/8  v45            # quiet ghost snare, "a" of beat 4, sourced

# --- Bar 2 (= original amen bar 4) ---
# beat 1 left empty (no ride, hat, kick, or snare), sourced; see the disagreement note
2|1.25  D1   1/8  v80            # snare pickup, "e" of beat 1, sourced
2|1.5   C1   1/4  v85            # kick 1 of the pair after the pickup, constructed placement (by analogy)
2|1.75  C1   1/4  v100           # kick 2, louder, constructed placement (by analogy)
2|2     D#2  1/8  v90
2|2     F#1  1/8  v45            # pedal hat "more prominent" in bar 4: sourced claim, constructed velocity
2|2.5   D#2  1/8  v88
2|2.75  D1   1/8  v82            # snare "in between the ride cymbals" before the crash, constructed position
2|3     D#2  1/8  v90
2|3     F#1  1/8  v45
2|3.25  D1   1/8  v82            # second pre-crash snare, constructed position
2|3.5   C#2  1/4  v115           # crash, "+" of beat 3, sourced: the famous early crash
2|4     D#2  1/8  v90
2|4     F#1  1/8  v45
2|4.5   D#2  1/8  v88
2|4.5   D1   1/4  v120           # displaced backbeat, "+" of beat 4, sourced (same move as bar 1)
```

## The rule

### What the break is

A four-bar drum solo by Gregory Coleman in The Winstons' "Amen, Brother"
(1969), ~7 seconds at roughly 136-140 BPM depending on the source's
estimate, played on kick, snare and ride with a faint pedalled hi-hat
underneath (Wikipedia, "Amen break"; MusicRadar, "How to program an
Amen-style break"). Bars 1-2 repeat a straight funk groove. Bars 3-4 are the
syncopated half, described as "tumbling over themselves", that gives the
break its identity. This entry notates that half as the canonical 2-bar
unit (see `rhythm/break-chop-craft` for why jungle/DnB treats it as the amen
pattern to chop).

### What's directly sourced

- **Ride cymbal on eighth notes throughout**, with a pedalled hi-hat on the
  beat underneath: faint through bars 1-3, more audible in bar 4
  (Wikipedia; MusicRadar).
- **Bar 3's backbeat is displaced**: the snare that would land on beat 4
  moves back an eighth to the "+" of beat 4, "the most crucial element in
  the pattern" (MusicRadar/Ethan Hein synthesis). Wikipedia's bar-by-bar
  description confirms it independently ("the snare drum is also cleverly
  displaced back one eighth note to the '+' of beat 4").
- **Bar 3 has exactly one kick** in the 16th cluster after beat 3, on the
  "+" only, not also on the following "a" as in bars 1-2 (Wikipedia: "only
  one bass drum is played on the '+' of beat 3 and not on the 'a'"). This
  bar-3 vs. bars-1-2 distinction is sourced.
- **Bar 4 opens with silence on beat 1**, then a snare pickup on the "e" of
  beat 1, kick hits, a crash on the "+" of beat 3 (replacing a ride hit),
  and the same displaced backbeat on the "+" of beat 4 as bar 3 (Wikipedia:
  "In the fourth bar, the drummer leaves the first beat empty, then plays a
  syncopated pattern and an early crash cymbal"; "an extra snare drum is
  played on the 'e' of beat 1 followed by two bass drum notes... the crash
  is played on the '+' of beat 3... the bar ends with another displaced
  snare drum backbeat, moved to the '+' of beat 4").

### A named disagreement: is bar 4 beat 1 really silent?

Sources are in tension, and this entry picks a side. One strand says the
ride plays "throughout", interrupted only by the crash. The bar-specific
strand (Wikipedia's structural breakdown, explicit that bar 4 starts with
"the first beat empty") describes a real hole at the top of the last bar.
This entry follows the bar-specific reading (true silence on 2|1, no ride
or hat) because it is the more granular description of that moment. "Ride
throughout" describes the break's general sweep, with bar 4 beat 1 as its
one deliberate exception.

### What's constructed, and why

The sourced facts cover the backbone (ride, the two displacements, the
bar-3 single kick, bar 4's silence-pickup-crash shape) but not every note
in a usable 2-bar clip. Gaps are filled with a restrained funk fill (the
beat-1 kick in bar 1, the kick pair after bar 4's pickup, the two pre-crash
snares in bar 4, all pedal-hat velocities), each marked `CONSTRUCTED` in the
notation comments. No velocity is measured. They are authored dynamics
(loud backbeats, quieter pickups, quiet ghosts) on top of sourced note
positions. Treat every unmarked hit's position as sourced and every
`CONSTRUCTED` hit as an editorial fill, safe to omit or replace when
chopping (`rhythm/break-chop-craft`) without contradicting the citations.
