# Ground-Truth V1

First stable append-only ground-truth dataset for SpectralNN Paint Mixer.

This dataset now has two bootstrap layers:

- an initial approved seed bootstrapped from the reviewed baseline parity corpus already used in repo validation
- a broader curated export bootstrap that adds adjacent ratio guardrails plus reviewed tint, shade, and chromatic anchors
- every sample carries source metadata so future measured additions can coexist cleanly
- the format is designed for contributor growth, not just frozen fixture testing

Files:

- `manifest.json`
- `samples.jsonl`

Validation:

```bash
node tools/eval/validate-ground-truth.mjs
```

Scoring:

```bash
node tools/eval/score-ground-truth.mjs
```

Training merge:

```bash
node tools/training/merge-ground-truth-into-data.mjs --data-dir tools/training/out/data
```

Custom artifact scoring:

```bash
node tools/eval/score-ground-truth.mjs --artifact-json artifacts/model/baseline-v1/model.json
```

Candidate-versus-baseline comparison:

```bash
node tools/eval/compare-artifacts.mjs --candidate-artifact-json artifacts/model/baseline-v1/model.json
```

Notes:

- `sourceType=curated_manual_target` means the target was curated by the project rather than measured directly from a spectrophotometer session.
- `reviewStatus=approved` is the default scoring/merge set used by current tooling.
- `reviewStatus=reviewed` is for broader anchor coverage that we want in the corpus now without automatically merging it into training.
- future measured additions should reuse the same structure with a different `sourceType`, not create a second schema.
