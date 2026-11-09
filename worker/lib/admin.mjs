// /api/admin/... : everything the team hub and admin pages use. All of it sits behind the password.

import { change, diffDays, goalStatuses, periodTotals } from '../../src/lib/calc.mjs';
import { adsConfigured } from './ads.mjs';
import {
  ValidationError, dataSignature, findClientById, loadConfig, newLinkKey, saveConfig, validateClient, validateSettings,
} from './config.mjs';
import {
  adminEnabled, clearFails, hasSession, isHubRequest, makeSession, noteFail, passwordMatches, sessionCookie, tooManyFails,
} from './auth.mjs';
import { refreshClient } from './refresh.mjs';
import { getReportPayload, json, usesSampleData } from './report.mjs';

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function fieldsError(e) {
  return json({ error: e.message, fields: e.fields }, 422);
}

/** Everything the edit form needs about one client (never sent to the public report). */
function adminClient(client, env) {
  return { ...client, sample: usesSampleData(env, client), reportPath: `/${client.linkKey}` };
}

const STALE_DAYS = 2;

/** One client's last 30 days in a few numbers, goal statuses and anything that needs a look. */
async function summarise(env, ctx, client, settings, deps) {
  const base = {
    id: client.id, name: client.name, active: client.active, palette: client.palette, resultLabel: client.resultLabel, currency: client.currency,
    reportPath: `/${client.linkKey}`, customerId: client.customerId, goals: client.goals,
  };
  if (!client.active) return { ...base, mode: 'paused', flags: [{ tone: 'flat', text: 'Paused. Its report link is switched off.' }] };
  let out;
  try {
    out = await getReportPayload(env, ctx, client, settings, { range: '30' }, deps, { build: false });
  } catch (e) {
    return { ...base, mode: 'error', flags: [{ tone: 'bad', text: e.plain || e.message || 'The numbers could not be loaded.' }] };
  }
  if (out.pending) {
    return { ...base, mode: 'waiting', flags: [{ tone: 'warn', text: 'Waiting for the first daily update from Google Ads. You can start one from the client page.' }] };
  }
  const p = out.payload;
  const { cur, prev } = periodTotals(p, 'ALL');
  const days = diffDays(p.range.start, p.range.end) + 1;
  const goals = goalStatuses(cur, client.goals, days, client.resultLabel, settings.thresholds);
  const flags = [];
  for (const g of goals) {
    if (g.status === 'red') flags.push({ tone: 'bad', text: `Off track: ${g.label.toLowerCase()}.` });
    else if (g.status === 'amber') flags.push({ tone: 'warn', text: `Watch: ${g.label.toLowerCase()}.` });
  }
  if (cur.spend > 0 && cur.results === 0) flags.push({ tone: 'bad', text: `No ${client.resultLabel.many} in the last 30 days.` });
  if (cur.spend === 0 && cur.impressions === 0) flags.push({ tone: 'warn', text: 'No ads ran in the last 30 days.' });
  if (out.savedAt && (Date.now() - new Date(out.savedAt).getTime()) / 86400000 > STALE_DAYS) flags.push({ tone: 'warn', text: 'The saved numbers are more than two days old.' });
  if (out.mode === 'sample') flags.push({ tone: 'flat', text: 'Showing sample numbers until Google Ads is connected.' });
  return {
    ...base,
    mode: out.mode,
    updatedAt: out.savedAt || p.generatedAt,
    range: p.range,
    totals: { spend: cur.spend, results: cur.results, costPerResult: cur.costPerResult, roas: cur.roas, clicks: cur.clicks, ctr: cur.ctr },
    changes: { spend: change(cur.spend, prev.spend), results: change(cur.results, prev.results), costPerResult: change(cur.costPerResult, prev.costPerResult) },
    goalStatus: goals,
    flags,
  };
}

export async function handleAdmin(request, env, ctx, deps = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const sub = path.slice('/api/admin'.length) || '/';
  const method = request.method;

  if (!adminEnabled(env)) {
    return sub === '/session' && method === 'GET' ? json({ enabled: false, signedIn: false }) : json({ error: 'The admin hub is switched off.' }, 403);
  }

  if (sub === '/session' && method === 'GET') return json({ enabled: true, signedIn: await hasSession(request, env, deps.now) });

  if (method !== 'GET' && !isHubRequest(request)) return json({ error: 'Not allowed.' }, 403);

  if (sub === '/login' && method === 'POST') {
    if (await tooManyFails(request, env)) return json({ error: 'Too many wrong passwords. Wait 15 minutes and try again.' }, 429);
    const body = await readJson(request);
    if (!(await passwordMatches(env, body?.password))) {
      await noteFail(request, env);
      return json({ error: 'That password is not right.' }, 401);
    }
    await clearFails(request, env);
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(await makeSession(env, deps.now), request) });
  }
  if (sub === '/logout' && method === 'POST') return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', request, { clear: true }) });

  if (!(await hasSession(request, env, deps.now))) return json({ error: 'Please sign in.' }, 401);

  const config = await loadConfig(env, deps);
  const { settings, clients } = config;
  const save = async (next) => {
    try {
      await saveConfig(env, next);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
    return null;
  };

  // ----- reading -----
  if (sub === '/state' && method === 'GET') {
    return json({
      settings,
      clients: clients.map((c) => adminClient(c, env)),
      connection: {
        googleAds: adsConfigured(env),
        parts: { clientId: !!env.GOOGLE_ADS_CLIENT_ID, clientSecret: !!env.GOOGLE_ADS_CLIENT_SECRET, refreshToken: !!env.GOOGLE_ADS_REFRESH_TOKEN },
        managerAccount: !!env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
        apiVersion: env.GOOGLE_ADS_API_VERSION || 'v25',
        refreshSecret: !!env.REFRESH_SECRET,
        store: !!env.REPORTS,
      },
    });
  }

  if (sub === '/overview' && method === 'GET') {
    const items = await Promise.all(clients.map((c) => summarise(env, ctx, c, settings, deps)));
    return json({ clients: items, connection: { googleAds: adsConfigured(env) } });
  }

  // ----- changing settings -----
  if (sub === '/settings' && method === 'PUT') {
    let next;
    try {
      next = validateSettings(await readJson(request));
    } catch (e) {
      if (e instanceof ValidationError) return fieldsError(e);
      throw e;
    }
    const failed = await save({ settings: next, clients });
    return failed || json({ settings: next });
  }

  // ----- adding a client -----
  if (sub === '/clients' && method === 'POST') {
    let client;
    try {
      client = validateClient((await readJson(request)) || {}, null, clients);
    } catch (e) {
      if (e instanceof ValidationError) return fieldsError(e);
      throw e;
    }
    const failed = await save({ settings, clients: [...clients, client] });
    return failed || json({ client: adminClient(client, env) }, 201);
  }

  const m = sub.match(/^\/clients\/([a-z0-9-]+)(\/(link|refresh))?$/);
  if (m) {
    const existing = findClientById(m[1], clients);
    if (!existing) return json({ error: 'No client with that ID.' }, 404);
    const action = m[3];

    if (!action && method === 'PUT') {
      let client;
      try {
        client = validateClient((await readJson(request)) || {}, existing, clients);
      } catch (e) {
        if (e instanceof ValidationError) return fieldsError(e);
        throw e;
      }
      const failed = await save({ settings, clients: clients.map((c) => (c.id === existing.id ? client : c)) });
      if (failed) return failed;
      // If the numbers themselves depend on what changed, rebuild them in the background.
      if (dataSignature(client) !== dataSignature(existing) && !usesSampleData(env, client) && client.active && ctx?.waitUntil) {
        ctx.waitUntil(refreshClient(env, client, deps).catch(() => {}));
      }
      return json({ client: adminClient(client, env) });
    }

    if (!action && method === 'DELETE') {
      const body = await readJson(request);
      if (!body || body.confirmName !== existing.name) return json({ error: 'Type the client name exactly to delete it.' }, 422);
      const failed = await save({ settings, clients: clients.filter((c) => c.id !== existing.id) });
      return failed || json({ ok: true });
    }

    if (action === 'link' && method === 'POST') {
      const client = { ...existing, linkKey: newLinkKey(existing.name, clients) };
      const failed = await save({ settings, clients: clients.map((c) => (c.id === existing.id ? client : c)) });
      return failed || json({ client: adminClient(client, env) });
    }

    if (action === 'refresh' && method === 'POST') {
      if (usesSampleData(env, existing)) return json({ ok: true, note: 'Sample data is showing, so there is nothing to refresh yet.' });
      const work = refreshClient(env, existing, deps);
      if (ctx?.waitUntil) ctx.waitUntil(work);
      else await work;
      return json({ ok: true, started: true }, 202);
    }
  }

  return json({ error: 'Not found.' }, 404);
}
