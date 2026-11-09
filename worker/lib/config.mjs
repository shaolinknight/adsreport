// Clients and site-wide settings.
//
// Version 1.1: the admin hub saves everything in Cloudflare KV (key "config:v1"). The bundled
// clients.json is only the starting copy, used the first time the site runs.

import clientsFile from '../../clients.json' with { type: 'json' };
import { THRESHOLDS } from '../../src/lib/calc.mjs';
import { DEFAULT_METRICS, DEFAULT_METRICS_WITH_SALES, METRIC_KEYS, PALETTE_IDS, RANGE_CHOICES, TAB_IDS, resolvePalette } from '../../src/lib/catalog.mjs';

export const CONFIG_KEY = 'config:v1';
const RESERVED_WORDS = new Set(['admin', 'team', 'api', 'css', 'js', 'fonts', 'login', 'logout']);
export const SAMPLE_PROFILES = ['mealprep', 'bookkeeping'];

export const DEFAULT_SETTINGS = {
  agency: { name: '', mark: 'K' },
  thresholds: { ...THRESHOLDS },
};

export class ValidationError extends Error {
  constructor(fields) {
    super('Some details need fixing.');
    this.fields = fields;
  }
}

const digits = (s) => String(s ?? '').replace(/\D/g, '');

/** Fill in anything an older client record does not have yet. */
export function withDefaults(c) {
  const goals = { costPerResult: 0, monthlyBudget: 0, monthlyResults: 0, roas: 0, ...(c.goals || {}) };
  const wantsSales = goals.roas > 0;
  return {
    id: c.id,
    name: c.name,
    linkKey: c.linkKey,
    customerId: c.customerId || '',
    timezone: c.timezone || 'America/Los_Angeles',
    currency: c.currency || 'USD',
    resultLabel: { one: c.resultLabel?.one || 'result', many: c.resultLabel?.many || 'results' },
    conversionActions: Array.isArray(c.conversionActions) ? c.conversionActions : [],
    goals,
    notes: c.notes || '',
    sampleProfile: SAMPLE_PROFILES.includes(c.sampleProfile) ? c.sampleProfile : 'mealprep',
    active: c.active !== false,
    palette: resolvePalette(c.palette, 'harbor'),
    tabs: Array.isArray(c.tabs) && c.tabs.length ? c.tabs.filter((t) => TAB_IDS.includes(t)) : [...TAB_IDS],
    metrics: Array.isArray(c.metrics) && c.metrics.length ? c.metrics.filter((m) => METRIC_KEYS.includes(m)) : [...(wantsSales ? DEFAULT_METRICS_WITH_SALES : DEFAULT_METRICS)],
    defaultRange: RANGE_CHOICES.includes(String(c.defaultRange)) ? String(c.defaultRange) : '30',
    intro: c.intro || '',
    createdAt: c.createdAt || '',
  };
}

export function mergeSettings(s) {
  const t = { ...THRESHOLDS, ...(s?.thresholds || {}) };
  return {
    agency: { name: String(s?.agency?.name ?? DEFAULT_SETTINGS.agency.name), mark: String(s?.agency?.mark || DEFAULT_SETTINGS.agency.mark) },
    thresholds: t,
  };
}

export function seedConfig() {
  return { settings: mergeSettings(), clients: clientsFile.map(withDefaults) };
}

/** Read everything. `deps.config` lets the tests stand in for the store. */
export async function loadConfig(env, deps = {}) {
  if (deps.config) return { settings: mergeSettings(deps.config.settings), clients: (deps.config.clients || []).map(withDefaults) };
  if (deps.clients) return { settings: mergeSettings(), clients: deps.clients.map(withDefaults) }; // older test hook
  let stored = null;
  if (env?.REPORTS) {
    try {
      stored = await env.REPORTS.get(CONFIG_KEY, 'json');
    } catch {
      stored = null;
    }
  }
  if (!stored || !Array.isArray(stored.clients)) return { ...seedConfig(), seeded: true };
  return { settings: mergeSettings(stored.settings), clients: stored.clients.map(withDefaults) };
}

/** Clients only, for the code that does not care about settings. `deps.clients` is the older test hook. */
export async function getClients(env, deps = {}) {
  return (await loadConfig(env, deps)).clients;
}

export async function saveConfig(env, config) {
  if (!env?.REPORTS) throw new Error('The saved-report store is not connected, so changes cannot be saved.');
  await env.REPORTS.put(CONFIG_KEY, JSON.stringify({ settings: config.settings, clients: config.clients, savedAt: new Date().toISOString() }));
}

export function findClientByKey(linkKey, clients) {
  if (!linkKey) return null;
  return clients.find((c) => c.linkKey === linkKey && c.active !== false) || null;
}

export function findClientById(id, clients) {
  return clients.find((c) => c.id === id) || null;
}

// ---------- what the report page is allowed to see ----------

/** The part of a client that is safe to put in a report (no notes, no account ID, no link key). */
export function publicConfig(client, settings) {
  return {
    name: client.name,
    resultLabel: client.resultLabel,
    timezone: client.timezone,
    currency: client.currency || 'USD',
    goals: client.goals,
    showRevenue: !!(client.goals && client.goals.roas > 0),
    palette: client.palette,
    tabs: client.tabs,
    metrics: client.metrics,
    defaultRange: client.defaultRange,
    intro: client.intro,
    thresholds: settings.thresholds,
    agency: { name: settings.agency.name, mark: settings.agency.mark },
  };
}

/** Put today's settings onto a saved report, so goal and layout changes show at once without a refresh. */
export function applyConfig(payload, client, settings) {
  return { ...payload, client: { ...payload.client, ...publicConfig(client, settings) } };
}

/** What the saved numbers depend on. If this changes, the saved copy is out of date. */
export function dataSignature(client) {
  return `${digits(client.customerId)}|${(client.conversionActions || []).join('\u0001')}`;
}

// ---------- checking what the admin hub sends ----------

function text(v, max, label, fields, key, { required = false } = {}) {
  const s = String(v ?? '').trim();
  if (required && !s) fields[key] = `${label} is needed.`;
  else if (s.length > max) fields[key] = `${label} can be up to ${max} characters.`;
  return s;
}

function number(v, max, label, fields, key) {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) fields[key] = `${label} must be a number, zero or more.`;
  else if (n > max) fields[key] = `${label} looks too large.`;
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

export function slugify(name) {
  return String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'client';
}

export function randomKey(length = 7) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

export function newLinkKey(name, clients) {
  for (let i = 0; i < 20; i++) {
    const key = `${slugify(name)}-${randomKey()}`;
    if (!clients.some((c) => c.linkKey === key) && !RESERVED_WORDS.has(key)) return key;
  }
  throw new Error('Could not make a new link. Try again.');
}

/**
 * Check and tidy the details of one client. `existing` is the saved record when editing, so the
 * fields that are not sent keep their values. Throws ValidationError with a message per field.
 */
export function validateClient(input, existing, allClients) {
  const fields = {};
  const base = existing ? { ...existing } : withDefaults({ name: '', goals: {} });
  const src = { ...base, ...input, goals: { ...base.goals, ...(input.goals || {}) }, resultLabel: { ...base.resultLabel, ...(input.resultLabel || {}) } };

  const name = text(src.name, 80, 'The name', fields, 'name', { required: true });
  const customerRaw = digits(src.customerId);
  if (customerRaw && customerRaw.length !== 10) fields.customerId = 'A Google Ads account ID has 10 digits, like 123-456-7890.';
  const customerId = customerRaw.length === 10 ? `${customerRaw.slice(0, 3)}-${customerRaw.slice(3, 6)}-${customerRaw.slice(6)}` : '';

  let timezone = String(src.timezone || '').trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    fields.timezone = 'That time zone is not recognised. Use a name like America/Los_Angeles.';
  }
  const currency = String(src.currency || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fields.currency = 'Use a three-letter currency code, like USD.';

  const one = text(src.resultLabel.one, 30, 'The singular word', fields, 'resultLabelOne', { required: true });
  const many = text(src.resultLabel.many, 30, 'The plural word', fields, 'resultLabelMany', { required: true });

  let actions = src.conversionActions;
  if (typeof actions === 'string') actions = actions.split('\n');
  actions = (Array.isArray(actions) ? actions : []).map((a) => String(a).trim()).filter(Boolean);
  if (actions.length > 20 || actions.some((a) => a.length > 100)) fields.conversionActions = 'Use up to 20 names, each under 100 characters.';

  const goals = {
    costPerResult: number(src.goals.costPerResult, 100000, 'Cost per result', fields, 'goalCostPerResult'),
    monthlyBudget: number(src.goals.monthlyBudget, 10000000, 'Monthly budget', fields, 'goalMonthlyBudget'),
    monthlyResults: number(src.goals.monthlyResults, 1000000, 'Results per month', fields, 'goalMonthlyResults'),
    roas: number(src.goals.roas, 1000, 'Return on ad spend', fields, 'goalRoas'),
  };

  const palette = PALETTE_IDS.includes(src.palette) ? src.palette : (fields.palette = 'Pick one of the colours.', 'harbor');
  const tabs = (Array.isArray(src.tabs) ? src.tabs : []).filter((t) => TAB_IDS.includes(t));
  const orderedTabs = TAB_IDS.filter((t) => tabs.includes(t));
  if (!orderedTabs.length) fields.tabs = 'Keep at least one tab.';
  const metrics = [];
  for (const m of Array.isArray(src.metrics) ? src.metrics : []) if (METRIC_KEYS.includes(m) && !metrics.includes(m)) metrics.push(m);
  if (metrics.length < 3 || metrics.length > 10) fields.metrics = 'Pick between 3 and 10 numbers.';
  const defaultRange = RANGE_CHOICES.includes(String(src.defaultRange)) ? String(src.defaultRange) : (fields.defaultRange = 'Pick 7, 30 or 90 days.', '30');
  const intro = text(src.intro, 300, 'The note', fields, 'intro');
  const notes = text(src.notes, 2000, 'The private notes', fields, 'notes');
  const sampleProfile = SAMPLE_PROFILES.includes(src.sampleProfile) ? src.sampleProfile : 'mealprep';
  const active = src.active !== false;

  if (Object.keys(fields).length) throw new ValidationError(fields);

  let id = existing?.id;
  let linkKey = existing?.linkKey;
  if (!existing) {
    const taken = new Set(allClients.map((c) => c.id));
    const slug = slugify(name);
    id = slug;
    for (let n = 2; taken.has(id); n++) id = `${slug}-${n}`;
    linkKey = newLinkKey(name, allClients);
  }

  return withDefaults({
    id, name, linkKey, customerId, timezone, currency, resultLabel: { one, many }, conversionActions: actions, goals, notes,
    sampleProfile, active, palette, tabs: orderedTabs, metrics, defaultRange, intro, createdAt: existing?.createdAt || new Date().toISOString(),
  });
}

export function validateSettings(input) {
  const fields = {};
  const name = text(input?.agency?.name, 40, 'The agency name', fields, 'agencyName');
  const mark = text(input?.agency?.mark, 2, 'The mark', fields, 'agencyMark', { required: true });
  const t = { ...THRESHOLDS, ...(input?.thresholds || {}) };
  const range = (key, lo, hi, label) => {
    const n = Number(t[key]);
    if (!Number.isFinite(n) || n < lo || n > hi) fields[key] = `${label} must be between ${lo} and ${hi}.`;
    t[key] = n;
  };
  range('costPerResultAmber', 1, 3, 'Cost per result, amber limit');
  range('resultsAmber', 0.1, 1, 'Results, amber limit');
  range('spendLow', 0.1, 1, 'Spend, low limit');
  range('spendAmber', 1, 3, 'Spend, amber limit');
  range('spendRed', 1, 5, 'Spend, red limit');
  range('roasAmber', 0.1, 1, 'Return on ad spend, amber limit');
  if (!fields.spendAmber && !fields.spendRed && t.spendRed < t.spendAmber) fields.spendRed = 'The red limit for spend must be at or above the amber limit.';
  if (Object.keys(fields).length) throw new ValidationError(fields);
  return { agency: { name, mark }, thresholds: t };
}
