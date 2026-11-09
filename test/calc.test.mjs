import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, buildNarrative, campaignTable, change, dailySeries, dayOfWeek, derive, diffDays, goalStatuses,
  periodTotals, THRESHOLDS, tone, typesPresent, weekdayIndex, weekStart, weeklyTable,
} from '../src/lib/calc.mjs';
import { tinyPayload } from './helpers.mjs';

test('date maths works on plain date strings', () => {
  assert.equal(addDays('2026-11-08', 1), '2026-11-09');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01'); // daylight saving cannot move a date
  assert.equal(diffDays('2026-10-12', '2026-10-25'), 13);
  assert.equal(weekdayIndex('2026-11-09'), 0); // Monday
  assert.equal(weekdayIndex('2026-11-08'), 6); // Sunday
  assert.equal(weekStart('2026-11-08'), '2026-11-02');
});

test('derive never divides by zero', () => {
  const d = derive({ spend: 0, impressions: 0, clicks: 0, results: 0, revenue: 0 });
  assert.equal(d.ctr, null);
  assert.equal(d.cpc, null);
  assert.equal(d.costPerResult, null);
  assert.equal(d.resultRate, null);
  assert.equal(d.roas, null);
  const e = derive({ spend: 100, impressions: 1000, clicks: 50, results: 4, revenue: 300 });
  assert.equal(e.ctr, 0.05);
  assert.equal(e.cpc, 2);
  assert.equal(e.costPerResult, 25);
  assert.equal(e.resultRate, 0.08);
  assert.equal(e.roas, 3);
});

test('change compares with the previous period', () => {
  assert.equal(change(110, 100), 0.1);
  assert.equal(change(50, 100), -0.5);
  assert.equal(change(0, 0), 0);
  assert.equal(change(5, 0), null); // growth from nothing has no percentage
  assert.equal(change(null, 5), null);
});

test('green means good for the client: lower cost per result is good, higher is bad', () => {
  assert.equal(tone('costPerResult', -0.1), 'good');
  assert.equal(tone('costPerResult', 0.1), 'bad');
  assert.equal(tone('results', 0.1), 'good');
  assert.equal(tone('results', -0.1), 'bad');
  assert.equal(tone('cpc', -0.2), 'good');
  assert.equal(tone('spend', 0.5), 'neutral'); // spend going up is neither good nor bad
  assert.equal(tone('results', 0.004), 'flat');
  assert.equal(tone('results', null), 'flat');
});

test('totals add up this period and the previous period separately', () => {
  const { cur, prev } = periodTotals(tinyPayload(), 'ALL');
  assert.equal(cur.spend, 1400);
  assert.equal(cur.results, 56);
  assert.equal(prev.results, 56);
  assert.equal(cur.costPerResult, 25);
});

test('the campaign type filter changes every total', () => {
  const p = tinyPayload();
  const search = periodTotals(p, 'SEARCH').cur;
  assert.equal(search.results, 56);
  assert.equal(search.spend, 700);
  const pmax = periodTotals(p, 'PERFORMANCE_MAX').cur;
  assert.equal(pmax.results, 0);
  assert.equal(pmax.costPerResult, null);
  assert.deepEqual(typesPresent(p), ['SEARCH', 'PERFORMANCE_MAX']);
});

test('daily series lines each day up with the same day of the previous period', () => {
  const s = dailySeries(tinyPayload(), 'ALL');
  assert.equal(s.length, 14);
  assert.equal(s[0].date, '2026-10-26');
  assert.equal(s[0].prevDate, '2026-10-12');
  assert.equal(s[13].date, '2026-11-08');
  assert.equal(s[0].cur.spend, 100);
});

test('days with no data still appear in the daily series as zeros', () => {
  const p = tinyPayload();
  p.facts = p.facts.filter((f) => f.d !== '2026-10-30');
  const s = dailySeries(p, 'ALL');
  assert.equal(s.find((d) => d.date === '2026-10-30').cur.spend, 0);
});

test('weeks run Monday to Sunday; partial weeks are marked and never chosen as best or weakest', () => {
  const p = tinyPayload(); // 2026-10-26 (Mon) .. 2026-11-08 (Sun) : exactly two full weeks
  const w = weeklyTable(p, 'ALL');
  assert.equal(w.weeks.length, 2);
  assert.ok(w.weeks.every((x) => x.full));

  // Shift the range so it starts on a Wednesday: first and last week become partial.
  const q = tinyPayload();
  q.range.start = '2026-10-28';
  const w2 = weeklyTable(q, 'ALL');
  assert.equal(w2.weeks[0].full, false);
  assert.equal(w2.weeks[0].from, '2026-10-28');
  assert.equal(w2.bestStart, null); // only one full week left, so nothing to compare
});

test('best and weakest week compare cost per result across full weeks', () => {
  const p = tinyPayload();
  // make the second week much better
  for (const f of p.facts) if (f.d >= '2026-11-02' && f.d <= '2026-11-08' && f.c === 'B') f.v = 5;
  const w = weeklyTable(p, 'ALL');
  assert.equal(w.bestStart, '2026-11-02');
  assert.equal(w.weakestStart, '2026-10-26');
});

test('day of week uses an average per day, so uneven ranges stay fair', () => {
  const p = tinyPayload();
  p.range.start = '2026-10-26';
  p.range.end = '2026-11-01'; // one of each weekday
  const d = dayOfWeek(p, 'ALL');
  assert.equal(d.length, 7);
  assert.ok(d.every((x) => x.days === 1));
  assert.equal(d[0].avgResults, 4);
});

test('campaigns rank by results, then lowest cost per result; idle campaigns are left out', () => {
  const p = tinyPayload();
  p.campaigns.push({ id: 'C', name: 'Old | Search', type: 'SEARCH', status: 'PAUSED' }); // no facts at all
  const rows = campaignTable(p, 'ALL');
  assert.deepEqual(rows.map((r) => r.id), ['A', 'B']);
  assert.equal(rows[0].cur.results, 56);
  assert.equal(rows[1].cur.costPerResult, null);
});

test('a paused campaign that ran earlier still counts for the dates it ran', () => {
  const p = tinyPayload();
  p.campaigns[0].status = 'PAUSED';
  assert.equal(campaignTable(p, 'ALL')[0].id, 'A');
});

test('goal statuses switch at the thresholds', () => {
  const label = { one: 'lead', many: 'leads' };
  const goals = { costPerResult: 50, monthlyBudget: 3040, monthlyResults: 60, roas: 3 };
  const make = (over) => derive({ spend: 3040, impressions: 1, clicks: 1, results: 60, revenue: 9120, ...over });
  const by = (cur, key) => goalStatuses(cur, goals, 30.4, label).find((g) => g.key === key).status;

  // cost per result: 50 is on goal; up to 15% over is amber; beyond is red
  assert.equal(by(make({ spend: 3000, results: 60 }), 'costPerResult'), 'green');
  assert.equal(by(make({ spend: 3000, results: 54 }), 'costPerResult'), 'amber'); // 55.6
  assert.equal(by(make({ spend: 3000, results: 50 }), 'costPerResult'), 'red'); // 60
  const edge = THRESHOLDS.costPerResultAmber * 50;
  assert.equal(by(derive({ spend: edge * 10, impressions: 1, clicks: 1, results: 10, revenue: 0 }), 'costPerResult'), 'amber');

  // results are scaled to the days shown
  assert.equal(by(make({ results: 60 }), 'results'), 'green');
  assert.equal(by(make({ results: 52 }), 'results'), 'amber');
  assert.equal(by(make({ results: 40 }), 'results'), 'red');

  // spend: under 70% of budget is amber, over 105% amber, over 120% red
  assert.equal(by(make({ spend: 3040 }), 'spend'), 'green');
  assert.equal(by(make({ spend: 1500 }), 'spend'), 'amber');
  assert.equal(by(make({ spend: 3300 }), 'spend'), 'amber');
  assert.equal(by(make({ spend: 3800 }), 'spend'), 'red');

  // return on ad spend
  assert.equal(by(make({ revenue: 9120 }), 'roas'), 'green');
  assert.equal(by(make({ revenue: 8000 }), 'roas'), 'amber');
  assert.equal(by(make({ revenue: 5000 }), 'roas'), 'red');
});

test('goals with no value set are not shown, and no results gives "nodata" instead of a wrong colour', () => {
  const label = { one: 'lead', many: 'leads' };
  const none = goalStatuses(derive({ spend: 0, impressions: 0, clicks: 0, results: 0, revenue: 0 }), { costPerResult: 0, monthlyBudget: 0, monthlyResults: 0, roas: 0 }, 30, label);
  assert.deepEqual(none, []);
  const g = goalStatuses(derive({ spend: 100, impressions: 5, clicks: 5, results: 0, revenue: 0 }), { costPerResult: 40 }, 30, label);
  assert.equal(g[0].status, 'nodata');
});

test('the summary uses the client\'s own word for a result and says how things moved', () => {
  const n = buildNarrative(tinyPayload(), 'ALL');
  assert.match(n.summary, /Acme spent \$1,400 and got 56 leads, at \$25\.00 each/);
  assert.match(n.summary, /same as the previous 14 days/);
  assert.doesNotMatch(n.summary, /\b(CPA|CPM|CTR)\b/);
});

test('a campaign that spends without results is the first thing pointed out', () => {
  const n = buildNarrative(tinyPayload(), 'ALL');
  assert.equal(n.insights[0].kind, 'wasted');
  assert.match(n.insights[0].text, /Beta \| Performance Max spent \$700 \(50% of the total\) without a single lead/);
  assert.match(n.nextStep, /Review Beta \| Performance Max/);
});

test('an empty period gets a clear message instead of numbers', () => {
  const p = tinyPayload();
  p.facts = [];
  const n = buildNarrative(p, 'ALL');
  assert.match(n.summary, /No ads ran/);
  assert.deepEqual(n.insights, []);
});
