# `awh_analysis` — Python DSP engine

Bridge-independent measurement/transcription engine invoked as
`python -m awh_analysis <cmd> --json` from the Node CLI (`packages/cli`,
via `analysisPython()`/`runAnalysis*`). Nothing in the Node workspace does
DSP — see `docs/design/analysis-engine.md` and `docs/design/audio-to-midi.md`.

## Setup

One-time, from the repo root:

```sh
python3 -m venv .venv
.venv/bin/pip install numpy scipy soundfile pyloudnorm librosa pytest
cd analysis && ../.venv/bin/pytest -q && cd ..   # engine self-test
```

`librosa` (ISC, license audit below) is a base dependency as of M11 —
`awh samples index`'s `samplescan` uses it for spectral centroid/rolloff/
flatness + MFCCs, not just the `a2m` extra below.

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
.venv/bin/pip install "setuptools<81"
```

**The `setuptools<81` line matters, don't skip it**: `resampy` (a real
runtime dependency above, not something we chose) imports the deprecated
`pkg_resources` API at import time. Newer `pip`/Python don't bundle
`pkg_resources` in a fresh venv, and setuptools itself dropped the module
starting with its 81.x releases (confirmed live: 84.0.0 has no
`pkg_resources` at all) — so a fresh venv fails with
`ModuleNotFoundError: No module named 'pkg_resources'` the first time
anything imports `basic_pitch.inference`, even though every package above
installed successfully. This is an upstream `resampy`/librosa issue (not
ours to fix), triggers a harmless deprecation warning once pinned, and
will need revisiting if/when `pkg_resources` is actually removed upstream
(flagged for 2025-11-30 as of this writing).

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

### M11b (`clap` — semantic sample search, CLAP embeddings)

`awh samples embed`/`search --semantic`/`similar --semantic` need
[LAION-CLAP](https://github.com/LAION-AI/CLAP) (`laion_clap`), which joint-
embeds audio and text so a text query ("dusty breakbeat") can rank actual
audio content instead of filename tokens. Unlike Basic Pitch, `laion_clap`
has no unconditional TensorFlow-style dependency problem — it uses the
`torch` already in this venv (M6's `report`/`ab` etc. don't need torch, but
nothing here excludes it, and it's already installed) — so no `--no-deps`
workaround is required, just the extras group.

**NOT INSTALLED in this dev container** — its checkpoint has to come from
Hugging Face, which is egress-blocked here, so there is nothing useful to
run the real model against inside this checkout anyway (same reasoning as
why the container doesn't bother installing Basic Pitch's actual weights
issue would apply if HF were also blocked for it). `AWH_CLAP_STUB=1`
(handled inside `clapembed.py` itself — deterministic hash-derived
vectors, `model: "stub-v1"`) covers every Node/Python test in this repo
without `laion_clap`/`torch`'s CLAP path ever loading. Install for real use
on the owner's own machine:

```sh
cd analysis && ../.venv/bin/pip install -e '.[clap]'   # or: pip install laion_clap
```

**Checkpoint** — download the music-tuned checkpoint (the CLI's default,
`--model music`) into `~/.awh/models/` (create the folder first):

```sh
mkdir -p ~/.awh/models
curl -L https://huggingface.co/lukewys/laion_clap/resolve/main/music_audioset_epoch_15_esc_90.14.pt \
    -o ~/.awh/models/music_audioset_epoch_15_esc_90.14.pt
# --model general instead:
curl -L https://huggingface.co/lukewys/laion_clap/resolve/main/630k-audioset-best.pt \
    -o ~/.awh/models/630k-audioset-best.pt
```

`awh samples embed`/`search --semantic`/`similar --semantic` fail loudly
with this exact install-hint error (never a bare stack trace, never a
silent auto-download) if the checkpoint file isn't present — see
`clapembed._not_installed_message`.

**License stance**: LAION-CLAP code + checkpoints only. **No CC-BY-NC
weights anywhere in this path** — both checkpoints above are the project's
own open (non-commercial-restricted) releases, same stance as
`docs/design/sample-semantic.md`.

**License audit (2026-08-24, `pip install laion_clap --dry-run` against
this venv — network was reachable from this container for this one PyPI
metadata check; the package itself was NOT actually installed, per the
"don't install it here" rule above)**. `torch` itself is already present
(2.13.0+cu130) and not re-installed by this extra:

| Package | License | Package | License |
|---|---|---|---|
| laion_clap | Apache-2.0 (PyPI classifier; the package's own `license` metadata field oddly embeds CC0 legal text instead — a packaging artifact, not a re-license: treated as Apache-2.0 per the classifier and upstream's stated stance) | pydantic / pydantic_core | MIT |
| annotated-types | MIT | python-dateutil | Apache-2.0 / BSD (dual) |
| braceexpand | MIT | sentry-sdk | MIT |
| ftfy | Apache-2.0 | torchlibrosa | MIT |
| h5py | BSD-3-Clause | typing-inspection | MIT |
| opentelemetry-api | Apache-2.0 | wandb | MIT |
| pandas | BSD-3-Clause | wcwidth | MIT |
| progressbar (2.5) | BSD / LGPL-3.0 (dual) — permissive-enough as an ordinary imported dependency, same reasoning as `soxr` above; not GPL/AGPL | webdataset | BSD-3-Clause |
| | | wget | Public domain |

No TensorFlow, no GPL/AGPL packages in this dependency tree. One caveat
worth flagging before an owner installs for real: the dry-run resolved
`numpy==1.26.4` for `laion_clap`'s own pin, which is OLDER than this venv's
current `numpy` (2.4.6) — worth watching for a downgrade/conflict warning
on real install; not something this container could verify further without
actually installing.

## Everyday

```sh
cd analysis && ../.venv/bin/pytest -q
```

`$AWH_PYTHON` overrides which interpreter the CLI spawns (else
`<repo root>/.venv/bin/python`, else `python3` on PATH).
