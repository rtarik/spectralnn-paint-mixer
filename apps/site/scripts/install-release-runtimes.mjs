import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { installSpecForRelease, readReleasedRuntimes } from './released-runtimes.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, '..', '..', '..');
const { releases, siteDir } = await readReleasedRuntimes();
const installSpecs = releases.map(installSpecForRelease);

await new Promise((resolve, reject) => {
  const child = spawn('npm', ['install', '--no-save', ...installSpecs], {
    cwd: siteDir,
    env: {
      ...process.env,
      npm_config_cache: process.env.npm_config_cache ?? path.join(repoDir, '.npm-cache'),
    },
    stdio: 'inherit',
  });

  child.on('error', reject);
  child.on('exit', (code) => {
    if (code === 0) {
      resolve();
      return;
    }
    reject(new Error(`npm install exited with code ${code ?? 'unknown'}.`));
  });
});
