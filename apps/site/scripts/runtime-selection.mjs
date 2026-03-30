import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const LOCAL_RUNTIME_LABEL = 'workspace-local';

function normalizeRuntimeArg(value) {
  return value == null || value === '' ? null : value;
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export function parseRuntimeSelection(argv = process.argv.slice(2), env = process.env) {
  let runtime = normalizeRuntimeArg(env.SPECTRALNN_SITE_RUNTIME) ?? 'local';
  let requestedSpecifier = normalizeRuntimeArg(env.SPECTRALNN_SITE_RUNTIME_PACKAGE);
  let label = normalizeRuntimeArg(env.SPECTRALNN_SITE_RUNTIME_LABEL);

  for (const arg of argv) {
    if (arg.startsWith('--runtime=')) {
      runtime = normalizeRuntimeArg(arg.slice('--runtime='.length)) ?? 'local';
    } else if (arg.startsWith('--runtime-package=')) {
      runtime = 'package';
      requestedSpecifier = normalizeRuntimeArg(arg.slice('--runtime-package='.length));
    } else if (arg.startsWith('--runtime-label=')) {
      label = normalizeRuntimeArg(arg.slice('--runtime-label='.length));
    } else {
      throw new Error(`Unknown site runtime option: ${arg}`);
    }
  }

  if (runtime === 'local') {
    return {
      kind: 'local',
      label: label ?? LOCAL_RUNTIME_LABEL,
      requestedSpecifier: null,
    };
  }

  const packageSpecifier = runtime === 'package' ? requestedSpecifier : runtime;
  if (packageSpecifier == null) {
    throw new Error(
      'A package-backed site build requires --runtime-package=<package-name> or --runtime=<package-name>.',
    );
  }

  return {
    kind: 'package',
    label: label ?? packageSpecifier,
    requestedSpecifier: packageSpecifier,
  };
}

export async function resolveRuntimeSelection({ repoDir, siteDir, runtimeSelection }) {
  if (runtimeSelection.kind === 'local') {
    const packageDir = path.join(repoDir, 'packages', 'js');
    const packageInfo = await readJsonFile(path.join(packageDir, 'package.json'));

    return {
      kind: 'local',
      label: runtimeSelection.label,
      requestedSpecifier: null,
      packageName: packageInfo.name,
      packageVersion: packageInfo.version,
      packageDir,
      distDir: path.join(packageDir, 'dist'),
    };
  }

  const requireFromSite = createRequire(path.join(siteDir, 'package.json'));
  let entryFile;
  try {
    entryFile = requireFromSite.resolve(runtimeSelection.requestedSpecifier);
  } catch {
    throw new Error(
      [
        `Unable to resolve the site runtime package "${runtimeSelection.requestedSpecifier}" from apps/site.`,
        'Install it in apps/site first, for example:',
        '  npm install @rtarik/spectralnn-paint-mixer@alpha',
        'Or install an alias for side-by-side version checks, for example:',
        '  npm install spectralnn-paint-mixer-alpha-1@npm:@rtarik/spectralnn-paint-mixer@0.1.0-alpha.1',
      ].join('\n'),
    );
  }

  const distDir = path.dirname(entryFile);
  const packageDir = path.resolve(distDir, '..');
  const packageInfo = await readJsonFile(path.join(packageDir, 'package.json'));

  return {
    kind: 'package',
    label: runtimeSelection.label,
    requestedSpecifier: runtimeSelection.requestedSpecifier,
    packageName: packageInfo.name,
    packageVersion: packageInfo.version,
    packageDir,
    distDir,
  };
}

export function buildRuntimeSourceModule(runtimeSource) {
  return [
    `const runtimeSource = ${JSON.stringify(
      {
        kind: runtimeSource.kind,
        label: runtimeSource.label,
        requestedSpecifier: runtimeSource.requestedSpecifier,
        packageName: runtimeSource.packageName,
        packageVersion: runtimeSource.packageVersion,
      },
      null,
      2,
    )};`,
    '',
    'export default runtimeSource;',
    '',
  ].join('\n');
}
