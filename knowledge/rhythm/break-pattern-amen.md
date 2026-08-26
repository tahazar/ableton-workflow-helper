---
slug: break-pattern-amen
topic: rhythm
tier: sourced
tags: [break, amen, jungle, dnb, breakbeat, funk, transcription, gregory-coleman]
sources: ["https://en.wikipedia.org/wiki/Amen_break", "https://www.musicradar.com/tuition/tech/how-to-program-an-amen-style-break-637374", "https://www.ethanhein.com/wp/2023/building-the-amen-break/", "https://www.drumstheword.com/free-drum-lesson-amen-break-best-drum-beats-ever-amen-brother-gregory-coleman/", "https://www.elephantdrums.co.uk/blog/guides-and-resources/amen-break-drum-groove/"]
related: [rhythm/break-pattern-think, rhythm/break-pattern-funky-drummer, rhythm/break-chop-craft, rhythm/arp-style-ratchet, rhythm/dubstep-drum-pattern]
---
# Break pattern: the Amen break

**Sourcing note (this session):** full-page fetch was unavailable for every
transcription/tutorial host tried (en.wikipedia.org, musicradar.com,
ethanhein.com, drumstheword.com, elephantdrums.co.uk) — research went through
WebSearch, which returns synthesized excerpts tied to named pages rather than
raw HTML. Several independent pages converge tightly on the same 16th-note
positions for bars 3-4 (the Wikipedia "Amen break" article's structural
description and MusicRadar's "How to program an Amen-style break" tutorial
agree closely enough that they read as describing the same underlying
transcription), so those positions are cited as sourced. Where the excerpts
left a gap — most of the kick lattice outside the two specifically-quoted
kick hits, and several bar-4 details past the sourced anchors — this entry
fills in a plausible groove and says so plainly rather than presenting a
guess as fact.

## Executable

```awh-notation
sig 4/4
# The canonical Amen break, bars 3-4 of Gregory Coleman's original 4-bar
# solo in "Amen, Brother" (The Winstons, 1969) — the syncopated half of the
# break that jungle/DnB chopping treats as THE amen pattern (see
# rhythm/break-chop-craft). Bars 1-2 of the original are a straighter funk
# groove (same ride/snare backbone, no displacement) and are not notated
# here. SOURCED hits are marked; CONSTRUCTED fills are marked too — see
# "What's sourced vs constructed" below before trusting any single note.

# --- Bar 1 (= original amen bar 3) ---
1|1     D#2  1/8  v90            # ride, sourced: "ride cymbal throughout"
1|1     C1   1/4  v100 m         # kick on 1 — CONSTRUCTED (generic funk fill)
1|1     F#1  1/8  v35            # pedalled hat, faint — sourced presence, constructed exact velocity
1|1.5   D#2  1/8  v88
1|2     D#2  1/8  v90
1|2     D1   1/4  v127           # snare backbeat on 2 — sourced
1|2     F#1  1/8  v35
1|2.5   D#2  1/8  v88
1|2.75  D1   1/8  v82            # snare pickup, "a" of beat 2 — sourced
1|3     D#2  1/8  v90
1|3     F#1  1/8  v35
1|3.25  D1   1/8  v82            # snare pickup, "e" of beat 3 — sourced
1|3.5   D#2  1/8  v88
1|3.5   C1   1/4  v105           # kick, "+" of beat 3 — sourced (bar 3's ONE kick here, not two)
1|4     D#2  1/8  v90
1|4     F#1  1/8  v35
1|4.5   D#2  1/8  v88
1|4.5   D1   1/4  v120           # backbeat DISPLACED from beat 4 to "+" of 4 — sourced, the key bar-3/4 move
1|4.75  D1   1/8  v45            # quiet ghost snare, "a" of beat 4 — sourced

# --- Bar 2 (= original amen bar 4) ---
# beat 1 left EMPTY — no ride, hat, kick, or snare — sourced (see disagreement note)
2|1.25  D1   1/8  v80            # snare pickup, "e" of beat 1 — sourced
2|1.5   C1   1/4  v85            # kick 1 of the pair after the pickup — CONSTRUCTED placement (by analogy)
2|1.75  C1   1/4  v100           # kick 2, louder — CONSTRUCTED placement (by analogy)
2|2     D#2  1/8  v90
2|2     F#1  1/8  v45            # pedal hat "more prominent" in bar 4 — sourced claim, constructed velocity
2|2.5   D#2  1/8  v88
2|2.75  D1   1/8  v82            # snare, "in between the ride cymbals" before the crash — CONSTRUCTED position
2|3     D#2  1/8  v90
2|3     F#1  1/8  v45
2|3.25  D1   1/8  v82            # second pre-crash snare — CONSTRUCTED position
2|3.5   C#2  1/4  v115           # crash, "+" of beat 3 — sourced, the famous early crash
2|4     D#2  1/8  v90
2|4     F#1  1/8  v45
2|4.5   D#2  1/8  v88
2|4.5   D1   1/4  v120           # displaced backbeat, "+" of beat 4 — sourced (same move as bar 1)
```

## The rule

### What the break is

A four-bar drum solo by Gregory Coleman in The Winstons' "Amen, Brother"
(1969), ~7 seconds at roughly 136-140 BPM depending on the source's tempo
estimate, played on kick, snare, and ride cymbal with a faint pedalled
hi-hat underneath (Wikipedia, "Amen break"; MusicRadar, "How to program an
Amen-style break"). Bars 1-2 repeat a straight, standard-issue funk groove;
bars 3-4 are the unstable, syncopated half — described across sources as
"tumbling over themselves" — that gives the break its identity and is what
this entry notates as the canonical 2-bar unit (see
`rhythm/break-chop-craft` for why jungle/DnB treats this half as THE amen
pattern to chop).

### What's directly sourced

- **Ride cymbal on eighth notes throughout** the break, with a pedalled
  hi-hat on the beat underneath — faint through bars 1-3, more audible in
  bar 4 (Wikipedia; MusicRadar).
- **Bar 3's backbeat is displaced**: the snare that would land on beat 4
  is pushed back an eighth note to the "+" of beat 4 — described as "the
  most crucial element in the pattern" (MusicRadar/Ethan Hein synthesis)
  and independently confirmed by Wikipedia's bar-by-bar description
  ("the snare drum is also cleverly displaced back one eighth note to the
  '+' of beat 4").
- **Bar 3 has exactly one kick** in the 16th-subdivision cluster after
  beat 3 — on the "+" of beat 3 only, NOT also on the following 16th
  ("a") the way bars 1-2 do (Wikipedia: "only one bass drum is played on
  the '+' of beat 3 and not on the 'a'"). This is a real, named
  bar-3-vs-bars-1-2 distinction, not this entry's invention.
- **Bar 4 opens with silence on beat 1**, then a snare pickup on the "e"
  of beat 1 followed by kick hits, a crash on the "+" of beat 3 (instead
  of a ride hit), and the same displaced backbeat on the "+" of beat 4
  that bar 3 has (Wikipedia: "In the fourth bar, the drummer leaves the
  first beat empty, then plays a syncopated pattern and an early crash
  cymbal"; "an extra snare drum is played on the 'e' of beat 1 followed by
  two bass drum notes... the crash is played on the '+' of beat 3... the
  bar ends with another displaced snare drum backbeat, moved to the '+' of
  beat 4").

### A named disagreement: is bar 4 beat 1 really silent?

Sources are in tension here and this entry picks a side deliberately. One
strand of description says the ride plays "throughout" the whole break
with only the crash as an interruption; another, more bar-specific
strand — the Wikipedia structural breakdown, which is explicit about bar 4
starting with "the first beat empty" — describes a genuine hole at the
top of the last bar. This entry follows the bar-specific reading (true
silence on 2|1, no ride/hat either) because it's the more granular,
purpose-built description of that exact moment, and treats "ride
throughout" as a description of the break's general sweep with bar 4 beat
1 as its one documented, deliberate exception rather than a literal
contradiction.

### What's constructed, and why

The sourced facts above account for the backbone (ride, the two
displacements, the bar-3 single kick, the bar-4 silence-then-pickup-then-
crash shape) but not every note in a usable 2-bar clip. This entry fills
gaps with a plausible, restrained funk-groove fill (the beat-1 kick in bar
1, the kick pair after bar 4's pickup, the two pre-crash snares in bar 4,
all pedal-hat velocities) and marks every one of them `CONSTRUCTED` in the
notation comments. None of the velocity values are measured — they're this
agent's dynamic shaping (loud backbeats, quieter pickups, quiet ghost
notes) applied on top of sourced NOTE POSITIONS, not sourced numbers
themselves. Treat the position of every unmarked hit as sourced and every
`CONSTRUCTED` hit as an editorial fill, safe to omit or replace when
chopping (`rhythm/break-chop-craft`) without contradicting the citations
above.
