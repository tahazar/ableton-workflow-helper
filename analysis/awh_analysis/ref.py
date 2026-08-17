"""M8 reference-track deconstruction: tempo/grid, bar-synced energy arc, and
rule-based section detection. Deterministic DSP only (numpy/scipy) — see
`docs/design/reference-deconstruction.md` for the algorithm contract this
module implements, and `docs/research/reference-track-analysis.md` for why
these particular techniques were chosen over ML alternatives.

Every inferred quantity (tempo, downbeat, section) carries a confidence;
the honest failure mode is "low confidence", never a silently wrong answer.
Half/double-time tempo ambiguity is surfaced via `bpm_runner_up` and a note
rather than silently resolved.

Two deliberate deviations from the design doc's algorithm text, both
documented in-line at the point they happen:

1. Tempo SELECTION uses the raw autocorrelation peak (smoothed to shrug
   off a sample-alignment artifact, with a small "prefer the shorter of
   two near-tied periods" step for the standard octave-error correction),
   not a direct argmax of the harmonic-weighted score — the literal
   `ac(T) + 0.5*ac(2T) + 0.5*ac(T/2)` folds a candidate's own height into
   every one of its harmonics' scores, which for cleanly periodic loops
   (four-on-the-floor house, a click track) systematically outscores the
   true tempo with its own half-tempo. The harmonic score is still used
   exactly as specified for confidence and for surfacing the runner-up.
   Sub-BPM precision then comes from a joint period+phase refinement
   across every beat in the whole envelope (see `_refine_period_by_comb`),
   because a single autocorrelation lag sampled every ~11.6 ms (hop 512 @
   44.1k) doesn't reliably resolve to +/-0.1 BPM by itself.
2. `measurements` runs `report.analyze()` on a representative ~20 s
   excerpt, not the full file: `report.analyze()` does not scale to
   reference-length audio (its phase-rotation sweep alone re-oversamples
   the entire signal on the order of a dozen times — measured ~100 s on a
   2-minute file), which blows this module's own <30 s budget on a
   2-minute reference. `report.py` is unmodified; this only uses its
   existing `start_s`/`end_s` window.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import os

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view
from scipy.interpolate import CubicSpline
from scipy.ndimage import gaussian_filter1d, median_filter
from scipy.optimize import minimize, minimize_scalar
from scipy.signal import butter, sosfiltfilt, stft

from . import report
from .audio import load, to_mono

# ---------------------------------------------------------------------------
# Onset envelope + kick sub-band (design: "Tempo + beat grid", step 1)
# ---------------------------------------------------------------------------

ONSET_NFFT = 2048
ONSET_HOP = 512
ONSET_SUBBAND_HZ = 150.0  # kick-tracking sub-band, 4th-order Butterworth

# ---------------------------------------------------------------------------
# Tempo (design step 2)
# ---------------------------------------------------------------------------

TEMPO_BPM_MIN = 60.0
TEMPO_BPM_MAX = 200.0
TEMPO_HARMONIC_WEIGHT = 0.5  # ac(T) + 0.5*ac(2T) + 0.5*ac(T/2)
TEMPO_HARMONIC_RATIO_TOL = 0.03  # +/-3% treated as a harmonic of the best
TEMPO_AMBIGUITY_NOTE_RATIO = 0.85  # runner-up/best score ratio -> note it
TEMPO_AC_SMOOTH_SIGMA = 1.2  # lags, smooths sample-alignment ac artifacts
TEMPO_OCTAVE_TIE_TOL_ABS = 0.08  # near-tied smoothed peaks (ac units) -> prefer shorter period
TEMPO_MIN_TIE_PEAK = 0.15  # ac floor a peak must clear to compete in that tie-break

# ---------------------------------------------------------------------------
# Beat phase / downbeat (design steps 3-4)
# ---------------------------------------------------------------------------

BEAT_PHASE_GRID_STEPS = 240  # coarse comb search resolution across one period
DOWNBEAT_LOW_CONFIDENCE = 0.4

# ---------------------------------------------------------------------------
# Bar-synced energy arc (design: "Bar-synced energy arc")
# ---------------------------------------------------------------------------

BAR_SUB_HZ = 100.0
BAR_HIGH_HZ = 5000.0
_DB_FLOOR = 1e-9

# ---------------------------------------------------------------------------
# Section rules (design: "Section rules", exact thresholds)
# ---------------------------------------------------------------------------

SMOOTH_MEDIAN_BARS = 3

DROP_JUMP_DB = 3.0
DROP_PREV_MEAN_BARS = 4
DROP_SUB_WITHIN_MAX_DB = 6.0
DROP_MIN_SUSTAIN_BARS = 4

BREAKDOWN_DROP_DB = 3.0
BREAKDOWN_PREV_MEAN_BARS = 8
BREAKDOWN_SUB_BELOW_MAX_DB = 8.0
BREAKDOWN_MIN_SUSTAIN_BARS = 4

BUILD_MIN_SLOPE_DB_PER_BAR = 0.3
BUILD_MIN_BARS = 4
BUILD_MAX_WINDOW_BARS = 32
BUILD_SLOPE_TIE_TOL = 0.01  # dB/bar: windows this close in slope are "tied" -> prefer longer

INTRO_OUTRO_ENERGY_FRACTION = 0.6
INTRO_OUTRO_DB = 10.0 * np.log10(INTRO_OUTRO_ENERGY_FRACTION)  # ~= -2.22 dB

MIN_REFERENCE_DURATION_S = 10.0
MEASUREMENTS_EXCERPT_S = 20.0  # representative window handed to report.analyze()


# ---------------------------------------------------------------------------
# Onset envelope + kick sub-band
# ---------------------------------------------------------------------------


def onset_and_subband(mono: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray, float]:
    """Spectral-flux onset envelope + kick-tracking sub-band energy envelope.

    Both are computed on the same frame grid (2048-sample Hann window,
    512-sample hop) so they can be indexed/interpolated together.

    Returns
    -------
    onset_env : ndarray
        Half-wave-rectified spectral flux, summed over bins, per frame.
    sub_env : ndarray
        RMS of the <150 Hz band (4th-order Butterworth), per frame.
    hop_s : float
        Frame hop in seconds.
    """
    mono = np.asarray(mono, dtype=np.float64)
    nperseg = ONSET_NFFT
    hop = ONSET_HOP
    if mono.size < nperseg + hop:
        raise ValueError("signal too short for onset analysis")

    _freqs, _times, zxx = stft(
        mono,
        fs=sr,
        window="hann",
        nperseg=nperseg,
        noverlap=nperseg - hop,
        boundary=None,
        padded=False,
    )
    mag = np.abs(zxx)
    flux = np.sum(np.maximum(np.diff(mag, axis=1), 0.0), axis=0)
    onset_env = np.concatenate(([0.0], flux))

    sos = butter(4, ONSET_SUBBAND_HZ / (sr / 2.0), btype="lowpass", output="sos")
    sub_sig = sosfiltfilt(sos, mono)
    windows = sliding_window_view(sub_sig, nperseg)[::hop]
    sub_env = np.sqrt(np.mean(windows**2, axis=1))

    n = min(onset_env.size, sub_env.size)
    hop_s = hop / sr
    return onset_env[:n], sub_env[:n], hop_s


# ---------------------------------------------------------------------------
# Tempo: autocorrelation with harmonic scoring + parabolic refinement
# ---------------------------------------------------------------------------


def _autocorr_at_lags(env: np.ndarray, lags: np.ndarray) -> np.ndarray:
    """Normalized autocorrelation at each integer lag (frames)."""
    centered = env - np.mean(env)
    denom = float(np.sum(centered * centered))
    ac = np.zeros(len(lags), dtype=np.float64)
    if denom <= 0:
        return ac
    for i, lag in enumerate(lags):
        lag = int(lag)
        if lag == 0:
            ac[i] = 1.0
        else:
            ac[i] = float(np.dot(centered[:-lag], centered[lag:])) / denom
    return ac


TEMPO_COMB_MIN_BEATS = 8  # below this many beats, comb refinement isn't worth it


def _comb_sum(onset_env: np.ndarray, idx: np.ndarray, period_frames: float, offset_frames: float) -> float:
    n_frames = onset_env.size
    if period_frames <= 1.0:
        return 0.0
    n_beats = int(np.floor((n_frames - 1 - offset_frames) / period_frames)) + 1
    if n_beats < 2:
        return 0.0
    beat_frames = offset_frames + np.arange(n_beats) * period_frames
    beat_frames = beat_frames[(beat_frames >= 0) & (beat_frames <= n_frames - 1)]
    if beat_frames.size == 0:
        return 0.0
    return float(np.sum(np.interp(beat_frames, idx, onset_env)))


def _refine_period_by_comb(
    onset_env: np.ndarray, hop_s: float, lag_int: int, lag_min: float, lag_max: float
) -> float:
    """Jointly refine (period, phase) in frames by maximizing the comb sum
    of onset strength across every beat the envelope holds — see
    `estimate_tempo` for why this beats a single-peak parabolic fit.
    `lag_min`/`lag_max` are the valid candidate-BPM range in frames (NOT
    the wider autocorrelation domain) — refinement never drifts outside
    the BPM range the caller asked for.
    """
    n_frames = onset_env.size
    idx = np.arange(n_frames, dtype=np.float64)
    n_beats_at_lag = (n_frames - 1) / lag_int
    if n_beats_at_lag < TEMPO_COMB_MIN_BEATS:
        return float(np.clip(lag_int, lag_min, lag_max))

    # A 2D coarse grid over (period, phase) before polishing: the comb sum
    # can have multiple local optima close to the true one (e.g. a hat on
    # every 8th note nearly duplicates the kick's own periodicity), and
    # Nelder-Mead started from an offset-only search can lock onto the
    # wrong one. A small grid keeps the polish step starting in the right
    # basin without materially changing the cost.
    period_grid = float(lag_int) + np.linspace(-0.6, 0.6, 13)
    offset_grid = np.linspace(0.0, lag_int, 60, endpoint=False)
    best_grid_score = -np.inf
    period0, offset0 = float(lag_int), 0.0
    for p in period_grid:
        for o in offset_grid:
            s = _comb_sum(onset_env, idx, float(p), float(o))
            if s > best_grid_score:
                best_grid_score = s
                period0, offset0 = float(p), float(o)

    def neg_comb(params: np.ndarray) -> float:
        period_frames, offset_frames = params
        return -_comb_sum(onset_env, idx, period_frames, offset_frames)

    res = minimize(
        neg_comb,
        x0=[period0, offset0],
        method="Nelder-Mead",
        options={"xatol": 1e-6, "fatol": 1e-9, "maxiter": 2000},
    )
    period_frames = float(res.x[0])
    if not np.isfinite(period_frames) or abs(period_frames - lag_int) > 1.5:
        return float(np.clip(lag_int, lag_min, lag_max))  # refinement wandered off; keep the coarse lag
    return float(np.clip(period_frames, lag_min, lag_max))


def estimate_tempo(
    onset_env: np.ndarray,
    hop_s: float,
    bpm_min: float = TEMPO_BPM_MIN,
    bpm_max: float = TEMPO_BPM_MAX,
) -> dict:
    """Autocorrelation tempo estimate with harmonic scoring.

    Candidate periods T span `bpm_min`..`bpm_max`. Each is scored
    `ac(T) + 0.5*ac(2T) + 0.5*ac(T/2)` (harmonic support), the best
    candidate is refined to sub-BPM precision by (Brent) parabolic
    interpolation of a cubic-spline-smoothed score curve around the peak.

    Confidence is the peak's prominence over the next-best candidate that
    is NOT a harmonic (0.5x/2x) of the winner — so an expected half/double
    peak never depresses confidence in an otherwise unambiguous tempo.
    The strongest actual half/double candidate is separately reported as
    `runner_up` (half/double-time ambiguity is real in trap; surface it).

    Returns
    -------
    dict with: bpm, confidence (0..1), runner_up (float | None),
    runner_up_ratio (its score as a fraction of the winner's, 0 if none).
    """
    onset_env = np.asarray(onset_env, dtype=np.float64)
    if onset_env.size < 8:
        raise ValueError("onset envelope too short to estimate tempo")

    lag_min = max(1, int(np.floor(60.0 / bpm_max / hop_s)))
    lag_max = max(lag_min + 1, int(np.ceil(60.0 / bpm_min / hop_s)))
    max_lag_all = min(onset_env.size - 1, int(np.ceil(2 * lag_max)) + 4)
    if max_lag_all <= lag_min + 1:
        raise ValueError("onset envelope too short for the requested BPM range")

    lags_int = np.arange(1, max_lag_all + 1)
    ac_full = _autocorr_at_lags(onset_env, lags_int)
    spline = CubicSpline(lags_int, ac_full, extrapolate=True)
    lag_lo, lag_hi = float(lags_int[0]), float(lags_int[-1])

    def ac_at(lag: float) -> float:
        return float(spline(np.clip(lag, lag_lo, lag_hi)))

    def score_at(lag: float) -> float:
        return ac_at(lag) + TEMPO_HARMONIC_WEIGHT * ac_at(2.0 * lag) + TEMPO_HARMONIC_WEIGHT * ac_at(lag / 2.0)

    candidate_lags = np.arange(lag_min, lag_max + 1)
    scores = np.array([score_at(float(t)) for t in candidate_lags])

    # Selection: the raw autocorrelation peak, not the harmonic-boosted
    # score directly — score_at(T) = ac(T) + 0.5*ac(2T) + 0.5*ac(T/2) folds
    # the true peak's height into EVERY one of its own harmonics' scores
    # (ac(2T)'s own T/2 term recovers ac(T) in full), which for a cleanly
    # periodic loop makes half-tempo candidates outscore the true tempo
    # even when ac(T) itself already peaks at the true tempo. A light
    # smoothing pass over the autocorrelation also guards against a
    # sample-alignment artifact: when the true beat period isn't an exact
    # multiple of the STFT hop, each onset lands at a slightly different
    # sub-frame phase, and that alone can make an adjacent octave's raw
    # ac(2T) peak marginally outscore ac(T) for an otherwise-clean loop.
    # We use the smoothed curve only to pick WHICH lag region wins
    # (preferring the shorter of two near-tied regions, i.e. the higher
    # BPM reading — the standard octave-error correction; see
    # docs/research/reference-track-analysis.md: "residual = octave
    # choice, solved with genre priors"), then refine on the ORIGINAL
    # (unsmoothed) spline for full sub-BPM precision.
    ac_smoothed = gaussian_filter1d(ac_full, sigma=TEMPO_AC_SMOOTH_SIGMA)
    smooth_spline = CubicSpline(lags_int, ac_smoothed, extrapolate=True)

    def ac_smooth_at(lag: float) -> float:
        return float(smooth_spline(np.clip(lag, lag_lo, lag_hi)))

    region_peaks: list[tuple[int, float]] = []
    smooth_candidates = np.array([ac_smooth_at(float(t)) for t in candidate_lags])
    for i in range(len(candidate_lags)):
        left_ok = i == 0 or smooth_candidates[i] >= smooth_candidates[i - 1]
        right_ok = i == len(candidate_lags) - 1 or smooth_candidates[i] >= smooth_candidates[i + 1]
        if left_ok and right_ok:
            region_peaks.append((int(candidate_lags[i]), float(smooth_candidates[i])))
    if not region_peaks:
        region_peaks = [(int(candidate_lags[int(np.argmax(smooth_candidates))]), float(np.max(smooth_candidates)))]

    # Absolute (not relative) tolerance: ac values can be negative (no real
    # periodicity at that lag), where a relative ratio is meaningless/flips
    # sign, so "near-tied" is measured as a fixed distance on the ac scale.
    # Only genuinely strong peaks are eligible to win the "prefer the
    # shorter period" tie-break — for sparse onset material (e.g. one kick
    # every couple of beats) everything near the search boundary can be
    # equally weak/noisy, and without a floor that noise would be "tied"
    # with the real peak and drag the pick to the edge of the BPM range.
    global_peak_value = max(v for _lag, v in region_peaks)
    tied_peaks = [
        lag
        for lag, v in region_peaks
        if v >= global_peak_value - TEMPO_OCTAVE_TIE_TOL_ABS and v >= TEMPO_MIN_TIE_PEAK
    ]
    if not tied_peaks:
        tied_peaks = [lag for lag, v in region_peaks if v == global_peak_value]
    best_lag_int = min(tied_peaks)  # shortest period among near-tied regions = highest BPM

    # Sub-BPM precision: a single autocorrelation lag is sampled only every
    # hop (~11.6 ms @44.1k/512), and its immediate neighbors are often
    # asymmetric enough that a lone 3-point parabolic fit around the ac
    # peak is biased by a fraction of a lag (a fraction of a BPM). Beat
    # positions accumulate error linearly over many beats, though, so
    # refining period AND phase jointly to maximize the comb's summed
    # onset strength across every beat in the whole envelope is far more
    # constrained — this is what makes "beat this many times, this
    # consistently" precise, the same principle the design's parabolic
    # step is reaching for, extended from one peak to the whole beat
    # train. Falls back to the plain single-lag refinement if it can't
    # find enough beats to make that worthwhile (very short input).
    best_lag = _refine_period_by_comb(onset_env, hop_s, best_lag_int, float(lag_min), float(lag_max))
    best_score = score_at(best_lag)
    best_bpm = 60.0 / (best_lag * hop_s)

    # Local maxima among the discrete candidates, for the confidence and
    # runner-up searches.
    peaks: list[tuple[int, float]] = []
    for i in range(1, len(candidate_lags) - 1):
        if scores[i] >= scores[i - 1] and scores[i] >= scores[i + 1]:
            peaks.append((int(candidate_lags[i]), float(scores[i])))

    def is_harmonic_of_best(lag: float) -> bool:
        ratio = lag / best_lag
        return any(abs(ratio - h) / h <= TEMPO_HARMONIC_RATIO_TOL for h in (0.5, 1.0, 2.0))

    non_harmonic_peaks = [(lag, sc) for lag, sc in peaks if not is_harmonic_of_best(lag)]
    runner_score_nh = max((sc for _lag, sc in non_harmonic_peaks), default=0.0)
    confidence = float(np.clip((best_score - runner_score_nh) / best_score, 0.0, 1.0)) if best_score > 0 else 0.0

    # Explicit half/double-time candidate for reporting (may equal one of
    # the non-harmonic peaks' complement — this is deliberately about the
    # winner's own harmonics, not about "some other peak").
    runner_up_bpm: float | None = None
    runner_up_ratio = 0.0
    harmonic_candidates = []
    for mult in (2.0, 0.5):
        lag_h = best_lag * mult
        if lag_lo <= lag_h <= lag_hi:
            bpm_h = 60.0 / (lag_h * hop_s)
            if bpm_min <= bpm_h <= bpm_max:
                harmonic_candidates.append((score_at(lag_h), bpm_h))
    if harmonic_candidates:
        score_h, bpm_h = max(harmonic_candidates, key=lambda c: c[0])
        runner_up_bpm = float(bpm_h)
        runner_up_ratio = float(score_h / best_score) if best_score > 0 else 0.0

    return {
        "bpm": float(best_bpm),
        "confidence": confidence,
        "runner_up": runner_up_bpm,
        "runner_up_ratio": runner_up_ratio,
    }


# ---------------------------------------------------------------------------
# Beat phase: comb alignment
# ---------------------------------------------------------------------------


def beat_phase(onset_env: np.ndarray, hop_s: float, bpm: float) -> float:
    """Offset in [0, period_s) maximizing summed onset strength at beat
    positions (comb alignment), refined by local parabolic interpolation.
    """
    onset_env = np.asarray(onset_env, dtype=np.float64)
    period_s = 60.0 / bpm
    period_frames = period_s / hop_s
    n_frames = onset_env.size
    n_beats = int(np.floor((n_frames - 1) / period_frames))
    if n_beats < 2:
        return 0.0
    idx = np.arange(n_frames, dtype=np.float64)

    def comb_score(offset_frames: float) -> float:
        beat_frames = offset_frames + np.arange(n_beats) * period_frames
        beat_frames = beat_frames[beat_frames <= n_frames - 1]
        if beat_frames.size == 0:
            return 0.0
        return float(np.sum(np.interp(beat_frames, idx, onset_env)))

    offsets = np.linspace(0.0, period_frames, BEAT_PHASE_GRID_STEPS, endpoint=False)
    scores = np.array([comb_score(o) for o in offsets])
    best_i = int(np.argmax(scores))

    lo = offsets[best_i - 1] if best_i > 0 else offsets[best_i] - (offsets[1] - offsets[0])
    hi = offsets[best_i + 1] if best_i < len(offsets) - 1 else offsets[best_i] + (offsets[1] - offsets[0])
    res = minimize_scalar(
        lambda o: -comb_score(o), bounds=(max(0.0, lo), min(period_frames, hi)), method="bounded"
    )
    best_offset_frames = float(res.x) % period_frames
    return best_offset_frames * hop_s


# ---------------------------------------------------------------------------
# Downbeat: kick-on-1 heuristic among the 4 beat phases
# ---------------------------------------------------------------------------


def find_downbeat(
    sub_env: np.ndarray,
    onset_env: np.ndarray,
    hop_s: float,
    bpm: float,
    beat_offset_s: float,
) -> dict:
    """Among the 4 beat phases within a bar, pick the one maximizing
    sub-band energy at candidate bar starts (kick-on-1 heuristic), tied
    broken by spectral-novelty (onset envelope) alignment.

    Returns {"downbeat_offset_s", "confidence", "k"} where `k` is which of
    the 4 beats (0-3, counted from `beat_offset_s`) was chosen as beat 1.
    """
    sub_env = np.asarray(sub_env, dtype=np.float64)
    onset_env = np.asarray(onset_env, dtype=np.float64)
    period_s = 60.0 / bpm
    period_frames = period_s / hop_s
    bar_period_frames = 4.0 * period_frames
    n_frames = sub_env.size
    idx = np.arange(n_frames, dtype=np.float64)
    offset_frames = beat_offset_s / hop_s

    n_bars = int(np.floor((n_frames - 1 - offset_frames) / bar_period_frames))
    if n_bars < 1:
        return {"downbeat_offset_s": beat_offset_s % period_s, "confidence": 0.0, "k": 0}

    def bar_score(env: np.ndarray, k: int) -> float:
        starts = offset_frames + k * period_frames + np.arange(n_bars) * bar_period_frames
        starts = starts[(starts >= 0) & (starts <= n_frames - 1)]
        if starts.size == 0:
            return 0.0
        return float(np.sum(np.interp(starts, idx, env)))

    sub_scores = [bar_score(sub_env, k) for k in range(4)]
    onset_scores = [bar_score(onset_env, k) for k in range(4)]

    order = sorted(range(4), key=lambda k: (sub_scores[k], onset_scores[k]), reverse=True)
    best_k, second_k = order[0], order[1]
    best_score, second_score = sub_scores[best_k], sub_scores[second_k]
    confidence = float(np.clip((best_score - second_score) / best_score, 0.0, 1.0)) if best_score > 0 else 0.0

    bar_period_s = 4.0 * period_s
    downbeat_offset_s = (beat_offset_s + best_k * period_s) % bar_period_s
    return {"downbeat_offset_s": downbeat_offset_s, "confidence": confidence, "k": best_k}


# ---------------------------------------------------------------------------
# Bar-synced energy arc
# ---------------------------------------------------------------------------


def bar_arc(mono: np.ndarray, sr: int, bpm: float, downbeat_offset_s: float) -> list[dict]:
    """Per-bar full-band / sub (<100 Hz) / high (>5 kHz) RMS dB, each
    normalized relative to that band's own maximum across the track
    (0 dB = that band's loudest bar). Bars are 1-based in the output.
    """
    mono = np.asarray(mono, dtype=np.float64)
    duration_s = mono.size / sr
    bar_period_s = 4.0 * 60.0 / bpm
    n_bars = int(np.floor((duration_s - downbeat_offset_s) / bar_period_s))
    if n_bars < 1:
        return []

    sos_low = butter(4, BAR_SUB_HZ / (sr / 2.0), btype="lowpass", output="sos")
    sos_high = butter(4, BAR_HIGH_HZ / (sr / 2.0), btype="highpass", output="sos")
    sub_sig = sosfiltfilt(sos_low, mono)
    high_sig = sosfiltfilt(sos_high, mono)

    full_raw = np.empty(n_bars)
    sub_raw = np.empty(n_bars)
    high_raw = np.empty(n_bars)
    for i in range(n_bars):
        start = int(round((downbeat_offset_s + i * bar_period_s) * sr))
        end = int(round((downbeat_offset_s + (i + 1) * bar_period_s) * sr))
        end = min(end, mono.size)
        if end <= start:
            full_raw[i] = sub_raw[i] = high_raw[i] = -200.0
            continue
        full_raw[i] = 20.0 * np.log10(max(float(np.sqrt(np.mean(mono[start:end] ** 2))), _DB_FLOOR))
        sub_raw[i] = 20.0 * np.log10(max(float(np.sqrt(np.mean(sub_sig[start:end] ** 2))), _DB_FLOOR))
        high_raw[i] = 20.0 * np.log10(max(float(np.sqrt(np.mean(high_sig[start:end] ** 2))), _DB_FLOOR))

    full_db = full_raw - np.max(full_raw)
    sub_db = sub_raw - np.max(sub_raw)
    high_db = high_raw - np.max(high_raw)

    return [
        {
            "bar": i + 1,
            "full_db": float(full_db[i]),
            "sub_db": float(sub_db[i]),
            "high_db": float(high_db[i]),
        }
        for i in range(n_bars)
    ]


# ---------------------------------------------------------------------------
# Section rules
# ---------------------------------------------------------------------------


def _runs(flags: np.ndarray, min_len: int) -> list[tuple[int, int]]:
    """Contiguous True runs of at least `min_len`, as [start, end) pairs."""
    runs = []
    i, n = 0, len(flags)
    while i < n:
        if flags[i]:
            j = i
            while j < n and flags[j]:
                j += 1
            if j - i >= min_len:
                runs.append((i, j))
            i = j
        else:
            i += 1
    return runs


def _confidence(margin: float, threshold: float, span: float) -> float:
    """0.5 right at the threshold, rising toward 0.95 as the margin beyond
    the threshold grows by `span`; floored at 0.3 so a barely-qualifying
    event is never reported as more than weakly confident."""
    if not np.isfinite(margin):
        return 0.3
    extra = margin - threshold
    return float(np.clip(0.5 + 0.45 * (extra / span), 0.3, 0.95))


def detect_sections(arc: list[dict], phrase_bars: int = 4) -> list[dict]:
    """Rule-based drop/build/breakdown/intro/outro detection on the
    (3-bar median smoothed) energy arc. Boundaries snap to `phrase_bars`
    edges. Gaps between named events are unlabeled `section` spans — no
    invented pop labels (research constraint). Each section's evidence
    quotes the numbers that fired (or failed to fire) its rule.
    """
    n = len(arc)
    if n == 0:
        return []

    full = np.array([b["full_db"] for b in arc])
    sub = np.array([b["sub_db"] for b in arc])
    full_s = median_filter(full, size=SMOOTH_MEDIAN_BARS, mode="nearest")
    sub_s = median_filter(sub, size=SMOOTH_MEDIAN_BARS, mode="nearest")

    def snap_down(bar0: int) -> int:
        return (bar0 // phrase_bars) * phrase_bars

    def snap_up(bar0_end: int) -> int:
        return int(np.ceil(bar0_end / phrase_bars)) * phrase_bars

    # --- drop: full jumps >=3 dB over the previous 4-bar mean AND sub
    # within 6 dB of its max, sustained >=4 bars ---------------------------
    drop_flag = np.zeros(n, dtype=bool)
    drop_delta = np.full(n, np.nan)
    for i in range(DROP_PREV_MEAN_BARS, n):
        prev_mean = np.mean(full_s[i - DROP_PREV_MEAN_BARS : i])
        delta = full_s[i] - prev_mean
        if delta >= DROP_JUMP_DB and sub_s[i] >= -DROP_SUB_WITHIN_MAX_DB:
            drop_flag[i] = True
            drop_delta[i] = delta
    drop_runs = _runs(drop_flag, DROP_MIN_SUSTAIN_BARS)

    # --- breakdown: full >=3 dB below the previous 8-bar mean OR sub
    # falls >=8 dB below its max, sustained >=4 bars, after >=1 drop -------
    first_drop_start = drop_runs[0][0] if drop_runs else None
    breakdown_flag = np.zeros(n, dtype=bool)
    breakdown_delta = np.full(n, np.nan)
    for i in range(BREAKDOWN_PREV_MEAN_BARS, n):
        if first_drop_start is None or i < first_drop_start:
            continue
        prev_mean = np.mean(full_s[i - BREAKDOWN_PREV_MEAN_BARS : i])
        delta = full_s[i] - prev_mean
        if delta <= -BREAKDOWN_DROP_DB or sub_s[i] <= -BREAKDOWN_SUB_BELOW_MAX_DB:
            breakdown_flag[i] = True
            breakdown_delta[i] = delta
    breakdown_runs = _runs(breakdown_flag, BREAKDOWN_MIN_SUSTAIN_BARS)

    # --- build: positive fitted slope >=0.3 dB/bar over >=4 bars,
    # terminating at a drop -------------------------------------------------
    build_runs = []  # (start0, end0_excl, slope)
    for d_start, _d_end in drop_runs:
        best = None
        for w in range(BUILD_MIN_BARS, min(d_start, BUILD_MAX_WINDOW_BARS) + 1):
            start = d_start - w
            ys = full_s[start:d_start]
            xs = np.arange(w, dtype=np.float64)
            slope = float(np.polyfit(xs, ys, 1)[0])
            if slope < BUILD_MIN_SLOPE_DB_PER_BAR:
                continue
            # Prefer the STEEPEST qualifying window, not the longest one:
            # a long window that also swallows a flat lead-in (e.g. the
            # intro) still averages out to a positive slope, but dilutes
            # it — the steepest window is the one that actually captures
            # where the rise happens. Ties (a clean linear ramp scores
            # near-identically at every sub-window) favor the longer span,
            # so we still report the ramp's full extent.
            if best is None or slope > best[2] + BUILD_SLOPE_TIE_TOL or (
                abs(slope - best[2]) <= BUILD_SLOPE_TIE_TOL and w > best[1]
            ):
                best = (start, w, slope)
        if best is not None:
            start, w, slope = best
            build_runs.append((start, d_start, slope))

    # Each event carries an `extend` flag: drop/breakdown's rule only
    # fires ON THE TRANSITION (the previous-N-bar-mean baseline slides to
    # include the new plateau itself within a few bars, so the raw jump
    # stops registering well before the plateau actually ends) — the named
    # section should cover the whole plateau, so its reported end extends
    # forward to wherever the NEXT detected event starts (or the track
    # end), not just the brief window the jump/dip was measured over.
    # build/intro/outro's own rule already spans their full extent.
    events: list[dict] = []

    for start, end in drop_runs:
        delta = float(np.nanmean(drop_delta[start:end]))
        sub_val = float(np.mean(sub_s[start:end]))
        conf = _confidence(delta, DROP_JUMP_DB, span=6.0)
        evidence = (
            f"full {delta:+.1f} dB vs prev {DROP_PREV_MEAN_BARS}-bar mean; "
            f"sub {sub_val:+.1f} dB from max"
        )
        events.append(
            {"start": snap_down(start), "min_end": snap_up(end), "name": "drop", "confidence": conf,
             "evidence": evidence, "extend": True}
        )

    for start, end in breakdown_runs:
        delta = float(np.nanmean(breakdown_delta[start:end]))
        sub_val = float(np.mean(sub_s[start:end]))
        conf = _confidence(-delta if np.isfinite(delta) else -sub_val, BREAKDOWN_DROP_DB, span=6.0)
        evidence = (
            f"full {delta:+.1f} dB vs prev {BREAKDOWN_PREV_MEAN_BARS}-bar mean; "
            f"sub {sub_val:+.1f} dB from max"
        )
        events.append(
            {"start": snap_down(start), "min_end": snap_up(end), "name": "breakdown", "confidence": conf,
             "evidence": evidence, "extend": True}
        )

    for start, end, slope in build_runs:
        sub_val = float(np.mean(sub_s[start:end]))
        conf = _confidence(slope, BUILD_MIN_SLOPE_DB_PER_BAR, span=1.0)
        evidence = (
            f"full slope {slope:+.2f} dB/bar over {end - start} bars, ending at a drop; "
            f"sub {sub_val:+.1f} dB from max (builds are typically sub-light)"
        )
        events.append(
            {"start": snap_down(start), "min_end": snap_up(end), "name": "build", "confidence": conf,
             "evidence": evidence, "extend": False}
        )

    # --- intro/outro: below 60% of max energy, before the first named
    # event / after the last one -------------------------------------------
    first_event_start = min((e["start"] for e in events), default=n)
    intro_run_end = 0
    for i in range(min(first_event_start, n)):
        if full_s[i] < INTRO_OUTRO_DB:
            intro_run_end = i + 1
        else:
            break
    if intro_run_end > 0:
        end0 = min(snap_up(intro_run_end), snap_down(first_event_start) if first_event_start < n else snap_up(intro_run_end))
        if end0 >= phrase_bars:
            mean_full = float(np.mean(full_s[0:end0]))
            margin = INTRO_OUTRO_DB - mean_full
            conf = _confidence(margin, 0.0, span=6.0)
            evidence = f"full {mean_full:+.1f} dB, below the {INTRO_OUTRO_DB:.1f} dB (60% energy) intro/outro threshold"
            events.append(
                {"start": 0, "min_end": end0, "name": "intro", "confidence": conf, "evidence": evidence,
                 "extend": False}
            )

    # Note: no "after the last event" gate here (unlike intro's forward
    # scan, which IS gated by first_event_start) — the threshold check is
    # already self-limiting (it stops at the first loud bar walking
    # backward from the end), and gating it by a drop/breakdown event's
    # own (possibly track-end-reaching) span would wrongly suppress outro
    # detection whenever a trailing breakdown-shaped fade also happens to
    # qualify as a breakdown. The two are resolved by priority below
    # instead (outro wins the trailing territory).
    outro_run_start = n
    for i in range(n - 1, -1, -1):
        if full_s[i] < INTRO_OUTRO_DB:
            outro_run_start = i
        else:
            break
    if outro_run_start < n:
        start0 = snap_down(outro_run_start)
        if n - start0 >= phrase_bars:
            mean_full = float(np.mean(full_s[start0:n]))
            margin = INTRO_OUTRO_DB - mean_full
            conf = _confidence(margin, 0.0, span=6.0)
            evidence = f"full {mean_full:+.1f} dB, below the {INTRO_OUTRO_DB:.1f} dB (60% energy) intro/outro threshold"
            events.append(
                {"start": start0, "min_end": n, "name": "outro", "confidence": conf, "evidence": evidence,
                 "extend": False}
            )

    # --- extend drop/breakdown from their detected transition window
    # forward to wherever the next event starts (or the track end) --------
    # Outro is a hard ceiling on that extension regardless of tie-breaking
    # in sort order: a trailing low-energy run that reaches the track's
    # end is definitionally an outro, not a breakdown (a breakdown implies
    # something else follows it) — without this, a breakdown-shaped fade
    # that happens to start on the very same bar as the outro run wins the
    # overlap on insertion order alone and the outro never surfaces.
    events.sort(key=lambda e: e["start"])
    outro_start = next((e["start"] for e in events if e["name"] == "outro"), n)
    for i, ev in enumerate(events):
        if ev["extend"]:
            later_starts = [e["start"] for e in events if e["start"] > ev["start"]]
            cap = min(later_starts) if later_starts else n
            if ev["name"] != "outro":
                cap = min(cap, outro_start)
            # Extend up to the cap — and if this event's OWN detected span
            # already overshot past the cap (e.g. a breakdown whose raw
            # window reaches into outro territory), pull it back rather
            # than letting the overshoot win the overlap on start order.
            ev["end"] = cap
        else:
            ev["end"] = ev["min_end"]

    # --- resolve overlaps (phrase-snapping/extension can nudge neighbors
    # together), then fill every gap with an unlabeled `section` -----------
    resolved: list[tuple[int, int, str, float, str]] = []
    for ev in events:
        start0, end0, name, conf, evidence = ev["start"], ev["end"], ev["name"], ev["confidence"], ev["evidence"]
        if resolved and start0 < resolved[-1][1]:
            prev = resolved[-1]
            new_end = min(prev[1], start0)
            if new_end > prev[0]:
                resolved[-1] = (prev[0], new_end, prev[2], prev[3], prev[4])
            start0 = max(start0, prev[1])
            if start0 >= end0:
                continue
        if end0 > start0:
            resolved.append((start0, end0, name, conf, evidence))

    sections: list[dict] = []
    cursor = 0
    for start0, end0, name, conf, evidence in resolved:
        if start0 > cursor:
            mean_full = float(np.mean(full_s[cursor:start0]))
            mean_sub = float(np.mean(sub_s[cursor:start0]))
            sections.append(
                {
                    "name": "section",
                    "start_bar": cursor + 1,
                    "end_bar": start0,
                    "confidence": 0.3,
                    "evidence": f"full {mean_full:+.1f} dB, sub {mean_sub:+.1f} dB from max; no rule matched",
                }
            )
        sections.append(
            {
                "name": name,
                "start_bar": start0 + 1,
                "end_bar": end0,
                "confidence": conf,
                "evidence": evidence,
            }
        )
        cursor = end0
    if cursor < n:
        mean_full = float(np.mean(full_s[cursor:n]))
        mean_sub = float(np.mean(sub_s[cursor:n]))
        sections.append(
            {
                "name": "section",
                "start_bar": cursor + 1,
                "end_bar": n,
                "confidence": 0.3,
                "evidence": f"full {mean_full:+.1f} dB, sub {mean_sub:+.1f} dB from max; no rule matched",
            }
        )

    return sections


# ---------------------------------------------------------------------------
# Top-level API
# ---------------------------------------------------------------------------


def analyze_reference(path: str, phrase_bars: int = 4) -> dict:
    """Full M8 reference-track analysis: tempo/grid, bar-synced energy arc,
    and a draft section map, plus the M6 measurement profile so the same
    file doubles as an arrangement map and a tonal target.
    """
    x, sr = load(path)
    duration_s = x.shape[0] / sr
    if duration_s < MIN_REFERENCE_DURATION_S:
        raise ValueError(
            f"'{path}' is {duration_s:.1f} s, shorter than the "
            f"{MIN_REFERENCE_DURATION_S:.0f} s minimum for reference analysis "
            "(need enough bars to find a tempo and section structure)"
        )
    mono = to_mono(x)

    onset_env, sub_env, hop_s = onset_and_subband(mono, sr)
    tempo = estimate_tempo(onset_env, hop_s)
    bpm = tempo["bpm"]

    beat_offset_s = beat_phase(onset_env, hop_s, bpm)
    downbeat = find_downbeat(sub_env, onset_env, hop_s, bpm, beat_offset_s)

    arc = bar_arc(mono, sr, bpm, downbeat["downbeat_offset_s"])
    sections = detect_sections(arc, phrase_bars)

    notes: list[str] = []
    if tempo["runner_up"] is not None and tempo["runner_up_ratio"] >= TEMPO_AMBIGUITY_NOTE_RATIO:
        notes.append(
            f"Tempo autocorrelation is ambiguous between {bpm:.1f} BPM and "
            f"{tempo['runner_up']:.1f} BPM (half/double-time) — reported {bpm:.1f} BPM, "
            f"runner-up scores {tempo['runner_up_ratio'] * 100:.0f}% of the winner."
        )
    if downbeat["confidence"] < DOWNBEAT_LOW_CONFIDENCE:
        notes.append(
            f"Downbeat confidence is low ({downbeat['confidence']:.2f}) — bar 1 may be "
            "off by a beat or two; correct by ear."
        )

    # report.analyze() on the FULL file does not scale to reference-length
    # audio: dynamics.phase_rotation_headroom alone re-oversamples the
    # entire signal on the order of a dozen times (poles x f0 sweep), which
    # measured ~100s on a 2-minute file — far past this module's own <30s
    # budget for a 2-minute reference. Passing report.analyze() a
    # representative excerpt (its own start_s/end_s, not a modification of
    # report.py) keeps the real call in budget; centered on the first drop
    # if we found one (the track's most characteristic, full-energy
    # moment), else the middle of the track. See the "Performance"
    # deviation note in the module docstring / delivery report.
    bar_period_s = 4.0 * 60.0 / bpm
    drop_sections = [s for s in sections if s["name"] == "drop"]
    if drop_sections:
        mid_bar = (drop_sections[0]["start_bar"] + drop_sections[0]["end_bar"]) / 2.0
    elif arc:
        mid_bar = arc[len(arc) // 2]["bar"]
    else:
        mid_bar = 1.0
    mid_s = downbeat["downbeat_offset_s"] + (mid_bar - 1.0) * bar_period_s
    excerpt_len = min(MEASUREMENTS_EXCERPT_S, duration_s)
    excerpt_start = float(np.clip(mid_s - excerpt_len / 2.0, 0.0, max(0.0, duration_s - excerpt_len)))
    measurements = report.analyze(path, start_s=excerpt_start, end_s=excerpt_start + excerpt_len)

    return {
        "file": os.path.basename(path),
        "duration_s": duration_s,
        "bpm": bpm,
        "bpm_confidence": tempo["confidence"],
        "bpm_runner_up": tempo["runner_up"],
        "beat_offset_s": beat_offset_s,
        "downbeat_confidence": downbeat["confidence"],
        "bar_count": len(arc),
        "arc": arc,
        "sections": sections,
        "notes": notes,
        "measurements": measurements,
    }


def save_reference_record(record_path: str, source_path: str, analysis: dict) -> None:
    """Write a self-contained reference-analysis record. Mirrors
    `report.save_record`'s shape (schema/saved/file/sha256) with the
    analysis dict under "reference" instead of "measurements"/"findings" —
    report.save_record's signature doesn't fit a reference analysis, so
    this is a small dedicated writer rather than a reuse.
    """
    with open(source_path, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    record = {
        "schema": 1,
        "saved": datetime.date.today().isoformat(),
        "file": os.path.abspath(source_path),
        "sha256": sha,
        "reference": analysis,
    }
    from .audio import sanitize_json

    os.makedirs(os.path.dirname(os.path.abspath(record_path)), exist_ok=True)
    with open(record_path, "w", encoding="utf-8") as f:
        json.dump(sanitize_json(record), f, indent=2, allow_nan=False)
        f.write("\n")
