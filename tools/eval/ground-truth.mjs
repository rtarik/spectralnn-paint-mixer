import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { repoRoot } from './common.mjs';

const HEX_RGB_RE = /^#[0-9A-F]{6}$/u;
const SAMPLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/u;

export function resolveGroundTruthDir(explicit) {
  return path.resolve(explicit ?? path.join(repoRoot, 'artifacts/ground-truth/v1'));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => ({ lineNumber: index + 1, value: JSON.parse(line) }));
}

function requireString(errors, context, value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${context}: expected non-empty string for ${field}`);
    return false;
  }
  return true;
}

function requireHex(errors, context, value, field) {
  if (!requireString(errors, context, value, field)) return false;
  if (!HEX_RGB_RE.test(value)) {
    errors.push(`${context}: expected ${field} to be uppercase #RRGGBB, got ${value}`);
    return false;
  }
  return true;
}

function validateManifest(manifest, errors, datasetDir) {
  const context = `${datasetDir}/manifest.json`;
  if (manifest.datasetVersion !== 1) {
    errors.push(`${context}: expected datasetVersion 1, got ${manifest.datasetVersion}`);
  }
  requireString(errors, context, manifest.datasetId, 'datasetId');
  requireString(errors, context, manifest.createdAt, 'createdAt');
  requireString(errors, context, manifest.description, 'description');
  if (manifest.colorSpace !== 'srgb') {
    errors.push(`${context}: expected colorSpace srgb, got ${manifest.colorSpace}`);
  }
  if (manifest.targetEncoding !== 'hex_rgb_opaque') {
    errors.push(`${context}: expected targetEncoding hex_rgb_opaque, got ${manifest.targetEncoding}`);
  }
  if (manifest.portionUnit !== 'parts') {
    errors.push(`${context}: expected portionUnit parts, got ${manifest.portionUnit}`);
  }
  if (!Array.isArray(manifest.supportedSourceTypes) || manifest.supportedSourceTypes.length === 0) {
    errors.push(`${context}: supportedSourceTypes must be a non-empty array`);
  }
  if (!Array.isArray(manifest.supportedReviewStatuses) || manifest.supportedReviewStatuses.length === 0) {
    errors.push(`${context}: supportedReviewStatuses must be a non-empty array`);
  }
}

function validateInput(input, errors, context, index) {
  const inputContext = `${context}.inputs[${index}]`;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    errors.push(`${inputContext}: expected object`);
    return;
  }
  requireString(errors, inputContext, input.paintId, 'paintId');
  requireString(errors, inputContext, input.paintLabel, 'paintLabel');
  requireHex(errors, inputContext, input.colorHex, 'colorHex');
  if (!Number.isInteger(input.parts) || input.parts <= 0) {
    errors.push(`${inputContext}: parts must be a positive integer, got ${input.parts}`);
  }
}

function validateSample(sample, manifest, errors, lineNumber, seenIds) {
  const context = `samples.jsonl:${lineNumber}`;
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
    errors.push(`${context}: expected object`);
    return;
  }

  if (requireString(errors, context, sample.id, 'id')) {
    if (!SAMPLE_ID_RE.test(sample.id)) {
      errors.push(`${context}: id must match ${SAMPLE_ID_RE}, got ${sample.id}`);
    }
    if (seenIds.has(sample.id)) {
      errors.push(`${context}: duplicate sample id ${sample.id}`);
    }
    seenIds.add(sample.id);
  }

  requireString(errors, context, sample.sourceType, 'sourceType');
  requireString(errors, context, sample.reviewStatus, 'reviewStatus');
  requireString(errors, context, sample.category, 'category');
  requireString(errors, context, sample.palette, 'palette');
  requireString(errors, context, sample.label, 'label');
  requireHex(errors, context, sample.targetHex, 'targetHex');

  if (!manifest.supportedSourceTypes.includes(sample.sourceType)) {
    errors.push(`${context}: unsupported sourceType ${sample.sourceType}`);
  }
  if (!manifest.supportedReviewStatuses.includes(sample.reviewStatus)) {
    errors.push(`${context}: unsupported reviewStatus ${sample.reviewStatus}`);
  }

  if (!Array.isArray(sample.inputs) || sample.inputs.length === 0) {
    errors.push(`${context}: inputs must be a non-empty array`);
  } else {
    const seenPaintIds = new Set();
    sample.inputs.forEach((input, index) => {
      validateInput(input, errors, context, index);
      if (input && typeof input.paintId === 'string') {
        if (seenPaintIds.has(input.paintId)) {
          errors.push(`${context}: duplicate paintId ${input.paintId} inside one sample`);
        }
        seenPaintIds.add(input.paintId);
      }
    });
  }

  if (!sample.source || typeof sample.source !== 'object' || Array.isArray(sample.source)) {
    errors.push(`${context}: source must be an object`);
  } else {
    requireString(errors, `${context}.source`, sample.source.kind, 'kind');
    requireString(errors, `${context}.source`, sample.source.reference, 'reference');
  }

  if (sample.notes != null && typeof sample.notes !== 'string') {
    errors.push(`${context}: notes must be a string when present`);
  }
}

export function loadGroundTruthDataset(datasetDir) {
  const manifestPath = path.join(datasetDir, 'manifest.json');
  const samplesPath = path.join(datasetDir, 'samples.jsonl');

  if (!existsSync(manifestPath)) {
    throw new Error(`Missing manifest: ${manifestPath}`);
  }
  if (!existsSync(samplesPath)) {
    throw new Error(`Missing samples: ${samplesPath}`);
  }

  const manifest = readJson(manifestPath);
  const samples = readJsonl(samplesPath);
  const errors = [];

  validateManifest(manifest, errors, datasetDir);
  const seenIds = new Set();
  samples.forEach(({ value, lineNumber }) => validateSample(value, manifest, errors, lineNumber, seenIds));

  if (errors.length > 0) {
    throw new Error(`Ground-truth dataset validation failed:\n- ${errors.join('\n- ')}`);
  }

  return {
    datasetDir,
    manifest,
    samples: samples.map(({ value }) => value),
  };
}

export function summarizeGroundTruthSamples(samples) {
  const bySourceType = Object.create(null);
  const byReviewStatus = Object.create(null);
  const byCategory = Object.create(null);

  for (const sample of samples) {
    bySourceType[sample.sourceType] = (bySourceType[sample.sourceType] ?? 0) + 1;
    byReviewStatus[sample.reviewStatus] = (byReviewStatus[sample.reviewStatus] ?? 0) + 1;
    byCategory[sample.category] = (byCategory[sample.category] ?? 0) + 1;
  }

  return {
    totalSamples: samples.length,
    bySourceType,
    byReviewStatus,
    byCategory,
  };
}
