import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
};

function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
}

function resolveRequestPath(rootDir, requestUrl) {
  const url = new URL(requestUrl, 'http://127.0.0.1');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) {
    pathname = `${pathname}index.html`;
  }
  if (pathname === '') {
    pathname = '/index.html';
  }
  const resolvedPath = path.resolve(rootDir, `.${pathname}`);
  if (!resolvedPath.startsWith(rootDir)) {
    return null;
  }
  return resolvedPath;
}

export function startStaticServer({ rootDir, port = 4173, host = '127.0.0.1' }) {
  const server = createServer(async (request, response) => {
    const filePath = resolveRequestPath(rootDir, request.url ?? '/');
    if (filePath == null) {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Invalid path');
      return;
    }

    try {
      const body = await readFile(filePath);
      response.writeHead(200, { 'content-type': contentTypeFor(filePath) });
      response.end(body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address != null ? address.port : port;
      resolve({
        server,
        baseUrl: `http://${host}:${actualPort}`,
      });
    });
  });
}
