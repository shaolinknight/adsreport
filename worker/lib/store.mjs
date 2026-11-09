// The client list and saved reports.
//
// Version 1.0: the client list is the bundled clients.json file.
// Saved reports live in Cloudflare KV (the "REPORTS" store). A data version number is part of every
// saved key, so when the numbers or their shape change, old saved copies are simply not found
// and get rebuilt.

import clientsFile from '../../clients.json' with { type: 'json' };
import { DATA_VERSION } from '../../src/lib/calc.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

export function listClients() {
  return clientsFile;
}

export function findClientByKey(linkKey, clients = listClients()) {
  if (!linkKey) return null;
  return clients.find((c) => c.linkKey === linkKey && c.active !== false) || null;
}

export function findClientById(id, clients = listClients()) {
  return clients.find((c) => c.id === id) || null;
}

export function reportKey(clientId, rangeKey) {
  return `report:v${DATA_VERSION}:${clientId}:${rangeKey}`;
}

export async function getSaved(env, clientId, rangeKey) {
  if (!env.REPORTS) return null;
  try {
    const saved = await env.REPORTS.get(reportKey(clientId, rangeKey), 'json');
    if (!saved || !saved.payload || saved.payload.version !== DATA_VERSION) return null;
    return saved;
  } catch {
    return null;
  }
}

export async function putSaved(env, clientId, rangeKey, payload, now = new Date()) {
  if (!env.REPORTS) return;
  const custom = rangeKey.startsWith('c_');
  // Saved copies of custom date ranges are cleared after two weeks; the standard views after two months.
  const expirationTtl = custom ? 14 * 24 * 3600 : 60 * 24 * 3600;
  await env.REPORTS.put(reportKey(clientId, rangeKey), JSON.stringify({ savedAt: now.toISOString(), payload }), { expirationTtl });
}

export function isStale(savedAt, now = new Date(), maxAgeMs = DAY_MS) {
  return now.getTime() - new Date(savedAt).getTime() > maxAgeMs;
}
