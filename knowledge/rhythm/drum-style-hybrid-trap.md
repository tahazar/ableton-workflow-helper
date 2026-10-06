---
slug: drum-style-hybrid-trap
topic: rhythm
tier: draft
tags: [trap, hybrid-trap, drums, style-spec]
sources: []
related: [docs/design/library-kb.md]
---
# Drum style: hybrid trap

A data-driven drum style: adding a style means writing knowledge, not code.
`awh drums gen <track> --style hybrid-trap` reads the spec below. Edit the
YAML and the next gen reflects it, with no rebuild.

Tier stays `draft` until auditioned and tuned. The cells are a starting
proposal, darker and more dragged than the built-in trap: swung or 16th-run
hats only, fewer rolls, later open hats.

## Executable

```awh-style-spec
name: hybrid-trap
family: trap
snareBeat: 3
clapWithSnare: true
kickCells:
  - name: dragged-boom
    offsets: [0, 1.75, 3.25]
  - name: stutter-tap
    offsets: [0, 0.5, 0.75, 3]
  - name: minimal
    offsets: [0, 3.5]
hatBases: [16th-run, swung-16ths]
rollDensity: 0.7
openHatChance: 0.35
swingDelay: 0.05
```

## The rule

Half-time backbeat on 3 (clap layered), kick figures held per loop like all
trap-family grooves. Compared with the built-in `trap` style, hats never
fall back to straight 8ths (16th-run or swung only), rolls fire at 70% of
normal probability, open hats are rarer (0.35), and swing is slightly
tighter (0.05 beats). Variants: `dragged-boom`, `stutter-tap`, `minimal`;
`--variant <name>` pins one.
