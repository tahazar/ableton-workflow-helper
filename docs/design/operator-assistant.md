# Design: Operator assistant (B2 — recipes + sound matching)

- Status: in build (2026-08-19). Prerequisite CONFIRMED:
  `knowledge/setup/device-parameter-surface.md` — Operator exposes 195
  fully-named params via `device.get`, and `device.param` writes are
  verified to genuinely move them. Owner greenlit both halves: a recipe
  knowledge base and audio-sample → patch reconstruction.
- Science stance (from the owner Q&A, 2026-08-19): reverse-engineering
  from a full SPECTROGRAM is physically well-posed — two
  different-sounding sounds cannot share one (auditory metamers are a
  noise-texture phenomenon, not a tonal-synth one); only time-AVERAGED
  spectra are ambiguous (reversed audio is the canonical counterexample).
  The obstacles are (1) FM parameter inversion being non-convex and
  (2) REACHABILITY — no method can find a patch outside Operator's
  gamut. The system must detect and SAY "outside gamut," never return a
  bad patch confidently.

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

- `awh op recipes` — list (built-in table of knowledge entries by slug
  prefix, tier shown). `awh op apply <recipe> <devicePath>` — set every
  param via the typed device.param wrapper, verify by reading back,
  report any param NAME the live device didn't have (fail loudly before
  setting anything — occupied-but-empty thinking: validate the full name
  set against device.get FIRST, then write). `--dry-run` prints the
  moves. Optional `--audition` writes playNotes to a session clip on the
  device's track.
- Seeding (research agent): 6-8 sourced recipes from FM-synthesis craft
  literature and Operator-specific tutorials (growl/wobble bass, sub +
  click, FM bell, e-piano/keys, pluck, reese approximation, brass-ish
  lead, hat/perc from noise osc). Raw values are the honest gap: sources
  give DISPLAY values (ratios, dB, ms); entries record display targets in
  comments and best-effort raw values marked `draft` until verified on
  the real device (the raw↔display observation loop from
  `compressor-raw-display-mapping` applies). Entries whose raw values are
  unverified MUST say so.

## Half 2 — sound matching (`awh op match <sample.wav>`)

analysis/awh_analysis/opmatch.py — deterministic pipeline, tiered:

1. **Analyze**: f0 track (librosa pyin — already installed), harmonicity
   ratio (harmonic energy / total), harmonic amplitude vector (first 16
   partials, median over the sustain), amplitude envelope → ADSR fit
   (attack/decay/sustain/release, same grid-fit honesty as duck fit),
   spectral-centroid trajectory (brightness rise/fall → filter-envelope
   direction hint), noise floor ratio.
2. **Gate (reachability)**: harmonicity below threshold, f0 unstable
   (>1 semitone drift), or strong inharmonic partials → **tier-3
   refusal**: "outside Operator's reachable set" + the numbers that say
   so + which measured property is the blocker. This is a PASSING
   negative-control case, not an error.
3. **Propose (tier 1/2)**: JSON patch proposal:
   - waveform selection per oscillator from the harmonic vector (match
     against Operator's stock wave families — sine/saw/square harmonic
     signatures; report the residual),
   - **drawn-partials caveat**: Operator's user-drawable harmonics are
     believed UI-only (NOT in the 195 params — unverified). The proposal
     therefore always includes a `drawThesePartials` list (16 amplitudes,
     normalized) for the owner to hand-draw in 30 s when the stock-wave
     residual is high; everything else applies via device.param. If the
     owner's follow-up probe finds partials ARE addressable, upgrade.
   - envelope raw values from the ADSR fit, filter freq/env from the
     brightness trajectory, FM amount only for the simple 2-op case
     (level of modulator B driving A) when the spectrum shows dense
     harmonics a stock wave + filter can't reach — anything deeper is
     out of scope v1 (non-convex; revisit only with the closed loop).
4. **Report**: proposal + per-stage confidence + honest summary line
   ("harmonic pluck, f0 110 Hz, 92% harmonic energy — good Operator
   candidate" / "inharmonic + formant sweep — this is a Serum-shaped
   sound"). `--apply <devicePath>` pushes the addressable subset.
5. **Verify (closed loop, owner machine)**: `awh op verify <ref.wav>
   <devicePath>` — audition note into a clip, capture via the M4L tap,
   spectral distance (log-spectrogram L2 + harmonic-vector cosine)
   reported as a score with the comparison table. NOT auto-iterated in
   v1 — report, owner tweaks, re-verify (measure→adjust→verify, same as
   mixing).

## CLI shape

`awh op recipes | apply | match | verify` — all conventions per the
existing groups (zero-items states, --dry-run resolves reads, JSON
mirrors pretty output, honesty lines).

## Verification bar

- Python: synthetic harmonic stack (known partial amps) → recovered
  vector within tolerance; synthetic ADSR envelope → fitted params close;
  white noise + inharmonic bell → tier-3 refusal (negative control);
  determinism (same file → same proposal).
- Node: fake Operator in FakeLiveBridge (representative param subset,
  real naming style "Osc-A Coarse"/"Ae Attack") — apply validates names
  first and fails loudly on unknowns without partial writes; recipe
  parsing typo-rejects; skill-flows gate for the new commands.
- Owner checklist: real-device apply audition, match on a real bass
  sample, the drawn-partials probe (are user harmonics in the 195?),
  raw↔display observations recorded back into the recipe entries.

## Non-goals (v1)

No automatic FM-parameter search/optimization (non-convex; needs the
closed loop matured first), no Serum targeting (1 exposed param — see
device-parameter-surface), no claim that a proposal IS the sound: the
score says how close, ears decide.
