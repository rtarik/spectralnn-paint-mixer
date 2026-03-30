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

Python dependency:

```bash
python3 -m pip install -r tools/training/requirements.txt
```

Dataset exporter dependency:

```bash
cd tools/dataset-generator
npm install
```

## Recommended command

From the staged repo root:

```bash
python3 tools/training/run_training_pipeline.py
```

That command runs:

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
- The staged evaluation scripts now use the extracted JavaScript runtime as the standalone
  teacher path and comparison path.
- The remaining extraction work is around contributor-facing ground-truth ingestion and
  evaluation polish, not app-coupled evaluation.
