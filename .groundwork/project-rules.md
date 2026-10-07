# Project rules

The design review checks every design against these rules. An exception
needs a written justification in the design's "Project rules check".

1. **Reuse before building.** Use or extend existing code before adding a
   new module, helper or abstraction. Research lists what exists.
2. **Simplest design that meets the criteria.** No layer, option or
   extension point that no criterion needs.
3. **Use frameworks and libraries directly.** Do not wrap them unless the
   wrapper removes real duplication.
4. **One representation per concept.** No parallel models of the same data.
5. **Tests come from acceptance criteria.** Every criterion has a test,
   written and reviewed before the code. Tests use real code and fakes of
   process boundaries, not mocks of the unit under test.
6. **Never weaken a check to pass it.** No skipped tests, suppressions,
   loosened assertions or lowered thresholds without a written reason.
7. **Errors are specific.** A failure is never reported as "not found" or
   "empty". A rethrown error keeps its cause.
8. **Sources are tiered.** A decision rests on a Tier 1 source, or a
   Tier 2 source with the gap stated. "Unverified" is an acceptable answer;
   a made-up source is not.

## This repository

These rules are already written down elsewhere; the design review checks a
design against them too.

9. **Definition of done** for a new `awh` command: `docs/lessons-learned.md`
   (a Typical Flows entry in the `awh` skill, a negative-control test, an
   answer for occupied-but-empty targets, typed wrappers for gateway ops
   used from more than one call site).
10. **House rules** in `CONTRIBUTING.md`: built-in generator styles are
    locked (byte-identical output; new behavior ships as knowledge-entry
    data), and a display value (dB, ms, ratio) cites an observed
    raw-to-display pair or says it is unverified.
11. **Boundaries**: only `packages/extension` imports the Ableton SDK
    (ADR-001), and the gateway keeps its loopback bind and Origin check.
12. **Licensing**: no GPL or AGPL dependencies (ADR-002), and nothing
    non-redistributable lands (SDK files, Ableton documentation, third-party
    audio, `.ablx` builds).
13. **Knowledge entries** follow the tiers in `knowledge/README.md`, which
    map onto source tiers: `verified` and `sourced` need Tier 1 evidence or
    a measurement; anything constructed is `draft`.
14. **Tests use fakes, not mocks**: `awh serve-fake` and `fakeLiveBridge`
    for Live, real module code everywhere else (`REVIEW.md`).
