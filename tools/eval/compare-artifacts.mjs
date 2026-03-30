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
import {
  loadGroundTruthDataset,
  resolveGroundTruthDir,
  summarizeGroundTruthSamples,
} from './ground-truth.mjs';

const UNCHANGED_EPSILON = 1e-9;

function parseAllowedStatuses(rawValue) {
  return new Set(
    (rawValue ?? 'approved')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

function formatSigned(value) {
  const numeric = Number(value);
  return `${numeric >= 0 ? '+' : ''}${fmt4(numeric)}`;
}

function printMetrics(lines, heading, metrics) {
  lines.push(heading);
  lines.push(`  mean ΔE: ${fmt4(metrics.mean)}`);
  lines.push(`  p95  ΔE: ${fmt4(metrics.p95)}`);
  lines.push(`  max  ΔE: ${fmt4(metrics.max)}`);
  lines.push(`  worst  : ${metrics.worstLabel}`);
  lines.push('');
}

function printMetricDelta(lines, heading, baselineMetrics, candidateMetrics) {
  lines.push(`${heading} delta (candidate - baseline)`);
  lines.push(`  mean ΔE: ${formatSigned(candidateMetrics.mean - baselineMetrics.mean)}`);
  lines.push(`  p95  ΔE: ${formatSigned(candidateMetrics.p95 - baselineMetrics.p95)}`);
  lines.push(`  max  ΔE: ${formatSigned(candidateMetrics.max - baselineMetrics.max)}`);
  lines.push('');
}

function scoreArtifact(samples, artifactSelection) {
  const physicalScores = scoreDataset(samples, makePhysicalMixer(artifactSelection.artifact));
  const learnedScores = scoreDataset(samples, makeLearnedOnlyMixer(artifactSelection.artifact));
  const activeScores = scoreDataset(samples, makeActiveMixer(artifactSelection.artifact));
  return {
    physicalScores,
    learnedScores,
    activeScores,
    physicalMetrics: metricsOf(physicalScores),
    learnedMetrics: metricsOf(learnedScores),
    activeMetrics: metricsOf(activeScores),
  };
}

function rowKey(row) {
  return row.sample.id ?? sampleLabel(row.sample);
}

function compareActiveScores(baselineScores, candidateScores) {
  const candidateByKey = new Map(candidateScores.map((row) => [rowKey(row), row]));
  const changes = [];

  for (const baselineRow of baselineScores) {
    const key = rowKey(baselineRow);
    const candidateRow = candidateByKey.get(key);
    if (!candidateRow) {
      throw new Error(`Candidate artifact did not produce a matching row for ${key}`);
    }

    const delta = candidateRow.deltaE - baselineRow.deltaE;
    changes.push({
      sample: baselineRow.sample,
      baselineRow,
      candidateRow,
      delta,
    });
  }

  const improved = changes.filter((row) => row.delta < -UNCHANGED_EPSILON);
  const regressed = changes.filter((row) => row.delta > UNCHANGED_EPSILON);
  const unchanged = changes.length - improved.length - regressed.length;

  return {
    changes,
    improved,
    regressed,
    unchanged,
  };
}

function printSampleChanges(lines, heading, rows, limit) {
  lines.push(heading);
  if (rows.length === 0) {
    lines.push('  none');
    lines.push('');
    return;
  }

  for (const row of rows.slice(0, limit)) {
    const targetHex = row.sample.targetHex ?? row.sample.target ?? 'UNKNOWN';
    lines.push(
      `  Δ=${formatSigned(row.delta).padStart(8)}  cand ${fmt4(row.candidateRow.deltaE).padStart(7)} ${row.candidateRow.predicted.toHexString()}  base ${fmt4(row.baselineRow.deltaE).padStart(7)} ${row.baselineRow.predicted.toHexString()}  target ${targetHex}  ${sampleLabel(row.sample)}`,
    );
  }
  lines.push('');
}

async function main() {
  const { values } = parseArgs({
    options: {
      'dataset-dir': { type: 'string' },
      'baseline-artifact-json': { type: 'string' },
      'candidate-artifact-json': { type: 'string' },
      'review-status': { type: 'string' },
      'report-out': { type: 'string' },
      'xml-out': { type: 'string' },
    },
  });

  if (!values['candidate-artifact-json']) {
    throw new Error('Expected --candidate-artifact-json <path>');
  }

  const datasetDir = resolveGroundTruthDir(values['dataset-dir']);
  const { manifest, samples } = loadGroundTruthDataset(datasetDir);
  const allowedStatuses = parseAllowedStatuses(values['review-status']);
  const filteredSamples = samples.filter((sample) => allowedStatuses.has(sample.reviewStatus));
  if (filteredSamples.length === 0) {
    throw new Error(`No samples matched review statuses: ${[...allowedStatuses].join(', ')}`);
  }

  const baselineSelection = loadArtifactSelection(values['baseline-artifact-json']);
  const candidateSelection = loadArtifactSelection(values['candidate-artifact-json']);
  const startedAt = performance.now();

  const baseline = scoreArtifact(filteredSamples, baselineSelection);
  const candidate = scoreArtifact(filteredSamples, candidateSelection);
  const summary = summarizeGroundTruthSamples(filteredSamples);
  const activeComparison = compareActiveScores(baseline.activeScores, candidate.activeScores);
  const topImprovements = [...activeComparison.improved].sort((left, right) => left.delta - right.delta);
  const topRegressions = [...activeComparison.regressed].sort((left, right) => right.delta - left.delta);
  const biggestImprovement = topImprovements[0] ?? null;
  const biggestRegression = topRegressions[0] ?? null;

  const lines = [];
  lines.push(`Ground-truth artifact comparison: ${manifest.datasetId}`);
  lines.push(`Dataset dir: ${datasetDir}`);
  lines.push(`Included review statuses: ${[...allowedStatuses].join(', ')}`);
  lines.push(`Dataset samples: ${filteredSamples.length}`);
  lines.push('');
  lines.push('Baseline artifact:');
  lines.push(`  label         : ${baselineSelection.label}`);
  lines.push(`  modelId       : ${baselineSelection.artifact.modelId}`);
  lines.push(`  baseEngineId  : ${baselineSelection.artifact.baseEngineId}`);
  lines.push('');
  lines.push('Candidate artifact:');
  lines.push(`  label         : ${candidateSelection.label}`);
  lines.push(`  modelId       : ${candidateSelection.artifact.modelId}`);
  lines.push(`  baseEngineId  : ${candidateSelection.artifact.baseEngineId}`);
  lines.push('');
  lines.push('By source type:');
  for (const [key, count] of Object.entries(summary.bySourceType).sort((left, right) => left[0].localeCompare(right[0]))) {
    lines.push(`  ${key}: ${count}`);
  }
  lines.push('');

  printMetrics(lines, 'Baseline physical only', baseline.physicalMetrics);
  printMetrics(lines, 'Candidate physical only', candidate.physicalMetrics);
  printMetricDelta(lines, 'Physical only', baseline.physicalMetrics, candidate.physicalMetrics);

  printMetrics(lines, 'Baseline learned only', baseline.learnedMetrics);
  printMetrics(lines, 'Candidate learned only', candidate.learnedMetrics);
  printMetricDelta(lines, 'Learned only', baseline.learnedMetrics, candidate.learnedMetrics);

  printMetrics(lines, 'Baseline current blend', baseline.activeMetrics);
  printMetrics(lines, 'Candidate current blend', candidate.activeMetrics);
  printMetricDelta(lines, 'Current blend', baseline.activeMetrics, candidate.activeMetrics);

  lines.push('Active blend sample delta summary:');
  lines.push(`  improved : ${activeComparison.improved.length}`);
  lines.push(`  regressed: ${activeComparison.regressed.length}`);
  lines.push(`  unchanged: ${activeComparison.unchanged}`);
  lines.push('');

  printSampleChanges(lines, 'Top 12 active improvements:', topImprovements, 12);
  printSampleChanges(lines, 'Top 12 active regressions:', topRegressions, 12);

  const reportText = `${lines.join('\n')}\n`;
  const durationSeconds = (performance.now() - startedAt) / 1000;
  const reportOut = resolveOutputPath(values['report-out'], 'tools/eval/out/latest_artifact_compare.txt');
  const xmlOut = resolveOutputPath(values['xml-out'], 'tools/eval/out/latest_artifact_compare.xml');

  writeTextFile(reportOut, reportText);
  writeCompareXml({
    filePath: xmlOut,
    durationSeconds,
    metricsByMode: {
      baselinePhysical: baseline.physicalMetrics,
      candidatePhysical: candidate.physicalMetrics,
      baselineLearned: baseline.learnedMetrics,
      candidateLearned: candidate.learnedMetrics,
      baselineActive: baseline.activeMetrics,
      candidateActive: candidate.activeMetrics,
    },
    extraProperties: {
      datasetId: manifest.datasetId,
      sampleCount: String(filteredSamples.length),
      reviewStatuses: [...allowedStatuses].join(','),
      baselineLabel: baselineSelection.label,
      baselineModelId: baselineSelection.artifact.modelId,
      baselineBaseEngineId: baselineSelection.artifact.baseEngineId,
      candidateLabel: candidateSelection.label,
      candidateModelId: candidateSelection.artifact.modelId,
      candidateBaseEngineId: candidateSelection.artifact.baseEngineId,
      activeMeanDelta: formatSigned(candidate.activeMetrics.mean - baseline.activeMetrics.mean),
      activeP95Delta: formatSigned(candidate.activeMetrics.p95 - baseline.activeMetrics.p95),
      activeMaxDelta: formatSigned(candidate.activeMetrics.max - baseline.activeMetrics.max),
      improvedCount: String(activeComparison.improved.length),
      regressedCount: String(activeComparison.regressed.length),
      unchangedCount: String(activeComparison.unchanged),
      biggestImprovementLabel: biggestImprovement ? sampleLabel(biggestImprovement.sample) : 'NONE',
      biggestImprovementDelta: biggestImprovement ? formatSigned(biggestImprovement.delta) : '+0.0000',
      biggestRegressionLabel: biggestRegression ? sampleLabel(biggestRegression.sample) : 'NONE',
      biggestRegressionDelta: biggestRegression ? formatSigned(biggestRegression.delta) : '+0.0000',
    },
    reportText,
    suiteName: 'spectralnn.paintmixer.eval.ArtifactComparison',
    className: 'spectralnn.paintmixer.eval.ArtifactComparison',
    caseName: 'compareArtifacts',
  });

  process.stdout.write(reportText);
  console.log(`Wrote artifact comparison report to ${reportOut}`);
  console.log(`Wrote artifact comparison XML to ${xmlOut}`);
}

await main();
