#!/usr/bin/env node
import { parseArgs } from 'node:util';

import { loadGroundTruthDataset, resolveGroundTruthDir, summarizeGroundTruthSamples } from './ground-truth.mjs';

function printCounts(lines, title, counts) {
  lines.push(title);
  for (const [key, count] of Object.entries(counts).sort((left, right) => left[0].localeCompare(right[0]))) {
    lines.push(`  ${key}: ${count}`);
  }
  lines.push('');
}

async function main() {
  const { values } = parseArgs({
    options: {
      'dataset-dir': { type: 'string' },
    },
  });

  const datasetDir = resolveGroundTruthDir(values['dataset-dir']);
  const { manifest, samples } = loadGroundTruthDataset(datasetDir);
  const summary = summarizeGroundTruthSamples(samples);

  const lines = [];
  lines.push(`Validated ground-truth dataset: ${manifest.datasetId}`);
  lines.push(`Dataset dir: ${datasetDir}`);
  lines.push(`Created at: ${manifest.createdAt}`);
  lines.push(`Samples: ${summary.totalSamples}`);
  lines.push('');
  printCounts(lines, 'By source type:', summary.bySourceType);
  printCounts(lines, 'By review status:', summary.byReviewStatus);
  printCounts(lines, 'By category:', summary.byCategory);

  process.stdout.write(`${lines.join('\n')}\n`);
}

await main();
