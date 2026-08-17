"""Tests for the M8 reference-track analysis module (awh_analysis.ref).

All fixtures are synthetic references built with numpy + soundfile in
pytest's tmp_path — no committed audio. Constructions are built with KNOWN
structure (exact BPM, exact section boundaries) so tempo/grid/section
results can be checked against ground truth, per
docs/design/reference-deconstruction.md's verification section.
"""

from __future__ import annotations

import numpy as np
import pytest

from awh_analysis import ref
from awh_analysis.audio import to_mono

from conftest import to_stereo, write_wav

SR = 44100


# ---------------------------------------------------------------------------
# Synthesis helpers
# ---------------------------------------------------------------------------


def _kick(n: int, sr: int, amp: float = 0.9, decay_tau: float = 0.12, freq: float = 58.0) -> np.ndarray:
    """A decaying low sine + a short broadband click, like a kick drum."""
    t = np.arange(n) / sr
    sig = amp * np.exp(-t / decay_tau) * np.sin(2 * np.pi * freq * t)
    click_len = min(n, int(0.003 * sr))
    if click_len > 0:
        click_env = np.exp(-np.arange(click_len) / (0.001 * sr))
        sig[:click_len] += 0.3 * amp * click_env * np.random.default_rng(1).standard_normal(click_len)
    return sig


def _hat(n: int, sr: int, amp: float = 0.15, seed: int = 2, tau: float = 0.02) -> np.ndarray:
    rng = np.random.default_rng(seed)
    t = np.arange(n) / sr
    return amp * np.exp(-t / tau) * rng.standard_normal(n)


def _snare(n: int, sr: int, amp: float = 0.7, tau: float = 0.08, seed: int = 3) -> np.ndarray:
    rng = np.random.default_rng(seed)
    t = np.arange(n) / sr
    return amp * np.exp(-t / tau) * rng.standard_normal(n)


def _add(sig: np.ndarray, start_s: float, sr: int, burst: np.ndarray) -> None:
    start = int(round(start_s * sr))
    n = sig.size
    length = min(burst.size, n - start)
    if length > 0 and start >= 0:
        sig[start : start + length] += burst[:length]


HOUSE_BPM = 128.0
HOUSE_OFFSET_S = 0.25
HOUSE_SECTIONS = [
    # (name, n_bars, has_kick, kick_gain_db_range, hat_gain_db_range)
    ("intro", 16, False, None, (-14.0, -14.0)),
    ("build", 16, False, None, (-14.0, -6.0)),  # ramping, sub-light
    ("drop", 32, True, (0.0, 0.0), (0.0, 0.0)),
    ("breakdown", 16, False, None, (-9.0, -9.0)),
    ("drop", 32, True, (0.0, 0.0), (0.0, 0.0)),
    ("outro", 8, True, (0.0, -18.0), (0.0, -18.0)),  # fading
]


def _build_house_track(sr: int = SR) -> tuple[np.ndarray, list[tuple[int, int, str]]]:
    """128 BPM 4/4 house construction: kick burst every beat (in kick
    sections), hats, and a section energy envelope matching
    intro(16, -14dB, no kick) / build(16, ramping) / drop(32, full) /
    breakdown(16, -9dB, kick muted) / drop(32, full) / outro(8, fading).
    Downbeats get a mild accent (real kick patterns are rarely perfectly
    uniform) so the downbeat heuristic has something to lock onto.
    """
    beat = 60.0 / HOUSE_BPM
    bar = 4 * beat
    total_bars = sum(s[1] for s in HOUSE_SECTIONS)
    duration_s = HOUSE_OFFSET_S + total_bars * bar + 1.0
    n = int(np.ceil(duration_s * sr))
    sig = np.zeros(n)

    bar_idx = 0
    boundaries = []
    for name, n_bars, has_kick, kick_range, hat_range in HOUSE_SECTIONS:
        boundaries.append((bar_idx, bar_idx + n_bars, name))
        for b in range(n_bars):
            bar_start_s = HOUSE_OFFSET_S + (bar_idx + b) * bar
            frac = b / max(1, n_bars - 1)
            hat_gain = 10 ** ((hat_range[0] + frac * (hat_range[1] - hat_range[0])) / 20.0)
            kick_gain = 0.0
            if has_kick and kick_range is not None:
                kick_gain = 10 ** ((kick_range[0] + frac * (kick_range[1] - kick_range[0])) / 20.0)

            for beat_i in range(4):
                beat_start_s = bar_start_s + beat_i * beat
                if has_kick and kick_gain > 0:
                    boost = 1.6 if beat_i == 0 else 1.0  # mild downbeat accent
                    _add(sig, beat_start_s, sr, kick_gain * boost * _kick(int(0.4 * sr), sr))
                if hat_gain > 0:
                    for sub in (0.0, 0.5):
                        _add(sig, beat_start_s + sub * beat, sr, hat_gain * 0.5 * _hat(int(0.05 * sr), sr))
        bar_idx += n_bars

    sig = sig / (np.max(np.abs(sig)) + 1e-9) * 0.9
    return sig, boundaries


TRAP_BPM = 140.0
TRAP_BARS = 32
TRAP_HAT_AMP = 0.25


def _build_trap_track(sr: int = SR) -> np.ndarray:
    """Half-time 140 BPM trap construction: 808 kick on beat 1 and the
    "and" of 3 (beat 3.5) only, snare on beat 3, 8th-note hats — the
    classic half-time pattern that's genuinely ambiguous between its
    production tempo (140) and its half-time feel (70)."""
    beat = 60.0 / TRAP_BPM
    bar = 4 * beat
    n = int(np.ceil((TRAP_BARS * bar + 1.0) * sr))
    sig = np.zeros(n)
    for b in range(TRAP_BARS):
        bar_start_s = b * bar
        for beat_pos in (0.0, 3.5):
            _add(sig, bar_start_s + beat_pos * beat, sr, _kick(int(0.5 * sr), sr, decay_tau=0.25, freq=45.0))
        _add(sig, bar_start_s + 2 * beat, sr, _snare(int(0.2 * sr), sr))
        for sub in np.arange(0, 4, 0.5):
            _add(sig, bar_start_s + sub * beat, sr, _hat(int(0.02 * sr), sr, amp=TRAP_HAT_AMP))
    return sig / (np.max(np.abs(sig)) + 1e-9) * 0.9


CLICK_BPM = 174.0


def _build_click_track(n_beats: int = 120, sr: int = SR) -> np.ndarray:
    """Pure click train at an exact BPM, for a direct estimate_tempo unit test."""
    beat = 60.0 / CLICK_BPM
    n = int(np.ceil((n_beats * beat + 1.0) * sr))
    sig = np.zeros(n)

    def click(length: int) -> np.ndarray:
        t = np.arange(length) / sr
        env = np.exp(-t / 0.001)
        return env * np.sin(2 * np.pi * 2000.0 * t)

    for b in range(n_beats):
        _add(sig, b * beat, sr, click(int(0.004 * sr)))
    return sig


DOWNBEAT_BPM = 120.0
DOWNBEAT_OFFSET_S = 0.3
DOWNBEAT_BARS = 40


def _build_downbeat_grid(sr: int = SR) -> np.ndarray:
    """Kick ONLY on bar starts, hats on beats 2-4 — an unambiguous grid
    for testing downbeat identification specifically."""
    beat = 60.0 / DOWNBEAT_BPM
    bar = 4 * beat
    n = int(np.ceil((DOWNBEAT_OFFSET_S + DOWNBEAT_BARS * bar + 1.0) * sr))
    sig = np.zeros(n)
    for b in range(DOWNBEAT_BARS):
        bar_start_s = DOWNBEAT_OFFSET_S + b * bar
        _add(sig, bar_start_s, sr, _kick(int(0.35 * sr), sr, decay_tau=0.12, freq=55.0))
        for beat_i in (1, 2, 3):
            _add(sig, bar_start_s + beat_i * beat, sr, _hat(int(0.03 * sr), sr, amp=0.2, seed=7))
    return sig / (np.max(np.abs(sig)) + 1e-9) * 0.9


# ---------------------------------------------------------------------------
# House: full analyze_reference round-trip
# ---------------------------------------------------------------------------


def test_house_track_tempo_grid_and_sections(tmp_path):
    sig, boundaries = _build_house_track()
    path = tmp_path / "house.wav"
    write_wav(path, to_stereo(sig), SR)

    result = ref.analyze_reference(str(path))

    assert result["bpm"] == pytest.approx(HOUSE_BPM, abs=0.1)

    one_beat = 60.0 / HOUSE_BPM
    offset_diff = abs(result["beat_offset_s"] - HOUSE_OFFSET_S) % one_beat
    offset_diff = min(offset_diff, one_beat - offset_diff)
    assert offset_diff <= one_beat / 2.0 + 1e-6

    sections = result["sections"]
    assert sections, "expected at least one detected section"

    # Every constructed boundary (in bars) is matched by a detected
    # boundary within +/-2 bars.
    detected_boundaries = sorted({s["start_bar"] for s in sections} | {sections[-1]["end_bar"] + 1})
    constructed_boundary_bars = sorted({b[0] + 1 for b in boundaries} | {boundaries[-1][1] + 1})
    for bar in constructed_boundary_bars:
        assert any(abs(bar - d) <= 2 for d in detected_boundaries), (
            f"constructed boundary at bar {bar} has no detected boundary within +/-2 bars "
            f"(detected: {detected_boundaries})"
        )

    # Detected NAMED sections appear in the constructed order (unlabeled
    # 'section' spans are allowed anywhere).
    named_order = [s["name"] for s in sections if s["name"] != "section"]
    constructed_order = [b[2] for b in boundaries]
    assert named_order == constructed_order, f"{named_order} != {constructed_order}"

    # Every section has non-empty evidence quoting numbers.
    for s in sections:
        assert s["evidence"], f"section {s} has empty evidence"
        assert any(ch.isdigit() for ch in s["evidence"]), f"evidence has no numbers: {s['evidence']!r}"

    assert "measurements" in result
    assert result["bar_count"] == sum(b[1] for b in HOUSE_SECTIONS)


# ---------------------------------------------------------------------------
# Tempo estimator unit test: pure click train
# ---------------------------------------------------------------------------


def test_estimate_tempo_on_click_train():
    sig = _build_click_track()
    onset_env, _sub_env, hop_s = ref.onset_and_subband(sig, SR)
    tempo = ref.estimate_tempo(onset_env, hop_s)
    assert tempo["bpm"] == pytest.approx(CLICK_BPM, abs=0.1)


# ---------------------------------------------------------------------------
# Half-time trap: tempo ambiguity must be surfaced, not hidden
# ---------------------------------------------------------------------------


def test_trap_half_time_tempo_ambiguity_is_surfaced(tmp_path):
    sig = _build_trap_track()
    path = tmp_path / "trap.wav"
    write_wav(path, to_stereo(sig), SR)

    result = ref.analyze_reference(str(path))
    bpm = result["bpm"]
    runner_up = result["bpm_runner_up"]

    assert bpm == pytest.approx(140.0, abs=1.0) or bpm == pytest.approx(70.0, abs=1.0)
    other = 70.0 if bpm == pytest.approx(140.0, abs=1.0) else 140.0
    assert runner_up is not None
    assert runner_up == pytest.approx(other, abs=1.0)

    assert any("ambig" in note.lower() for note in result["notes"]), result["notes"]


# ---------------------------------------------------------------------------
# Downbeat identification on an unambiguous kick-on-1 grid
# ---------------------------------------------------------------------------


def test_downbeat_identifies_bar_starts():
    sig = _build_downbeat_grid()
    onset_env, sub_env, hop_s = ref.onset_and_subband(sig, SR)
    bpm = DOWNBEAT_BPM  # tempo estimation is covered elsewhere; fix it here

    beat_offset_s = ref.beat_phase(onset_env, hop_s, bpm)
    one_beat = 60.0 / bpm
    phase_diff = abs(beat_offset_s - DOWNBEAT_OFFSET_S) % one_beat
    phase_diff = min(phase_diff, one_beat - phase_diff)
    assert phase_diff <= one_beat / 2.0 + 1e-6

    downbeat = ref.find_downbeat(sub_env, onset_env, hop_s, bpm, beat_offset_s)
    bar_period = 4 * one_beat
    true_bar_start = DOWNBEAT_OFFSET_S % bar_period
    diff = abs(downbeat["downbeat_offset_s"] - true_bar_start) % bar_period
    diff = min(diff, bar_period - diff)
    assert diff <= one_beat + 1e-6
    assert downbeat["confidence"] > 0.5  # kick-only-on-1 is an unambiguous case


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


def test_analyze_reference_is_deterministic(tmp_path):
    beat = 60.0 / 128.0
    n_beats = 32  # 8 bars @128bpm ~= 15s, comfortably over the 10s minimum
    n = int(np.ceil((n_beats * beat + 1.0) * SR))
    sig = np.zeros(n)
    for b in range(n_beats):
        _add(sig, b * beat, SR, _kick(int(0.3 * SR), SR))
        for sub in (0.0, 0.5):
            _add(sig, b * beat + sub * beat, SR, _hat(int(0.03 * SR), SR))
    sig = sig / (np.max(np.abs(sig)) + 1e-9) * 0.9

    path = tmp_path / "det.wav"
    write_wav(path, to_stereo(sig), SR)

    r1 = ref.analyze_reference(str(path))
    r2 = ref.analyze_reference(str(path))
    assert r1 == r2


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------


def test_analyze_reference_rejects_short_file(tmp_path):
    sig = to_stereo(np.zeros(int(5.0 * SR)))
    path = tmp_path / "short.wav"
    write_wav(path, sig, SR)
    with pytest.raises(ValueError, match=r"(?i)short|10"):
        ref.analyze_reference(str(path))


# ---------------------------------------------------------------------------
# Smoke tests for the other exported pieces
# ---------------------------------------------------------------------------


def test_bar_arc_bars_are_one_based_and_relative_to_own_max():
    sig = _build_downbeat_grid()
    arc = ref.bar_arc(sig, SR, DOWNBEAT_BPM, DOWNBEAT_OFFSET_S)
    assert arc[0]["bar"] == 1
    assert [a["bar"] for a in arc] == list(range(1, len(arc) + 1))
    assert max(a["full_db"] for a in arc) == pytest.approx(0.0, abs=1e-6)
    assert max(a["sub_db"] for a in arc) == pytest.approx(0.0, abs=1e-6)


def test_detect_sections_empty_arc_returns_empty():
    assert ref.detect_sections([], phrase_bars=4) == []
