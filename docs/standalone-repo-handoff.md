# Standalone Repo Handoff Checklist

This checklist is for the moment when `spectralnn-paint-mixer/` is copied out of the `pcm` workspace and turned into its own repository.

## Immediate Goal

- keep the extracted library self-contained
- publish the JavaScript package as the first alpha release
- use the landing page as the main JS validation surface
- keep Kotlin staged but unpublished until the JavaScript alpha has been refined

## Copy-Out Checklist

1. Copy `spectralnn-paint-mixer/` to its new standalone location.
2. Initialize git in the new location.
3. Create the remote repository and connect it.
4. Confirm the repo root still contains:
   - `LICENSE`
   - `README.md`
   - `packages/js`
   - `packages/kotlin`
   - `apps/site`
   - `artifacts`
   - `tools`
   - `docs`
5. Remove any workspace-local leftovers that should not be committed:
   - `.DS_Store`
   - local build outputs
   - local publish outputs
   - local-only config files if not meant for the standalone repo

## JavaScript Alpha Checklist

1. Finalize package metadata in `packages/js/package.json`.
2. Replace repo placeholders in the landing page with the real repository URL.
3. Point GitHub Pages to the standalone repo.
4. Verify:
   - `npm test` in `packages/js`
   - landing page build
   - landing page smoke test
   - local browser pass against the published-like JS package output
5. Publish the JavaScript alpha package.

## Kotlin Hold Position

Keep Kotlin ready but unpublished until the JavaScript alpha settles.

When ready later:

1. finalize Kotlin publish metadata
2. publish the Kotlin package
3. validate it in the app
4. return focus to the app repository

## After JavaScript Alpha

The standalone repository becomes the place to improve accuracy:

- test alternative base models behind `BaseMixEngine`
- curate better residual-training data
- compare candidate artifacts before promoting a new baseline
