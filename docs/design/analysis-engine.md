# Design: Analysis engine (M6 — R5, R10)

- Status: in build (2026-08-17). Science basis: `docs/research/data-driven-mixing.md`.
- Principle: **measurements + explanations, never vibes**. The engine reports
  numbers and prioritized findings tied to concrete device moves; Claude
  interprets and explains but NEVER invents a number. Ears remain the arbiter.

## Architecture

```
Live (post-FX audio) ──► M4L capture tap ──► WAV file ─┐
Live (pre-FX)        ──► awh render (SDK) ─────────────┤
any exported audio   ──────────────────────────────────┴─► awh_analysis (Python)
                                                            │  JSON measurements + findings
                                          awh mix … (Node CLI wrapper, pretty/JSON)
```

- **`analysis/` — Python package `awh_analysis`** (numpy/scipy/soundfile —
  BSD; pyloudnorm — MIT). All DSP lives here; invoked as
  `python -m awh_analysis <cmd> --json`. Deterministic: same file, same
  numbers. Nothing in the Node workspace does DSP.
- **`awh mix` (Node)** spawns the venv Python (`$AWH_PYTHON`, else
  `.venv/bin/python` at repo root, else `python3`) and renders reports.
- **M4L capture tap** (`m4l/`): a tiny Max for Live audio device on the
  master (or any chain end) — audio passthrough + `sfrecord~`, driven over
  OSC/UDP (localhost) by the CLI. Because M4L has full LOM access it also
  starts/stops transport over a chosen loop, restoring the
  measure→adjust→verify loop that ADR-001 accepted losing. Optional: every
  `awh mix` analysis command also accepts already-rendered files.

## Measurements (defined here; implementations must match)

All computed on float64, full file (or `--from/--to` seconds), stereo
downmix only where stated. Sample rate from file; resample nothing except
true-peak oversampling.

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
| **Waveform asymmetry** | Per channel: 20·log10(max(pos peak)/max(|neg peak|)) dB (99.9th percentiles to resist single-sample spikes) + sample skewness |
| **Phase-rotation headroom** | Sweep cascades of 2/4/6 first-order all-passes at f0 ∈ {100, 150, 200, 300, 400} Hz; for each, true peak at unchanged RMS; report best (peak reduction dB, f0, poles). Report-only (the move is made in Live/plugin) |
| **Beat-synced pump** | Requires `--bpm`: RMS envelope (10 ms window, 5 ms hop) folded modulo the beat period; depth = max−min of the beat-averaged envelope dB; recovery time to 90%; trough offset from grid (ms); SHAPE classification — `ducking-like` (trough ≤60% into the cycle AND ≥50% recovered by cycle end), `decay-like` (trough >75%, <30% recovered), else `ambiguous`. **Honest limit (found in live verification): one file cannot prove a sidechain is engaged** — a retriggered note's own decay folds to the same periodicity. Misalignment warnings fire only on ducking-like shapes; definitive verification = capture with the compressor on vs bypassed and `awh mix ab` the pair (depth delta is the evidence). Report per-band (full, <120 Hz) |
| **Delivery check** | Targets: `club` −8..−6 LUFS-I, `streaming` −14, `apple` −16; all ≤ −1 dBTP. Pass/fail + delta |

### Genre targets (measured, not folklore)

`awh mix target <refs...> --save <name>` measures the owner's own reference
tracks → `library/targets/<name>.json`: per-band median + IQR of the
normalized third-octave spectrum, tilt, LUFS/PSR/width/low-band-correlation
stats, and the source file list (provenance). `awh mix report --target <name>`
then adds per-band deltas, flagging |delta| > max(3 dB, IQR). No pink-noise
target anywhere (masters tilt ≈ −5 dB/oct, research).

### Findings (the explainable layer)

`report` emits `findings: [{id, severity: info|warn|alert, metric, value,
threshold, explanation, suggestion}]`, sorted alert→info. Suggestions name
concrete Live moves ("EQ Eight on master: −2 dB bell around 250 Hz", "raise
limiter ceiling / reduce input gain — PSR 5.4 in the drop"). Every finding
carries its number; the skill instructs Claude to quote, not embellish.

## A/B (`awh mix ab <a.wav> <b.wav>`)

Loudness-matched comparison (counters louder-sounds-better): gain-match both
to the quieter LUFS-I, then diff third-octave bands, LUFS/PSR/dBTP, width,
low-band correlation, pump (if --bpm). Output: per-band delta table +
changed-findings summary. With the capture tap validated, `awh mix ab
--capture` will drive capture A → (owner tweaks) → capture B live.

## M4L capture tap protocol (localhost UDP/OSC)

Device listens on **9720**, replies to **9721** (both configurable in the
device UI):

| Message | Action |
|---|---|
| `/awh/record <abs path>` | open path in `sfrecord~` (wav 24-bit) and start recording |
| `/awh/stop` | stop recording (and transport if we started it) |
| `/awh/loop <startBeat> <lengthBeats>` | set arrangement loop + enable |
| `/awh/play <0\|1>` | stop/start transport (LOM `live_set` call) |
| `/awh/ping` | reply `/awh/pong <version>` |
| replies | `/awh/status recording\|stopped <path>` |

The Node side (`packages/cli/src/osc.ts`) hand-rolls the few OSC messages —
no dependency. `awh mix capture --bars 8 --from-bar 33 -o drop.wav` =
loop + record + play + wait + stop. The tap records wherever the device sits
(master = the mixdown; a bus = that bus post-FX).

Source of the device is committed as `m4l/AWH Capture Tap.maxpat` (JSON) —
built/frozen to `.amxd` in Max on the owner's machine (Suite includes Max);
`m4l/README.md` documents the freeze + a manual patching fallback if the
generated patch fights Max's validator.

## Pump v2 — trigger-locked detection (BUILT: `awh mix pump-check`)

The owner's template (`knowledge/setup/sidechain-template.md` — read it)
uses ShaperBox Volume Shaper on a Sidechain bus, retriggered by a MIDI
"Trigger" track that mirrors the Kick & Snare pattern. Consequences for v2:

1. `awh mix pump-check <busCapture> --trigger-clip <path>`: reads the
   Trigger clip's note starts via the gateway, aligns + averages the
   low-band envelope at each trigger (not a beat-period fold), FITS the
   fixed dip model (depth/hold/exponential-tau, deterministic grid search,
   r² reported) and issues a verdict: ducking / no-duck / inconclusive —
   with the retriggered-decay case (the v1 killer) as a passing negative
   control. A >20 dB peak-to-tail span adds an honest note that
   trigger-source bleed may dominate: capture the ISOLATED ducked bus.
2. Fit the fixed, user-drawn dip (attack/hold/release + depth) from the
   trigger-aligned average envelope and report the fitted shape — Volume
   Shaper applies the same programmed envelope every hit, so a fit is the
   honest model, not statistics.
3. Verification stays A/B: toggle ShaperBox Device On (one `device.param`
   call) → capture both → `mix ab`. The v1 single-file shape heuristic
   (ducking-like/decay-like) remains a hint only — live verification
   showed it mislabels full-MIX captures as decay-like when the trigger
   source's own low end dominates the fold; it is only meaningful on the
   isolated ducked bus, and `duck measure`/`duck calibrate` are the
   reliable instruments either way.
4. Python side gains `pump(x, sr, trigger_beats=[...])` alongside the
   beat-fold; the trigger-aligned path is preferred whenever a Trigger clip
   exists.

## Duck strategies (`awh mix duck` — fit / setup / measure / calibrate)

`fit` derives the ideal duck from the drums (trigger-aligned low-band
envelope). Realization strategies (owner decision: ShaperBox is ONE option):

- **ShaperBox** (manual): draw the fitted points; preset files are
  unwritable (docs/research/shaperbox-preset-format.md).
- **Stock Compressor** (near-automatic): `setup` inserts + presets
  (fastest attack, max ratio); routing and ms-dials stay manual (the SDK
  has no routing API). `calibrate` then closes the loop — capture the
  ducked bus via the tap, `measure` the achieved trigger-aligned depth
  (25 ms envelope window to ride over sub-bass carrier ripple), bisect the
  Threshold raw value (direction learned from two bracket probes — raw
  scales are unmapped) until the target depth is hit. Raw↔display
  mappings observed during validation get recorded to knowledge/.
- **Volume automation**: not writable via the Extensions SDK (no
  automation/clip-envelope API — ADR-001). Future full-auto option: an AWH
  M4L "Ducker" device (transport-synced gain envelope, curve + trigger
  pattern pushed over OSC like the capture tap — no routing clicks at
  all); or the parked offline-.als envelope-injection experiment.

## Non-goals (honest scope, per research)

No taste judgments, no arrangement opinions, no auto-apply of EQ moves
(report suggests; owner or an explicit follow-up command acts), no stem
separation here (M8), no "AI mastering" — this is a meter with explanations.
