#!/usr/bin/env node
import { parseArgs } from 'node:util';

import {
  fmt4,
  loadArtifactSelection,
  makeActiveMixer,
  makeLearnedOnlyMixer,
  makePhysicalMixer,
  metricsOf,
  resolveOutputPath,
  sampleLabel,
  scoreDataset,
  writeCompareXml,
  writeTextFile,
} from './common.mjs';
import { loadGroundTruthDataset, resolveGroundTruthDir, summarizeGroundTruthSamples } from './ground-truth.mjs';

function parseAllowedStatuses(rawValue) {
  return new Set(
    (rawValue ?? 'approved')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

function printMetrics(lines, label, metrics) {
  lines.push(label);
  lines.push(`  mean ΔE: ${fmt4(metrics.mean)}`);
  lines.push(`  p95  ΔE: ${fmt4(metrics.p95)}`);
  lines.push(`  max  ΔE: ${fmt4(metrics.max)}`);
  lines.push(`  worst  : ${metrics.worstLabel}`);
  lines.push('');
}

async function main() {
  const { values } = parseArgs({
    options: {
      'dataset-dir': { type: 'string' },
      'artifact-json': { type: 'string' },
      'review-status': { type: 'string' },
      'report-out': { type: 'string' },
      'xml-out': { type: 'string' },
    },
  });

  const datasetDir = resolveGroundTruthDir(values['dataset-dir']);
  const { manifest, samples } = loadGroundTruthDataset(datasetDir);
  const allowedStatuses = parseAllowedStatuses(values['review-status']);
  const filteredSamples = samples.filter((sample) => allowedStatuses.has(sample.reviewStatus));
  if (filteredSamples.length === 0) {
    throw new Error(`No samples matched review statuses: ${[...allowedStatuses].join(', ')}`);
  }

  const artifactSelection = loadArtifactSelection(values['artifact-json']);
  const startedAt = performance.now();

  const physicalScores = scoreDataset(filteredSamples, makePhysicalMixer(artifactSelection.artifact));
  const learnedScores = scoreDataset(filteredSamples, makeLearnedOnlyMixer(artifactSelection.artifact));
  const activeScores = scoreDataset(filteredSamples, makeActiveMixer(artifactSelection.artifact));
  const summary = summarizeGroundTruthSamples(filteredSamples);

  const physicalMetrics = metricsOf(physicalScores);
  const learnedMetrics = metricsOf(learnedScores);
  const activeMetrics = metricsOf(activeScores);

  const lines = [];
  lines.push(`Ground-truth dataset: ${manifest.datasetId}`);
  lines.push(`Dataset dir: ${datasetDir}`);
  lines.push(`Artifact: ${artifactSelection.label}`);
  lines.push(`Artifact modelId: ${artifactSelection.artifact.modelId}`);
  lines.push(`Artifact baseEngineId: ${artifactSelection.artifact.baseEngineId}`);
  lines.push(`Included review statuses: ${[...allowedStatuses].join(', ')}`);
  lines.push(`Dataset samples: ${filteredSamples.length}`);
  lines.push('');
  lines.push('By source type:');
  for (const [key, count] of Object.entries(summary.bySourceType).sort((left, right) => left[0].localeCompare(right[0]))) {
    lines.push(`  ${key}: ${count}`);
  }
  lines.push('');

  printMetrics(lines, 'Physical only', physicalMetrics);
  printMetrics(lines, 'Learned only', learnedMetrics);
  printMetrics(lines, 'Current blend', activeMetrics);

  lines.push('Top 12 current-blend failures:');
  for (const row of [...activeScores].sort((left, right) => right.deltaE - left.deltaE).slice(0, 12)) {
    lines.push(
      `  ΔE=${fmt4(row.deltaE).padStart(7)}  ${row.predicted.toHexString()} vs ${row.sample.targetHex}  ${sampleLabel(row.sample)}`,
    );
  }
  lines.push('');

  const reportText = `${lines.join('\n')}\n`;
  const durationSeconds = (performance.now() - startedAt) / 1000;
  const reportOut = resolveOutputPath(values['report-out'], 'tools/eval/out/latest_ground_truth_report.txt');
  const xmlOut = resolveOutputPath(values['xml-out'], 'tools/eval/out/latest_ground_truth.xml');

  writeTextFile(reportOut, reportText);
  writeCompareXml({
    filePath: xmlOut,
    durationSeconds,
    metricsByMode: {
      physical: physicalMetrics,
      learned: learnedMetrics,
      active: activeMetrics,
    },
    reportText,
    suiteName: 'spectralnn.paintmixer.eval.GroundTruthScore',
    className: 'spectralnn.paintmixer.eval.GroundTruthScore',
    caseName: 'score',
  });

  process.stdout.write(reportText);
  console.log(`Wrote ground-truth report to ${reportOut}`);
  console.log(`Wrote ground-truth XML to ${xmlOut}`);
}

await main();
