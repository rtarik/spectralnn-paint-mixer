# Dataset Generator

This directory exports the synthetic and curated training JSONL files used by the staged
residual-training loop.

## Install

```bash
npm install
```

## Run

From the staged repo root:

```bash
node tools/dataset-generator/export-training-data.js
```

Useful flags:

```bash
node tools/dataset-generator/export-training-data.js \
  --synthetic-count 50000 \
  --seed 42 \
  --output-dir tools/training/out/data
```

The exact-pair guardrail configuration lives in:

```text
tools/training/manual_opponent_pairs.json
```

Outputs land in:

```text
tools/training/out/data/
```
