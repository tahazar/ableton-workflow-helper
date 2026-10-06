---
slug: drum-style-dusty-garage
topic: rhythm
tier: draft
tags: [house, garage, drums, style-spec]
sources: []
related: [rhythm/burial-2step-skeleton, rhythm/burial-swing-feel]
---
# Drum style: dusty garage

A house-family data style (the four-on-the-floor engine that house and
techno share), leaning garage: clap-only backbeat, sparse chance-based open
hats, offbeat closed hats at low density that flip to swung 16ths, shaker
ghosts, late rumble kicks. Draft until auditioned. Edit the YAML and re-gen;
no rebuild needed. Pairs with the sourced Burial entries for swing and
palette context.

## Executable

```awh-style-spec
name: dusty-garage
family: house
kickBeats: four-floor
backbeat: [clap]
backbeatMinDensity: 0.2
openHatOffbeats: 0.45
hatGrid:
  low: offbeat-8ths
  high: 16ths
  threshold: 0.55
ride:
  minDensity: 0.65
ghostRoles: [shaker]
ghostChance: 0.7
rumbleKicks:
  minDensity: 0.5
  probability: 0.35
swingDelay: 0.05
```

## The rule

The four-floor kick is fixed; the top end carries the garage feel:
swingDelay 0.05 on off-16ths at density >= 0.55, clap (no snare) backbeat,
open hats by chance (0.45) instead of every offbeat, shaker ghosts scaled to
0.7. Compare `--density 0.4` with `0.7`: the hat-grid flip is the character
change.
