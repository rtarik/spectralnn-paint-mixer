#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { linearChannelToSrgb } from '../../packages/js/src/spectral-data.js';
import {
  X_BAR,
  Y_BAR,
  Z_BAR,
  XYZ_TO_SRGB_D65,
} from '../../packages/js/src/spectral-basis-data.js';

const RUNTIME_WAVELENGTHS_NM = Array.from({ length: 38 }, (_, index) => 380 + (index * 10));

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath, text) {
  writeFileSync(filePath, `${text.endsWith('\n') ? text : `${text}\n`}`, 'utf8');
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function multiply3x3Vector(matrix, vector) {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ];
}

function toHexFromLinearRgb(linearRgb) {
  return `#${linearRgb.map((channel) => (
    Math.round(clamp(linearChannelToSrgb(clamp(channel))) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()
  )).join('')}`;
}

function interpolate(xs, ys, x, { left = ys[0], right = ys[ys.length - 1] } = {}) {
  if (x <= xs[0]) return left;
  if (x >= xs[xs.length - 1]) return right;

  let rightIndex = 1;
  while (xs[rightIndex] < x) {
    rightIndex += 1;
  }
  const leftIndex = rightIndex - 1;
  const t = (x - xs[leftIndex]) / (xs[rightIndex] - xs[leftIndex]);
  return ys[leftIndex] + ((ys[rightIndex] - ys[leftIndex]) * t);
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function runtimeReflectanceToHex(reflectance38) {
  const xyz = [
    sum(reflectance38.map((value, index) => value * X_BAR[index])),
    sum(reflectance38.map((value, index) => value * Y_BAR[index])),
    sum(reflectance38.map((value, index) => value * Z_BAR[index])),
  ];
  return toHexFromLinearRgb(multiply3x3Vector(XYZ_TO_SRGB_D65, xyz));
}

function reviewMeasuredDataset(measuredDir) {
  const manifest = readJson(path.join(measuredDir, 'manifest.json'));
  const wavelengthsNm = readJson(path.join(measuredDir, 'wavelengths_nm.json'));
  const pureSamples = readJsonl(path.join(measuredDir, 'pure-samples.jsonl'));

  const xBarDensityAtMeasured = wavelengthsNm.map((nm) => interpolate(
    RUNTIME_WAVELENGTHS_NM,
    X_BAR.map((value) => value / 10),
    nm,
    { left: 0, right: 0 },
  ));
  const yBarDensityAtMeasured = wavelengthsNm.map((nm) => interpolate(
    RUNTIME_WAVELENGTHS_NM,
    Y_BAR.map((value) => value / 10),
    nm,
    { left: 0, right: 0 },
  ));
  const zBarDensityAtMeasured = wavelengthsNm.map((nm) => interpolate(
    RUNTIME_WAVELENGTHS_NM,
    Z_BAR.map((value) => value / 10),
    nm,
    { left: 0, right: 0 },
  ));
  const stepWeights = wavelengthsNm.map((_, index) => {
    if (index === 0) return (wavelengthsNm[1] - wavelengthsNm[0]) / 2;
    if (index === wavelengthsNm.length - 1) return (wavelengthsNm[index] - wavelengthsNm[index - 1]) / 2;
    return (wavelengthsNm[index + 1] - wavelengthsNm[index - 1]) / 2;
  });

  function directMeasuredReflectanceToHex(sourceReflectance) {
    const xyz = [
      sum(xBarDensityAtMeasured.map((value, index) => sourceReflectance[index] * value * stepWeights[index])),
      sum(yBarDensityAtMeasured.map((value, index) => sourceReflectance[index] * value * stepWeights[index])),
      sum(zBarDensityAtMeasured.map((value, index) => sourceReflectance[index] * value * stepWeights[index])),
    ];
    return toHexFromLinearRgb(multiply3x3Vector(XYZ_TO_SRGB_D65, xyz));
  }

  function resampleReflectance(sourceReflectance, leftMode = 'clamp') {
    return RUNTIME_WAVELENGTHS_NM.map((targetNm) => interpolate(
      wavelengthsNm,
      sourceReflectance,
      targetNm,
      {
        left: leftMode === 'zero' ? 0 : sourceReflectance[0],
        right: sourceReflectance[sourceReflectance.length - 1],
      },
    ));
  }

  const flatSanity = [1, 0.75, 0.55, 0.25, 0.1].map((level) => ({
    level,
    hex: runtimeReflectanceToHex(Array.from({ length: RUNTIME_WAVELENGTHS_NM.length }, () => level)),
  }));

  const purePaints = pureSamples.map((sample) => {
    const resampledClamp = resampleReflectance(sample.measuredReflectance, 'clamp');
    const resampledZeroBelow = resampleReflectance(sample.measuredReflectance, 'zero');
    const directHex = directMeasuredReflectanceToHex(sample.measuredReflectance);
    const runtimeClampHex = runtimeReflectanceToHex(resampledClamp);
    const runtimeZeroBelowHex = runtimeReflectanceToHex(resampledZeroBelow);

    return {
      sampleId: sample.id,
      sampleCode: sample.sampleCode,
      label: sample.notes,
      reflectanceStats: {
        min: Math.min(...sample.measuredReflectance),
        max: Math.max(...sample.measuredReflectance),
        average: sum(sample.measuredReflectance) / sample.measuredReflectance.length,
      },
      hexComparison: {
        runtimeResampleClamp: runtimeClampHex,
        runtimeResampleZeroBelow405: runtimeZeroBelowHex,
        directMeasuredGrid: directHex,
      },
    };
  });

  return {
    measuredDatasetId: manifest.datasetId,
    wavelengthRangeNm: [wavelengthsNm[0], wavelengthsNm[wavelengthsNm.length - 1]],
    sourceWavelengthCount: wavelengthsNm.length,
    runtimeWavelengthGridNm: RUNTIME_WAVELENGTHS_NM,
    flatReflectanceSanity: flatSanity,
    purePaints,
    summary: {
      maxRuntimeVsDirectHexDifferenceNote: 'Differences are expected to be small if the 38-sample resampling path is not the main issue.',
      sourceStartsAboveRuntimeGridNote: wavelengthsNm[0] > RUNTIME_WAVELENGTHS_NM[0]
        ? `Measured data start at ${wavelengthsNm[0]} nm, above the runtime grid minimum ${RUNTIME_WAVELENGTHS_NM[0]} nm.`
        : 'Measured data cover the full runtime grid minimum.',
    },
  };
}

function formatReport(report) {
  const lines = [
    `Measured dataset: ${report.measuredDatasetId}`,
    `Measured wavelengths: ${report.sourceWavelengthCount} (${report.wavelengthRangeNm[0]}-${report.wavelengthRangeNm[1]} nm)`,
    '',
    'Flat reflectance sanity:',
  ];
  for (const row of report.flatReflectanceSanity) {
    lines.push(`  ${row.level.toFixed(2).padStart(4)} -> ${row.hex}`);
  }
  lines.push('', 'Pure paint comparisons:');
  for (const paint of report.purePaints) {
    lines.push(
      `  ${paint.sampleCode.padEnd(2)} ${paint.hexComparison.runtimeResampleClamp}  direct=${paint.hexComparison.directMeasuredGrid}  zero-below=${paint.hexComparison.runtimeResampleZeroBelow405}  min=${paint.reflectanceStats.min.toFixed(3)} max=${paint.reflectanceStats.max.toFixed(3)} avg=${paint.reflectanceStats.average.toFixed(3)}`,
    );
  }
  lines.push('', report.summary.sourceStartsAboveRuntimeGridNote);
  return lines.join('\n');
}

async function main() {
  const { values } = parseArgs({
    options: {
      'measured-dir': { type: 'string' },
      'output-dir': { type: 'string' },
    },
  });

  const measuredDir = path.resolve(values['measured-dir'] ?? 'artifacts/measured/sensors-2021-v1');
  const outputDir = path.resolve(values['output-dir'] ?? measuredDir);
  mkdirSync(outputDir, { recursive: true });

  const report = reviewMeasuredDataset(measuredDir);
  writeJson(path.join(outputDir, 'color-conversion-review.json'), report);
  writeText(path.join(outputDir, 'color-conversion-review.txt'), formatReport(report));

  console.log(`Wrote color conversion review to ${outputDir}`);
}

await main();
