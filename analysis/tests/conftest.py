"""Shared synthetic-signal helpers for tests. No fixtures committed, no
network — every test generates its own audio with a fixed seed.
"""

from __future__ import annotations

import numpy as np
import soundfile as sf

SEED = 20260817


def sine(
    freq: float, sr: int, duration_s: float, amp: float = 1.0, phase: float = 0.0
) -> np.ndarray:
    t = np.arange(int(round(duration_s * sr))) / sr
    return amp * np.sin(2 * np.pi * freq * t + phase)


def to_stereo(mono: np.ndarray) -> np.ndarray:
    return np.stack([mono, mono], axis=1)


def write_wav(path, samples: np.ndarray, sr: int) -> None:
    sf.write(str(path), samples, sr, subtype="PCM_24")


def white_noise(sr: int, duration_s: float, amp: float = 0.2, seed: int = SEED) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(round(duration_s * sr))
    return amp * rng.standard_normal(n)


def pink_noise(sr: int, duration_s: float, amp: float = 0.2, seed: int = SEED) -> np.ndarray:
    """Pink noise via spectral shaping (1/sqrt(f) magnitude on white noise)."""
    rng = np.random.default_rng(seed)
    n = int(round(duration_s * sr))
    n_fft = n if n % 2 == 0 else n + 1
    white = rng.standard_normal(n_fft)
    spectrum = np.fft.rfft(white)
    freqs = np.fft.rfftfreq(n_fft, d=1.0 / sr)
    scale = np.ones_like(freqs)
    nonzero = freqs > 0
    scale[nonzero] = 1.0 / np.sqrt(freqs[nonzero])
    scale[~nonzero] = 0.0
    shaped = spectrum * scale
    pink = np.fft.irfft(shaped, n=n_fft)[:n]
    pink = pink / np.max(np.abs(pink))
    return amp * pink


def asymmetric_signal(freq: float, sr: int, duration_s: float, amp: float = 0.7) -> np.ndarray:
    """0.9*sin(wt) + 0.4*sin(2wt + phi): a peak-skewed asymmetric waveform."""
    t = np.arange(int(round(duration_s * sr))) / sr
    w = 2 * np.pi * freq
    sig = 0.9 * np.sin(w * t) + 0.4 * np.sin(2 * w * t + np.pi / 3)
    sig = sig / np.max(np.abs(sig))
    return amp * sig
