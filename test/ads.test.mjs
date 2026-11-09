// Google Ads code, tested against a pretend Google. Nothing here talks to the real Google Ads.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AdsError, buildPayload, buildQuery, ensureSelected, fetchBreakdown, getAccessToken, getField, resetTokenCache,
  runQuery, runWithOptionalFields, translateError,
} from '../worker/lib/ads.mjs';
import { ENV, REAL_CLIENT, fakeGoogle } from './helpers.mjs';
import { adsConfigured } from '../worker/lib/ads.mjs';

test.beforeEach(() => resetTokenCache());

test('a field used in WHERE is added to SELECT automatically', () => {
  const sel = ensureSelected(['campaign.id', 'metrics.clicks'], "segments.device = 'MOBILE' AND metrics.impressions > 0");
  assert.deepEqual(sel, ['campaign.id', 'metrics.clicks', 'segments.device', 'metrics.impressions']);
});

test('a field already selected is not added twice', () => {
  const sel = ensureSelected(['campaign.id', 'metrics.impressions'], 'metrics.impressions > 0');
  assert.deepEqual(sel, ['campaign.id', 'metrics.impressions']);
});

test('date filters do not split rows by day', () => {
  const q = buildQuery({ select: ['campaign.id'], from: 'campaign', where: "segments.date BETWEEN '2026-11-01' AND '2026-11-08' AND metrics.impressions > 0" });
  assert.equal(q, "SELECT campaign.id, metrics.impressions FROM campaign WHERE segments.date BETWEEN '2026-11-01' AND '2026-11-08' AND metrics.impressions > 0");
});

test('past campaigns are not hidden: queries never filter on campaign status', () => {
  const q = buildQuery({ select: ['campaign.id', 'campaign.status'], from: 'campaign', where: 'metrics.impressions > 0' });
  assert.doesNotMatch(q, /status\s*=/);
});

test('Google field names are read from the camelCase reply', () => {
  const row = { adGroupCriterion: { keyword: { text: 'hi', matchType: 'EXACT' } }, metrics: { costMicros: '5' } };
  assert.equal(getField(row, 'ad_group_criterion.keyword.text'), 'hi');
  assert.equal(getField(row, 'ad_group_criterion.keyword.match_type'), 'EXACT');
  assert.equal(getField(row, 'metrics.cost_micros'), '5');
  assert.equal(getField(row, 'nothing.here'), undefined);
});

test('the known Google errors become plain sentences', () => {
  const body = { error: { details: [{ errors: [{ errorCode: { authorizationError: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' } }] }] } };
  const e = translateError(403, body);
  assert.ok(e instanceof AdsError);
  assert.match(e.plain, /Google Cloud project only has Test access/);
  assert.match(translateError(403, { error: { details: [{ errors: [{ errorCode: { authorizationError: 'USER_PERMISSION_DENIED' } }] }] } }).plain, /cannot see this Google Ads account/);
  assert.match(translateError(429, {}).plain, /limiting how fast/);
  assert.match(translateError(500, { error: { message: 'Boom' } }).plain, /Boom/);
});

test('sign-in exchanges the refresh token, and the access token is reused until it expires', async () => {
  const g = fakeGoogle();
  const t1 = await getAccessToken(ENV, g.fetchImpl, 1_000);
  const t2 = await getAccessToken(ENV, g.fetchImpl, 2_000);
  assert.equal(t1, t2);
  assert.equal(g.calls.length, 1);
  const sent = new URLSearchParams(String(g.calls[0].init.body));
  assert.equal(sent.get('grant_type'), 'refresh_token');
  assert.equal(sent.get('refresh_token'), 'refresh');
  // after it expires a new one is fetched
  await getAccessToken(ENV, g.fetchImpl, 1_000 + 3600 * 1000 + 1);
  assert.equal(g.calls.length, 2);
});

test('a rejected refresh token gives a plain message', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
  await assert.rejects(() => getAccessToken(ENV, fetchImpl), (e) => e instanceof AdsError && /refresh token/.test(e.plain));
});

test('requests use OAuth only: bearer token, manager account ID in digits, and no developer token', async () => {
  const g = fakeGoogle();
  await runQuery(ENV, '987-654-3210', 'SELECT campaign.id FROM campaign', { fetchImpl: g.fetchImpl });
  const call = g.calls.find((c) => c.url.includes('googleads.googleapis.com'));
  assert.equal(call.url, 'https://googleads.googleapis.com/v25/customers/9876543210/googleAds:searchStream');
  const h = call.init.headers;
  assert.match(h.authorization, /^Bearer tok-/);
  assert.equal(h['login-customer-id'], '1234567890');
  assert.equal(Object.keys(h).some((k) => k.toLowerCase().includes('developer')), false);
});

test('the manager account ID is optional: without it the header is left out and Google Ads still counts as connected', async () => {
  const env = { ...ENV, GOOGLE_ADS_LOGIN_CUSTOMER_ID: '' };
  assert.equal(adsConfigured(env), true);
  const g = fakeGoogle();
  resetTokenCache();
  await runQuery(env, '987-654-3210', 'SELECT campaign.id FROM campaign', { fetchImpl: g.fetchImpl });
  const call = g.calls.find((c) => c.url.includes('googleads.googleapis.com'));
  assert.equal('login-customer-id' in call.init.headers, false);
});

test('the API version comes from a setting', async () => {
  const g = fakeGoogle();
  await runQuery({ ...ENV, GOOGLE_ADS_API_VERSION: 'v99' }, '1', 'SELECT x FROM y', { fetchImpl: g.fetchImpl });
  assert.match(g.calls.find((c) => c.url.includes('googleads')).url, /\/v99\//);
});

test('a rate limit is retried once and then succeeds', async () => {
  const g = fakeGoogle({ rateLimitFirst: true });
  const rows = await runQuery(ENV, '1', 'SELECT campaign.id FROM ad_group', { fetchImpl: g.fetchImpl, retryDelayMs: 1 });
  assert.deepEqual(rows, []);
  assert.equal(g.calls.filter((c) => c.url.includes('googleads')).length, 2);
});

test('a second failure is reported in plain words', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    return new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } }), { status: 429 });
  };
  await assert.rejects(() => runQuery(ENV, '1', 'SELECT x FROM y', { fetchImpl, retryDelayMs: 1 }), (e) => /limiting how fast/.test(e.plain));
});

test('optional fields that this version rejects are dropped instead of failing', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    const q = JSON.parse(init.body).query;
    seen.push(q);
    if (q.includes('metrics.video_views')) {
      return new Response(JSON.stringify({ error: { message: 'Unrecognized field in the query: metrics.video_views', details: [] } }), { status: 400 });
    }
    return new Response(JSON.stringify([{ results: [{ campaign: { id: '1' } }] }]));
  };
  const out = await runWithOptionalFields(ENV, '1', { select: ['campaign.id'], from: 'video', where: 'metrics.impressions > 0' }, ['metrics.video_views', 'metrics.video_quartile_p25_rate'], { fetchImpl });
  assert.equal(out.rows.length, 1);
  assert.deepEqual(out.usedOptional, ['metrics.video_quartile_p25_rate']);
  assert.equal(seen.length, 2);
});

test('money comes back in micros and is turned into dollars; only chosen conversion actions count', async () => {
  const g = fakeGoogle();
  const { items } = await fetchBreakdown(
    ENV,
    REAL_CLIENT,
    { from: 'campaign', dims: ['campaign.id', 'campaign.name', 'campaign.advertising_channel_type', 'campaign.status', 'segments.date'], where: "segments.date BETWEEN '2026-11-01' AND '2026-11-08'" },
    { fetchImpl: g.fetchImpl },
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].s, 12.34); // 12,340,000 micros
  assert.equal(items[0].i, 1000);
  assert.equal(items[0].k, 40);
  assert.equal(items[0].v, 2.5); // "Form submission" counts, "Phone call click" does not
});

test('with no conversion actions chosen, every action counts', async () => {
  const g = fakeGoogle();
  const { items } = await fetchBreakdown(
    ENV,
    { ...REAL_CLIENT, conversionActions: [] },
    { from: 'campaign', dims: ['campaign.id', 'campaign.name', 'campaign.advertising_channel_type', 'campaign.status', 'segments.date'], where: "segments.date BETWEEN '2026-11-01' AND '2026-11-08'" },
    { fetchImpl: g.fetchImpl },
  );
  assert.equal(items[0].v, 11.5);
});

test('a whole report is built from the pieces', async () => {
  const g = fakeGoogle();
  const range = { preset: '7', key: '7', start: '2026-11-02', end: '2026-11-08', prevStart: '2026-10-26', prevEnd: '2026-11-01', days: 7 };
  const p = await buildPayload(ENV, REAL_CLIENT, range, { fetchImpl: g.fetchImpl, now: new Date('2026-11-09T12:00:00Z'), retryDelayMs: 1 });
  assert.equal(p.version, 1);
  assert.equal(p.demo, false);
  assert.equal(p.client.name, 'Acme');
  assert.deepEqual(p.campaigns, [{ id: '11', name: 'Brand | Search', type: 'SEARCH', status: 'ENABLED' }]);
  assert.deepEqual(p.facts, [{ d: '2026-11-01', c: '11', s: 12.34, i: 1000, k: 40, v: 2.5, r: 0 }]);
  assert.equal(p.adGroups[0].name, 'Group A');
  assert.equal(p.adGroups[0].v, 1);
  assert.equal(p.adGroups[0].s, 5);
});

test('if an extra table fails, the report still loads and says what is missing', async () => {
  const g = fakeGoogle({ failOn: ['FROM search_term_view'] });
  const range = { preset: '7', key: '7', start: '2026-11-02', end: '2026-11-08', prevStart: '2026-10-26', prevEnd: '2026-11-01', days: 7 };
  const p = await buildPayload(ENV, REAL_CLIENT, range, { fetchImpl: g.fetchImpl, retryDelayMs: 1 });
  assert.equal(p.facts.length, 1);
  assert.deepEqual(p.searchTerms, []);
  assert.deepEqual(p.warnings.map((w) => w.part), ['searchTerms']);
});

test('if the main table fails, the report fails with a plain message', async () => {
  const g = fakeGoogle({ failOn: ['FROM campaign '] });
  const range = { preset: '7', key: '7', start: '2026-11-02', end: '2026-11-08', prevStart: '2026-10-26', prevEnd: '2026-11-01', days: 7 };
  await assert.rejects(() => buildPayload(ENV, REAL_CLIENT, range, { fetchImpl: g.fetchImpl, retryDelayMs: 1 }), AdsError);
});

test('a client without a Google Ads ID cannot be loaded', async () => {
  await assert.rejects(() => buildPayload(ENV, { ...REAL_CLIENT, customerId: '' }, { start: 'a', end: 'b' }, {}), /customer ID/);
});
