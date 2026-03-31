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

function writeJsonl(filePath, rows) {
  writeFileSync(
    filePath,
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8',
  );
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
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

function multiply3x3Vector(matrix, vector) {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ];
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function meanReflectance(reflectanceRows) {
  const length = reflectanceRows[0].length;
  return Array.from({ length }, (_, index) => (
    sum(reflectanceRows.map((row) => row[index])) / reflectanceRows.length
  ));
}

function toHexFromLinearRgb(linearRgb) {
  return `#${linearRgb.map((channel) => (
    Math.round(clamp(linearChannelToSrgb(clamp(channel))) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()
  )).join('')}`;
}

function createMeasuredReflectanceHexConverter(wavelengthsNm) {
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

  return function measuredReflectanceToHex(sourceReflectance) {
    const xyz = [
      sum(xBarDensityAtMeasured.map((value, index) => sourceReflectance[index] * value * stepWeights[index])),
      sum(yBarDensityAtMeasured.map((value, index) => sourceReflectance[index] * value * stepWeights[index])),
      sum(zBarDensityAtMeasured.map((value, index) => sourceReflectance[index] * value * stepWeights[index])),
    ];
    return toHexFromLinearRgb(multiply3x3Vector(XYZ_TO_SRGB_D65, xyz));
  };
}

function buildAggregatedPaints(pureSamples, measuredReflectanceToHex) {
  const grouped = new Map();
  for (const sample of pureSamples) {
    const componentCode = sample.componentCodes[0];
    const componentName = sample.components[0].componentName;
    const existing = grouped.get(componentCode) ?? {
      componentCode,
      componentName,
      reflectanceRows: [],
      sourceSampleIds: [],
      sourceSampleCodes: [],
    };
    existing.reflectanceRows.push(sample.measuredReflectance);
    existing.sourceSampleIds.push(sample.id);
    existing.sourceSampleCodes.push(sample.sampleCode);
    grouped.set(componentCode, existing);
  }

  return Array.from(grouped.values())
    .sort((left, right) => left.componentCode.localeCompare(right.componentCode))
    .map((entry) => {
      const meanMeasuredReflectance = meanReflectance(entry.reflectanceRows);
      return {
        paintId: `bath-2016/${entry.componentCode}`,
        pigmentCode: entry.componentCode,
        paintLabel: entry.componentName,
        colorHex: measuredReflectanceToHex(meanMeasuredReflectance),
        sourceReplicateCount: entry.reflectanceRows.length,
        sourceSampleIds: entry.sourceSampleIds,
        sourceSampleCodes: entry.sourceSampleCodes,
      };
    });
}

function buildGroundTruthSamples(binarySamples, paintByCode, measuredReflectanceToHex) {
  return binarySamples.map((sample) => {
    const inputs = sample.componentCodes.map((componentCode, index) => {
      const paint = paintByCode.get(componentCode);
      if (!paint) {
        throw new Error(`Missing aggregated pure paint for ${sample.id} component ${componentCode}`);
      }
      return {
        paintId: paint.paintId,
        paintLabel: paint.paintLabel,
        colorHex: paint.colorHex,
        parts: sample.nominalParts[index],
        sourceSampleId: paint.sourceSampleIds[0],
        sourceSampleCode: paint.sourceSampleCodes[0],
      };
    });

    const ratioLabel = sample.nominalParts.join(':');
    const pigmentLabel = sample.components.map((component) => component.componentName).join('+');
    const normalizedSampleId = sample.id
      .replace(/^bath-2016-/u, '')
      .replaceAll('_', '-');

    return {
      id: `bath-2016-binary-${normalizedSampleId}`,
      sourceType: 'measured_spectral_mix',
      reviewStatus: 'draft',
      category: 'measured_binary',
      palette: 'bath-2016',
      label: `${pigmentLabel}@${ratioLabel}`,
      inputs,
      targetHex: measuredReflectanceToHex(sample.measuredReflectance),
      source: {
        kind: 'measured_dataset_derivation',
        reference: `artifacts/measured/bath-2016-v1/resolved-binary-mixture-samples.jsonl#${sample.id}`,
      },
      sourceSampleId: sample.id,
      sourceSampleCode: sample.sampleCode,
      sourceReplicateIndex: sample.replicateIndex,
      ratioBasis: sample.ratioBasis,
      sourceMassFractions: sample.sourceMassFractions,
      sourceNominalParts: sample.nominalParts,
      sourcePercentages: sample.sourcePercentages,
      notes: `Derived from measured Bath 2016 sample ${sample.sampleCode}, replicate ${sample.replicateIndex}. Pure inputs are mean reflectance aggregates across the pure replicate spectra for each pigment code.`,
    };
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      'measured-dir': { type: 'string' },
      'output-dir': { type: 'string' },
    },
  });

  const measuredDir = path.resolve(values['measured-dir'] ?? 'artifacts/measured/bath-2016-v1');
  const outputDir = path.resolve(values['output-dir'] ?? 'artifacts/ground-truth/bath-2016-binary-v1');

  const measuredManifest = readJson(path.join(measuredDir, 'manifest.json'));
  const wavelengthsNm = readJson(path.join(measuredDir, 'wavelengths_nm.json'));
  const pureSamples = readJsonl(path.join(measuredDir, 'pure-samples.jsonl'));
  const binarySamples = readJsonl(path.join(measuredDir, 'resolved-binary-mixture-samples.jsonl'));

  const measuredReflectanceToHex = createMeasuredReflectanceHexConverter(wavelengthsNm);
  const paints = buildAggregatedPaints(pureSamples, measuredReflectanceToHex);
  const paintByCode = new Map(paints.map((paint) => [paint.pigmentCode, paint]));
  const samples = buildGroundTruthSamples(binarySamples, paintByCode, measuredReflectanceToHex);

  mkdirSync(outputDir, { recursive: true });

  const manifest = {
    datasetVersion: 1,
    datasetId: 'ground-truth-bath-2016-binary-v1',
    createdAt: new Date().toISOString(),
    description: 'Binary A+B=C ground-truth rows derived from the public Bath 2016 paint-mixture reflectance archive.',
    colorSpace: 'srgb',
    targetEncoding: 'hex_rgb_opaque',
    portionUnit: 'parts',
    supportedSourceTypes: [
      'measured_spectral_mix',
    ],
    supportedReviewStatuses: [
      'draft',
      'reviewed',
      'approved',
    ],
    sourceMeasuredDatasetId: measuredManifest.datasetId,
    sourceMeasuredDatasetDir: path.relative(process.cwd(), measuredDir),
    derivation: {
      binarySubsetOnly: true,
      pureInputsSource: 'pure-samples.jsonl',
      pureAggregation: {
        method: 'mean_reflectance_by_component_code',
        note: 'Each model-facing pure input paint is the arithmetic mean of the replicate pure spectra for that pigment code.',
      },
      targetSource: 'resolved-binary-mixture-samples.jsonl',
      skippedMeasuredSamples: measuredManifest.binaryMixtureEligibility?.ineligibleMeasuredSamples ?? 0,
      runtimeSpectralGridNm: RUNTIME_WAVELENGTHS_NM,
      resampling: {
        method: 'direct_integration_on_measured_grid',
        note: 'The measured reflectance is integrated on its native wavelength grid after converting the runtime 10 nm D65-weighted color-matching sample weights into per-nanometre densities and interpolating those onto the measured grid.',
      },
      colorConversion: {
        implementation: 'D65-weighted runtime CMFs from packages/js/src/spectral-basis-data.js, integrated on the measured wavelength grid and converted with XYZ_TO_SRGB_D65.',
        note: 'Only the visible-range part of the 350-2500 nm measured spectra contributes to color because the interpolated CMF densities are zero outside the runtime visible support.',
      },
    },
    files: {
      paints: 'paints.json',
      samples: 'samples.jsonl',
    },
    sampleCount: samples.length,
  };

  writeJson(path.join(outputDir, 'manifest.json'), manifest);
  writeJson(path.join(outputDir, 'paints.json'), paints);
  writeJsonl(path.join(outputDir, 'samples.jsonl'), samples);

  console.log(`Derived ${samples.length} binary ground-truth samples into ${outputDir}`);
  console.log(`Derived ${paints.length} aggregated pure paint colors.`);
  console.log(`Measured source dataset: ${measuredManifest.datasetId}`);
}

await main();
