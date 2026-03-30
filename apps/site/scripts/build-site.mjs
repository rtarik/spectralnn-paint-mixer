import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildPackage } from '../../../packages/js/scripts/build-package.mjs';
import {
  buildRuntimeCatalogModule,
  parseRuntimeSelection,
  resolveRuntimeSelection,
} from './runtime-selection.mjs';
import { readReleasedRuntimes } from './released-runtimes.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(scriptDir, '..');
const repoDir = path.resolve(siteDir, '..', '..');
const srcDir = path.join(siteDir, 'src');
const distDir = path.join(siteDir, 'dist');
const fixturePath = path.join(repoDir, 'artifacts', 'fixtures', 'baseline-v1', 'curated-parity.json');
const generatedLibSourcePaths = new Set([
  path.join(srcDir, 'lib', 'paint-mixer.js'),
  path.join(srcDir, 'lib', 'runtime-catalog.js'),
  path.join(srcDir, 'lib', 'runtime-source.js'),
]);

function modulePathForRuntime(runtimeId) {
  return `./vendor/runtimes/${runtimeId}/index.js`;
}

function buildRuntimeEntry({ id, source, label }) {
  return {
    id,
    kind: source.kind,
    label,
    packageName: source.packageName,
    packageVersion: source.packageVersion,
    modulePath: modulePathForRuntime(id),
    source,
  };
}

function upsertRuntimeEntry(entries, entry) {
  const index = entries.findIndex((candidate) => candidate.id === entry.id);
  if (index === -1) {
    entries.push(entry);
  } else {
    entries[index] = entry;
  }
}

async function tryResolveRuntime(siteSelection) {
  try {
    return await resolveRuntimeSelection({
      repoDir,
      siteDir,
      runtimeSelection: siteSelection,
    });
  } catch {
    return null;
  }
}

async function buildLocalRuntimeEntries(defaultRuntimeSelection) {
  const entries = [];
  let defaultRuntimeId = 'workspace-local';
  const localSource = await resolveRuntimeSelection({
    repoDir,
    siteDir,
    runtimeSelection: {
      kind: 'local',
      label: 'workspace-local',
      requestedSpecifier: null,
    },
  });
  upsertRuntimeEntry(entries, buildRuntimeEntry({
    id: 'workspace-local',
    label: 'workspace-local',
    source: localSource,
  }));

  const { releases } = await readReleasedRuntimes();
  for (const release of releases) {
    const releaseSource = await tryResolveRuntime({
      kind: 'package',
      label: release.label,
      requestedSpecifier: release.specifier,
    });
    if (releaseSource == null) continue;

    upsertRuntimeEntry(entries, buildRuntimeEntry({
      id: release.id,
      label: release.label,
      source: releaseSource,
    }));
  }

  if (defaultRuntimeSelection.kind === 'package') {
    const selectedSource = await tryResolveRuntime(defaultRuntimeSelection);
    if (selectedSource != null) {
      const matchingRelease = releases.find((release) => release.specifier === defaultRuntimeSelection.requestedSpecifier);
      defaultRuntimeId = matchingRelease?.id ?? 'selected-runtime';
      upsertRuntimeEntry(entries, buildRuntimeEntry({
        id: defaultRuntimeId,
        label: defaultRuntimeSelection.label ?? matchingRelease?.label ?? 'selected-runtime',
        source: selectedSource,
      }));
    }
  }

  return {
    defaultRuntimeId,
    availableRuntimes: entries,
    heading: 'Runtime',
  };
}

async function writeRuntimeAssets({ activeDistDir, runtimeEntries }) {
  const runtimeRootDir = path.join(activeDistDir, 'vendor', 'runtimes');
  await mkdir(runtimeRootDir, { recursive: true });

  for (const entry of runtimeEntries) {
    const runtimeVendorDir = path.join(runtimeRootDir, entry.id);
    await mkdir(runtimeVendorDir, { recursive: true });
    await cp(entry.source.distDir, runtimeVendorDir, { recursive: true });
  }
}

export async function buildSite({
  runtimeSelection = parseRuntimeSelection(),
  distDirOverride = distDir,
  runtimeCatalogOverride = null,
  runtimeEntriesOverride = null,
} = {}) {
  const activeDistDir = distDirOverride;
  const distLibDir = path.join(activeDistDir, 'lib');
  const distDataDir = path.join(activeDistDir, 'data');
  const runtimeCatalog = runtimeCatalogOverride ?? await buildLocalRuntimeEntries(runtimeSelection);
  const runtimeEntries = runtimeEntriesOverride ?? runtimeCatalog.availableRuntimes;

  if (runtimeEntries.some((entry) => entry.source.kind === 'local')) {
    await buildPackage();
  }

  await rm(activeDistDir, { recursive: true, force: true });
  await cp(srcDir, activeDistDir, {
    recursive: true,
    filter: (sourcePath) => !generatedLibSourcePaths.has(sourcePath),
  });
  await mkdir(distLibDir, { recursive: true });
  await mkdir(distDataDir, { recursive: true });
  await writeRuntimeAssets({ activeDistDir, runtimeEntries });
  await cp(fixturePath, path.join(distDataDir, 'curated-parity.json'));
  await writeFile(
    path.join(distLibDir, 'runtime-catalog.js'),
    buildRuntimeCatalogModule({
      heading: runtimeCatalog.heading,
      defaultRuntimeId: runtimeCatalog.defaultRuntimeId,
      availableRuntimes: runtimeEntries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        label: entry.label,
        packageName: entry.packageName,
        packageVersion: entry.packageVersion,
        modulePath: entry.modulePath,
      })),
    }),
    'utf8',
  );

  await writeFile(path.join(activeDistDir, '.nojekyll'), '', 'utf8');
  return runtimeCatalog;
}

const isDirectExecution =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  const runtimeCatalog = await buildSite({
    runtimeSelection: parseRuntimeSelection(),
  });
  console.log(
    `Built site with ${runtimeCatalog.availableRuntimes.length} runtime variant(s).`,
  );
}
