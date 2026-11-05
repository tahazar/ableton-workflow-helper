# Research: Song to Live Set recreation (inverse rendering) — Nov 2026

- Status: draft for owner discussion, 2026-11-05. A research note, not a
  spec. It frames the problem, separates what is science from what is
  engineering, proposes the experiments ("proofs") that have to pass
  before a product is designed, and lists the questions only the owner can
  answer (section 9).
- Objective as stated by the owner: an automated workflow whose input is a
  finished song and whose output is that song recreated, identically, as
  a Live project. Owner's decomposition: break the song apart, analyze the
  tracks, classify each sound, classify the effects, programmatic mastery
  of Live's devices and sounds, programmatic access to build the Set, and
  matching plus validation of recreated sounds against the original.
- Relation to `docs/spec.md` (v1): v1 lists audio synthesis, VST preset
  management and automation editing as anti-goals. This objective reverses
  two of them, so it is a v2 vision that needs its own decision record
  once the questions in section 9 are answered. Everything below reuses
  the v1 stack where it can; section 3 says what exists today.

## 1. The problem, stated precisely

Let `R` be Live's render function: it maps a project `P` (tracks, clips,
notes, devices with parameters, routing, mixer, automation, tempo map,
arrangement) to stereo audio `R(P)`. Given a target song `x`, the task is

    find P in P_available  minimizing  d(R(P), x)  (+ a simplicity prior)

where `d` is a perceptual distance and `P_available` is the set of
projects buildable with the devices, samples and plugins at hand. This is
analysis-by-synthesis (the "inverse graphics" of audio). Three facts about
`R` decide what is achievable and how to measure it.

**F1. `R` is many-to-one, so "the project the producer used" is not
recoverable, only "a project that renders within tolerance".** A sine
from Operator, Analog, Wavetable, Drift or a sampled sine in Simpler
render the same audio. The owner's earlier stance (`docs/design/
operator-assistant.md`: reverse engineering from a full spectrogram is
physically well-posed) holds for one tonal source inside one synth's
gamut, up to that synth's own symmetries. It does not extend across
devices, and it does not survive mixing. Consequence: acceptance is
judged on rendered audio, never on parameter equality, except in
synthetic tests where the ground-truth project is ours.

**F2. Information is destroyed twice before we see the song: in the sum
(sources overlap in time and frequency; masking) and in nonlinear
processing (compression, saturation, limiting, lossy codecs).**
Separation only estimates the sources, and its error flows into every
later stage. For sounds that cannot be looked up in a library, the
separation error is the floor of the whole pipeline, not the sound
matcher's error.

**F3. Some content is outside `P_available` by construction:** recorded
performances (vocals, played instruments, field recordings), samples that
are not in any library we can index, third-party plugins the SDK cannot
address (Serum 2 exposes one parameter, see
`knowledge/setup/device-parameter-surface.md`), hardware, and mastering
chains. For that content, "recreation" means placing the separated stem
as audio, unless a policy allows synthesis of a replacement, which for
vocals means voice cloning and is a legal and ethical decision, not a
technical one.

### 1.1 "Identical" needs an operational definition: the fidelity ladder

| Rung | Output | What "identical" means here | Ground truth for the metric |
|---|---|---|---|
| L0 Transplant | separated stems as audio clips, tempo/grid aligned, section markers | the Set plays back the song (bounded by separation error) | the song itself |
| L1 Notes and sources | MIDI per part; sounds are retrieved samples, one-shots resampled from the song, or audio where neither applies | note-level and timbral match per part | separated stems; synthetic sets |
| L2 Sound design | native-device patches for synthesized parts; layers recovered | each synthesized part is perceptually matched | synthetic sets; ABX on real songs |
| L3 Processing | per-track effect chains, mixer, sends, master chain | the rendered mix matches the song | mix-level distances; ABX |
| L4 Motion | automation and modulation over time; transitions, risers | the arrangement moves like the song | synthetic sets; ABX |

The ceiling is L4 with perceptual indistinguishability (an ABX test a
producer fails) for songs made in the box from native devices and
indexable samples. For other songs the ceiling is lower and known in
advance from the content class in F3. Every stage reports which rung it
reached and why it stopped, in the repository's negative-control style
(`opmatch.py` refuses with the measurement that shows the sound is
outside Operator's gamut; the same contract applies everywhere here).

### 1.2 Metrics, by rung

- Mix and stem level (real songs): multi-resolution STFT distance and
  log-mel distance (the losses the sound-matching literature optimizes),
  integrated and short-term loudness, PSR, stereo correlation and the
  third-octave profile (all already in `awh_analysis`), embedding cosine
  (CLAP, already in `clapembed.py`), and SI-SDR of a rendered part
  against its separated stem (bounded by separation error, so reported
  with that bound). The arbiter is an ABX listening test; metrics are
  proxies whose correlation with ABX is itself measured (proof P9).
- Symbolic level (synthetic sets only): note F1 with and without offsets
  (`mir_eval`, already a dependency), velocity error, device identity,
  effect-type set accuracy, normalized parameter error, gain and pan
  error in dB, automation curve error.
- Scores are reported per track and per section, so a failure is
  localized ("bass in the second drop") instead of one number.

## 2. The owner's decomposition, and what it leaves out

The six listed capabilities are necessary. The following are missing or
underspecified, each with why it matters.

| Missing piece | Why it matters |
|---|---|
| Rhythm grid, tempo map, groove and quantization policy | Everything downstream is placed on a grid. Constant-tempo 4/4 is the tractable case (`ref.py` assumes it); variable tempo and swing need a tempo map and a groove extraction step, or notes land off-grid and sound wrong. |
| Transcription (notes, timing, velocity, pitch bend, slides) | Distinct from "classify each sound". A classified sound without notes is a preset, not a part. Velocity and expression are the hard half. |
| Sample identification as a strategy separate from synthesis | Most drums, vocal chops and many textures are samples. Looking the sample up (exact fingerprint or embedding retrieval over indexed libraries) beats re-synthesis whenever it hits, and "not in any library" must be detected (open-set). |
| Resampling as the universal fallback | A one-shot cut from the separated stem into Simpler reproduces the sound by construction. It does not generalize to sustained, modulated or polyphonic material, but it guarantees L1 for drums. |
| Layer decomposition | One perceived sound is often two to five layered tracks (sub + mid bass, kick top + sub). Separation models have no "layer" class; recovering layers is open research. |
| The dry/wet circularity | Estimating an effect chain needs the dry signal; estimating the dry signal needs the effect. Jointly solvable only with priors (known device models) and a render loop. |
| Mix and master as a global stage | "FX used" is per track. Gain staging, panning, bus compression, sidechain pumping, stereo width and the limiter are global, interact, and are the first thing an ABX test hears. |
| Routing | Sends/returns, groups, sidechain inputs. The SDK has no routing API (`docs/sdk-feedback.md` #3), so this is also an assembly problem. |
| Automation and modulation over time | Filter sweeps, volume rides, LFO motion, risers. Time-varying estimation is harder than static, and the SDK cannot write automation (#4). |
| A definition of "identical" with a tolerance | Section 1.1. Without it nothing can pass or fail. |
| Ground truth and data | Public datasets do not contain Live projects. The renderer is ours, so we can make unlimited exact ground truth (section 4); this is the project's main scientific lever. |
| Human-in-the-loop correction | The owner's stated preference is manual over hallucinated. Each stage should produce a draft the owner corrects in Live, and read corrections back (the `awh ref sections` pattern). |
| Third-party plugin boundary | A Serum patch cannot be written through the SDK today. Either the vocabulary is native devices plus samples, or preset files for specific plugins become their own subproject. |
| Compute topology | Live is not headless and runs one instance per machine; post-FX capture runs in real time through the M4L tap. The render loop's throughput is a first-order design constraint (section 4). |
| Legal and ethical posture | Recreating a song for study is ordinary; distributing stems or recreations of copyrighted songs is derivative-work territory; voice cloning of a real singer is its own category. Model-weight licenses already constrain distribution (ADR-002). |
| Evaluation with listeners | Metrics are proxies. A small ABX protocol with producers is the only arbiter of "identical". |

## 3. State of the art per stage, and what the repository already has

<!-- SURVEY: filled from the four literature and codebase surveys -->

## 4. The main lever: the renderer as a data factory

Every stage above needs data that does not exist publicly: audio paired
with the Live project that produced it. We own the renderer, so we can
draw projects from a prior and render them:

1. Draw a project: the repository's generators already produce idiomatic
   material (`awh drums`, `awh drop`, `awh chords`, Operator recipes,
   style specs in `knowledge/`). Add random but plausible device
   parameters, effect chains, mixer settings and automation.
2. Build it in Live through the gateway, render through the M4L tap
   (post-FX, the real signal path) or `track.render-prefx` where pre-FX
   audio is enough.
3. Record the exact ground truth: stems, MIDI, every raw parameter, the
   chain, the mixer, the automation.

This yields training data for the inverse models (parameter predictors
for native devices, effect-type and parameter estimators, mix
estimators), exact evaluation for the whole pipeline (section 6), and
calibration of pretrained separation and transcription models on
electronic material. Two consequences:

- Throughput bounds the design. The tap captures in real time, so one
  machine yields at most 24 hours of audio per day: about 20,000
  four-second sound-matching examples per day, and the literature trains
  on 10^5 to 10^6. Feasible for one device over a week; slow for many.
  Mitigation: a Python surrogate of each native device (Operator is a
  four-operator FM synth with documented algorithms; Analog and Drift
  are subtractive) for the inner optimization loop, with Live as the
  verifier. Surrogate fidelity is then a measured quantity (proof P1),
  never an assumption. `track.render-prefx` speed is unmeasured and may
  be faster than real time for audio tracks (proof P0 measures it).
- Raw parameters are enough. The SDK exposes raw values only (sdk-
  feedback #2); inside a render loop the raw-to-display mapping is not
  needed, which removes a blocker that stalled `op match` proposals.

## 5. Where machine learning is required, and where it is not

| Stage | Method class | ML required? | Note |
|---|---|---|---|
| Tempo, beats, downbeats, key, sections | DSP with ML upgrade | no for 4/4 electronic (shipped in `ref.py`); yes for robustness and variable tempo | Beat This! already chosen for license reasons |
| Source separation | deep models | yes, no alternative | pretrained; fine-tuning on renderer data is optional |
| Transcription | deep models (Basic Pitch shipped) plus DSP for monophonic | yes for polyphony and drums | velocity needs its own estimator |
| Sound classification | embeddings and classifiers | yes | CLAP already shipped; a small classifier on renderer data for device families |
| Sample identification | fingerprinting plus embedding retrieval | no (hashing) plus embeddings for near matches | open-set threshold must be calibrated |
| Synth parameter estimation | neural initializer plus black-box optimization | hybrid: a predictor trained on renderer data, refined by CMA-ES against the surrogate, verified in Live | `opmatch.py` is the deterministic baseline |
| Effect-type recognition | classifiers on wet audio | yes | trained on renderer data for native devices |
| Effect parameter estimation | differentiable proxies plus optimization | hybrid | the dry/wet circularity needs the render loop |
| Mix inference | differentiable mixing plus measurement | hybrid, mostly optimization | extends `mix duck calibrate`'s closed loop |
| Automation | frame-wise regression plus smoothing | hybrid | assembly blocked by SDK #4 |
| Assembly in Live | gateway plus `.als` generation | no | section 3 lists the SDK gaps |
| Validation | DSP metrics, embeddings, ABX | no (metrics), yes (embeddings) | |

Large language models are not on the critical path. They help with
orchestration, with mapping classification outputs onto device choices
using the knowledge base, with explaining results and with resolving
ambiguity interactively, as the `awh` skill does today. Generative audio
models (full-track generation) do not help recreate a specific song and
stay an anti-goal.

## 6. Proof plan

Each proof is a falsifiable experiment with a number, run first on
renderer-generated sets where the answer is known exactly, then on real
songs where only perception can judge. Each writes a measurement record
under `library/` in the existing format. Order is by risk and dependency;
P0 to P2 build directly on the Operator assistant and the capture loop,
so they are the cheapest place to start.

| # | Question | Method | Metric and pass line | What failure means |
|---|---|---|---|---|
| P0 Render loop | Is the build-render-compare loop reproducible and how fast is it? | Build a fixed project through the gateway; capture twice through the tap; render pre-FX through the SDK; time every step | Two captures differ by less than the measurement noise floor (number recorded); seconds per render recorded; `track.render-prefx` speed vs real time | The loop needs surrogates for everything inside the optimization, Live only as verifier |
| P0b `.als` writer | Can a generated `.als` carry what the SDK cannot (automation, routing, presets) and open in Live? | Extend the `.alc` XML code in `packages/core/src/alc/` to a minimal Set; open in Live; read back through the gateway | Opens without repair; read-back equals what was written | Assembly stays SDK-bound; L3/L4 need manual steps |
| P1 Surrogate fidelity | Does a Python Operator render match Live's? | 500 random patches rendered both ways | Multi-resolution STFT distance below the P0 noise floor for 90% of patches; failures classified by feature (e.g. feedback, drawn partials) | Inner loop runs on Live at real time; budget and scope shrink |
| P2 Sound matching | Given a Live-rendered Operator sound, can we recover a patch that renders the same? | Predictor trained on surrogate renders, CMA-ES refinement, verification render in Live; `opmatch.py` as baseline | Median log-mel distance to the target under a threshold set from P0; share of patches under the ABX-calibrated threshold (P9) | Non-convexity dominates; restrict to sub-gamuts (bass, pluck, keys) |
| P3 Sample retrieval | Can a processed sample be identified in an indexed library, and can "not in library" be detected? | Index Core Library and the owner's library (`samplescan`, CLAP); queries are samples after random pitch shift, EQ, compression, reverb and layering | Top-1 and top-5 accuracy per processing class; open-set false-accept rate at a fixed threshold | Retrieval limited to unprocessed one-shots; resampling fallback carries L1 |
| P4 Separation floor | How good is separation on electronic material, and does the "other" stem split into layers? | Renderer-generated songs with exact stems; candidate models | SDR per stem; drum-component split quality; layer recovery rate | The floor is set; L2 limited to parts the floor allows |
| P5 Transcription after separation | Does transcription survive separation? | Synthetic songs with exact MIDI; Basic Pitch, a drum transcriber, a monophonic tracker; clean vs separated inputs | Note F1 per part, clean and separated; velocity error | Drafts need correction UI; quantization policy tuned |
| P6 Effect chains | Can effect type and parameters be recovered for native devices? | Random chains of Reverb, Echo, Saturator, Compressor, EQ Eight, Auto Filter on known dry stems; classifier plus proxy optimization; Live verification | Effect-set F1; audio distance after re-render | Chains limited to what the proxies cover; manual effect choice |
| P7 Mix | Can gain, pan, EQ, compression and the master chain be recovered? | Synthetic mixes from known stems; extend `mix duck calibrate` | Mix-level STFT distance and LUFS error after re-render in Live | Mix stays measurement-advised (v1 behavior), not recreated |
| P8 End to end | What rung does the full pipeline reach on synthetic songs, then on real in-the-box songs with known projects? | Chain P3 to P7; real ground truth from the owner's own tracks and Live demo Sets | Per-rung metrics per track and section | Scope the product to the rungs that pass |
| P9 ABX | Which metric thresholds correspond to "a producer cannot tell"? | Small ABX study with producers on P2 and P8 outputs | Threshold per metric with its confidence; correlation with ABX | Metrics replaced or reweighted |

## 7. Technology stack, as a recommendation

Keep the two-language split that exists: Python for signal processing
and models (`analysis/`), TypeScript for Live, the CLI and batch
orchestration (`packages/`). Additions, with licensing under ADR-002:

<!-- STACK: filled from the surveys -->

Compute topology: a Mac running Live is the renderer and verifier; model
training needs an NVIDIA GPU (local or rented); inference for separation
and transcription runs on the Mac at reduced speed. The orchestrator
(`packages/orchestrator`, parked) is the natural home for batch jobs
(data factory runs, proof sweeps), with JSON contracts between stages as
the analysis engine already uses.

## 8. Risks and unknowns

<!-- RISKS: filled from the surveys -->

## 9. Questions for the owner

Answers change the scope, the stack and which proof runs first.

1. **Which rung is the goal, and what is the acceptance test?** Perceptual
   indistinguishability (a producer fails an ABX test) is the highest
   defensible bar; "the same project the producer built" is not
   recoverable (F1). Is L3 with ABX the target, or is L1 (notes plus
   sounds, mix left to the measurement advisor) already the product?
2. **Which songs?** In-the-box electronic music in the v1 genres
   (house, techno, trap, dubstep), or any song including bands, acoustic
   recordings and vocal-led pop? The first is where every stage has a
   chance; the second lowers the ceiling to L0 for most parts.
3. **Vocals and other recorded performances.** Place the separated stem as
   audio (L0), omit it, or synthesize a replacement? Synthesis of a real
   singer's voice is cloning; the recommendation is L0 and no cloning.
4. **Device vocabulary.** Native devices only (fully addressable through
   the SDK, 195 named parameters on Operator), or also third-party
   plugins you own? Serum 2 is opaque to the SDK today; writing its
   preset files would be a subproject of its own. Which packs and plugins
   are installed on the production machine?
5. **Sample vocabulary.** Core Library and Packs, your own library,
   subscription libraries? The index is local and never redistributed
   (ADR-002), but what it covers decides the sample-identification hit
   rate (P3).
6. **Purpose.** A personal study and remake tool, or something others
   will use? Distribution triggers the model-weight provenance questions
   in `docs/research/reference-track-analysis.md`, the SDK's
   non-redistributability, and the copyright questions in section 2.
7. **Draft-with-correction or one shot?** Your stated preference is
   manual over hallucinated. Is a loop where each stage writes a draft
   into Live and reads your corrections back acceptable, or must the
   pipeline run unattended end to end?
8. **Machines.** Mac model and memory for the Live host; whether an
   NVIDIA GPU or a cloud budget exists for training; Live version in use
   and whether the SDK beta's blockers (no transport, automation, routing
   or preset loading; packaged `.ablx` never activates) still hold in the
   current build. The answer decides whether the `.als` writer (P0b) is
   required or optional.
9. **Real ground truth.** Do you have Live projects with their finished
   renders (your own tracks, collaborators', purchased project files,
   Live's demo Sets)? Those are the only real-song cases where every
   stage can be scored exactly.
10. **Time and order.** Is this a research track beside the quality plan,
    and which proof do you want first? The recommendation is P0, P1, P2 in
    that order, because they reuse the Operator assistant and the capture
    loop and settle the throughput question that shapes everything else.

## Sources

<!-- SOURCES -->
