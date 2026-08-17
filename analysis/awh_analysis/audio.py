"""Audio file loading helpers.

All measurements operate on float64 samples. Loading never resamples;
the file's native sample rate is returned alongside the samples.
"""

from __future__ import annotations

import numpy as np
import soundfile as sf

MIN_DURATION_S = 1.0


def load(
    path: str,
    start_s: float | None = None,
    end_s: float | None = None,
) -> tuple[np.ndarray, int]:
    """Load an audio file (wav/aiff/...) as float64 samples.

    Parameters
    ----------
    path : str
        Path to the audio file.
    start_s, end_s : float, optional
        Trim window in seconds. `start_s` defaults to 0, `end_s` to the
        file's end.

    Returns
    -------
    samples : ndarray, shape (n, ch)
        Float64 samples, always 2-D (mono files have ch == 1).
    samplerate : int

    Raises
    ------
    ValueError
        If the file (or the requested `--from/--to` window) is shorter
        than 1 second, or if start_s/end_s are out of range.
    """
    info = sf.info(path)
    sr = info.samplerate
    total_frames = info.frames

    frame_start = 0 if start_s is None else int(round(start_s * sr))
    frame_end = total_frames if end_s is None else int(round(end_s * sr))

    if frame_start < 0 or frame_start > total_frames:
        raise ValueError(
            f"start_s={start_s} is out of range for a file of "
            f"{total_frames / sr:.3f} s"
        )
    if frame_end < frame_start or frame_end > total_frames:
        raise ValueError(
            f"end_s={end_s} is out of range for a file of "
            f"{total_frames / sr:.3f} s"
        )

    n_frames = frame_end - frame_start
    if n_frames / sr < MIN_DURATION_S:
        raise ValueError(
            f"'{path}' selection is {n_frames / sr:.3f} s, shorter than the "
            f"minimum {MIN_DURATION_S:.0f} s required for analysis"
        )

    samples, sr = sf.read(
        path,
        start=frame_start,
        frames=n_frames,
        dtype="float64",
        always_2d=True,
    )
    return samples, sr


def to_mono(x: np.ndarray) -> np.ndarray:
    """Downmix (n, ch) samples to mono by averaging channels."""
    if x.ndim == 1:
        return x
    return x.mean(axis=1)
