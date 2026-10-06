# `awh_analysis`: Python DSP engine

Bridge-independent measurement/transcription engine, invoked as
`python -m awh_analysis <cmd> --json` from the Node CLI (`packages/cli`,
via `analysisPython()`/`runAnalysis*`). Nothing in the Node workspace does
DSP. See `docs/design/analysis-engine.md` and `docs/design/audio-to-midi.md`.

## Setup

One-time, from the repo root:

```sh
python3 -m venv .venv
.venv/bin/pip install -e 'analysis[dev]'
cd analysis && ../.venv/bin/pytest -q && cd ..   # engine self-test
```

The `dev` extra adds `pytest` and `pytest-cov`. For a coverage table, run
`../.venv/bin/pytest -q --cov` from `analysis/`.

`librosa` (ISC, license audit below) is a base dependency:
`awh samples index`'s `samplescan` uses it for spectral centroid/rolloff/
flatness + MFCCs, in addition to the `a2m` extra below.

### `a2m`: audio-to-MIDI transcription

`awh clip from-audio` needs [Basic Pitch](https://github.com/spotify/basic-pitch)
(Spotify's melodic transcription model). Basic Pitch's PyPI metadata
declares an unconditional `tensorflow` dependency on Linux + Python ≥3.11
(`tensorflow<2.15.1,>=2.4.1; platform_system != "Darwin" and
python_version >= "3.11"`, not gated behind an extras selector), so a plain
`pip install basic-pitch` pulls in TensorFlow, Keras, gRPC, protobuf,
TensorBoard, h5py, and ~30 more packages (`pip install --dry-run
basic-pitch`: ~600 MB, tensorflow-2.15.0.post1 plus its full tree). Basic
Pitch only needs one of TF/CoreML/TFLite/ONNX present. It selects a backend
at runtime by trying imports in that order (`basic_pitch/__init__.py`) and
ships a pre-converted `.onnx` copy of its model (`icassp_2022/nmp.onnx`) in
the wheel, so ONNX Runtime alone is sufficient, with no separate model
download or conversion.

Install Basic Pitch with `--no-deps` to skip the TF pull, then its runtime
dependencies minus tensorflow, with `onnxruntime` as the inference backend:

```sh
.venv/bin/pip install "basic-pitch==0.4.0" --no-deps
.venv/bin/pip install onnxruntime librosa "mir_eval>=0.6" "pretty_midi>=0.2.9" \
    "resampy>=0.2.2,<0.4.3" scikit-learn typing_extensions
.venv/bin/pip install "setuptools<81"
```

**Do not skip the `setuptools<81` line.** `resampy` (a runtime dependency
above) imports the deprecated `pkg_resources` API at import time. Newer
`pip`/Python don't bundle `pkg_resources` in a fresh venv, and setuptools
dropped the module starting with 81.x (84.0.0 has no `pkg_resources`). A
fresh venv then fails with
`ModuleNotFoundError: No module named 'pkg_resources'` the first time
anything imports `basic_pitch.inference`, even though every package
installed. This is an upstream `resampy`/librosa issue. With the pin it
emits a harmless deprecation warning; revisit when `pkg_resources` is
removed upstream (flagged for 2025-11-30).

The second line is also the `a2m` extras group in `pyproject.toml`:
`pip install -e '.[a2m]'` from `analysis/` installs the same set. Basic
Pitch still needs the separate `--no-deps` line, since pip extras cannot
un-require a package's own unconditional dependency.

Verify the backend selection (should print `ONNX_PRESENT True`, no
`tensorflow`):

```sh
.venv/bin/python -c "import basic_pitch; print(basic_pitch.TF_PRESENT, basic_pitch.ONNX_PRESENT)"
# False True
```

If `basic_pitch` isn't importable, `awh clip from-audio` fails with an
install-hint error instead of a stack trace (see `a2m.transcribe`).

#### License audit (2026-08-18)

Every package the two commands above add to the venv, checked against PyPI
metadata or the project's `LICENSE` file. None is GPL/AGPL, the hard
constraint for this repo (see `docs/spec.md`'s reuse-map "Avoid" note):

| Package | License | Package | License |
|---|---|---|---|
| basic-pitch | Apache-2.0 | narwhals | MIT |
| onnxruntime | MIT | numba | BSD-2-Clause |
| librosa | ISC | llvmlite | BSD-2-Clause |
| mir_eval | MIT | mido | MIT |
| pretty_midi | MIT | msgpack | Apache-2.0 |
| resampy | ISC | audioread | MIT |
| scikit-learn | BSD-3-Clause | pooch | BSD-3-Clause |
| typing_extensions | PSF-2.0 (already present) | platformdirs | MIT |
| joblib | BSD-3-Clause | requests + urllib3/idna/certifi/charset-normalizer | Apache-2.0 / MIT / BSD-3-Clause / MIT / MPL-2.0 |
| threadpoolctl | BSD-3-Clause | protobuf | BSD-3-Clause |
| decorator | BSD-2-Clause | flatbuffers | Apache-2.0 |
| lazy-loader | BSD-3-Clause | importlib_resources | Apache-2.0 |
| six | MIT | | |

One copyleft dependency: `soxr` (librosa's default resampler backend,
pulled in transitively) is LGPL-2.1. That is acceptable as an ordinary
imported/linked Python dependency (LGPL's linking exception covers this
case, unlike GPL/AGPL) and meets the no-GPL/AGPL constraint. It is the only
license in this tree outside MIT/BSD/Apache/ISC/PSF, so it is called out
here. If it becomes a concern, librosa can use its alternate
`soxr_hq`-free resampler engines; the constraint as written does not
require it.

No TensorFlow and no GPL/AGPL packages entered the venv.

### `clap`: semantic sample search (CLAP embeddings)

`awh samples embed`/`search --semantic`/`similar --semantic` need
[LAION-CLAP](https://github.com/LAION-AI/CLAP) (`laion_clap`), which
joint-embeds audio and text so a text query ("dusty breakbeat") ranks audio
content instead of filename tokens. Unlike Basic Pitch, `laion_clap` has no
unconditional TensorFlow-style dependency. It uses the `torch` already in
the venv (`report`/`ab` etc. don't need torch, but nothing excludes it), so
the extras group is enough, with no `--no-deps` workaround.

It is not installed in the development container: the checkpoint comes
from Hugging Face, which is egress-blocked there, so the real model cannot
run in that checkout. `AWH_CLAP_STUB=1` (handled in `clapembed.py`:
deterministic hash-derived vectors, `model: "stub-v1"`) covers every
Node/Python test in this repo without loading `laion_clap` or `torch`'s
CLAP path. Install for real use on your own machine:

```sh
cd analysis && ../.venv/bin/pip install -e '.[clap]'   # or: pip install laion_clap
```

Checkpoint: download the music-tuned checkpoint (the CLI's default,
`--model music`) into `~/.awh/models/` (create the folder first):

```sh
mkdir -p ~/.awh/models
curl -L https://huggingface.co/lukewys/laion_clap/resolve/main/music_audioset_epoch_15_esc_90.14.pt \
    -o ~/.awh/models/music_audioset_epoch_15_esc_90.14.pt
# --model general instead:
curl -L https://huggingface.co/lukewys/laion_clap/resolve/main/630k-audioset-best.pt \
    -o ~/.awh/models/630k-audioset-best.pt
```

If the checkpoint file isn't present, `awh samples embed`/`search
--semantic`/`similar --semantic` fail with this install-hint error (never a
bare stack trace, never a silent auto-download); see
`clapembed._not_installed_message`.

License stance: LAION-CLAP code + checkpoints only. **No CC-BY-NC weights
anywhere in this path.** Both checkpoints above are the project's own open
(non-commercial-restricted) releases, the same stance as
`docs/design/sample-semantic.md`.

License audit (2026-08-24, `pip install laion_clap --dry-run` against the
venv; PyPI was reachable for this metadata check, and the package was not
installed, per the rule above). `torch` is already present (2.13.0+cu130)
and not re-installed by this extra:

| Package | License | Package | License |
|---|---|---|---|
| laion_clap | Apache-2.0 (PyPI classifier; the package's `license` metadata field embeds CC0 legal text instead, a packaging artifact rather than a re-license, so treated as Apache-2.0 per the classifier and upstream's stated stance) | pydantic / pydantic_core | MIT |
| annotated-types | MIT | python-dateutil | Apache-2.0 / BSD (dual) |
| braceexpand | MIT | sentry-sdk | MIT |
| ftfy | Apache-2.0 | torchlibrosa | MIT |
| h5py | BSD-3-Clause | typing-inspection | MIT |
| opentelemetry-api | Apache-2.0 | wandb | MIT |
| pandas | BSD-3-Clause | wcwidth | MIT |
| progressbar (2.5) | BSD / LGPL-3.0 (dual); acceptable as an ordinary imported dependency, same reasoning as `soxr` above; not GPL/AGPL | webdataset | BSD-3-Clause |
| | | wget | Public domain |

No TensorFlow and no GPL/AGPL packages in this dependency tree. One caveat
before a real install: the dry-run resolved `numpy==1.26.4` for
`laion_clap`'s own pin, older than the venv's current `numpy` (2.4.6).
Watch for a downgrade/conflict warning on install; the dry-run cannot
verify this further.

## Everyday

```sh
cd analysis && ../.venv/bin/pytest -q
```

`$AWH_PYTHON` overrides which interpreter the CLI spawns (else
`<repo root>/.venv/bin/python`, else `python3` on PATH).
