# Design: 808 bass patterns (M16 — `awh bass 808`)

- Status: built, pending owner validation (2026-08-26 — see
  `docs/dev-loop.md`'s "M16 (808 bass) owner checklist"). Owner ask:
  "common 808 patterns added." Scope read (per the surrounding
  conversation): melodic-rhythmic 808 BASSLINE patterns — long 808s,
  syncopated pickups, slides, triplet flows — not TR-808 drum patterns
  (the trap drum styles cover those).
- The glide connection is the point: patterns are emitted LEGATO by
  default (each sliding note overlaps the next start by a small overlap
  epsilon) so any mono synth with glide — the `operator-recipe-glide-bass`
  entry, an 808 plugin, Serum mono — slides exactly where the pattern
  says. `--slides off` trims to gated notes instead.
- Fifth data-driven spec (drums, phrases, arps, breaks, now 808s):
  built-ins as constants, new styles as `808-style-<name>` knowledge
  entries with an ```` ```awh-808-spec ```` YAML block, typo-rejecting
  parser, tier printed.

## Bass808Spec (pinned schema)

```yaml
name: trap-long
cells:                       # weighted 1-bar cells, drum-engine style
  - name: anchor-hold
    weight: 3
    steps:                   # pos/len in beats within the bar
      - {pos: 0, len: 2.5, degree: 0}            # long root on the 1
      - {pos: 3, len: 1.0, degree: 0, slide: true}   # pickup sliding into next bar
  - name: octave-answer
    weight: 2
    steps:
      - {pos: 0, len: 1.5, degree: 0}
      - {pos: 2, len: 0.75, degree: 12, slide: true}
      - {pos: 3, len: 1.0, degree: 0}
degrees: [0, 12, 7, -2, 10]  # allowed semitone offsets from root (validation set)
register: [24, 36]           # C1-C2 default; root fitted here, degrees relative
slideOverlapBeats: 0.05      # legato overlap applied to slide:true notes
velocity: {base: 110, accentFirst: 12}
turnaroundBar: 4             # every Nth bar draws from turnaround cells if present
turnaroundCells: []          # optional; same shape as cells
swing: 0
```

- Semantics: each bar draws one cell (seeded, weighted; `--variant`
  pins a cell by name, listable). `degree` is semitones relative to the
  key root fitted into `register`; every step degree must be in
  `degrees` (parser-validated). `slide: true` extends the note to
  overlap the NEXT sounding note's start by `slideOverlapBeats`
  (crossing bar boundaries when the next note is in the next bar);
  a slide on a bar's last step with no following note falls back to its
  written length. `--slides off` ignores slide flags (plain gates).
  Notes never overlap unless a slide dictates exactly one overlap pair.
- Data grounding: built-in cell weights informed by the WaivOps HH-TRP
  full-n mining record (n=15,000) — including the honest finding that
  beat-1 anchoring is only ~49% in that corpus, so non-anchor cells are
  not exotic; cite the measurement record in the built-ins' comments.

## Built-ins

- `trap-long` — sparse, long anchors, one slide pickup per 1-2 bars.
- `trap-syncopated` — off-beat doubles, "+"-of-3 placements, more slides.
- `triplet-flow` — 8th-triplet run cells (pos on the triplet grid),
  denser, the modern flow idiom.

## CLI

`awh bass 808 <target> --key <key>` (key required or resolved from the
Set, drum-gen conventions) `--style <name>` (built-in → knowledge
`808-style-<name>`, tier printed), `--seed`, `--variant` (cell name,
listable), `--bars` (default 4), `--slides on|off` (default on),
`--dry-run`. Output meta: style/cell-draws/seed + a line noting the
legato-glide contract ("sliding notes overlap — pair with a mono synth
with glide, e.g. op apply glide-bass"). House conventions throughout
(occupied slots, states, honest close).

## Verification bar

- Property tests: every pitch = root + a degree from `degrees`, inside
  register (root fitted, degrees may exceed register bounds by design —
  pinned: degrees are NOT re-folded, register fits the ROOT only);
  slide notes overlap the next start by exactly slideOverlapBeats and
  ONLY slide notes overlap anything; bar-crossing slide works; last-note
  slide falls back; --slides off produces zero overlaps; turnaround bars
  draw from turnaroundCells when present; same seed → byte-identical
  (frozen regressions for the three built-ins); triplet cells land on
  the triplet grid exactly.
- parse: typo-rejection; a step degree outside `degrees` = loud error;
  empty cells = loud error.
- Negative control: `--slides off` on a slide-heavy style must still be
  musically valid (no zero-length or negative-gap notes).
- skill-flows gate; dev-loop owner checklist (audition all three
  built-ins over the glide-bass recipe; verify slides audibly glide in
  Operator; one knowledge style end-to-end).

## Seeding (research agent, parallel)

- `808-bass-craft.md` (topic rhythm, sourced): trap 808 bassline
  conventions — long-vs-stab placement, where slides idiomatically land,
  key-tracking practice (808 tuned to the song key), triplet-flow
  lineage; cite real tutorials/breakdowns; flag folklore honestly.
- One executable style entry `808-style-<name>` to THIS schema (draft
  values where constructed, per house rules).

## Non-goals (v1)

No pitch-bend/automation-based slides (the legato+glide contract covers
the standard workflow; clip pitch-bend envelopes aren't SDK-writable
anyway); no 808 SOUND design (the glide-bass recipe and sample library
own timbre); no drum-808 patterns (trap drum styles own those).
