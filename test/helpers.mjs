// Shared test helpers: a tiny fake Google Ads, a fake saved-report store, and a small report payload.

export function fakeKV() {
  const data = new Map();
  return {
    data,
    async get(key, type) {
      const v = data.get(key);
      return v == null ? null : type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      data.set(key, value);
    },
  };
}

export const ENV = {
  GOOGLE_ADS_CLIENT_ID: 'id',
  GOOGLE_ADS_CLIENT_SECRET: 'secret',
  GOOGLE_ADS_REFRESH_TOKEN: 'refresh',
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: '123-456-7890',
  GOOGLE_ADS_API_VERSION: 'v25',
};

export const REAL_CLIENT = {
  id: 'acme',
  name: 'Acme',
  linkKey: 'acme-abc123',
  customerId: '987-654-3210',
  timezone: 'America/Los_Angeles',
  currency: 'USD',
  resultLabel: { one: 'lead', many: 'leads' },
  conversionActions: ['Form submission'],
  goals: { costPerResult: 50, monthlyBudget: 1500, monthlyResults: 30, roas: 0 },
  active: true,
};

/**
 * A pretend Google. Answers the token request and each searchStream query by looking at the query text.
 * `calls` records everything that was asked, so tests can check headers and counts.
 */
export function fakeGoogle({ failOn = [], rateLimitFirst = false } = {}) {
  const calls = [];
  let limited = false;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  async function fetchImpl(url, init = {}) {
    calls.push({ url: String(url), init });
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      return json({ access_token: 'tok-' + calls.length, expires_in: 3600 });
    }
    const query = JSON.parse(init.body).query;
    if (rateLimitFirst && !limited) {
      limited = true;
      return json({ error: { status: 'RESOURCE_EXHAUSTED' } }, 429);
    }
    for (const needle of failOn) {
      if (query.includes(needle)) {
        return json({ error: { code: 400, message: 'bad', details: [{ errors: [{ errorCode: { queryError: 'PROHIBITED_FIELD_IN_SELECT_CLAUSE' }, message: 'Prohibited' }] }] } }, 400);
      }
    }
    const isConv = query.includes('segments.conversion_action_name');
    const row = (extra) => ({ results: [extra] });
    if (query.includes('FROM campaign ') && query.includes('campaign.advertising_channel_type')) {
      const base = { campaign: { id: '11', name: 'Brand | Search', advertisingChannelType: 'SEARCH', status: 'ENABLED' }, segments: { date: '2026-11-01' } };
      if (isConv) {
        return json([
          { results: [{ ...base, segments: { ...base.segments, conversionActionName: 'Form submission' }, metrics: { conversions: 2.5, conversionsValue: 0 } }] },
          { results: [{ ...base, segments: { ...base.segments, conversionActionName: 'Phone call click' }, metrics: { conversions: 9, conversionsValue: 0 } }] },
        ]);
      }
      return json([{ results: [{ ...base, metrics: { costMicros: '12340000', impressions: '1000', clicks: '40' } }] }]);
    }
    if (query.includes('FROM ad_group ')) {
      const base = { campaign: { id: '11' }, adGroup: { id: '21', name: 'Group A' } };
      return json([row(isConv ? { ...base, segments: { conversionActionName: 'Form submission' }, metrics: { conversions: 1, conversionsValue: 0 } } : { ...base, metrics: { costMicros: '5000000', impressions: '400', clicks: '10' } })]);
    }
    return json([{ results: [] }]);
  }
  return { fetchImpl, calls };
}

/** A small hand-made report: two campaigns over a 14 day range, plus the 14 days before it. */
export function tinyPayload() {
  const facts = [];
  // previous period: 2026-10-12 .. 2026-10-25 ; current: 2026-10-26 .. 2026-11-08
  const add = (d, c, s, i, k, v, r = 0) => facts.push({ d, c, s, i, k, v, r });
  for (let n = 0; n < 14; n++) {
    const prev = new Date(Date.UTC(2026, 9, 12 + n)).toISOString().slice(0, 10);
    const cur = new Date(Date.UTC(2026, 9, 26 + n)).toISOString().slice(0, 10);
    add(prev, 'A', 50, 1000, 50, 2);
    add(prev, 'B', 50, 1000, 50, 2);
    add(cur, 'A', 50, 1200, 60, 4);
    add(cur, 'B', 50, 800, 40, 0);
  }
  return {
    version: 1,
    demo: false,
    generatedAt: '2026-11-09T12:00:00Z',
    client: { name: 'Acme', resultLabel: { one: 'lead', many: 'leads' }, timezone: 'America/Los_Angeles', currency: 'USD', goals: { costPerResult: 20, monthlyBudget: 3000, monthlyResults: 100, roas: 0 } },
    range: { preset: 'custom', key: 'c_x', start: '2026-10-26', end: '2026-11-08', prevStart: '2026-10-12', prevEnd: '2026-10-25', days: 14 },
    campaigns: [
      { id: 'A', name: 'Alpha | Search', type: 'SEARCH', status: 'ENABLED' },
      { id: 'B', name: 'Beta | Performance Max', type: 'PERFORMANCE_MAX', status: 'ENABLED' },
    ],
    facts,
    adGroups: [], ads: [], keywords: [], searchTerms: [], audiences: {}, creatives: [],
  };
}
