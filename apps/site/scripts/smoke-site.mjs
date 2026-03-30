import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSite } from './build-site.mjs';
import { parseRuntimeSelection } from './runtime-selection.mjs';
import { startStaticServer } from './site-server.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(scriptDir, '..');
const distDir = path.join(siteDir, 'dist');

const runtimeSelection = parseRuntimeSelection();
const runtimeSource = await buildSite({ runtimeSelection });

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const { server, baseUrl } = await startStaticServer({
  rootDir: distDir,
  port: 4174,
});

try {
  const homepage = await fetch(`${baseUrl}/index.html`).then((response) => response.text());
  const technical = await fetch(`${baseUrl}/technical/index.html`).then((response) => response.text());
  const runtimeModule = await fetch(`${baseUrl}/lib/paint-mixer.js`).then((response) => response.text());
  const runtimeSourceModule = await fetch(`${baseUrl}/lib/runtime-source.js`).then((response) => response.text());

  assert.match(homepage, /A paint mixer built on a physical base model plus neural residual correction\./);
  assert.match(homepage, /Drop the mixer into JavaScript or Kotlin in a few lines\./);
  assert.match(homepage, /Library repository/);
  assert.match(homepage, /Live Demo/);
  assert.match(technical, /BaseMixEngine runs first/);
  assert.match(runtimeModule, /export \* from '\.\.\/vendor\/spectralnn-paint-mixer\/index\.js';/);
  assert.match(runtimeSourceModule, new RegExp(escapeRegExp(runtimeSource.label)));
  assert.match(runtimeSourceModule, new RegExp(escapeRegExp(runtimeSource.packageVersion)));

  console.log('Site smoke validation passed.');
} finally {
  await new Promise((resolve) => {
    server.close(resolve);
  });
}
