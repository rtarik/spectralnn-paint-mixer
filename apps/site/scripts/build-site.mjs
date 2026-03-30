import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildPackage } from '../../../packages/js/scripts/build-package.mjs';
import {
  buildRuntimeSourceModule,
  parseRuntimeSelection,
  resolveRuntimeSelection,
} from './runtime-selection.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(scriptDir, '..');
const repoDir = path.resolve(siteDir, '..', '..');
const srcDir = path.join(siteDir, 'src');
const distDir = path.join(siteDir, 'dist');
const fixturePath = path.join(repoDir, 'artifacts', 'fixtures', 'baseline-v1', 'curated-parity.json');
const distLibDir = path.join(distDir, 'lib');
const distVendorDir = path.join(distDir, 'vendor', 'spectralnn-paint-mixer');
const distDataDir = path.join(distDir, 'data');

export async function buildSite({ runtimeSelection = parseRuntimeSelection() } = {}) {
  const runtimeSource = await resolveRuntimeSelection({
    repoDir,
    siteDir,
    runtimeSelection,
  });

  if (runtimeSource.kind === 'local') {
    await buildPackage();
  }

  await rm(distDir, { recursive: true, force: true });
  await cp(srcDir, distDir, { recursive: true });
  await mkdir(distLibDir, { recursive: true });
  await mkdir(distVendorDir, { recursive: true });
  await mkdir(distDataDir, { recursive: true });
  await cp(runtimeSource.distDir, distVendorDir, { recursive: true });
  await cp(fixturePath, path.join(distDataDir, 'curated-parity.json'));

  await writeFile(
    path.join(distLibDir, 'paint-mixer.js'),
    "export * from '../vendor/spectralnn-paint-mixer/index.js';\n",
    'utf8',
  );
  await writeFile(path.join(distLibDir, 'runtime-source.js'), buildRuntimeSourceModule(runtimeSource), 'utf8');

  await writeFile(path.join(distDir, '.nojekyll'), '', 'utf8');
  return runtimeSource;
}

const isDirectExecution =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  const runtimeSource = await buildSite({
    runtimeSelection: parseRuntimeSelection(),
  });
  console.log(
    `Built site against ${runtimeSource.label} (${runtimeSource.packageName}@${runtimeSource.packageVersion}).`,
  );
}
