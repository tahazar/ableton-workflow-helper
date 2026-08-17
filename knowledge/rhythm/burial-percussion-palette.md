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

**Drum sound sourcing.** Burial doesn't use conventional drum-machine
kick/snare sounds. Per the dogsonacid MJ Cole/Burial thread: he "doesn't use
snares for snares," favouring bongo and conga sounds in the snare role, and
"in place of a snare, Burial often opts for a rim shot" in most tracks
(consistent with the rimshot-backbeat skeleton in
`rhythm/burial-2step-skeleton` [sourced]). Kicks and hits are pulled from
non-drum sources: the kick on "Archangel" is reported as a door-knock sample
from a video game (dogsonacid thread; corroborated by WhoSampled's sample
listing for the track, which also documents a Metal Gear Solid orchestral
cue used elsewhere in the same track). More broadly, beatproduction.net's
breakdown of the Untrue samples describes Burial reaching for "metallic
Foley-style sounds taken from films and videogames," plus recorded sounds of
matches and lighters, as percussion/texture source material rather than
synthesized or drum-machine hits.

**Vinyl crackle as a structural bed, not an FX pass.** El Paisano's
retrospective on Untrue's sound describes vinyl crackle, hiss and field-
recording washes as filling the empty space around the sparse drum hits —
i.e. the crackle functions as a continuous bed under the whole arrangement,
not a one-off intro effect. A dogsonacid thread on replicating "crackles
like Pole/Burial" discusses practical layering (real vinyl run-out-groove
recordings vs. synthesized crackle generators) for that texture.

## Executable

Not expressible as MIDI notation (crackle/foley are audio-layer, not
note-based) — recipe-style parameters instead, from the cited techniques
(MusicRadar's vinyl-crackle/tape-hiss tutorial, applied as general technique
guidance, not sourced to Burial's own session files):

- **Crackle bed**: white noise layer(s), band-pass filtered to different
  frequency ranges per layer, autopanned with independent timing/width,
  cutoff modulated slowly — OR sample a real vinyl run-out groove for less
  static/more organic character.
- **Sidechain the crackle bed against the drum bus**, ~5dB gain reduction on
  hits, so the crackle "jumps up" audibly between hits rather than sitting
  static underneath — matches El Paisano's description of the crackle
  filling space between sparse hits rather than being permanently buried.

**Drum-rack substitution mapping** (own construction from the sourced
sound-choices above, for `awh drums gen`/manual rack builds targeting this
palette): map the snare pad to a bongo/conga or rimshot one-shot instead of a
straight snare sample; keep the GM note assignment (rimshot C#1/37, snare
D1/38 as fallback) but swap the SAMPLE, not the pattern role — the skeleton
in `rhythm/burial-2step-skeleton` [sourced] still expects a hit at the
rimshot/snare note positions, only the underlying one-shot changes character.
