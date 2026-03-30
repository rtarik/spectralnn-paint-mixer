# Site Source

This directory holds the editable source for the landing page and demo.

Testing focus:

- the parts-based demo is the main validation surface for the JavaScript package
- the landing page should consume the built package output, not a parallel implementation
- technical notes stay separate from the main product-facing page

Deployment plan:

- author source here
- build static files into `dist/`
- deploy `dist/` to GitHub Pages with GitHub Actions
- keep the site multipage rather than SPA-based

Current built entry points:

- `dist/index.html`
- `dist/technical/index.html`

Current source entry points:

- `src/index.html`
- `src/technical/index.html`

Build command:

```bash
node scripts/build-site.mjs
```

By default, this build pulls from the local workspace package output in `packages/js/dist`, not directly from `packages/js/src`.

To point the site at an installed npm package or alias instead:

```bash
npm run preview -- --runtime=@rtarik/spectralnn-paint-mixer
```

To make the active source explicit in the UI while you compare builds:

```bash
npm run preview -- --runtime=@rtarik/spectralnn-paint-mixer --runtime-label=npm-alpha
```

Install the published alpha into `apps/site` before using the package-backed path:

```bash
cd apps/site
npm install @rtarik/spectralnn-paint-mixer@alpha
```

For side-by-side version checks later, install aliased versions and point the site at the alias:

```bash
cd apps/site
npm install spectralnn-paint-mixer-alpha-1@npm:@rtarik/spectralnn-paint-mixer@0.1.0-alpha.1
npm run preview -- --runtime=spectralnn-paint-mixer-alpha-1 --runtime-label=alpha-1
```

Preview locally:

```bash
node scripts/preview-site.mjs
```

HTTP smoke validation:

```bash
node scripts/smoke-site.mjs
```

Current JS validation gate:

```bash
cd packages/js && npm test
cd ../..
node apps/site/scripts/smoke-site.mjs
```

The validation strategy is:

- the landing page validates against the built JS package output
- shared fixtures keep JavaScript aligned with the canonical artifact
- Kotlin validation can happen later through its own consumer integration path
