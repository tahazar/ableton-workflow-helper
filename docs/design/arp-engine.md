# Design: Arp & rhythm engine (M14 — `awh arp`)

- Status: built (2026-08-26), pending owner validation — see docs/dev-loop.md's
  "M14 (arp engine) owner checklist". Owner decision (chat): build on our own
  MIDI generation rather than driving stock devices — a MIDI-effect arp
  produces no notes, so nothing downstream (vary, library, phrases,
  endless pools, seeds, notation) can touch it; the stock Arpeggiator
  stays the JAMMING tool, `awh arp` is the COMMITTING tool. Live 12 MIDI
  Tools are not SDK-addressable; the stock Arpeggiator is raw-only
  (B2's scale lesson makes that path expensive for little gain).
- Third instance of the proven data-driven spec pattern (drums, phrases,
  now arps): built-in specs as constants, new styles as knowledge
  entries `arp-style-<name>` carrying an ```` ```awh-arp-spec ````
  YAML block, typo-rejecting parser, tier printed on use.

## ArpSpec (the pinned schema — seeding agent and engine build to this)

```yaml
name: melodic-techno-16ths
contour: updown          # up|down|updown|downup|converge|diverge|walk|as-voiced
octaves: 2               # 1-4; voicing extended upward by octave copies
rate: 1/16               # 1/4|1/8|1/16|1/32 with t (triplet) / d (dotted) suffixes
gate: 0.8                # 0.05-1.0 fraction of the step
patternLength: 16        # steps before the pattern cycles; ≠ bar length = polymeter
euclid: {k: 16, n: 16, rotate: 0}   # euclidean onset mask over the step grid; k<n thins
rests: []                # explicit step indices (0-based) silenced AFTER the mask
ratchets: {}             # step index -> subdivision count (2/3/4), e.g. {12: 2}
velocity:
  base: 96
  accentSteps: [0, 6, 10]   # pattern positions boosted
  accentBoost: 24
  shape: none              # none|ramp-up|ramp-down across the pattern
swing: 0                 # 0-0.5, even-16th delay fraction (drum-engine convention)
walk:                    # only used when contour: walk
  maxInterval: 2          # max chord-tone steps per move
```

- Semantics pinned: the step grid comes from `rate` over the clip; the
  euclid mask selects which steps sound; `rests` silences after the
  mask; `ratchets` subdivide a sounding step into equal repeats (each
  with the step's velocity, gate divided); `contour` orders pitches
  drawn from the CHORD VOICING extended over `octaves`; `as-voiced`
  cycles the voicing bottom-to-top in its own order; `walk` is a seeded
  bounded random walk over chord tones. Pattern position (mod
  patternLength) drives accents/rests/ratchets — so patternLength 12
  at rate 1/16 in 4/4 is true polymeter and must wrap correctly across
  bars. Chord changes RE-SELECT the pitch pool at the chord boundary
  without resetting pattern position (the pattern rides through the
  progression — the idiomatic behavior).

## Chord sources (both first-class)

1. **A chord clip in Live**: read notes, group simultaneous (start-time
   overlapping) notes into chords with their durations — arpeggiate each
   chord over its own span. Composes with `awh chords` output directly.
   A clip with only single notes = a state ("no chords to arpeggiate —
   this looks like a melody"), not garbage output.
2. **`--prog "i-VI-III-VII" --key <key>`**: run the existing harmony
   engine (parseProgression + voiceProgression, `--voicing close|spread`)
   inline, then arpeggiate the voiced result. One bar per chord default,
   `--bars` stretches.

## CLI

`awh arp <chord-clip | --prog ...> <target>` — `--style <name>`
(built-in first, then `arp-style-<name>` knowledge lookup, tier
printed), `--seed`, `--variant` (listable, drum-engine style), `--rate`
/ `--gate` overrides, `--key`, `--voicing`, `--dry-run` notation
preview. Output meta names style/contour/seed/pattern length; honest
closing line. Occupied/empty-slot conventions per the house rules.

## Shared rhythm utilities (land where they're reusable)

- `euclideanMask(k, n, rotate)` in core, exported — the drum engine can
  adopt it later without re-implementation.
- A `ratchet` transform added to the TRANSFORM REGISTRY (params: steps,
  count, gate) so `awh vary` can ratchet ANY clip — registry conventions
  per transforms/*.ts.

## Verification bar

- Property tests: every emitted pitch ∈ the chord voicing ⊕ octave
  copies; euclidean masks produce exactly k onsets per n steps at every
  rotation; polymeter (patternLength 12, rate 1/16, 2 bars) wraps with
  accent positions landing where hand-computation says; gate never
  exceeds the step (ratcheted steps: subdivision gates never overlap);
  chord boundaries re-select pool without resetting position; same seed
  → byte-identical notes (frozen regressions for built-ins); walk stays
  within maxInterval.
- parseArpSpec typo-rejection; unknown style error names the
  `arp-style-<name>` convention (drums precedent).
- Negative controls: melody-only clip source = state; euclid k=0 = loud
  spec error (a silent arp is never generated wordlessly).
- skill-flows gate; dev-loop owner checklist (audition built-ins + one
  knowledge style on the real set; jam-vs-commit workflow note: stock
  Arpeggiator finding → `awh arp` equivalent committed as a clip).

## Seeding (research agent, parallel)

Three sourced entries in knowledge/ (topic rhythm), each with prose
craft + an executable `awh-arp-spec` block to THIS schema: trance arps
(uplifting 16ths idiom), melodic-techno arps (off-accent 16ths, long
cycles), psy/ratchet arp craft. Honesty rules per knowledge/README
(tiers, real citations, flag what couldn't be sourced).

## Non-goals (v1)

No real-time/played-input mode (that's the stock Arpeggiator's job); no
MPE/per-note modulation; no chord DETECTION from audio; no
auto-inserting a stock Arpeggiator via recipes (raw-scale cost > value).
