import test from 'node:test';
import assert from 'node:assert/strict';
import { esc, money, pct, results, shortDate, signedPct } from '../src/lib/format.mjs';
import { resolveRange, todayIn } from '../worker/lib/ranges.mjs';
import { lineChart, niceStep, nearestIndex } from '../src/js/charts.js';
import { prettyEnum } from '../worker/lib/ads.mjs';

test('esc makes names safe to put on the page', () => {
  assert.equal(esc('<img src=x onerror="a()">'), '&lt;img src=x onerror=&quot;a()&quot;&gt;');
  assert.equal(esc("Bob's & Sons"), 'Bob&#39;s &amp; Sons');
  assert.equal(esc(null), '');
});

test('numbers are formatted the way a client expects', () => {
  assert.equal(money(1234.5, 'USD', { cents: false }), '$1,235');
  assert.equal(money(38.857), '$38.86');
  assert.equal(money(null), '—');
  assert.equal(pct(0.04321), '4.3%');
  assert.equal(pct(null), '—');
  assert.equal(signedPct(0.123), '+12.3%');
  assert.equal(signedPct(-0.05), '−5.0%');
  assert.equal(results(4.25), '4.3');
  assert.equal(results(4), '4');
  assert.equal(shortDate('2026-11-08'), 'Nov 8');
});

test('standard ranges end yesterday in the client\'s own time zone', () => {
  // 2026-11-09 03:00 UTC is still Nov 8 in San Diego, so "yesterday" there is Nov 7
  const now = new Date('2026-11-09T03:00:00Z');
  assert.equal(todayIn('America/Los_Angeles', now), '2026-11-08');
  const r = resolveRange({ range: '7' }, 'America/Los_Angeles', now);
  assert.equal(r.end, '2026-11-07');
  assert.equal(r.start, '2026-11-01');
  assert.equal(r.days, 7);
  // the previous period is the 7 days right before, no overlap and no gap
  assert.equal(r.prevEnd, '2026-10-31');
  assert.equal(r.prevStart, '2026-10-25');
});

test('30 and 90 day ranges and the comparison period have the same length', () => {
  const now = new Date('2026-11-09T19:00:00Z');
  for (const n of [30, 90]) {
    const r = resolveRange({ range: String(n) }, 'America/Los_Angeles', now);
    assert.equal(r.days, n);
    assert.equal(r.key, String(n));
    assert.equal(r.end, '2026-11-08');
  }
});

test('custom ranges are checked and given friendly errors', () => {
  const now = new Date('2026-11-09T19:00:00Z');
  const tz = 'America/Los_Angeles';
  const ok = resolveRange({ range: 'custom', start: '2026-10-01', end: '2026-10-20' }, tz, now);
  assert.equal(ok.key, 'c_2026-10-01_2026-10-20');
  assert.equal(ok.days, 20);
  assert.equal(ok.prevEnd, '2026-09-30');
  assert.throws(() => resolveRange({ range: 'custom', start: '2026-10-20', end: '2026-10-01' }, tz, now), /before the end date/);
  assert.throws(() => resolveRange({ range: 'custom', start: 'nope', end: '2026-10-01' }, tz, now), /start and an end/);
  assert.throws(() => resolveRange({ range: 'custom', start: '2026-02-30', end: '2026-03-02' }, tz, now), RangeError);
  assert.throws(() => resolveRange({ range: '45' }, tz, now), /7, 30 or 90/);
  assert.throws(() => resolveRange({ range: 'custom', start: '2024-01-01', end: '2026-10-01' }, tz, now), /one year/);
  assert.throws(() => resolveRange({ range: 'custom', start: '2026-12-01', end: '2026-12-10' }, tz, now), /future/);
  // an end date in the future is cut back to yesterday
  assert.equal(resolveRange({ range: 'custom', start: '2026-11-01', end: '2026-12-31' }, tz, now).end, '2026-11-08');
});

test('chart left-hand labels use round numbers', () => {
  assert.equal(niceStep(5), 2);
  assert.equal(niceStep(4), 1);
  assert.equal(niceStep(950), 500);
  assert.equal(niceStep(0), 1);
  const { svg } = lineChart({ points: [{ date: '2026-11-01', prevDate: '2026-10-01', cur: 3, prev: 1 }, { date: '2026-11-02', prevDate: '2026-10-02', cur: 5, prev: 2 }], width: 600, fmt: String, label: 'Test chart' });
  assert.match(svg, /aria-label="Test chart"/);
  assert.doesNotMatch(svg, />1\.25</);
});

test('the chart copes with a single day and with all zeros', () => {
  const one = lineChart({ points: [{ date: '2026-11-01', prevDate: '2026-10-01', cur: 0, prev: 0 }], width: 400, fmt: String, label: 'x' });
  assert.ok(one.svg.includes('<svg'));
  assert.ok(!/NaN|Infinity/.test(one.svg));
});

test('pointer position maps to the nearest day', () => {
  const model = { m: { l: 50 }, pw: 100, n: 11 };
  assert.equal(nearestIndex(50, model), 0);
  assert.equal(nearestIndex(150, model), 10);
  assert.equal(nearestIndex(100, model), 5);
  assert.equal(nearestIndex(-20, model), 0);
  assert.equal(nearestIndex(999, model), 10);
});

test('Google labels become plain words', () => {
  assert.equal(prettyEnum('AGE_RANGE_25_34'), '25-34');
  assert.equal(prettyEnum('AGE_RANGE_65_UP'), '65+');
  assert.equal(prettyEnum('AGE_RANGE_UNDETERMINED'), 'Unknown');
  assert.equal(prettyEnum('MOBILE'), 'Mobile');
  assert.equal(prettyEnum('CONNECTED_TV'), 'Connected tv');
  assert.equal(prettyEnum(''), 'Unknown');
});
