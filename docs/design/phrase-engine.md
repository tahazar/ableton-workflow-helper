# Design: Phrase engine (M9 — drop writing, call & response)

- Status: built (pending owner validation) (2026-08-18). Craft basis (READ THESE — they are the
  spec's ground truth): `knowledge/arrangement/call-response-drop-grammar`,
  `call-response-rest-placement`, `drop-phrase-evolution`,
  `lyny-drop-structure` (the last is a stub — flavor only, per its own
  coverage note).
- Owner's stated pain point: writing dubstep drops — phrases and patterns,
  particularly call-and-response. The engine answers the owner's material
  (or generates a skeleton); it never pretends taste. Every output names
  the recipe and seed that produced it so candidates are reproducible and
  auditioning stays the arbiter.

## Principles (from the knowledge entries)

1. **A pair, not a stack.** Two voices trade phrases: a bright/high CALL
   and a low RESPONSE (growl/stab). Contrast is carried by register +
   intensity; the response must relate to the call (same rhythm answered,
   contour inverted, truncated to a stab) — never an unrelated riff.
2. **The rest is the question mark.** The response enters a gap AFTER the
   call ends (half-bar to a bar); each voice leaves its bar tail empty.
   A rest budget is enforced, not hoped for.
3. **Answers resolve.** The response's last pitch lands on a stable scale
   degree (tonic/fifth) in the low register — the "answer" gesture.
4. **Evolve one side at a time.** Across 16 bars: state the pair verbatim
   twice (bars 1–4), then vary the CALL only while the response anchors,
   then a harder variation pass, with a reset cue (dropped element /
   extra space) in the last bar of each 8 — timed to phrase boundaries.

## PhraseSpec (data-driven, like DrumStyleSpec)

Styles are data. Built-ins ship as exported constants; new styles live in
knowledge entries with slug `phrase-style-<name>` containing an
```` ```awh-phrase-spec ```` YAML block, parsed by `parsePhraseSpec`
(typo-rejecting, exact same conventions as `parseDrumStyleSpec`). The CLI
resolves `--style <name>`: built-in first, then knowledge lookup, printing
the entry's tier when a knowledge style is used.

```yaml
name: bass-music-cr          # built-in default
family: call-response        # only family for now; field reserved
phraseBars: 8                # one phrase unit; drop = 1-2+ units
cellBars: 2                  # call bar(s) then response bar(s) per cell
callRegister: [67, 81]       # MIDI range the call is fitted into (G4-A5)
responseRegister: [24, 43]   # C1-G2 — low, dominant
callCells:                   # onset-grid templates for the call, weighted
  - {name: ask-2, beats: [0, 1.0], lengths: [0.5, 1.0], weight: 3}
  - {name: ask-3, beats: [0, 0.75, 1.5], lengths: [0.5, 0.25, 1.0], weight: 2}
  - {name: one-stab, beats: [0], lengths: [0.5], weight: 1}
restMinBeats: 1.0            # min silence at each voice's cell tail
responseDelayBeats: [2.0, 4.0]  # gap between call end and response entry
responseRecipes: [echo-low, truncate-stab, invert-answer, displaced-echo, sparse-answer]
resolveDegrees: [0, 7]       # semitone-above-root set the response may end on
evolution:                   # per-8-bar plan; actions are a closed enum
  - {bars: [1, 4], action: state}
  - {bars: [5, 8], action: vary-call}
turnaround: drop-response    # last bar of each 8: drop-response | extra-rest | none
```

## Response recipes (core, deterministic)

Implemented in `packages/core/src/phrase/` on top of the existing
transform registry where possible (invert, thin, rotate, octave,
transpose-scale…). Each takes (callNotes, key/scale, spec, rng) → notes
in the response register, entering after `responseDelayBeats`, ending on
a `resolveDegrees` pitch, leaving `restMinBeats` of tail:

| Recipe | Gesture |
|---|---|
| `echo-low` | same rhythm (optionally thinned), re-pitched low, resolves |
| `truncate-stab` | first 1–2 onsets only, lengthened into stabs, big rest |
| `invert-answer` | contour inverted, register-shifted, resolved ending |
| `displaced-echo` | rhythm rotated onto complementary beats (hocketing); first hit lands ON the beat (kick alignment) |
| `sparse-answer` | thinned + slowed (half-time feel), 1–2 long low notes |

## CLI (`awh drop` group)

- **`awh drop respond <call-clip> <target>`** — THE core feature. Reads
  the owner's call clip from Live, emits N candidate responses (default
  one per recipe) into consecutive session slots on the target track,
  each clip named `resp <recipe> s<seed>`. `--recipe`, `--seed`,
  `--count`, `--key` (else resolved from the Set / `--key` conventions
  used elsewhere), `--style`, `--dry-run` (notation preview). Zero notes
  in the call clip = state, exit 0, nothing written.
- **`awh drop phrase <call-target> <response-target>`** — cold-start
  8/16-bar skeleton from a spec: generates a call from `callCells`
  (seeded, variant-listable like drums), derives the response, applies
  the evolution plan and turnaround, writes PAIRED clips of equal length
  (each voice silent during the other's bars — the conversation is the
  arrangement). Single-target form `awh drop phrase <target>` puts both
  voices in one clip (register-split). `--bars 8|16`, `--style`,
  `--seed`, `--variant`, `--key`, `--dry-run`.
- Honest output: recipe/cell names, seed, spec source + tier, and a
  closing reminder that candidates are starting points to audition.

## Not in this milestone (planned)

- `awh ref phrases` — phrase-grain analysis of a reference drop (bar-level
  onset density / rest map / call-response alternation with confidence),
  sharing B1's transcription and `detect-onsets` plumbing. Build after
  B1 is owner-validated.
- Timbre/sound-design of the two voices — out of scope; this engine
  writes notes. The owner picks the growl and the chop.

## Verification bar

- Frozen-notes regression tests for built-in spec output (seeded).
- Property tests: rest budget honored; response never overlaps the call
  region; response ends on an allowed resolve degree; two-voice clips are
  equal length; evolution changes exactly the side it claims to change.
- Negative control: a call that already fills its cell (no room for the
  rest budget) must produce a WARNING and a legally-rested response, not
  silent overlap.
- skill-flows gate: Typical Flows entries for both commands.
