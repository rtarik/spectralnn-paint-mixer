# Training Tools

This directory now carries the staged residual-training loop for `spectralnn-paint-mixer`.

Public runtime consumers should not depend on this directory. It is for dataset export,
training, artifact refresh, and regression support.

## Current shape

- dataset export now lives in `tools/dataset-generator`
- residual training and pipeline orchestration live here
- approved ground-truth merge now lives here
- canonical artifact refresh lives in `export_artifact.py`
- physical-baseline export and runtime compare now live in `tools/eval`

## Install

From the repo root:

```bash
python3 -m pip install -r tools/training/requirements.txt
npm --prefix tools/dataset-generator install
npm --prefix apps/site install
```

`torch` is used for training and will fall back to CPU automatically when no GPU/MPS device is available.

## Recommended Local Loop

The intended workflow is:

1. run the training pipeline from the repo root
2. preview the landing page and try mixes against the freshly exported workspace model
3. open the QA dataset gallery from the landing page to inspect the full curated corpus

### Fast iteration

This keeps the supplemental datasets we trust right now and excludes `Sensors 2021` until we revisit its calibration:

```bash
python3 tools/training/run_training_pipeline.py \
  --device auto \
  --skip-compare \
  --ground-truth-dataset artifacts/ground-truth/v1 \
  --ground-truth-dataset artifacts/ground-truth/hyperdoc-2025-binary-v1 \
  --ground-truth-dataset artifacts/ground-truth/cutajar-2024-binary-v1 \
  --ground-truth-dataset artifacts/ground-truth/bath-2016-binary-v1 \
  --ground-truth-dataset artifacts/ground-truth/color-mixing-screenshots-v1 \
  --ground-truth-review-status approved \
  --ground-truth-review-status reviewed \
  --ground-truth-review-status draft
```

### Full run with comparison report

```bash
python3 tools/training/run_training_pipeline.py \
  --device auto \
  --ground-truth-dataset artifacts/ground-truth/v1 \
  --ground-truth-dataset artifacts/ground-truth/hyperdoc-2025-binary-v1 \
  --ground-truth-dataset artifacts/ground-truth/cutajar-2024-binary-v1 \
  --ground-truth-dataset artifacts/ground-truth/bath-2016-binary-v1 \
  --ground-truth-dataset artifacts/ground-truth/color-mixing-screenshots-v1 \
  --ground-truth-review-status approved \
  --ground-truth-review-status reviewed \
  --ground-truth-review-status draft
```

### Inspect the result in the landing page

```bash
npm --prefix apps/site run preview
```

The preview build now also bundles the QA dataset gallery at:

```text
/qa/dataset-gallery/index.html
```

If you want the gallery as a standalone file outside the site preview:

```bash
node tools/dataset-generator/build-ground-truth-gallery.mjs
```

That writes:

```text
artifacts/ground-truth/gallery/index.html
```

## Pipeline Stages

The training command runs:

1. `tools/dataset-generator/export-training-data.js`
2. `tools/training/merge-ground-truth-into-data.mjs`
3. `tools/eval/export-physical-baselines.mjs`
4. `tools/training/train_mixer_model.py`
5. `tools/training/export_artifact.py`
6. `tools/eval/compare-mixer.mjs` unless `--skip-compare` is passed

## Outputs

Main training outputs:

- `tools/training/out/data/`
- `tools/training/out/data/ground_truth_import.jsonl`
- `tools/training/out/data/ground_truth_merge_manifest.json`
- `tools/training/out/latest_checkpoint.npz`
- `tools/training/out/latest_report.txt`
- `tools/training/out/latest_history.csv`
- `tools/eval/out/latest_compare.txt`
- `tools/eval/out/latest_compare.xml`

Refreshed runtime artifacts:

- `artifacts/model/baseline-v1/model.json`
- `packages/kotlin/src/commonMain/kotlin/io/github/rtarik/paintmixer/DefaultModelArtifactJson.kt`
- `packages/js/src/generated/default-model-artifact.json`
- `packages/js/src/generated/default-model-artifact-data.js`

Temporary legacy warm-start snapshot:

- `tools/training/out/legacy/LearnedMixerModelWeights.kt`

## Notes

- The training loop now prefers its local checkpoint in `tools/training/out/`, but it can
  still warm-start from the earlier app-era checkpoint or generated weights while the
  extraction is in progress.
- Approved ground-truth samples are merged into the derived `curated.jsonl` after export,
  replacing matching `palette/label` rows and appending new ones when needed.
- The recommended supplemental mix currently omits `artifacts/ground-truth/sensors-2021-binary-v1`
  because the visible colors do not line up well with the source labels.
- The staged evaluation scripts now use the extracted JavaScript runtime as the standalone
  teacher path and comparison path.
- The remaining extraction work is around contributor-facing ground-truth ingestion and
  evaluation polish, not app-coupled evaluation.
