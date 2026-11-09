// Realistic SAMPLE data, used until Google Ads access is approved.
// Nothing here is real. The report shows a "Sample data" notice whenever it is used.
//
// Each day's numbers depend only on the client, the campaign and the date, so the same day shows
// the same figures in the 7, 30 and 90 day views.

import { DATA_VERSION, addDays, diffDays, weekdayIndex, derive, sumRows } from '../../src/lib/calc.mjs';

// ---------- seeded random numbers ----------

function hash(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function rng(seedText) {
  let a = hash(seedText)();
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Round up or down at random so that, on average, the total stays right. */
function randomRound(x, rand) {
  const f = Math.floor(x);
  return f + (rand() < x - f ? 1 : 0);
}

// ---------- sample profiles ----------

const PROFILES = {
  mealprep: {
    dailySpend: 60,
    revenuePerResult: 120,
    weekday: [1.15, 1.05, 1.0, 0.95, 0.88, 0.85, 1.12],
    campaigns: [
      { id: '1001', name: 'Meal Prep | Search | San Diego', type: 'SEARCH', share: 0.36, cpc: 2.6, ctr: 0.07, rate: 0.058, status: 'ENABLED' },
      { id: '1002', name: 'Meal Prep | Performance Max', type: 'PERFORMANCE_MAX', share: 0.36, cpc: 1.7, ctr: 0.021, rate: 0.034, status: 'ENABLED' },
      { id: '1003', name: 'Founder Story | Demand Gen Video', type: 'DEMAND_GEN', share: 0.17, cpc: 1.35, ctr: 0.011, rate: 0.027, status: 'ENABLED' },
      { id: '1004', name: 'Brand | Search', type: 'SEARCH', share: 0.08, cpc: 1.1, ctr: 0.2, rate: 0.115, status: 'ENABLED' },
      { id: '1005', name: 'Holiday Trial Offer | Search', type: 'SEARCH', share: 0.0, cpc: 2.9, ctr: 0.06, rate: 0.07, status: 'PAUSED', endedDaysAgo: 40 },
    ],
    adGroups: {
      SEARCH: ['Meal prep delivery', 'Healthy meals near me', 'Weekly meal plans'],
      PERFORMANCE_MAX: ['Asset group: Signature meals', 'Asset group: Family plans'],
      DEMAND_GEN: ['Founder story', 'Customer stories'],
    },
    keywords: [
      ['meal prep san diego', 'EXACT'], ['meal prep delivery san diego', 'PHRASE'], ['healthy meal delivery', 'PHRASE'],
      ['weekly meal prep service', 'BROAD'], ['prepared meals san diego', 'EXACT'], ['meal prep subscription', 'PHRASE'],
      ['fresh meals delivered', 'BROAD'], ['high protein meal prep', 'PHRASE'], ['pure meal prep', 'EXACT'], ['meal prep near me', 'BROAD'],
    ],
    searchTerms: [
      'meal prep san diego', 'meal delivery san diego', 'healthy meal prep delivery', 'best meal prep service san diego', 'prepared meals delivered',
      'meal prep subscription', 'weekly meal plan delivery', 'high protein meals delivered', 'pure meal prep reviews', 'meal prep pickup san diego',
      'cheap meal prep', 'meal prep recipes', 'meal prep containers',
    ],
    ads: ['Fresh Meals, Ready Weekly', 'Local San Diego Meal Prep', 'Skip the Cooking, Keep the Health', 'Meet the Founder', 'Chef-Made, Delivered Fresh'],
    videos: ['Founder story: why we started', 'Behind the kitchen', 'A week of meals in 30 seconds'],
  },
  bookkeeping: {
    dailySpend: 49,
    revenuePerResult: 0,
    weekday: [1.15, 1.2, 1.15, 1.1, 0.95, 0.5, 0.45],
    campaigns: [
      { id: '2001', name: 'Bookkeeping Services | Search', type: 'SEARCH', share: 0.52, cpc: 4.1, ctr: 0.058, rate: 0.017, status: 'ENABLED' },
      { id: '2002', name: 'Small Business Accounting | Search', type: 'SEARCH', share: 0.3, cpc: 5.2, ctr: 0.047, rate: 0.012, status: 'ENABLED' },
      { id: '2003', name: 'Lead Gen | Performance Max', type: 'PERFORMANCE_MAX', share: 0.18, cpc: 2.8, ctr: 0.016, rate: 0.0, status: 'ENABLED' },
    ],
    adGroups: {
      SEARCH: ['Monthly bookkeeping', 'QuickBooks cleanup', 'Small business accountant'],
      PERFORMANCE_MAX: ['Asset group: Bookkeeping leads'],
    },
    keywords: [
      ['bookkeeping services', 'PHRASE'], ['small business bookkeeper', 'EXACT'], ['quickbooks bookkeeper near me', 'PHRASE'],
      ['monthly bookkeeping', 'EXACT'], ['catch up bookkeeping', 'PHRASE'], ['bookkeeper for llc', 'BROAD'],
      ['outsourced bookkeeping', 'PHRASE'], ['accounting services small business', 'BROAD'], ['cleanup quickbooks file', 'PHRASE'], ['freelancer bookkeeping', 'BROAD'],
    ],
    searchTerms: [
      'bookkeeping services', 'small business bookkeeper', 'bookkeeper near me', 'online bookkeeping services', 'quickbooks cleanup help',
      'monthly bookkeeping cost', 'bookkeeping for llc', 'hire a bookkeeper', 'bookkeeping jobs', 'free bookkeeping software',
      'how to do bookkeeping', 'bookkeeper salary', 'tax preparation near me',
    ],
    ads: ['Bookkeeping Done for You', 'Clean Books, Clear Decisions', 'QuickBooks Cleanup Experts', 'Your Books, Up to Date', 'Small Business Bookkeeping'],
    videos: [],
  },
};

const AGE_BUCKETS = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
const GENDERS = ['Female', 'Male', 'Unknown'];
const DEVICES = ['Mobile', 'Desktop', 'Tablet'];
const SEGMENTS = ['In-market: Meal delivery', 'Fitness enthusiasts', 'Your website visitors', 'Similar to past customers'];
const SEGMENTS_BK = ['In-market: Accounting services', 'Small business owners', 'Your website visitors', 'Similar to past leads'];

// ---------- facts (one row per campaign per day) ----------

function dayFacts(profile, client, campaign, date, progress) {
  const rand = rng(`${client.id}|${campaign.id}|${date}`);
  if (campaign.endedDaysAgo != null) {
    // Paused campaigns only have activity before they were paused.
    if (date > client._demoPauseCutoff) return null;
  }
  const baseShare = campaign.endedDaysAgo != null ? 0.12 : campaign.share;
  const noise = 0.82 + rand() * 0.36;
  const trend = 0.9 + 0.2 * progress;
  const spend = profile.dailySpend * baseShare * profile.weekday[weekdayIndex(date)] * noise * trend;
  if (spend < 0.5) return null;
  const clicks = randomRound(spend / (campaign.cpc * (0.92 + rand() * 0.16)), rand);
  const impressions = Math.max(clicks, randomRound(clicks / (campaign.ctr * (0.9 + rand() * 0.2)), rand));
  // Results get a little better over time so the report has a story to tell.
  const rate = campaign.rate * (0.9 + 0.2 * progress) * (0.7 + rand() * 0.6);
  const results = randomRound(clicks * rate, rand);
  const revenue = profile.revenuePerResult ? Math.round(results * profile.revenuePerResult * (0.85 + rand() * 0.3)) : 0;
  return { d: date, c: campaign.id, s: Math.round(spend * 100) / 100, i: impressions, k: clicks, v: results, r: revenue };
}

// ---------- splitting a campaign's totals into smaller pieces ----------

function splitTotals(totals, weights, rand) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const parts = weights.map((w) => {
    const share = (w / sum) * (0.85 + rand() * 0.3);
    return share;
  });
  const total = parts.reduce((a, b) => a + b, 0);
  const pieces = parts.map((p) => {
    const f = p / total;
    return {
      s: Math.round(totals.spend * f * 100) / 100,
      i: Math.round(totals.impressions * f),
      k: Math.round(totals.clicks * f),
      v: Math.round(totals.results * f),
      r: Math.round(totals.revenue * f),
    };
  });
  // Put any rounding difference on the biggest piece so the pieces add up to the campaign.
  const big = pieces.reduce((bi, p, idx) => (p.s > pieces[bi].s ? idx : bi), 0);
  const fix = (key, want) => {
    const have = pieces.reduce((a, p) => a + p[key], 0);
    pieces[big][key] += want - have;
    if (pieces[big][key] < 0) pieces[big][key] = 0;
  };
  fix('i', totals.impressions);
  fix('k', totals.clicks);
  fix('v', totals.results);
  fix('r', totals.revenue);
  pieces[big].s = Math.round((pieces[big].s + (totals.spend - pieces.reduce((a, p) => a + p.s, 0))) * 100) / 100;
  return pieces;
}

// ---------- the main builder ----------

export function buildDemoPayload(client, range, now = new Date()) {
  const profile = PROFILES[client.sampleProfile] || PROFILES.mealprep;
  const campaignsDef = profile.campaigns;
  const demoClient = { ...client, _demoPauseCutoff: addDays(range.start, -Math.max(10, Math.round(range.days / 2))) };

  // Facts for the previous period and the current one.
  const first = range.prevStart;
  const total = diffDays(first, range.end);
  const facts = [];
  for (let n = 0; n <= total; n++) {
    const date = addDays(first, n);
    const progress = total ? n / total : 1;
    for (const c of campaignsDef) {
      const row = dayFacts(profile, demoClient, c, date, progress);
      if (row) facts.push(row);
    }
  }

  const campaigns = campaignsDef.map((c) => ({ id: c.id, name: c.name, type: c.type, status: c.status }));
  const curFacts = facts.filter((f) => f.d >= range.start && f.d <= range.end);
  const byCampaign = new Map();
  for (const c of campaignsDef) {
    const m = sumRows(curFacts.filter((f) => f.c === c.id));
    byCampaign.set(c.id, m);
  }

  const adGroups = [];
  const ads = [];
  const keywords = [];
  const searchTerms = [];
  const age = [];
  const gender = [];
  const device = [];
  const segment = [];
  const creatives = [];
  let adCounter = 0;

  for (const c of campaignsDef) {
    const totals = byCampaign.get(c.id);
    if (totals.spend === 0) continue;
    const rand = rng(`${client.id}|${c.id}|${range.key}|detail`);

    // Ad groups, and ads inside them
    const groupNames = profile.adGroups[c.type] || ['Main'];
    const groupParts = splitTotals(totals, groupNames.map((_, idx) => 1 / (idx + 1)), rand);
    groupNames.forEach((name, gi) => {
      const g = groupParts[gi];
      const gid = `${c.id}-g${gi + 1}`;
      adGroups.push({ campaignId: c.id, id: gid, name, ...g });
      const adCount = 2;
      const adParts = splitTotals({ spend: g.s, impressions: g.i, clicks: g.k, results: g.v, revenue: g.r }, [1.4, 1], rand);
      for (let ai = 0; ai < adCount; ai++) {
        const n = adCounter++;
        const adName = profile.ads[n % profile.ads.length] + (n >= profile.ads.length ? ` ${Math.floor(n / profile.ads.length) + 1}` : '');
        ads.push({ campaignId: c.id, adGroupId: gid, id: `${gid}-a${ai + 1}`, name: adName, ...adParts[ai] });
      }
    });

    // Keywords and search terms (Search campaigns only)
    if (c.type === 'SEARCH') {
      const kwList = profile.keywords.slice(c.id.endsWith('4') ? 8 : 0, c.id.endsWith('4') ? 10 : 8);
      const kwParts = splitTotals(totals, kwList.map((_, idx) => 1 / (idx + 1.2)), rand);
      kwList.forEach(([text, match], idx) => {
        keywords.push({ campaignId: c.id, adGroupId: `${c.id}-g1`, text, match, ...kwParts[idx], r: 0 });
      });
      const stList = profile.searchTerms.slice(0, 11);
      const stParts = splitTotals(totals, stList.map((_, idx) => 1 / (idx + 1)), rand);
      stList.forEach((text, idx) => {
        const piece = stParts[idx];
        // A few search terms spend money without ever producing a result.
        const wasted = idx >= 8 && idx % 2 === 0;
        searchTerms.push({ campaignId: c.id, text, ...piece, v: wasted ? 0 : piece.v, r: 0 });
      });
    }

    // Audiences: each view splits the campaign's totals a different way.
    const ageParts = splitTotals(totals, [0.6, 2.2, 2.4, 1.8, 1.1, 0.5], rand);
    AGE_BUCKETS.forEach((label, idx) => age.push({ campaignId: c.id, label, ...ageParts[idx] }));
    const genderParts = splitTotals(totals, client.sampleProfile === 'mealprep' ? [3.2, 1.6, 0.4] : [2, 2.6, 0.4], rand);
    GENDERS.forEach((label, idx) => gender.push({ campaignId: c.id, label, ...genderParts[idx] }));
    const deviceParts = splitTotals(totals, client.sampleProfile === 'mealprep' ? [3.4, 1.4, 0.3] : [1.6, 2.6, 0.2], rand);
    DEVICES.forEach((label, idx) => device.push({ campaignId: c.id, label, ...deviceParts[idx] }));
    if (c.type !== 'SEARCH') {
      const labels = client.sampleProfile === 'mealprep' ? SEGMENTS : SEGMENTS_BK;
      const segParts = splitTotals(totals, [2, 1.6, 1.2, 1], rand);
      labels.forEach((label, idx) => segment.push({ campaignId: c.id, label, ...segParts[idx] }));
    }

    // Creative: videos for Demand Gen, ads for everything else.
    if (c.type === 'DEMAND_GEN' && profile.videos.length) {
      const vParts = splitTotals(totals, profile.videos.map((_, idx) => 1 / (idx + 1)), rand);
      profile.videos.forEach((name, idx) => {
        const p = vParts[idx];
        const viewRate = 0.22 + rand() * 0.18;
        const views = Math.round(p.i * viewRate);
        const q25 = 0.58 + rand() * 0.12;
        creatives.push({
          campaignId: c.id,
          id: `${c.id}-v${idx + 1}`,
          kind: 'VIDEO',
          name,
          ...p,
          views,
          p25: q25,
          p50: q25 * (0.66 + rand() * 0.08),
          p75: q25 * (0.42 + rand() * 0.08),
          p100: q25 * (0.24 + rand() * 0.06),
        });
      });
    } else {
      for (const ad of ads.filter((a) => a.campaignId === c.id).slice(0, 3)) {
        creatives.push({ campaignId: c.id, id: ad.id, kind: 'AD', name: ad.name, s: ad.s, i: ad.i, k: ad.k, v: ad.v, r: ad.r });
      }
    }
  }

  return {
    version: DATA_VERSION,
    demo: true,
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
    campaigns,
    facts,
    adGroups,
    ads,
    keywords,
    searchTerms,
    audiences: { age, gender, device, segment },
    creatives,
  };
}

// Handy for quick checks in the terminal.
export function demoSummary(payload) {
  const cur = derive(sumRows(payload.facts.filter((f) => f.d >= payload.range.start && f.d <= payload.range.end)));
  return { spend: Math.round(cur.spend), results: cur.results, costPerResult: cur.costPerResult && Math.round(cur.costPerResult * 100) / 100 };
}
