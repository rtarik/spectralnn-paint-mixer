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
const runtimeCatalog = await buildSite({ runtimeSelection });

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
  const runtimeCatalogModule = await fetch(`${baseUrl}/lib/runtime-catalog.js`).then((response) => response.text());
  const firstRuntime = runtimeCatalog.availableRuntimes[0];
  const runtimeModule = firstRuntime == null
    ? ''
    : await fetch(`${baseUrl}/${firstRuntime.modulePath.replace(/^\.\//, '')}`).then((response) => response.text());

  assert.match(homepage, /Physical paint mixing with neural residual correction\./);
  assert.match(homepage, /Drop the mixer into JavaScript or Kotlin in a few lines\./);
  assert.match(homepage, /Library repository/);
  assert.match(homepage, /runtime-selector-select/);
  assert.match(technical, /BaseMixEngine runs first/);
  assert.match(runtimeCatalogModule, new RegExp(escapeRegExp(runtimeCatalog.heading)));
  if (firstRuntime != null) {
    assert.match(runtimeCatalogModule, new RegExp(escapeRegExp(firstRuntime.label)));
    assert.match(runtimeModule, /PaintMixers/);
  }

  console.log('Site smoke validation passed.');
} finally {
  await new Promise((resolve) => {
    server.close(resolve);
  });
}
