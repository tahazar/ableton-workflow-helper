# Design: Break engine (M15 — `awh breaks`: chops, patterns, fills)

- Status: built (2026-08-26), pending owner validation — see docs/dev-loop.md's
  "M15 (break engine) owner checklist" for exact test counts, the smoke
  transcript, and the in-Live validation still outstanding. Owner ask:
  established breaks (amen etc.) as generatable MIDI, plus break CHOPS
  and variations, particularly FILLS.
- Two halves matching how breaks are actually used: (1) canonical break
  PATTERNS as knowledge-carried MIDI played on any kit; (2) chop
  sequencing of a real break SAMPLE — slice map from onset analysis,
  then grammar-driven re-sequencing and fills.

## Half 1 — canonical break patterns (knowledge-carried)

- Knowledge entries `break-pattern-<name>` (amen, think, funky-drummer
  first), topic rhythm: sourced prose (the transcription literature is
  deep and citable) + an executable ```awh-notation``` block of the
  canonical 2-bar pattern on GM drum mapping. `awh drums gen` needs NO
  new machinery to place these — the entries are playable via the
  existing notation path (`awh clip create` from the block / a small
  `awh breaks place <name> <target>` convenience that resolves the entry
  and writes the clip on a kit-aware mapping via mapPadRoles).
- Tier discipline: the amen transcription is genuinely sourced;
  velocity/ghost detail beyond the sources is marked constructed.

## Half 2 — chop engine (the real sample)

### `awh breaks chop <break.wav> [--save <name>]`
- Onset detection (existing detect_onsets) + per-slice band-energy role
  guess (kick/snare/hat/ghost — the drumstats low/mid/high proxy, stored
  WITH confidence and labeled a guess), BPM via the existing estimator
  (confidence carried; --bpm override), grid positions quantized to
  16ths with the offset error reported per slice (a sloppy break is
  MEASURED sloppy, not silently snapped).
- Output: a CHOP MAP record (library/measurements, kind "chopmap"):
  slice index, start/end seconds, grid position, role guess+confidence,
  band energies. `mix records`/kb index must render the new kind.
- `--export <dir>`: additionally cut the slices to individual WAVs
  (pure audio slicing — no Simpler dependency at all), named
  `<nn>-<role>.wav`, plus a README mapping table. This is the
  zero-friction path: drag the slices into a Drum Rack, done.

### Targeting modes (the honest Simpler constraint)
- The SDK cannot configure Simpler slicing (device.insert of Simpler is
  a known failure; slice points are not exposed). Two supported modes,
  stated in output:
  1. **live-slices**: MIDI targets Live's own Slice-to-New-MIDI-Track
     chromatic convention (C1 upward, slice order). The chop map prints
     its slice count so the owner can match Live's transient sensitivity;
     a count mismatch is warned about loudly, never guessed around.
  2. **drum-rack** (default, pairs with --export): MIDI targets the
     standard 16-pad layout (C1..) in slice order — the exported slices
     dropped into a rack line up by construction.

### `awh breaks pattern <target> --map <name> [--style <name>]`
- Grammar-driven re-sequencing of the labeled slices: BreakSpec (fourth
  data-driven spec; `awh-break-spec` blocks in `break-style-<name>`
  entries) — fields for statement fidelity (how much of bar 1 stays
  canonical), turnaround chop density, snare displacement set, ghost
  shuffle probability, allowed substitutions (role-aware: a snare slice
  substitutes a snare slice), seeded + variant-listable. Built-ins:
  `jungle-classic` (state then chop the tail) and `halftime` (sparse
  placement of the same slices).
- Property bar: every emitted note maps to a real slice; role
  substitutions honor roles; statement bars match the canonical grid
  within the map's own measured offsets.

### `awh breaks fill <target> --map <name> [--beats 2]`
- THE owner ask. Fill grammar over the chop map for turnarounds: snare
  rushes via the M14 ratchet mechanics (counts 2-4, placement per the
  seeded ratchet-craft entry), stutter/retrigger cells (same slice
  repeated at 16th/32nd), triplet subdivision cells, tail rearrangement
  (last half-bar re-sequenced dense), and the restraint rule as a spec
  field (maxDevices per fill, default 2 — a fill uses at most N of the
  tricks, sourced restraint). Seeded candidates into consecutive slots
  (drop-respond convention), audition via M12.

## Verification bar

- Python: chop on a synthetic break (constructed kick/snare/hat at known
  positions) → slice count exact, roles correct, grid offsets ~0;
  a sloppy synthetic (shifted hits) → offsets REPORTED not hidden;
  --export cuts byte-lengths matching slice spans; determinism.
- Node: pattern/fill property tests (slice validity, role honoring,
  restraint rule enforced, seeded determinism, frozen regressions for
  built-ins); count-mismatch warning path; zero-slices map = state;
  melody… n/a. skill-flows gate for all new commands.
- Negative control: a chop map with all-low-confidence roles → pattern
  generation WARNS and restricts substitutions to same-slice tricks
  (never confidently swaps roles it isn't sure of).
- Owner checklist: chop a real amen from the sample library end-to-end,
  --export → Drum Rack → pattern + fill audition; the live-slices count
  match check against Live's slicer; fills judged for the restraint rule.

## Seeding (research agent, parallel with the build)

- `break-pattern-amen` (+ think, funky-drummer) — transcription-sourced.
- `break-chop-craft` — jungle/DnB chop grammar sourced (statement vs
  chop, snare rush placement, era idioms), feeding BreakSpec values.

## Non-goals (v1)

No Simpler configuration (not addressable); no audio time-stretching
(slices play at native rate — the owner's sampler handles repitch); no
per-slice reverse (not addressable in the device; a future --export
--with-reversed could render reversed slice FILES); no beat-detection
of full songs (breaks are the scope; `ref` covers songs).
