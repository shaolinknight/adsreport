// Local preview with sample data:  npm run dev   then open http://localhost:8787
// It runs the same Worker code as the live site, with a pretend file store.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';
import worker from '../worker/index.mjs';
import clients from '../clients.json' with { type: 'json' };

const dist = await build();
const port = Number(process.env.PORT || 8787);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const memory = new Map();
const env = {
  ASSETS: {
    async fetch(request) {
      const path = decodeURIComponent(new URL(request.url).pathname);
      const file = resolve(join(dist, path));
      if (!file.startsWith(dist)) return new Response('Not found', { status: 404 });
      try {
        return new Response(await readFile(file), { headers: { 'content-type': TYPES[extname(file)] || 'application/octet-stream' } });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    },
  },
  REPORTS: {
    async get(key, type) {
      const v = memory.get(key);
      return v == null ? null : type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      memory.set(key, value);
    },
    async delete(key) {
      memory.delete(key);
    },
  },
  ...process.env,
};

createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length && !['GET', 'HEAD'].includes(req.method) ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body });
    const response = await worker.fetch(request, env, { waitUntil() {} });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
}).listen(port, () => {
  console.log(`Preview running at http://localhost:${port}`);
  for (const c of clients) console.log(`  ${c.name}: http://localhost:${port}/${c.linkKey}`);
});
