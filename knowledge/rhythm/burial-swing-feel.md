---
slug: burial-swing-feel
topic: rhythm
tier: sourced
tags: [burial, swing, timing, humanize, off-grid, sound-forge]
sources:
  - "https://www.thewire.co.uk/in-writing/interviews/burial_unedited-transcript"
  - "https://www.musicradar.com/artists/burial-repub"
  - "https://www.dubstepforum.com/forum/viewtopic.php?t=71916"
  - "https://forum.ableton.com/viewtopic.php?t=89680&start=30"
  - "https://reader.exacteditions.com/issues/3131/page/28"
related: [rhythm/burial-2step-skeleton, rhythm/burial-velocity-ghost, rhythm/burial-percussion-palette]
---
# Burial's swing/timing feel: by-ear, not swing-quantized

## The rule

Burial has said he builds his tracks in Sound Forge — an audio waveform
editor, not a sequencer with a piano-roll grid — and places drum samples one
at a time by eye/ear against the waveform, with no quantize step (Wire
unedited transcript; corroborated in MusicRadar's "rubbish, dying computer"
retrospective and a dubstepforum thread on his sequencing setup). He's quoted
describing the resulting look of a finished drum edit: "I know when I'm happy
with my drums because they look like a nice fishbone" (via MusicRadar's
retrospective, drawing on the Wire interview), and on avoiding a locked grid
even in the echoes: "I'm not that into tunes that are so sequenced that all
you can hear is the perfect grid, even on the echoes." A dubstepforum thread
on his drum-sequencing approach summarizes the mechanism plainly: multi-
tracking audio files over each other in Sound Forge with no quantize "is what
gives his tracks that swing." Mark Fisher, writing in The Wire (Dec 2007,
issue 286), characterized the resulting drum pattern as sounding "more like
the klak-klak of a graffiti-splashed ghost train idling in sidings than
rhythmic" — i.e. critics hear the off-grid placement as a departure from
metronomic dance-music rhythm, not a rhythmic defect.

**Implication for reproducing the feel**: this is NOT swing-as-a-percentage
applied to a grid. It's manual placement per-hit against a waveform, so no
swing amount is "the" Burial number — any swing/humanize setting below is an
approximation for a sequencer-based workflow, not a sourced measurement of
his actual displacement.

## Executable

Approximate pipeline (own approximation of the cited by-ear workflow, applied
on top of a skeleton from `rhythm/burial-2step-skeleton` [sourced]):

- pipeline: `swing:grid=0.25,amount=0.5 humanize:timing=0.035,velocity=12`

Rationale for the numbers: `swing:grid=0.25` (16th-note grid) with a
moderate `amount` gets the alternating-hat lean that critics/tutorials
describe as "shuffled," but the wider `humanize:timing` term does more of
the work — it's the closer analogue to genuinely non-grid, per-hit placement
than any fixed swing ratio, since Burial's actual method has no swing grid to
measure against. Push `humanize:timing` higher (0.05-0.06) and drop
`swing:amount` toward 0 for a more "unquantized waveform edit" feel; keep
`swing` if the goal is a more conventional shuffled-garage read rather than
Burial's specific loose, by-ear character.
