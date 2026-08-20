// Controllable static file server for the service-worker lifecycle E2E gate.
//
// It serves a production `dist` build from a root directory that can be swapped
// at runtime (OLD build -> NEW build) via a control endpoint, so the same
// origin/port serves two different service-worker precache manifests. This lets
// the browser's native SW update mechanism detect a new `sw.js` and park it in
// the `waiting` state — exactly the production deploy scenario.
//
// Usage (from the Playwright spec, same Node process):
//   import { startSwServer } from './sw-lifecycle-server.mjs';
//   const srv = await startSwServer(5175, '/abs/path/old', '/abs/path/new');
//   srv.setBuild('new');           // swap served build
//   await srv.close();
//
// Control endpoint: POST /__e2e/switch?build=old|new  -> 204
// Health:          GET  /__e2e/build                  -> { build: 'old'|'new' }

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export async function startSwServer(port, oldRoot, newRoot) {
  let current = 'old';
  const roots = { old: oldRoot, new: newRoot };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${port}`);
      const pathname = decodeURIComponent(url.pathname);

      // --- control endpoints (not part of the app) ---
      if (pathname === '/__e2e/switch') {
        const build = url.searchParams.get('build');
        if (build === 'old' || build === 'new') {
          current = build;
          res.writeHead(204).end();
        } else {
          res.writeHead(400, { 'content-type': 'text/plain' }).end('bad build');
        }
        return;
      }
      if (pathname === '/__e2e/build') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ build: current }));
        return;
      }

      const root = roots[current];
      // Resolve safely inside the root (prevent path traversal).
      const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
      let filePath = join(root, safePath);

      let info;
      try {
        info = await stat(filePath);
      } catch {
        info = null;
      }

      // SPA fallback: unknown, non-file routes serve index.html so client-side
      // routing works after the safe reload.
      if ((!info || !info.isFile()) && pathname !== '/sw.js') {
        filePath = join(root, 'index.html');
      }

      let data;
      try {
        data = await readFile(filePath);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }

      const ext = extname(filePath).toLowerCase();
      const headers = { 'content-type': MIME[ext] || 'application/octet-stream' };

      if (pathname === '/sw.js') {
        // Never cache the SW script so update checks always fetch fresh content.
        headers['cache-control'] = 'no-cache, no-store, must-revalidate';
        headers['service-worker-allowed'] = '/';
        headers['pragma'] = 'no-cache';
      } else if (ext === '.html') {
        headers['cache-control'] = 'no-cache';
      } else {
        // App assets are content-hashed; safe to cache aggressively.
        headers['cache-control'] = 'public, max-age=31536000, immutable';
      }

      res.writeHead(200, headers).end(data);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(String(err));
    }
  });

  await new Promise((resolve) => server.listen(port, resolve));

  return {
    port,
    getBuild: () => current,
    setBuild: (b) => {
      if (b !== 'old' && b !== 'new') throw new Error(`invalid build ${b}`);
      current = b;
    },
    close: () =>
      new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
