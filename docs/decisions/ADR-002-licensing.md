# ADR-002: Project license is MIT; copyleft code stays out of the tree

- Status: **Accepted** (owner decision, 2026-08-16)
- Inputs: reuse maps in `docs/spec.md`, license matrix in
  `docs/research/reference-track-analysis.md`

## Context

The owner asked whether licensing the project GPL / open-sourcing it would
relax licensing concerns and speed development. Analysis:

- GPL-licensing the repo would unlock one class of reuse: copying code from
  GPL sources (Producer Pal's notation/transform implementations, Matchering
  and libkeyfinder as linked libraries). The expensive build areas (gateway
  extension, SDK integration, CLI, analysis engine) gain nothing: loophole
  (our main code source) is MIT and the analysis stack is permissive.
  Estimated speedup is modest; agent-assisted clean-room implementation from
  design specs covers the same ground quickly.
- Our license cannot relax third-party restrictions: madmom's CC BY-NC
  model weights, stem-separation weight provenance, the Ableton SDK's
  non-redistributability, and the Producer Pal trademark are unaffected.
  Nearly all flagged concerns trigger only on distribution; private personal
  use was never blocked.
- GPL would create a new problem. Built `.ablx` artifacts bundle Ableton's
  proprietary SDK code, and GPL requires the whole distributed work be GPL,
  so distributing the extension would need a custom linking exception. GPL
  is also irreversible without rewriting derived code. loophole chose MIT
  for the same reasons.
- Community-contribution speedup for a new personal repo is ~zero in the
  near term; open distribution is a later decision with its own homework
  (weight provenance, CC-BY attribution).

## Decision

1. The repository is licensed MIT (LICENSE at repo root).
2. The design-port-not-code-port policy stands for GPL sources (Producer
   Pal): concepts and formats may be re-implemented; code may not be copied.
3. GPL tools (libkeyfinder, Matchering, aubio) are used only as **isolated
   subprocesses**, never linked/imported. AGPL (Essentia) remains excluded.
4. The Ableton SDK is never committed (see .gitignore, ADR-001). MIT imposes
   no copyleft on the bundled `.ablx`, so building/distributing extensions
   stays clean under Ableton's ship-built-artifacts permission.
5. Escape hatch, if clean-rooming a specific GPL subsystem proves too
   painful: isolate that piece as a separate GPL-licensed subprocess tool in
   its own repo/package, keeping this tree MIT.

## Consequences

- All options stay open: permissive open-sourcing, private use, or
  commercialization.
- Distribution readiness still requires (later): stem-model weight
  provenance, CC-BY-4.0 attribution for EDMFormer/SongFormer if used, and a
  check of any models' terms current at that time.
- Contributors must check the license of any code they adapt (human- or
  agent-written). MIT/BSD/ISC/CC-BY sources are fine to adapt with
  attribution; GPL/AGPL/NC sources are not.
