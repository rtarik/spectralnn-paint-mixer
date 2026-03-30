# SpectralNN Paint Mixer

Paint-aware color mixing built on a subtractive physical base model plus a learned residual correction stage.

This repository contains:

- a JavaScript runtime package under `packages/js`
- a staged Kotlin runtime under `packages/kotlin`
- a GitHub Pages landing page and demo under `apps/site`
- the shared model artifact, fixtures, and training/evaluation tooling used to keep the runtimes aligned

## Current Status

- JavaScript is the current release focus and first public alpha target.
- The landing page demos the real JavaScript runtime rather than a parallel implementation.
- Kotlin remains in the repo, but public publishing is deferred for now.

## Local Validation

Validate the JavaScript package and the landing page from the repository root:

```bash
cd packages/js && npm test
cd ../..
node apps/site/scripts/smoke-site.mjs
```

Preview the landing page locally:

```bash
node apps/site/scripts/preview-site.mjs
```

The site can also be pointed at an installed npm package or alias when you want to compare a published alpha against the local workspace build. See `apps/site/README.md` for that workflow.

## JavaScript Package

Package name:

- `@rtarik/spectralnn-paint-mixer`

Example:

```js
import {
  MixPortion,
  PaintMixers,
  SrgbColor,
} from '@rtarik/spectralnn-paint-mixer';

const mixer = PaintMixers.default();
const result = mixer.mixOrNull([
  new MixPortion({ color: SrgbColor.fromHex('#E53935'), parts: 1 }),
  new MixPortion({ color: SrgbColor.fromHex('#283593'), parts: 1 }),
]);

console.log(result?.toHexString());
```

## Repository Layout

- `apps/site`
- `packages/js`
- `packages/kotlin`
- `artifacts/model`
- `artifacts/fixtures`
- `artifacts/ground-truth`
- `tools/training`
- `tools/eval`
- `tools/dataset-generator`
- `docs`

## Training And Artifacts

The canonical model artifact lives at `artifacts/model/baseline-v1/model.json`.

Training dependencies:

```bash
python3 -m pip install -r tools/training/requirements.txt
cd tools/dataset-generator && npm install
```

Run the staged pipeline from the repository root:

```bash
python3 tools/training/run_training_pipeline.py
```

## Notes

- The landing-page and demo source of truth lives under `apps/site/src`.
- GitHub Pages deployment is handled through `.github/workflows/deploy-site.yml`.
- Package and site-release notes can evolve separately, but the landing page should continue validating the published JavaScript runtime shape.
