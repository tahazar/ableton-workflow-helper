"""Operator sound matching (B2 half 2): audio-sample -> Operator patch
reconstruction, tiered by reachability. See docs/design/operator-assistant.md
for the full design (science stance, tier semantics, non-goals).

Pipeline: analyze (f0 track, harmonicity ratio, 16-partial harmonic vector,
ADSR envelope fit, spectral-centroid brightness trajectory) -> gate
(reachability: is this sound even IN Operator's gamut) -> propose (tier 1/2:
a JSON patch proposal) or refuse (tier 3: "outside the reachable set" +
the measured numbers that say so, a PASSING negative-control state, not an
error).

All numbers are measured, never invented — same discipline as duck.py /
pumpcheck.py. Raw device.param values Operator would need are NOT a solved
problem (no verified raw<->display curve beyond the single Volume point in
knowledge/setup/device-parameter-surface.md; see compressor-raw-display-
mapping.md for why one point isn't a curve) — `propose()`'s `addressable`
values are an explicitly-labeled HEURISTIC normalization, not a calibrated
mapping, and the drawn-partials list is always reported for the owner
regardless of tier so nothing is silently dropped.
"""

from __future__ import annotations

import numpy as np
import librosa

from .audio import to_mono

# ---------------------------------------------------------------------------
# Analysis constants
# ---------------------------------------------------------------------------

N_PARTIALS = 16
N_FFT = 4096
FRAME_LENGTH = 2048
HOP_LENGTH = 512
F0_FMIN_HZ = 43.1  # ~F1; pyin's own frame_length=2048 needs >= 2 periods per
# frame to track cleanly (its warning threshold is exactly here) — this
# still covers everything from a low bass note up
F0_FMAX_HZ = 1050.0  # ~C6

SUSTAIN_WINDOW_REL_DB = 6.0  # harmonic/centroid analysis window: within this many dB of the peak

# Reachability gate thresholds (named, honest numbers — see design doc):
F0_MIN_VOICED_FRACTION = 0.15  # below this: "no stable pitch" (percussion/noise)
F0_DRIFT_MAX_SEMITONES = 1.0  # f0 std across voiced frames, semitones
HARMONICITY_MIN = 0.55  # harmonic energy / total energy — below this: tier 3
HARMONICITY_TIER1_MIN = 0.80  # at/above this: tier 1 (confident); between the
# two mins: tier 2 (reachable but needs drawn partials / FM to fully match)
INHARMONIC_PARTIAL_DEVIATION_SEMITONES = 1.0  # avg partial deviation from an
# integer harmonic series, semitones — above this: tier 3 (stretched partials)

# `propose()`'s addressable-param heuristic (explicitly labeled, see module
# docstring): Operator's envelope raw range's real time span is UNVERIFIED —
# this is an assumption, not a measurement.
ASSUMED_MAX_ENVELOPE_S = 10.0
FILTER_SHAPING_HZ = 200.0  # centroid movement beyond this reads as "filter shaping happened"

# `compare()`'s score blend.
SCORE_L2_SCALE = 2.0  # log10-magnitude L2 units treated as "0 score" at this distance

ADSR_ATTACK_REL_DB = 3.0
ADSR_SUSTAIN_STABLE_DB = 1.5
ADSR_SUSTAIN_MIN_FRAMES = 3
ADSR_RELEASE_DONE_ABOVE_FLOOR_DB = 3.0

WAVEFORM_SIGNATURES: dict[str, np.ndarray] = {
    "sine": np.array([1.0] + [0.0] * (N_PARTIALS - 1)),
    "saw": np.array([1.0 / k for k in range(1, N_PARTIALS + 1)]),
    "square": np.array([1.0 / k if k % 2 == 1 else 0.0 for k in range(1, N_PARTIALS + 1)]),
    "triangle": np.array([1.0 / (k * k) if k % 2 == 1 else 0.0 for k in range(1, N_PARTIALS + 1)]),
}


# ---------------------------------------------------------------------------
# f0
# ---------------------------------------------------------------------------


def estimate_f0(mono: np.ndarray, sr: int) -> dict:
    """pyin f0 track; median Hz + drift (semitone std) over voiced frames."""
    f0, voiced_flag, _voiced_prob = librosa.pyin(
        mono,
        fmin=F0_FMIN_HZ,
        fmax=F0_FMAX_HZ,
        sr=sr,
        frame_length=FRAME_LENGTH,
        hop_length=HOP_LENGTH,
    )
    f0 = np.asarray(f0, dtype=np.float64)
    voiced = np.asarray(voiced_flag, dtype=bool) & ~np.isnan(f0)
    if not voiced.any():
        return {"hz": None, "drift_semitones": None, "voiced_fraction": 0.0}
    voiced_f0 = f0[voiced]
    median_hz = float(np.median(voiced_f0))
    drift = 12.0 * np.log2(voiced_f0 / median_hz)
    return {
        "hz": median_hz,
        "drift_semitones": float(np.std(drift)),
        "voiced_fraction": float(np.mean(voiced)),
    }


# ---------------------------------------------------------------------------
# ADSR envelope fit (grid-fit honesty: reports r_squared, same discipline as
# duck.fit_duck_envelope / pumpcheck._fit_dip_model)
# ---------------------------------------------------------------------------


def _adsr_model_db(
    times: np.ndarray,
    floor_db: float,
    peak_db: float,
    attack_s: float,
    decay_s: float,
    sustain_db: float,
    sustain_s: float,
    release_s: float,
) -> np.ndarray:
    decay_end = attack_s + decay_s
    sustain_end = decay_end + sustain_s
    release_end = sustain_end + release_s
    out = np.empty_like(times)
    for idx, t in enumerate(times):
        if t <= attack_s:
            frac = t / attack_s if attack_s > 1e-9 else 1.0
            out[idx] = floor_db + (peak_db - floor_db) * frac
        elif t <= decay_end:
            frac = (t - attack_s) / decay_s if decay_s > 1e-9 else 1.0
            out[idx] = peak_db + (sustain_db - peak_db) * frac
        elif t <= sustain_end:
            out[idx] = sustain_db
        elif t <= release_end:
            frac = (t - sustain_end) / release_s if release_s > 1e-9 else 1.0
            out[idx] = sustain_db + (floor_db - sustain_db) * frac
        else:
            out[idx] = floor_db
    return out


def fit_adsr(times: np.ndarray, env_db: np.ndarray) -> dict:
    """Detect attack/decay/sustain/release breakpoints from a broadband
    amplitude envelope (dB) and report a fit quality (r_squared) against the
    piecewise-linear-dB model reconstructed from those breakpoints — the
    same "grid fits with reported quality" honesty as duck.py/pumpcheck.py,
    not a vibe.
    """
    n = len(env_db)
    if n < 2:
        raise ValueError("envelope too short to fit ADSR (need >= 2 frames)")

    peak_idx = int(np.argmax(env_db))
    peak_db = float(env_db[peak_idx])
    floor_db = float(np.min(env_db))

    attack_thresh = peak_db - ADSR_ATTACK_REL_DB
    attack_idx = next((i for i in range(peak_idx + 1) if env_db[i] >= attack_thresh), peak_idx)
    attack_s = float(times[attack_idx])

    # Sustain: the longest contiguous run (starting at/after the peak) whose
    # span stays within ADSR_SUSTAIN_STABLE_DB of itself — the flattest
    # stretch, found by a deterministic linear scan (no optimizer).
    best_run = (peak_idx, peak_idx)
    best_len = 0
    i = peak_idx
    while i < n:
        j = i
        while j + 1 < n:
            window = env_db[i : j + 2]
            if float(window.max() - window.min()) <= ADSR_SUSTAIN_STABLE_DB:
                j += 1
            else:
                break
        if j - i + 1 > best_len:
            best_len = j - i + 1
            best_run = (i, j)
        i = j + 1 if j > i else i + 1

    sustain_start_idx, sustain_end_idx = best_run
    has_sustain = best_len >= ADSR_SUSTAIN_MIN_FRAMES
    if has_sustain:
        sustain_db = float(np.median(env_db[sustain_start_idx : sustain_end_idx + 1]))
        decay_s = max(0.0, float(times[sustain_start_idx]) - attack_s)
        sustain_s = max(0.0, float(times[sustain_end_idx]) - float(times[sustain_start_idx]))
        release_start_idx = sustain_end_idx
    else:
        sustain_db = peak_db
        decay_s = max(0.0, float(times[min(peak_idx + 1, n - 1)]) - attack_s)
        sustain_s = 0.0
        release_start_idx = peak_idx

    release_done_idx = n - 1
    for i in range(release_start_idx, n):
        if env_db[i] <= floor_db + ADSR_RELEASE_DONE_ABOVE_FLOOR_DB:
            release_done_idx = i
            break
    release_s = max(0.0, float(times[release_done_idx]) - float(times[release_start_idx]))

    model = _adsr_model_db(
        times, floor_db, peak_db, attack_s, decay_s, sustain_db, sustain_s, release_s
    )
    ss_res = float(np.sum((env_db - model) ** 2))
    ss_tot = float(np.sum((env_db - np.mean(env_db)) ** 2))
    r_squared = float(np.clip(1.0 - ss_res / ss_tot, -10.0, 1.0)) if ss_tot > 1e-9 else 1.0

    return {
        "attack_s": attack_s,
        "decay_s": decay_s,
        "sustain_db": sustain_db,
        "sustain_s": sustain_s,
        "release_s": release_s,
        "peak_db": peak_db,
        "floor_db": floor_db,
        "has_sustain": has_sustain,
        "r_squared": r_squared,
    }


# ---------------------------------------------------------------------------
# Harmonic content
# ---------------------------------------------------------------------------


def harmonic_vector_and_ratio(
    mag: np.ndarray, freqs: np.ndarray, sustain_mask: np.ndarray, f0_hz: float, sr: int
) -> tuple[list[float], float, list[float]]:
    """Median magnitude at the first N_PARTIALS harmonics (bins around
    k*f0, wide enough to catch the analysis window's own mainlobe spread
    plus tolerance for small f0 estimation error) over the analysis window,
    normalized to [0, 1] on the strongest partial. `harmonicity_ratio` =
    (energy captured by those harmonic bands) / (total spectral energy)
    over the same frames — near 1 for a clean harmonic tone, near 0 for
    noise or content whose partials aren't near integer multiples of f0.
    """
    if not sustain_mask.any():
        return [0.0] * N_PARTIALS, 0.0, [0.0] * N_PARTIALS

    # STFT mainlobe half-width (Hz) for the analysis window — a band
    # narrower than this would clip a genuine partial's own energy and
    # under-read harmonicity even on a perfectly harmonic tone.
    mainlobe_half_hz = 2.0 * sr / FRAME_LENGTH

    windowed = mag[:, sustain_mask]
    amps: list[float] = []
    # Per-frame energy captured within the enumerated harmonic bands (summed
    # across every bin in each band, so a partial's spread mainlobe/sidelobe
    # energy counts, not just its single peak bin) vs. the frame's total
    # broadband energy — this is the actual "how much of the spectrum is
    # harmonic" ratio; the peak-per-band value below is used only to recover
    # each partial's RELATIVE amplitude for the harmonic vector.
    harmonic_energy_per_frame = np.zeros(windowed.shape[1])
    for k in range(1, N_PARTIALS + 1):
        center = k * f0_hz
        if center >= freqs[-1]:
            amps.append(0.0)
            continue
        half_width = max(mainlobe_half_hz, 0.02 * center)
        band = (freqs >= center - half_width) & (freqs <= center + half_width)
        if not band.any():
            amps.append(0.0)
            continue
        band_mag = windowed[band]
        per_frame_peak = band_mag.max(axis=0)
        amps.append(float(np.median(per_frame_peak)))
        harmonic_energy_per_frame += np.sum(band_mag**2, axis=0)

    total_energy = float(np.mean(np.sum(windowed**2, axis=0)))
    total_energy = max(total_energy, 1e-12)
    harmonicity_ratio = float(np.clip(float(np.mean(harmonic_energy_per_frame)) / total_energy, 0.0, 1.0))

    amps_arr = np.asarray(amps)
    peak_amp = float(amps_arr.max())
    normalized = (amps_arr / peak_amp).tolist() if peak_amp > 1e-12 else [0.0] * N_PARTIALS
    return normalized, harmonicity_ratio, amps


def partial_deviation_semitones(
    mag: np.ndarray, freqs: np.ndarray, sustain_mask: np.ndarray, f0_hz: float, k_max: int = 8
) -> float | None:
    """Energy-weighted average |deviation| (semitones) between the actual
    spectral peak near k*f0 (searched in a window tolerant of stretched
    partials) and the ideal integer-harmonic k*f0, for k=2..k_max. Near 0 for
    a genuinely harmonic tone; large for inharmonic content (bells, stretched
    partials) where the true peaks sit off the integer-harmonic grid.

    The search half-width is capped at 0.45*f0_hz (< half the spacing
    between adjacent harmonics) so a search band can never bleed into a
    NEIGHBORING partial and misreport its (correct) position as this
    partial's deviation — found live in this module's own test synthesis: a
    plain harmonic stack's low partials were mis-flagged as "inharmonic"
    when a wider, center-scaled window let partial k's search band catch
    partial k-1's much stronger peak.
    """
    if not sustain_mask.any():
        return None
    frame_mag = np.median(mag[:, sustain_mask], axis=1)
    # A partial only counts if it's actually PRESENT (well above the noise
    # floor of this spectrum) — otherwise a pure sine or a sparse harmonic
    # series (silent higher partials) picks up a random noise-floor bump in
    # the search window and reports a spurious "inharmonic" deviation.
    presence_floor = float(np.max(frame_mag)) * 0.02
    half_width = 0.45 * f0_hz
    devs: list[float] = []
    weights: list[float] = []
    for k in range(2, k_max + 1):
        center = k * f0_hz
        if center >= freqs[-1]:
            break
        band = (freqs >= center - half_width) & (freqs <= center + half_width)
        if not band.any():
            continue
        band_freqs = freqs[band]
        band_mags = frame_mag[band]
        peak_idx = int(np.argmax(band_mags))
        peak_freq = float(band_freqs[peak_idx])
        peak_mag = float(band_mags[peak_idx])
        if peak_mag <= presence_floor or peak_freq <= 0:
            continue
        devs.append(abs(12.0 * np.log2(peak_freq / center)))
        weights.append(peak_mag)
    if not devs or sum(weights) <= 0:
        return None
    return float(np.average(devs, weights=weights))


def classify_waveform(vector: list[float]) -> tuple[str, float]:
    """Cosine-match the normalized harmonic vector against Operator's stock
    wave families; residual = 1 - best cosine similarity (how much a stock
    wave alone doesn't explain — the drawn-partials caveat trigger)."""
    v = np.asarray(vector, dtype=np.float64)
    if np.linalg.norm(v) < 1e-9:
        return "sine", 1.0
    v_unit = v / np.linalg.norm(v)
    best_name, best_sim = "sine", -1.0
    for name, sig in WAVEFORM_SIGNATURES.items():
        s_unit = sig / np.linalg.norm(sig)
        sim = float(np.dot(v_unit, s_unit))
        if sim > best_sim:
            best_sim = sim
            best_name = name
    residual = float(np.clip(1.0 - best_sim, 0.0, 1.0))
    return best_name, residual


# ---------------------------------------------------------------------------
# Brightness trajectory
# ---------------------------------------------------------------------------


def centroid_trajectory(mag: np.ndarray, freqs: np.ndarray, times: np.ndarray) -> dict:
    """Spectral centroid over time on the ACTIVE (non-silent) frames only —
    a filter-envelope direction hint (rising/falling/flat brightness), not a
    raw Filter Freq/Env value."""
    energy = np.sum(mag, axis=0)
    if energy.max() <= 0:
        return {"direction": "flat", "start_hz": None, "end_hz": None, "slope_hz_per_s": 0.0}
    active = energy > 0.05 * energy.max()
    if active.sum() < 3:
        return {"direction": "flat", "start_hz": None, "end_hz": None, "slope_hz_per_s": 0.0}
    centroid = np.sum(mag * freqs[:, None], axis=0) / np.maximum(energy, 1e-12)
    idx = np.where(active)[0]
    c_active = centroid[idx]
    t_active = times[idx]
    slope = float(np.polyfit(t_active, c_active, 1)[0]) if len(t_active) >= 2 else 0.0
    start_hz = float(c_active[0])
    end_hz = float(c_active[-1])
    if end_hz - start_hz > FILTER_SHAPING_HZ:
        direction = "rising"
    elif start_hz - end_hz > FILTER_SHAPING_HZ:
        direction = "falling"
    else:
        direction = "flat"
    return {"direction": direction, "start_hz": start_hz, "end_hz": end_hz, "slope_hz_per_s": slope}


def _noise_floor_ratio(env_db: np.ndarray) -> float:
    """Crude informational measure: how much of the observed dB span (loud
    decile vs quiet decile) is "used" — near 0 = clean dynamic range, near 1
    = flat/noisy throughout. Not part of the reachability gate."""
    sorted_db = np.sort(env_db)
    n = len(sorted_db)
    q = max(1, n // 10)
    floor = float(np.mean(sorted_db[:q]))
    peak = float(np.mean(sorted_db[-q:]))
    span = peak - floor
    if span <= 1e-6:
        return 1.0
    return float(np.clip(1.0 - span / 60.0, 0.0, 1.0))


# ---------------------------------------------------------------------------
# analyze / gate / propose / match
# ---------------------------------------------------------------------------


def analyze(path: str) -> dict:
    from . import audio

    x, sr = audio.load(path)
    mono = to_mono(np.asarray(x, dtype=np.float64))

    stft = librosa.stft(mono, n_fft=N_FFT, hop_length=HOP_LENGTH, win_length=FRAME_LENGTH)
    mag = np.abs(stft)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=N_FFT)
    times = librosa.frames_to_time(np.arange(mag.shape[1]), sr=sr, hop_length=HOP_LENGTH)
    rms = np.sqrt(np.mean(mag**2, axis=0))
    env_db = 20.0 * np.log10(np.maximum(rms, 1e-9))

    f0 = estimate_f0(mono, sr)
    adsr = fit_adsr(times, env_db)
    centroid = centroid_trajectory(mag, freqs, times)

    sustain_mask = env_db >= (float(np.max(env_db)) - SUSTAIN_WINDOW_REL_DB)

    if f0["hz"] is not None:
        harmonic_vector, harmonicity_ratio, harmonic_amps = harmonic_vector_and_ratio(
            mag, freqs, sustain_mask, f0["hz"], sr
        )
        deviation = partial_deviation_semitones(mag, freqs, sustain_mask, f0["hz"])
    else:
        harmonic_vector, harmonicity_ratio, harmonic_amps = [0.0] * N_PARTIALS, 0.0, [0.0] * N_PARTIALS
        deviation = None

    return {
        "file": path,
        "duration_s": float(len(mono) / sr),
        "samplerate": sr,
        "f0": f0,
        "adsr": adsr,
        "centroid": centroid,
        "harmonic_vector": harmonic_vector,
        "harmonic_amplitudes": harmonic_amps,
        "harmonicity_ratio": harmonicity_ratio,
        "partial_deviation_semitones": deviation,
        "noise_floor_ratio": _noise_floor_ratio(env_db),
    }


def gate(analysis_result: dict) -> dict:
    """Reachability gate: tier 3 = outside Operator's reachable set (a
    PASSING negative-control state, not an error) with the specific
    measured properties that say so."""
    reasons: list[str] = []
    f0 = analysis_result["f0"]

    if f0["hz"] is None or f0["voiced_fraction"] < F0_MIN_VOICED_FRACTION:
        reasons.append(
            f"no stable pitch detected (voiced fraction "
            f"{f0['voiced_fraction']:.2f} < {F0_MIN_VOICED_FRACTION:.2f}) — this reads as "
            "noise/percussion, not a tonal sound Operator's oscillators can match"
        )
    elif f0["drift_semitones"] is not None and f0["drift_semitones"] > F0_DRIFT_MAX_SEMITONES:
        reasons.append(
            f"pitch is unstable: {f0['drift_semitones']:.2f} semitones of drift "
            f"(> {F0_DRIFT_MAX_SEMITONES:.1f}) — a glide/vibrato/bend across the whole "
            "note is outside a single static patch"
        )

    if analysis_result["harmonicity_ratio"] < HARMONICITY_MIN:
        reasons.append(
            f"harmonicity ratio {analysis_result['harmonicity_ratio']:.2f} is below "
            f"{HARMONICITY_MIN:.2f} — most of the energy is non-harmonic (noise-like or "
            "heavily formant-shaped), outside Operator's additive/FM gamut"
        )

    deviation = analysis_result["partial_deviation_semitones"]
    if deviation is not None and deviation > INHARMONIC_PARTIAL_DEVIATION_SEMITONES:
        reasons.append(
            f"partials deviate {deviation:.2f} semitones on average from an integer "
            f"harmonic series (> {INHARMONIC_PARTIAL_DEVIATION_SEMITONES:.1f}) — stretched/"
            "inharmonic partials (bell/metallic character) are outside Operator's "
            "harmonic oscillators"
        )

    if reasons:
        return {"tier": 3, "reasons": reasons}
    tier = 1 if analysis_result["harmonicity_ratio"] >= HARMONICITY_TIER1_MIN else 2
    return {"tier": tier, "reasons": []}


def _time_to_raw(seconds: float) -> float:
    return float(np.clip(seconds / ASSUMED_MAX_ENVELOPE_S, 0.0, 1.0))


def _level_to_raw(db: float, floor_db: float, peak_db: float) -> float:
    span = peak_db - floor_db
    if span <= 1e-6:
        return 0.5
    return float(np.clip((db - floor_db) / span, 0.0, 1.0))


ADDRESSABLE_CAVEAT = (
    "raw values above are a HEURISTIC normalization (measured time/level "
    f"relative to this sound's own dynamic range and an ASSUMED "
    f"{ASSUMED_MAX_ENVELOPE_S:.0f}s max envelope range), NOT a calibrated "
    "Operator raw<->display curve — none is verified beyond the single "
    "Volume point in knowledge/setup/device-parameter-surface.md (see "
    "knowledge/setup/compressor-raw-display-mapping.md for why one point "
    "isn't a curve). Verify by ear; feed real raw<->display observations "
    "back into a recipe entry."
)


def propose(analysis_result: dict) -> dict:
    vector = analysis_result["harmonic_vector"]
    waveform, residual = classify_waveform(vector)
    adsr = analysis_result["adsr"]
    centroid = analysis_result["centroid"]

    addressable: dict[str, float] = {
        "Ae Attack": _time_to_raw(adsr["attack_s"]),
        "Ae Decay": _time_to_raw(adsr["decay_s"]),
        "Ae Sustain": _level_to_raw(adsr["sustain_db"], adsr["floor_db"], adsr["peak_db"]),
        "Ae Release": _time_to_raw(adsr["release_s"]),
    }
    if centroid["start_hz"] is not None and abs(centroid["end_hz"] - centroid["start_hz"]) > FILTER_SHAPING_HZ:
        addressable["Filter On"] = 1.0

    return {
        "oscillator": {
            "waveform": waveform,
            "residual": residual,
            "note": (
                "closest Operator stock wave by harmonic-vector cosine match; residual "
                "is how much that stock wave alone leaves unexplained — high residual "
                "means lean on drawThesePartials"
            ),
        },
        "envelope": {
            "attack_s": adsr["attack_s"],
            "decay_s": adsr["decay_s"],
            "sustain_db": adsr["sustain_db"],
            "release_s": adsr["release_s"],
            "fit_r_squared": adsr["r_squared"],
        },
        "filter": {
            "direction": centroid["direction"],
            "note": "brightness-trajectory hint only, not a calibrated Filter Freq/Env value",
        },
        "drawThesePartials": vector,
        "addressable": addressable,
        "addressable_caveat": ADDRESSABLE_CAVEAT,
    }


def _summary_line(analysis_result: dict, tier: int, proposal: dict) -> str:
    f0_hz = analysis_result["f0"]["hz"]
    ratio_pct = analysis_result["harmonicity_ratio"] * 100.0
    wave = proposal["oscillator"]["waveform"]
    verdict = (
        "good Operator candidate"
        if tier == 1
        else "reachable, but needs the drawn-partials pass and/or FM to fully match"
    )
    f0_text = f"f0 {f0_hz:.1f} Hz, " if f0_hz is not None else ""
    return f"harmonic ({wave}-like), {f0_text}{ratio_pct:.0f}% harmonic energy — {verdict}"


def _tier3_summary(reasons: list[str]) -> str:
    return "outside Operator's reachable set: " + "; ".join(reasons)


def match(path: str) -> dict:
    analysis_result = analyze(path)
    gated = gate(analysis_result)
    result: dict = {"analysis": analysis_result, "tier": gated["tier"], "reasons": gated["reasons"]}
    if gated["tier"] == 3:
        result["proposal"] = None
        result["summary"] = _tier3_summary(gated["reasons"])
    else:
        proposal = propose(analysis_result)
        result["proposal"] = proposal
        result["summary"] = _summary_line(analysis_result, gated["tier"], proposal)
    return result


# ---------------------------------------------------------------------------
# compare (op verify's closed loop: reference vs candidate capture)
# ---------------------------------------------------------------------------


def compare(ref_path: str, cand_path: str) -> dict:
    """log-spectrogram L2 + harmonic-vector cosine, blended into one score
    in [0, 1] (higher = closer match). Reported as a distance/score with the
    numbers, never a pass/fail verdict — the design doc's "ears decide"."""
    from . import audio

    ref_x, ref_sr = audio.load(ref_path)
    cand_x, cand_sr = audio.load(cand_path)
    ref_mono = to_mono(np.asarray(ref_x, dtype=np.float64))
    cand_mono = to_mono(np.asarray(cand_x, dtype=np.float64))

    if cand_sr != ref_sr:
        cand_mono = librosa.resample(cand_mono, orig_sr=cand_sr, target_sr=ref_sr)
        cand_sr = ref_sr

    n = min(len(ref_mono), len(cand_mono))
    if n / ref_sr < 0.5:
        raise ValueError("reference/candidate overlap is too short to compare (< 0.5 s)")
    ref_mono = ref_mono[:n]
    cand_mono = cand_mono[:n]

    ref_S = np.abs(librosa.stft(ref_mono, n_fft=N_FFT, hop_length=HOP_LENGTH, win_length=FRAME_LENGTH))
    cand_S = np.abs(librosa.stft(cand_mono, n_fft=N_FFT, hop_length=HOP_LENGTH, win_length=FRAME_LENGTH))
    m = min(ref_S.shape[1], cand_S.shape[1])
    ref_S = ref_S[:, :m]
    cand_S = cand_S[:, :m]

    ref_log = np.log10(np.maximum(ref_S, 1e-6))
    cand_log = np.log10(np.maximum(cand_S, 1e-6))
    log_spectrogram_l2 = float(np.sqrt(np.mean((ref_log - cand_log) ** 2)))

    freqs = librosa.fft_frequencies(sr=ref_sr, n_fft=N_FFT)
    ref_env_db = 20.0 * np.log10(np.maximum(np.sqrt(np.mean(ref_S**2, axis=0)), 1e-9))
    cand_env_db = 20.0 * np.log10(np.maximum(np.sqrt(np.mean(cand_S**2, axis=0)), 1e-9))
    ref_mask = ref_env_db >= (float(np.max(ref_env_db)) - SUSTAIN_WINDOW_REL_DB)
    cand_mask = cand_env_db >= (float(np.max(cand_env_db)) - SUSTAIN_WINDOW_REL_DB)

    ref_f0 = estimate_f0(ref_mono, ref_sr)
    harmonic_cosine: float | None = None
    if ref_f0["hz"] is not None:
        cand_f0 = estimate_f0(cand_mono, cand_sr)
        cmp_f0 = cand_f0["hz"] if cand_f0["hz"] is not None else ref_f0["hz"]
        ref_vec, _, _ = harmonic_vector_and_ratio(ref_S, freqs, ref_mask, ref_f0["hz"], ref_sr)
        cand_vec, _, _ = harmonic_vector_and_ratio(cand_S, freqs, cand_mask, cmp_f0, cand_sr)
        rv = np.asarray(ref_vec)
        cv = np.asarray(cand_vec)
        denom = float(np.linalg.norm(rv) * np.linalg.norm(cv))
        if denom > 1e-9:
            harmonic_cosine = float(np.dot(rv, cv) / denom)

    l2_score = float(np.clip(1.0 - log_spectrogram_l2 / SCORE_L2_SCALE, 0.0, 1.0))
    parts = [l2_score] + ([harmonic_cosine] if harmonic_cosine is not None else [])
    score = float(np.mean(parts))

    return {
        "log_spectrogram_l2": log_spectrogram_l2,
        "harmonic_cosine": harmonic_cosine,
        "score": score,
    }
