# Research: Data-Driven Mixing & Mastering — What's Supported vs Folklore (Aug 2026)

Context: evaluating a measurement-fed AI mixing assistant (spectrum/loudness/phase data,
not "ears") for house/techno/trap. An ear test remains the final arbiter; the question
is whether measurements give a genuinely useful starting point and error-detector.

## Verdict table

| Claim | Status |
|---|---|
| Masters follow a smooth downward spectral tilt | **Supported** — but ≈ **-5 dB/octave** (100 Hz–4 kHz, plateau below ~100 Hz, faster rolloff above ~4 kHz), noticeably darker than pink noise's -3 dB/oct. Source: Pestana, Ma, Reiss et al., "Spectral Characteristics of Popular Commercial Recordings 1950–2010" (AES 135, 2013) |
| "Balance levels against pink noise" | Supported as a quick rough-balance heuristic (SOS, Owsinski, Anderton); ballpark only — biases flat, fails on dynamic sources. Don't target literal pink slope in the mix spectrum |
| EDM-specific spectra | Genre variance is real but secondary: EDM runs lighter midrange, extended lows; spectra have flattened (more bass + treble) over decades (JASA 2019 bass study) |
| Auto-mixing can match professionals | **Supported in listening tests** on tested material: De Man & Reiss KEAMS (AES 2013) ≈ human; Sony FxNorm-automix (ISMIR 2022) statistically indistinguishable overall and **better than humans on clarity/masking** (p=0.008/0.013) |
| Phase rotation buys headroom | **Supported & measurable**: asymmetric sources (voice, brass, saw bass) show up to ~6 dB waveform asymmetry; cascaded all-pass rotation (broadcast practice, ~4 poles around 200 Hz) recovers **1–4 dB peak headroom** with zero magnitude-spectrum change. Cost: group-delay smear on transients — suits bass/vocals/full masters, not drum buses |
| "Mastering needs linear-phase EQ" | Largely folklore; pre-ringing (worst low-freq high-Q) is the real, measurable artifact of linear phase; minimum-phase shift is usually inaudible |
| Tempo-formula sidechain release | Deterministic craft math, no formal research: cycle = 60000/BPM ms; release commonly 60–85% of the inter-kick interval depending on pump style (~150–200 ms at house tempi). Well-suited to automation + verification from the rendered gain envelope; "one correct formula" is lore |
| Hypercompression ruins music | **Not supported** at moderate-high levels: Hjortkjær & Walther-Hansen (JAES 2014) found no listener preference for less-compressed remasters; sales studies show no penalty. Extreme limiting still fails audibly — first casualty is the kick's front edge |
| Measurements can flag over-limiting | **Supported**: PSR (peak-to-short-term-loudness, BS.1770) is a validated crest proxy; Ian Shepherd's guideline **PSR ≥ 8 in loudest sections**. Full perceptual "clean loudness" prediction remains open research |
| Streaming loudness targets (2026) | Spotify -14 LUFS (Loud -11/Quiet -23), Apple -16, YouTube -14 (attenuate-only), Tidal/Amazon -14, Deezer -15; true peak ≤ -1 dBTP (-2 for loud masters into lossy codecs). **Club masters: no normalization; -8 to -6 LUFS-I common** |

## Key mechanism insight

Every respected commercial tool works by measurement-vs-statistical-target comparison,
not holistic "listening": iZotope Tonal Balance Control (genre target *bands* averaged
from thousands of masters), sonible smart:EQ (learned spectral profiles → corrective
dynamic EQ), LANDR (micro-genre reference matching), Gullfoss (computational
masking/attention model), Soothe2 (narrow-band resonance detection, cut-only).
An LLM fed third-octave long-term spectrum, LUFS/PSR, stereo/phase correlation, and
per-band dynamics is doing the same class of computation — with the advantage of being
able to explain, prioritize, and tie findings to concrete device moves.

Supporting evidence that objective features track perception: Wilson & Fazenda —
perceived production quality correlates most with loudness and DRC signal features.

## Relevant academic threads

- Field: "Ten Years of Automatic Mixing" (De Man, Reiss, Stables 2017); *Intelligent
  Music Production* (Routledge 2019).
- Dynamics: Ma et al., Intelligent Multitrack DRC (JAES 2015); Giannoulis et al.,
  compressor design tutorial incl. program-dependent auto ballistics (JAES 2012).
- Deep learning: DeepAFx-ST (Adobe/QMUL), Diff-MST (reference-based mix parameter
  prediction, 2024), Sony FxNorm-automix, ITO-Master (2025, reference-based mastering).
- Engineers want **assistive, explainable** tools, not black boxes (Vanka et al. 2023
  adoption study) — matches our "report + suggested moves, human decides" design.

## Open-source building blocks for an analysis engine

- **pyloudnorm** — BS.1770 gated LUFS, accuracy validated vs commercial meters (AES paper)
- **librosa / Essentia** — STFT, spectral descriptors, rhythm, key; Essentia has EBU R128
- **scipy** — all-pass cascades (phase rotation), Hilbert (asymmetry), correlation
- **Matchering 2.0** — open-source reference mastering (RMS/FR/peak/stereo matching)
- **FFmpeg** ebur128/loudnorm; **pedalboard** (Spotify) for applying chains in Python
- Asymmetry metric: positive/negative peak ratio or sample skewness; auto phase-rotation
  optimizer = sweep all-pass frequency/order, minimize true peak at constant loudness
  (a few dozen lines; Airwindows PhaseNudge is an MIT-licensed reference)

## Prior art in the MCP space (none genre-tuned for electronic music yet)

- fadelabs/phantom — 20 measurement tools (spectrum, R128, dynamics, stereo, phase
  coherence, masking) + 9 genre profiles, REAPER bridge, AGPL-3.0
- dreamrec/LivePilot — 38 spectral/loudness analyzers, M4L FFT tap, offline librosa
  "listening engine" (groove microtiming, width, headroom)
- bschoepke/ableton-live-mcp — Agent Audio Tap M4L device: capture anywhere in the
  chain → arbitrary Python analysis → iterate
- HighVoltSound/ableton-auto-mix-mcp — librosa+pyloudnorm vs target profiles

## Implications for our project

1. A **measurement engine on rendered audio** (export or M4L tap) is viable, valuable,
   and buildable entirely from open-source parts; the science supports spectral-target,
   PSR, phase-asymmetry, and tempo-aware dynamics checks.
2. Genre-conditioned target bands (house/techno/trap references we measure ourselves)
   beat any universal curve, including pink noise.
3. Deterministic wins to automate: tempo-derived sidechain length (then verify pump
   depth from the rendered envelope), phase-rotation headroom on bass/master, PSR-based
   over-limiting alarms, LUFS/dBTP delivery checks per target (club vs streaming).
4. The honest scope: measurements excel at *tonal balance, loudness, phase, dynamics
   hygiene* — they cannot judge taste, arrangement, or sound design. Report + explain,
   producer decides.
