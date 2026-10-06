"""Semantic sample search tests (docs/design/sample-semantic.md's
verification bar, Python side):

- stub-mode determinism (same file -> same vector; different content ->
  different vector)
- text-vs-audio cosine sanity in stub space (unit-norm, finite, not a
  degenerate all-zero vector)
- the "model not installed" error path (real, non-stub mode; never
  touches torch/laion_clap, since the checkpoint file is checked for
  before the lazy import)
- batch JSONL shape through the `clapembed` CLI subcommand + sanitize_json

Every stub test runs with AWH_CLAP_STUB=1 so this file never imports torch
or laion_clap; see clapembed.py's module docstring.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from awh_analysis import clapembed
from conftest import sine, write_wav

SR = 22050
ANALYSIS_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def _stub_mode(monkeypatch):
    monkeypatch.setenv("AWH_CLAP_STUB", "1")


def _wav(tmp_path, name: str, freq: float, duration_s: float = 1.0) -> str:
    path = tmp_path / name
    write_wav(path, sine(freq, SR, duration_s, amp=0.5), SR)
    return str(path)


# ---------------------------------------------------------------------------
# stub determinism
# ---------------------------------------------------------------------------


def test_stub_same_file_same_vector(tmp_path):
    path = _wav(tmp_path, "a.wav", 440.0)
    [rec_a] = clapembed.embed_audio_batch([path])
    [rec_b] = clapembed.embed_audio_batch([path])
    assert rec_a["clap"]["v"] == rec_b["clap"]["v"]


def test_stub_different_content_different_vector(tmp_path):
    path_a = _wav(tmp_path, "a.wav", 440.0)
    path_b = _wav(tmp_path, "b.wav", 220.0)
    [rec_a] = clapembed.embed_audio_batch([path_a])
    [rec_b] = clapembed.embed_audio_batch([path_b])
    assert rec_a["clap"]["v"] != rec_b["clap"]["v"]


def test_stub_byte_identical_copy_embeds_identically(tmp_path):
    """The exact property `similar --semantic`'s Node negative control
    relies on: a byte-for-byte copy of an indexed file embeds to the same
    vector (content-hash-derived, not path-derived)."""
    path_a = _wav(tmp_path, "a.wav", 440.0)
    path_copy = tmp_path / "a_copy.wav"
    path_copy.write_bytes(Path(path_a).read_bytes())

    [rec_a] = clapembed.embed_audio_batch([path_a])
    [rec_copy] = clapembed.embed_audio_batch([str(path_copy)])
    assert rec_a["clap"]["v"] == rec_copy["clap"]["v"]


def test_stub_model_field_is_honestly_stub_v1(tmp_path):
    path = _wav(tmp_path, "a.wav", 440.0)
    [rec] = clapembed.embed_audio_batch([path], model_key="general")
    assert rec["clap"]["model"] == "stub-v1"
    assert rec["clap"]["dim"] == clapembed.EMBED_DIM


def test_stub_unreadable_file_is_a_record_not_a_crash(tmp_path):
    missing = str(tmp_path / "does-not-exist.wav")
    [rec] = clapembed.embed_audio_batch([missing])
    assert rec["unreadable"] is True
    assert rec["error"]
    assert rec["clap"] is None


# ---------------------------------------------------------------------------
# vector shape sanity (L2-normalized, 6-decimal rounded)
# ---------------------------------------------------------------------------


def test_stub_vector_is_l2_normalized_and_rounded(tmp_path):
    path = _wav(tmp_path, "a.wav", 440.0)
    [rec] = clapembed.embed_audio_batch([path])
    v = np.array(rec["clap"]["v"])
    assert len(v) == clapembed.EMBED_DIM
    assert np.isclose(np.linalg.norm(v), 1.0, atol=1e-6)
    # every component is rounded to <= 6 decimals
    for x in rec["clap"]["v"]:
        assert round(x, 6) == x


# ---------------------------------------------------------------------------
# text mode + text-vs-audio cosine sanity in stub space
# ---------------------------------------------------------------------------


def test_stub_text_deterministic_same_phrase_same_vector():
    a = clapembed.embed_text("dusty breakbeat")
    b = clapembed.embed_text("dusty breakbeat")
    assert a["v"] == b["v"]
    assert a["model"] == "stub-v1"


def test_stub_text_different_phrase_different_vector():
    a = clapembed.embed_text("dusty breakbeat")
    b = clapembed.embed_text("dark growl bass")
    assert a["v"] != b["v"]


def test_stub_text_vs_audio_cosine_is_sane(tmp_path):
    """Stub space has no real semantics, so this is a sanity check, not a
    meaningfulness check: text and audio vectors live in the same (fake)
    512-dim unit-sphere space, so their cosine similarity is finite and
    bounded in [-1, 1] — never NaN, never out of range."""
    path = _wav(tmp_path, "a.wav", 440.0)
    [rec] = clapembed.embed_audio_batch([path])
    text = clapembed.embed_text("dusty breakbeat")

    audio_v = np.array(rec["clap"]["v"])
    text_v = np.array(text["v"])
    cosine = float(np.dot(audio_v, text_v))
    assert np.isfinite(cosine)
    assert -1.0 - 1e-6 <= cosine <= 1.0 + 1e-6


# ---------------------------------------------------------------------------
# model-not-installed error path, real mode (never touches torch/laion_clap:
# the checkpoint-file check happens before the lazy import)
# ---------------------------------------------------------------------------


def test_not_installed_error_names_the_exact_steps(tmp_path, monkeypatch):
    monkeypatch.delenv("AWH_CLAP_STUB", raising=False)
    monkeypatch.setenv("AWH_MODELS_DIR", str(tmp_path / "empty-models-dir"))

    path = _wav(tmp_path, "a.wav", 440.0)
    with pytest.raises(RuntimeError) as excinfo:
        clapembed.embed_audio_batch([path], model_key="music")

    msg = str(excinfo.value)
    assert "not installed" in msg
    assert "music_audioset_epoch_15_esc_90.14.pt" in msg
    assert "laion_clap" in msg
    assert "pip install" in msg
    assert str(tmp_path / "empty-models-dir") in msg


def test_not_installed_error_general_model_names_its_own_checkpoint(tmp_path, monkeypatch):
    monkeypatch.delenv("AWH_CLAP_STUB", raising=False)
    monkeypatch.setenv("AWH_MODELS_DIR", str(tmp_path / "empty-models-dir"))

    with pytest.raises(RuntimeError) as excinfo:
        clapembed.embed_text("test phrase", model_key="general")
    assert "630k-audioset-best.pt" in str(excinfo.value)


def test_invalid_model_key_is_a_clear_value_error(tmp_path):
    path = _wav(tmp_path, "a.wav", 440.0)
    with pytest.raises(ValueError, match="--model"):
        clapembed.embed_audio_batch([path], model_key="bogus")


# ---------------------------------------------------------------------------
# batch JSONL shape through the CLI subcommand + sanitize_json
# ---------------------------------------------------------------------------


def test_cli_clapembed_batch_jsonl_shape(tmp_path):
    path_a = _wav(tmp_path, "a.wav", 440.0)
    path_b = _wav(tmp_path, "b.wav", 220.0)

    env = dict(os.environ, AWH_CLAP_STUB="1")
    proc = subprocess.run(
        [sys.executable, "-m", "awh_analysis", "clapembed", path_a, path_b],
        capture_output=True,
        text=True,
        cwd=str(ANALYSIS_ROOT),
        env=env,
    )
    assert proc.returncode == 0, proc.stderr
    lines = [l for l in proc.stdout.splitlines() if l.strip()]
    assert len(lines) == 2
    for line, path in zip(lines, [path_a, path_b]):
        obj = json.loads(line)
        assert obj["path"] == path
        assert obj["unreadable"] is False
        assert obj["clap"]["model"] == "stub-v1"
        assert obj["clap"]["dim"] == clapembed.EMBED_DIM
        assert len(obj["clap"]["v"]) == clapembed.EMBED_DIM


def test_cli_clapembed_text_mode_json_shape(tmp_path):
    env = dict(os.environ, AWH_CLAP_STUB="1")
    proc = subprocess.run(
        [sys.executable, "-m", "awh_analysis", "clapembed", "--text", "dusty breakbeat"],
        capture_output=True,
        text=True,
        cwd=str(ANALYSIS_ROOT),
        env=env,
    )
    assert proc.returncode == 0, proc.stderr
    obj = json.loads(proc.stdout.strip())
    assert obj["text"] == "dusty breakbeat"
    assert obj["clap"]["model"] == "stub-v1"
    assert len(obj["clap"]["v"]) == clapembed.EMBED_DIM


def test_cli_clapembed_stdin_mode(tmp_path):
    path_a = _wav(tmp_path, "a.wav", 440.0)
    env = dict(os.environ, AWH_CLAP_STUB="1")
    proc = subprocess.run(
        [sys.executable, "-m", "awh_analysis", "clapembed"],
        input=f"{path_a}\n",
        capture_output=True,
        text=True,
        cwd=str(ANALYSIS_ROOT),
        env=env,
    )
    assert proc.returncode == 0, proc.stderr
    obj = json.loads(proc.stdout.strip())
    assert obj["path"] == path_a


def test_cli_clapembed_no_nan_or_infinity_tokens(tmp_path):
    """sanitize_json's purpose (docs/lessons-learned.md pattern from
    samplescan): output must be strict, parseable JSON on every line."""
    path_a = _wav(tmp_path, "a.wav", 440.0)
    env = dict(os.environ, AWH_CLAP_STUB="1")
    proc = subprocess.run(
        [sys.executable, "-m", "awh_analysis", "clapembed", path_a],
        capture_output=True,
        text=True,
        cwd=str(ANALYSIS_ROOT),
        env=env,
    )
    assert proc.returncode == 0, proc.stderr
    assert "NaN" not in proc.stdout
    assert "Infinity" not in proc.stdout
    json.loads(proc.stdout.strip())  # strict json module would raise on the tokens above
