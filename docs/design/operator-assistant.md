# Design: Operator assistant (B2 — recipes + sound matching)

- Status: built, pending owner validation (2026-08-19). Prerequisite
  confirmed in `knowledge/setup/device-parameter-surface.md`: Operator
  exposes 195 fully named params via `device.get`, and `device.param`
  writes are verified to move them. The owner approved both halves: a
  recipe knowledge base and audio-sample → patch reconstruction.
- Science stance (owner Q&A, 2026-08-19): reverse-engineering from a full
  spectrogram is physically well-posed. Two different-sounding sounds cannot
  share one (auditory metamers are a noise-texture phenomenon, not a
  tonal-synth one); only time-averaged spectra are ambiguous (reversed audio
  is the canonical counterexample). The obstacles are (1) FM parameter
  inversion is non-convex and (2) reachability: no method can find a patch
  outside Operator's gamut. The system must detect and say "outside gamut",
  never return a bad patch confidently.

## Half 1 — recipe knowledge base (`awh op` + `operator-recipe-*`)

- Knowledge entries, slug `operator-recipe-<name>`, topic `sound-design`,
  carrying an ```` ```awh-operator-patch ```` YAML block:

  ```yaml
  name: growl-bass          # recipe id
  device: Operator
  params:                   # raw values, exact device.get names
    Algorithm: <raw>        # comment each with the DISPLAY intent
    "Osc-A Coarse": <raw>   # (raw-only SDK — record display meaning inline)
    "Ae Attack": <raw>
    # ...
  playNotes: "1|1 F1 1 v110"   # optional audition phrase (bar|beat notation)
  ```

- `awh op recipes`: list (built-in table of knowledge entries by slug
  prefix, tier shown). `awh op apply <recipe> <devicePath>`: set every
  param via the typed device.param wrapper and verify by reading back. Any
  param name the live device lacks fails loudly before anything is set:
  validate the full name set against device.get first, then write.
  `--dry-run` prints the moves. Optional `--audition` writes playNotes to a
  session clip on the device's track.
- Seeding (research agent): 6-8 sourced recipes from FM-synthesis craft
  literature and Operator-specific tutorials (growl/wobble bass, sub +
  click, FM bell, e-piano/keys, pluck, reese approximation, brass-ish lead,
  hat/perc from noise osc). Raw values are the known gap: sources give
  display values (ratios, dB, ms). Entries record display targets in
  comments and best-effort raw values marked `draft` until verified on the
  real device (the raw↔display observation loop from
  `compressor-raw-display-mapping` applies). Entries with unverified raw
  values must say so.

## Half 2 — sound matching (`awh op match <sample.wav>`)

analysis/awh_analysis/opmatch.py, a deterministic tiered pipeline:

1. **Analyze**: f0 track (librosa pyin, already installed), harmonicity
   ratio (harmonic energy / total), harmonic amplitude vector (first 16
   partials, median over the sustain), amplitude envelope → ADSR fit
   (attack/decay/sustain/release, same grid-fit approach as duck fit),
   spectral-centroid trajectory (brightness rise/fall → filter-envelope
   direction hint), noise floor ratio.
2. **Gate (reachability)**: harmonicity below threshold, unstable f0 (>1
   semitone drift), or strong inharmonic partials → **tier-3 refusal**:
   "outside Operator's reachable set" + the numbers that say so + which
   measured property is the blocker. This is a passing negative-control
   case, not an error.
3. **Propose (tier 1/2)**: JSON patch proposal:
   - waveform selection per oscillator from the harmonic vector (matched
     against Operator's stock wave families' sine/saw/square harmonic
     signatures; residual reported),
   - **drawn-partials caveat**: Operator's user-drawable harmonics are
     believed to be UI-only (not in the 195 params; unverified). The
     proposal always includes a `drawThesePartials` list (16 amplitudes,
     normalized) for the owner to hand-draw in 30 s when the stock-wave
     residual is high. Everything else applies via device.param. If the
     owner's follow-up probe finds partials are addressable, upgrade.
   - envelope raw values from the ADSR fit, filter freq/env from the
     brightness trajectory, and FM amount only for the simple 2-op case
     (level of modulator B driving A) when the spectrum shows dense
     harmonics a stock wave + filter cannot reach. Anything deeper is out
     of scope for v1 (non-convex; revisit only with the closed loop).
4. **Report**: proposal + per-stage confidence + a plain summary line
   ("harmonic pluck, f0 110 Hz, 92% harmonic energy — good Operator
   candidate" / "inharmonic + formant sweep — this is a Serum-shaped
   sound"). `--apply <devicePath>` pushes the addressable subset.
5. **Verify (closed loop, owner machine)**: `awh op verify <ref.wav>
   <devicePath>` writes an audition note into a clip, captures via the M4L
   tap, and reports spectral distance (log-spectrogram L2 +
   harmonic-vector cosine) as a score with the comparison table. Not
   auto-iterated in v1: report, owner tweaks, re-verify
   (measure→adjust→verify, same as mixing).

## CLI shape

`awh op recipes | apply | match | verify`, all following the existing
groups' conventions (zero-items states, --dry-run resolves reads, JSON
mirrors pretty output, plain summary lines).

## Verification bar

- Python: synthetic harmonic stack (known partial amps) → recovered vector
  within tolerance; synthetic ADSR envelope → fitted params close; white
  noise + inharmonic bell → tier-3 refusal (negative control); determinism
  (same file → same proposal).
- Node: fake Operator in FakeLiveBridge (representative param subset, real
  naming style "Osc-A Coarse"/"Ae Attack"). apply validates names first and
  fails loudly on unknowns without partial writes; recipe parsing
  typo-rejects; skill-flows gate for the new commands.
- Owner checklist: real-device apply audition, match on a real bass sample,
  the drawn-partials probe (are user harmonics in the 195?), raw↔display
  observations recorded back into the recipe entries.

## Non-goals (v1)

No automatic FM-parameter search/optimization (non-convex; needs the closed
loop matured first); no Serum targeting (1 exposed param, see
device-parameter-surface); no claim that a proposal is the sound: the score
says how close, ears decide.
