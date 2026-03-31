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

function paintIdFor(sample) {
  return `hyperdoc-2025-paint-${sample.sampleCode}`;
}

function paintLabelFor(sample) {
  return `${sample.logicalSampleName} (${sample.binder}, ${sample.supportLabel})`;
}

function derivePaints(pureSamples, measuredReflectanceToHex) {
  return pureSamples.map((sample) => ({
    paintId: paintIdFor(sample),
    paintLabel: paintLabelFor(sample),
    colorHex: measuredReflectanceToHex(sample.measuredVnirReflectance),
    sourceSampleId: sample.id,
    sourceSampleCode: sample.sampleCode,
    sourceLogicalSampleId: sample.logicalSampleId,
    sourceLogicalSampleNumber: sample.logicalSampleNumber,
    binder: sample.binder,
    supportCode: sample.supportCode,
    supportLabel: sample.supportLabel,
    logicalAcronym: sample.logicalAcronym,
  }));
}

function buildPaintLookup(paints) {
  return new Map(paints.map((paint) => [paint.sourceSampleCode, paint]));
}

function pureSampleCodeForComponent(component, supportCode) {
  const logicalNumber = component.sourceLogicalSampleNumber;
  return logicalNumber == null ? null : `${String(logicalNumber).padStart(2, '0')}${supportCode}`;
}

function buildGroundTruthSamples(binarySamples, paintBySampleCode, measuredReflectanceToHex) {
  const skipped = [];
  const samples = [];

  for (const sample of binarySamples) {
    if (!sample.hasResolvedPureColorantEndpoints) {
      skipped.push({
        sampleId: sample.id,
        sampleCode: sample.sampleCode,
        reason: 'missing_pure_endpoint',
      });
      continue;
    }

    const inputs = sample.components.map((component) => {
      const componentSampleCode = pureSampleCodeForComponent(component, sample.supportCode);
      const paint = paintBySampleCode.get(componentSampleCode);
      if (!paint) {
        throw new Error(`Missing pure paint for ${sample.id} component ${component.componentCode} at ${componentSampleCode}`);
      }
      return {
        paintId: paint.paintId,
        paintLabel: paint.paintLabel,
        colorHex: paint.colorHex,
        parts: component.nominalPart ?? 1,
        sourceSampleId: paint.sourceSampleId,
        sourceSampleCode: paint.sourceSampleCode,
      };
    });

    const targetHex = measuredReflectanceToHex(sample.measuredVnirReflectance);

    samples.push({
      id: `hyperdoc-2025-binary-${sample.sampleCode}`,
      sourceType: 'measured_spectral_mix',
      reviewStatus: 'draft',
      category: 'measured_binary',
      palette: 'hyperdoc-2025',
      label: `${sample.logicalAcronym}@1:1 [${sample.binder}, ${sample.supportLabel}]`,
      inputs,
      targetHex,
      source: {
        kind: 'measured_dataset_derivation',
        reference: `artifacts/measured/hyperdoc-2025-v1/binary-mixture-samples.jsonl#${sample.id}`,
      },
      sourceSampleId: sample.id,
      sourceSampleCode: sample.sampleCode,
      sourceLogicalSampleId: sample.logicalSampleId,
      sourceLogicalSampleNumber: sample.logicalSampleNumber,
      binder: sample.binder,
      supportCode: sample.supportCode,
      supportLabel: sample.supportLabel,
      ratioBasis: sample.ratioBasis,
      sourceNominalParts: sample.nominalParts,
      sourceComponentCodes: sample.components.map((component) => component.componentCode),
      notes: `Derived from measured HYPERDOC 2025 sample ${sample.sampleCode}.`,
    });
  }

  return { samples, skipped };
}

async function main() {
  const { values } = parseArgs({
    options: {
      'measured-dir': { type: 'string' },
      'output-dir': { type: 'string' },
    },
  });

  const measuredDir = path.resolve(values['measured-dir'] ?? 'artifacts/measured/hyperdoc-2025-v1');
  const outputDir = path.resolve(values['output-dir'] ?? 'artifacts/ground-truth/hyperdoc-2025-binary-v1');

  const measuredManifest = readJson(path.join(measuredDir, 'manifest.json'));
  const wavelengthsNm = readJson(path.join(measuredDir, 'wavelengths_vnir_nm.json'));
  const pureSamples = readJsonl(path.join(measuredDir, 'pure-colorant-samples.jsonl'));
  const binarySamples = readJsonl(path.join(measuredDir, 'binary-mixture-samples.jsonl'));

  const measuredReflectanceToHex = createMeasuredReflectanceHexConverter(wavelengthsNm);
  const paints = derivePaints(pureSamples, measuredReflectanceToHex);
  const paintBySampleCode = buildPaintLookup(paints);
  const { samples, skipped } = buildGroundTruthSamples(binarySamples, paintBySampleCode, measuredReflectanceToHex);

  mkdirSync(outputDir, { recursive: true });

  const manifest = {
    datasetVersion: 1,
    datasetId: 'ground-truth-hyperdoc-2025-binary-v1',
    createdAt: new Date().toISOString(),
    description: 'Binary A+B=C ground-truth rows derived from the measured HYPERDOC 2025 manuscript mock-up dataset.',
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
      requiredResolvedPureEndpoints: true,
      pureInputsSource: 'pure-colorant-samples.jsonl',
      targetSource: 'binary-mixture-samples.jsonl',
      skippedSamples: skipped,
      runtimeSpectralGridNm: RUNTIME_WAVELENGTHS_NM,
      resampling: {
        method: 'direct_integration_on_measured_grid',
        note: 'The VNIR reflectance is integrated on its native wavelength grid after converting the runtime 10 nm D65-weighted color-matching sample weights into per-nanometre densities and interpolating those onto the measured grid.',
      },
      colorConversion: {
        implementation: 'D65-weighted runtime CMFs from packages/js/src/spectral-basis-data.js, integrated on the measured VNIR wavelength grid and converted with XYZ_TO_SRGB_D65.',
        note: 'Only VNIR spectra are used for color conversion. SWIR is retained in the raw dataset for provenance and future research, but it is not stitched into the visible-range color target.',
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
  console.log(`Skipped ${skipped.length} binary measured samples without resolved pure endpoints.`);
  console.log(`Measured source dataset: ${measuredManifest.datasetId}`);
}

await main();
