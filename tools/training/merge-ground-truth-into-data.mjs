#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { resolveDataDir } from '../eval/common.mjs';
import { loadGroundTruthDataset, resolveGroundTruthDir } from '../eval/ground-truth.mjs';

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

function summarise(samples) {
  const bySource = {};
  const byCategory = {};
  for (const sample of samples) {
    bySource[sample.source] = (bySource[sample.source] || 0) + 1;
    byCategory[sample.category] = (byCategory[sample.category] || 0) + 1;
  }
  return { bySource, byCategory, total: samples.length };
}

function trainingKey(sample) {
  return `${sample.palette}/${sample.label}`;
}

function normaliseGroundTruthSample(sample, manifest) {
  return {
    inputs: sample.inputs.map((input) => input.colorHex.toUpperCase()),
    parts: sample.inputs.map((input) => input.parts),
    target: sample.targetHex.toUpperCase(),
    source: 'ground_truth',
    teacher: `ground_truth:${manifest.datasetId}:${sample.sourceType}`,
    category: sample.category,
    palette: sample.palette,
    label: sample.label,
  };
}

function uniquifyGroundTruthLabel(label, suffix) {
  const marker = label.indexOf('@');
  if (marker < 0) {
    return `${label} [${suffix}]`;
  }
  return `${label.slice(0, marker)} [${suffix}]${label.slice(marker)}`;
}

function arrayEquals(left, right) {
  return (
    Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index])
  );
}

function assertMergeCompatible(existing, incoming) {
  if (!arrayEquals(existing.inputs, incoming.inputs) || !arrayEquals(existing.parts, incoming.parts)) {
    throw new Error(
      `Ground-truth sample ${trainingKey(incoming)} does not match existing curated inputs/parts and cannot be merged automatically.`,
    );
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      'data-dir': { type: 'string' },
      'dataset-dir': { type: 'string', multiple: true },
      'review-status': { type: 'string', multiple: true },
    },
  });

  const dataDir = resolveDataDir(values['data-dir']);
  const datasetDirs = (values['dataset-dir']?.length ? values['dataset-dir'] : [undefined])
    .map((datasetDir) => resolveGroundTruthDir(datasetDir));
  const allowedStatuses = new Set((values['review-status']?.length ? values['review-status'] : ['approved']));

  const curatedPath = path.join(dataDir, 'curated.jsonl');
  const manifestPath = path.join(dataDir, 'manifest.json');
  const importPath = path.join(dataDir, 'ground_truth_import.jsonl');
  const mergeManifestPath = path.join(dataDir, 'ground_truth_merge_manifest.json');

  const curatedSamples = readJsonl(curatedPath);
  const manifest = readJson(manifestPath);
  const groundTruthDatasets = datasetDirs.map((datasetDir) => loadGroundTruthDataset(datasetDir));
  const importedTrainingSamples = [];
  const importedIndexByKey = new Map();
  const importedSummary = [];

  for (const groundTruthDataset of groundTruthDatasets) {
    const includedSamples = groundTruthDataset.samples.filter((sample) => allowedStatuses.has(sample.reviewStatus));
    importedSummary.push({
      datasetId: groundTruthDataset.manifest.datasetId,
      datasetDir: groundTruthDataset.datasetDir,
      importedSamples: includedSamples.length,
    });
    for (const sample of includedSamples) {
      let normalised = normaliseGroundTruthSample(sample, groundTruthDataset.manifest);
      let key = trainingKey(normalised);
      const existingImported = importedIndexByKey.get(key);
      if (existingImported != null) {
        assertMergeCompatible(existingImported, normalised);
        if (existingImported.target === normalised.target) {
          continue;
        }
        const uniquenessSuffix = sample.sourceSampleId ?? sample.sourceSampleCode ?? sample.id;
        normalised = {
          ...normalised,
          label: uniquifyGroundTruthLabel(normalised.label, uniquenessSuffix),
        };
        key = trainingKey(normalised);
        if (importedIndexByKey.has(key)) {
          throw new Error(`Unable to disambiguate duplicate ground-truth merge key: ${key}`);
        }
      }
      importedIndexByKey.set(key, normalised);
      importedTrainingSamples.push(normalised);
    }
  }

  const existingIndexByKey = new Map(curatedSamples.map((sample, index) => [trainingKey(sample), index]));

  let replaced = 0;
  let appended = 0;
  for (const [key, incoming] of importedIndexByKey.entries()) {
    const existingIndex = existingIndexByKey.get(key);
    if (existingIndex != null) {
      assertMergeCompatible(curatedSamples[existingIndex], incoming);
      curatedSamples[existingIndex] = incoming;
      replaced += 1;
    } else {
      curatedSamples.push(incoming);
      appended += 1;
    }
  }

  manifest.curated = summarise(curatedSamples);
  manifest.groundTruthMerge = {
    mergedAt: new Date().toISOString(),
    datasetCount: groundTruthDatasets.length,
    datasets: importedSummary,
    includedReviewStatuses: [...allowedStatuses],
    importedSamples: importedTrainingSamples.length,
    replaced,
    appended,
    importFile: 'ground_truth_import.jsonl',
  };

  writeJsonl(curatedPath, curatedSamples);
  writeJsonl(importPath, importedTrainingSamples);
  writeJson(mergeManifestPath, manifest.groundTruthMerge);
  writeJson(manifestPath, manifest);

  console.log(`Merged ${groundTruthDatasets.length} ground-truth dataset(s) into ${curatedPath}`);
  console.log(`Imported ground-truth samples: ${importedTrainingSamples.length}`);
  console.log(`Replaced existing curated samples: ${replaced}`);
  console.log(`Appended new curated samples: ${appended}`);
  console.log(`Wrote import file to ${importPath}`);
  console.log(`Wrote merge manifest to ${mergeManifestPath}`);
  console.log(`Updated manifest at ${manifestPath}`);
}

await main();
