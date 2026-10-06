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

Burial has said he builds tracks in Sound Forge, an audio waveform editor
with no piano-roll grid, placing drum samples one at a time by eye and ear
against the waveform, with no quantize step (Wire unedited transcript;
corroborated in MusicRadar's "rubbish, dying computer" retrospective and a
dubstepforum thread on his sequencing setup). On a finished drum edit: "I
know when I'm happy with my drums because they look like a nice fishbone"
(via MusicRadar's retrospective, drawing on the Wire interview). On avoiding
a locked grid: "I'm not that into tunes that are so sequenced that all you
can hear is the perfect grid, even on the echoes." The dubstepforum thread
states the mechanism: multi-tracking audio files over each other in Sound
Forge with no quantize "is what gives his tracks that swing." Mark Fisher,
in The Wire (Dec 2007, issue 286), described the drum pattern as sounding
"more like the klak-klak of a graffiti-splashed ghost train idling in
sidings than rhythmic". Critics hear the off-grid placement as a departure
from metronomic dance rhythm, not a defect.

**Implication for reproducing the feel**: this is not swing-as-a-percentage
on a grid. It is per-hit manual placement against a waveform, so there is no
single Burial swing number. The settings below approximate it for a
sequencer workflow; they are not a measurement of his displacement.

## Executable

Approximate pipeline (an authored approximation of the cited by-ear
workflow), applied on top of a skeleton from `rhythm/burial-2step-skeleton`
[sourced]:

- pipeline: `swing:grid=0.25,amount=0.5 humanize:timing=0.035,velocity=12`

Rationale: `swing:grid=0.25` (16th-note grid) with a moderate `amount`
gives the alternating-hat lean critics and tutorials call "shuffled". The
wider `humanize:timing` term does more of the work, since per-hit jitter is
closer to non-grid placement than any fixed swing ratio, and Burial's method
has no swing grid to measure against. For a more "unquantized waveform edit"
feel, push `humanize:timing` to 0.05-0.06 and drop `swing:amount` toward 0.
Keep `swing` for a conventional shuffled-garage read instead of Burial's
loose, by-ear character.
