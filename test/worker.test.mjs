// The Worker end to end, with a pretend file store, pretend page files and a pretend Google.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import clients from '../clients.json' with { type: 'json' };
import { runDailyRefresh } from '../worker/lib/refresh.mjs';
import { DATA_VERSION } from '../src/lib/calc.mjs';
import { ENV, REAL_CLIENT, fakeGoogle, fakeKV } from './helpers.mjs';
import { resetTokenCache } from '../worker/lib/ads.mjs';

const assets = {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const files = { '/index.html': '<h1>index</h1>', '/report.html': '<h1>report</h1>', '/404.html': '<h1>nope</h1>', '/css/app.css': 'body{}', '/js/report.js': 'x', '/lib/calc.mjs': 'y', '/robots.txt': 'User-agent: *' };
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.txt': 'text/plain' };
    if (!(path in files)) return new Response('missing', { status: 404 });
    return new Response(files[path], { headers: { 'content-type': types[path.slice(path.lastIndexOf('.'))] } });
  },
};

const NOW = new Date('2026-11-09T19:00:00Z');
const get = (path, env = { ASSETS: assets }, deps = {}) => worker.fetch(new Request(`https://reports.example.com${path}`), env, { waitUntil() {} }, deps);
const [pmp, gb] = clients;

test.beforeEach(() => resetTokenCache());

test('a valid link returns that client\'s report, marked as sample data until Google Ads is connected', async () => {
  const res = await get(`/api/report?c=${pmp.linkKey}&range=30`);
  assert.equal(res.status, 200);
  const { payload } = await res.json();
  assert.equal(payload.demo, true);
  assert.equal(payload.client.name, 'Pure Meal Prep SD');
  assert.equal(payload.range.days, 30);
});

test('one client never sees another client\'s data', async () => {
  const a = await (await get(`/api/report?c=${pmp.linkKey}`)).json();
  const b = await (await get(`/api/report?c=${gb.linkKey}`)).json();
  const text = JSON.stringify(a);
  assert.ok(!/Greenbacks|Bookkeeping/.test(text));
  assert.ok(!/Meal Prep|Pure Meal/.test(JSON.stringify(b)));
  // the API takes the secret link key, never a plain client id
  const byId = await get(`/api/report?c=${pmp.id}`);
  assert.equal(byId.status, 404);
});

test('a wrong link and a switched-off client look exactly the same', async () => {
  const wrong = await get('/api/report?c=nope');
  const off = await worker.fetch(new Request(`https://x.example/api/report?c=${REAL_CLIENT.linkKey}`), { ASSETS: assets }, { waitUntil() {} }, { clients: [{ ...REAL_CLIENT, active: false }] });
  assert.equal(wrong.status, 404);
  assert.equal(off.status, 404);
  assert.deepEqual(await wrong.json(), await off.json());
  assert.equal((await get('/api/report')).status, 404);
});

test('bad dates get a 400 with a plain message', async () => {
  const res = await get(`/api/report?c=${pmp.linkKey}&range=custom&start=2026-10-20&end=2026-10-01`);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /before the end date/);
});

test('pages: home, report links, files and unknown paths', async () => {
  assert.match(await (await get('/')).text(), /index/);
  assert.match(await (await get(`/${pmp.linkKey}`)).text(), /report/);
  assert.equal((await get('/css/app.css')).status, 200);
  assert.equal((await get('/lib/calc.mjs')).status, 200);
  assert.equal((await get('/js/missing.js')).status, 404);
  const unknown = await get('/a/b/c');
  assert.equal(unknown.status, 404);
  assert.equal((await get('/api/unknown')).status, 404);
  const post = await worker.fetch(new Request('https://x.example/api/report', { method: 'POST' }), { ASSETS: assets }, { waitUntil() {} });
  assert.equal(post.status, 405);
});

test('every response keeps search engines out and hides the link from other sites', async () => {
  const res = await get(`/${pmp.linkKey}`);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  const api = await get(`/api/report?c=${pmp.linkKey}`);
  assert.equal(api.headers.get('cache-control'), 'no-store');
});

// ---- live data (pretend Google) ----

function liveEnv(kv) {
  return { ...ENV, ASSETS: assets, REPORTS: kv };
}

test('live: the first request builds the report and saves it; the next one is served from the saved copy', async () => {
  const kv = fakeKV();
  const g = fakeGoogle();
  const deps = { clients: [REAL_CLIENT], fetchImpl: g.fetchImpl, now: NOW, retryDelayMs: 1 };
  const url = `/api/report?c=${REAL_CLIENT.linkKey}&range=30`;
  const first = await (await get(url, liveEnv(kv), deps)).json();
  assert.equal(first.payload.demo, false);
  assert.equal(kv.data.size, 1);
  const key = [...kv.data.keys()][0];
  assert.equal(key, `report:v${DATA_VERSION}:acme:30`);
  const callsAfterFirst = g.calls.length;
  const second = await (await get(url, liveEnv(kv), deps)).json();
  assert.equal(g.calls.length, callsAfterFirst); // nothing new was asked of Google
  assert.equal(second.stale, false);
});

test('live: a copy older than a day is shown at once and refreshed in the background', async () => {
  const kv = fakeKV();
  const g = fakeGoogle();
  const deps = { clients: [REAL_CLIENT], fetchImpl: g.fetchImpl, now: NOW, retryDelayMs: 1 };
  const url = `/api/report?c=${REAL_CLIENT.linkKey}&range=30`;
  await get(url, liveEnv(kv), deps);
  const key = [...kv.data.keys()][0];
  const saved = JSON.parse(kv.data.get(key));
  saved.savedAt = '2026-11-07T00:00:00Z'; // two days old
  kv.data.set(key, JSON.stringify(saved));

  const pending = [];
  const before = g.calls.length;
  const res = await worker.fetch(new Request(`https://x.example${url}`), liveEnv(kv), { waitUntil: (p) => pending.push(p) }, deps);
  const body = await res.json();
  assert.equal(body.stale, true);
  assert.equal(body.payload.client.name, 'Acme'); // old copy came back straight away
  assert.equal(pending.length, 1); // and a refresh was queued
  await Promise.all(pending);
  assert.ok(g.calls.length > before);
});

test('live: saved copies from an older data version are ignored and rebuilt', async () => {
  const kv = fakeKV();
  const g = fakeGoogle();
  const deps = { clients: [REAL_CLIENT], fetchImpl: g.fetchImpl, now: NOW, retryDelayMs: 1 };
  kv.data.set(`report:v${DATA_VERSION}:acme:30`, JSON.stringify({ savedAt: NOW.toISOString(), payload: { version: DATA_VERSION - 1 } }));
  const body = await (await get(`/api/report?c=${REAL_CLIENT.linkKey}&range=30`, liveEnv(kv), deps)).json();
  assert.equal(body.payload.version, DATA_VERSION);
  assert.equal(body.payload.client.name, 'Acme');
});

test('live: a Google problem is explained in plain words', async () => {
  const kv = fakeKV();
  const fetchImpl = async (url) => {
    if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    return new Response(JSON.stringify({ error: { details: [{ errors: [{ errorCode: { authorizationError: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' } }] }] } }), { status: 403 });
  };
  const res = await get(`/api/report?c=${REAL_CLIENT.linkKey}`, liveEnv(kv), { clients: [REAL_CLIENT], fetchImpl, now: NOW, retryDelayMs: 1 });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /only has Test access/);
});

test('live: a client with no Google Ads ID still shows sample data', async () => {
  const res = await get(`/api/report?c=${REAL_CLIENT.linkKey}`, liveEnv(fakeKV()), { clients: [{ ...REAL_CLIENT, customerId: '' }], now: NOW });
  assert.equal((await res.json()).payload.demo, true);
});

// ---- daily refresh and the refresh button ----

test('the daily job does nothing until Google Ads is connected', async () => {
  const out = await runDailyRefresh({ REPORTS: fakeKV() }, { clients: [REAL_CLIENT] });
  assert.match(out.skipped, /not connected/);
});

test('the daily job refreshes the views named in the REFRESH_RANGES setting', async () => {
  const kv = fakeKV();
  const g = fakeGoogle();
  await runDailyRefresh({ ...ENV, REPORTS: kv, REFRESH_RANGES: '7,30' }, { clients: [REAL_CLIENT, { ...REAL_CLIENT, id: 'off', active: false }, { ...REAL_CLIENT, id: 'noid', customerId: '' }], fetchImpl: g.fetchImpl, now: NOW, retryDelayMs: 1 });
  assert.deepEqual([...kv.data.keys()].sort(), [`report:v${DATA_VERSION}:acme:30`, `report:v${DATA_VERSION}:acme:7`]);
});

test('one failing client does not stop the others', async () => {
  const kv = fakeKV();
  const g = fakeGoogle();
  const bad = { ...REAL_CLIENT, id: 'bad', customerId: '000' };
  const fetchImpl = (url, init) => {
    if (String(url).includes('/customers/0000/')) return Promise.resolve(new Response(JSON.stringify({ error: {} }), { status: 500 }));
    return g.fetchImpl(url, init);
  };
  const out = await runDailyRefresh({ ...ENV, REPORTS: kv, REFRESH_RANGES: '30' }, { clients: [bad, REAL_CLIENT], fetchImpl, now: NOW, retryDelayMs: 1 });
  assert.equal(out.length, 2);
  assert.ok(kv.data.has(`report:v${DATA_VERSION}:acme:30`));
});

test('the refresh button needs the secret', async () => {
  const env = { ...ENV, ASSETS: assets, REPORTS: fakeKV(), REFRESH_SECRET: 's3cret' };
  const deps = { clients: [REAL_CLIENT], fetchImpl: fakeGoogle().fetchImpl, now: NOW, retryDelayMs: 1 };
  const call = (headers = {}, method = 'POST', e = env) => worker.fetch(new Request(`https://x.example/api/refresh?c=acme`, { method, headers }), e, { waitUntil() {} }, deps);
  assert.equal((await call({}, 'POST', { ...env, REFRESH_SECRET: undefined })).status, 404); // switched off when no secret is set
  assert.equal((await call()).status, 401);
  assert.equal((await call({ authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await call({ authorization: 'Bearer s3cret' }, 'GET')).status, 401);
  assert.equal((await call({ authorization: 'Bearer s3cret' })).status, 202);
});
