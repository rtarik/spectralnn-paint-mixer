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

const { server, baseUrl } = await startStaticServer({
  rootDir: distDir,
  port: Number(process.env.PORT ?? 4173),
});

console.log(`Previewing SpectralNN Paint Mixer site at ${baseUrl}/`);
console.log(`Technical page: ${baseUrl}/technical/index.html`);
console.log(`QA dataset gallery: ${baseUrl}/qa/dataset-gallery/index.html`);
console.log(`Available runtimes: ${runtimeCatalog.availableRuntimes.map((entry) => entry.label).join(', ')}`);
console.log('Press Ctrl+C to stop.');

const stopServer = () => {
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', stopServer);
process.on('SIGTERM', stopServer);
