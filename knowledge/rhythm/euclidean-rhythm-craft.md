---
slug: euclidean-rhythm-craft
topic: rhythm
tier: sourced
tags: [euclidean, musicology, toussaint, arp, drums, style-spec]
sources:
  - "https://cgm.cs.mcgill.ca/~godfried/publications/banff.pdf"
  - "https://en.wikipedia.org/wiki/Euclidean_rhythm"
  - "https://www.researchgate.net/figure/a-The-Euclidean-rhythm-E3-8-is-the-Cuban-tresillo-b-The-Euclidean-rhythm-E5-8_fig2_237419500"
  - "https://www.lawtonhall.com/blog/euclidean-rhythms-pt1"
related: [rhythm/arp-style-ratchet, rhythm/arp-style-trance-16ths, rhythm/arp-style-melodic-techno, rhythm/drum-style-dusty-garage]
---
# Euclidean rhythm craft: E(k,n) as a musicologically real thinning device

**Sourcing note:** sources were consulted through search excerpts, like
this topic's other entries. Unlike the arp-style entries, the core claim
(that E(k,n) patterns correspond to real, named traditional rhythms) is a
well-corroborated academic citation: Godfried Toussaint's 2005 paper, echoed
across Wikipedia, a McGill-hosted copy of the paper, and independent
tutorial pages. That is why this entry is `tier: sourced` rather than
`draft`; no numbers here are invented from qualitative prose. The mapping
from named E(k,n) rhythms onto the `awh-arp-spec` schema's
`euclid: {k, n, rotate}` field is authored: an application of sourced
musicology to this project's schema, not a sourced fact.

## The rule

### The core claim, and where it comes from

Godfried Toussaint's 2005 paper "The Euclidean Algorithm Generates
Traditional Musical Rhythms" (Proceedings of BRIDGES: Mathematical
Connections in Art, Music and Science, Banff) showed that using the
Euclidean algorithm (the GCD algorithm) to distribute `k` onsets as evenly
as possible across `n` steps reproduces a large family of rhythm timelines
(ostinatos) used in traditional music worldwide, sub-Saharan African music
especially: "the structure of the Euclidean algorithm may be used to
generate... a large family of rhythms used as timelines," with onsets
"distributed as evenly as possible" (paper abstract, corroborated on
Wikipedia's Euclidean rhythm article). This "maximally even" principle is
what the schema's `euclid: {k, n, rotate}` mask implements: `k` onsets
spread over `n` steps.

### Named rhythms: the citable E(k,n) table

The named correspondences found corroborated:

| E(k,n) | Onset pattern | Named rhythm |
|---|---|---|
| E(3,8) | `x..x..x.` | Cuban tresillo |
| E(5,8) | `x.xx.xx.` | Cuban cinquillo |
| E(5,16) | — | Bossa nova (shifted/rotated variant cited as `x..x..x..x..x...`) |
| E(7,12) | `x.xx.x.xx.x.` | Ewe drumming (West African bell pattern, shifted) |
| E(5,12) | — | Soukous |
| E(4,9) | — | Bendir |
| E(3,4) | — | (a common near-swing/dotted feel; see caveat below) |

The tresillo (E(3,8)) and cinquillo (E(5,8)) onset strings trace to a
figure caption comparing the two (researchgate.net, figure from a
Toussaint-adjacent publication: "The Euclidean rhythm E(3,8) is the Cuban
tresillo. The [Euclidean rhythm E(5,8)] is the Cuban cinquillo"). The wider
table (Ewe/Gahu, Soukous, Bendir, Bossa Nova, Račenica) is corroborated by
Wikipedia's Euclidean rhythm article and a production-focused explainer
(lawtonhall.com, "Euclidean Rhythms: Maximum Evenness, Maximum Groove"),
which list overlapping sets of named E(k,n) rhythms and cite Toussaint's
paper for the correspondence. Not every one of the ~40 timelines the paper
is credited with covering was independently verified. E(3,4) is an
authored addition, not found named in a source, and is flagged as such.

### Applying this to the arp schema: what E(k,n) is good for

The schema's `euclid: {k, n, rotate}` mask operates over the step grid (per
the arp-engine design doc's semantics section), selecting which of the `n`
steps sound before `contour`/`ratchets`/accents apply. Three practical
readings for arp and drum work, extrapolated from the "maximally even"
principle (not sourced claims about arp programming):

- **Full density** (`k = n`, e.g. `{k:16, n:16}`): every step sounds, no
  thinning. This is the trance entry's default
  (`rhythm/arp-style-trance-16ths`); an idiom built on continuous 16th
  motion has no use for thinning.
- **Named-rhythm thinning** (`k` set to a documented E(k,n) ratio, e.g.
  `{k:5, n:8}` for a cinquillo-flavored accent skeleton, scaled to
  `{k:10,n:16}` at 16th resolution): a historically grounded way to thin a
  grid when the goal is a specific named cross-rhythm feel.
- **Moderate arbitrary thinning** (`k` a few steps below `n`, e.g.
  `{k:13, n:16}` in `rhythm/arp-style-ratchet`'s executable block): not a
  named rhythm, just thin enough for ratchets and accents to read. This is
  this project's own use of the mechanism, not a Toussaint-sourced choice.

### What this entry does not claim

Toussaint's paper is about traditional acoustic timelines (bell patterns,
claves, hand-drum ostinatos). It makes no claim about trance, melodic
techno or dubstep programming, and no source connects E(k,n) rhythms to
this project's other genre entries. Treating E(k,n) as a principled thinning
choice for the `euclid` field is an authored bridge between sourced
musicology and this schema, useful for choosing `k`/`n` deliberately. It is
not a sourced claim that, say, trance producers consciously reach for
E(5,8).

## Executable

```awh-arp-spec
name: euclid-cinquillo-16ths
contour: up
octaves: 1
rate: 1/16
gate: 0.7
patternLength: 16
euclid: {k: 10, n: 16, rotate: 0}
rests: []
ratchets: {}
velocity:
  base: 95
  accentSteps: [0, 6, 10]
  accentBoost: 20
  shape: none
swing: 0
```

`euclid: {k:10, n:16}` scales the sourced cinquillo ratio (E(5,8) →
`x.xx.xx.`, 5 onsets in 8) to 16th-note resolution as `k=10, n=16` (the
same 5:8 ratio, doubled) instead of reusing the 8-step pattern at 1/8 rate.
This keeps grid resolution comparable to the topic's other entries. It does
not claim E(10,16) is a named traditional rhythm; only E(5,8) is sourced as
one. `accentSteps: [0, 6, 10]` approximates the cinquillo's emphasis shape
(strong on the first hit of each of its two sub-groupings) on the doubled
grid. It is an authored reading, not a sourced accent map.
