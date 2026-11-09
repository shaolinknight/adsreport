// Rebuilding and saving reports: the daily job, and the "refresh one client" button.

import { adsConfigured, buildPayload } from './ads.mjs';
import { resolveRange } from './ranges.mjs';
import { listClients, putSaved } from './store.mjs';

/** Which standard views to refresh each day. A setting (REFRESH_RANGES) so a small Google quota goes further. */
export function refreshRanges(env) {
  const raw = String(env.REFRESH_RANGES ?? '7,30,90');
  const list = raw.split(',').map((s) => s.trim()).filter((s) => ['7', '30', '90'].includes(s));
  return list.length ? list : ['30'];
}

export async function refreshOne(env, client, rangeInput, deps = {}) {
  const now = deps.now ?? new Date();
  const range = resolveRange(rangeInput, client.timezone, now);
  const payload = await buildPayload(env, client, range, { fetchImpl: deps.fetchImpl ?? fetch, now, retryDelayMs: deps.retryDelayMs });
  await putSaved(env, client.id, range.key, payload, now);
  return payload;
}

/** Refresh every standard view for one client, one after another (kind to Google's limits). */
export async function refreshClient(env, client, deps = {}) {
  const results = [];
  for (const r of refreshRanges(env)) {
    try {
      await refreshOne(env, client, { range: r }, deps);
      results.push({ range: r, ok: true });
    } catch (e) {
      results.push({ range: r, ok: false, error: e.plain || e.message });
    }
  }
  return results;
}

/** The daily job. Clients are refreshed side by side; their views one by one. */
export async function runDailyRefresh(env, deps = {}) {
  if (!adsConfigured(env)) return { skipped: 'Google Ads is not connected yet, so the sample data is showing.' };
  const active = (deps.clients ?? listClients()).filter((c) => c.active !== false && c.customerId);
  const settled = await Promise.allSettled(active.map((c) => refreshClient(env, c, deps)));
  return settled.map((s, i) => ({ client: active[i].id, result: s.status === 'fulfilled' ? s.value : String(s.reason) }));
}
