// Google Ads: sign-in, queries and building one report.
//
// STATUS IN VERSION 1.0: written from Google's documentation and from the rules in the build brief,
// but NOT yet tested against a real Google Ads account. The tests use made-up Google replies.
// The list of untested queries is in the README.
//
// Rules followed here:
//  - No developer token. Access levels belong to the Google Cloud project that owns the OAuth client.
//  - Money comes back in micros (divide by 1,000,000).
//  - Never filter on campaign status for past dates; use impressions instead.
//  - Optional fields that a Google version rejects are dropped and the query is tried again.
//  - Conversions are counted only for the client's chosen main conversion actions.

import { DATA_VERSION } from '../../src/lib/calc.mjs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_VERSION = 'v25';
const REQUEST_TIMEOUT_MS = 30000;
const CONCURRENCY = 4;

// ---------- plain-words errors ----------

export class AdsError extends Error {
  constructor(plain, { code = 'ERROR', status = 502, detail } = {}) {
    super(plain);
    this.name = 'AdsError';
    this.plain = plain;
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

const KNOWN_CODES = {
  CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION:
    'The Google Cloud project only has Test access, so it can only read test accounts. Apply for Explorer or Basic access on the project in Google Cloud.',
  DEVELOPER_TOKEN_NOT_APPROVED:
    'Google says this project does not have the right access level yet. Check the access level on the Google Cloud project.',
  USER_PERMISSION_DENIED:
    'The Google user that signed in cannot see this Google Ads account. Check the account ID, and that the account is linked to your manager account.',
  CUSTOMER_NOT_FOUND: 'Google could not find that Google Ads account. Check the customer ID.',
  CUSTOMER_NOT_ENABLED: 'That Google Ads account is not active.',
  NOT_ADS_USER: 'The Google user that signed in does not have a Google Ads account.',
  RESOURCE_EXHAUSTED: 'Google Ads is limiting how fast we can ask for data. The report will try again later.',
  QUOTA_ERROR: 'The daily Google Ads limit for this project has been used up. It resets overnight.',
  OAUTH_TOKEN_INVALID: 'The saved Google sign-in is no longer valid. Create a new refresh token.',
  OAUTH_TOKEN_EXPIRED: 'The saved Google sign-in has expired. Create a new refresh token.',
  OAUTH_TOKEN_REVOKED: 'Access was removed in the Google account. Create a new refresh token.',
};

/** Pull the most useful error code out of Google's reply. */
export function extractErrorCodes(body) {
  const codes = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.errorCode && typeof node.errorCode === 'object') {
      for (const v of Object.values(node.errorCode)) if (typeof v === 'string') codes.push(v);
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  };
  walk(body);
  return codes;
}

export function translateError(status, body) {
  const codes = extractErrorCodes(body);
  for (const code of codes) {
    if (KNOWN_CODES[code]) return new AdsError(KNOWN_CODES[code], { code, status: 502, detail: body });
  }
  const message = body?.error?.message || body?.message || '';
  if (status === 429) return new AdsError(KNOWN_CODES.RESOURCE_EXHAUSTED, { code: 'RESOURCE_EXHAUSTED', status: 503, detail: body });
  if (status === 401) return new AdsError('Google did not accept the saved sign-in. Create a new refresh token.', { code: 'UNAUTHENTICATED', detail: body });
  if (status === 403) return new AdsError(`Google said no access to this account${message ? `: ${message}` : '.'}`, { code: 'PERMISSION_DENIED', detail: body });
  return new AdsError(`Google Ads returned an error${message ? `: ${message}` : ` (code ${status}).`}`, { code: codes[0] || 'ERROR', detail: body });
}

// ---------- settings and sign-in ----------

export function adsConfigured(env) {
  return Boolean(env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET && env.GOOGLE_ADS_REFRESH_TOKEN && env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
}

const digits = (s) => String(s ?? '').replace(/\D/g, '');

let tokenCache = { value: null, expires: 0, key: '' };

export function resetTokenCache() {
  tokenCache = { value: null, expires: 0, key: '' };
}

export async function getAccessToken(env, fetchImpl = fetch, now = Date.now()) {
  const cacheKey = `${env.GOOGLE_ADS_CLIENT_ID}|${env.GOOGLE_ADS_REFRESH_TOKEN}`;
  if (tokenCache.value && tokenCache.key === cacheKey && tokenCache.expires - 60000 > now) return tokenCache.value;

  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const why = body.error === 'invalid_grant'
      ? 'Google rejected the saved sign-in (the refresh token). It may have expired or been revoked. Create a new one.'
      : `Google would not give an access token${body.error_description ? `: ${body.error_description}` : '.'}`;
    throw new AdsError(why, { code: body.error || 'TOKEN_ERROR', detail: { status: res.status, error: body.error } });
  }
  tokenCache = { value: body.access_token, expires: now + (body.expires_in || 3600) * 1000, key: cacheKey };
  return body.access_token;
}

// ---------- GAQL helpers ----------

/**
 * Google rejects a query when a field is used in WHERE but is not in SELECT.
 * This adds any that are missing. Date filters (segments.date) are left out on purpose:
 * selecting the date would split every row by day.
 */
export function ensureSelected(select, where, { skip = ['segments.date'] } = {}) {
  const fields = new Set(select);
  const found = String(where || '').match(/\b(?:metrics|segments|campaign|ad_group|ad_group_ad|ad_group_criterion|customer|campaign_criterion|asset|video|search_term_view|ad_group_ad_asset_view)\.[a-z_.]+/g) || [];
  const result = [...select];
  for (const f of found) {
    if (skip.includes(f)) continue;
    if (!fields.has(f)) {
      fields.add(f);
      result.push(f);
    }
  }
  return result;
}

export function buildQuery({ select, from, where, orderBy, limit }) {
  const fields = ensureSelected(select, where);
  let q = `SELECT ${fields.join(', ')} FROM ${from}`;
  if (where) q += ` WHERE ${where}`;
  if (orderBy) q += ` ORDER BY ${orderBy}`;
  if (limit) q += ` LIMIT ${limit}`;
  return q;
}

const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/** Read "ad_group.id" out of a reply row, where Google writes it as row.adGroup.id */
export function getField(row, path) {
  let node = row;
  for (const part of path.split('.')) {
    if (node == null) return undefined;
    node = node[camel(part)];
  }
  return node;
}

const num = (v) => (v == null || v === '' ? 0 : Number(v));

function channelType(raw) {
  const known = ['SEARCH', 'PERFORMANCE_MAX', 'DEMAND_GEN', 'VIDEO', 'SHOPPING'];
  return known.includes(raw) ? raw : 'OTHER';
}

// ---------- running queries ----------

function withTimeout(fetchImpl, url, init, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetchImpl(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One GAQL query through searchStream. Retries once on rate limits and brief Google hiccups. */
export async function runQuery(env, customerId, gaql, { fetchImpl = fetch, retryDelayMs = 1500 } = {}) {
  const version = env.GOOGLE_ADS_API_VERSION || DEFAULT_VERSION;
  const url = `https://googleads.googleapis.com/${version}/customers/${digits(customerId)}/googleAds:searchStream`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken(env, fetchImpl);
    let res;
    try {
      res = await withTimeout(
        fetchImpl,
        url,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'login-customer-id': digits(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID),
            'content-type': 'application/json',
          },
          body: JSON.stringify({ query: gaql }),
        },
        REQUEST_TIMEOUT_MS,
      );
    } catch (e) {
      if (attempt === 0) {
        await sleep(retryDelayMs);
        continue;
      }
      throw new AdsError('Google Ads took too long to answer.', { code: 'TIMEOUT', status: 504, detail: String(e) });
    }

    if (res.ok) {
      const batches = await res.json();
      const list = Array.isArray(batches) ? batches : [batches];
      return list.flatMap((b) => b.results || []);
    }

    const body = await res.json().catch(() => ({}));
    const retryable = res.status === 429 || res.status === 503;
    if (retryable && attempt === 0) {
      await sleep(retryDelayMs);
      continue;
    }
    // Expired token: clear it and try once more.
    if (res.status === 401 && attempt === 0) {
      resetTokenCache();
      continue;
    }
    throw translateError(res.status, body);
  }
  throw new AdsError('Google Ads did not answer.', { code: 'NO_ANSWER' });
}

/**
 * Run a query that has optional fields. If Google says it does not recognise one,
 * drop it and try again instead of failing the whole report.
 */
export async function runWithOptionalFields(env, customerId, spec, optional, opts = {}) {
  let remaining = [...optional];
  for (let tries = 0; tries <= optional.length; tries++) {
    const gaql = buildQuery({ ...spec, select: [...spec.select, ...remaining] });
    try {
      const rows = await runQuery(env, customerId, gaql, opts);
      return { rows, usedOptional: remaining };
    } catch (e) {
      const text = JSON.stringify(e.detail || '') + e.message;
      const bad = remaining.find((f) => text.includes(f));
      const isFieldError = /unrecognized|UNRECOGNIZED_FIELD|PROHIBITED|invalid field|not a valid field/i.test(text);
      if (bad && isFieldError) {
        remaining = remaining.filter((f) => f !== bad);
        continue;
      }
      throw e;
    }
  }
  throw new AdsError('Google rejected the query.', { code: 'QUERY_REJECTED' });
}

// ---------- one breakdown = a metrics query + a results query ----------

function normalizeName(s) {
  return String(s ?? '').trim().toLowerCase();
}

/**
 * Pulls one table. Spend, impressions and clicks come from one query.
 * Results come from a second query split by conversion action, so we can count only the
 * client's chosen main conversion actions.
 */
export async function fetchBreakdown(env, client, def, opts = {}) {
  const { from, dims, where, orderBy, limit, optionalMetrics = [] } = def;
  const customerId = client.customerId;
  const keyOf = (row) => dims.map((d) => String(getField(row, d) ?? '')).join('\u0001');

  const metricsSpec = {
    select: [...dims, 'metrics.cost_micros', 'metrics.impressions', 'metrics.clicks'],
    from,
    where: `${where} AND metrics.impressions > 0`,
    orderBy,
    limit,
  };
  const convSpec = {
    select: [...dims, 'segments.conversion_action_name', 'metrics.conversions', 'metrics.conversions_value'],
    from,
    where: `${where} AND metrics.conversions > 0`,
  };

  const [{ rows, usedOptional }, convRows] = await Promise.all([
    runWithOptionalFields(env, customerId, metricsSpec, optionalMetrics, opts),
    runQuery(env, customerId, buildQuery(convSpec), opts),
  ]);

  const wanted = (client.conversionActions || []).map(normalizeName).filter(Boolean);
  const conv = new Map();
  for (const row of convRows) {
    const name = normalizeName(getField(row, 'segments.conversion_action_name'));
    if (wanted.length && !wanted.includes(name)) continue;
    const key = keyOf(row);
    const cur = conv.get(key) || { v: 0, r: 0 };
    cur.v += num(getField(row, 'metrics.conversions'));
    cur.r += num(getField(row, 'metrics.conversions_value'));
    conv.set(key, cur);
  }

  const out = rows.map((row) => {
    const c = conv.get(keyOf(row)) || { v: 0, r: 0 };
    return {
      row,
      s: Math.round(num(getField(row, 'metrics.cost_micros')) / 10000) / 100, // micros -> dollars, 2 decimals
      i: num(getField(row, 'metrics.impressions')),
      k: num(getField(row, 'metrics.clicks')),
      v: Math.round(c.v * 100) / 100,
      r: Math.round(c.r * 100) / 100,
    };
  });
  return { items: out, usedOptional };
}

// ---------- building a whole report ----------

const rangeWhere = (from, to) => `segments.date BETWEEN '${from}' AND '${to}'`;

function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await tasks[i]() };
      } catch (e) {
        results[i] = { ok: false, error: e };
      }
    }
  };
  return Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker)).then(() => results);
}

export async function buildPayload(env, client, range, { fetchImpl = fetch, now = new Date(), retryDelayMs } = {}) {
  if (!client.customerId) throw new AdsError('This client does not have a Google Ads customer ID yet.', { code: 'NO_CUSTOMER_ID', status: 400 });
  const opts = { fetchImpl, retryDelayMs };
  const cur = rangeWhere(range.start, range.end);
  const both = rangeWhere(range.prevStart, range.end);
  const warnings = [];

  // The main table has to work. Everything else is nice to have and fails softly.
  const main = await fetchBreakdown(
    env,
    client,
    {
      from: 'campaign',
      dims: ['campaign.id', 'campaign.name', 'campaign.advertising_channel_type', 'campaign.status', 'segments.date'],
      where: both,
    },
    opts,
  );

  const campaigns = new Map();
  const facts = [];
  for (const it of main.items) {
    const id = String(getField(it.row, 'campaign.id'));
    if (!campaigns.has(id)) {
      campaigns.set(id, {
        id,
        name: getField(it.row, 'campaign.name') || `Campaign ${id}`,
        type: channelType(getField(it.row, 'campaign.advertising_channel_type')),
        status: getField(it.row, 'campaign.status') || 'UNKNOWN',
      });
    }
    facts.push({ d: getField(it.row, 'segments.date'), c: id, s: it.s, i: it.i, k: it.k, v: it.v, r: it.r });
  }

  const optionalTasks = {
    adGroups: () =>
      fetchBreakdown(env, client, { from: 'ad_group', dims: ['campaign.id', 'ad_group.id', 'ad_group.name'], where: cur }, opts),
    ads: () =>
      fetchBreakdown(
        env,
        client,
        {
          from: 'ad_group_ad',
          dims: ['campaign.id', 'ad_group.id', 'ad_group_ad.ad.id', 'ad_group_ad.ad.name', 'ad_group_ad.ad.type', 'ad_group_ad.ad.responsive_search_ad.headlines'],
          where: cur,
          orderBy: 'metrics.cost_micros DESC',
          limit: 300,
        },
        opts,
      ),
    keywords: () =>
      fetchBreakdown(
        env,
        client,
        {
          from: 'keyword_view',
          dims: ['campaign.id', 'ad_group.id', 'ad_group_criterion.keyword.text', 'ad_group_criterion.keyword.match_type'],
          where: cur,
          orderBy: 'metrics.cost_micros DESC',
          limit: 300,
        },
        opts,
      ),
    searchTerms: () =>
      fetchBreakdown(
        env,
        client,
        { from: 'search_term_view', dims: ['campaign.id', 'search_term_view.search_term'], where: cur, orderBy: 'metrics.cost_micros DESC', limit: 500 },
        opts,
      ),
    age: () => fetchBreakdown(env, client, { from: 'age_range_view', dims: ['campaign.id', 'ad_group_criterion.age_range.type'], where: cur }, opts),
    gender: () => fetchBreakdown(env, client, { from: 'gender_view', dims: ['campaign.id', 'ad_group_criterion.gender.type'], where: cur }, opts),
    device: () => fetchBreakdown(env, client, { from: 'campaign', dims: ['campaign.id', 'segments.device'], where: cur }, opts),
    segment: () =>
      fetchBreakdown(env, client, { from: 'campaign_audience_view', dims: ['campaign.id', 'campaign_criterion.display_name'], where: cur }, opts),
    videos: () =>
      fetchBreakdown(
        env,
        client,
        {
          from: 'video',
          dims: ['campaign.id', 'video.id', 'video.title'],
          where: cur,
          orderBy: 'metrics.cost_micros DESC',
          limit: 100,
          // Video fields are renamed between versions, so each is optional.
          optionalMetrics: [
            'metrics.video_views',
            'metrics.video_quartile_p25_rate',
            'metrics.video_quartile_p50_rate',
            'metrics.video_quartile_p75_rate',
            'metrics.video_quartile_p100_rate',
          ],
        },
        opts,
      ),
  };

  const hasVideoCampaigns = [...campaigns.values()].some((c) => c.type === 'DEMAND_GEN' || c.type === 'VIDEO');
  const names = Object.keys(optionalTasks).filter((n) => n !== 'videos' || hasVideoCampaigns);
  const settled = await pool(names.map((n) => optionalTasks[n]), CONCURRENCY);
  const got = {};
  names.forEach((n, i) => {
    if (settled[i].ok) got[n] = settled[i].value;
    else warnings.push({ part: n, message: settled[i].error?.plain || settled[i].error?.message || 'Could not load this part.' });
  });

  // Demand Gen and Video campaigns: fall back to the asset view if the video resource has nothing.
  if (hasVideoCampaigns && (!got.videos || got.videos.items.length === 0)) {
    try {
      got.videoAssets = await fetchBreakdown(
        env,
        client,
        {
          from: 'ad_group_ad_asset_view',
          dims: ['campaign.id', 'asset.id', 'asset.name'],
          where: `${cur} AND ad_group_ad_asset_view.field_type = 'YOUTUBE_VIDEO'`,
          orderBy: 'metrics.cost_micros DESC',
          limit: 100,
        },
        opts,
      );
    } catch (e) {
      warnings.push({ part: 'videoAssets', message: e.plain || e.message });
    }
  }

  const pick = (name) => got[name]?.items ?? [];
  const cid = (row) => String(getField(row, 'campaign.id'));
  const m = (it) => ({ s: it.s, i: it.i, k: it.k, v: it.v, r: it.r });

  const adGroups = pick('adGroups').map((it) => ({
    campaignId: cid(it.row),
    id: String(getField(it.row, 'ad_group.id')),
    name: getField(it.row, 'ad_group.name') || 'Ad group',
    ...m(it),
  }));

  const ads = pick('ads').map((it) => {
    const headlines = getField(it.row, 'ad_group_ad.ad.responsive_search_ad.headlines');
    const firstHeadline = Array.isArray(headlines) ? headlines[0]?.text : undefined;
    return {
      campaignId: cid(it.row),
      adGroupId: String(getField(it.row, 'ad_group.id')),
      id: String(getField(it.row, 'ad_group_ad.ad.id')),
      name: getField(it.row, 'ad_group_ad.ad.name') || firstHeadline || 'Ad',
      ...m(it),
    };
  });

  const keywords = pick('keywords').map((it) => ({
    campaignId: cid(it.row),
    adGroupId: String(getField(it.row, 'ad_group.id')),
    text: getField(it.row, 'ad_group_criterion.keyword.text') || '',
    match: getField(it.row, 'ad_group_criterion.keyword.match_type') || '',
    ...m(it),
  }));

  const searchTerms = pick('searchTerms').map((it) => ({
    campaignId: cid(it.row),
    text: getField(it.row, 'search_term_view.search_term') || '',
    ...m(it),
  }));

  const label = (path) => (it) => ({ campaignId: cid(it.row), label: prettyEnum(getField(it.row, path)), ...m(it) });
  const audiences = {
    age: pick('age').map(label('ad_group_criterion.age_range.type')),
    gender: pick('gender').map(label('ad_group_criterion.gender.type')),
    device: pick('device').map(label('segments.device')),
    segment: pick('segment').map(label('campaign_criterion.display_name')),
  };

  const creatives = [];
  for (const it of pick('videos')) {
    const rate = (field) => {
      const v = getField(it.row, field);
      return v == null ? null : Number(v);
    };
    creatives.push({
      campaignId: cid(it.row),
      id: String(getField(it.row, 'video.id')),
      kind: 'VIDEO',
      name: getField(it.row, 'video.title') || 'Video',
      ...m(it),
      views: got.videos.usedOptional.includes('metrics.video_views') ? num(getField(it.row, 'metrics.video_views')) : null,
      p25: rate('metrics.video_quartile_p25_rate'),
      p50: rate('metrics.video_quartile_p50_rate'),
      p75: rate('metrics.video_quartile_p75_rate'),
      p100: rate('metrics.video_quartile_p100_rate'),
    });
  }
  if (!creatives.length && got.videoAssets) {
    const seen = new Set();
    for (const it of got.videoAssets.items) {
      const id = String(getField(it.row, 'asset.id'));
      const key = `${cid(it.row)}|${id}`;
      if (seen.has(key)) continue; // remove duplicates
      seen.add(key);
      creatives.push({ campaignId: cid(it.row), id, kind: 'VIDEO', name: getField(it.row, 'asset.name') || 'Video', ...m(it), views: null, p25: null, p50: null, p75: null, p100: null });
    }
  }
  for (const ad of ads.slice(0, 40)) {
    const camp = campaigns.get(ad.campaignId);
    if (camp && camp.type !== 'DEMAND_GEN' && camp.type !== 'VIDEO') {
      creatives.push({ campaignId: ad.campaignId, id: ad.id, kind: 'AD', name: ad.name, s: ad.s, i: ad.i, k: ad.k, v: ad.v, r: ad.r });
    }
  }

  return {
    version: DATA_VERSION,
    demo: false,
    generatedAt: now.toISOString(),
    client: {
      name: client.name,
      resultLabel: client.resultLabel,
      timezone: client.timezone,
      currency: client.currency || 'USD',
      goals: client.goals,
      showRevenue: !!(client.goals && client.goals.roas > 0),
    },
    range: { preset: range.preset, key: range.key, start: range.start, end: range.end, prevStart: range.prevStart, prevEnd: range.prevEnd, days: range.days },
    campaigns: [...campaigns.values()],
    facts,
    adGroups,
    ads,
    keywords,
    searchTerms,
    audiences,
    creatives,
    warnings,
  };
}

/** "AGE_RANGE_25_34" -> "25-34", "MOBILE" -> "Mobile" */
export function prettyEnum(value) {
  const s = String(value ?? '');
  if (!s) return 'Unknown';
  const age = s.match(/^AGE_RANGE_(\d+)_(\d+)$/);
  if (age) return `${age[1]}-${age[2]}`;
  if (s === 'AGE_RANGE_65_UP') return '65+';
  if (s === 'AGE_RANGE_UNDETERMINED') return 'Unknown';
  if (/^[A-Z_]+$/.test(s)) return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
  return s;
}
