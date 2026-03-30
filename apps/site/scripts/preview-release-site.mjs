import path from 'node:path';
import { fileURLToPath } from 'node:url';

import './build-release-site.mjs';
import { startStaticServer } from './site-server.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(scriptDir, '..');
const distDir = path.join(siteDir, 'dist');

const { server, baseUrl } = await startStaticServer({
  rootDir: distDir,
  port: Number(process.env.PORT ?? 4175),
});

console.log(`Previewing released-runtime site at ${baseUrl}/`);
console.log(`Technical page: ${baseUrl}/technical/index.html`);
console.log('Press Ctrl+C to stop.');

const stopServer = () => {
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', stopServer);
process.on('SIGTERM', stopServer);
