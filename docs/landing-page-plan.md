# Landing Page And Demo Plan

This document tracks the first public-facing website for `spectralnn-paint-mixer`.

## Purpose

- present the library clearly to developers
- prove the value of the mixer with an interactive demo
- validate the JavaScript package in a real browser-facing integration
- provide a place for technical explanation without overloading the front page

## Product Goals

- The homepage should immediately communicate that this is a subtractive paint-mixing library.
- The demo should be the center of gravity, not a secondary widget.
- The same recipe should be viewable in both:
  - full pipeline mode
  - base-model-only mode
- The site should later be able to host:
  - repository link
  - package install snippets
  - technical deep-dive content

## Scope For V1

- one homepage
- one technical page
- one browser demo using the JavaScript package
- parts-based recipe mixing
- default palette with editable ingredient rows
- render-mode comparison:
  - corrected
  - base only
- language-specific usage snippets
- lightweight project navigation for the repo and technical notes

## Explicit Non-Goals For V1

- no account system
- no cloud persistence
- no decomposition tooling
- no complex brush engine beyond what is needed for a convincing demo
- no marketing/docs CMS

## Repo Placement

Recommended home:

- `apps/site`

Recommended deploy target:

- GitHub Pages deployed by GitHub Actions
- build output from `apps/site/dist`
- source of truth remains under `apps/site/src`

Reasoning:

- `packages/js` remains the reusable runtime package
- `apps/site` becomes the package consumer that validates browser integration
- this mirrors the Kotlin validation story where the app consumes the published/runtime library
- this keeps site source out of the repo root while still publishing a normal GitHub Pages site
- it avoids committing built site output alongside the library source

## Homepage Layout

### Top-level structure

1. Compact product intro
2. Interactive demo
3. Usage guidance
4. Short "how it works" explainer
5. Footer links

### Intro

Goals:

- explain the library in one sentence
- establish that it is subtractive paint mixing, not RGB interpolation
- mention the high-level idea of a physical base model plus neural residual correction
- move the user directly to the demo or usage guidance

Suggested content:

- headline:
  - "A paint mixer built on a physical base model plus neural residual correction"
- supporting line:
  - "Start from a subtractive physical baseline, then use a neural network only for the remaining residual errors."
- primary CTA:
  - `Usage`
- secondary CTA:
  - `Read The Technical Notes`

### Demo Section

Recommended two-column layout on desktop:

- left rail:
  - compact recipe builder
  - swatch palette
  - custom color addition
- right rail:
  - larger result comparison
  - corrected versus base explanation
  - ratio summary

Recommended stacked layout on mobile:

- intro first
- result comparison second
- recipe controls below

### Comparison Control

Preferred control:

- segmented control with:
  - `Corrected`
  - `Base Only`
  - `Split View`

Why:

- clearer than a binary toggle
- lets the page demonstrate the residual model directly
- gives us a future place to add more diagnostics without redesigning the UI

### "How It Works" Strip

Keep this short and visual:

1. Base engine reconstructs pigment-like reflectance and performs subtractive mixing.
2. Neural residual nudges the result toward the trained target.
3. Shared artifact and fixtures keep Kotlin and JavaScript aligned.

### Palette model

Recommended rules:

- default palette ships with stable ids
- users can add colors to the active palette
- visible swatch UI should stay compact and visual
- labels should emphasize hex values over paint names on the front page

### Rendering modes

`Corrected`

- renders pixel pigment stacks through `PaintMixers.default()`

`Base Only`

- renders pixel pigment stacks through the JS base engine only

`Split View`

- renders both simultaneously
- preferred layout:
  - same stroke state
  - two side-by-side canvases or a draggable before/after slider

Recommendation:

- start with side-by-side panels
- add a slider later if it feels worth it

## GitHub Pages Deployment Notes

Recommended approach:

- keep editable source under `apps/site`
- build into `apps/site/dist`
- deploy `apps/site/dist` through GitHub Actions
- use normal HTML entry points inside the built site:
  - `index.html`
  - `technical/index.html`
- avoid SPA fallback/routing complexity on GitHub Pages
- keep asset paths relative so project-page hosting works cleanly
- keep the repository root focused on library source, docs, and packages

## Technical Page

This should be a separate page, not a giant homepage section.

### Suggested structure

1. Problem
   - why naive RGB mixing fails for paint
2. Solution Overview
   - base spectral engine
   - learned residual correction
3. Artifact Contract
   - shared model metadata
   - parity fixtures
4. Fine-Tuning Story
   - curated ground-truth additions
   - retraining from the existing checkpoint/artifact flow
5. Validation
   - Kotlin integration
   - JavaScript/browser integration

## Visual Direction

The site should feel like a tool, not a generic docs landing page.

Guidance:

- keep the demo visible quickly
- use paint-inspired surfaces and accents rather than bland SaaS styling
- avoid overloading the first screen with paragraphs
- show color and motion intentionally, but keep interactions crisp

## Execution Phases

### Phase 1: Planning And Architecture

- [x] Decide on homepage purpose and demo scope
- [x] Decide to include both corrected and base-only render modes
- [x] Decide to separate the technical page from the homepage
- [x] Choose pigment-state canvas rendering over storing only final RGB output
- [x] Finalize site location in the staged repo
- [x] Decide on GitHub Actions deployment for GitHub Pages

### Phase 2: Browser-Ready JS Consumption

- [x] Replace the current Node-first bundled artifact loading with browser-safe loading
- [x] Choose a site-consumption path that avoids reimplementing the JS runtime
- [x] Verify the JS package works in a browser-targeted consumer app
- [x] Keep Node parity tests green after the packaging change
- [x] Add the initial GitHub Actions Pages workflow

### Phase 3: Site Scaffold

- [x] Create `apps/site`
- [x] Choose the site toolchain
- [x] Wire the site to consume `packages/js`
- [x] Add a basic homepage shell
- [x] Add routing for the technical page

### Phase 4: Demo MVP

- [x] Implement the parts-based Quick Mix Lab
- [x] Implement corrected/base result comparison
- [x] Support loading curated validation recipes into the live demo
- [x] Keep the demo wired to the built JS package instead of a parallel implementation

### Phase 5: Content

- [x] Write homepage explainer copy
- [x] Write technical page content
- [x] Add language-specific usage/import examples
- [x] Rework the homepage to be demo-first

### Phase 6: Validation

- [x] Run the site locally against the staged JS package
- [ ] Confirm desktop and mobile usability
- [ ] Spot-check browser demo outputs against known fixture colors

Current support:

- `apps/site/scripts/preview-site.mjs` serves the built site locally for manual browser checking
- `apps/site/scripts/smoke-site.mjs` performs an HTTP smoke pass against the built output
- the homepage now centers the Quick Mix Lab, language usage tabs, and curated validation recipe cards sourced from the shared fixture corpus

## Recommended Next Slice

The next concrete step should be:

1. move the staged library into its own standalone repository
2. replace the front-page repo placeholder with the public repository link
3. validate the landing page against the published JavaScript alpha package
4. tighten the demo ergonomics based on that published-package pass

That order keeps the site aligned with the larger delivery plan: standalone repo first, alpha publish second, deeper accuracy work after that.
