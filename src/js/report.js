// The client report page. Loads one saved report from /api/report and draws it.
// Every name that comes from Google Ads goes through esc() before it is put on the page.

import {
  TYPE_LABELS, WEEKDAYS, addDays, buildNarrative, campaignTable, capitalize, change, dailySeries, dayOfWeek,
  derive, groupRows, periodTotals, rankByResults, rowsFor, sumRows, tone, typesPresent, weeklyTable,
} from '../lib/calc.mjs';
import { esc, int, longDate, money, pct, results as fmtResults, shortDate, signedPct } from '../lib/format.mjs';
import { AGENCY } from './brand.js';
import { goalHtml, statusLabel } from '../lib/widgets.mjs';
import { DEFAULT_METRICS, DEFAULT_METRICS_WITH_SALES, METRICS, TABS, TAB_IDS, resolvePalette } from '../lib/catalog.mjs';
import { lineChart, nearestIndex } from './charts.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);

const state = {
  key: decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g, '')),
  // null means "the client's own default", which the server fills in.
  range: ['7', '30', '90', 'custom'].includes(params.get('range')) ? params.get('range') : null,
  start: params.get('start') || '',
  end: params.get('end') || '',
  type: params.get('type') || 'ALL',
  tab: TAB_IDS.includes(params.get('tab')) ? params.get('tab') : null,
  // ?theme= previews any palette on a report link without changing what is saved.
  theme: params.get('theme') ? resolvePalette(params.get('theme')) : null,
  metric: 'results',
  campaignId: null,
  subtab: 'adGroups',
  payload: null,
  loading: true,
  error: null,
  showCustom: false,
  stale: false,
};

let requestId = 0;
let chartModel = null;

// ---------- loading ----------

async function load() {
  const id = ++requestId;
  state.loading = true;
  state.error = null;
  render();
  const q = new URLSearchParams({ c: state.key });
  if (state.range) q.set('range', state.range);
  if (state.range === 'custom') {
    q.set('start', state.start);
    q.set('end', state.end);
  }
  try {
    const res = await fetch(`/api/report?${q}`, { headers: { accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));
    if (id !== requestId) return; // a newer request replaced this one
    if (!res.ok) {
      state.error = { message: body.error || 'This report could not be loaded.', notFound: res.status === 404, badRange: res.status === 400 };
      state.payload = state.error.notFound ? null : state.payload;
    } else {
      state.payload = body.payload;
      state.stale = !!body.stale;
      if (!state.range) state.range = state.payload.range.preset === 'custom' ? '30' : state.payload.range.preset;
      if (!state.tab || !clientTabs().includes(state.tab)) state.tab = clientTabs()[0];
      if (state.type !== 'ALL' && !typesPresent(state.payload).includes(state.type)) state.type = 'ALL';
      if (state.campaignId && !state.payload.campaigns.some((c) => c.id === state.campaignId)) state.campaignId = null;
    }
  } catch {
    if (id !== requestId) return;
    state.error = { message: 'The report could not be reached. Check your connection and try again.' };
  }
  state.loading = false;
  render();
}

function syncUrl() {
  const q = new URLSearchParams();
  if (state.range && state.range !== (state.payload?.client?.defaultRange || '30')) q.set('range', state.range);
  if (state.range === 'custom') {
    q.set('start', state.start);
    q.set('end', state.end);
  }
  if (state.type !== 'ALL') q.set('type', state.type);
  if (state.tab && state.tab !== clientTabs()[0]) q.set('tab', state.tab);
  if (state.theme) q.set('theme', params.get('theme'));
  const s = q.toString();
  history.replaceState(null, '', location.pathname + (s ? `?${s}` : ''));
}

// ---------- small helpers ----------

const L = () => state.payload.client.resultLabel;

/** The tabs this client's report shows, in order. */
function clientTabs() {
  const ids = state.payload?.client?.tabs;
  const list = Array.isArray(ids) ? TAB_IDS.filter((id) => ids.includes(id)) : [];
  return list.length ? list : [...TAB_IDS];
}
const cur$ = () => state.payload.client.currency || 'USD';
const M = (n, opts) => money(n, cur$(), opts);

function arrowFor(chg) {
  if (chg == null || Math.abs(chg) < 0.01) return '–';
  return chg > 0 ? '▲' : '▼';
}

/** "▲ 9.2%" coloured by whether it is good for the client */
function changeText(metric, chg) {
  if (chg == null) return '<span class="tone-flat">no earlier data</span>';
  const t = tone(metric, chg);
  if (Math.abs(chg) < 0.01) return '<span class="tone-flat">no change</span>';
  return `<span class="chg tone-${t}">${arrowFor(chg)} ${esc(signedPct(chg).replace(/^[+−]/, ''))}</span>`;
}

function typeTag(type) {
  return `<span class="tag">${esc(TYPE_LABELS[type] || type)}</span>`;
}

function emptyNotice(title, text) {
  return `<div class="notice"><h2>${esc(title)}</h2><p>${esc(text)}</p></div>`;
}

function hasActivity(totals) {
  return totals.spend > 0 || totals.impressions > 0;
}

// ---------- header, controls, tabs ----------

function renderChrome() {
  const p = state.payload;
  document.documentElement.dataset.palette = state.theme || resolvePalette(p?.client?.palette, 'harbor');
  $('#brand-mark').textContent = p?.client?.agency?.mark || AGENCY.mark;
  $('#brand-text').textContent = p?.client?.agency?.name || 'Google Ads report';

  if (!p) {
    $('#client-name').textContent = state.error?.notFound ? 'Report not found' : 'Loading report…';
    $('#range-text').textContent = '';
    $('#updated').textContent = '';
    $('#banner').innerHTML = '';
    $('#controls').hidden = true;
    $('#custom-range').hidden = true;
    $('#tabs').hidden = true;
    document.title = 'Google Ads report';
    return;
  }

  document.title = `${p.client.name} report`;
  $('#client-name').textContent = p.client.name;
  const r = p.range;
  $('#range-text').textContent = `${longDate(r.start)} to ${longDate(r.end)}, compared with ${longDate(r.prevStart)} to ${longDate(r.prevEnd)}`;

  $('#updated').textContent = p.demo
    ? 'Sample data'
    : `Updated ${new Intl.DateTimeFormat('en-US', { timeZone: p.client.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(p.generatedAt))}`;

  $('#banner').innerHTML = p.demo
    ? '<div class="sample-banner"><div class="wrap"><strong>Sample data.</strong> These numbers are made up so you can see the layout. Real numbers appear once Google Ads is connected.</div></div>'
    : '';

  $('#controls').hidden = false;
  $('#range-buttons').innerHTML = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['custom', 'Custom']]
    .map(([v, label]) => `<button type="button" data-action="range" data-value="${v}" aria-pressed="${state.range === v}">${label}</button>`)
    .join('');

  const types = typesPresent(p);
  const filter = $('#type-filter');
  filter.hidden = types.length < 2;
  $('#type-select').innerHTML =
    `<option value="ALL">All types</option>` + types.map((t) => `<option value="${esc(t)}"${state.type === t ? ' selected' : ''}>${esc(TYPE_LABELS[t])}</option>`).join('');
  $('#type-select').value = state.type;

  const custom = $('#custom-range');
  custom.hidden = !(state.showCustom || state.range === 'custom');
  if (!custom.hidden) {
    const maxDay = yesterdayIn(p.client.timezone);
    $('#custom-start').max = maxDay;
    $('#custom-end').max = maxDay;
    if (!$('#custom-start').value) $('#custom-start').value = r.start;
    if (!$('#custom-end').value) $('#custom-end').value = r.end;
  }

  const tabIds = clientTabs();
  $('#tabs').hidden = tabIds.length < 2;
  $('#tabs .wrap').innerHTML = TABS.filter((t) => tabIds.includes(t.id))
    .map(
      (t) =>
        `<button type="button" role="tab" data-action="tab" data-value="${t.id}" aria-selected="${state.tab === t.id}"><span class="long">${t.long}</span><span class="short">${t.short}</span></button>`,
    )
    .join('');
}

// Reports always end yesterday (in the client's time zone), so that is the latest day that can be picked.
function yesterdayIn(timeZone) {
  let today;
  try {
    today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    today = new Date().toISOString().slice(0, 10);
  }
  return addDays(today, -1);
}

// ---------- the tabs ----------

function renderOverview() {
  const p = state.payload;
  const l = L();
  const { cur, prev } = periodTotals(p, state.type);
  if (!hasActivity(cur)) return emptyNotice('No ads ran in this period', 'There is nothing to show for these dates. Try a longer range, or check that the campaigns were switched on.');

  const nar = buildNarrative(p, state.type);
  const days = p.range.days;

  const metricKeys = (p.client.metrics && p.client.metrics.length >= 3 ? p.client.metrics : p.client.showRevenue ? DEFAULT_METRICS_WITH_SALES : DEFAULT_METRICS)
    .filter((k) => METRICS.some((m) => m.key === k));
  const metricView = (key) => {
    const def = METRICS.find((m) => m.key === key);
    const label = def.label(l);
    const hint = def.hint ? def.hint(l) : '';
    return { key, label, hint, value: formatMetric(def.kind, cur[key]), delta: changeText(key, change(cur[key], prev[key])) };
  };
  const views = metricKeys.map(metricView);
  const chips = views
    .slice(0, 3)
    .map(
      (v) => `<article class="chip"><div class="chip-swatch"${v.hint ? ` title="${esc(v.hint)}"` : ''}>${esc(v.label)}</div><div class="chip-body"><div class="chip-value">${esc(v.value)}</div><div class="delta">${v.delta}</div></div></article>`,
    )
    .join('');
  const minor = views
    .slice(3)
    .map(
      (v) => `<div class="minor-item"><div class="minor-label"${v.hint ? ` title="${esc(v.hint)}"` : ''}>${esc(v.label)}</div><div class="minor-value">${esc(v.value)}</div><div class="delta">${v.delta}</div></div>`,
    )
    .join('');

  return `
    <p class="summary">${esc(nar.summary)}</p>
    ${p.client.intro ? `<p class="agency-note">${esc(p.client.intro)}</p>` : ''}
    <div class="chips">${chips}</div>
    ${minor ? `<div class="minor">${minor}</div>` : ''}
    <p class="ledger-note">Changes compare with the previous ${days} days.</p>
    ${renderTrend()}
    ${renderGoals(nar.goals)}
    ${renderInsights(nar)}
  `;
}

function formatMetric(kind, v) {
  if (v == null || Number.isNaN(v)) return '—';
  switch (kind) {
    case 'money0': return M(v, { cents: false });
    case 'money': return M(v);
    case 'results': return fmtResults(v);
    case 'pct': return pct(v);
    case 'int': return int(v);
    case 'ratio': return `${v.toFixed(1)}x`;
    default: return String(v);
  }
}

function metricInfo(metric) {
  const l = L();
  return {
    results: { label: capitalize(l.many), fmt: (v) => (v >= 100 ? int(v) : fmtResults(v)), pick: (m) => m.results },
    spend: { label: 'Spend', fmt: (v) => M(v, { cents: false }), pick: (m) => m.spend },
    clicks: { label: 'Clicks', fmt: (v) => int(v), pick: (m) => m.clicks },
  }[metric];
}

function renderTrend() {
  const p = state.payload;
  const series = dailySeries(p, state.type);
  const info = metricInfo(state.metric);
  const points = series.map((d) => ({ date: d.date, prevDate: d.prevDate, cur: info.pick(d.cur), prev: info.pick(d.prev) }));
  const width = Math.min(1048, (document.querySelector('#content')?.clientWidth || 700) - 18);
  const total = points.reduce((s, d) => s + d.cur, 0);
  const { svg, model } = lineChart({
    points,
    width,
    fmt: (v) => (info.fmt === undefined ? String(v) : state.metric === 'results' && v < 10 ? String(Math.round(v * 10) / 10) : info.fmt(v)),
    label: `Daily ${info.label.toLowerCase()} for the last ${p.range.days} days, ${info.fmt(total)} in total`,
  });
  chartModel = { ...model, info };
  const buttons = ['results', 'spend', 'clicks']
    .map((m) => `<button type="button" data-action="metric" data-value="${m}" aria-pressed="${state.metric === m}">${esc(metricInfo(m).label)}</button>`)
    .join('');
  return `
    <section class="section">
      <div class="chart-head"><h2 style="margin:0">Day by day</h2><div class="seg" role="group" aria-label="Chart metric">${buttons}</div></div>
      <div class="chart-box" id="chart-box">${svg}<div class="tip" id="tip" role="presentation"></div>
        <div class="legend"><span><i></i>This period</span><span><i class="prev"></i>Previous ${p.range.days} days</span></div>
      </div>
    </section>`;
}

function goalValue(g, v) {
  if (v == null) return '—';
  if (g.kind === 'money') return M(v, { cents: g.key === 'costPerResult' });
  if (g.kind === 'ratio') return `${v.toFixed(1)}x`;
  return fmtResults(v);
}

function renderGoals(goals) {
  if (!goals || !goals.length) return '';
  const rows = goals.map((g) => goalHtml(g, goalValue)).join('');
  return `<section class="section"><h2>Goals</h2><p class="sub">Goals are scaled to the number of days shown.</p><div class="goals">${rows}</div></section>`;
}

function renderInsights(nar) {
  const list = nar.insights
    .map((i) => `<li><span class="mark ${i.tone === 'good' ? 'good' : i.tone === 'bad' ? 'bad' : ''}" aria-hidden="true"></span><span>${esc(i.text)}</span></li>`)
    .join('');
  return `
    <section class="section">
      <h2>What stands out</h2>
      <div class="stand-out">
        ${list ? `<ul class="insights">${list}</ul>` : '<p class="sub">Not enough activity yet to point anything out.</p>'}
        <div class="next-step"><strong>Next step</strong>${esc(nar.nextStep)}</div>
      </div>
    </section>`;
}

function weekLabel(from, to) {
  const [, m1] = from.split('-');
  const [, m2] = to.split('-');
  const a = shortDate(from);
  const b = m1 === m2 ? String(Number(to.split('-')[2])) : shortDate(to);
  return `${a} – ${b}`;
}

function renderWeeks() {
  const p = state.payload;
  const l = L();
  const { cur } = periodTotals(p, state.type);
  if (!hasActivity(cur)) return emptyNotice('No ads ran in this period', 'There are no weeks to show for these dates.');
  const { weeks, bestStart, weakestStart } = weeklyTable(p, state.type);

  const rows = weeks
    .map((w) => {
      const cls = [w.start === bestStart ? 'best' : '', w.start === weakestStart ? 'weak' : '', w.full ? '' : 'partial'].join(' ').trim();
      const tags =
        (w.start === bestStart ? '<span class="tag good">Best week</span>' : '') +
        (w.start === weakestStart ? '<span class="tag bad">Weakest week</span>' : '') +
        (w.full ? '' : '<span class="tag">Partial week</span>');
      return `<tr class="${cls}"><td class="name">${esc(weekLabel(w.from, w.to))}${tags}</td>
        <td class="num">${M(w.spend, { cents: false })}</td>
        <td class="num hide-sm">${int(w.impressions)}</td>
        <td class="num hide-sm">${int(w.clicks)}</td>
        <td class="num hide-sm">${pct(w.ctr)}</td>
        <td class="num hide-sm">${w.cpc == null ? '—' : M(w.cpc)}</td>
        <td class="num">${fmtResults(w.results)}</td>
        <td class="num">${w.costPerResult == null ? '—' : M(w.costPerResult)}</td>
        <td class="num hide-sm">${pct(w.resultRate)}</td></tr>`;
    })
    .join('');

  const dow = dayOfWeek(p, state.type);
  const maxAvg = Math.max(...dow.map((d) => d.avgResults), 0.0001);
  const topIdx = dow.findIndex((d) => d.avgResults === Math.max(...dow.map((x) => x.avgResults)));
  const bars = dow
    .map((d, i) => `<div class="dow-col${i === topIdx && maxAvg > 0.0001 ? ' top' : ''}"><div class="dow-val">${(Math.round(d.avgResults * 10) / 10).toString()}</div><div class="dow-bar" style="height:${Math.max(1, (d.avgResults / maxAvg) * 100 * 0.78).toFixed(1)}%"></div><div class="dow-label">${WEEKDAYS[i]}</div></div>`)
    .join('');

  return `
    <section class="section">
      <h2>Week by week</h2>
      <p class="sub">Weeks run Monday to Sunday. Partial weeks are grey and are left out of best and weakest. Best and weakest compare cost per ${esc(l.one)}.</p>
      <div class="table-box"><table>
        <thead><tr><th scope="col">Week</th><th scope="col">Spend</th><th scope="col" class="hide-sm">Times shown</th><th scope="col" class="hide-sm">Clicks</th><th scope="col" class="hide-sm">Click rate</th><th scope="col" class="hide-sm">Cost per click</th><th scope="col">${esc(capitalize(l.many))}</th><th scope="col">Cost per ${esc(l.one)}</th><th scope="col" class="hide-sm">${esc(capitalize(l.one))} rate</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    </section>
    <section class="section">
      <h2>Which days work best</h2>
      <p class="sub">Average ${esc(l.many)} on each day of the week during this period.</p>
      <div class="dow" role="img" aria-label="Average ${esc(l.many)} by day of the week">${bars}</div>
    </section>`;
}

// ----- campaigns -----

function renderCampaigns() {
  const p = state.payload;
  if (state.campaignId) return renderCampaignDetail();
  const l = L();
  const rows = campaignTable(p, state.type);
  if (!rows.length) return emptyNotice('No campaign activity', 'No campaigns had activity in this period.');
  const totalSpend = rows.reduce((s, r) => s + r.cur.spend, 0) || 1;
  const days = p.range.days;
  const body = rows
    .map(
      (r) => `<tr>
        <td class="name"><button type="button" class="link-btn" data-action="campaign" data-value="${esc(r.id)}">${esc(r.name)}</button><br>${typeTag(r.type)}${r.status !== 'ENABLED' ? '<span class="tag warn">Paused</span>' : ''}</td>
        <td class="num">${M(r.cur.spend, { cents: false })}<span class="cell-sub">${changeText('spend', change(r.cur.spend, r.prev.spend))}</span></td>
        <td class="num">${fmtResults(r.cur.results)}<span class="cell-sub">${changeText('results', change(r.cur.results, r.prev.results))}</span></td>
        <td class="num">${r.cur.costPerResult == null ? '—' : M(r.cur.costPerResult)}<span class="cell-sub">${changeText('costPerResult', change(r.cur.costPerResult, r.prev.costPerResult))}</span></td>
        <td class="num hide-sm">${pct(r.cur.spend / totalSpend, 0)}</td></tr>`,
    )
    .join('');
  return `
    <section class="section">
      <h2>Campaigns</h2>
      <p class="sub">Ranked by ${esc(l.many)}, then by lowest cost per ${esc(l.one)}. Changes compare with the previous ${days} days. Select a campaign to see its ad groups, ads, keywords and search terms.</p>
      <div class="table-box"><table>
        <thead><tr><th scope="col">Campaign</th><th scope="col">Spend</th><th scope="col">${esc(capitalize(l.many))}</th><th scope="col">Cost per ${esc(l.one)}</th><th scope="col" class="hide-sm">Share of spend</th></tr></thead>
        <tbody>${body}</tbody></table></div>
    </section>`;
}

function detailTable({ rows, nameHeader, nameCell, flagZero, campaignSpend }) {
  const l = L();
  if (!rows.length) return '<p class="sub">Nothing to show here for this period.</p>';
  const shown = rows.slice(0, 50);
  const body = shown
    .map((r) => {
      const flag = flagZero && r.results === 0 && r.spend >= Math.max(5, campaignSpend * 0.02) ? '<span class="tag bad">No results</span>' : '';
      return `<tr><td class="name">${nameCell(r)}${flag}</td>
        <td class="num">${M(r.spend)}</td>
        <td class="num hide-sm">${int(r.impressions)}</td>
        <td class="num hide-sm">${int(r.clicks)}</td>
        <td class="num hide-sm">${pct(r.ctr)}</td>
        <td class="num">${fmtResults(r.results)}</td>
        <td class="num">${r.costPerResult == null ? '—' : M(r.costPerResult)}</td></tr>`;
    })
    .join('');
  return `<div class="table-box"><table>
    <thead><tr><th scope="col">${esc(nameHeader)}</th><th scope="col">Spend</th><th scope="col" class="hide-sm">Times shown</th><th scope="col" class="hide-sm">Clicks</th><th scope="col" class="hide-sm">Click rate</th><th scope="col">${esc(capitalize(l.many))}</th><th scope="col">Cost per ${esc(l.one)}</th></tr></thead>
    <tbody>${body}</tbody></table></div>${rows.length > 50 ? `<p class="sub" style="margin-top:8px">Showing the top 50 of ${rows.length}.</p>` : ''}`;
}

function toRows(list) {
  return list.map((r) => ({ ...r, ...derive({ spend: r.s || 0, impressions: r.i || 0, clicks: r.k || 0, results: r.v || 0, revenue: r.r || 0 }) }));
}

function renderCampaignDetail() {
  const p = state.payload;
  const l = L();
  const camp = p.campaigns.find((c) => c.id === state.campaignId);
  if (!camp) {
    state.campaignId = null;
    return renderCampaigns();
  }
  const isSearch = camp.type === 'SEARCH';
  const subtabs = [['adGroups', 'Ad groups'], ['ads', 'Ads'], ...(isSearch ? [['keywords', 'Keywords'], ['searchTerms', 'Search terms']] : [])];
  if (!subtabs.some(([id]) => id === state.subtab)) state.subtab = 'adGroups';

  const row = campaignTable(p, 'ALL').find((c) => c.id === camp.id);
  const t = row ? row.cur : derive({ spend: 0, impressions: 0, clicks: 0, results: 0, revenue: 0 });
  const mine = (list) => (list || []).filter((r) => r.campaignId === camp.id);

  let table = '';
  if (state.subtab === 'adGroups') {
    table = detailTable({ rows: rankByResults(toRows(mine(p.adGroups))), nameHeader: 'Ad group', nameCell: (r) => esc(r.name), campaignSpend: t.spend });
  } else if (state.subtab === 'ads') {
    const groups = new Map(mine(p.adGroups).map((g) => [g.id, g.name]));
    table = detailTable({ rows: rankByResults(toRows(mine(p.ads))), nameHeader: 'Ad', nameCell: (r) => `${esc(r.name)}${groups.get(r.adGroupId) ? `<span class="cell-sub">${esc(groups.get(r.adGroupId))}</span>` : ''}`, campaignSpend: t.spend });
  } else if (state.subtab === 'keywords') {
    const match = { EXACT: 'Exact', PHRASE: 'Phrase', BROAD: 'Broad' };
    table = detailTable({ rows: toRows(mine(p.keywords)).sort((a, b) => b.spend - a.spend), nameHeader: 'Keyword', nameCell: (r) => `${esc(r.text)}<span class="cell-sub">${esc(match[r.match] || r.match)} match</span>`, flagZero: true, campaignSpend: t.spend });
  } else {
    table = detailTable({ rows: toRows(mine(p.searchTerms)).sort((a, b) => b.spend - a.spend), nameHeader: 'Search term', nameCell: (r) => esc(r.text), flagZero: true, campaignSpend: t.spend });
  }

  const stats = [
    ['Spend', M(t.spend, { cents: false })],
    [capitalize(l.many), fmtResults(t.results)],
    [`Cost per ${l.one}`, t.costPerResult == null ? '—' : M(t.costPerResult)],
    ['Clicks', int(t.clicks)],
    ['Click rate', pct(t.ctr)],
    ['Times shown', int(t.impressions)],
  ]
    .map(([k, v]) => `<div class="stat"><span>${esc(k)}</span><b>${esc(v)}</b></div>`)
    .join('');

  return `
    <section class="section">
      <button type="button" class="link-btn back" data-action="back">Back to all campaigns</button>
      <h2 style="margin-bottom:6px">${esc(camp.name)} ${typeTag(camp.type)}${camp.status !== 'ENABLED' ? '<span class="tag warn">Paused</span>' : ''}</h2>
      <div class="creative" style="margin-bottom:18px"><div class="stats">${stats}</div></div>
      <div class="seg" role="group" aria-label="Campaign detail" style="margin-bottom:14px">${subtabs.map(([id, label]) => `<button type="button" data-action="subtab" data-value="${id}" aria-pressed="${state.subtab === id}">${label}</button>`).join('')}</div>
      ${table}
    </section>`;
}

// ----- audiences -----

function barBlock(title, rows, { sortByLabel = false } = {}) {
  const l = L();
  const grouped = groupRows(rows, (r) => r.label);
  if (!grouped.length) return '';
  grouped.sort((a, b) => (sortByLabel ? a.key.localeCompare(b.key, 'en', { numeric: true }) : b.results - a.results || b.spend - a.spend));
  const useResults = grouped.some((g) => g.results > 0);
  const max = Math.max(...grouped.map((g) => (useResults ? g.results : g.spend)), 0.0001);
  const list = grouped
    .map((g) => {
      const v = useResults ? g.results : g.spend;
      return `<div class="bar-row"><div class="bar-label">${esc(g.key)}</div><div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${((v / max) * 100).toFixed(1)}%"></div></div><div class="bar-val">${fmtResults(g.results)} ${esc(g.results === 1 ? l.one : l.many)}<small>${g.costPerResult == null ? `${M(g.spend, { cents: false })} spent` : `${M(g.costPerResult)} each`}</small></div></div>`;
    })
    .join('');
  return `<section><h2 style="margin-bottom:10px">${esc(title)}</h2><div class="bars">${list}</div></section>`;
}

function renderAudiences() {
  const p = state.payload;
  const a = p.audiences || {};
  const blocks = [
    barBlock('Age', rowsFor(a.age, p, state.type), { sortByLabel: true }),
    barBlock('Gender', rowsFor(a.gender, p, state.type)),
    barBlock('Device', rowsFor(a.device, p, state.type)),
    barBlock('Audience segments', rowsFor(a.segment, p, state.type)),
  ].filter(Boolean);
  if (!blocks.length) return emptyNotice('No audience data yet', 'Audience breakdowns appear here once the campaigns have enough activity. Search campaigns show age, gender and device. Performance Max, Demand Gen and YouTube campaigns also show audience segments.');
  return `<section class="section"><h2>Who is responding</h2><p class="sub">Results by age, gender, device and audience segment for the dates shown.</p><div class="grid-2" style="margin-top:20px">${blocks.join('')}</div></section>`;
}

// ----- creative -----

function creativeCard(c) {
  const l = L();
  const rowsD = derive({ spend: c.s || 0, impressions: c.i || 0, clicks: c.k || 0, results: c.v || 0, revenue: c.r || 0 });
  const camp = state.payload.campaigns.find((x) => x.id === c.campaignId);
  const isVideo = c.kind === 'VIDEO';
  const stat = (k, v) => `<div class="stat"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
  const stats = isVideo
    ? [
        stat('Times shown', int(rowsD.impressions)),
        stat('Views', c.views == null ? '—' : int(c.views)),
        stat('View rate', c.views == null || !rowsD.impressions ? '—' : pct(c.views / rowsD.impressions)),
        stat('Click rate', pct(rowsD.ctr)),
        stat(capitalize(l.many), fmtResults(rowsD.results)),
        stat(`Cost per ${l.one}`, rowsD.costPerResult == null ? '—' : M(rowsD.costPerResult)),
      ]
    : [
        stat('Times shown', int(rowsD.impressions)),
        stat('Clicks', int(rowsD.clicks)),
        stat('Click rate', pct(rowsD.ctr)),
        stat('Spend', M(rowsD.spend, { cents: false })),
        stat(capitalize(l.many), fmtResults(rowsD.results)),
        stat(`Cost per ${l.one}`, rowsD.costPerResult == null ? '—' : M(rowsD.costPerResult)),
      ];
  const quart = isVideo
    ? `<div class="quart">${[['25%', c.p25], ['50%', c.p50], ['75%', c.p75], ['100%', c.p100]]
        .map(([k, v]) => `<div><span>Watched to ${k}</span><b class="num">${v == null ? '—' : pct(v, 0)}</b><div class="q-track" aria-hidden="true"><span class="q-fill" style="width:${v == null ? 0 : Math.min(100, v * 100).toFixed(0)}%"></span></div></div>`)
        .join('')}</div>`
    : '';
  return `<article class="creative"><div class="creative-name">${esc(c.name)}</div><div class="creative-camp">${esc(camp ? camp.name : '')}</div><div class="stats">${stats.join('')}</div>${quart}</article>`;
}

function renderCreative() {
  const p = state.payload;
  const all = rowsFor(p.creatives, p, state.type);
  const rank = (list) => rankByResults(toRows(list)).map((r) => ({ ...r, s: r.s, i: r.i, k: r.k, v: r.v, r: r.r }));
  const videos = rank(all.filter((c) => c.kind === 'VIDEO'));
  const ads = rank(all.filter((c) => c.kind === 'AD'));
  if (!videos.length && !ads.length) return emptyNotice('No ads to show yet', 'Each ad and video appears here with how it performed once it has been shown.');
  return `
    ${videos.length ? `<section class="section"><h2>Videos</h2><p class="sub">“Watched to” is the share of times the video was shown that reached that point.</p><div class="creative-list">${videos.map(creativeCard).join('')}</div></section>` : ''}
    ${ads.length ? `<section class="section"><h2>Ads</h2><div class="creative-list">${ads.map(creativeCard).join('')}</div></section>` : ''}`;
}

// ---------- put it all on the page ----------

function renderFootnote() {
  const p = state.payload;
  const warn = (p.warnings || []).length ? `<p class="warn-line">Some parts could not be loaded and are left out: ${esc(p.warnings.map((w) => w.part).join(', '))}.</p>` : '';
  return `${warn}<p class="foot">Numbers come from Google Ads and cover ${esc(longDate(p.range.start))} to ${esc(longDate(p.range.end))}. Days run midnight to midnight in the Google Ads account's time zone. Results are the actions ${esc(p.client.name)} chose to count.</p>`;
}

function render() {
  renderChrome();
  const el = $('#content');
  if (state.loading && !state.payload) {
    el.innerHTML = '<p class="sub" style="margin-top:30px">Loading the latest numbers…</p>';
    return;
  }
  if (state.error && !state.payload) {
    el.innerHTML = state.error.notFound
      ? emptyNotice('This report link is not valid', 'Check the link you were sent. If it still does not work, ask whoever sent it for a new one.')
      : `<div class="notice"><h2>We could not load this report</h2><p>${esc(state.error.message)}</p><button type="button" class="btn" data-action="retry">Try again</button></div>`;
    return;
  }

  let html = '';
  if (state.error) {
    // We still have an older copy on screen, but the newest request failed (for example a bad custom date range).
    html += `<div class="notice" style="margin-top:20px"><p>${esc(state.error.message)}</p></div>`;
  }
  const view = { overview: renderOverview, weeks: renderWeeks, campaigns: renderCampaigns, audiences: renderAudiences, creative: renderCreative }[state.tab];
  html += `<div style="${state.loading ? 'opacity:.55' : ''}">${view()}</div>${renderFootnote()}`;
  el.innerHTML = html;
  attachChart();
  syncUrl();
}

// ---------- chart tooltip ----------

function attachChart() {
  const svg = $('#trend-svg');
  if (!svg || !chartModel) return;
  const hit = $('#hit');
  const tip = $('#tip');
  const guide = $('#guide');
  const dot = $('#guide-dot');
  const box = $('#chart-box');
  const model = chartModel;
  const { m, pw, n } = model;
  const xAt = (i) => m.l + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
  const yAt = (v) => m.t + (model.H - m.t - m.b) - (v / model.yMax) * (model.H - m.t - m.b);

  const show = (ev) => {
    const rect = svg.getBoundingClientRect();
    const scale = model.W / rect.width;
    const i = nearestIndex((ev.clientX - rect.left) * scale, model);
    const pt = model.points[i];
    const px = xAt(i) / scale;
    guide.setAttribute('x1', xAt(i));
    guide.setAttribute('x2', xAt(i));
    guide.setAttribute('opacity', '0.25');
    dot.setAttribute('cx', xAt(i));
    dot.setAttribute('cy', yAt(pt.cur));
    dot.setAttribute('opacity', '1');
    const f = model.info.fmt;
    tip.innerHTML = `<b>${esc(shortDate(pt.date))}</b>: ${esc(f(pt.cur))}<br>${esc(shortDate(pt.prevDate))} (previous): ${esc(f(pt.prev))}`;
    tip.style.display = 'block';
    const boxRect = box.getBoundingClientRect();
    const tipW = tip.offsetWidth;
    let left = rect.left - boxRect.left + px - tipW / 2;
    left = Math.max(4, Math.min(boxRect.width - tipW - 4, left));
    tip.style.left = `${left}px`;
    tip.style.top = '8px';
  };
  const hide = () => {
    tip.style.display = 'none';
    guide.setAttribute('opacity', '0');
    dot.setAttribute('opacity', '0');
  };
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
}

// ---------- events ----------

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const value = el.dataset.value;
  switch (el.dataset.action) {
    case 'range':
      if (value === 'custom') {
        state.showCustom = true;
        if (state.payload) {
          state.start = state.start || state.payload.range.start;
          state.end = state.end || state.payload.range.end;
        }
        render();
        $('#custom-start')?.focus();
      } else {
        state.range = value;
        state.showCustom = false;
        load();
      }
      break;
    case 'tab':
      state.tab = value;
      state.campaignId = null;
      render();
      break;
    case 'metric':
      state.metric = value;
      render();
      break;
    case 'campaign':
      state.campaignId = value;
      state.subtab = 'adGroups';
      render();
      window.scrollTo({ top: 0 });
      break;
    case 'back':
      state.campaignId = null;
      render();
      break;
    case 'subtab':
      state.subtab = value;
      render();
      break;
    case 'retry':
      load();
      break;
  }
});

$('#type-select').addEventListener('change', (e) => {
  state.type = e.target.value;
  state.campaignId = null;
  render();
});

$('#custom-range').addEventListener('submit', (e) => {
  e.preventDefault();
  const start = $('#custom-start').value;
  const end = $('#custom-end').value;
  const err = $('#custom-error');
  err.textContent = '';
  if (!start || !end) {
    err.textContent = 'Pick a start and an end date.';
    return;
  }
  if (start > end) {
    err.textContent = 'The start date must be before the end date.';
    return;
  }
  state.range = 'custom';
  state.start = start;
  state.end = end;
  load();
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.payload && state.tab === 'overview') render();
  }, 150);
});

if (state.range === 'custom') state.showCustom = true;
load();
