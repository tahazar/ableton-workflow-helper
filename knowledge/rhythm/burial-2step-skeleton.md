---
slug: burial-2step-skeleton
topic: rhythm
tier: sourced
tags: [burial, 2step, uk-garage, dubstep, skeleton, kick, snare, rimshot]
sources:
  - "https://www.dogsonacid.com/threads/mj-cole-burial-typish-garage-2step-breaks.596209/"
  - "https://www.dubstepforum.com/forum/viewtopic.php?t=71916"
  - "https://www.attackmagazine.com/technique/beat-dissected/burial-ghost-hardware/"
  - "https://www.musicradar.com/tuition/tech/how-to-make-a-burial-style-beat-221976"
  - "https://songbpm.com/@burial/untrue"
  - "https://getsongbpm.com/album/untrue/M1GMQ"
related: [rhythm/burial-swing-feel, rhythm/burial-velocity-ghost, rhythm/burial-percussion-palette]
---
# Burial 2-step skeleton

Two distinct kick/backbeat grammars turn up across producer breakdowns of
Burial's tracks and Burial-style tutorials — both are cited "skeletons" to
place hits against, not a single canonical pattern.

## Executable

**Skeleton A — classic 2-step (kick + rimshot backbeat).** Kick on beat 1
with a second kick placed between the two backbeat hits; rimshot standing in
for a straight snare (per the dogsonacid MJ Cole/Burial thread — "in place of
a snare, Burial often opts for a rim shot"); a "main" hat placed between kick
and backbeat plus a shuffled hat for the skip feel (per the dubstepforum
drum-sequencing thread and the MusicRadar tutorial's layered
sidestick/rimshot + shuffled hi-hat groove).

```awh-notation
sig 4/4
# ILLUSTRATIVE — constructed from the cited descriptions (dogsonacid MJ
# Cole/Burial thread; dubstepforum drum-sequencing thread; MusicRadar
# "How to make a Burial-style beat" tutorial). NOT a verified transcription
# of any specific Burial track — no source gives exact hit positions.
1|1     C1   1/4  v100   # kick, beat 1
1|2     C#1  1/4  v95    # rimshot standing in for snare
1|2.75  C1   1/4  v80    # second kick, between the two backbeat hits
1|3.5   F#1  1/4  v60    # main hat, off-beat between kick and backbeat
1|4     C#1  1/4  v95    # rimshot, beat 4
1|4.5   F#1  1/4  v55    # shuffled hat, pickup into next bar
```

**Skeleton B — four-to-floor-plus (Ghost Hardware recreation).** Attack
Magazine's "Beat Dissected: Burial – Ghost Hardware" tutorial describes a
simpler kick grammar for that track: four-to-the-floor with an extra kick on
the final eighth of the bar, every hit nudged off the Ableton grid by hand.

```awh-notation
sig 4/4
# Per Attack Magazine "Beat Dissected: Burial - Ghost Hardware" (a
# recreation/tutorial breakdown, not a leaked stem transcription) — cited,
# not own analysis.
1|1    C1  1/4  v100
1|2    C1  1/4  v95
1|3    C1  1/4  v100
1|4    C1  1/4  v95
1|4.5  C1  1/4  v85   # extra kick, final eighth of the bar
```

Apply `rhythm/burial-swing-feel` [sourced] and `rhythm/burial-velocity-ghost`
[sourced] pipelines on top of either skeleton — neither block above carries
timing displacement; that's a separate, deliberately non-grid step per the
cited workflow.

## The rule

Two backbeat hits (2 and 4) framed by a moving second kick is the core of
2-step; Burial's own variant substitutes a rimshot for the snare on most
tracks (dogsonacid, MJ Cole/Burial typish garage/2step breaks thread) and
layers a shuffled hat against a steadier "main" hat (dubstepforum drum-
sequencing thread; MusicRadar tutorial). The Ghost Hardware-style four-to-
floor-plus kick (Attack Magazine) is a second, house-adjacent kick grammar
used elsewhere in the catalogue — treat the two skeletons as alternative
starting cells, not a single rule, when generating a Burial-flavoured pattern.
Context: Untrue-era tracks generally sit ~130-140bpm (album average ~133bpm
per songbpm.com/getsongbpm aggregate data), consistent with the half-time UK
dubstep tempo range.
