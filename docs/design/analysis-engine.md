# Design: Analysis engine (M6 — R5, R10)

- Status: in build (2026-08-17). Science basis: `docs/research/data-driven-mixing.md`.
- Principle: **measurements + explanations, never vibes**. The engine reports
  numbers and prioritized findings tied to concrete device moves. The agent
  interprets and explains but never invents a number. Ears remain the arbiter.

## Architecture

```
Live (post-FX audio) ──► M4L capture tap ──► WAV file ─┐
Live (pre-FX)        ──► awh render (SDK) ─────────────┤
any exported audio   ──────────────────────────────────┴─► awh_analysis (Python)
                                                            │  JSON measurements + findings
                                          awh mix … (Node CLI wrapper, pretty/JSON)
```

- **`analysis/`: Python package `awh_analysis`** (numpy/scipy/soundfile:
  BSD; pyloudnorm: MIT). All DSP lives here, invoked as
  `python -m awh_analysis <cmd> --json`. Deterministic: same file, same
  numbers. The Node workspace does no DSP.
- **`awh mix` (Node)** spawns the venv Python (`$AWH_PYTHON`, else
  `.venv/bin/python` at repo root, else `python3`) and renders reports.
- **M4L capture tap** (`m4l/`): a small Max for Live audio device on the
  master (or any chain end) with audio passthrough + `sfrecord~`, driven by
  the CLI over OSC/UDP (localhost). M4L has full LOM access, so it also
  starts/stops transport over a chosen loop. This restores the
  measure→adjust→verify loop that ADR-001 accepted losing. Optional: every
  `awh mix` analysis command also accepts already-rendered files.

## Measurements (defined here; implementations must match)

All computed on float64 over the full file (or `--from/--to` seconds), with a
stereo downmix only where stated. Sample rate comes from the file. Nothing is
resampled except for true-peak oversampling.

| Measurement | Definition |
|---|---|
| **LUFS-I** | BS.1770-4 integrated: K-weighting (pre-filter shelf +1.53 dB@~1.68 kHz f_c 1681.97 Hz + RLB high-pass 38.13 Hz), 400 ms blocks / 75% overlap, absolute gate −70 LUFS then relative gate −10 LU. Use pyloudnorm (validated) |
| **LUFS-S** | Short-term, 3 s window, 1 s hop: report max and the series |
| **dBTP** | True peak: ≥4× polyphase oversampling (`scipy.signal.resample_poly`), max abs over channels, dB |
| **PSR** | Per 3 s window: (window true peak dB) − (window LUFS-S). Report min PSR over the **loudest sections** = windows with LUFS-S within 3 LU of max. Flag < 8 (Shepherd) |
| **Third-octave spectrum** | Welch PSD (4096 FFT, Hann, 50%), integrated into IEC 61260 base-10 third-octave bands 25 Hz–20 kHz, mono downmix (L+R)/2, dB. Reported **normalized to 0 dB mean over 100 Hz–4 kHz** so level cancels |
| **Spectral tilt** | Linear fit of band dB vs log2(f), 100 Hz–4 kHz → dB/oct. Healthy master ≈ −5 dB/oct (research); flag > ±1.5 from target |
| **Stereo width** | Side/Mid RMS energy ratio, dB, full band and per band group (lows <120 Hz, mids, highs) |
| **Phase correlation** | Pearson r of L,R: full band and low band (<120 Hz, 4th-order Butterworth). Flag low-band r < 0.8 (mono-compatibility / kick-bass phase) |
| **Waveform asymmetry** | Per channel: 20·log10(max(pos peak)/max(\|neg peak\|)) dB (99.9th percentiles to resist single-sample spikes) + sample skewness |
| **Phase-rotation headroom** | Sweep cascades of 2/4/6 first-order all-passes at f0 ∈ {100, 150, 200, 300, 400} Hz; for each, true peak at unchanged RMS; report best (peak reduction dB, f0, poles). Report-only (the move is made in Live/plugin) |
| **Beat-synced pump** | Requires `--bpm`: RMS envelope (10 ms window, 5 ms hop) folded modulo the beat period; depth = max−min of the beat-averaged envelope dB; recovery time to 90%; trough offset from grid (ms); shape classification: `ducking-like` (trough ≤60% into the cycle and ≥50% recovered by cycle end), `decay-like` (trough >75%, <30% recovered), else `ambiguous`. **Limit found in live verification: one file cannot prove a sidechain is engaged**, because a retriggered note's own decay folds to the same periodicity. Misalignment warnings fire only on ducking-like shapes. Definitive verification: capture with the compressor on vs bypassed and `awh mix ab` the pair (the depth delta is the evidence). Report per band (full, <120 Hz) |
| **Delivery check** | Targets: `club` −8..−6 LUFS-I, `streaming` −14, `apple` −16; all ≤ −1 dBTP. Pass/fail + delta |

### Genre targets (measured, not folklore)

`awh mix target <refs...> --save <name>` measures the owner's reference
tracks into `library/targets/<name>.json`: per-band median + IQR of the
normalized third-octave spectrum, tilt, LUFS/PSR/width/low-band-correlation
stats, and the source file list (provenance). `awh mix report --target <name>`
adds per-band deltas, flagging |delta| > max(3 dB, IQR). There is no
pink-noise target (masters tilt ≈ −5 dB/oct, research).

### Findings (the explainable layer)

`report` emits `findings: [{id, severity: info|warn|alert, metric, value,
threshold, explanation, suggestion}]`, sorted alert→info. Suggestions name
concrete Live moves ("EQ Eight on master: −2 dB bell around 250 Hz", "raise
limiter ceiling / reduce input gain — PSR 5.4 in the drop"). Every finding
carries its number, and the skill instructs the agent to quote, not embellish.

## A/B (`awh mix ab <a.wav> <b.wav>`)

Loudness-matched comparison (counters louder-sounds-better): gain-match both
to the quieter LUFS-I, then diff third-octave bands, LUFS/PSR/dBTP, width,
low-band correlation, and pump (if --bpm). Output: per-band delta table +
changed-findings summary. Once the capture tap is validated, `awh mix ab
--capture` will drive capture A → (owner tweaks) → capture B live.

## M4L capture tap protocol (localhost UDP/OSC)

Device listens on **9720** and replies to **9721** (both configurable in the
device UI):

| Message | Action |
|---|---|
| `/awh/record <abs path>` | open path in `sfrecord~` (wav 24-bit) and start recording |
| `/awh/stop` | stop recording (and transport if we started it) |
| `/awh/loop <startBeat> <lengthBeats>` | set arrangement loop + enable |
| `/awh/play <0\|1>` | stop/start transport (LOM `live_set` call) |
| `/awh/ping` | reply `/awh/pong <version>` |
| replies | `/awh/status recording\|stopped <path>` |

The Node side (`packages/cli/src/osc.ts`) hand-rolls the few OSC messages
with no dependency. `awh mix capture --bars 8 --from-bar 33 -o drop.wav` =
loop + record + play + wait + stop. The tap records wherever the device sits
(master = the mixdown; a bus = that bus post-FX).

The device source is committed as `m4l/AWH Capture Tap.maxpat` (JSON) and
built/frozen to `.amxd` in Max on the owner's machine (Suite includes Max).
`m4l/README.md` documents the freeze and a manual patching fallback if the
generated patch fights Max's validator.

## M4L Ducker OSC protocol (localhost UDP/OSC)

The full-auto duck strategy (see Duck strategies, below): a transport-synced
gain-envelope audio effect on the Sidechain bus. It fires a programmed
attack/hold/release dip whenever Live's playhead crosses one of the pushed
trigger beats, modulo a pattern length, so it loops with the Trigger clip.
Device listens on **9722**, replies to **9723**:

| Message | Action |
|---|---|
| `/awh/duck/ping` | reply `/awh/duck/pong <version>` |
| `/awh/duck/shape <attackMs> <holdMs> <releaseMs> <depthDb>` | set the envelope (`depthDb` is a positive number: dB of gain reduction at the trough) |
| `/awh/duck/triggers <patternLengthBeats> <beat0> <beat1> ...` | trigger positions in beats within one loop of the pattern |
| `/awh/duck/on <0\|1>` | enable / bypass (bypass = unity gain, snapped instantly) |
| `/awh/duck/status` | reply `/awh/duck/status <on> <attackMs> <holdMs> <releaseMs> <depthDb> <nTriggers>` |

`awh mix duck push` = ping (device-loaded check, ~1 s timeout) → triggers →
shape → on 1. `--off` = ping → on 0. Source: `m4l/AWH Ducker.maxpat`
(built/frozen like the capture tap). `m4l/README.md` has the full protocol
table, a manual-patching fallback, and the transport-polling/envelope-firing
algorithm in prose.

## Pump v2 — trigger-locked detection (BUILT: `awh mix pump-check`)

The owner's template (`knowledge/setup/sidechain-template.md`) uses
ShaperBox Volume Shaper on a Sidechain bus, retriggered by a MIDI "Trigger"
track that mirrors the Kick & Snare pattern. Consequences for v2:

1. `awh mix pump-check <busCapture> --trigger-clip <path>` reads the
   Trigger clip's note starts via the gateway, aligns and averages the
   low-band envelope at each trigger (not a beat-period fold), fits the
   fixed dip model (depth/hold/exponential-tau, deterministic grid search,
   r² reported), and issues a verdict: ducking / no-duck / inconclusive.
   The retriggered-decay case (the v1 failure) is a passing negative
   control. A >20 dB peak-to-tail span adds a note that trigger-source
   bleed may dominate: capture the isolated ducked bus.
2. Fit the fixed, user-drawn dip (attack/hold/release + depth) from the
   trigger-aligned average envelope and report the fitted shape. Volume
   Shaper applies the same programmed envelope every hit, so a fit is the
   right model, not statistics.
3. Verification stays A/B: toggle ShaperBox Device On (one `device.param`
   call), capture both, `mix ab`. The v1 single-file shape heuristic
   (ducking-like/decay-like) remains a hint only. Live verification showed
   it mislabels full-mix captures as decay-like when the trigger source's
   own low end dominates the fold. It is only meaningful on the isolated
   ducked bus, and `duck measure`/`duck calibrate` are the reliable
   instruments either way.
4. The Python side gains `pump(x, sr, trigger_beats=[...])` alongside the
   beat-fold. The trigger-aligned path is preferred whenever a Trigger clip
   exists.

## Duck strategies (`awh mix duck` — fit / setup / measure / calibrate)

`fit` derives the ideal duck from the drums (trigger-aligned low-band
envelope). Realization strategies (owner decision: ShaperBox is one option):

- **ShaperBox** (manual): draw the fitted points. Preset files are
  unwritable (docs/research/shaperbox-preset-format.md).
- **Stock Compressor** (near-automatic): `setup` inserts + presets
  (fastest attack, max ratio). Routing and ms-dials stay manual (the SDK
  has no routing API). `calibrate` closes the loop: capture the ducked bus
  via the tap, `measure` the achieved trigger-aligned depth (25 ms envelope
  window to ride over sub-bass carrier ripple), and bisect the Threshold raw
  value until the target depth is hit. Direction is learned from two
  bracket probes because raw scales are unmapped. Raw↔display mappings
  observed during validation are recorded to knowledge/.
- **Volume automation**: not writable via the Extensions SDK (no
  automation/clip-envelope API, ADR-001). The parked offline-.als
  envelope-injection experiment is the only direct path.
- **AWH M4L Ducker** (BUILT, `awh mix duck push`): the full-auto option.
  `m4l/AWH Ducker.maxpat` is a transport-synced gain-envelope device. Curve
  and trigger pattern are pushed over OSC like the capture tap, with no
  routing clicks. The owner places it once by hand on the Sidechain bus (the
  SDK cannot insert M4L devices, the same limit as every other strategy
  here). After that, `duck fit --json > fit.json` →
  `duck push --fit fit.json --trigger-clip <Trigger clip>` drives it
  from the CLI. Protocol: see "M4L Ducker OSC protocol" above.

## Non-goals (scope, per research)

No taste judgments, no arrangement opinions, no auto-apply of EQ moves
(report suggests; the owner or an explicit follow-up command acts), no stem
separation here (M8), no "AI mastering". This is a meter with explanations.

## Masking toolkit (M6b — BUILT: `awh mix pitch` / `awh mix bands` / `awh mix layers`)

Closes four of the five gaps below (the annotated list under "Future work"
says which, and what is still open):

1. **`awh mix pitch <file> [--per-note]`** (`analysis/awh_analysis/pitch.py`):
   periodicity-tracked f0 via pyin (opmatch.py's proven approach, never a
   naive FFT-peak pick). Reports median f0, note name + cents deviation,
   f0 stability (semitone std across voiced frames), voiced fraction, and
   confidence (mean pyin voiced probability). It separately reports
   **harmonic dominance**: per voiced frame, whether any of partials 2-5
   exceeds the fundamental's magnitude, with the ratio and where it
   happened. The failure caught live (a growl's 2nd harmonic outshining its
   fundamental) is surfaced as information instead of corrupting the pitch
   estimate. `--per-note` segments via `duck.detect_onsets` and reports each
   note's f0/stability/dominance rather than one average across a changing
   melody. Unvoiced/silent/too-short is a reported `state`, never an
   exception.
2. **`awh mix bands <fileA> [fileB...] [--bands "lo-hi,..."]`**
   (`analysis/awh_analysis/bands.py`): calibrated per-band dBFS. A Welch
   periodogram (spectrum.py's `welch_psd`, the same time-averaged machinery
   as the third-octave spectrum, not one FFT over the whole capture) is
   integrated per band and referenced so a full-scale sine (peak amplitude
   1.0) reads 0 dBFS, matching `loudness.py`'s true-peak discipline. Reports
   each band's dBFS and its fraction of the file's total signal power.
   Default bands: `20-100,100-140,140-200,200-500,500-2000`
   (sub/low/scoop zone/low-mid/mid, named in the output). Multiple files
   produce an aligned table with per-band `delta_db` against the first file.
   `--from/--to` seconds, same convention as `mix report`.
3. **`awh mix layers <track:N> <track:M>... [--bars N --from-bar N]`**
   (`packages/cli/src/layers.ts`): automates the solo->capture->unsolo
   choreography the gap report found being done by hand. For each track in
   sequence it reads the current solo state of every track, solos only that
   one (suspending any other soloed track, so the capture is isolated),
   captures via the M4L tap, then restores every track's solo state exactly.
   The restore runs in a `try/finally`, so a capture that throws (AWH
   Capture Tap not loaded, the classic offline case) still leaves the Set's
   solo state untouched. It then runs `mix bands` across the captures and
   prints the comparison table. Captures live in a temp dir (path printed);
   `--keep` retains it, otherwise it is removed after the compare. Zero
   tracks is a printed state, not an error.

`packages/cli/test/layers.test.ts` proves the solo-restore property twice:
on a happy multi-track run (an unrelated pre-existing solo elsewhere in the
Set stays soloed throughout), and as a negative control where an injected
capture failure aborts mid-run. Either way, solo state reads back identical
to how it started, verified with a real `set.summary` read-back rather than
an in-memory assertion. `analysis/tests/test_pitch.py` / `test_bands.py`
cover the regression case (a synthetic tone with a dominant 2nd harmonic:
f0 stays at the fundamental and the dominance is flagged), pure-tone/silence
states, calibration sanity (full-scale sine ≈ 0 dBFS), and determinism.

## Future work: real gaps found doing real masking/mix analysis (2026-08-23)

A "does my sub compete with my call/response layers" question during a live
production session required throwaway numpy scripts outside `awh`. Gaps
found, in order of how much they would have helped:

- **No real pitch-detection tool.** The only option was a naive "loudest FFT
  bin" peak-picker, caught being wrong live: a growl patch's 2nd harmonic
  outshone its fundamental partway through a sustained note, and the picker
  reported the harmonic as the note. Answering "is this sample/patch's
  fundamental where the note name implies" (a recurring question before
  layering) needs autocorrelation/cepstral/YIN-style tracking that follows
  periodicity, not the tallest spectral spike.
  Status: CLOSED by `awh mix pitch` (M6b). The failure is a regression test
  (`test_pitch.py::test_growl_dominant_2nd_harmonic_f0_stays_at_fundamental_and_gets_flagged`):
  f0 lands on the fundamental and the dominance flag reports the takeover.
- **No reusable narrowband energy-compare command.** Comparing sub vs.
  scoop-zone (140-200 Hz) vs. low-mid energy across isolated layers is a
  recurring masking-diagnosis workflow that belongs in a command like
  `awh mix band-compare <fileA> <fileB> ... --bands "20-100,140-200,200-500"`.
  Status: CLOSED by `awh mix bands` (M6b), named to match the
  `awh mix <verb>` convention; a single file works as a plain per-band report.
- **The solo→capture→unsolo-per-layer workflow was manual**, with the risk
  of leaving a track soloed between steps.
  Status: CLOSED by `awh mix layers` (M6b), restore proven via a negative
  control in `layers.test.ts`.
- **Ad-hoc band-energy numbers were relative, not calibrated.** A bare
  `10*log10(sum of |FFT|^2)` only compares captures from the same sitting at
  the same gain staging. The tool should output calibrated per-band dBFS (or
  a LUFS-style per-band level), like `mix report`'s LUFS-I/true-peak numbers.
  Status: CLOSED. `awh mix bands` is calibrated so a full-scale sine reads
  0 dBFS, stated in every JSON payload (`calibration` field).
- **One FFT over a multi-bar capture smears time away**, treating a
  rhythmically changing bassline as a stationary tone. "Does this note's
  fundamental land in the danger zone" is about a moment, not an 8-bar
  average, so it needs a Welch periodogram or per-note segmentation.
  Status: CLOSED via Welch's method (the shared `welch_psd` in
  `bands.py`/`spectrum.py`) + `mix pitch --per-note` (onset-bounded).
  **Still open**: `bands` has no `--per-note`/per-onset flag, so a
  moment-in-time band question still means picking a narrow `--from/--to`
  window by hand (from `mix pitch --per-note` or `awh drums detect-onsets`
  onset times). Also open: `mix layers` does not cross-reference each
  layer's dominant-partial/pitch info against its bands; connecting
  `mix pitch --per-note` with `mix bands`/`mix layers` output is a manual
  (or agent-assisted) step.
- Confirmed, not a gap: `mix report`'s spectral tilt is intentionally
  broad-spectrum (100 Hz-4 kHz, one number). It correctly answered "is this
  mix bass-heavy overall" (no) but cannot answer a narrowband masking
  question; `awh mix bands` (M6b) covers that.
