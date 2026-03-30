# Baseline V1 Fixtures

Compact curated fixtures for validating the frozen `baseline-v1` model artifact.

This set is intentionally small but representative. It includes:

- broad "healthy" cases that should stay close to target
- historically tricky balanced-opponent cases
- a couple of known hard outliers so future ports can reproduce the frozen baseline before improving it

The fixture file is shared data, not Kotlin-specific test code:

- `curated-parity.json`

Initial source:

- `external/latest_report.txt`
- `external/curated.jsonl`
