# SpectralNN Paint Mixer For JavaScript

JavaScript runtime package for paint-aware color mixing built on a subtractive physical base model plus learned residual correction.

Package name:

- `@rtarik/spectralnn-paint-mixer`

Repository:

- `https://github.com/rtarik/spectralnn-paint-mixer`

## Current Scope

- shared `SrgbColor` and `MixPortion` runtime types
- pipeline composition via `PipelinePaintMixer`
- the JavaScript port of the custom `spectral_ks_v1` base engine
- canonical model artifact loading
- learned residual correction inference against the bundled baseline artifact
- `PaintMixers.default()` for the full bundled baseline pipeline

The same package output is used by the landing page under `apps/site`, so browser-facing validation happens against the real package build rather than parallel demo-only logic.

## Install

After the alpha is published:

```bash
npm install @rtarik/spectralnn-paint-mixer@alpha
```

## Example

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

## Build

Build the package output consumed by the site and later npm publish flow:

```bash
npm run build
```

## Validation

Run the package tests:

```bash
npm test
```

From the repository root, validate the package through the landing page too:

```bash
node apps/site/scripts/smoke-site.mjs
```

## Notes

- `src/generated/default-model-artifact.json` is a bundled copy of the canonical artifact in `artifacts/model/baseline-v1/model.json`.
- `src/generated/default-model-artifact-data.js` is the browser-safe wrapper used by the runtime package.
- `dist/` is the publish-facing output used by both the landing-page build and the npm tarball.
- end-to-end parity runs against `artifacts/fixtures/baseline-v1/curated-parity.json`.
- residual-stage parity fixtures live in `artifacts/fixtures/baseline-v1/residual-parity.json`.
