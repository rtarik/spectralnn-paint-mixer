import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  MixPortion,
  PaintMixers,
  SrgbColor,
  createRuntimeModelArtifact,
  defaultModelArtifact,
} from '../../packages/js/src/index.js';

export const KEY_MIXES = [
  'primary/red+blue',
  'extra/pureRed+pureBlue',
  'extra/pureYellow+pureMagenta',
  'primary/yellow+blue',
  'primary/yellow+blue@1:2',
  'primary/blue+white',
  'primary/blue+black@1:2',
  'modern/cyan+magenta',
  'oils/crimson+phthaloBlue',
  'oils/crimson+prussianBlue',
  'oils/yellow+phthaloBlue',
  'industrial/yellow+anthracite',
];

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const workspaceRoot = path.dirname(repoRoot);

function firstExisting(paths) {
  for (const candidate of paths) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return paths[0];
}

export function resolveDataDir(explicit) {
  if (explicit) {
    return path.resolve(explicit);
  }
  return firstExisting([
    path.join(repoRoot, 'tools/training/out/data'),
    path.join(workspaceRoot, 'tools/ml-training/out/data'),
  ]);
}

export function resolveOutputPath(explicit, fallbackRelative) {
  return path.resolve(explicit ?? path.join(repoRoot, fallbackRelative));
}

export function loadArtifactSelection(artifactJsonPath) {
  if (!artifactJsonPath) {
    return {
      artifact: defaultModelArtifact,
      label: `${defaultModelArtifact.modelId} (bundled)`,
    };
  }

  const resolvedPath = path.resolve(artifactJsonPath);
  return {
    artifact: createRuntimeModelArtifact(JSON.parse(readFileSync(resolvedPath, 'utf8'))),
    label: resolvedPath,
  };
}

export function ensureParentDir(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

export function loadJsonlSamples(filePath) {
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

export function findCuratedFile(dataDir) {
  const preferred = path.join(dataDir, 'curated_with_physical.jsonl');
  if (existsSync(preferred)) return preferred;

  const fallback = path.join(dataDir, 'curated.jsonl');
  if (existsSync(fallback)) return fallback;

  throw new Error(
    `Could not find curated_with_physical.jsonl or curated.jsonl in ${dataDir}. Run the dataset export first.`,
  );
}

export function sampleLabel(sample) {
  if (sample.palette && sample.label) {
    return `${sample.palette}/${sample.label}`;
  }
  return sample.id ?? 'UNKNOWN';
}

export function portionsFromSample(sample) {
  return sample.inputs.map((input, index) => {
    if (typeof input === 'string') {
      return new MixPortion({
        color: SrgbColor.fromHex(input),
        parts: sample.parts[index],
      });
    }

    return new MixPortion({
      color: SrgbColor.fromHex(input.colorHex),
      parts: input.parts,
    });
  });
}

export function makeArtifactWithBlend(blend, artifact = defaultModelArtifact) {
  const cloned = structuredClone(artifact);
  cloned.mixingParameters.learnedMixerBlend = blend;
  return cloned;
}

export function makePhysicalMixer(artifact = defaultModelArtifact) {
  return PaintMixers.pipeline({
    baseEngine: PaintMixers.spectralBase({ artifact: makeArtifactWithBlend(0, artifact) }),
    correctionModel: null,
  });
}

export function makeLearnedOnlyMixer(artifact = defaultModelArtifact) {
  const fullBlendArtifact = makeArtifactWithBlend(1, artifact);
  return PaintMixers.pipeline({
    baseEngine: PaintMixers.spectralBase({ artifact: fullBlendArtifact }),
    correctionModel: PaintMixers.learnedResidual({ artifact: fullBlendArtifact }),
  });
}

export function makeActiveMixer(artifact = defaultModelArtifact) {
  if (artifact === defaultModelArtifact) {
    return PaintMixers.default();
  }
  return PaintMixers.pipeline({
    baseEngine: PaintMixers.spectralBase({ artifact }),
    correctionModel: PaintMixers.learnedResidual({ artifact }),
  });
}

export function fmt4(value) {
  return Number(value).toFixed(4);
}

function srgbToLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function srgbToLab(color) {
  const r = srgbToLinear(color.red);
  const g = srgbToLinear(color.green);
  const b = srgbToLinear(color.blue);

  const x = 0.4123907992659593 * r + 0.3575843393838777 * g + 0.1804807884018343 * b;
  const y = 0.21263900587151033 * r + 0.7151686787677553 * g + 0.07219231536073373 * b;
  const z = 0.019330818715591832 * r + 0.11919477979462595 * g + 0.9505321522496605 * b;

  function labF(value) {
    return value > 0.008856 ? value ** (1 / 3) : 7.787 * value + 16 / 116;
  }

  const fx = labF(x / 0.95047);
  const fy = labF(y / 1.0);
  const fz = labF(z / 1.08883);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export function deltaE76(first, second) {
  const firstLab = srgbToLab(first);
  const secondLab = srgbToLab(second);
  const dl = firstLab.l - secondLab.l;
  const da = firstLab.a - secondLab.a;
  const db = firstLab.b - secondLab.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

export function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return 0;
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const index = Math.round((sortedValues.length - 1) * clamped);
  return sortedValues[index];
}

export function metricsOf(scoredRows) {
  const deltas = scoredRows.map((row) => row.deltaE).sort((left, right) => left - right);
  const worst = scoredRows.reduce(
    (currentWorst, row) => (currentWorst == null || row.deltaE > currentWorst.deltaE ? row : currentWorst),
    null,
  );
  return {
    mean: deltas.length === 0
      ? 0
      : deltas.reduce((sum, value) => sum + value, 0) / deltas.length,
    p95: percentile(deltas, 0.95),
    max: deltas.at(-1) ?? 0,
    worstLabel: worst ? sampleLabel(worst.sample) : 'NONE',
  };
}

export function scoreDataset(samples, mixer) {
  return samples.map((sample) => {
    const predicted = mixer.mixOrNull(portionsFromSample(sample));
    if (predicted == null) {
      throw new Error(`Failed to mix ${sampleLabel(sample)}`);
    }
    const targetHex = sample.target ?? sample.targetHex;
    if (typeof targetHex !== 'string') {
      throw new Error(`Sample ${sampleLabel(sample)} is missing a target hex`);
    }
    return {
      deltaE: deltaE76(predicted, SrgbColor.fromHex(targetHex)),
      predicted,
      sample,
    };
  });
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function cdata(value) {
  return String(value).replaceAll(']]>', ']]]]><![CDATA[>');
}

export function writeTextFile(filePath, text) {
  ensureParentDir(filePath);
  writeFileSync(filePath, `${text.endsWith('\n') ? text : `${text}\n`}`, 'utf8');
}

export function writeCompareXml({
  filePath,
  durationSeconds,
  metricsByMode,
  reportText,
  suiteName = 'spectralnn.paintmixer.eval.ModelComparison',
  className = 'spectralnn.paintmixer.eval.ModelComparison',
  caseName = 'compare',
  extraProperties = {},
}) {
  const timestamp = new Date().toISOString();
  const properties = [];
  for (const [modeName, metrics] of Object.entries(metricsByMode)) {
    properties.push(
      `    <property name="${escapeXml(`${modeName}.meanDeltaE`)}" value="${escapeXml(fmt4(metrics.mean))}"/>`,
      `    <property name="${escapeXml(`${modeName}.p95DeltaE`)}" value="${escapeXml(fmt4(metrics.p95))}"/>`,
      `    <property name="${escapeXml(`${modeName}.maxDeltaE`)}" value="${escapeXml(fmt4(metrics.max))}"/>`,
      `    <property name="${escapeXml(`${modeName}.worstLabel`)}" value="${escapeXml(metrics.worstLabel)}"/>`,
    );
  }
  for (const [key, value] of Object.entries(extraProperties)) {
    if (value == null) {
      continue;
    }
    properties.push(`    <property name="${escapeXml(key)}" value="${escapeXml(value)}"/>`);
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="${escapeXml(suiteName)}" tests="1" skipped="0" failures="0" errors="0" timestamp="${escapeXml(timestamp)}" time="${escapeXml(durationSeconds.toFixed(3))}">`,
    '  <properties>',
    ...properties,
    '  </properties>',
    `  <testcase name="${escapeXml(caseName)}" classname="${escapeXml(className)}" time="${escapeXml(durationSeconds.toFixed(3))}">`,
    `    <system-out><![CDATA[${cdata(reportText)}]]></system-out>`,
    '  </testcase>',
    '</testsuite>',
    '',
  ].join('\n');

  writeTextFile(filePath, xml);
}
