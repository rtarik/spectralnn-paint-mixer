# Evaluation Tools

Home for artifact comparison, fixture scoring, and regression reporting.

This directory now owns the standalone evaluation path for the staged repository.

## Physical baseline export

Augment the exported JSONL with the base-engine prediction:

```bash
node tools/eval/export-physical-baselines.mjs --data-dir tools/training/out/data
```

This writes:

- `curated_with_physical.jsonl`
- `synthetic_with_physical.jsonl`

## Learned-vs-physical compare

Score the curated dataset with:

```bash
node tools/eval/compare-mixer.mjs --data-dir tools/training/out/data
```

This writes:

- `tools/eval/out/latest_compare.txt`
- `tools/eval/out/latest_compare.xml`

The XML is a lightweight JUnit-style artifact so it remains easy to archive in CI
or compare between runs.

## Ground-truth dataset

Validate the contributor-facing ground-truth corpus:

```bash
node tools/eval/validate-ground-truth.mjs
```

Score the current bundled artifact against the approved ground-truth set:

```bash
node tools/eval/score-ground-truth.mjs
```

Score a custom artifact JSON:

```bash
node tools/eval/score-ground-truth.mjs --artifact-json artifacts/model/baseline-v1/model.json
```

Compare a candidate artifact against the bundled baseline:

```bash
node tools/eval/compare-artifacts.mjs --candidate-artifact-json artifacts/model/baseline-v1/model.json
```

Compare two explicit artifact JSON files:

```bash
node tools/eval/compare-artifacts.mjs \
  --baseline-artifact-json path/to/baseline.json \
  --candidate-artifact-json path/to/candidate.json
```

This writes:

- `tools/eval/out/latest_artifact_compare.txt`
- `tools/eval/out/latest_artifact_compare.xml`
