#!/usr/bin/env node
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

import {
  fmt4,
  makePhysicalMixer,
  portionsFromSample,
  resolveDataDir,
  sampleLabel,
} from './common.mjs';

async function augmentFile({ dataDir, inputFileName, outputFileName, mixer }) {
  const inputPath = path.join(dataDir, inputFileName);
  if (!existsSync(inputPath)) {
    throw new Error(`Missing ${inputPath}. Run the dataset export first.`);
  }

  const outputPath = path.join(dataDir, outputFileName);
  const reader = createInterface({
    input: createReadStream(inputPath, 'utf8'),
    crlfDelay: Infinity,
  });
  const writer = createWriteStream(outputPath, 'utf8');

  let lineCount = 0;
  for await (const line of reader) {
    if (line.trim().length === 0) continue;
    const sample = JSON.parse(line);
    const result = mixer.mixOrNull(portionsFromSample(sample));
    if (result == null) {
      throw new Error(`Failed to mix ${sampleLabel(sample)}`);
    }
    writer.write(`${JSON.stringify({ ...sample, physical: result.toHexString() })}\n`);
    lineCount += 1;
    if (lineCount % 1000 === 0) {
      console.log(`Processed ${lineCount} samples from ${inputFileName}`);
    }
  }

  writer.end();
  await once(writer, 'finish');
  console.log(`Wrote ${lineCount} samples to ${outputPath}`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      'data-dir': { type: 'string' },
    },
  });
  const dataDir = resolveDataDir(values['data-dir']);
  const mixer = makePhysicalMixer();

  console.log(`Using data dir: ${dataDir}`);
  console.log(`Physical baseline mixer ready (learned blend ${fmt4(0)})`);
  await augmentFile({
    dataDir,
    inputFileName: 'curated.jsonl',
    outputFileName: 'curated_with_physical.jsonl',
    mixer,
  });
  await augmentFile({
    dataDir,
    inputFileName: 'synthetic.jsonl',
    outputFileName: 'synthetic_with_physical.jsonl',
    mixer,
  });
}

await main();
