// /api/report and /api/refresh

import { adsConfigured, AdsError } from './ads.mjs';
import { applyConfig, dataSignature, findClientById, findClientByKey, loadConfig } from './config.mjs';
import { buildDemoPayload } from './demo.mjs';
import { resolveRange } from './ranges.mjs';
import { refreshClient, refreshOne } from './refresh.mjs';
import { getSaved, isStale } from './store.mjs';

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

/** Sample data is used until Google Ads is connected and the client has a customer ID. */
export function usesSampleData(env, client) {
  return !(adsConfigured(env) && client.customerId);
}

/**
 * The report for one client and date range: sample data, a saved copy, or a fresh build.
 * With `build: false` it never waits on Google; it says `pending` when nothing is saved yet.
 * Throws RangeError (bad dates) or AdsError (Google said no).
 */
export async function getReportPayload(env, ctx, client, settings, rangeInput, deps = {}, { build = true } = {}) {
  const now = deps.now ?? new Date();
  const range = resolveRange(rangeInput, client.timezone, now);
  if (usesSampleData(env, client)) {
    return { payload: applyConfig(buildDemoPayload(client, range, now), client, settings), stale: false, mode: 'sample' };
  }

  const saved = await getSaved(env, client.id, range.key);
  if (saved && saved.payload.dataSig === dataSignature(client)) {
    const stale = isStale(saved.savedAt, now);
    // Show what we have right away; refresh in the background if it is more than a day old.
    if (stale && build && ctx?.waitUntil) ctx.waitUntil(refreshOne(env, client, { range: range.preset, start: range.start, end: range.end }, deps).catch(() => {}));
    return { payload: applyConfig(saved.payload, client, settings), stale, savedAt: saved.savedAt, mode: 'live' };
  }
  if (!build) return { payload: null, pending: true, mode: 'live' };

  const payload = await refreshOne(env, client, { range: range.preset, start: range.start, end: range.end }, deps);
  return { payload: applyConfig(payload, client, settings), stale: false, mode: 'live' };
}

export async function handleReport(request, env, ctx, deps = {}) {
  const url = new URL(request.url);
  const { settings, clients } = await loadConfig(env, deps);
  const client = findClientByKey(url.searchParams.get('c'), clients);
  // Same answer whether the link is wrong or the client is switched off.
  if (!client) return json({ error: 'This report link is not valid.' }, 404);

  try {
    const out = await getReportPayload(
      env, ctx, client, settings,
      { range: url.searchParams.get('range') || client.defaultRange || '30', start: url.searchParams.get('start'), end: url.searchParams.get('end') },
      deps,
    );
    return json({ payload: out.payload, stale: out.stale, ...(out.savedAt ? { savedAt: out.savedAt } : {}) });
  } catch (e) {
    if (e instanceof RangeError) return json({ error: e.message }, 400);
    if (e instanceof AdsError) return json({ error: e.plain, code: e.code }, e.status);
    return json({ error: 'Something went wrong building this report. Try again in a minute.' }, 500);
  }
}

/** POST /api/refresh?c=<client id>  with  Authorization: Bearer <REFRESH_SECRET> */
export async function handleRefresh(request, env, ctx, deps = {}) {
  if (!env.REFRESH_SECRET) return json({ error: 'Not found.' }, 404);
  const auth = request.headers.get('authorization') || '';
  if (request.method !== 'POST' || !safeEqual(auth, `Bearer ${env.REFRESH_SECRET}`)) return json({ error: 'Not allowed.' }, 401);
  const { clients } = await loadConfig(env, deps);
  const client = findClientById(new URL(request.url).searchParams.get('c'), clients);
  if (!client) return json({ error: 'No client with that ID.' }, 404);
  if (usesSampleData(env, client)) return json({ ok: true, note: 'Sample data is showing, so there is nothing to refresh yet.' });
  const work = refreshClient(env, client, deps);
  if (ctx?.waitUntil) ctx.waitUntil(work);
  else await work;
  return json({ ok: true, started: true }, 202);
}

export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
