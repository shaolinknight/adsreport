// The admin and team hub: login, saving clients and settings, and what the public report may see.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import { ENV, REAL_CLIENT, fakeGoogle, fakeKV } from './helpers.mjs';
import { putSaved } from '../worker/lib/store.mjs';
import { dataSignature, validateClient, withDefaults, ValidationError } from '../worker/lib/config.mjs';
import { resetTokenCache } from '../worker/lib/ads.mjs';
import clients from '../clients.json' with { type: 'json' };
import { tinyPayload } from './helpers.mjs';

const PASSWORD = 'correct horse battery';
const assets = {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const files = { '/hub.html': '<h1>hub</h1>', '/report.html': '<h1>report</h1>', '/404.html': '<h1>nope</h1>', '/index.html': 'i' };
    if (!(path in files)) return new Response('missing', { status: 404 });
    return new Response(files[path], { headers: { 'content-type': 'text/html' } });
  },
};
const makeEnv = (extra = {}) => ({ ASSETS: assets, REPORTS: fakeKV(), ADMIN_PASSWORD: PASSWORD, ...extra });

async function call(env, method, path, { body, cookie, hub = true, deps = {} } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (hub) headers['x-requested-with'] = 'knight-hub';
  const request = new Request(`https://reports.example.com${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const pending = [];
  const res = await worker.fetch(request, env, { waitUntil: (p) => pending.push(p) }, deps);
  await Promise.all(pending);
  return res;
}

async function signIn(env) {
  const res = await call(env, 'POST', '/api/admin/login', { body: { password: PASSWORD } });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

test('the hub pages are served for /team and /admin, with nothing private in them', async () => {
  const env = makeEnv();
  for (const path of ['/team', '/team/client/pure-meal-prep-sd', '/admin', '/admin/new']) {
    const res = await call(env, 'GET', path, { hub: false });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /hub/);
  }
});

test('without ADMIN_PASSWORD the hub is switched off', async () => {
  const env = makeEnv({ ADMIN_PASSWORD: undefined });
  const s = await (await call(env, 'GET', '/api/admin/session')).json();
  assert.deepEqual(s, { enabled: false, signedIn: false });
  assert.equal((await call(env, 'GET', '/api/admin/state')).status, 403);
  assert.equal((await call(env, 'POST', '/api/admin/login', { body: { password: 'anything-at-all' } })).status, 403);
  // a short password does not count as set
  assert.equal((await call(makeEnv({ ADMIN_PASSWORD: 'short' }), 'GET', '/api/admin/state')).status, 403);
});

test('login: wrong password is refused, the right one gives a cookie, and the cookie is HttpOnly', async () => {
  const env = makeEnv();
  assert.equal((await call(env, 'POST', '/api/admin/login', { body: { password: 'nope' } })).status, 401);
  const res = await call(env, 'POST', '/api/admin/login', { body: { password: PASSWORD } });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  const s = await (await call(env, 'GET', '/api/admin/session', { cookie: cookie.split(';')[0] })).json();
  assert.equal(s.signedIn, true);
});

test('the admin data needs a sign-in, a tampered cookie is refused, and a new password signs everyone out', async () => {
  const env = makeEnv();
  assert.equal((await call(env, 'GET', '/api/admin/state')).status, 401);
  const cookie = await signIn(env);
  assert.equal((await call(env, 'GET', '/api/admin/state', { cookie })).status, 200);
  const tampered = cookie.replace(/\d(?=\.)/, (d) => String((Number(d) + 1) % 10));
  assert.equal((await call(env, 'GET', '/api/admin/state', { cookie: tampered })).status, 401);
  const changed = { ...env, ADMIN_PASSWORD: 'a different password' };
  assert.equal((await call(changed, 'GET', '/api/admin/state', { cookie })).status, 401);
});

test('changes need the hub header, so another website cannot send them', async () => {
  const env = makeEnv();
  const cookie = await signIn(env);
  const res = await call(env, 'PUT', '/api/admin/settings', { cookie, hub: false, body: { agency: { name: 'X', mark: 'K' } } });
  assert.equal(res.status, 403);
});

test('five wrong passwords in a row lock login for a while, even for the right one', async () => {
  const env = makeEnv();
  for (let i = 0; i < 5; i++) assert.equal((await call(env, 'POST', '/api/admin/login', { body: { password: 'wrong-' + i } })).status, 401);
  assert.equal((await call(env, 'POST', '/api/admin/login', { body: { password: PASSWORD } })).status, 429);
});

test('the first time, clients come from clients.json; the public report never shows private fields', async () => {
  const env = makeEnv();
  const cookie = await signIn(env);
  const state = await (await call(env, 'GET', '/api/admin/state', { cookie })).json();
  assert.equal(state.clients.length, clients.length);
  assert.ok(state.clients[0].notes.length > 0);
  const report = await (await call(env, 'GET', `/api/report?c=${clients[0].linkKey}`, { hub: false })).text();
  assert.ok(!report.includes(clients[0].customerId));
  assert.ok(!report.includes(clients[0].linkKey));
  assert.ok(!/Goals: at least/.test(report), 'private notes must not appear');
});

test('adding a client: details are checked, then it gets its own id and secret link', async () => {
  const env = makeEnv();
  const cookie = await signIn(env);
  const bad = await call(env, 'POST', '/api/admin/clients', { cookie, body: { name: '', customerId: '12345', goals: { monthlyBudget: -5 } } });
  assert.equal(bad.status, 422);
  const { fields } = await bad.json();
  assert.ok(fields.name && fields.customerId && fields.goalMonthlyBudget);

  const ok = await call(env, 'POST', '/api/admin/clients', {
    cookie,
    body: { name: 'Sunset Yoga', customerId: '1112223333', resultLabel: { one: 'booking', many: 'bookings' }, conversionActions: ['Booking confirmed'], goals: { monthlyBudget: 900, monthlyResults: 20 }, palette: 'plum' },
  });
  assert.equal(ok.status, 201);
  const { client } = await ok.json();
  assert.equal(client.id, 'sunset-yoga');
  assert.match(client.linkKey, /^sunset-yoga-[a-z0-9]{7}$/);
  assert.equal(client.customerId, '111-222-3333');
  const report = await (await call(env, 'GET', `/api/report?c=${client.linkKey}`, { hub: false })).json();
  assert.equal(report.payload.client.name, 'Sunset Yoga');
  assert.equal(report.payload.client.palette, 'plum');
  assert.equal(report.payload.client.resultLabel.many, 'bookings');
  // a second client with the same name gets a different id and link
  const again = await (await call(env, 'POST', '/api/admin/clients', { cookie, body: { name: 'Sunset Yoga' } })).json();
  assert.equal(again.client.id, 'sunset-yoga-2');
  assert.notEqual(again.client.linkKey, client.linkKey);
});

test('editing goals, metrics, tabs and palette shows on the report straight away', async () => {
  const env = makeEnv();
  const cookie = await signIn(env);
  const id = clients[0].id;
  const res = await call(env, 'PUT', `/api/admin/clients/${id}`, {
    cookie,
    body: { goals: { monthlyResults: 55 }, metrics: ['results', 'spend', 'clicks'], tabs: ['overview', 'campaigns'], palette: 'saffron', defaultRange: '7', intro: 'Hello from Brandon' },
  });
  assert.equal(res.status, 200);
  const { payload } = await (await call(env, 'GET', `/api/report?c=${clients[0].linkKey}`, { hub: false })).json();
  assert.equal(payload.client.goals.monthlyResults, 55);
  assert.deepEqual(payload.client.metrics, ['results', 'spend', 'clicks']);
  assert.deepEqual(payload.client.tabs, ['overview', 'campaigns']);
  assert.equal(payload.client.palette, 'saffron');
  assert.equal(payload.client.intro, 'Hello from Brandon');
  assert.equal(payload.range.days, 7, 'the client\'s own default range is used when the link names none');
});

test('settings that do not make sense are refused with a message for the field', async () => {
  const env = makeEnv();
  const cookie = await signIn(env);
  const base = `/api/admin/clients/${clients[0].id}`;
  const r1 = await call(env, 'PUT', base, { cookie, body: { tabs: [] } });
  assert.equal(r1.status, 422);
  assert.ok((await r1.json()).fields.tabs);
  const r2 = await call(env, 'PUT', base, { cookie, body: { metrics: ['results'] } });
  assert.ok((await r2.json()).fields.metrics);
  const r3 = await call(env, 'PUT', base, { cookie, body: { timezone: 'Mars/Olympus' } });
  assert.ok((await r3.json()).fields.timezone);
  const r4 = await call(env, 'PUT', base, { cookie, body: { palette: 'neon' } });
  assert.ok((await r4.json()).fields.palette);
  assert.equal((await call(env, 'PUT', '/api/admin/clients/nobody', { cookie, body: {} })).status, 404);
});

test('a new link replaces the old one, and pausing a client switches its link off', async () => {
  const env = makeEnv();
  const cookie = await signIn(env);
  const c = clients[1];
  const rotated = await (await call(env, 'POST', `/api/admin/clients/${c.id}/link`, { cookie })).json();
  assert.notEqual(rotated.client.linkKey, c.linkKey);
  assert.equal((await call(env, 'GET', `/api/report?c=${c.linkKey}`, { hub: false })).status, 404);
  assert.equal((await call(env, 'GET', `/api/report?c=${rotated.client.linkKey}`, { hub: false })).status, 200);
  await call(env, 'PUT', `/api/admin/clients/${c.id}`, { cookie, body: { active: false } });
  assert.equal((await call(env, 'GET', `/api/report?c=${rotated.client.linkKey}`, { hub: false })).status, 404);
});

test('deleting a client needs its exact name typed', async () => {
  const env = makeEnv();
  const cookie = await signIn(env);
  const id = clients[1].id;
  assert.equal((await call(env, 'DELETE', `/api/admin/clients/${id}`, { cookie, body: { confirmName: 'greenbacks' } })).status, 422);
  assert.equal((await call(env, 'DELETE', `/api/admin/clients/${id}`, { cookie, body: { confirmName: clients[1].name } })).status, 200);
  const state = await (await call(env, 'GET', '/api/admin/state', { cookie })).json();
  assert.equal(state.clients.length, clients.length - 1);
});

test('site settings: the colour limits are checked, saved, and change the goal colours on the report', async () => {
  const env = makeEnv();
  const cookie = await signIn(env);
  const bad = await call(env, 'PUT', '/api/admin/settings', { cookie, body: { agency: { name: 'Kishido', mark: 'K' }, thresholds: { costPerResultAmber: 0.5 } } });
  assert.equal(bad.status, 422);
  assert.ok((await bad.json()).fields.costPerResultAmber);
  const ok = await call(env, 'PUT', '/api/admin/settings', { cookie, body: { agency: { name: 'Kishido', mark: 'K' }, thresholds: { costPerResultAmber: 1.4 } } });
  assert.equal(ok.status, 200);
  const { payload } = await (await call(env, 'GET', `/api/report?c=${clients[0].linkKey}`, { hub: false })).json();
  assert.equal(payload.client.thresholds.costPerResultAmber, 1.4);
  assert.equal(payload.client.agency.name, 'Kishido');
});

test('a saved real report picks up changed goals, but is set aside when the account or the counted results change', async () => {
  const env = makeEnv({ ...ENV });
  const cookie = await signIn(env);
  const kv = env.REPORTS;
  const client = withDefaults({ ...REAL_CLIENT });
  // put the real client in the saved config
  await call(env, 'POST', '/api/admin/clients', { cookie, body: { name: 'Acme', customerId: '987-654-3210', conversionActions: ['Form submission'], goals: { costPerResult: 20 } } });
  const state = await (await call(env, 'GET', '/api/admin/state', { cookie })).json();
  const acme = state.clients.find((c) => c.id === 'acme');
  const payload = { ...tinyPayload(), dataSig: dataSignature(acme) };
  payload.range = { ...payload.range, preset: '30', key: '30' };
  await putSaved(env, 'acme', '30', payload, new Date());

  const read = async () => (await call(env, 'GET', `/api/report?c=${acme.linkKey}&range=30`, { hub: false })).json();
  let body = await read();
  assert.equal(body.payload.demo, false, 'saved copy is used');
  assert.equal(body.payload.client.goals.costPerResult, 20);
  await call(env, 'PUT', '/api/admin/clients/acme', { cookie, body: { goals: { costPerResult: 35 } } });
  body = await read();
  assert.equal(body.payload.client.goals.costPerResult, 35, 'new goal appears without rebuilding the numbers');
  assert.equal(body.payload.facts.length, payload.facts.length);

  // Changing which actions count makes the saved copy stale: a fresh build is made (here from the pretend Google)
  const g = fakeGoogle();
  resetTokenCache();
  await call(env, 'PUT', '/api/admin/clients/acme', { cookie, body: { conversionActions: ['Phone call click'] }, deps: { fetchImpl: g.fetchImpl } });
  assert.ok(kv.data.size > 0);
  body = await (await call(env, 'GET', `/api/report?c=${acme.linkKey}&range=30`, { hub: false, deps: { fetchImpl: g.fetchImpl } })).json();
  assert.ok(g.calls.some((c) => c.url.includes('googleads.googleapis.com')), 'Google was asked again');
});

test('the all-clients overview summarises each client, with flags for anything off track', async () => {
  const env = makeEnv();
  const cookie = await signIn(env);
  await call(env, 'PUT', `/api/admin/clients/${clients[1].id}`, { cookie, body: { active: false } });
  const { clients: list } = await (await call(env, 'GET', '/api/admin/overview', { cookie })).json();
  assert.equal(list.length, 2);
  const pmp = list.find((c) => c.id === clients[0].id);
  assert.equal(pmp.mode, 'sample');
  assert.ok(pmp.totals.spend > 0);
  assert.ok(Array.isArray(pmp.goalStatus) && pmp.goalStatus.length >= 3);
  assert.ok(pmp.flags.some((f) => /sample/i.test(f.text)));
  const paused = list.find((c) => c.id === clients[1].id);
  assert.equal(paused.mode, 'paused');
});

test('overview with Google Ads connected but nothing saved yet says it is waiting, and never calls Google', async () => {
  const env = makeEnv({ ...ENV });
  const cookie = await signIn(env);
  const g = fakeGoogle();
  const { clients: list } = await (await call(env, 'GET', '/api/admin/overview', { cookie, deps: { fetchImpl: g.fetchImpl } })).json();
  assert.ok(list.every((c) => c.mode === 'waiting'));
  assert.equal(g.calls.length, 0);
});

test('validateClient keeps unsent fields, formats the account ID and orders the tabs', () => {
  const existing = withDefaults({ id: 'a', name: 'A', linkKey: 'a-xxxxxxx', goals: { monthlyBudget: 100 } });
  const out = validateClient({ customerId: '1234567890', tabs: ['creative', 'overview'] }, existing, [existing]);
  assert.equal(out.customerId, '123-456-7890');
  assert.deepEqual(out.tabs, ['overview', 'creative']);
  assert.equal(out.goals.monthlyBudget, 100);
  assert.equal(out.linkKey, 'a-xxxxxxx');
  assert.throws(() => validateClient({ name: '' }, existing, [existing]), ValidationError);
});
