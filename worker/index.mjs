// The one Worker behind everything: pages, /api/... and the daily refresh.

import { handleRefresh, handleReport, json } from './lib/report.mjs';
import { runDailyRefresh } from './lib/refresh.mjs';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function withSecurityHeaders(response) {
  const res = new Response(response.body, response);
  res.headers.set('x-content-type-options', 'nosniff');
  res.headers.set('referrer-policy', 'no-referrer');
  res.headers.set('x-robots-tag', 'noindex, nofollow');
  if ((res.headers.get('content-type') || '').includes('text/html')) res.headers.set('content-security-policy', CSP);
  return res;
}

async function serveAsset(env, request, path) {
  const url = new URL(request.url);
  url.pathname = path;
  return env.ASSETS.fetch(new Request(url, { method: 'GET', headers: request.headers }));
}

async function route(request, env, ctx, deps) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/report') return request.method === 'GET' ? handleReport(request, env, ctx, deps) : json({ error: 'Not allowed.' }, 405);
  if (path === '/api/refresh') return handleRefresh(request, env, ctx, deps);
  if (path.startsWith('/api/')) return json({ error: 'Not found.' }, 404);

  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Not allowed', { status: 405 });

  if (path === '/' || path === '/index.html') return serveAsset(env, request, '/index.html');

  // Files with an extension, and the css/js folders, are real files.
  if (/\.[a-z0-9]+$/i.test(path) || path.startsWith('/css/') || path.startsWith('/js/')) {
    const res = await serveAsset(env, request, path);
    if (res.status !== 404) return res;
    return new Response('Not found', { status: 404 });
  }

  // /pure-meal-prep-sd-k7m2q9 : any single word-like path is a client report link.
  // The page itself asks the API whether the link is valid.
  if (/^\/[a-z0-9-]{3,80}\/?$/i.test(path)) return serveAsset(env, request, '/report.html');

  return serveAsset(env, request, '/404.html').then((r) => new Response(r.body, { status: 404, headers: r.headers }));
}

export default {
  // The fourth argument is only used by the tests, to stand in for Google and the client list.
  async fetch(request, env, ctx, deps = {}) {
    try {
      return withSecurityHeaders(await route(request, env, ctx, deps));
    } catch (e) {
      console.error('Unhandled error', e);
      return withSecurityHeaders(json({ error: 'Something went wrong. Try again in a minute.' }, 500));
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runDailyRefresh(env).then((r) => console.log('Daily refresh', JSON.stringify(r))).catch((e) => console.error('Daily refresh failed', e)),
    );
  },
};
