import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(scriptDir, '..');
const releasedRuntimesPath = path.join(siteDir, 'released-runtimes.json');

export async function readReleasedRuntimes() {
  const catalog = JSON.parse(await readFile(releasedRuntimesPath, 'utf8'));
  const releases = Array.isArray(catalog.releases) ? catalog.releases : [];
  if (releases.length === 0) {
    throw new Error('apps/site/released-runtimes.json must define at least one released runtime.');
  }

  const defaultReleaseId = catalog.defaultReleaseId ?? releases[0].id;
  const defaultRelease = releases.find((release) => release.id === defaultReleaseId);
  if (defaultRelease == null) {
    throw new Error(`Default release "${defaultReleaseId}" is not present in apps/site/released-runtimes.json.`);
  }

  return {
    defaultReleaseId,
    defaultRelease,
    releases,
    siteDir,
    releasedRuntimesPath,
  };
}

export function installSpecForRelease(release) {
  return `${release.specifier}@npm:${release.packageName}@${release.version}`;
}
