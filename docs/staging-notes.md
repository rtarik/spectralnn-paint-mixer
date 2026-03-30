# Staging Notes

This scaffold is the first concrete cut of the future standalone repository.

## Intent

- keep the repository focused on the paint-mixing engine
- keep public runtime APIs small and UI-agnostic
- use a canonical JSON model artifact across Kotlin and JavaScript
- defer decomposition entirely
- publish the standalone repository under the MIT license

## Next implementation tasks

1. Move `spectralnn-paint-mixer/` into its own standalone repository.
2. Finish JavaScript alpha release preparation, including docs, metadata, and public package/repo links.
3. Iterate on accuracy inside the standalone repo through base-model experiments and residual-data curation.
4. Publish Kotlin later, after the JavaScript alpha has settled.

## Current status

- `artifacts/model/baseline-v1/model.json` is now the canonical staged artifact.
- `artifacts/fixtures/baseline-v1/curated-parity.json` is now the canonical staged baseline fixture set.
- `packages/kotlin` now loads derived bundled JSON instead of copied weight arrays.
- Artifact generation is handled by `tools/training/export_artifact.py`.
- JVM parity tests now read the shared fixture file through Gradle rather than hardcoding expected outputs in Kotlin.
- `pcm` now compiles against the staged Kotlin module through app-owned adapters and the compatibility `SubtractiveMixer` wrapper.
- local Maven publish wiring now targets `spectralnn-paint-mixer/out/m2-local`, and `pcm` can opt into consuming that published coordinate with `-PpaintMixer.usePublished=true`.
- local published-coordinate validation has been proven with `:composeApp:testDebugUnitTest --tests io.github.rtarik.pcm.mixing.SubtractiveMixerTest`.
- the runtime is now explicitly split into `BaseMixEngine`, `ResidualCorrectionModel`, and `PipelinePaintMixer`, with the default artifact tagged for `spectral_ks_v1`.
- `packages/js` now has the JavaScript runtime scaffold, the ported `spectral_ks_v1` base engine, the learned residual correction stage, and a working `PaintMixers.default()` pipeline.
- JavaScript parity coverage now includes artifact-shape checks, pipeline behavior checks, shared residual-stage fixtures in `artifacts/fixtures/baseline-v1/residual-parity.json`, and end-to-end curated fixture parity against `artifacts/fixtures/baseline-v1/curated-parity.json`.
- `packages/js` now loads the bundled default artifact through a browser-safe generated JS module rather than Node file APIs.
- `packages/js/scripts/build-package.mjs` now produces the package-facing `dist/` output, and `apps/site` now consumes that built output instead of vendoring raw source files.
- `apps/site` now consumes the real JS runtime through a build step that vendors the built `packages/js/dist` package output into `dist/`, and the first interactive pigment-state demo is wired for corrected/base/split rendering.
- GitHub Pages deployment is now staged through `.github/workflows/deploy-site.yml`, with `apps/site/dist` as the published artifact.
- the homepage copy and technical page now explain the two-stage pipeline, artifact contract, validation path, and future fine-tuning workflow rather than serving as placeholders.
- `apps/site/scripts/preview-site.mjs` plus `apps/site/scripts/smoke-site.mjs` support local preview and HTTP smoke validation for the landing page.
- the homepage is now demo-first around the parts-based Quick Mix Lab, with the older paint playground removed, a simpler consumer-facing pitch, and language-specific usage tabs for JavaScript and Kotlin.
- the first cut of dataset export and residual-training orchestration now lives in `tools/dataset-generator` and `tools/training`, including staged-output paths and artifact refresh for both Kotlin and JavaScript runtimes.
- `tools/eval` now owns standalone physical-baseline export and learned-versus-physical compare, including a JUnit-style XML output for CI/archive use.
- the staged training pipeline is now standalone end to end aside from dependency installation in `tools/dataset-generator`.
- `artifacts/ground-truth/v1` now defines the first append-only contributor-facing target corpus, and `tools/eval/validate-ground-truth.mjs` plus `tools/eval/score-ground-truth.mjs` validate and score it against either the bundled artifact or a custom artifact JSON.
- `artifacts/ground-truth/v1` now contains 50 internal bootstrap samples total: 42 approved samples used by default scoring/merge and 8 reviewed anchor samples kept out of automatic training merge.
- `tools/training/merge-ground-truth-into-data.mjs` now feeds approved ground-truth samples into derived curated training data automatically, recording replacement/append counts in `ground_truth_merge_manifest.json`.
- `tools/eval/compare-artifacts.mjs` now compares a candidate artifact against either the bundled baseline or another explicit artifact JSON, reporting broad deltas plus the biggest sample-level improvements and regressions.
