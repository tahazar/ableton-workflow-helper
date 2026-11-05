# Research: Song to Live Set recreation (inverse rendering) — Nov 2026

- Status: draft for owner discussion, 2026-11-05. A research note, not a
  spec. It frames the problem, separates what is science from what is
  engineering, proposes the experiments ("proofs") that have to pass
  before a product is designed, and lists the questions only the owner can
  answer (section 10).
- Objective as stated by the owner: an automated workflow whose input is a
  finished song and whose output is that song recreated, identically, as
  a Live project. Owner's decomposition: break the song apart, analyze the
  tracks, classify each sound, classify the effects, programmatic mastery
  of Live's devices and sounds, programmatic access to build the Set, and
  matching plus validation of recreated sounds against the original.
- Method of this note: the approach is derived from the problem, not from
  the repository. Nothing in this repository has been validated
  thoroughly, so existing code, designs and decision records (including
  the choice of Live control channel in ADR-001 and the v1 anti-goals in
  `docs/spec.md`) are treated as an inventory, listed in Appendix A, and
  not as constraints. Where a conclusion below coincides with an existing
  artifact, the artifact is not the reason for it.

## 1. The problem, stated precisely

Let `R` be Live's render function: it maps a project `P` (tracks, clips,
notes, devices with parameters, routing, mixer, automation, tempo map,
arrangement) to stereo audio `R(P)`. Given a target song `x`, the task is

    find P in P_available  minimizing  d(R(P), x)  (+ a simplicity prior)

where `d` is a perceptual distance and `P_available` is the set of
projects buildable with the devices, samples and plugins at hand. This is
analysis-by-synthesis, the "inverse graphics" of audio. In probabilistic
terms it is inference over `p(P | x) ∝ p(x | P) p(P)`: the likelihood is
the renderer plus a perceptual noise model, and the prior `p(P)` is how
producers actually build projects. Both terms matter; section 4 is about
getting data for both.

Three facts about `R` decide what is achievable and how to measure it.

**F1. `R` is many-to-one, so "the project the producer used" is not
recoverable, only "a project that renders within tolerance".** The proof
is constructive: a sine from Operator, Analog, Wavetable, Drift or a
sampled sine in Simpler render the same audio, and so do a sawtooth
through a low-pass filter and the equivalent additive sum. Within one
synthesizer, inversion from a full spectrogram is usually well-posed up
to that synthesizer's own symmetries (which oscillator carries which
partial, equivalent algorithm routings). Across devices it is not, and
mixing removes it entirely. Consequence: acceptance is judged on
rendered audio, never on parameter equality, except in synthetic tests
where the ground-truth project is ours.

**F2. Information is destroyed twice before we see the song: in the sum
(sources overlap in time and frequency; masking) and in nonlinear
processing (compression, saturation, limiting, lossy codecs).**
Separation only estimates the sources, and its error flows into every
later stage. For sounds that cannot be looked up in a library, the
separation error is the floor of the whole pipeline, not the sound
matcher's error. Masking cuts both ways: an error in a stem that is
masked in the mix is inaudible in the mix, so the mix-domain distance is
what a listener judges and the stem-domain distance is the diagnostic.

**F3. Some content is outside `P_available` by construction:** recorded
performances (vocals, played instruments, field recordings), samples that
are not in any library we can index, third-party plugins whose state
cannot be written from outside, hardware, and mastering chains. For that
content, "recreation" means placing the separated stem as audio, unless a
policy allows synthesis of a replacement, which for vocals means voice
cloning and is a legal and ethical decision, not a technical one.

### 1.1 "Identical" needs an operational definition: the fidelity ladder

| Rung | Output | What "identical" means here | Ground truth for the metric |
|---|---|---|---|
| L0 Transplant | separated stems as audio clips, tempo/grid aligned, section markers | the Set plays back the song (bounded by separation error) | the song itself |
| L1 Notes and sources | MIDI per part; sounds are retrieved samples or presets, one-shots resampled from the song, or audio where neither applies | note-level and timbral match per part | separated stems; synthetic sets |
| L2 Sound design | device patches for synthesized parts; layers recovered | each synthesized part is perceptually matched | synthetic sets; ABX on real songs |
| L3 Processing | per-track effect chains, mixer, sends, master chain | the rendered mix matches the song | mix-level distances; ABX |
| L4 Motion | automation and modulation over time; transitions, risers | the arrangement moves like the song | synthetic sets; ABX |

The ceiling is L4 with perceptual indistinguishability (an ABX test a
producer fails) for songs made in the box from addressable devices and
indexable samples. For other songs the ceiling is lower and known in
advance from the content class in F3. Every stage must say which rung it
reached and why it stopped; "outside what this stage can do" is a valid
result with a measurement attached, never a confident wrong answer.

### 1.2 Metrics, by rung

- Mix and stem level (real songs): multi-resolution STFT distance and
  log-mel distance (the losses the sound-matching literature optimizes),
  integrated and short-term loudness, peak-to-short-term-loudness ratio,
  stereo correlation, long-term third-octave spectrum, embedding cosine
  (a joint audio-text embedding such as CLAP, or a music model such as
  MERT), and scale-invariant SDR of a rendered part against its
  separated stem (bounded by separation error, so reported with that
  bound). The arbiter is an ABX listening test; metrics are proxies whose
  correlation with ABX is itself measured (proof 10).
- Symbolic level (synthetic sets only): note F1 with and without offsets,
  velocity error, device identity, effect-type set accuracy, normalized
  parameter error, gain and pan error in dB, automation curve error.
- Scores are reported per track and per section, so a failure is
  localized ("bass in the second drop") instead of one number.

## 2. The owner's decomposition, and what it leaves out

The six listed capabilities are necessary. The following are missing or
underspecified, each with why it matters.

| Missing piece | Why it matters |
|---|---|
| The output representation | A Live project is a file (`.als`: gzipped XML plus a samples folder). Whatever builds it, the pipeline's last step is writing that representation, and the representation also defines what is expressible (automation, routing, warp markers, device state). Choosing it is the first design decision, not the last. |
| Rhythm grid, tempo map, groove and quantization policy | Everything downstream is placed on a grid. Constant-tempo 4/4 is the tractable case; variable tempo and swing need a tempo map and a groove extraction step, or notes land off-grid and sound wrong. |
| Transcription (notes, timing, velocity, pitch bend, slides) | Distinct from "classify each sound". A classified sound without notes is a preset, not a part. Velocity and expression are the hard half. |
| Retrieval as a strategy separate from synthesis | Most drums, vocal chops and many textures are samples, and many synth sounds are presets. Looking the sound up (exact fingerprint or embedding retrieval over indexed libraries and over rendered presets) beats re-synthesis whenever it hits, and "not in any library" must be detected (open-set). |
| Resampling as the universal fallback | A one-shot cut from the separated stem into a sampler reproduces the sound by construction. It does not generalize to sustained, modulated or polyphonic material, but it guarantees L1 for drums. |
| Layer decomposition | One perceived sound is often two to five layered tracks (sub + mid bass, kick top + sub). Separation models have no "layer" class; recovering layers is open research. |
| The dry/wet circularity | Estimating an effect chain needs the dry signal; estimating the dry signal needs the effect. Jointly solvable only with priors (known device models) and a forward model in the loop. |
| Mix and master as a global stage | "FX used" is per track. Gain staging, panning, bus compression, sidechain pumping, stereo width and the limiter are global, interact, and are the first thing an ABX test hears. |
| Routing | Sends/returns, groups, sidechain inputs, device-internal modulation routing. Part of the representation question. |
| Automation and modulation over time | Filter sweeps, volume rides, LFO motion, risers. Time-varying estimation is harder than static. |
| A definition of "identical" with a tolerance | Section 1.1. Without it nothing can pass or fail. |
| The forward model's speed and fidelity | Analysis-by-synthesis spends most of its compute in `R`. Live is a GUI application that runs one instance per machine; the fastest trustworthy way to render a project, and how much of `R` can be modeled outside Live, decides the architecture (section 4). |
| Ground truth and data | Public datasets do not contain Live projects. The renderer is ours, so we can make unlimited exact ground truth (section 4); this is the project's main scientific lever. |
| The prior over projects | How producers structure tracks, chains and layers. It is the second half of the posterior and the realism of every synthetic dataset. It is learnable from real projects (the owner's own, demo Sets, purchased project files). |
| Human-in-the-loop correction | Ambiguity that no metric resolves (which of two equivalent patches, whether a vocal chop is a sample) needs either a prior or a person. A draft-and-correct loop is cheap insurance; whether it is acceptable is an owner question. |
| Third-party plugin boundary | A plugin whose state cannot be written from outside (no parameter surface, no preset file format we can emit) caps the vocabulary at addressable devices plus samples. |
| Legal and ethical posture | Recreating a song for study is ordinary; distributing stems or recreations of copyrighted songs is derivative-work territory; voice cloning of a real singer is its own category. Model-weight licenses constrain distribution. |
| Evaluation with listeners | Metrics are proxies. A small ABX protocol with producers is the only arbiter of "identical". |

## 3. The science, as testable claims

Each claim is either provable or falsifiable by one of the proofs in
section 7. Together they are the theory the product would rest on.

- **C1. Non-identifiability (provable, F1).** The target is a project
  that renders within tolerance. Any method that scores itself on
  parameter recovery against a real producer's project is measuring the
  wrong thing; parameter recovery is only meaningful on synthetic sets.
- **C2. Retrieval before regression.** If a sound is in an indexable
  library (a sample, a factory preset), nearest-neighbour identification
  against a rendered index is exact up to the processing applied to it,
  and parameter regression is needed only off-library. The decision
  "library hit or not" is therefore a first-class classifier whose
  open-set threshold must be calibrated. Falsified if retrieval accuracy
  collapses under ordinary processing (pitch shift, EQ, compression,
  reverb, layering).
- **C3. The forward model can be made fast and differentiable without
  reimplementing Live.** A native device is deterministic signal
  processing; a learned proxy (a network trained on input/output pairs
  captured from Live, conditioned on the device's parameters) or a
  hand-written surrogate can stand in for it inside the optimization
  loop, with Live used only to verify. If the proxy's error on the
  parameter region of interest is `ε`, optimizing against the proxy and
  verifying in Live yields a solution within `ε` plus the optimization
  gap. `ε` is measured per device, never assumed; devices with internal
  randomness (noise sources, free-running modulators) set a floor that
  is measured too. Falsified if proxies for the common devices cannot
  reach an error below the perceptual threshold from proof 10.
- **C4. Amortized inference plus test-time optimization beats either
  alone.** A predictor trained on renderer-generated data gives a
  starting point in milliseconds; gradient or evolutionary refinement
  against the proxy removes the predictor's bias; a final Live render
  checks the result. This is the standard structure of the sound-
  matching literature and is where the non-convexity of FM-style
  synthesis is confronted. Falsified if refinement does not improve on
  the predictor, or if the predictor's basin is too far from the optimum
  for refinement to reach it.
- **C5. Separation sets the floor for everything off-library.** For a
  part that must be regressed from its separated stem, no later stage
  can beat the stem's SI-SDR in the stem domain. Mix-domain distance may
  still be good because of masking. Both numbers are reported; the mix
  number is the one the ladder uses.
- **C6. The dry/wet problem is tractable with a finite device vocabulary.**
  Blind deconvolution is ill-posed, but with a known set of device
  proxies, joint estimation of (dry signal, chain, parameters) is a
  constrained search that the forward model regularizes. Non-convex and
  order-ambiguous (some chains commute), but the ambiguity is harmless:
  any chain that renders the same is acceptable (C1). Falsified if the
  joint search does not converge on synthetic chains of common devices.
- **C7. Unlimited exact ground truth exists because `R` is ours.** The
  limit is the prior's realism (synthetic projects must look like real
  ones) and the render throughput (section 4), not labeling. Falsified
  if models trained on synthetic sets do not transfer to real songs with
  known projects.

## 4. The two levers: the renderer as a data factory, and proxies of it

Every stage needs data that does not exist publicly: audio paired with
the Live project that produced it. We own the renderer, so we can draw
projects from a prior and render them:

1. Draw a project from `p(P)`: notes, patches, chains, mixer, automation,
   arrangement, sampled from distributions fitted to real projects where
   available and to genre knowledge otherwise.
2. Render it to audio, stems and per-stage intermediates.
3. Record the exact ground truth: stems, MIDI, every parameter, the
   chain, the mixer, the automation.

This yields training data for the inverse models, exact evaluation for
the whole pipeline (section 7), and calibration of pretrained separation
and transcription models on electronic material. Two consequences:

- **Throughput bounds the design, so the render path is a measured
  choice, not an assumption.** Candidates: Live's own export (offline,
  faster than real time, but only reachable by driving the user
  interface), real-time capture while Live plays (one machine yields at
  most 24 hours of audio a day, about 20,000 four-second examples; the
  sound-matching literature trains on 10^5 to 10^6), pre-effect track
  rendering where an API exposes it, and proxies (C3) for everything
  inside the inner loop. The likely shape is proxies inside, Live
  outside, with Live renders reserved for verification and for the
  proxies' own training data.
- **Proxies turn `R` into something gradient-based.** The literature on
  neural proxies for audio effects and synthesizers, and on
  differentiable signal processing, provides the method; what is new is
  pointing it at Live's own devices with data captured from Live. A
  proxy library with a measured fidelity per device is a reusable asset
  of the whole project.

## 5. Where machine learning is required, and where it is not

| Stage | Method class | ML required? | Note |
|---|---|---|---|
| Tempo, beats, downbeats, key, sections | signal processing with learned upgrade | no for constant-tempo 4/4; yes for robustness and variable tempo | the weakest link is downbeat phase and half/double-time ambiguity |
| Source separation | deep models | yes, no alternative | pretrained; fine-tuning on renderer data is optional |
| Transcription | deep models, plus pitch tracking for monophonic parts | yes for polyphony and drums | velocity needs its own estimator |
| Sound classification | embeddings and classifiers | yes | a small classifier on renderer data for device families and sample classes |
| Retrieval (samples, presets) | fingerprinting plus embedding search over rendered indexes | no (hashing) plus embeddings for near matches | open-set threshold must be calibrated |
| Synth parameter estimation | learned initializer plus optimization against proxies | hybrid (C4) | FM-style synthesis is the non-convex case |
| Effect-type recognition | classifiers on wet audio | yes | trained on renderer data for the device vocabulary |
| Effect parameter estimation | proxies plus optimization | hybrid (C6) | |
| Mix inference | differentiable mixing plus measurement | hybrid, mostly optimization | |
| Automation | frame-wise regression plus smoothing | hybrid | |
| Assembly | writing the project representation | no | |
| Validation | signal metrics, embeddings, ABX | no (metrics), yes (embeddings) | |

Large language models are not on the critical path. They help with
orchestration, with mapping classification outputs onto device choices,
with explaining results and with resolving ambiguity interactively.
Generative audio models (full-track generation) do not help recreate a
specific song.

## 6. State of the art per stage

Figures below come from literature surveys run from this session, whose
network could not reach arxiv.org, huggingface.co or mvsep.com; numbers
that came only from aggregators or search extracts are marked
(unverified) and must be re-checked against the papers before a decision
rests on them. Licenses matter only on distribution (section 2) but are
recorded now because they decide what a product could ship.

### 6.1 Output representation and Live control channels

| Channel | Can do | Cannot do | Evidence |
|---|---|---|---|
| `.als` file (gzipped XML; Live 12 writes `MajorVersion="5"`) | Express everything Live saves: devices with full state, automation envelopes, routing, warp markers, mixer, clips, tempo and signature changes | No official writer (Ableton's Live Set Export kit is iOS-only, write-only, restricted license). Community libraries (kevinkirsten/ableton-als, kmontag/buildable, theokyr/ablesharp, SpendLessDaw/ts-als, hodel33/ableton-project-processor, offlinemark/dawtool) do surgical edits, merges and track copies; none generates native-device XML from scratch; device schemas per Live version are undocumented; an unknown attribute is rejected and a wrong value fails silently | GitHub READMEs; the working route everyone converges on is template capture: let Live save each construct once, then patch values into the captured fragments, with Live as the validator (proof 1) |
| Extensions SDK (`@ableton-extensions/sdk` 1.0.0-beta.1; Suite only; a Node process inside Live; dev mode; sandboxed file access) | Typed object model; tracks, clips, notes, scenes, cue points; insert built-in devices by name; read and write raw parameter values; replace a Simpler sample; import files; render pre-effect audio of audio tracks (speed and offline-ness undocumented) | Transport, automation envelopes, routing, browser and presets, third-party devices, time-signature and warp-marker writes, export, observers, display strings for parameters; packaged extensions did not activate on the beta build this repository used | Local SDK reference and this repository's notes; Live beta release notes show the SDK moving (Node 24.22.1 in 12.4.25b1) but no API version above 1.0.0 was found |
| Max for Live (Live Object Model) | Transport and clip launch; input/output routing; warp markers (add, move, remove); parameter display strings (`str_for_value`); time signature; crop and duplicate region; `insert_device` and `insert_chain` (Live 12.3+); Simpler playback mode and slicing | Automation envelopes and browser `load_item` are not in the M4L allowlist; no freeze or export | Live 12.0-era allowlist (`LomTypes.py` mirror) and Producer Pal 2.5.0 notes; the current LOM reference was unreachable, so treat as secondary |
| Remote Script (Python `Live` module, as Push's own scripts use it) | Everything M4L has, plus clip automation envelopes (`create_automation_envelope`, `insert_step`; writing points needs Live 12.4) and browser `load_item` for presets, devices and samples; precedents: Push scripts, LivePilot (native device insert, sample replace, browser load, automation, warp markers, freeze and flatten), Producer Pal, AbletonOSC, ableton-mcp | Undocumented and unsupported; runs on Live's main thread; arrangement automation lanes can be written but not read back or cleared (Producer Pal) | GitHub sources of those projects |
| Live's export dialog | Offline rendering "as quickly as possible", stems and master | No API; reachable only by driving the user interface | Ableton help article (snippet) |

Fresh assessment: the broadest programmatic surface today is a Remote
Script, not the Extensions SDK; the most complete representation is the
`.als` file; the fastest render is the export dialog, reachable only
through user-interface automation. Live's own stem separation (12.3) is
interface-only. No public dataset pairs Live projects with renders;
commercial remake vendors sell project plus stems plus MIDI bundles,
whose terms for research use are unknown. Headless Live: no official
statement found; secondary sources say interface only.

### 6.2 Source separation

| Model | Year | Reported quality | License | Note |
|---|---|---|---|---|
| Hybrid Transformer Demucs | 2023 | MUSDB18-HQ average 9.0 dB SDR with extra data (vocals 9.2, drums 10.1, bass 10.4, other 6.3) (unverified per stem) | MIT code; weights license unstated; repository archived | CPU inference about 1.5 times track length; 3 to 7 GB VRAM |
| BS-RoFormer | 2023 | about 12 dB average with 500 extra songs (vocals 12.7, drums 12.9, bass 13.3, other 9.0) (unverified) | No official weights; MIT re-implementation; community checkpoints mostly carry no license | Slowest family; training reported to need a 40 GB GPU |
| Mel-Band RoFormer | 2023 | vocals 11.2 to 11.6 dB (unverified) | community weights, no license file | |
| SCNet / SCNet-XL | 2024 | 9.0 to 10.1 dB average without extra data (unverified) | MIT | about half HT-Demucs CPU time |
| MVSEP service ensembles | 2024 to 2026 | 4-stem ensemble about 13 dB average; 6-stem (guitar 9.1, piano 7.8) (from the service's own pages, unverified) | proprietary service | the leaderboard reference |
| Drum components: LarsNet; DrumSep; MDX23C DrumSep 6-stem | 2022 to 2024 | kick 10 to 17 dB, snare 6 to 12, toms 5 to 12, hi-hat 3 to 4, cymbals 6 (unverified) | LarsNet weights CC BY-NC; DrumSep MIT; 6-stem unknown | all trained on acoustic-kit renders |
| Query-based: Banquet (audio example), AudioSep and CLAPSep (text), GuideSep (hummed melody), SAM Audio (text, visual, time span) | 2023 to 2025 | on par with 6-stem Demucs on MoisesDB, better on guitar and piano (Banquet); no layered-synth benchmark exists | Banquet and AudioSep MIT code; SAM Audio under its own license, gated checkpoints | the only route to "that pad" as a target |

Solved: four-stem separation of rock and pop, with the top of the
leaderboard compressed within about 1 dB. Unsolved for this project: the
"other" stem is a catch-all at 8 to 9 dB and no public model splits it
into synth layers; piano stays weak; drum-component models collapse on
hi-hats and cymbals and are trained on acoustic kits, so processed
electronic drums are out of domain; electronic failure modes
(sidechained drops, bass and drums bleeding) are documented only
anecdotally; SDR is a weak proxy for perceived stem quality; the only
electronic multitrack set found is mshoxxDB (18 songs with MIDI). The
practical blocker is licensing: the strongest public weights are
unlicensed community checkpoints or service-only; cleanly licensed
options (Demucs, SCNet, Banquet code, AudioSep) are weaker. Both gaps are
what the data factory (section 4) is for: electronic ground truth with
layers, and a training set for fine-tuning a cleanly licensed model.

### 6.3 Transcription

| Model | Year | Reported quality | License | Note |
|---|---|---|---|---|
| Kong et al. high-resolution piano | 2021 | MAESTRO onset F1 96.7 | Apache-2.0 | solo piano is solved |
| MT3; YourMT3+ | 2022; 2024 | Slakh onset F1 about 76 (MT3) and about 85 (YourMT3+), about 75 with offsets (unverified) | Apache-2.0 (MT3, unsupported); GPL-3.0 code, weights via demo only (YourMT3+) | benchmarked on synthetic Slakh and classical, never on processed synth stems; most 2025 challenge entrants did not beat MT3 |
| Basic Pitch | 2022 | instrument-agnostic, pitch bends; best on one instrument at a time | Apache-2.0 | lightweight; ONNX |
| PESTO; CREPE; pYIN | 2023; 2018; 2014 | monophonic pitch; PESTO 120 kB, about 12 times real time on CPU | LGPL-3.0; MIT; ISC | bass and lead f0 |
| Drums: ADTOF; Riley and Dixon (ADTOF on separated drum stems); Melucci et al. (synthetic one-shot renders only) | 2021; 2025; 2026 | onset F about 0.85 to 0.89 on acoustic sets, 0.56 to 0.63 on RBMA electronic (unverified; two versions of the paper conflict); Melucci claims SOTA on ENST and MDB from synthetic data alone | CC BY-NC-SA; n/a; CC BY-SA | the RBMA number is the one that matters here; Melucci supports training on rendered one-shots |
| Velocity: score-informed refinement (Kim and Serra 2024; Huang 2025) | 2024 to 2025 | no standard mapping; best when a score is known first | n/a | |
| Quantization: PM2S; Wachter et al. (beat-token T5) | 2022; 2025 | quality capped by beat tracking; offsets remain hard | PM2S MIT | |

Solved: piano; coarse multi-instrument onsets on clean synthetic mixes.
Unsolved: processed electronic stems (no benchmark), drums on electronic
material, bass (no recent dedicated work), velocity and expression,
glide and portamento, polyphonic synth leads. Transcription after
separation is therefore a measurement we must make ourselves (proof 7).

### 6.4 Rhythm, harmony and structure

| Task | Best open option | Reported quality | License |
|---|---|---|---|
| Beat and downbeat, variable tempo | Beat This! (no dynamic Bayesian network needed) | GTZAN beat F1 about 89, downbeat 78 to 80 (unverified); poor continuity; fails on SMC-style material (F about 0.63); non-4/4 only now being addressed | MIT |
| Tempo, beats, sections jointly | All-In-One | boundary HR.5F 0.60 on Harmonix | MIT code, but depends on madmom's CC BY-NC models |
| Structure boundaries and labels | SongFormer | HR.5F 0.70, label accuracy 0.81 on Harmonix (unverified) | CC-BY-4.0 |
| Key | S-KEY (self-supervised), InceptionKeyNet | about 72 to 76 percent on EDM-style sets; modal material is the failure case | not confirmed |
| Chords | ChordFormer | fine for triads; large vocabularies improving | not confirmed |
| Time signature | none strong | thin field | |
| Swing and groove | Dittmar 2015, Fuentes 2019, GrooVAE | no 2023 to 2026 method; "beats plus microtiming to a DAW tempo track and groove template" is not a benchmarked task | |

Constant-tempo 4/4 is served well by signal processing; the gaps are
downbeat phase, half- and double-time ambiguity, meter, and groove
extraction, each of which is cheap to expose for correction and
expensive to get right unattended.

### 6.5 Retrieval: fingerprints, sample identification, preset retrieval

| Method | Year | What it reports | License |
|---|---|---|---|
| Landmark fingerprinting (audfprint, Dejavu, Panako, Olaf) | 2003 to 2023 | exact and noisy-recording identification solved; Panako handles pitch shift and time stretch by hashing | MIT; MIT; AGPL; AGPL (patent warnings in Olaf's README) |
| Neural fingerprints (Neural Audio Fingerprint; GraFPrint; PeakNetFP; foundation-model fingerprints, Nov 2025) | 2021 to 2025 | time-stretch robustness strong; pitch-shift robustness only in the 2025 work (augmented plus or minus 5 semitones, tables unread) | MIT; n/a; n/a; n/a |
| Sample-in-mix identification (Cheston 2025; NeuralSampleID; Riou et al., Sony, ICASSP 2026) | 2025 to 2026 | Sample100 mAP 0.44 to 0.60; benchmark is 100 hip-hop pairs; the best model trained on about 21,000 proprietary multitracks | n/a; GPL-3.0; code announced |
| One-shot retrieval from mixtures (Kim and Nam 2020; SampleMatch 2022) | 2020 to 2022 | joint embedding of one-shot and mixture; dormant since | n/a |
| Preset retrieval by joint audio-preset embedding (FM-SynAPSE, DX7 graph network) | 2026 | beats baselines on held-out FM topologies; trained at one pitch and velocity | not verified |
| Embeddings: CLAP; MERT; MFCC | 2023; 2023; classic | human timbre-similarity studies (2025): CLAP only marginally better than MFCC; descriptor correlation r about 0.12 | CC0; Apache code, checkpoint not confirmed; n/a |

Exact and near-exact identification is solved; identification of a
one-shot or a preset inside a mixture is open, and a rendered-preset
index with a joint audio-preset embedding (the FM-SynAPSE pattern
pointed at a device's factory presets) is the cheapest robust baseline
for sound classification and the starting point for parameter
estimation (C2). Open-set thresholds are not reported anywhere and must
be calibrated on our own data (proof 5).

### 6.6 Synthesizer sound matching

| Method | Year | Synth and parameters | Result | License |
|---|---|---|---|---|
| Yee-King et al. (hill climber, GA, deep networks) | 2018 | Dexed, up to 155 | "close match" in 25 percent of tests | paper CC BY-NC-ND |
| InverSynth; InverSynth II (learned differentiable proxy plus inference-time fine-tuning) | 2019; 2023 | custom FM plus subtractive | proxy-based fine-tuning state of the art on its benchmarks | not verified |
| Masuda and Saito (differentiable subtractive synth; semi-supervised fine-tuning on out-of-domain sounds) | 2021; 2023 | subtractive with ADSR | large in-domain versus out-of-domain gap reported | not verified |
| Sound2Synth | 2022 | Dexed, 155 | MFCC distance; "first real-world applicable Dexed results" | paper CC BY-NC-SA |
| torchsynth and synth1B1 | 2021 | modular voice, 78 | 16,200 times real time on one V100 | Apache-2.0 (unverified) |
| White Box Search; DiffMoog | 2023; 2024 | FM plus filters plus envelopes; modular chains | gradients through discontinuities beat GA; Wasserstein loss better for frequency | n/a; CC BY |
| Bruford et al. (Native Instruments) | 2024 | Massive, 16 parameters, about 1M renders | spectrogram transformer best; weak on oscillator pitch | n/a |
| Hayes (permutation-equivariant flow matching) | 2025 | Surge XT, full | regression degrades under symmetry even with invariant losses; equivariant generative model wins | not verified |
| Modulation Discovery | 2025 | wavetable plus filter plus envelope | recovers time-varying control curves (the only such work) | not verified |
| INSTRUMENTAL (Demucs, pitch detection, CMA-ES) | 2026 | 28-parameter subtractive synth; 10^5 evaluations per target, 90 percent of the gain in the first 10^4 | CMA-ES beat gradient descent; the optimizer exploits the loss with extreme values | n/a |
| DDSynth-RL (masked discrete diffusion plus reward fine-tuning) | 2026 | Dexed, 155 | competitive with autoregressive and flow baselines; reward improves out-of-domain matching | Apache-2.0 code, CC BY checkpoints |
| Neural proxies for synthesizers (Combes et al.) | 2025 | three commercial synths, full presets | preset-to-embedding regressor usable as a loss; gap largest on complex synths | not verified |
| Products: Synplant 2 Genopatch; Fadr SynthGPT | 2023; 2024 | each matches into its own engine | algorithm undocumented; audio prompting not shipped (SynthGPT) | proprietary |

Solved: in-domain matching of single steady notes for synths up to
Dexed scale, when the matcher is trained on renders of the same synth
and judged by spectral distance; differentiable re-implementations with
gradients or CMA-ES for synths with up to about 30 free parameters.
Unsolved: symmetry and many-to-one ambiguity (operator permutations
collapse regression to averages; the fixes are 2025 to 2026 research),
out-of-domain targets, time-varying modulation (one paper), effects
baked into the target, polyphony and partial notes (no evaluation
anywhere), the 10^4 to 10^5 renders per target that search needs, and
optimizers exploiting weak losses. Nothing targets any Live device, and
the root cause is exactly C3: no headless renderer and no differentiable
model of them exists. The literature's own answers to the symmetry
problem (retrieval of the nearest preset, equivariant generative models,
discrete diffusion with a reward) are the methods proof 4 should start
from, with FM (Operator) as the hard case and a subtractive device as
the easy one.

### 6.7 Similarity metrics

The diagnosis is consistent across papers: magnitude-spectral losses
(multi-resolution STFT, log-mel) are unreliable for pitch and frequency
(local minima, weak sense of direction) and for time-shifted events;
remedies are optimal-transport and Wasserstein losses, joint time-
frequency scattering, and complex-surrogate gradients. No loss is at the
same time differentiable, fast and validated against human "same sound"
judgments on synth timbres; two 2025 rating studies find pretrained
embeddings only weakly aligned with timbre similarity and MFCC still
competitive; Salimi 2025 finds metric rankings flip across synth types
and that parameter error, spectral distance and listening scores
disagree. Nothing evaluates metrics on stems with baked-in effects or
separation artifacts. Consequence for this note: proof 10 (listening-
calibrated thresholds) is not a final polish but a prerequisite for
trusting proofs 4 to 9, so a small version of it runs early.

### 6.8 Effects and mix inference

| Task | Method | Year | Result | License |
|---|---|---|---|---|
| Effect-type recognition | Comunità (13 distortion pedals, type plus knobs); Hinrichs (type and parameters of a guitar effect inside a mix); Guo and McFee (13 cascaded effects, multi-label) | 2021; 2022; 2023 | above 80 percent; MAE 0.05 to 0.1; micro-F1 0.88 | n/a; n/a; GPL-3.0 |
| Chain estimation with dry-signal recovery | Take et al. (one model applied iteratively); Okita et al. (network predicts the effect set, search refines order and parameters on reconstruction similarity); LLM2Fx-Tools (a language model emits an executable chain) | 2024; 2026; 2026 | macro-F1 0.96 for the effect set (unverified); listening scores above DeepAFx-ST (unverified) | n/a |
| Processing-graph estimation | Lee et al., blind graph estimation (nodes, routing including sidechain, parameters); Lee et al., console-then-prune given dry stems and the mix | 2023; 2024 to 2025 | reconstructs routings on synthetic data, degrades on unseen sources; pruning removes about two thirds of processors at equal match | n/a; grafx Apache-2.0 |
| Parameter estimation | DiffVox (equalizer, compressor, ping-pong delay, feedback-delay reverb, 152 parameters, fitted to real vocal chains); Peladeau and Peeters (blind estimation from wet audio only); DRC inversion (Sun 2024; black-box 2026); music de-limiter | 2024 to 2026 | the audio-loss model matches audio better, the regression model matches parameters better (the ambiguity of C1 at parameter level); de-limiting SI-SDR about 24 dB in distribution | MIT; none; n/a; MIT |
| Style transfer and automatic mixing | DeepAFx-ST; ST-ITO (gradient-free search over a learned style metric, works with non-differentiable plugins); Diff-MST; FxNorm-automix (mixes rated indistinguishable from professionals); mixing style transfer with FXencoder; ITO-Master (white-box master chain) | 2022 to 2025 | listening tests throughout; no correlation study between metrics and listeners | noncommercial; Apache-2.0; CC BY-NC-SA; MIT; MIT; n/a |
| De-effecting | RemFX (removes chorus, delay, distortion, compression, reverb; many-effect cases hard); distortion recovery; unsupervised vocal dereverberation; speech RIR estimators | 2022 to 2024 | no estimator of a usable impulse response from a reverberant music stem exists | Apache-2.0; n/a; n/a; n/a |
| Time-varying parameters | LFO extraction for phaser, flanger and chorus (Mitcheltree); fader and EQ trajectories of DJ mixes when both sources are known (convex); gain trajectories from de-limiting | 2022 to 2024 | periodic modulation solved; no detector for sidechain pumping, filter sweeps or send automation; all chain estimators assume static parameters per clip | MPL-2.0; n/a; MIT |
| Differentiable effect libraries | dasp-pytorch (gain, distortion, parametric EQ, compressor, expander, reverb, widener, panner); grafx (graph container with EQ, filter, delay, dynamics, nonlinear, reverb, stereo modules); torchcomp (compressor and limiter ballistics); DiffVox; NablAFx (black- and gray-box effect models); auraloss | 2020 to 2025 | no differentiable phaser, flanger or chorus with an estimable LFO; no program-dependent or feedback-topology compressor | Apache-2.0; Apache-2.0; MIT; MIT; MIT; Apache-2.0 |
| Fast non-differentiable hosts | Spotify pedalboard (built-in effects, VST3 and AU hosting, about 300 times faster than pySoX); DawDreamer (plugin hosting with automation, offline) | current | neither can render a Live device | GPL-3.0; GPL-3.0 |
| Loudness and reference matching | pyloudnorm (BS.1770-4); Matchering 2.0 | 2021; current | solved and standardized | MIT; GPL-3.0 |

Solved: single-effect type recognition on clean and mixed guitar (F1
about 0.9); parameter regression for EQ, compression and distortion on
synthetic data when the renderer matches the training model; static
chain reconstruction given dry stems and the mix (console-then-prune),
also on real vocal chains (DiffVox); loudness measurement. Unsolved:
the circularity on separated stems (the inputs are wet, and joint
estimators degrade on unseen sources and long chains while separation
leaks reverb between stems); order non-identifiability (pruned graphs
are equivalence classes, which C1 says is acceptable but Live still
needs a concrete device order and a send-versus-insert decision, so a
canonical chain policy plus audio verification is required); mapping
from each estimator's own equalizer, compressor or reverb model to a
specific device's controls (no public model of any Live device exists;
pedalboard and DawDreamer cannot host them; paired data must be rendered
inside Live, which is proof 3 again); time-varying parameters (segment
the song, estimate static parameters per segment, fit envelopes with
smoothness priors, is the only route); master-chain inversion (limiter,
multiband dynamics and width are only partly identifiable from a stereo
master); and no validated "same mix" metric, so a learned style
embedding plus loudness and dynamics statistics screens candidates and
listening tests anchor acceptance.

## 7. Proof plan

Each proof is a falsifiable experiment with a number, run first on
renderer-generated sets where the answer is known exactly, then on real
songs where only perception can judge. Order is by risk and dependency:
the representation and the forward model bound everything else, so they
go first; the stages with mature public models (separation,
transcription) go later because their floor is informative but not
decisive for the architecture.

| # | Question | Method | Metric and pass line | What failure means |
|---|---|---|---|---|
| 1 Representation | Can a project written from scratch in the `.als` format open in Live and render identically to the same project saved by Live? | Parse Sets saved by Live; regenerate them; open; render both; also write a minimal Set with devices, parameters, automation, routing and warp markers | Opens without repair; renders bit-identical or within the measurement noise floor; every construct in the ladder's rungs is expressible | Some constructs need a live API or manual steps; the ladder's reachable rungs shrink |
| 2 Forward model | What is the fastest trustworthy way to render a project, and is it deterministic? | Time Live export (driven through the user interface), real-time capture, and any pre-effect render API; render the same project twice | Seconds per render per path; difference between two renders (the noise floor used by every later proof) | Inner loops cannot touch Live; proxies carry everything inside |
| 3 Device proxies | For the common native devices, how closely can a proxy reproduce Live? | Capture input/output pairs across sampled parameters; fit hand-written surrogates where the design is known and learned proxies otherwise | Spectral distance per device and parameter region; list of devices with internal randomness and their floor | Optimization against Live directly, at real time; vocabulary shrinks |
| 4 Single-sound inversion | Given a Live-rendered synth sound, can a patch be recovered that renders the same? | Predictor trained on proxy renders, refinement against the proxy, verification render in Live; one subtractive device and one FM device | Median distance to target under the proof-10 threshold; share of sounds under it; predictor alone vs refined | Non-convexity dominates; restrict to sub-gamuts (bass, pluck, keys) |
| 5 Retrieval | Can a processed sample or preset be identified in a rendered index, and can "not in library" be detected? | Index library samples and factory presets by rendering them; queries are items after random pitch shift, EQ, compression, reverb and layering | Top-1 and top-5 accuracy per processing class; open-set false-accept rate at a fixed threshold | Retrieval limited to unprocessed one-shots; resampling fallback carries L1 |
| 6 Separation floor | How good is separation on electronic material, and does the "other" stem split into layers? | Renderer-generated songs with exact stems; candidate models | SDR per stem; drum-component split quality; layer recovery rate | The floor is set; L2 limited to parts the floor allows |
| 7 Transcription after separation | Does transcription survive separation? | Synthetic songs with exact MIDI; polyphonic, drum and monophonic transcribers; clean vs separated inputs | Note F1 per part, clean and separated; velocity error | Drafts need correction; quantization policy tuned |
| 8 Chains and mix | Can effect types, parameters, gain, pan and the master chain be recovered? | Random chains of common devices on known dry stems and synthetic mixes; classifier plus proxy optimization; Live verification | Effect-set F1; mix-level distance and loudness error after re-render | Chains limited to what the proxies cover; mix stays advisory |
| 9 End to end | What rung does the full pipeline reach on synthetic songs, then on real songs with known projects? | Chain proofs 5 to 8; real ground truth from projects whose renders exist | Per-rung metrics per track and section | Scope the product to the rungs that pass |
| 10 ABX | Which metric thresholds correspond to "a producer cannot tell"? | Small ABX study with producers on outputs of proofs 4 and 9 | Threshold per metric with its confidence; correlation with ABX | Metrics replaced or reweighted |

Proofs 1 to 3 need no machine learning and settle the architecture.
Proof 4 is the first scientific result. Proofs 5 to 8 are mostly
measurement of known methods on our material.

## 8. Technology stack, derived from the requirements

The requirements per layer, then candidates. Specific libraries, licenses
and versions come from the surveys.

- **Signal processing and models.** Tensor library with automatic
  differentiation, GPU support, and an audio ecosystem of pretrained
  separation and transcription models: Python with PyTorch is the only
  realistic choice. Evolutionary optimization for the non-convex cases.
- **Forward model.** Device proxies as PyTorch modules (differentiable),
  hand-written surrogates where a device's design is known, and a thin
  driver for the chosen Live render path.
- **Project representation.** A reader and writer for the `.als` schema,
  round-trip tested against Sets saved by Live. Pure XML work; any
  language. For the research phase, the same language as the models
  keeps the loop in one process.
- **Live control for verification and capture.** Whichever channel proof
  2 shows to be fastest and deterministic; the candidate channels and
  what each can do are in the survey (section 6).
- **Indexes.** Rendered-preset and sample indexes with fingerprints and
  embeddings; brute-force search is enough at library scale.
- **Data factory and proofs.** A job runner that samples projects, renders
  them, stores ground truth and computes metrics, with every result
  reproducible from a seed.
- **Compute.** A machine running Live for rendering and verification; a
  GPU for training proxies and predictors; separation and transcription
  inference on either.

A single-language research phase (Python end to end, including the
`.als` writer and the Live driver) has fewer moving parts than a split
stack; the product phase can re-decide once the proofs say which Live
channel and which rungs survive.

Candidates by layer, from the surveys (licenses as reported; verify
before any distribution decision):

- Separation: Demucs (MIT code), SCNet (MIT), Banquet code (MIT) and
  AudioSep (MIT) are cleanly licensed; the strongest community RoFormer
  checkpoints and the MVSEP ensembles are unlicensed or service-only;
  `audio-separator` (MIT) wraps most of them; the ZFTurbo training
  framework (MIT) is the route to fine-tune on data-factory output.
- Transcription: Basic Pitch (Apache-2.0) and Kong's piano model
  (Apache-2.0); PESTO (LGPL-3.0) or CREPE (MIT) for monophonic parts;
  drums have no cleanly licensed strong model, so a drum transcriber
  trained on data-factory one-shot renders (the Melucci 2026 recipe) is
  the plan; velocity from stem loudness as the baseline.
- Rhythm and structure: Beat This! (MIT), SongFormer (CC-BY-4.0), msaf
  (MIT); All-In-One only if madmom's non-commercial models are
  acceptable; key by template matching with a learned model as an
  upgrade.
- Retrieval: audfprint (MIT) for exact matches; a neural fingerprint on
  a music foundation model for pitch- and time-shifted matches; CLAP
  (CC0) and MERT embeddings and MFCCs for near matches; a joint
  audio-preset embedding for the rendered-preset index.
- Sound matching and effects: PyTorch; auraloss (Apache-2.0) plus
  optimal-transport and scattering losses; dasp-pytorch and grafx
  (Apache-2.0), torchcomp and DiffVox (MIT) as the differentiable effect
  building blocks that device proxies are fitted against; CMA-ES (pycma)
  and the ST-ITO pattern for the non-convex and non-differentiable cases;
  device proxies as described in C3; equivariant or diffusion-based
  preset models when symmetry bites.
- Plugin hosting outside Live (third-party instruments only):
  DawDreamer and Spotify's pedalboard are GPL-3.0 and would run as
  isolated subprocesses; RenderMan. None hosts a Live device.
- Live side: a Remote Script in Python for control, a Python `.als`
  writer built on captured templates, and for audio either
  user-interface automation of the export dialog or a Max for Live
  recorder, whichever proof 2 shows is the fastest trustworthy render;
  the Extensions SDK as an optional typed reader.
- Data: the data factory first; public sets for evaluation only
  (MUSDB18-HQ, Slakh2100, mshoxxDB for electronic multitracks, StemGMD
  for drum components, Sample100 for sample identification; MoisesDB is
  non-commercial).

## 9. Risks and unknowns

1. **Render path.** No export API exists; user-interface automation is
   brittle across Live versions; real-time capture caps the data factory
   at 24 hours of audio per machine-day; the SDK's pre-effect render has
   no published speed. Proof 2 measures all three before anything is
   built on them.
2. **`.als` schema.** Undocumented, per version; a wrong value fails
   silently. Template capture plus round-trip tests (proof 1) is the
   only known mitigation.
3. **Remote Script API.** Unsupported and undocumented; breaks across
   Live updates; runs on Live's main thread, so long jobs block the
   interface.
4. **Separation floor for electronic material.** "Other" is not split
   into layers by any public model; drum-component models are
   out-of-domain on processed drums; failure modes are undocumented.
   Query-based separation is unproven here.
5. **Transcription of processed material.** Drum transcription drops to
   about 0.6 F1 on electronic material; bass, glide and velocity are
   unaddressed; everything degrades after separation by an unmeasured
   amount.
6. **Symmetry and ambiguity in synth inversion.** Plain regression
   collapses; the remedies are fresh research on other synths.
7. **Time-varying modulation.** One paper; L4 may need a different
   method than the rest of the pipeline.
8. **No validated "same sound" criterion.** Losses are exploitable and
   embeddings correlate weakly with human timbre judgments; without an
   early listening calibration every later pass line is arbitrary.
9. **Licensing.** The best weights are non-commercial, unlicensed or
   service-only; cleanly licensed options are weaker. Irrelevant for
   private use, decisive for a product.
10. **Legal exposure.** Copyrighted input songs, derivative outputs,
    dataset terms, voice cloning. Needs the owner's policy (section 10).
11. **Compute.** RoFormer training reportedly needs 40 GB GPUs; the data
    factory needs many hours of Live time on the production machine.
12. **Effects on separated stems.** Every chain estimator assumes a dry
    input or a static chain per clip; separation leaks reverb between
    stems; master-chain inversion is lossy. L3 may top out at "a chain
    that renders close", which C1 accepts, but the circularity is the
    part of proof 8 most likely to fail.
13. **Unverified figures.** Several numbers above come from aggregators
    because the paper hosts were unreachable from this session; a pass
    over the primary sources is owed before they are quoted elsewhere.

## 10. Questions for the owner

Answers change the scope, the stack and which proof runs first.

1. **Which rung is the goal, and what is the acceptance test?** Perceptual
   indistinguishability (a producer fails an ABX test) is the highest
   defensible bar; "the same project the producer built" is not
   recoverable (F1). Is L3 with ABX the target, or is L1 (notes plus
   sounds) already the product?
2. **Which songs?** In-the-box electronic music, or any song including
   bands, acoustic recordings and vocal-led pop? The first is where every
   stage has a chance; the second lowers the ceiling to L0 for most
   parts.
3. **Vocals and other recorded performances.** Place the separated stem as
   audio (L0), omit it, or synthesize a replacement? Synthesis of a real
   singer's voice is cloning; the recommendation is L0 and no cloning.
4. **Device vocabulary.** Native devices only, or also third-party
   plugins you own? Which packs and plugins are installed on the
   production machine, and which plugins expose their state (parameter
   surface or preset file format) so a patch can be written from
   outside?
5. **Sample vocabulary.** Factory library and Packs, your own library,
   subscription libraries? The index is local and never redistributed,
   but what it covers decides the retrieval hit rate (proof 5).
6. **Purpose.** A personal study and remake tool, or something others
   will use? Distribution triggers model-weight provenance, the Live
   SDK's non-redistributability if that channel is used, and the
   copyright questions in section 2.
7. **Draft-with-correction or one shot?** Is a loop where each stage
   writes a draft into the Set and reads your corrections back
   acceptable, or must the pipeline run unattended end to end?
8. **Machines and Live.** Mac model and memory for the Live host; whether
   an NVIDIA GPU or a cloud budget exists for training; Live version and
   edition; whether running long unattended render jobs on the
   production machine is acceptable (the data factory needs hours of
   Live time).
9. **Real ground truth and the prior.** Do you have Live projects with
   their finished renders (your own tracks, collaborators', purchased
   project files, demo Sets)? They are the only real-song cases where
   every stage can be scored exactly, and the only data for the prior
   `p(P)`.
10. **Time and order.** Is this a research track beside the current work
    queue, and which proof do you want first? The recommendation is
    proofs 1 to 3 in that order: no machine learning, and they settle the
    output representation, the render path and whether proxies are
    viable, which is the whole architecture.

## Sources

Primary hosts (arxiv.org, huggingface.co, mvsep.com, ableton.com) were
unreachable from the session that wrote this; entries marked (unread)
were reported from search extracts or READMEs and need a direct read.

Live control and representation
- Extensions SDK: https://ableton.github.io/extensions-sdk/ (unread);
  local reference `.claude/skills/ableton-extension/references/api.md`.
- Live beta release notes (SDK changes by build):
  https://www.ableton.com/en/release-notes/live-12-beta/ (unread).
- Export is offline: https://help.ableton.com/hc/en-us/articles/209067709 (unread).
- Live 12 Remote Script sources (LOM allowlist, Push automation):
  https://github.com/gluon/AbletonLive12_MIDIRemoteScripts
- Producer Pal 2.5.0 (envelopes via remote script):
  https://github.com/adamjmurray/producer-pal/pull/1230
- LivePilot: https://github.com/dreamrec/LivePilot ; AbletonOSC:
  https://github.com/ideoforms/AbletonOSC ; ableton-mcp:
  https://github.com/ahujasid/ableton-mcp
- `.als` tooling: https://github.com/kevinkirsten/ableton-als ,
  https://github.com/kmontag/buildable , https://github.com/theokyr/ablesharp ,
  https://github.com/SpendLessDaw/ts-als ,
  https://github.com/hodel33/ableton-project-processor ,
  https://github.com/offlinemark/dawtool ,
  https://github.com/DBraun/abletonparsing
- DawDreamer: https://github.com/DBraun/DawDreamer

Separation
- Hybrid Transformer Demucs: arXiv 2211.08553; https://github.com/facebookresearch/demucs
- BS-RoFormer: arXiv 2309.02612 (unread); https://github.com/lucidrains/BS-RoFormer
- Mel-Band RoFormer: arXiv 2310.01809 (unread)
- SCNet: arXiv 2401.13276 (unread); https://github.com/starrytong/SCNet
- Model zoo and training framework: https://github.com/ZFTurbo/Music-Source-Separation-Training
- MVSEP leaderboard: https://mvsep.com/quality_checker/leaderboard.php (unread)
- LarsNet: arXiv 2312.09663; https://github.com/polimi-ispl/larsnet
- DrumSep: https://github.com/inagoy/drumsep
- Banquet: arXiv 2406.18747; https://github.com/kwatcharasupat/query-bandit
- AudioSep: arXiv 2308.05037; https://github.com/Audio-AGI/AudioSep
- GuideSep: arXiv 2507.01339 (unread); SAM Audio: arXiv 2512.18099;
  https://github.com/facebookresearch/sam-audio
- SDX'23 overview: arXiv 2308.06979; MoisesDB: arXiv 2307.15913;
  "Beyond SDR": arXiv 2609.04224 (unread)

Transcription, rhythm, structure
- Kong et al. piano: arXiv 2010.01815; https://github.com/bytedance/piano_transcription
- MT3: arXiv 2111.03017; https://github.com/magenta/mt3
- YourMT3+: arXiv 2407.04822 (unread); https://github.com/mimbres/YourMT3
- Basic Pitch: https://github.com/spotify/basic-pitch
- PESTO: arXiv 2309.02265; https://github.com/SonyCSLParis/pesto
- ADTOF: https://github.com/MZehren/ADTOF ; Riley and Dixon: arXiv
  2509.24853 (unread); Melucci et al.: arXiv 2601.09520;
  https://github.com/pier-maker92/ADT_STR
- Quantization: https://github.com/cheriell/PM2S ; Wachter et al.: arXiv 2508.19262
- Beat This!: arXiv 2407.21658 (unread); https://github.com/CPJKU/beat_this
- All-In-One: arXiv 2307.16425; https://github.com/mir-aidj/all-in-one
- SongFormer: arXiv 2510.02797; https://github.com/ASLP-lab/SongFormer
- S-KEY: arXiv 2501.12907; ChordFormer: arXiv 2502.11840

Retrieval and sample identification
- audfprint: https://github.com/dpwe/audfprint ; Panako:
  https://github.com/JorenSix/Panako ; Olaf: https://github.com/JorenSix/Olaf
- Neural Audio Fingerprint: https://github.com/mimbres/neural-audio-fp ;
  GraFPrint: arXiv 2410.10994; PeakNetFP: arXiv 2506.21086; foundation-
  model fingerprints: arXiv 2511.05399
- Sample identification: arXiv 2502.06364; NeuralSampleID: arXiv
  2506.14684, https://github.com/chymaera96/NeuralSampleID ; Riou et
  al.: arXiv 2510.11507 (unread); Sample100:
  https://github.com/jvbalen/sample_100
- CLAP: arXiv 2211.06687; https://github.com/LAION-AI/CLAP ; MERT: arXiv
  2306.00107; https://github.com/yizhilll/MERT
- Timbre-similarity studies: arXiv 2507.07764; arXiv 2510.14249

Sound matching and metrics
- Yee-King et al. 2018: doi 10.1109/TETCI.2017.2783885
- InverSynth: arXiv 1812.06349; InverSynth II:
  https://archives.ismir.net/ismir2023/paper/000076.pdf
- Masuda and Saito: doi 10.1109/TASLP.2023.3237161;
  https://github.com/hyakuchiki/SSSSM-DDSP
- Sound2Synth: arXiv 2205.03043; https://github.com/Sound2Synth/Sound2Synth
- torchsynth: arXiv 2104.12922; https://github.com/torchsynth/torchsynth
- White Box Search: arXiv 2305.12868; DiffMoog: arXiv 2401.12570;
  https://github.com/aisynth/diffmoog
- Bruford et al. (Massive): arXiv 2407.16643
- Hayes 2025 (symmetry): arXiv 2506.07199
- Modulation Discovery: arXiv 2510.06204; https://github.com/christhetree/mod_discovery
- INSTRUMENTAL: arXiv 2603.15905
- DDSynth-RL: arXiv 2608.03032; https://github.com/DDSynth-RL/DDSynthRL
- Neural proxies (Combes et al.): arXiv 2509.07635
- FM-SynAPSE: arXiv 2608.18226
- Losses: auraloss https://github.com/csteinmetz1/auraloss ; Turian and
  Henry: arXiv 2012.04572; Hayes 2023 frequency estimation: arXiv
  2210.14476; spectral optimal transport: arXiv 2312.14507; PNP loss:
  arXiv 2311.14213; CDPAM: arXiv 2102.05109; Salimi 2025: arXiv 2506.22628
- Products: Synplant 2 Genopatch (Sound On Sound review), Fadr SynthGPT
  https://fadr.com/synthgpt

Effects and mix
- Comunità 2021: https://www.aes.org/e-lib/browse.cfm?elib=21124 (unread);
  Hinrichs 2022: doi 10.1186/s13636-022-00257-4; Guo and McFee 2023:
  https://github.com/fisheggg/SFXlearner
- Take et al. 2024: https://dafx.de/paper-archive/2024/papers/DAFx24_paper_53.pdf (unread);
  Okita et al. 2026: arXiv 2604.22276 (unread); LLM2Fx-Tools: arXiv 2512.01559 (unread)
- Lee et al. blind graph estimation: arXiv 2303.08610; pruning: arXiv
  2406.01049 and arXiv 2509.15948; https://github.com/sh-lee97/grafx-prune ;
  grafx: arXiv 2408.03204; https://github.com/sh-lee97/grafx
- DiffVox: arXiv 2504.14735; https://github.com/SonyResearch/diffvox
- Peladeau and Peeters 2024: arXiv 2310.11781;
  https://github.com/peladeaucome/ICASSP-2024-BEAFX-using-DDSP
- DRC inversion: arXiv 2411.04337; de-limiter: arXiv 2308.01187;
  https://github.com/jeonchangbin49/De-limiter
- DeepAFx-ST: arXiv 2207.08759; https://github.com/adobe-research/DeepAFx-ST ;
  ST-ITO: arXiv 2410.21233; https://github.com/csteinmetz1/st-ito ;
  Diff-MST: arXiv 2407.08889; https://github.com/sai-soum/Diff-MST ;
  FxNorm-automix: arXiv 2208.11428; https://github.com/sony/FxNorm-automix ;
  mixing style transfer: arXiv 2211.02247;
  https://github.com/jhtonyKoo/music_mixing_style_transfer ; ITO-Master:
  arXiv 2506.16889; Fx-Encoder++: arXiv 2507.02273;
  https://github.com/SonyResearch/Fx-Encoder_PlusPlus
- RemFX: arXiv 2308.16177; https://github.com/mhrice/RemFX ; distortion
  recovery: arXiv 2407.16639; vocal dereverberation: arXiv 2211.04124;
  FiNS: arXiv 2107.07503
- Modulation extraction: arXiv 2305.13262;
  https://github.com/christhetree/mod_extraction ; DJ mixer trajectories:
  https://mac.kaist.ac.kr/pubs/KimYangNam-dafx2022.pdf (unread)
- Colonel and Reiss 2023: https://aes2.org/publications/elibrary-page/?id=22234 (unread);
  Differentiable Mixing Console: arXiv 2010.10291;
  https://github.com/csteinmetz1/automix-toolkit
- Libraries: https://github.com/csteinmetz1/dasp-pytorch ;
  https://github.com/DiffAPF/torchcomp ; https://github.com/mcomunita/nablafx ;
  https://github.com/spotify/pedalboard ; https://github.com/csteinmetz1/pyloudnorm ;
  https://github.com/sergree/matchering
- Evaluation guidance: https://dl4am.github.io/tutorial (unread)

## Appendix A. Inventory of existing artifacts (unvalidated)

What the repository holds today, as an inventory. None of it has been
validated thoroughly, none of it constrains the approach above, and the
proofs re-measure anything they touch.

- Live link: an Extensions SDK gateway extension (HTTP on localhost)
  with 27 operations: read Set summary, clips, notes and every device
  parameter (raw values); create and edit tracks, scenes, MIDI and audio
  clips; insert built-in devices by name; set parameters and mixer
  values; replace a Simpler sample; render pre-effect audio of audio
  tracks. No transport, automation, routing or preset loading (the SDK
  lacks them). A Max for Live device adds transport, clip launch and
  real-time post-effect capture over OSC. Verified parameter surface:
  Operator 195 named parameters; Serum 2 one. Mixer and Compressor
  raw-to-display mappings are single calibration points.
- CLI: about a hundred commands covering drum, phrase, chord, arpeggio,
  bass and break generation; arrangement planning; reference-track
  analysis (tempo, grid, energy arc, rule-based sections, section
  marker clips); Operator recipes and an Operator sound-matching
  proposal; sample indexing with spectral features and CLAP embeddings;
  mix measurement, A/B and sidechain calibration; a project template
  copier; `.alc` clip generation by string surgery on a captured
  template.
- Analysis engine (Python): loudness, true peak, spectrum, stereo,
  dynamics, bands, pitch, Basic Pitch audio-to-MIDI, onset-based break
  slicing, drum statistics, CLAP embeddings, Operator matching by f0,
  harmonicity, partials and envelope fit. No separation, key, chord or
  drum transcription.
- Knowledge base: 47 entries (drum styles, breaks, arps, 808s,
  arrangement grammars, eight Operator recipes with unverified raw
  values, device-surface and sidechain setup notes). No parameter maps
  for any device other than Operator; no preset collection.
- Research notes: reference-track analysis reliability ranking and a
  license matrix; data-driven mixing claims; audio-to-MIDI options;
  Live capability matrix (SDK versus M4L versus CLI); bridge landscape.
- Tests: in-memory fake Live Set for the Node suites; Python suite with
  a coverage floor; CI runs lint, build, both suites and the groundwork
  checks. The extension itself has no test suite.
- Decision records: ADR-001 (Extensions-SDK-first bridge; accepted
  losses: transport, clip move and split); ADR-002 (MIT license, no GPL
  or AGPL in the tree, GPL tools only as subprocesses).
- Status: the work queue is a CI and coverage plan; nothing in it
  concerns song recreation.
