// The team and admin hub. One page; it works out what to show from the address.
// Everything private comes from /api/admin after sign-in. Every name goes through esc().

import { DEFAULT_METRICS, DEFAULT_METRICS_WITH_SALES, METRICS, PALETTES, RANGE_CHOICES, TABS, TAB_IDS } from '../lib/catalog.mjs';
import { esc, int, money, pct, results as fmtResults, shortDate, signedPct } from '../lib/format.mjs';
import { change, tone } from '../lib/calc.mjs';
import { goalHtml, statusLabel } from '../lib/widgets.mjs';
import { AGENCY } from './brand.js';

const app = document.getElementById('app');

const S = {
  session: null, // { enabled, signedIn }
  data: null, // { settings, clients, connection }
  overview: null, // { clients }
  toast: null,
  menuOpen: false,
  formMetrics: null,
};

// ---------- talking to the server ----------

async function api(method, path, body) {
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'knight-hub', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && S.session && path !== '/login') {
    S.session.signedIn = false;
    render();
  }
  return { ok: res.ok, status: res.status, data };
}

async function loadAll() {
  const [state, overview] = await Promise.all([api('GET', '/state'), api('GET', '/overview')]);
  if (state.ok) S.data = state.data;
  if (overview.ok) S.overview = overview.data;
}

function toast(text, bad = false) {
  S.toast = { text, bad };
  renderToast();
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    S.toast = null;
    renderToast();
  }, 3600);
}

function renderToast() {
  document.querySelector('.toast')?.remove();
  if (!S.toast) return;
  const el = document.createElement('div');
  el.className = `toast${S.toast.bad ? ' bad' : ''}`;
  el.setAttribute('role', 'status');
  el.textContent = S.toast.text;
  document.body.append(el);
}

// ---------- routing ----------

function parsePath() {
  const parts = location.pathname.replace(/^\/+|\/+$/g, '').split('/');
  const [area, a, b] = parts;
  if (area === 'team') {
    if (a === 'client' && b) return { page: 'profile', id: b };
    return { page: 'overview' };
  }
  if (area === 'admin') {
    if (a === 'new') return { page: 'edit', id: null };
    if (a === 'clients' && b) return { page: 'edit', id: b };
    if (a === 'settings') return { page: 'settings' };
    if (a === 'connection') return { page: 'connection' };
    return { page: 'clients' };
  }
  return { page: 'overview' };
}

function go(path, replace = false) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  S.menuOpen = false;
  render();
  window.scrollTo({ top: 0 });
}

window.addEventListener('popstate', render);

// ---------- helpers ----------

const clientById = (id) => S.data?.clients.find((c) => c.id === id);
const overviewById = (id) => S.overview?.clients.find((c) => c.id === id);
const origin = () => location.origin;
const paletteName = (id) => PALETTES.find((p) => p.id === id)?.name || id;

function moneyFor(currency) {
  return (n, opts) => money(n, currency || 'USD', opts);
}

function goalFmt(currency) {
  const M = moneyFor(currency);
  return (g, v) => {
    if (v == null) return '—';
    if (g.kind === 'money') return M(v, { cents: g.key === 'costPerResult' });
    if (g.kind === 'ratio') return `${v.toFixed(1)}x`;
    return fmtResults(v);
  };
}

function modePill(mode) {
  const map = {
    sample: ['Sample data', ''],
    live: ['Live numbers', 'live'],
    waiting: ['Waiting for first update', 'warn'],
    paused: ['Paused', ''],
    error: ['Problem loading', 'bad'],
  };
  const [label, cls] = map[mode] || ['', ''];
  return label ? `<span class="pill ${cls}">${label}</span>` : '';
}

function changeHtml(metric, chg) {
  if (chg == null) return '<span class="tone-flat">no earlier data</span>';
  if (Math.abs(chg) < 0.01) return '<span class="tone-flat">no change</span>';
  const t = tone(metric, chg);
  return `<span class="chg tone-${t}">${chg > 0 ? '▲' : '▼'} ${esc(signedPct(chg).replace(/^[+−]/, ''))}</span>`;
}

function updatedText(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  } catch {
    return '';
  }
}

// ---------- shell ----------

function navLink(href, label, current, extra = '') {
  return `<a href="${esc(href)}" data-link${current === href ? ' aria-current="page"' : ''}>${extra}${esc(label)}</a>`;
}

function shell(content) {
  const here = location.pathname.replace(/\/+$/, '') || '/team';
  const clients = (S.data?.clients || [])
    .map((c) => navLink(`/team/client/${c.id}`, c.name, here, `<span class="dot" data-palette="${esc(c.palette)}"></span>`))
    .join('');
  const name = S.data?.settings?.agency?.name || 'Team hub';
  const mark = S.data?.settings?.agency?.mark || AGENCY.mark;
  return `<div class="shell">
    <aside class="side${S.menuOpen ? ' open' : ''}">
      <div class="side-top">
        <div class="side-brand"><span class="mark" aria-hidden="true">${esc(mark)}</span><span>${esc(name)}</span></div>
        <button type="button" class="menu-btn" data-action="menu" aria-expanded="${S.menuOpen}">Menu</button>
      </div>
      <nav class="nav" aria-label="Hub">
        <p class="nav-group">Team</p>
        ${navLink('/team', 'All clients', here)}
        ${clients ? `<p class="nav-group">Client profiles</p>${clients}` : ''}
        <p class="nav-group">Admin</p>
        ${navLink('/admin', 'Clients and goals', here)}
        ${navLink('/admin/new', 'Add a client', here)}
        ${navLink('/admin/settings', 'Report settings', here)}
        ${navLink('/admin/connection', 'Google Ads connection', here)}
      </nav>
      <div class="side-foot nav"><button type="button" data-action="signout">Sign out</button></div>
    </aside>
    <main class="page" id="page">${content}</main>
  </div>`;
}

// ---------- sign in ----------

function loginPage() {
  if (S.session && !S.session.enabled) {
    return `<div class="login"><div class="login-card">
      <span class="mark" aria-hidden="true">${esc(AGENCY.mark)}</span>
      <h1>The hub is switched off</h1>
      <p class="hint" style="margin-bottom:12px">It needs a password before it can open. To set one:</p>
      <ol>
        <li>In Cloudflare, open this Worker, then <b>Settings</b>, then <b>Variables and Secrets</b>.</li>
        <li>Add a <b>Secret</b> named <code>ADMIN_PASSWORD</code> with at least 8 characters.</li>
        <li>Deploy, then reload this page.</li>
      </ol>
    </div></div>`;
  }
  return `<div class="login"><form class="login-card" id="login-form">
    <span class="mark" aria-hidden="true">${esc(AGENCY.mark)}</span>
    <h1>Team hub</h1>
    <p class="hint">Sign in to see all clients and change their reports.</p>
    <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required autofocus></div>
    <p class="field-error" id="login-error" role="alert"></p>
    <button class="btn" type="submit">Sign in</button>
  </form></div>`;
}

// ---------- all clients ----------

function overviewPage() {
  const list = S.overview?.clients || [];
  const attention = list.filter((c) => c.flags?.some((f) => f.tone === 'bad' || f.tone === 'warn')).length;
  const rows = list.map(clientRow).join('');
  const google = S.overview?.connection?.googleAds;
  return `
    <header class="page-head">
      <div><h1>All clients</h1><p class="lede">The last 30 days, compared with the 30 days before.</p></div>
      <div class="actions"><a class="btn" href="/admin/new" data-link>Add a client</a></div>
    </header>
    <div class="summary-line">
      <span><b>${list.length}</b> ${list.length === 1 ? 'client' : 'clients'}</span>
      <span><b>${attention}</b> ${attention === 1 ? 'needs' : 'need'} a look</span>
      <span>${google ? 'Google Ads is connected' : 'Google Ads is not connected yet, so reports show sample data'}</span>
    </div>
    ${rows || '<div class="empty">No clients yet. Add one to get started.</div>'}`;
}

function clientRow(c) {
  const M = moneyFor(c.currency);
  const l = c.resultLabel;
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const nums = c.totals
    ? `<dl class="cr-nums">
        <div><dt>Spend</dt><dd>${esc(M(c.totals.spend, { cents: false }))}</dd><div class="delta">${changeHtml('spend', c.changes.spend)}</div></div>
        <div><dt>${esc(cap(l.many))}</dt><dd>${esc(fmtResults(c.totals.results))}</dd><div class="delta">${changeHtml('results', c.changes.results)}</div></div>
        <div><dt>Cost per ${esc(l.one)}</dt><dd>${c.totals.costPerResult == null ? '—' : esc(M(c.totals.costPerResult))}</dd><div class="delta">${changeHtml('costPerResult', c.changes.costPerResult)}</div></div>
        ${c.goals?.roas > 0 ? `<div><dt>Return on ad spend</dt><dd>${c.totals.roas == null ? '—' : `${c.totals.roas.toFixed(1)}x`}</dd></div>` : ''}
      </dl>`
    : '';
  const pills = (c.goalStatus || [])
    .map((g) => `<span class="goal-pill">${esc(g.label)} <span class="status ${esc(g.status)}">${statusLabel(g.status)}</span></span>`)
    .join('');
  const flags = (c.flags || []).map((f) => `<li class="${esc(f.tone)}">${esc(f.text)}</li>`).join('');
  return `<article class="client-row" data-palette="${esc(c.palette)}">
    <div>
      <div class="cr-name"><span class="dot" aria-hidden="true"></span><a href="/team/client/${esc(c.id)}" data-link>${esc(c.name)}</a>${modePill(c.mode)}</div>
      ${nums}
      ${pills ? `<div class="cr-goals">${pills}</div>` : ''}
      ${flags ? `<ul class="flags">${flags}</ul>` : ''}
    </div>
    <div class="cr-actions">
      <a class="btn" href="/team/client/${esc(c.id)}" data-link>Open profile</a>
      ${c.mode === 'paused' ? '' : `<a class="btn ghost" href="${esc(c.reportPath)}" target="_blank" rel="noopener">View client report</a>`}
    </div>
  </article>`;
}

// ---------- client profile ----------

function profilePage(id) {
  const c = clientById(id);
  if (!c) return notFound();
  const o = overviewById(id);
  const M = moneyFor(c.currency);
  const l = c.resultLabel;
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const link = `${origin()}/${c.linkKey}`;
  const figures = o?.totals
    ? `<div class="cols">
        <div class="figure"><div class="k">${esc(cap(l.many))}</div><div class="v">${esc(fmtResults(o.totals.results))}</div><div class="delta">${changeHtml('results', o.changes.results)}</div></div>
        <div class="figure"><div class="k">Spend</div><div class="v">${esc(M(o.totals.spend, { cents: false }))}</div><div class="delta">${changeHtml('spend', o.changes.spend)}</div></div>
        <div class="figure"><div class="k">Cost per ${esc(l.one)}</div><div class="v">${o.totals.costPerResult == null ? '—' : esc(M(o.totals.costPerResult))}</div><div class="delta">${changeHtml('costPerResult', o.changes.costPerResult)}</div></div>
      </div>`
    : '';
  const fmt = goalFmt(c.currency);
  const goals = (o?.goalStatus || []).map((g) => goalHtml(g, fmt)).join('');
  const flags = (o?.flags || []).map((f) => `<li class="${esc(f.tone)}">${esc(f.text)}</li>`).join('');
  const g = c.goals;
  const goalLines = [
    g.monthlyResults > 0 ? `${fmtResults(g.monthlyResults)} ${l.many} a month` : '',
    g.monthlyBudget > 0 ? `${M(g.monthlyBudget, { cents: false })} budget a month` : '',
    g.costPerResult > 0 ? `${M(g.costPerResult)} or less per ${l.one}` : '',
    g.roas > 0 ? `${g.roas}x return on ad spend or more` : '',
  ].filter(Boolean);
  const tabNames = TABS.filter((t) => c.tabs.includes(t.id)).map((t) => t.long).join(', ');
  const live = o && o.mode === 'live';

  return `
    <header class="page-head">
      <div>
        <h1><span class="dot" data-palette="${esc(c.palette)}" aria-hidden="true"></span>${esc(c.name)}</h1>
        <p class="lede">${modePill(o?.mode || (c.active ? '' : 'paused'))} ${o?.updatedAt ? `<span class="hint">Numbers from ${esc(updatedText(o.updatedAt))}</span>` : ''}</p>
      </div>
      <div class="actions">
        ${c.active ? `<a class="btn" href="${esc(c.reportPath)}" target="_blank" rel="noopener">View client report</a>` : ''}
        <button class="btn ghost" type="button" data-action="copy" data-value="${esc(link)}">Copy report link</button>
        <a class="btn ghost" href="/admin/clients/${esc(c.id)}" data-link>Edit settings</a>
        ${!c.sample && c.active ? `<button class="btn ghost" type="button" data-action="refresh" data-id="${esc(c.id)}">Update numbers now</button>` : ''}
      </div>
    </header>
    ${flags ? `<div class="block"><h2>Needs a look</h2><ul class="flags">${flags}</ul></div>` : ''}
    ${figures ? `<div class="block"><h2>Last 30 days</h2>${figures}</div>` : ''}
    ${goals ? `<div class="block" data-palette="${esc(c.palette)}"><h2>Goals</h2><div class="goals">${goals}</div></div>` : ''}
    <div class="block"><h2>Details</h2>
      <dl class="details">
        <dt>Report link</dt><dd><div class="link-line"><code>${esc(link)}</code><button class="btn ghost small" type="button" data-action="copy" data-value="${esc(link)}">Copy</button></div>${c.active ? '' : '<p class="hint">This client is paused, so the link shows “not valid”.</p>'}</dd>
        <dt>Google Ads account</dt><dd>${c.customerId ? esc(c.customerId) : '<span class="hint">Not added yet, so sample data is showing.</span>'}</dd>
        <dt>Counted as a ${esc(l.one)}</dt><dd>${c.conversionActions.length ? c.conversionActions.map((a) => `<div>${esc(a)}</div>`).join('') : '<span class="hint">Every conversion counts.</span>'}</dd>
        <dt>Goals</dt><dd>${goalLines.length ? goalLines.map((t) => `<div>${esc(t)}</div>`).join('') : '<span class="hint">No goals set.</span>'}</dd>
        <dt>Report colour</dt><dd>${esc(paletteName(c.palette))}</dd>
        <dt>Report tabs</dt><dd>${esc(tabNames)}</dd>
        <dt>Opens on</dt><dd>Last ${esc(c.defaultRange)} days</dd>
        <dt>Time zone</dt><dd>${esc(c.timezone)}</dd>
        <dt>Note on the report</dt><dd>${c.intro ? esc(c.intro) : '<span class="hint">None.</span>'}</dd>
        <dt>Private notes</dt><dd>${c.notes ? esc(c.notes) : '<span class="hint">None.</span>'}</dd>
      </dl>
    </div>`;
}

function notFound() {
  return `<header class="page-head"><h1>Not found</h1></header><p class="lede">That page or client does not exist. <a href="/team" data-link>Back to all clients</a></p>`;
}

// ---------- admin: client list ----------

function clientsAdminPage() {
  const rows = (S.data?.clients || [])
    .map((c) => {
      const M = moneyFor(c.currency);
      const g = c.goals;
      return `<tr>
        <td><div class="name-cell"><span class="dot" data-palette="${esc(c.palette)}" aria-hidden="true"></span><a href="/team/client/${esc(c.id)}" data-link>${esc(c.name)}</a></div></td>
        <td>${c.active ? '<span class="pill live">Active</span>' : '<span class="pill">Paused</span>'}</td>
        <td class="hide-sm">${c.customerId ? esc(c.customerId) : '<span class="hint">sample data</span>'}</td>
        <td class="hide-sm">${esc(g.monthlyBudget > 0 ? `${M(g.monthlyBudget, { cents: false })} budget` : 'no budget')}, ${esc(g.monthlyResults > 0 ? `${fmtResults(g.monthlyResults)} ${c.resultLabel.many}` : 'no result goal')}</td>
        <td class="right"><a class="btn ghost small" href="/admin/clients/${esc(c.id)}" data-link>Edit</a></td>
      </tr>`;
    })
    .join('');
  return `
    <header class="page-head">
      <div><h1>Clients and goals</h1><p class="lede">Add a client, switch one off, or change goals, numbers and how a report looks.</p></div>
      <div class="actions"><a class="btn" href="/admin/new" data-link>Add a client</a></div>
    </header>
    <div class="table-box"><table>
      <thead><tr><th>Client</th><th>Status</th><th class="hide-sm">Google Ads account</th><th class="hide-sm">Goals</th><th class="right"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">No clients yet.</td></tr>'}</tbody>
    </table></div>`;
}

// ---------- admin: add or edit a client ----------

function blankClient() {
  return {
    id: null, name: '', active: true, customerId: '', timezone: 'America/Los_Angeles', currency: 'USD',
    resultLabel: { one: 'lead', many: 'leads' }, conversionActions: [], goals: { costPerResult: 0, monthlyBudget: 0, monthlyResults: 0, roas: 0 },
    palette: 'harbor', tabs: [...TAB_IDS], metrics: [...DEFAULT_METRICS], defaultRange: '30', intro: '', notes: '', sampleProfile: 'mealprep',
  };
}

function metricRows() {
  const on = S.formMetrics.on;
  return S.formMetrics.order
    .map((key, i) => {
      const def = METRICS.find((m) => m.key === key);
      const label = def.label(S.formMetrics.label);
      const rank = on.indexOf(key);
      const size = rank < 0 ? '' : rank < 3 ? 'Large' : 'Small';
      return `<li class="${rank < 0 ? 'off' : ''}">
        <label class="check"><input type="checkbox" data-metric="${esc(key)}"${rank >= 0 ? ' checked' : ''}><span class="sr-only">Show </span></label>
        <span class="grow">${esc(label)}</span><span class="size">${size}</span>
        <button type="button" class="icon-btn" data-action="metric-up" data-key="${esc(key)}" aria-label="Move ${esc(label)} up"${i === 0 ? ' disabled' : ''}>↑</button>
        <button type="button" class="icon-btn" data-action="metric-down" data-key="${esc(key)}" aria-label="Move ${esc(label)} down"${i === S.formMetrics.order.length - 1 ? ' disabled' : ''}>↓</button>
      </li>`;
    })
    .join('');
}

function field(key, label, inner, { hint = '', cls = '' } = {}) {
  return `<div class="field ${cls}" data-field="${key}"><label for="f-${key}">${esc(label)}</label>${inner}${hint ? `<p class="hint">${hint}</p>` : ''}<p class="field-error" role="alert"></p></div>`;
}

function editPage(id) {
  const existing = id ? clientById(id) : null;
  if (id && !existing) return notFound();
  const c = existing || blankClient();
  S.formMetrics = {
    order: [...c.metrics, ...METRICS.map((m) => m.key).filter((k) => !c.metrics.includes(k))],
    on: [...c.metrics],
    label: c.resultLabel,
  };
  const num = (key, v, step = '0.01') => `<input id="f-${key}" type="number" min="0" step="${step}" inputmode="decimal" value="${esc(v || '')}">`;
  const cur = c.currency === 'USD' ? '$' : '';
  const paletteInputs = PALETTES.map(
    (p) => `<label class="palette-opt" data-palette="${p.id}"><input type="radio" name="palette" value="${p.id}"${c.palette === p.id ? ' checked' : ''}>
      <span class="swatches" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><b>${esc(p.name)}</b><small>${esc(p.about)}</small></label>`,
  ).join('');
  const tabChecks = TABS.map((t) => `<label class="check"><input type="checkbox" name="tab" value="${t.id}"${c.tabs.includes(t.id) ? ' checked' : ''}>${esc(t.long)}</label>`).join('');
  const link = existing ? `${origin()}/${existing.linkKey}` : '';

  return `
    <header class="page-head">
      <div><h1>${existing ? `Edit ${esc(existing.name)}` : 'Add a client'}</h1>
        <p class="lede">${existing ? 'Changes to goals, numbers and look show on the report straight away.' : 'Fill in what you know. You can change everything later. A secret report link is made when you save.'}</p></div>
      ${existing ? `<div class="actions"><a class="btn ghost" href="/team/client/${esc(existing.id)}" data-link>Back to profile</a></div>` : ''}
    </header>
    <form id="client-form" novalidate data-id="${esc(existing?.id || '')}">
      <div class="form-errors" id="form-errors" hidden role="alert"></div>

      <section class="panel"><h2>Basics</h2>
        ${field('name', 'Client name', `<input id="f-name" type="text" maxlength="80" value="${esc(c.name)}" autocomplete="off">`)}
        ${field('active', 'Report link', `<select id="f-active"><option value="true"${c.active ? ' selected' : ''}>Active: the link works</option><option value="false"${c.active ? '' : ' selected'}>Paused: the link shows “not valid”</option></select>`)}
        ${field('intro', 'Note on the report', `<textarea id="f-intro" maxlength="300" rows="3">${esc(c.intro)}</textarea>`, { hint: 'Optional. Shown under the summary on the client’s report. Up to 300 characters.' })}
        ${field('notes', 'Private notes', `<textarea id="f-notes" maxlength="2000" rows="3">${esc(c.notes)}</textarea>`, { hint: 'Only you see these. They never appear on the report.' })}
      </section>

      <section class="panel"><h2>Google Ads</h2>
        ${field('customerId', 'Account ID', `<input id="f-customerId" type="text" inputmode="numeric" placeholder="123-456-7890" value="${esc(c.customerId)}" autocomplete="off">`, { hint: 'The 10-digit number at the top of the Google Ads account. Leave it empty to keep showing sample data.', cls: 'short' })}
        ${field('conversionActions', 'Conversions that count as a result', `<textarea id="f-conversionActions" rows="3" placeholder="One per line">${esc(c.conversionActions.join('\n'))}</textarea>`, { hint: 'Spell each one exactly as it appears in Google Ads under Goals, then Conversions. Only these are counted. Leave it empty to count every conversion.' })}
        <div class="row">
          ${field('timezone', 'Time zone', `<input id="f-timezone" type="text" value="${esc(c.timezone)}">`, { hint: 'Use the account’s time zone, like America/Los_Angeles.' })}
          ${field('currency', 'Currency', `<input id="f-currency" type="text" maxlength="3" value="${esc(c.currency)}">`, { cls: 'short' })}
        </div>
        ${field('sampleProfile', 'Sample data style', `<select id="f-sampleProfile"><option value="mealprep"${c.sampleProfile === 'mealprep' ? ' selected' : ''}>Food and shopping</option><option value="bookkeeping"${c.sampleProfile === 'bookkeeping' ? ' selected' : ''}>Services and leads</option></select>`, { hint: 'Only used for the made-up numbers shown before Google Ads is connected.' })}
      </section>

      <section class="panel"><h2>What a result is called</h2>
        <p class="hint">Every number and sentence in the report uses these words.</p>
        <div class="row">
          ${field('resultLabelOne', 'One', `<input id="f-resultLabelOne" type="text" maxlength="30" value="${esc(c.resultLabel.one)}" placeholder="lead">`)}
          ${field('resultLabelMany', 'Many', `<input id="f-resultLabelMany" type="text" maxlength="30" value="${esc(c.resultLabel.many)}" placeholder="leads">`)}
        </div>
      </section>

      <section class="panel"><h2>Goals</h2>
        <p class="hint">Leave a goal at 0 to switch it off. Goals scale to the dates shown on the report.</p>
        <div class="row">
          ${field('goalMonthlyBudget', `Monthly budget ${cur ? `(${cur})` : ''}`, num('goalMonthlyBudget', c.goals.monthlyBudget))}
          ${field('goalMonthlyResults', 'Results per month', num('goalMonthlyResults', c.goals.monthlyResults, 'any'))}
        </div>
        <div class="row">
          ${field('goalCostPerResult', `Cost per result ${cur ? `(${cur})` : ''}`, num('goalCostPerResult', c.goals.costPerResult), { hint: 'The most you want to pay for one result.' })}
          ${field('goalRoas', 'Return on ad spend (x)', num('goalRoas', c.goals.roas, 'any'), { hint: 'Sales for every $1 of ads. Only if purchases carry a value.' })}
        </div>
      </section>

      <section class="panel"><h2>How the report looks</h2>
        <div class="field" data-field="palette" style="max-width:none"><fieldset class="palettes"><legend class="label">Colour</legend>${paletteInputs}</fieldset><p class="field-error" role="alert"></p></div>
        <div class="row">
          ${field('defaultRange', 'Opens on', `<select id="f-defaultRange">${RANGE_CHOICES.map((r) => `<option value="${r}"${c.defaultRange === r ? ' selected' : ''}>Last ${r} days</option>`).join('')}</select>`, { cls: 'short' })}
        </div>
        <div class="field" data-field="tabs" style="max-width:none"><span class="label">Tabs to show</span><div class="checks">${tabChecks}</div><p class="field-error" role="alert"></p></div>
        <div class="field" data-field="metrics"><span class="label">Numbers at the top of the Overview</span>
          <p class="hint" style="margin:0 0 8px">Tick the ones to show and use the arrows to put them in order. The first three are shown large.</p>
          <ul class="metric-list" id="metric-list">${metricRows()}</ul><p class="field-error" role="alert"></p></div>
      </section>

      <div class="form-actions">
        <button class="btn" type="submit" id="save-btn">${existing ? 'Save changes' : 'Add client'}</button>
        <a class="btn ghost" href="${existing ? `/team/client/${esc(existing.id)}` : '/admin'}" data-link>Cancel</a>
      </div>
    </form>
    ${existing ? `
    <section class="panel danger-zone"><h2>Report link and removal</h2>
      <div class="field" style="max-width:none"><span class="label">Current link</span>
        <div class="link-line"><code>${esc(link)}</code><button class="btn ghost small" type="button" data-action="copy" data-value="${esc(link)}">Copy</button></div>
        <p class="hint">If a link has been shared by mistake, make a new one. The old link stops working at once.</p>
        <div style="margin-top:10px"><button class="btn danger small" type="button" data-action="new-link" data-id="${esc(existing.id)}">Make a new link</button></div></div>
      <div class="field" style="max-width:none" data-field="delete"><span class="label">Delete this client</span>
        <p class="hint" style="margin:0 0 8px">This removes the client and its link. Type the name <b>${esc(existing.name)}</b> to confirm.</p>
        <div class="link-line"><input type="text" id="delete-confirm" aria-label="Type the client name to confirm" autocomplete="off"><button class="btn danger small" type="button" data-action="delete" data-id="${esc(existing.id)}">Delete client</button></div>
        <p class="field-error" role="alert" id="delete-error"></p></div>
    </section>` : ''}`;
}

function collectClientForm() {
  const v = (id) => document.getElementById(`f-${id}`)?.value ?? '';
  return {
    name: v('name'),
    active: v('active') !== 'false',
    intro: v('intro'),
    notes: v('notes'),
    customerId: v('customerId'),
    conversionActions: v('conversionActions').split('\n').map((s) => s.trim()).filter(Boolean),
    timezone: v('timezone').trim(),
    currency: v('currency').trim(),
    sampleProfile: v('sampleProfile'),
    resultLabel: { one: v('resultLabelOne'), many: v('resultLabelMany') },
    goals: {
      monthlyBudget: v('goalMonthlyBudget'),
      monthlyResults: v('goalMonthlyResults'),
      costPerResult: v('goalCostPerResult'),
      roas: v('goalRoas'),
    },
    palette: document.querySelector('input[name="palette"]:checked')?.value,
    defaultRange: v('defaultRange'),
    tabs: [...document.querySelectorAll('input[name="tab"]:checked')].map((e) => e.value),
    metrics: S.formMetrics.on.filter((k) => S.formMetrics.order.includes(k)).sort((a, b) => S.formMetrics.order.indexOf(a) - S.formMetrics.order.indexOf(b)),
  };
}

function showFieldErrors(form, fields) {
  form.querySelectorAll('.field').forEach((f) => {
    f.classList.remove('has-error');
    const e = f.querySelector('.field-error');
    if (e) e.textContent = '';
  });
  const box = document.getElementById('form-errors');
  const keys = Object.keys(fields || {});
  box.hidden = keys.length === 0;
  box.textContent = keys.length ? 'Some details need fixing. They are marked below.' : '';
  let first = null;
  for (const key of keys) {
    const holder = form.querySelector(`[data-field="${key}"]`);
    if (!holder) continue;
    holder.classList.add('has-error');
    holder.querySelector('.field-error').textContent = fields[key];
    first = first || holder;
  }
  if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  else if (keys.length) box.scrollIntoView({ block: 'center' });
}

async function submitClientForm(form) {
  const id = form.dataset.id;
  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  const res = await api(id ? 'PUT' : 'POST', id ? `/clients/${id}` : '/clients', collectClientForm());
  btn.disabled = false;
  if (res.status === 422) return showFieldErrors(form, res.data.fields);
  if (!res.ok) return toast(res.data.error || 'That could not be saved. Try again.', true);
  await loadAll();
  toast(id ? 'Saved. The report is updated.' : 'Client added. Its report link is on the profile page.');
  go(`/team/client/${res.data.client.id}`);
}

// ---------- admin: report settings ----------

function settingsPage() {
  const s = S.data.settings;
  const t = s.thresholds;
  const p = (r) => Math.round(r * 100);
  const n = (key, v) => `<input id="t-${key}" type="number" min="0" step="1" inputmode="numeric" value="${v}" class="num" style="width:90px">`;
  return `
    <header class="page-head"><div><h1>Report settings</h1><p class="lede">These apply to every client’s report.</p></div></header>
    <form id="settings-form" novalidate>
      <div class="form-errors" id="form-errors" hidden role="alert"></div>
      <section class="panel"><h2>Your name on reports</h2>
        <div class="row">
          ${field('agencyName', 'Name', `<input id="f-agencyName" type="text" maxlength="40" value="${esc(s.agency.name)}" placeholder="Shown next to the mark">`, { hint: 'Leave empty until you choose one.' })}
          ${field('agencyMark', 'Mark', `<input id="f-agencyMark" type="text" maxlength="2" value="${esc(s.agency.mark)}">`, { cls: 'short', hint: 'One or two letters. The “K” for Knight for now.' })}
        </div>
      </section>
      <section class="panel"><h2>When a goal turns amber or red</h2>
        <p class="hint">A goal is green while it is met. These set how far off it can get before it changes colour.</p>
        <div class="field" data-field="costPerResultAmber" style="max-width:none"><span class="label">Cost per result</span>
          <p>Amber up to ${n('costPerResultAmber', p(t.costPerResultAmber - 1))} % over the goal, red beyond that.</p><p class="field-error" role="alert"></p></div>
        <div class="field" data-field="resultsAmber" style="max-width:none"><span class="label">Results</span>
          <p>Amber down to ${n('resultsAmber', p(t.resultsAmber))} % of the goal for the dates shown, red below that.</p><p class="field-error" role="alert"></p></div>
        <div class="field" data-field="spendAmber" style="max-width:none"><span class="label">Spend against the budget</span>
          <p>Green between ${n('spendLow', p(t.spendLow))} % and ${n('spendAmberUp', p(t.spendAmber))} % of the budget. Amber up to ${n('spendRed', p(t.spendRed))} %, red beyond. Amber too when spend is under the low limit.</p>
          <p class="field-error" role="alert"></p></div>
        <div class="field" data-field="roasAmber" style="max-width:none"><span class="label">Return on ad spend</span>
          <p>Amber down to ${n('roasAmber', p(t.roasAmber))} % of the goal, red below that.</p><p class="field-error" role="alert"></p></div>
      </section>
      <div class="form-actions"><button class="btn" type="submit" id="save-btn">Save settings</button></div>
    </form>`;
}

async function submitSettings(form) {
  const num = (id) => Number(document.getElementById(`t-${id}`).value);
  const body = {
    agency: { name: document.getElementById('f-agencyName').value, mark: document.getElementById('f-agencyMark').value },
    thresholds: {
      costPerResultAmber: 1 + num('costPerResultAmber') / 100,
      resultsAmber: num('resultsAmber') / 100,
      spendLow: num('spendLow') / 100,
      spendAmber: num('spendAmberUp') / 100,
      spendRed: num('spendRed') / 100,
      roasAmber: num('roasAmber') / 100,
    },
  };
  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  const res = await api('PUT', '/settings', body);
  btn.disabled = false;
  if (res.status === 422) {
    // The server speaks in ratios; people type percentages, so say it the way they typed it.
    const plain = {
      costPerResultAmber: 'Use a number from 0 to 200.',
      resultsAmber: 'Use a number from 10 to 100.',
      roasAmber: 'Use a number from 10 to 100.',
      spendLow: 'The low limit must be from 10 to 100.',
      spendAmber: 'The top of the green range must be from 100 to 300.',
      spendRed: 'The red limit must be from 100 to 500, and not below the amber limit.',
    };
    const f = {};
    for (const [k, v] of Object.entries(res.data.fields)) f[k] = plain[k] || v;
    if (f.spendLow || f.spendRed) f.spendAmber = f.spendAmber || f.spendLow || f.spendRed;
    return showFieldErrors(form, f);
  }
  if (!res.ok) return toast(res.data.error || 'That could not be saved.', true);
  await loadAll();
  toast('Saved. Every report now uses these settings.');
  render();
}

// ---------- admin: Google Ads connection ----------

function connectionPage() {
  const c = S.data.connection;
  const item = (ok, name, text) => `<li><span class="pill ${ok ? 'live' : 'warn'}">${ok ? 'Set' : 'Missing'}</span><div class="grow"><code>${esc(name)}</code> <span class="hint">${esc(text)}</span></div></li>`;
  return `
    <header class="page-head"><div><h1>Google Ads connection</h1>
      <p class="lede">${c.googleAds ? 'Google Ads is connected. Clients with an account ID show real numbers.' : 'Google Ads is not connected yet, so every report shows sample data.'}</p></div></header>
    <div class="block"><h2>Secrets in Cloudflare</h2>
      <ul class="checklist">
        ${item(c.parts.clientId, 'GOOGLE_ADS_CLIENT_ID', 'OAuth client ID')}
        ${item(c.parts.clientSecret, 'GOOGLE_ADS_CLIENT_SECRET', 'OAuth client secret')}
        ${item(c.parts.refreshToken, 'GOOGLE_ADS_REFRESH_TOKEN', 'Refresh token for the Google user that can open the accounts')}
        <li><span class="pill ${c.managerAccount ? 'live' : ''}">${c.managerAccount ? 'Set' : 'Not set'}</span><div class="grow"><code>GOOGLE_ADS_LOGIN_CUSTOMER_ID</code> <span class="hint">Only if the clients sit under a manager (MCC) account. Not needed when you open each account directly.</span></div></li>
        <li><span class="pill ${c.refreshSecret ? 'live' : ''}">${c.refreshSecret ? 'Set' : 'Not set'}</span><div class="grow"><code>REFRESH_SECRET</code> <span class="hint">Optional. Lets you start a refresh from outside the hub.</span></div></li>
      </ul>
      <p class="hint">Secrets live in Cloudflare under the Worker’s <b>Settings</b>, then <b>Variables and Secrets</b>. They are never shown here. Google Ads API version: <b>${esc(c.apiVersion)}</b>.</p>
    </div>
    <div class="block"><h2>Steps to connect</h2>
      <ol class="steps">
        <li>Create a Google Cloud project, turn on the Google Ads API and ask for Explorer access. It is free.</li>
        <li>Set up the OAuth consent screen, set it to <b>In production</b>, and make an OAuth client.</li>
        <li>Get a refresh token while signed in with the Google user that opens both accounts.</li>
        <li>Add the three secrets above, deploy, then add each client’s account ID on its settings page.</li>
      </ol>
      <p class="hint" style="margin-top:12px">The README has each step in detail.</p>
    </div>`;
}

// ---------- drawing ----------

function titleFor(route) {
  return { overview: 'All clients', profile: 'Client profile', clients: 'Clients and goals', edit: 'Client settings', settings: 'Report settings', connection: 'Google Ads connection' }[route.page] || 'Team hub';
}

async function render() {
  if (!S.session) {
    app.innerHTML = '<p class="boot">Loading…</p>';
    const s = await api('GET', '/session');
    S.session = s.data;
  }
  if (!S.session.signedIn) {
    document.title = 'Sign in';
    app.innerHTML = loginPage();
    return;
  }
  if (!S.data || !S.overview) await loadAll();
  if (!S.data) {
    app.innerHTML = '<p class="boot">The hub could not load. Reload the page, or sign in again.</p>';
    return;
  }
  const route = parsePath();
  document.title = `${titleFor(route)} · ${S.data.settings.agency.name || 'Team hub'}`;
  let html;
  switch (route.page) {
    case 'profile': html = profilePage(route.id); break;
    case 'clients': html = clientsAdminPage(); break;
    case 'edit': html = editPage(route.id); break;
    case 'settings': html = settingsPage(); break;
    case 'connection': html = connectionPage(); break;
    default: html = overviewPage();
  }
  app.innerHTML = shell(html);
}

// ---------- events ----------

document.addEventListener('click', async (e) => {
  const link = e.target.closest('a[data-link]');
  if (link && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
    e.preventDefault();
    go(link.getAttribute('href'));
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  if (action === 'menu') {
    S.menuOpen = !S.menuOpen;
    document.querySelector('.side')?.classList.toggle('open', S.menuOpen);
    el.setAttribute('aria-expanded', String(S.menuOpen));
  } else if (action === 'signout') {
    await api('POST', '/logout');
    S.session.signedIn = false;
    S.data = null;
    S.overview = null;
    render();
  } else if (action === 'copy') {
    try {
      await navigator.clipboard.writeText(el.dataset.value);
      toast('Link copied.');
    } catch {
      window.prompt('Copy this link:', el.dataset.value);
    }
  } else if (action === 'refresh') {
    el.disabled = true;
    const res = await api('POST', `/clients/${el.dataset.id}/refresh`);
    el.disabled = false;
    toast(res.ok ? 'Updating the numbers. Reload in a minute to see them.' : res.data.error || 'That did not start.', !res.ok);
  } else if (action === 'new-link') {
    if (!window.confirm('Make a new link? The old one stops working at once.')) return;
    const res = await api('POST', `/clients/${el.dataset.id}/link`);
    if (!res.ok) return toast(res.data.error || 'That did not work.', true);
    await loadAll();
    toast('New link made. The old one no longer works.');
    render();
  } else if (action === 'delete') {
    const confirmName = document.getElementById('delete-confirm').value;
    const res = await api('DELETE', `/clients/${el.dataset.id}`, { confirmName });
    if (res.status === 422) {
      document.getElementById('delete-error').textContent = res.data.error;
      return;
    }
    if (!res.ok) return toast(res.data.error || 'That did not work.', true);
    await loadAll();
    toast('Client deleted.');
    go('/admin');
  } else if (action === 'metric-up' || action === 'metric-down') {
    const order = S.formMetrics.order;
    const i = order.indexOf(el.dataset.key);
    const j = action === 'metric-up' ? i - 1 : i + 1;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    document.getElementById('metric-list').innerHTML = metricRows();
    document.querySelector(`#metric-list [data-key="${el.dataset.key}"]`)?.focus();
  }
});

document.addEventListener('change', (e) => {
  const box = e.target.closest('input[data-metric]');
  if (!box || !S.formMetrics) return;
  const key = box.dataset.metric;
  const on = S.formMetrics.on;
  if (box.checked && !on.includes(key)) on.push(key);
  if (!box.checked) S.formMetrics.on = on.filter((k) => k !== key);
  document.getElementById('metric-list').innerHTML = metricRows();
  document.querySelector(`#metric-list input[data-metric="${key}"]`)?.focus();
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (form.id === 'login-form') {
    const err = document.getElementById('login-error');
    err.textContent = '';
    const res = await api('POST', '/login', { password: document.getElementById('pw').value });
    if (!res.ok) {
      err.textContent = res.data.error || 'Sign in did not work.';
      return;
    }
    S.session = { enabled: true, signedIn: true };
    S.data = null;
    S.overview = null;
    if (!/^\/(team|admin)/.test(location.pathname)) history.replaceState(null, '', '/team');
    render();
  } else if (form.id === 'client-form') {
    submitClientForm(form);
  } else if (form.id === 'settings-form') {
    submitSettings(form);
  }
});

render();
