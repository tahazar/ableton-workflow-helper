"""awh_analysis: measurements + explanations for rendered audio.

Deterministic DSP for the Ableton Workflow Helper analysis engine:
loudness (BS.1770), true peak, PSR, third-octave spectrum/tilt, stereo
width/correlation, waveform asymmetry, phase-rotation headroom, sidechain
pump, genre targets, and A/B comparison. See
`docs/design/analysis-engine.md` for the measurement definitions this
package implements.
"""

from .ab import ab_compare
from .audio import load, to_mono
from .dynamics import asymmetry, phase_rotation_headroom, pump
from .loudness import lufs_integrated, lufs_short_term, psr, true_peak_db
from .report import analyze, findings
from .spectrum import spectral_tilt, third_octave_spectrum
from .stereo import banded_width_db, correlation, width_db
from .targets import build_target, compare_to_target, load_target, save_target

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "load",
    "to_mono",
    "lufs_integrated",
    "lufs_short_term",
    "true_peak_db",
    "psr",
    "third_octave_spectrum",
    "spectral_tilt",
    "width_db",
    "banded_width_db",
    "correlation",
    "asymmetry",
    "phase_rotation_headroom",
    "pump",
    "build_target",
    "save_target",
    "load_target",
    "compare_to_target",
    "analyze",
    "findings",
    "ab_compare",
]
