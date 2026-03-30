#!/usr/bin/env node
import { parseArgs } from 'node:util';

import { defaultModelArtifact } from '../../packages/js/src/index.js';
import {
  KEY_MIXES,
  findCuratedFile,
  fmt4,
  loadJsonlSamples,
  makeActiveMixer,
  makeLearnedOnlyMixer,
  makePhysicalMixer,
  metricsOf,
  resolveDataDir,
  resolveOutputPath,
  sampleLabel,
  scoreDataset,
  writeCompareXml,
  writeTextFile,
} from './common.mjs';

function printMetrics(lines, label, metrics) {
  lines.push(label);
  lines.push(`  mean ΔE: ${fmt4(metrics.mean)}`);
  lines.push(`  p95  ΔE: ${fmt4(metrics.p95)}`);
  lines.push(`  max  ΔE: ${fmt4(metrics.max)}`);
  lines.push(`  worst  : ${metrics.worstLabel}`);
  lines.push('');
}

function buildReport({ samples, physicalScores, learnedScores, activeScores }) {
  const lines = [];
  const physicalMetrics = metricsOf(physicalScores);
  const learnedMetrics = metricsOf(learnedScores);
  const activeMetrics = metricsOf(activeScores);

  lines.push(`Learned weights enabled: ${defaultModelArtifact.mixingParameters.learnedMixerBlend > 0}`);
  lines.push(`Active learnedMixerBlend: ${fmt4(defaultModelArtifact.mixingParameters.learnedMixerBlend)}`);
  lines.push(`Dataset samples: ${samples.length}`);
  lines.push('');

  printMetrics(lines, 'Physical only', physicalMetrics);
  printMetrics(lines, 'Learned only', learnedMetrics);
  printMetrics(lines, 'Current blend', activeMetrics);

  lines.push('Key curated mixes:');
  for (const key of KEY_MIXES) {
    const sample = samples.find((entry) => sampleLabel(entry) === key);
    if (!sample) continue;
    const physical = physicalScores.find((row) => row.sample === sample);
    const learned = learnedScores.find((row) => row.sample === sample);
    const active = activeScores.find((row) => row.sample === sample);
    if (!physical || !learned || !active) continue;
    lines.push(
      `  ${key.padEnd(32)} physical=${physical.predicted.toHexString()} learned=${learned.predicted.toHexString()} active=${active.predicted.toHexString()} target=${sample.target} activeΔE=${fmt4(active.deltaE)}`,
    );
  }

  lines.push('');
  lines.push('Top 12 current-blend failures:');
  for (const row of [...activeScores].sort((left, right) => right.deltaE - left.deltaE).slice(0, 12)) {
    lines.push(
      `  ΔE=${fmt4(row.deltaE).padStart(7)}  ${row.predicted.toHexString()} vs ${row.sample.target}  ${sampleLabel(row.sample)}`,
    );
  }

  return {
    text: `${lines.join('\n')}\n`,
    metricsByMode: {
      physical: physicalMetrics,
      learned: learnedMetrics,
      active: activeMetrics,
    },
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      'data-dir': { type: 'string' },
      'xml-out': { type: 'string' },
      'report-out': { type: 'string' },
    },
  });

  const startedAt = performance.now();
  const dataDir = resolveDataDir(values['data-dir']);
  const curatedPath = findCuratedFile(dataDir);
  const samples = loadJsonlSamples(curatedPath);

  const physicalScores = scoreDataset(samples, makePhysicalMixer());
  const learnedScores = scoreDataset(samples, makeLearnedOnlyMixer());
  const activeScores = scoreDataset(samples, makeActiveMixer());

  const report = buildReport({
    samples,
    physicalScores,
    learnedScores,
    activeScores,
  });

  const durationSeconds = (performance.now() - startedAt) / 1000;
  const xmlOut = resolveOutputPath(values['xml-out'], 'tools/eval/out/latest_compare.xml');
  const reportOut = resolveOutputPath(values['report-out'], 'tools/eval/out/latest_compare.txt');

  writeTextFile(reportOut, report.text);
  writeCompareXml({
    filePath: xmlOut,
    durationSeconds,
    metricsByMode: report.metricsByMode,
    reportText: report.text,
  });

  process.stdout.write(report.text);
  console.log(`Wrote compare report to ${reportOut}`);
  console.log(`Wrote compare XML to ${xmlOut}`);
}

await main();
