# Design: Mix advisor (M13 — `awh mix advise`)

- Status: built, pending owner validation (2026-08-24); see "M13 (mix
  advisor) owner checklist" in docs/dev-loop.md. Owner ask, post-public:
  "with this mix report — I want to be able to derive recommendations on
  what to do to improve the mix." The measurement surface exists (report,
  targets, bands/layers/pitch, duck, pump). What is missing is the layer
  that reasons across measurements into a prioritized, verifiable plan.
- Principle unchanged from M6: measurements and named moves, never vibes.
  The advisor is a deterministic rule engine. Every recommendation cites
  the numbers that triggered it, names a concrete Live move, and names the
  exact command that verifies the move worked. The agent narrates and helps
  execute; it never invents a number the engine did not emit. Severity ≠
  priority: priority encodes dependency order (fixing a louder-later
  problem first wastes the pass).

## The dependency ladder (why ordering is the product)

Recommendations are ranked by this fixed stage order. Each stage's problems
can invalidate measurements and moves made in later stages, so acting
bottom-up wastes work. The ordering is standard mix-workflow craft (gain
staging before tone before loudness) made explicit:

1. **Integrity**: true peak at/over ceiling, inter-sample clipping, extreme
   asymmetry. Nothing downstream is trustworthy until headroom exists.
   (The phase-rotation headroom measurement feeds the asymmetry action.)
2. **Phase / mono compatibility**: low-band correlation < 0.8 → kick/bass
   phase alignment or a mono-below-120 Hz move. Tonal-balance deltas
   measured over a phasey low end are unreliable.
3. **Inter-element masking**: only when layer captures exist (`mix layers`
   records). Two layers with comparable energy in the same low/scoop band →
   carve or sidechain advice, citing both layers' per-band dBFS and (when
   pitch records exist) the fundamentals involved.
4. **Tonal balance vs target**: per-band spectrum deltas against the
   owner's measured genre target (never pink noise). |delta| >
   max(3 dB, IQR) → an EQ move naming band center, direction, and a capped
   first-pass amount (min(|delta|, 3) dB: one conservative pass,
   re-measure, repeat; never "apply the full delta"). Tilt off by more than
   ±1.5 dB/oct from target → a broad tilt move instead of per-band
   whack-a-mole. The engine picks one of tilt-vs-bands per run: tilt when
   ≥4 same-signed band deltas align with the tilt error.
5. **Dynamics / pump**: PSR < 8 in loudest sections → limiter input /
   ceiling advice; duck-depth measurements vs the fitted intent when duck
   records exist.
6. **Loudness / delivery**: LUFS-I vs the chosen preset, last, with a note
   that fixing stages 1–5 changes loudness and this stage must be
   re-measured after them.

## Inputs (composable, degrade gracefully)

`awh mix advise <capture.wav | --record <name>>` plus optional:
- `--target <name>`: unlocks stage 4. Without it, stage 4 emits one item
  ("no measured target — run `awh mix target <refs...> --save`"), not
  folklore EQ advice.
- `--layers <name>` (a saved `mix layers`/bands record): unlocks stage 3.
  Absent, stage 3 says what running `mix layers` would unlock.
- `--preset club|streaming|apple`: stage 6 target (default club).
- `--set`: when the gateway is up, read the master chain via device.get and
  name actual devices in actions ("your EQ Eight on master" vs "add an EQ
  Eight"). Purely additive, never required.

## Output (JSON mirrors pretty; `--save` writes an advice record)

Ranked list of items:

```json
{
  "rank": 1, "stage": "phase", "id": "low-band-correlation",
  "evidence": {"low_band_r": 0.62, "threshold": 0.8},
  "issue": "kick and bass are partially cancelling below 120 Hz",
  "action": "Utility on the bass group: Bass Mono at 120 Hz; if the low end thins, nudge kick or bass phase instead (Serum/sampler phase knob or a short nudge)",
  "verify": "awh mix capture --bars 8 -o after.wav && awh mix report after.wav (low-band correlation should read ≥ 0.8)",
  "confidence": "high",
  "blockedBy": []
}
```


- `blockedBy` links downstream items to unresolved upstream ones (stage-4
  EQ advice lists the stage-2 phase item when both fire: "re-measure after
  fixing #1 — these deltas may change").
- Every action names one concrete move (device + parameter + amount where
  measurable); alternatives go in the action text, not as separate items.
  The raw↔display rule carries over: amounts are display-domain ("−2 dB at
  250 Hz"), and the engine never emits raw values for devices without
  recorded mappings.
- A healthy mix yields the state "nothing actionable at these thresholds"
  plus the two most marginal metrics with their margins (zero items is a
  state).
- `--compare <oldAdviceRecord>`: re-run against a new capture and report
  per-item resolution (resolved / improved with numbers / unchanged / new).
  This makes the before/after loop a first-class command.

## Where the rules live

v1: a built-in rule table in `analysis/awh_analysis/advise.py`, one rule per
id, each with (stage, trigger predicate over the measurement dict, evidence
extractor, action template, verify template, confidence). The table is data
within the module; a later M13b can lift it into knowledge entries
(`mix-rule-*`) like drum/phrase styles once the rule shapes stabilize. Every
rule's rationale cites `docs/research/data-driven-mixing.md` or a
measured-target comparison. No folklore thresholds without a source.

## Verification bar

- Python: synthetic fixtures per rule, each a constructed capture that trips
  exactly one rule plus a matching negative control that must not trip it
  (clipped sine → integrity; decorrelated low band → phase; band-boosted
  noise vs a flat target → the capped EQ item; quiet clean mix → the
  healthy-mix state). Dependency ordering: a fixture tripping stages 2 and 4
  must rank phase first and mark the EQ item blockedBy. Tilt-vs-bands
  exclusivity. Determinism (same inputs → same plan).
- Node: CLI arg mapping incl. --record/--target/--layers resolution from
  library/measurements; --set enrichment against the fake gateway (fake
  master chain named in actions); missing-target stage-4 placeholder;
  --compare against a saved advice record; skill-flows gate. The skill
  contract: the agent presents the plan top-down, runs verify commands on
  request, and quotes evidence numbers verbatim. It never adds moves the
  engine did not emit.
- Owner checklist: run advise on the real WIP track's capture with the real
  target + layers records; judge whether the top-3 items match what the
  owner's ears already suspected (the credibility test); do one item,
  re-capture, and confirm --compare shows the resolution.

## Non-goals (v1)

No auto-apply of any advice (the owner or an explicit follow-up command
acts); no per-device raw-value writes without recorded mappings; no
"mastering chain generator"; no ML. The engine is a legible rule table with
cited thresholds; disagreeing with its advice is a reason to edit a rule,
which is the point of owning it.
