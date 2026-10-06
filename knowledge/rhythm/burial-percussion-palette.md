---
slug: burial-percussion-palette
topic: rhythm
tier: sourced
tags: [burial, percussion, foley, vinyl-crackle, sound-design, sampling]
sources:
  - "https://elpaisanoonline.com/ae/2016/04/12/re-visiting-the-sounds-of-burials-untrue/"
  - "https://www.dogsonacid.com/threads/making-crackles-like-pole-burial.657549/"
  - "https://www.dogsonacid.com/threads/mj-cole-burial-typish-garage-2step-breaks.596209/"
  - "https://beatproduction.net/burial-samples-untrue/"
  - "https://www.whosampled.com/Burial/Archangel/"
  - "https://www.musicradar.com/tuition/tech/how-to-use-vinyl-crackle-and-tape-hiss-to-add-feel-and-vibe-632491"
related: [rhythm/burial-2step-skeleton, rhythm/burial-swing-feel, rhythm/burial-velocity-ghost]
---
# Burial's percussion palette: crackle bed + foley/metallic hits

## The rule

**Drum sound sourcing.** Burial avoids conventional drum-machine kick/snare
sounds. Per the dogsonacid MJ Cole/Burial thread, he "doesn't use snares for
snares", favouring bongo and conga sounds in the snare role, and "in place
of a snare, Burial often opts for a rim shot" in most tracks (consistent
with the rimshot-backbeat skeleton in `rhythm/burial-2step-skeleton`
[sourced]). Kicks and hits come from non-drum sources. The kick on
"Archangel" is reported as a door-knock sample from a video game (dogsonacid
thread; corroborated by WhoSampled's listing for the track, which also
documents a Metal Gear Solid orchestral cue elsewhere in it).
beatproduction.net's breakdown of the Untrue samples describes "metallic
Foley-style sounds taken from films and videogames", plus recorded matches
and lighters, as percussion and texture sources in place of synthesized or
drum-machine hits.

**Vinyl crackle as a structural bed, not an FX pass.** El Paisano's
retrospective on Untrue describes vinyl crackle, hiss and field-recording
washes filling the space around the sparse drum hits. The crackle is a
continuous bed under the whole arrangement, not a one-off intro effect. A
dogsonacid thread on replicating "crackles like Pole/Burial" discusses
practical layering (real vinyl run-out-groove recordings vs. synthesized
crackle generators).

## Executable

Crackle and foley are audio-layer material, not notes, so this is a recipe
instead of MIDI notation. It follows MusicRadar's vinyl-crackle/tape-hiss
tutorial as general technique, not Burial's own session files:

- **Crackle bed**: white noise layer(s), each band-pass filtered to a
  different range, autopanned with independent timing/width, cutoff
  modulated slowly. Or sample a real vinyl run-out groove for a less
  static, more organic character.
- **Sidechain the crackle bed against the drum bus**, ~5dB gain reduction on
  hits, so the crackle rises audibly between hits instead of sitting static.
  This matches El Paisano's description of crackle filling the space between
  sparse hits.

**Drum-rack substitution mapping** (authored from the sourced sound choices,
for `awh drums gen` or manual rack builds targeting this palette): map the
snare pad to a bongo/conga or rimshot one-shot instead of a snare sample.
Keep the GM note assignment (rimshot C#1/37, snare D1/38 as fallback) and
swap the sample, not the pattern role. The skeleton in
`rhythm/burial-2step-skeleton` [sourced] still expects hits at the
rimshot/snare positions; only the one-shot's character changes.
