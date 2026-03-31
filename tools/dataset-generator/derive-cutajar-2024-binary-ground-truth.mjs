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

function paintIdFor(sampleCode) {
  return `cutajar-2024/${sampleCode}`;
}

function derivePaints(pureSamples, measuredReflectanceToHex) {
  return pureSamples.map((sample) => ({
    paintId: paintIdFor(sample.sampleCode),
    paintLabel: sample.sampleCode === 'PBW'
      ? `${sample.components[0].componentName} (Library 2)`
      : sample.components[0].componentName,
    colorHex: measuredReflectanceToHex(sample.measuredVnirReflectance),
    sourceSampleId: sample.id,
    sourceSampleCode: sample.sampleCode,
  }));
}

function buildGroundTruthSamples(binarySamples, paintByCode, measuredReflectanceToHex) {
  return binarySamples.map((sample) => {
    const inputs = sample.components.map((component) => {
      const paint = paintByCode.get(component.componentCode);
      if (!paint) {
        throw new Error(`Missing pure paint for ${sample.id} component ${component.componentCode}`);
      }
      return {
        paintId: paint.paintId,
        paintLabel: paint.paintLabel,
        colorHex: paint.colorHex,
        parts: 1,
        sourceSampleId: paint.sourceSampleId,
        sourceSampleCode: paint.sourceSampleCode,
      };
    });

    return {
      id: `cutajar-2024-binary-${sample.sampleCode}`,
      sourceType: 'measured_spectral_mix',
      reviewStatus: 'draft',
      category: 'measured_binary',
      palette: 'cutajar-2024',
      label: `${sample.components.map((component) => component.componentName).join('+')}@unstated`,
      inputs,
      targetHex: measuredReflectanceToHex(sample.measuredVnirReflectance),
      source: {
        kind: 'measured_dataset_derivation',
        reference: `artifacts/measured/cutajar-2024-v1/library2-binary-samples.jsonl#${sample.id}`,
      },
      sourceSampleId: sample.id,
      sourceSampleCode: sample.sampleCode,
      ratioBasis: sample.ratioBasis,
      sourceRatioKnown: sample.proportionKnown,
      sourceComponentCodes: sample.components.map((component) => component.componentCode),
      notes: `Derived from measured Cutajar 2024 sample ${sample.sampleCode}. Input parts are placeholder 1:1 because the accessible source subset identifies components but does not state mixture proportions.`,
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

  const measuredDir = path.resolve(values['measured-dir'] ?? 'artifacts/measured/cutajar-2024-v1');
  const outputDir = path.resolve(values['output-dir'] ?? 'artifacts/ground-truth/cutajar-2024-binary-v1');

  const measuredManifest = readJson(path.join(measuredDir, 'manifest.json'));
  const wavelengthsNm = readJson(path.join(measuredDir, 'wavelengths_library2_vnir_nm.json'));
  const pureSamples = readJsonl(path.join(measuredDir, 'library2-pure-samples.jsonl'));
  const binarySamples = readJsonl(path.join(measuredDir, 'library2-binary-samples.jsonl'));

  const measuredReflectanceToHex = createMeasuredReflectanceHexConverter(wavelengthsNm);
  const paints = derivePaints(pureSamples, measuredReflectanceToHex);
  const paintByCode = new Map(paints.map((paint) => [paint.sourceSampleCode, paint]));
  const samples = buildGroundTruthSamples(binarySamples, paintByCode, measuredReflectanceToHex);

  mkdirSync(outputDir, { recursive: true });

  const manifest = {
    datasetVersion: 1,
    datasetId: 'ground-truth-cutajar-2024-binary-v1',
    createdAt: new Date().toISOString(),
    description: 'Binary A+B=C rows derived from the workbook-accessible binary mixtures in the Cutajar 2024 oil-paint libraries.',
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
      pureInputsSource: 'library2-pure-samples.jsonl',
      targetSource: 'library2-binary-samples.jsonl',
      ratioTreatment: {
        sourceStatesRatios: false,
        placeholderPartsUsed: [1, 1],
        note: 'The accessible workbook/PDF subset identifies which paints are present in each binary mixture, but it does not explicitly state the component proportions. Inputs therefore use placeholder equal parts only to satisfy the current training-facing schema, and should not be treated as verified physical ratios.',
      },
      runtimeSpectralGridNm: RUNTIME_WAVELENGTHS_NM,
      resampling: {
        method: 'direct_integration_on_measured_grid',
        note: 'The measured VNIR reflectance is integrated on its native wavelength grid after converting the runtime 10 nm D65-weighted color-matching sample weights into per-nanometre densities and interpolating those onto the measured grid.',
      },
      colorConversion: {
        implementation: 'D65-weighted runtime CMFs from packages/js/src/spectral-basis-data.js, integrated on the measured VNIR wavelength grid and converted with XYZ_TO_SRGB_D65.',
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
  console.log(`Derived ${paints.length} measured pure paint colors.`);
  console.log(`Measured source dataset: ${measuredManifest.datasetId}`);
}

await main();
