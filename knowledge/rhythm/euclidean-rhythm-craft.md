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

**Sourcing note (this session):** page fetches were mostly blocked; this is
web-search-excerpt research, same constraint as this topic's other new
entries. Unlike the arp-style entries, the CORE claim here — that E(k,n)
patterns correspond to real, named traditional rhythms — is a legitimate,
well-corroborated academic citation (Godfried Toussaint's 2005 paper, echoed
consistently across Wikipedia, a McGill-hosted copy of the paper itself, and
independent tutorial pages), which is why this entry is `tier: sourced`
rather than `draft` — unlike the trance/melodic-techno/ratchet entries,
nothing here is this agent inventing numbers from qualitative prose. What IS
this agent's own work is the mapping from named E(k,n) rhythms onto the
pinned `awh-arp-spec` schema's `euclid: {k, n, rotate}` field — an
application of sourced musicology to this project's schema, not itself a
sourced fact.

## The rule

### The core claim, and where it comes from

Godfried Toussaint's 2005 paper "The Euclidean Algorithm Generates
Traditional Musical Rhythms" (Proceedings of BRIDGES: Mathematical
Connections in Art, Music and Science, Banff) showed that running the
Euclidean algorithm (the one that finds the GCD of two integers) to
distribute `k` onsets as evenly as possible across `n` steps reproduces a
large family of rhythm timelines (ostinatos) actually used in traditional
music worldwide, sub-Saharan African music especially, and world music more
broadly — "the structure of the Euclidean algorithm may be used to
generate... a large family of rhythms used as timelines," with onsets
"distributed as evenly as possible" (paper abstract, corroborated on
Wikipedia's Euclidean rhythm article). This is the "maximally even"
principle the pinned schema's `euclid: {k, n, rotate}` mask implements
directly: `k` onsets spread over `n` steps.

### Named rhythms — the concrete, citable E(k,n) table

The specific named correspondences this session found corroborated:

| E(k,n) | Onset pattern | Named rhythm |
|---|---|---|
| E(3,8) | `x..x..x.` | Cuban tresillo |
| E(5,8) | `x.xx.xx.` | Cuban cinquillo |
| E(5,16) | — | Bossa nova (shifted/rotated variant cited as `x..x..x..x..x...`) |
| E(7,12) | `x.xx.x.xx.x.` | Ewe drumming (West African bell pattern, shifted) |
| E(5,12) | — | Soukous |
| E(4,9) | — | Bendir |
| E(3,4) | — | (a common near-swing/dotted feel; see caveat below) |

The tresillo (E(3,8)) and cinquillo (E(5,8)) patterns and their exact onset
strings trace to a figure caption directly comparing the two
(researchgate.net, figure from a Toussaint-adjacent publication: "The
Euclidean rhythm E(3,8) is the Cuban tresillo. The [Euclidean rhythm
E(5,8)] is the Cuban cinquillo"). The wider table (Ewe/Gahu, Soukous,
Bendir, Bossa Nova, Račenica) is corroborated across Wikipedia's
Euclidean rhythm article and a production-focused explainer
(lawtonhall.com, "Euclidean Rhythms: Maximum Evenness, Maximum Groove")
that both list overlapping sets of named E(k,n) rhythms citing Toussaint's
paper as the source of the correspondence; this session did not
independently verify every single one of the ~40 timelines the paper is
credited with covering, and E(3,4) in particular is this agent's own
plausible-sounding addition to the table rather than one this session
found named in a source — flagged here rather than silently included as
equally sourced.

### Applying this to the pinned arp schema: what E(k,n) is good for

The pinned schema's `euclid: {k, n, rotate}` mask operates over the STEP
GRID (per the arp-engine design doc's semantics section), selecting which
of the `n` steps sound before `contour`/`ratchets`/accents are applied on
top. Three practical readings for arp/drum work, extrapolated from the
sourced "maximally even" principle (not independently sourced claims about
arp programming specifically):

- **Full density** (`k = n`, e.g. `{k:16, n:16}`) — every step sounds; no
  euclidean thinning at all. This is the trance entry's default
  (`rhythm/arp-style-trance-16ths`) — the idiom that wants continuous
  16th-note motion has no use for thinning.
- **Named-rhythm thinning** (`k` set to a documented E(k,n) ratio, e.g.
  `{k:5, n:8}` for a cinquillo-flavored accent skeleton, scaled to
  `{k:10,n:16}` at 16th resolution) — a historically-grounded way to thin
  a grid instead of an arbitrary fraction, when the goal is a specific
  named cross-rhythm feel.
- **Moderate arbitrary thinning** (`k` a few steps below `n`, e.g.
  `{k:13, n:16}`, as used in `rhythm/arp-style-ratchet`'s executable block)
  — not a named traditional rhythm, just "thin enough to leave room for
  ratchets/accents to read," which is this project's own use of the
  mechanism rather than a Toussaint-sourced choice.

### What this entry does not claim

Toussaint's paper is about traditional acoustic timelines (bell patterns,
claves, hand-drum ostinatos) — it is not a claim about trance, melodic
techno, or dubstep arp/drum programming specifically, and nothing sourced
this session connects E(k,n) rhythms directly to any of THIS project's
other genre entries. The connection drawn here (E(k,n) as a principled
thinning choice for the `euclid` field generally) is this agent's own
bridge between sourced musicology and this project's schema, offered as
useful background for choosing `k`/`n` deliberately rather than guessing —
not as a sourced claim that, say, trance producers consciously reach for
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
`x.xx.xx.`, 5 onsets in 8) up to 16th-note resolution as `k=10, n=16` (same
5:8 ratio, doubled) rather than reusing the raw 8-step pattern at 1/8 rate
— a deliberate choice to keep this comparable in grid resolution to the
other entries in this topic, not a claim that E(10,16) is itself a named
traditional rhythm (only E(5,8) is sourced as such). `accentSteps: [0, 6,
10]` approximates the cinquillo's own onset-emphasis shape (strong on the
first hit of each of its two sub-groupings) scaled to the doubled grid —
this agent's own reading of the pattern's shape, not a sourced accent map.
