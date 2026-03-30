import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSite } from './build-site.mjs';
import { readReleasedRuntimes } from './released-runtimes.mjs';
import { resolveRuntimeSelection } from './runtime-selection.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(scriptDir, '..');
const repoDir = path.resolve(siteDir, '..', '..');
const distDir = path.join(siteDir, 'dist');

const { releases, defaultRelease } = await readReleasedRuntimes();
const runtimeEntries = [];

for (const release of releases) {
  const runtimeSource = await resolveRuntimeSelection({
    repoDir,
    siteDir,
    runtimeSelection: {
      kind: 'package',
      label: release.label,
      requestedSpecifier: release.specifier,
    },
  });

  runtimeEntries.push({
    id: release.id,
    kind: runtimeSource.kind,
    label: release.label,
    packageName: runtimeSource.packageName,
    packageVersion: runtimeSource.packageVersion,
    modulePath: `./vendor/runtimes/${release.id}/index.js`,
    source: runtimeSource,
  });
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await buildSite({
  distDirOverride: distDir,
  runtimeCatalogOverride: {
    heading: 'Runtime',
    defaultRuntimeId: defaultRelease.id,
  },
  runtimeEntriesOverride: runtimeEntries,
});
