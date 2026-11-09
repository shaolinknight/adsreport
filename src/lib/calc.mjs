// All the number logic for the report lives here, so it can be tested.
// The browser and the tests both import this file.
//
// A saved report ("payload") holds small "fact" rows: one row per campaign per day.
//   d = date, c = campaign id, s = spend, i = impressions, k = clicks, v = results, r = revenue
// Everything on the page (totals, trend, weeks, weekdays) is added up from those rows,
// which is what lets the campaign-type filter work on every tab.

export const DATA_VERSION = 1;

export const TYPE_LABELS = {
  SEARCH: 'Search',
  PERFORMANCE_MAX: 'Performance Max',
  DEMAND_GEN: 'Demand Gen',
  VIDEO: 'YouTube',
  SHOPPING: 'Shopping',
  OTHER: 'Other',
};

// ---------- dates (plain YYYY-MM-DD strings, no time zones involved) ----------

function toUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  return fromUTC(toUTC(iso) + n * 86400000);
}

/** Number of days from a to b (b - a). */
export function diffDays(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

/** 0 = Monday ... 6 = Sunday */
export function weekdayIndex(iso) {
  const js = new Date(toUTC(iso)).getUTCDay(); // 0 = Sunday
  return (js + 6) % 7;
}

export function weekStart(iso) {
  return addDays(iso, -weekdayIndex(iso));
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ---------- totals and derived numbers ----------

export function emptyMetrics() {
  return { spend: 0, impressions: 0, clicks: 0, results: 0, revenue: 0 };
}

export function addRow(m, row) {
  m.spend += row.s || 0;
  m.impressions += row.i || 0;
  m.clicks += row.k || 0;
  m.results += row.v || 0;
  m.revenue += row.r || 0;
  return m;
}

export function sumRows(rows) {
  const m = emptyMetrics();
  for (const row of rows) addRow(m, row);
  return m;
}

/** Add the ratios people care about. Anything that would divide by zero is null, never 0 or Infinity. */
export function derive(m) {
  return {
    ...m,
    ctr: m.impressions > 0 ? m.clicks / m.impressions : null,
    cpc: m.clicks > 0 ? m.spend / m.clicks : null,
    costPerResult: m.results > 0 ? m.spend / m.results : null,
    resultRate: m.clicks > 0 ? m.results / m.clicks : null,
    roas: m.spend > 0 && m.revenue > 0 ? m.revenue / m.spend : null,
  };
}

/** Change against the previous period as a ratio (0.1 = +10%). Null when there is nothing to compare. */
export function change(cur, prev) {
  if (cur == null || prev == null) return null;
  if (prev === 0) return cur === 0 ? 0 : null;
  return (cur - prev) / prev;
}

// Which direction is good for the client. "neutral" means we do not colour it.
export const GOOD_DIRECTION = {
  spend: 'neutral',
  impressions: 'up',
  clicks: 'up',
  ctr: 'up',
  cpc: 'down',
  results: 'up',
  costPerResult: 'down',
  resultRate: 'up',
  roas: 'up',
  revenue: 'up',
};

/** 'good' | 'bad' | 'flat' | 'neutral' for a metric that moved by `chg`. Under 1% counts as flat. */
export function tone(metric, chg) {
  if (chg == null) return 'flat';
  if (Math.abs(chg) < 0.01) return 'flat';
  const dir = GOOD_DIRECTION[metric] ?? 'neutral';
  if (dir === 'neutral') return 'neutral';
  const up = chg > 0;
  return (dir === 'up') === up ? 'good' : 'bad';
}

// ---------- filtering by campaign type ----------

export function campaignIdsForType(payload, type) {
  if (!type || type === 'ALL') return null; // null = everything
  return new Set(payload.campaigns.filter((c) => c.type === type).map((c) => c.id));
}

export function typesPresent(payload) {
  const seen = new Set(payload.campaigns.map((c) => c.type));
  return Object.keys(TYPE_LABELS).filter((t) => seen.has(t));
}

function inScope(ids, campaignId) {
  return ids == null || ids.has(campaignId);
}

export function factsFor(payload, type, from, to) {
  const ids = campaignIdsForType(payload, type);
  return payload.facts.filter((f) => f.d >= from && f.d <= to && inScope(ids, f.c));
}

export function rowsFor(list, payload, type) {
  const ids = campaignIdsForType(payload, type);
  return (list || []).filter((r) => inScope(ids, r.campaignId));
}

export function periodTotals(payload, type) {
  const { start, end, prevStart, prevEnd } = payload.range;
  const cur = derive(sumRows(factsFor(payload, type, start, end)));
  const prev = derive(sumRows(factsFor(payload, type, prevStart, prevEnd)));
  return { cur, prev };
}

// ---------- daily trend ----------

/** One entry per day in the range, with the matching day of the previous range alongside. */
export function dailySeries(payload, type) {
  const { start, end, prevStart } = payload.range;
  const days = diffDays(start, end) + 1;
  const curByDay = new Map();
  const prevByDay = new Map();
  for (const f of factsFor(payload, type, start, end)) {
    if (!curByDay.has(f.d)) curByDay.set(f.d, emptyMetrics());
    addRow(curByDay.get(f.d), f);
  }
  const { prevEnd } = payload.range;
  for (const f of factsFor(payload, type, prevStart, prevEnd)) {
    if (!prevByDay.has(f.d)) prevByDay.set(f.d, emptyMetrics());
    addRow(prevByDay.get(f.d), f);
  }
  const out = [];
  for (let n = 0; n < days; n++) {
    const date = addDays(start, n);
    const prevDate = addDays(prevStart, n);
    out.push({
      date,
      prevDate,
      cur: derive(curByDay.get(date) || emptyMetrics()),
      prev: derive(prevByDay.get(prevDate) || emptyMetrics()),
    });
  }
  return out;
}

// ---------- week by week ----------

/**
 * Monday-to-Sunday weeks that touch the range. A week is "full" only when all 7 days
 * fall inside the range. Best and weakest are picked among full weeks only, by cost per result.
 */
export function weeklyTable(payload, type) {
  const { start, end } = payload.range;
  const weeks = [];
  let ws = weekStart(start);
  while (ws <= end) {
    const we = addDays(ws, 6);
    const from = ws < start ? start : ws;
    const to = we > end ? end : we;
    const full = ws >= start && we <= end;
    const m = derive(sumRows(factsFor(payload, type, from, to)));
    weeks.push({ start: ws, end: we, from, to, full, ...m });
    ws = addDays(ws, 7);
  }
  const candidates = weeks.filter((w) => w.full && w.results > 0 && w.costPerResult != null);
  let best = null;
  let weakest = null;
  if (candidates.length >= 2) {
    best = candidates.reduce((a, b) => (b.costPerResult < a.costPerResult ? b : a));
    weakest = candidates.reduce((a, b) => (b.costPerResult > a.costPerResult ? b : a));
    if (best === weakest) best = weakest = null;
  }
  return { weeks, bestStart: best?.start ?? null, weakestStart: weakest?.start ?? null };
}

/** Average per day for each weekday, so a range with 5 Mondays and 4 Tuesdays stays fair. */
export function dayOfWeek(payload, type) {
  const { start, end } = payload.range;
  const sums = Array.from({ length: 7 }, () => emptyMetrics());
  const counts = Array(7).fill(0);
  const byDay = new Map();
  for (const f of factsFor(payload, type, start, end)) {
    if (!byDay.has(f.d)) byDay.set(f.d, emptyMetrics());
    addRow(byDay.get(f.d), f);
  }
  const days = diffDays(start, end) + 1;
  for (let n = 0; n < days; n++) {
    const date = addDays(start, n);
    const w = weekdayIndex(date);
    counts[w] += 1;
    const m = byDay.get(date);
    if (m) {
      sums[w].spend += m.spend;
      sums[w].impressions += m.impressions;
      sums[w].clicks += m.clicks;
      sums[w].results += m.results;
      sums[w].revenue += m.revenue;
    }
  }
  return WEEKDAYS.map((label, w) => ({
    label,
    days: counts[w],
    avgResults: counts[w] ? sums[w].results / counts[w] : 0,
    avgSpend: counts[w] ? sums[w].spend / counts[w] : 0,
    totalResults: sums[w].results,
    totalSpend: sums[w].spend,
  }));
}

// ---------- campaigns ----------

/** Ranked by results (most first), then by cost per result (lowest first). Campaigns with no activity are left out. */
export function campaignTable(payload, type) {
  const { start, end, prevStart, prevEnd } = payload.range;
  const ids = campaignIdsForType(payload, type);
  const rows = [];
  for (const c of payload.campaigns) {
    if (!inScope(ids, c.id)) continue;
    const cur = derive(sumRows(payload.facts.filter((f) => f.c === c.id && f.d >= start && f.d <= end)));
    if (cur.spend === 0 && cur.impressions === 0) continue;
    const prev = derive(sumRows(payload.facts.filter((f) => f.c === c.id && f.d >= prevStart && f.d <= prevEnd)));
    rows.push({ ...c, cur, prev });
  }
  rows.sort((a, b) => {
    if (b.cur.results !== a.cur.results) return b.cur.results - a.cur.results;
    const ac = a.cur.costPerResult ?? Infinity;
    const bc = b.cur.costPerResult ?? Infinity;
    if (ac !== bc) return ac - bc;
    return b.cur.spend - a.cur.spend;
  });
  return rows;
}

/** Group detail rows (ad groups, keywords, ...) by a key and add up their numbers. */
export function groupRows(rows, keyFn, extra = () => ({})) {
  const map = new Map();
  for (const r of rows) {
    const key = keyFn(r);
    if (!map.has(key)) map.set(key, { key, ...emptyMetrics(), ...extra(r) });
    const m = map.get(key);
    m.spend += r.s || 0;
    m.impressions += r.i || 0;
    m.clicks += r.k || 0;
    m.results += r.v || 0;
    m.revenue += r.r || 0;
  }
  return [...map.values()].map((m) => ({ ...m, ...derive(m), key: m.key }));
}

export function rankByResults(list) {
  return [...list].sort((a, b) => {
    if (b.results !== a.results) return b.results - a.results;
    const ac = a.costPerResult ?? Infinity;
    const bc = b.costPerResult ?? Infinity;
    if (ac !== bc) return ac - bc;
    return b.spend - a.spend;
  });
}

// ---------- goals ----------

export const DAYS_PER_MONTH = 30.4;

/**
 * Compare the numbers with the client's goals. Each goal gets a status of green, amber or red.
 *
 * TO TUNE: the thresholds below decide when a goal turns amber or red. They are the one place
 * where the "how strict should we be" choice lives. Change the numbers in THRESHOLDS and the
 * whole report follows.
 */
export const THRESHOLDS = {
  // Cost per result: green at or under goal, amber up to 15% over, red beyond that.
  costPerResultAmber: 1.15,
  // Results: green at or over the goal for the period, amber down to 85% of it.
  resultsAmber: 0.85,
  // Spend: green when 70% to 105% of the budget for the period, amber up to 120%, red beyond.
  spendLow: 0.7,
  spendAmber: 1.05,
  spendRed: 1.2,
  // Return on ad spend: green at or over goal, amber down to 85% of it.
  roasAmber: 0.85,
};

export function goalStatuses(cur, goals, days, resultLabel, thresholds) {
  const T = { ...THRESHOLDS, ...(thresholds || {}) };
  const out = [];
  if (!goals) return out;
  const factor = days / DAYS_PER_MONTH;

  if (goals.costPerResult > 0) {
    const v = cur.costPerResult;
    let status = 'nodata';
    if (v != null) status = v <= goals.costPerResult ? 'green' : v <= goals.costPerResult * T.costPerResultAmber ? 'amber' : 'red';
    out.push({ key: 'costPerResult', label: `Cost per ${resultLabel.one}`, value: v, goal: goals.costPerResult, status, kind: 'money', lowerIsBetter: true });
  }
  if (goals.monthlyResults > 0) {
    const target = goals.monthlyResults * factor;
    const v = cur.results;
    const status = v >= target ? 'green' : v >= target * T.resultsAmber ? 'amber' : 'red';
    out.push({ key: 'results', label: `${capitalize(resultLabel.many)}`, value: v, goal: target, status, kind: 'results' });
  }
  if (goals.monthlyBudget > 0) {
    const target = goals.monthlyBudget * factor;
    const v = cur.spend;
    let status = 'green';
    if (v > target * T.spendRed) status = 'red';
    else if (v > target * T.spendAmber) status = 'amber';
    else if (v < target * T.spendLow) status = 'amber';
    out.push({ key: 'spend', label: 'Spend vs budget', value: v, goal: target, status, kind: 'money' });
  }
  if (goals.roas > 0) {
    const v = cur.roas;
    let status = 'nodata';
    if (v != null) status = v >= goals.roas ? 'green' : v >= goals.roas * T.roasAmber ? 'amber' : 'red';
    out.push({ key: 'roas', label: 'Return on ad spend', value: v, goal: goals.roas, status, kind: 'ratio' });
  }
  return out;
}

export function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// ---------- plain-words summary, insights and next step ----------

function moneyText(n, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: n < 100 ? 2 : 0, minimumFractionDigits: n < 100 ? 2 : 0 }).format(n);
}

function numText(n) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(Math.round(n * 10) / 10);
}

function movement(chg, upWord, downWord) {
  if (chg == null || Math.abs(chg) < 0.01) return 'about the same as';
  return `${Math.abs(chg * 100).toFixed(0)}% ${chg > 0 ? upWord : downWord} than`;
}

/**
 * Build the 2-3 sentence summary, up to three insights and one next step.
 * Everything is plain words and uses the client's own word for a result.
 */
export function buildNarrative(payload, type) {
  const label = payload.client.resultLabel;
  const cur$ = payload.client.currency || 'USD';
  const days = diffDays(payload.range.start, payload.range.end) + 1;
  const { cur, prev } = periodTotals(payload, type);
  const campaigns = campaignTable(payload, type);
  const goals = goalStatuses(cur, payload.client.goals, days, label, payload.client.thresholds);

  if (cur.spend === 0 && cur.impressions === 0) {
    return {
      summary: 'No ads ran in this period, so there is nothing to report yet.',
      insights: [],
      nextStep: 'Check that the campaigns are switched on and that the date range is right.',
    };
  }

  const resultWord = cur.results === 1 ? label.one : label.many;
  const resChg = change(cur.results, prev.results);
  const cprChg = change(cur.costPerResult, prev.costPerResult);

  // Sentence 1: what happened.
  let s1 = `Over the last ${days} days, ${payload.client.name} spent ${moneyText(cur.spend, cur$)} and got ${numText(cur.results)} ${resultWord}`;
  if (cur.costPerResult != null) s1 += `, at ${moneyText(cur.costPerResult, cur$)} each`;
  s1 += '.';

  // Sentence 2: against the last period.
  let s2 = '';
  if (prev.results > 0 || prev.spend > 0) {
    const flat = resChg == null || Math.abs(resChg) < 0.01;
    if (flat) s2 = `That is about the same as the previous ${days} days`;
    else s2 = `That is ${Math.abs(resChg * 100).toFixed(0)}% ${resChg > 0 ? 'more' : 'fewer'} ${label.many} than the previous ${days} days`;
    if (cprChg != null && Math.abs(cprChg) >= 0.01) {
      s2 += `, and each ${label.one} cost ${Math.abs(cprChg * 100).toFixed(0)}% ${cprChg < 0 ? 'less' : 'more'}`;
    }
    s2 += '.';
  }

  // Sentence 3: goals.
  const reds = goals.filter((g) => g.status === 'red');
  const ambers = goals.filter((g) => g.status === 'amber');
  let s3 = '';
  if (goals.length) {
    if (reds.length === 0 && ambers.length === 0) s3 = 'Every goal is on track.';
    else if (reds.length) s3 = `${reds.length === 1 ? 'One goal needs' : `${reds.length} goals need`} attention: ${reds.map((g) => g.label.toLowerCase()).join(' and ')}.`;
    else s3 = `Most goals are on track; ${ambers.map((g) => g.label.toLowerCase()).join(' and ')} to keep an eye on.`;
  }

  // Insights, in order of importance.
  const insights = [];
  const spendTotal = cur.spend || 1;

  const wasted = campaigns
    .filter((c) => c.cur.results === 0 && c.cur.spend / spendTotal >= 0.05)
    .sort((a, b) => b.cur.spend - a.cur.spend)[0];
  if (wasted) {
    insights.push({
      tone: 'bad',
      text: `${wasted.name} spent ${moneyText(wasted.cur.spend, cur$)} (${Math.round((wasted.cur.spend / spendTotal) * 100)}% of the total) without a single ${label.one}.`,
      campaignId: wasted.id,
      kind: 'wasted',
    });
  }

  const withResults = campaigns.filter((c) => c.cur.results >= 3 && c.cur.costPerResult != null);
  if (withResults.length >= 2) {
    const best = withResults.reduce((a, b) => (b.cur.costPerResult < a.cur.costPerResult ? b : a));
    const worst = withResults.reduce((a, b) => (b.cur.costPerResult > a.cur.costPerResult ? b : a));
    if (best.id !== worst.id) {
      insights.push({
        tone: 'good',
        text: `${best.name} is your most efficient campaign at ${moneyText(best.cur.costPerResult, cur$)} per ${label.one}.`,
        campaignId: best.id,
        kind: 'best',
      });
      if (worst.cur.costPerResult >= best.cur.costPerResult * 1.5) {
        insights.push({
          tone: 'bad',
          text: `${worst.name} costs ${moneyText(worst.cur.costPerResult, cur$)} per ${label.one}, about ${(worst.cur.costPerResult / best.cur.costPerResult).toFixed(1)} times as much as ${best.name}.`,
          campaignId: worst.id,
          kind: 'worst',
        });
      }
    }
  } else if (withResults.length === 1) {
    insights.push({ tone: 'good', text: `${withResults[0].name} brought in most of the ${label.many}.`, campaignId: withResults[0].id, kind: 'best' });
  }

  if (resChg != null && Math.abs(resChg) >= 0.1 && prev.results > 0) {
    insights.push({
      tone: resChg > 0 ? 'good' : 'bad',
      text: `${capitalize(label.many)} are ${resChg > 0 ? 'up' : 'down'} ${Math.abs(resChg * 100).toFixed(0)}% on the previous ${days} days.`,
      kind: 'trend',
    });
  }

  const dow = dayOfWeek(payload, type);
  const maxDow = dow.reduce((a, b) => (b.avgResults > a.avgResults ? b : a));
  const avgDow = dow.reduce((s, d) => s + d.avgResults, 0) / 7;
  if (avgDow > 0 && maxDow.avgResults >= avgDow * 1.3 && days >= 28) {
    insights.push({
      tone: 'neutral',
      text: `${WEEKDAYS_LONG[WEEKDAYS.indexOf(maxDow.label)]} is the strongest day, with about ${numText(maxDow.avgResults)} ${maxDow.avgResults === 1 ? label.one : label.many} on an average ${WEEKDAYS_LONG[WEEKDAYS.indexOf(maxDow.label)]}.`,
      kind: 'weekday',
    });
  }

  // Next step: first matching rule wins.
  let nextStep = 'Keep the budget steady and let the data build up before making changes.';
  const costGoal = goals.find((g) => g.key === 'costPerResult');
  if (wasted) {
    nextStep = `Review ${wasted.name}: pause what is not working or move its budget to a campaign that is bringing in ${label.many}.`;
  } else if (costGoal && costGoal.status === 'red') {
    nextStep = `Cost per ${label.one} is above goal. Look at the weakest campaign and its search terms or audiences for spend that is not converting.`;
  } else if (goals.find((g) => g.key === 'results' && g.status === 'red')) {
    nextStep = `There are fewer ${label.many} than the goal calls for. Check whether the budget is limiting the best campaign.`;
  } else if (goals.find((g) => g.key === 'spend' && g.status === 'red')) {
    nextStep = 'Spend is running well over budget. Check daily budgets before the month ends.';
  } else if (insights.find((i) => i.kind === 'best') && costGoal && costGoal.status === 'green') {
    nextStep = `Things are on track. Consider a little more budget for the most efficient campaign and watch that cost per ${label.one} holds.`;
  }

  return { summary: [s1, s2, s3].filter(Boolean).join(' '), insights: insights.slice(0, 3), nextStep, goals };
}
