"""Pitch tracking (masking toolkit): periodicity-based f0, never a naive
FFT-peak pick.

"Loudest FFT bin" peak-picking misreports pitch when a harmonic outshines
the fundamental, as a growl patch's 2nd harmonic does partway through a
sustained note (see docs/design/analysis-engine.md's "Future work"
section). `estimate_f0` follows pyin (autocorrelation/YIN-style
periodicity tracking, the same approach opmatch.py uses), so it tracks the
waveform's repetition rate rather than whichever partial is loudest at a
given moment.

The harmonic-dominance check below reports that condition instead of
hiding it: rather than trusting f0 silently, it measures when a harmonic
gets louder than the fundamental and surfaces it as information without
letting it corrupt the pitch estimate.
"""

from __future__ import annotations

import numpy as np
import librosa

from .audio import to_mono

# Same tested range as opmatch.py's estimate_f0 (~F1-C6): pyin's own
# frame_length=2048 needs >= 2 periods per frame to track cleanly, which is
# exactly where F0_FMIN_HZ sits.
F0_FMIN_HZ = 43.1
F0_FMAX_HZ = 1050.0
FRAME_LENGTH = 2048
HOP_LENGTH = 512
N_FFT = 4096

# Harmonic-dominance check: partials 2..K checked against the fundamental
# per voiced frame. K=5 covers the low harmonics where masking/timbre
# questions (like the growl case) actually live without paying for a full
# 16-partial sweep (opmatch.py's job, not this tool's).
HARMONIC_CHECK_MAX_K = 5
# Search window half-width as a fraction of the target frequency, wide
# enough to catch small per-frame f0 estimation error (mirrors opmatch.py's
# harmonic-band search), capped well under half the harmonic spacing so it
# can't bleed into a neighboring partial. Also floored to the analysis
# window's own mainlobe half-width (2*sr/FRAME_LENGTH, same formula as
# opmatch.py) so low fundamentals, where a purely relative width can be
# narrower than a single FFT bin, still land on a real bin. See
# test_pitch.py's low-fundamental regression: at f0=100 Hz/sr=44100 a purely
# relative 3% window (±3 Hz) missed the 2nd-harmonic bin entirely (~10.8 Hz
# bin spacing), silently reporting "no dominance" on material that plainly
# had one.
HARMONIC_SEARCH_REL_WIDTH = 0.03
HARMONIC_SEARCH_MAX_FRACTION_OF_F0 = 0.45  # never bleed past half the harmonic spacing

# A segment shorter than this can't produce a meaningful pyin frame at all
# (needs >= 1 full analysis frame); reported as a state, not a crash.
MIN_ANALYZABLE_SAMPLES = FRAME_LENGTH

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def hz_to_note(hz: float) -> dict:
    """Nearest equal-tempered (A440) note name/octave + signed cents
    deviation from that note's exact frequency."""
    midi_exact = 69.0 + 12.0 * np.log2(hz / 440.0)
    midi = int(np.round(midi_exact))
    cents = float((midi_exact - midi) * 100.0)
    name = NOTE_NAMES[midi % 12]
    octave = midi // 12 - 1
    return {"name": f"{name}{octave}", "midi": midi, "cents": cents}


def _empty_harmonic_dominance() -> dict:
    return {
        "flagged": False,
        "harmonic": None,
        "ratio_db": None,
        "time_s": None,
        "fraction_of_voiced_frames": 0.0,
    }


def _f0_track(mono: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    f0, voiced_flag, voiced_prob = librosa.pyin(
        mono,
        fmin=F0_FMIN_HZ,
        fmax=F0_FMAX_HZ,
        sr=sr,
        frame_length=FRAME_LENGTH,
        hop_length=HOP_LENGTH,
    )
    f0 = np.asarray(f0, dtype=np.float64)
    voiced_flag = np.asarray(voiced_flag, dtype=bool)
    voiced_prob = np.asarray(voiced_prob, dtype=np.float64)
    voiced = voiced_flag & ~np.isnan(f0)
    return f0, voiced, voiced_prob


def harmonic_dominance(mono: np.ndarray, sr: int, f0_track: np.ndarray, voiced: np.ndarray) -> dict:
    """Per voiced frame, compare each of the first HARMONIC_CHECK_MAX_K
    harmonics' magnitude against the fundamental's own. Reported, never
    used to steer f0 (pyin already tracked the real periodicity). Returns
    the strongest instance found (biggest ratio_db, i.e. harmonic loudest
    relative to the fundamental) plus how much of the voiced material it
    covers.
    """
    if not voiced.any():
        return _empty_harmonic_dominance()

    stft = librosa.stft(mono, n_fft=N_FFT, hop_length=HOP_LENGTH, win_length=FRAME_LENGTH)
    mag = np.abs(stft)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=N_FFT)
    times = librosa.frames_to_time(np.arange(mag.shape[1]), sr=sr, hop_length=HOP_LENGTH)
    n_frames = min(mag.shape[1], len(f0_track), len(voiced))
    # Analysis window's own mainlobe half-width (same formula as
    # opmatch.py's harmonic_vector_and_ratio) floors the search band so a
    # purely relative width can't fall narrower than a single FFT bin.
    mainlobe_half_hz = 2.0 * sr / FRAME_LENGTH

    best_ratio_db = -np.inf
    best_k: int | None = None
    best_time: float | None = None
    dominant_count = 0
    voiced_count = 0

    for i in range(n_frames):
        if not voiced[i] or not np.isfinite(f0_track[i]) or f0_track[i] <= 0:
            continue
        f0_hz = float(f0_track[i])
        cap = HARMONIC_SEARCH_MAX_FRACTION_OF_F0 * f0_hz
        fund_half = min(max(mainlobe_half_hz, HARMONIC_SEARCH_REL_WIDTH * f0_hz), cap)
        fund_band = (freqs >= f0_hz - fund_half) & (freqs <= f0_hz + fund_half)
        if not fund_band.any():
            continue
        fund_amp = float(mag[fund_band, i].max())
        if fund_amp <= 1e-12:
            continue
        voiced_count += 1

        frame_flagged = False
        for k in range(2, HARMONIC_CHECK_MAX_K + 1):
            hk = k * f0_hz
            if hk >= freqs[-1]:
                break
            half = min(max(mainlobe_half_hz, HARMONIC_SEARCH_REL_WIDTH * hk), cap)
            band = (freqs >= hk - half) & (freqs <= hk + half)
            if not band.any():
                continue
            harm_amp = float(mag[band, i].max())
            ratio_db = 20.0 * np.log10(max(harm_amp, 1e-12) / fund_amp)
            # Only track candidates that exceed the fundamental. This is the
            # specific failure mode being surfaced (a harmonic exceeding the
            # fundamental's energy), not a running "loudest relative partial" score that would
            # populate harmonic/ratio_db/time_s even on a clean tone where
            # nothing exceeded anything.
            if ratio_db > 0:
                frame_flagged = True
                if ratio_db > best_ratio_db:
                    best_ratio_db = ratio_db
                    best_k = k
                    best_time = float(times[i])
        if frame_flagged:
            dominant_count += 1

    if best_k is None or voiced_count == 0:
        return _empty_harmonic_dominance()

    return {
        "flagged": True,  # best_k is only ever set for a ratio_db > 0 candidate
        "harmonic": best_k,
        "ratio_db": float(best_ratio_db),
        "time_s": best_time,
        "fraction_of_voiced_frames": float(dominant_count / voiced_count),
    }


def analyze_segment(x: np.ndarray, sr: int) -> dict:
    """f0/note/stability/confidence + harmonic-dominance for one span of
    audio. Unvoiced/silent/too-short is a reported state (`state` field),
    never an exception (docs/lessons-learned.md rule 5)."""
    mono = to_mono(np.asarray(x, dtype=np.float64))

    if mono.size < MIN_ANALYZABLE_SAMPLES:
        return {
            "f0_hz": None,
            "note": None,
            "voiced_fraction": 0.0,
            "f0_stability_semitones": None,
            "confidence": 0.0,
            "harmonic_dominance": _empty_harmonic_dominance(),
            "state": "too_short",
        }

    f0_track, voiced, voiced_prob = _f0_track(mono, sr)

    if not voiced.any():
        return {
            "f0_hz": None,
            "note": None,
            "voiced_fraction": 0.0,
            "f0_stability_semitones": None,
            "confidence": 0.0,
            "harmonic_dominance": _empty_harmonic_dominance(),
            "state": "unvoiced",
        }

    voiced_f0 = f0_track[voiced]
    median_hz = float(np.median(voiced_f0))
    drift = 12.0 * np.log2(voiced_f0 / median_hz)
    stability = float(np.std(drift))
    voiced_fraction = float(np.mean(voiced))
    confidence = float(np.mean(voiced_prob[voiced]))

    dominance = harmonic_dominance(mono, sr, f0_track, voiced)

    return {
        "f0_hz": median_hz,
        "note": hz_to_note(median_hz),
        "voiced_fraction": voiced_fraction,
        "f0_stability_semitones": stability,
        "confidence": confidence,
        "harmonic_dominance": dominance,
        "state": "voiced",
    }


def pitch(
    path: str,
    start_s: float | None = None,
    end_s: float | None = None,
    per_note: bool = False,
    onset_min_gap_s: float = 0.08,
) -> dict:
    """Top-level `awh mix pitch` measurement: whole-span f0 analysis, plus
    (with `per_note=True`) an onset-segmented per-note breakdown. Each
    note gets its own f0/stability/harmonic-dominance rather than one
    average across a changing melody (same time-smearing concern
    bands.py's Welch-vs-one-FFT fix addresses for band energy)."""
    from . import audio

    x, sr = audio.load(path, start_s=start_s, end_s=end_s)
    result = analyze_segment(x, sr)
    result["file"] = path
    result["duration_s"] = float(x.shape[0] / sr)
    result["samplerate"] = sr

    if per_note:
        from .duck import detect_onsets

        duration_s = x.shape[0] / sr
        try:
            onsets = detect_onsets(x, sr, min_gap_s=onset_min_gap_s)
        except ValueError:
            onsets = []
        # Segment boundaries = [0, onset_1, onset_2, ..., duration]. An
        # onset list only marks where a new note starts, so the first
        # segment (the audio before the first detected onset, likely the
        # first note itself) must be included too, not silently dropped.
        bounds = [0.0, *onsets, duration_s] if onsets else []
        notes = []
        for i in range(len(bounds) - 1):
            start, end = bounds[i], bounds[i + 1]
            seg = x[int(round(start * sr)) : int(round(end * sr))]
            seg_result = analyze_segment(seg, sr)
            seg_result["start_s"] = float(start)
            seg_result["end_s"] = float(end)
            notes.append(seg_result)
        # Zero onsets is a state (silent/percussive/no clean attacks found),
        # not an error: the same "zero items is a state" rule as everywhere
        # else (docs/lessons-learned.md rule 5).
        result["notes"] = notes

    return result
