# `awh_analysis` — Python DSP engine

Bridge-independent measurement/transcription engine invoked as
`python -m awh_analysis <cmd> --json` from the Node CLI (`packages/cli`,
via `analysisPython()`/`runAnalysis*`). Nothing in the Node workspace does
DSP — see `docs/design/analysis-engine.md` and `docs/design/audio-to-midi.md`.

## Setup

One-time, from the repo root:

```sh
python3 -m venv .venv
.venv/bin/pip install numpy scipy soundfile pyloudnorm pytest
cd analysis && ../.venv/bin/pytest -q && cd ..   # engine self-test
```

### B1 (`a2m` — audio-to-MIDI transcription)

`awh clip from-audio` needs [Basic Pitch](https://github.com/spotify/basic-pitch)
(Spotify's melodic transcription model). Basic Pitch's own PyPI metadata
declares an **unconditional** `tensorflow` dependency on Linux + Python
≥3.11 (`tensorflow<2.15.1,>=2.4.1; platform_system != "Darwin" and
python_version >= "3.11"` — not gated behind an extras selector), so a plain
`pip install basic-pitch` drags in TensorFlow, Keras, gRPC, protobuf,
TensorBoard, h5py, and ~30 more packages (confirmed via
`pip install --dry-run basic-pitch`: ~600 MB, tensorflow-2.15.0.post1 plus
its full tree). Basic Pitch itself only *needs* one of TF/CoreML/TFLite/ONNX
present — it auto-selects a backend at runtime by trying imports in that
order (`basic_pitch/__init__.py`) and ships a pre-converted `.onnx` copy of
its model (`icassp_2022/nmp.onnx`) inside the wheel, so ONNX Runtime alone is
sufficient and needs no separate model download or conversion step.

**Exact install used** (installs Basic Pitch with `--no-deps` to skip the
unconditional TF pull, then installs its *actual* runtime dependencies minus
tensorflow, substituting `onnxruntime` for the inference backend):

```sh
.venv/bin/pip install "basic-pitch==0.4.0" --no-deps
.venv/bin/pip install onnxruntime librosa "mir_eval>=0.6" "pretty_midi>=0.2.9" \
    "resampy>=0.2.2,<0.4.3" scikit-learn typing_extensions
```

(The second line is also captured as the `a2m` extras group in
`pyproject.toml` — `pip install -e '.[a2m]'` from `analysis/` installs the
same set, but Basic Pitch itself still needs the separate `--no-deps` line
above since pip extras cannot un-require a package's own unconditional
dependency.)

Verify the backend selection (should print `ONNX_PRESENT True`, no
`tensorflow`):

```sh
.venv/bin/python -c "import basic_pitch; print(basic_pitch.TF_PRESENT, basic_pitch.ONNX_PRESENT)"
# False True
```

`awh clip from-audio` fails loudly with a install-hint error (not a stack
trace) if `basic_pitch` isn't importable — see `a2m.transcribe`.

#### License audit (2026-08-18)

Every package the two commands above add to the venv, checked against PyPI
metadata / the project's own `LICENSE` file (none GPL/AGPL — the hard
constraint for this repo, see `docs/spec.md`'s reuse-map "Avoid" note):

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

**One copyleft dependency worth flagging**: `soxr` (librosa's default
resampler backend, pulled in transitively) is **LGPL-2.1** — permissive
enough to use as an ordinary imported/linked Python dependency (LGPL's
linking exception is exactly this case, unlike GPL/AGPL), and it satisfies
the repo's actual constraint (no GPL/AGPL), but it's the one license in this
tree that isn't MIT/BSD/Apache/ISC/PSF, so it's called out explicitly rather
than buried in the table above. If this ever becomes a concern, librosa can
be pointed at its alternate `soxr_hq`-free resampler engines, but that's not
needed for the constraint as written.

No TensorFlow, no GPL/AGPL packages entered the venv.

## Everyday

```sh
cd analysis && ../.venv/bin/pytest -q
```

`$AWH_PYTHON` overrides which interpreter the CLI spawns (else
`<repo root>/.venv/bin/python`, else `python3` on PATH).
