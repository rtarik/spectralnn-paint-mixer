#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const DATASET_TITLE_OVERRIDES = new Map([
  ['ground-truth-v1', 'legacy curated core'],
]);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function humanizeDatasetName(datasetId) {
  if (DATASET_TITLE_OVERRIDES.has(datasetId)) {
    return DATASET_TITLE_OVERRIDES.get(datasetId);
  }
  return datasetId
    .replace(/^ground-truth-/u, '')
    .replace(/-v\d+$/u, '')
    .replaceAll('-', ' ');
}

function derivePaintsFromSamples(samples) {
  const paintsByKey = new Map();
  for (const sample of samples) {
    for (const input of sample.inputs ?? []) {
      const key = input.paintId ?? `${input.paintLabel ?? 'paint'}|${input.colorHex ?? '#000000'}`;
      if (!paintsByKey.has(key)) {
        paintsByKey.set(key, {
          paintId: input.paintId ?? key,
          paintLabel: input.paintLabel ?? input.paintId ?? 'paint',
          colorHex: (input.colorHex ?? '#000000').toUpperCase(),
        });
      }
    }
  }

  return [...paintsByKey.values()].sort((left, right) => {
    const labelCmp = left.paintLabel.localeCompare(right.paintLabel);
    return labelCmp !== 0 ? labelCmp : left.colorHex.localeCompare(right.colorHex);
  });
}

export function loadGroundTruthDatasets(groundTruthRoot) {
  const datasets = [];
  for (const entry of readdirSync(groundTruthRoot)) {
    const datasetDir = path.join(groundTruthRoot, entry);
    if (!statSync(datasetDir).isDirectory() || entry === 'gallery') {
      continue;
    }

    const manifestPath = path.join(datasetDir, 'manifest.json');
    const samplesPath = path.join(datasetDir, 'samples.jsonl');

    try {
      const manifest = readJson(manifestPath);
      const samples = readJsonl(samplesPath);

      const paintsPath = path.join(datasetDir, 'paints.json');
      const paints = existsSync(paintsPath) ? readJson(paintsPath) : derivePaintsFromSamples(samples);

      datasets.push({
        datasetId: manifest.datasetId,
        dirName: entry,
        title: humanizeDatasetName(manifest.datasetId),
        description: manifest.description,
        sampleCount: samples.length,
        paintCount: paints.length,
        ratioNote: manifest.derivation?.ratioTreatment?.note ?? null,
        paints,
        samples,
      });
    } catch {
      // Ignore directories that are not usable datasets.
    }
  }

  return datasets.sort((left, right) => left.datasetId.localeCompare(right.datasetId));
}

function sourceBadge(sample) {
  if (sample.sourceRatioKnown === false || sample.label.includes('@unstated')) {
    return { label: 'ratio caveat', warning: true };
  }

  switch (sample.sourceType) {
    case 'video_observed_mix':
      return { label: 'observed', warning: false };
    case 'curated_manual_target':
      return { label: 'curated', warning: false };
    case 'imported_reference_target':
      return { label: 'imported', warning: false };
    default:
      return { label: 'measured', warning: false };
  }
}

function sampleReference(sample) {
  return sample.sourceSampleCode ?? sample.sourceSampleId ?? sample.id ?? 'unlabeled-source';
}

function sampleTargetLabel(sample) {
  switch (sample.sourceType) {
    case 'video_observed_mix':
      return 'Observed target';
    case 'curated_manual_target':
      return 'Curated target';
    case 'imported_reference_target':
      return 'Imported target';
    default:
      return 'Measured target';
  }
}

function buildPage(data) {
  const datasetJson = JSON.stringify(data);
  const totalSamples = data.datasets.reduce((sum, dataset) => sum + dataset.sampleCount, 0);
  const totalPaints = data.datasets.reduce((sum, dataset) => sum + dataset.paintCount, 0);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Measured Mix Gallery</title>
    <style>
      :root {
        --bg: #f2ede3;
        --bg-accent: #e2d4b6;
        --panel: rgba(255, 252, 244, 0.94);
        --ink: #2a241b;
        --muted: #6c6253;
        --line: rgba(70, 57, 38, 0.14);
        --chip: #ede2ca;
        --chip-active: #2a241b;
        --chip-active-ink: #fff7eb;
        --warning: #c25a29;
        --shadow: 0 18px 40px rgba(68, 52, 28, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(226, 212, 182, 0.85), transparent 30%),
          radial-gradient(circle at bottom right, rgba(167, 177, 149, 0.22), transparent 35%),
          var(--bg);
        font-family: "Avenir Next", "Trebuchet MS", sans-serif;
      }

      main {
        width: min(1280px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 28px 0 56px;
      }

      .hero {
        padding: 28px;
        border: 1px solid var(--line);
        border-radius: 28px;
        background: var(--panel);
        box-shadow: var(--shadow);
      }

      .hero h1 {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
        font-size: clamp(2rem, 3vw, 3.2rem);
        line-height: 1.05;
        letter-spacing: -0.03em;
      }

      .hero p {
        margin: 12px 0 0;
        max-width: 72ch;
        color: var(--muted);
        line-height: 1.5;
      }

      .metrics {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 12px;
        margin-top: 18px;
      }

      .metric {
        padding: 14px 16px;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: rgba(255, 250, 238, 0.8);
      }

      .metric strong {
        display: block;
        font-size: 1.5rem;
        line-height: 1.1;
      }

      .metric span {
        display: block;
        margin-top: 4px;
        color: var(--muted);
        font-size: 0.92rem;
      }

      .controls {
        display: grid;
        gap: 16px;
        margin-top: 20px;
        padding: 20px;
        border: 1px solid var(--line);
        border-radius: 24px;
        background: rgba(255, 251, 243, 0.88);
      }

      .control-group label {
        display: block;
        margin-bottom: 8px;
        font-size: 0.84rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .chip {
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--chip);
        color: var(--ink);
        padding: 10px 14px;
        font: inherit;
        cursor: pointer;
      }

      .chip.active {
        background: var(--chip-active);
        color: var(--chip-active-ink);
      }

      .control-row {
        display: grid;
        grid-template-columns: minmax(200px, 2fr) minmax(180px, 1fr);
        gap: 12px;
      }

      .control-row input,
      .control-row select {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: #fffdf7;
        color: var(--ink);
        padding: 12px 14px;
        font: inherit;
      }

      .section {
        margin-top: 26px;
        padding: 22px;
        border: 1px solid var(--line);
        border-radius: 24px;
        background: var(--panel);
        box-shadow: var(--shadow);
      }

      .section h2 {
        margin: 0 0 4px;
        font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
        font-size: 1.45rem;
      }

      .section p {
        margin: 0;
        color: var(--muted);
      }

      .legend-groups {
        display: grid;
        gap: 18px;
        margin-top: 18px;
      }

      .legend-group {
        padding-top: 4px;
        border-top: 1px solid var(--line);
      }

      .legend-group:first-child {
        border-top: 0;
        padding-top: 0;
      }

      .legend-group h3 {
        margin: 0 0 10px;
        font-size: 1rem;
      }

      .swatch-strip {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .paint-chip {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: rgba(255, 252, 246, 0.92);
      }

      .dot {
        width: 18px;
        height: 18px;
        border-radius: 999px;
        border: 1px solid rgba(0, 0, 0, 0.18);
        flex: 0 0 auto;
      }

      .paint-chip small {
        display: block;
        color: var(--muted);
      }

      .sample-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 18px;
        margin-top: 18px;
      }

      .sample-card {
        display: grid;
        gap: 14px;
        padding: 18px;
        border: 1px solid var(--line);
        border-radius: 22px;
        background: rgba(255, 252, 245, 0.95);
      }

      .sample-head {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 12px;
      }

      .sample-head h3 {
        margin: 0;
        font-size: 1.02rem;
        line-height: 1.35;
      }

      .sample-meta {
        margin-top: 6px;
        color: var(--muted);
        font-size: 0.9rem;
      }

      .badge {
        flex: 0 0 auto;
        padding: 7px 10px;
        border-radius: 999px;
        background: #e7dfcf;
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .badge.warning {
        background: rgba(194, 90, 41, 0.14);
        color: var(--warning);
      }

      .mix-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto minmax(180px, 280px);
        gap: 10px;
        align-items: center;
      }

      .mix-inputs {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }

      .mix-sep {
        color: var(--muted);
        font-size: 1.4rem;
        text-align: center;
      }

      .swatch-card {
        padding: 10px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.58);
      }

      .swatch {
        height: 82px;
        border-radius: 14px;
        border: 1px solid rgba(0, 0, 0, 0.18);
      }

      .swatch-card strong,
      .swatch-card span,
      .swatch-card small {
        display: block;
      }

      .swatch-card strong {
        margin-top: 10px;
        font-size: 0.93rem;
      }

      .swatch-card span {
        margin-top: 3px;
        font-size: 0.82rem;
        color: var(--muted);
      }

      .swatch-card small {
        margin-top: 3px;
        font-family: ui-monospace, "SFMono-Regular", monospace;
        color: var(--muted);
      }

      .sample-notes {
        color: var(--muted);
        font-size: 0.9rem;
        line-height: 1.45;
      }

      .empty {
        margin-top: 18px;
        padding: 20px;
        border: 1px dashed var(--line);
        border-radius: 20px;
        color: var(--muted);
      }

      @media (max-width: 760px) {
        main {
          width: min(100vw - 20px, 100%);
          padding-top: 16px;
        }

        .hero,
        .controls,
        .section {
          border-radius: 22px;
        }

        .control-row {
          grid-template-columns: 1fr;
        }

        .mix-row {
          grid-template-columns: 1fr;
        }

        .mix-sep {
          font-size: 1.1rem;
          transform: rotate(90deg);
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <h1>Paint Mix Gallery</h1>
        <p>Quick visual browser for the full curated paint-mix corpus we have assembled so far. This includes the legacy core set, measured sources, and screenshot-observed additions so we can QA the inputs and targets in one place.</p>
        <div class="metrics">
          <div class="metric"><strong>${data.datasets.length}</strong><span>datasets</span></div>
          <div class="metric"><strong>${totalPaints}</strong><span>paint swatches</span></div>
          <div class="metric"><strong>${totalSamples}</strong><span>curated mix rows</span></div>
        </div>
      </section>

      <section class="controls">
        <div class="control-group">
          <label>Datasets</label>
          <div class="chips" id="dataset-chips"></div>
        </div>
        <div class="control-row">
          <div class="control-group">
            <label for="search">Search</label>
            <input id="search" type="search" placeholder="Search labels, paint names, or source ids">
          </div>
          <div class="control-group">
            <label for="sort">Sort</label>
            <select id="sort">
              <option value="dataset">Dataset</option>
              <option value="target">Target color hue</option>
              <option value="label">Label</option>
            </select>
          </div>
        </div>
      </section>

      <section class="section">
        <h2>Paint Inputs</h2>
        <p>These are the paint input swatches currently feeding the visible curated datasets.</p>
        <div class="legend-groups" id="legend-groups"></div>
      </section>

      <section class="section">
        <h2>Combinations</h2>
        <p>The cards below show the input paint colors and the current target colors from the curated corpus, whether they came from manual curation, measured physical sources, or screenshot observations.</p>
        <div class="sample-grid" id="sample-grid"></div>
        <div class="empty" id="empty-state" hidden>No samples match the current filter.</div>
      </section>
    </main>

    <script id="dataset-data" type="application/json">${escapeHtml(datasetJson)}</script>
    <script>
      const data = JSON.parse(document.getElementById('dataset-data').textContent);
      const datasetState = new Set(data.datasets.map((dataset) => dataset.datasetId));
      const datasetChipsEl = document.getElementById('dataset-chips');
      const legendGroupsEl = document.getElementById('legend-groups');
      const sampleGridEl = document.getElementById('sample-grid');
      const emptyStateEl = document.getElementById('empty-state');
      const searchEl = document.getElementById('search');
      const sortEl = document.getElementById('sort');

      function hexToHue(hex) {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        if (delta === 0) return 0;
        let hue;
        if (max === r) hue = ((g - b) / delta) % 6;
        else if (max === g) hue = ((b - r) / delta) + 2;
        else hue = ((r - g) / delta) + 4;
        hue *= 60;
        return hue < 0 ? hue + 360 : hue;
      }

      function sourceBadge(sample) {
        if (sample.sourceRatioKnown === false || sample.label.includes('@unstated')) {
          return { label: 'ratio caveat', warning: true };
        }

        switch (sample.sourceType) {
          case 'video_observed_mix':
            return { label: 'observed', warning: false };
          case 'curated_manual_target':
            return { label: 'curated', warning: false };
          case 'imported_reference_target':
            return { label: 'imported', warning: false };
          default:
            return { label: 'measured', warning: false };
        }
      }

      function sampleReference(sample) {
        return sample.sourceSampleCode ?? sample.sourceSampleId ?? sample.id ?? 'unlabeled-source';
      }

      function sampleTargetLabel(sample) {
        switch (sample.sourceType) {
          case 'video_observed_mix':
            return 'Observed target';
          case 'curated_manual_target':
            return 'Curated target';
          case 'imported_reference_target':
            return 'Imported target';
          default:
            return 'Measured target';
        }
      }

      function renderDatasetChips() {
        datasetChipsEl.innerHTML = '';
        for (const dataset of data.datasets) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'chip' + (datasetState.has(dataset.datasetId) ? ' active' : '');
          chip.textContent = dataset.title + ' (' + dataset.sampleCount + ')';
          chip.addEventListener('click', () => {
            if (datasetState.has(dataset.datasetId)) datasetState.delete(dataset.datasetId);
            else datasetState.add(dataset.datasetId);
            renderDatasetChips();
            renderLegend();
            renderSamples();
          });
          datasetChipsEl.appendChild(chip);
        }
      }

      function renderLegend() {
        legendGroupsEl.innerHTML = '';
        for (const dataset of data.datasets) {
          if (!datasetState.has(dataset.datasetId)) continue;
          const group = document.createElement('div');
          group.className = 'legend-group';
          const title = document.createElement('h3');
          title.textContent = dataset.title + ' · ' + dataset.paintCount + ' paints';
          group.appendChild(title);
          if (dataset.ratioNote) {
            const note = document.createElement('p');
            note.className = 'sample-notes';
            note.textContent = dataset.ratioNote;
            group.appendChild(note);
          }
          const strip = document.createElement('div');
          strip.className = 'swatch-strip';
          for (const paint of dataset.paints) {
            const chip = document.createElement('div');
            chip.className = 'paint-chip';
            chip.innerHTML =
              '<span class="dot" style="background:' + paint.colorHex + '"></span>' +
              '<div>' +
              '<strong>' + paint.paintLabel + '</strong>' +
              '<small>' + paint.colorHex + '</small>' +
              '</div>';
            strip.appendChild(chip);
          }
          group.appendChild(strip);
          legendGroupsEl.appendChild(group);
        }
      }

      function sampleMatches(sample, query) {
        if (!query) return true;
        const haystack = [
          sample.id,
          sample.label,
          sample.targetHex,
          ...(sample.inputs ?? []).flatMap((input) => [input.paintLabel ?? '', input.paintId ?? '', input.colorHex ?? '']),
          sample.notes ?? '',
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      }

      function cardHtml(sample, dataset) {
        const badge = sourceBadge(sample);
        const inputHtml = sample.inputs.map((input) =>
          '<div class="swatch-card">' +
            '<div class="swatch" style="background:' + input.colorHex + '"></div>' +
            '<strong>' + input.paintLabel + '</strong>' +
            '<span>' + input.parts + ' part' + (input.parts === 1 ? '' : 's') + '</span>' +
            '<small>' + input.colorHex + '</small>' +
          '</div>'
        ).join('<div class="mix-sep">+</div>');

        return (
          '<article class="sample-card">' +
            '<div class="sample-head">' +
              '<div>' +
                '<h3>' + sample.label + '</h3>' +
                '<div class="sample-meta">' + dataset.title + ' · ' + sampleReference(sample) + '</div>' +
              '</div>' +
              '<span class="badge' + (badge.warning ? ' warning' : '') + '">' + badge.label + '</span>' +
            '</div>' +
            '<div class="mix-row">' +
              '<div class="mix-inputs">' + inputHtml + '</div>' +
              '<div class="mix-sep">→</div>' +
              '<div class="swatch-card">' +
                '<div class="swatch" style="background:' + sample.targetHex + '"></div>' +
                '<strong>' + sampleTargetLabel(sample) + '</strong>' +
                '<span>' + sample.category + '</span>' +
                '<small>' + sample.targetHex + '</small>' +
              '</div>' +
            '</div>' +
            '<div class="sample-notes">' + (sample.notes ?? '') + '</div>' +
          '</article>'
        );
      }

      function renderSamples() {
        const query = searchEl.value.trim().toLowerCase();
        const visibleDatasets = data.datasets.filter((dataset) => datasetState.has(dataset.datasetId));
        let rows = visibleDatasets.flatMap((dataset) => dataset.samples.map((sample) => ({ dataset, sample })));
        rows = rows.filter(({ sample }) => sampleMatches(sample, query));

        const sortMode = sortEl.value;
        if (sortMode === 'target') {
          rows.sort((left, right) => hexToHue(left.sample.targetHex) - hexToHue(right.sample.targetHex));
        } else if (sortMode === 'label') {
          rows.sort((left, right) => left.sample.label.localeCompare(right.sample.label));
        } else {
          rows.sort((left, right) => {
            const datasetCmp = left.dataset.title.localeCompare(right.dataset.title);
            return datasetCmp !== 0 ? datasetCmp : left.sample.label.localeCompare(right.sample.label);
          });
        }

        sampleGridEl.innerHTML = rows.map(({ dataset, sample }) => cardHtml(sample, dataset)).join('');
        emptyStateEl.hidden = rows.length !== 0;
      }

      searchEl.addEventListener('input', renderSamples);
      sortEl.addEventListener('change', renderSamples);

      renderDatasetChips();
      renderLegend();
      renderSamples();
    </script>
  </body>
</html>`;
}

export function buildGroundTruthGalleryPayload(groundTruthRoot) {
  const datasets = loadGroundTruthDatasets(groundTruthRoot);
  return {
    generatedAt: new Date().toISOString(),
    datasets: datasets.map((dataset) => ({
      datasetId: dataset.datasetId,
      title: dataset.title,
      description: dataset.description,
      sampleCount: dataset.sampleCount,
      paintCount: dataset.paintCount,
      ratioNote: dataset.ratioNote,
      paints: dataset.paints,
      samples: dataset.samples,
    })),
  };
}

export function writeGroundTruthGallery({ groundTruthRoot, outputPath }) {
  const payload = buildGroundTruthGalleryPayload(groundTruthRoot);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buildPage(payload), 'utf8');

  return {
    outputPath,
    datasetCount: payload.datasets.length,
    sampleCount: payload.datasets.reduce((sum, dataset) => sum + dataset.sampleCount, 0),
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      'ground-truth-root': { type: 'string' },
      output: { type: 'string' },
    },
  });

  const groundTruthRoot = path.resolve(values['ground-truth-root'] ?? 'artifacts/ground-truth');
  const outputPath = path.resolve(values.output ?? path.join(groundTruthRoot, 'gallery', 'index.html'));
  const result = writeGroundTruthGallery({ groundTruthRoot, outputPath });

  console.log(`Wrote gallery: ${result.outputPath}`);
  console.log(`Datasets included: ${result.datasetCount}`);
  console.log(`Samples included: ${result.sampleCount}`);
}

const isDirectExecution =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  await main();
}
