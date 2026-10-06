"""Semantic sample search (docs/design/sample-semantic.md): CLAP
audio/text embeddings for `awh samples embed` / `search --semantic` /
`similar --semantic`.

Wraps `laion_clap` (torch CPU; torch is already in the venv per
analysis/README.md, and the `laion_clap` package itself is an optional
extra, see pyproject.toml's `clap` group). LAION-CLAP's checkpoints are open
(Apache-2.0-classified code; no CC-BY-NC weights are used in this module,
see analysis/README.md's license note). Loads the checkpoint once per
invocation and batches audio files through it (`embed_audio_batch`), or
embeds a single text phrase through it (`embed_text`, the CLI's `--text`
mode). This is the same one-Python-invocation-per-batch shape `samplescan`
uses to amortize its import cost.

Checkpoint resolution: `~/.awh/models/`. The `AWH_MODELS_DIR` override is
for tests only, mirroring `samples.ts`'s `AWH_SAMPLES_INDEX` pattern of
never touching the real machine-local cache from an automated run. Hugging
Face is egress-blocked in the dev container (same constraint as Basic
Pitch, see analysis/README.md), so the checkpoint is downloaded on the
user's machine. If it's missing, this raises one actionable error naming
the exact package, checkpoint file and destination path, never a bare stack
trace and never a silent auto-download.

AWH_CLAP_STUB=1 activates a deterministic, hash-derived stub embedder
inside this module (not a separate test-only file) so every Node test runs
without torch/laion_clap loading. Every vector the stub emits is stamped
`model: "stub-v1"` regardless of which --model was requested, since the
stub has no per-checkpoint distinction to make. `torch`/`laion_clap` are
imported lazily, only inside the non-stub `_RealEmbedder` path: importing
this module, or running any command under the stub, must stay fast and
must not require the `clap` extra.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any

import numpy as np

STUB_MODEL_LABEL = "stub-v1"

# LAION-CLAP's HTSAT-base joint audio/text embedding dimension, the same for
# both checkpoints below. The stub matches it so stub-mode vectors have the
# real shape (dim, roundtrip through the index schema) even though their
# content is meaningless.
EMBED_DIM = 512

MODEL_CHOICES = ("music", "general")
DEFAULT_MODEL = "music"

# Checkpoint files as published by the LAION-CLAP project. "music" is the
# music-tuned checkpoint (the default for sample-library content, since
# loops/one-shots skew musical rather than general AudioSet-style clips);
# "general" is the broader AudioSet-trained checkpoint. Both are open
# weights (no CC-BY-NC in this map; see analysis/README.md's license note).
# `label` is stamped on every vector (`clap.model`) and is the whole
# mismatch-detection contract with `packages/cli/src/samples.ts`'s
# `CLAP_MODEL_LABELS`. The two are kept in sync manually.
_CHECKPOINTS: dict[str, dict[str, str]] = {
    "music": {
        "filename": "music_audioset_epoch_15_esc_90.14.pt",
        "url": "https://huggingface.co/lukewys/laion_clap/resolve/main/music_audioset_epoch_15_esc_90.14.pt",
        "amodel": "HTSAT-base",
        "label": "clap-music-v1",
    },
    "general": {
        "filename": "630k-audioset-best.pt",
        "url": "https://huggingface.co/lukewys/laion_clap/resolve/main/630k-audioset-best.pt",
        "amodel": "HTSAT-base",
        "label": "clap-general-v1",
    },
}


def _models_dir() -> Path:
    """`~/.awh/models` (override `AWH_MODELS_DIR`, tests only)."""
    override = os.environ.get("AWH_MODELS_DIR")
    if override and override.strip():
        return Path(override).expanduser().resolve()
    return Path.home() / ".awh" / "models"


def _is_stub() -> bool:
    return os.environ.get("AWH_CLAP_STUB") == "1"


def _validate_model(model_key: str) -> None:
    if model_key not in MODEL_CHOICES:
        raise ValueError(f"--model must be one of {MODEL_CHOICES} (got {model_key!r})")


def _finalize_vector(v: Any) -> list[float]:
    """L2-normalize then round to 6 decimals to bound index size. This is the
    exact on-disk shape for every `clap.v`, in both stub and real mode."""
    arr = np.asarray(v, dtype=np.float64).reshape(-1)
    norm = float(np.linalg.norm(arr))
    if norm > 0:
        arr = arr / norm
    return [round(float(x), 6) for x in arr]


def _wrap(model_label: str, vector: list[float]) -> dict[str, Any]:
    return {"model": model_label, "dim": len(vector), "v": vector}


# ---------------------------------------------------------------------------
# stub embedder (AWH_CLAP_STUB=1): deterministic, content-hash-derived
# ---------------------------------------------------------------------------


def _stub_vector(data: bytes) -> list[float]:
    """Deterministic hash-derived unit vector: the same bytes always embed
    to the same vector, giving real-embedding determinism without torch.
    Content-derived, not path-derived, so a byte-identical copy of an
    indexed file embeds identically too. That is what the `similar --semantic` "stub-identical file ranks first"
    negative control needs."""
    digest = hashlib.sha256(data).digest()
    seed = int.from_bytes(digest[:8], "big")
    rng = np.random.default_rng(seed)
    return _finalize_vector(rng.standard_normal(EMBED_DIM))


def _stub_embed_audio(path: str) -> list[float]:
    with open(path, "rb") as f:
        data = f.read()
    return _stub_vector(data)


def _stub_embed_text(text: str) -> list[float]:
    return _stub_vector(text.encode("utf-8"))


# ---------------------------------------------------------------------------
# real embedder: laion_clap, torch CPU, imported lazily
# ---------------------------------------------------------------------------


def _not_installed_message(model_key: str) -> str:
    info = _CHECKPOINTS[model_key]
    ckpt_path = _models_dir() / info["filename"]
    return (
        f"CLAP checkpoint not installed: expected '{ckpt_path}'. This is the "
        f"'{model_key}' checkpoint ('{info['filename']}') from the LAION-CLAP "
        "project (open weights — no CC-BY-NC checkpoints are used here). "
        "Hugging Face is egress-blocked in the dev container, so fetch this on "
        "your own machine:\n"
        "  1. pip install laion_clap        (or: pip install -e '.[clap]' from analysis/)\n"
        f"  2. mkdir -p {_models_dir()}\n"
        f"  3. curl -L {info['url']} -o {ckpt_path}\n"
        "See analysis/README.md for the full install command + license audit. "
        "`awh samples embed` never downloads this automatically."
    )


class _RealEmbedder:
    """Loads one laion_clap checkpoint once and reuses it across a whole
    batch. The multi-second torch/model-load cost is why this is a class
    instance kept alive for the invocation, not a per-file function (same
    reasoning as samplescan's per-chunk python invocation amortizing librosa's
    import cost)."""

    def __init__(self, model_key: str):
        _validate_model(model_key)
        info = _CHECKPOINTS[model_key]
        ckpt_path = _models_dir() / info["filename"]
        if not ckpt_path.exists():
            raise RuntimeError(_not_installed_message(model_key))

        try:
            import laion_clap  # noqa: PLC0415 - intentionally lazy, see module docstring
        except ImportError as exc:
            raise RuntimeError(
                "laion_clap is not installed in this environment. Install the "
                "`clap` extra (`pip install -e '.[clap]'` from analysis/, or "
                "`pip install laion_clap`) — see analysis/README.md for the exact "
                "command and the license audit."
            ) from exc

        self.model_key = model_key
        self.label = info["label"]
        self._model = laion_clap.CLAP_Module(enable_fusion=False, amodel=info["amodel"])
        self._model.load_ckpt(str(ckpt_path))

    def embed_audio_batch(self, paths: list[str]) -> Any:
        return self._model.get_audio_embedding_from_filelist(x=paths, use_tensor=False)

    def embed_text(self, text: str) -> Any:
        embed = self._model.get_text_embedding([text], use_tensor=False)
        return embed[0]


# ---------------------------------------------------------------------------
# public entry points, used by the `clapembed` CLI subcommand
# ---------------------------------------------------------------------------


def embed_audio_batch(paths: list[str], model_key: str = DEFAULT_MODEL) -> list[dict[str, Any]]:
    """One record per input path, in order, never raising per-file. A
    per-file decode failure becomes `{"path", "unreadable": true, "error"}`
    (same contract as `samplescan.scan_file`). A missing checkpoint or a
    missing `laion_clap` install is a whole-batch failure (raises): it's an
    environment problem, not a bad audio file, and must never degrade into
    a silently-partial embed."""
    _validate_model(model_key)

    if _is_stub():
        records: list[dict[str, Any]] = []
        for path in paths:
            try:
                vec = _stub_embed_audio(path)
                records.append(
                    {"path": path, "unreadable": False, "error": None, "clap": _wrap(STUB_MODEL_LABEL, vec)}
                )
            except Exception as exc:  # noqa: BLE001 - one bad file is a record, not a crash
                records.append({"path": path, "unreadable": True, "error": str(exc), "clap": None})
        return records

    embedder = _RealEmbedder(model_key)
    try:
        vectors = embedder.embed_audio_batch(paths)
        return [
            {
                "path": path,
                "unreadable": False,
                "error": None,
                "clap": _wrap(embedder.label, _finalize_vector(vec)),
            }
            for path, vec in zip(paths, vectors, strict=True)
        ]
    except Exception:  # noqa: BLE001 - narrowed by quality plan item 20
        # A whole-batch failure (e.g. one corrupt file the model itself
        # chokes on) falls back to one-at-a-time so the rest of the batch
        # still embeds. This mirrors samplescan's per-file resilience at the
        # batch-call boundary instead of per-file from the start, because
        # batching is the point of a chunk and only a failure should
        # degrade off it.
        records = []
        for path in paths:
            try:
                vec = embedder.embed_audio_batch([path])[0]
                records.append(
                    {
                        "path": path,
                        "unreadable": False,
                        "error": None,
                        "clap": _wrap(embedder.label, _finalize_vector(vec)),
                    }
                )
            except Exception as file_exc:  # noqa: BLE001 - one bad file is a record, not a crash
                records.append({"path": path, "unreadable": True, "error": str(file_exc), "clap": None})
        return records


def embed_text(text: str, model_key: str = DEFAULT_MODEL) -> dict[str, Any]:
    """Embed a single text phrase (the `--text` CLI mode / `search
    --semantic`'s query) into the same space as `embed_audio_batch`'s
    vectors for the same model_key."""
    _validate_model(model_key)
    if _is_stub():
        return _wrap(STUB_MODEL_LABEL, _stub_embed_text(text))
    embedder = _RealEmbedder(model_key)
    return _wrap(embedder.label, _finalize_vector(embedder.embed_text(text)))
