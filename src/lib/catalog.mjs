// The lists the admin hub lets you choose from, shared by the report page, the hub and the Worker.
// One place, so a new palette or metric only has to be added here (plus its colours in base.css).

/** Colour chips. Each one is a hue; base.css turns it into a five-step tint ladder. */
export const PALETTES = [
  { id: 'paprika', name: 'Paprika', about: 'Warm red-orange. Good for food and local shops.' },
  { id: 'saffron', name: 'Saffron', about: 'Golden yellow-orange. Friendly and bright.' },
  { id: 'fern', name: 'Fern', about: 'Fresh green. Good for money and health.' },
  { id: 'lagoon', name: 'Lagoon', about: 'Teal blue. Calm and clean.' },
  { id: 'harbor', name: 'Harbor', about: 'Deep blue. Steady and professional.' },
  { id: 'plum', name: 'Plum', about: 'Purple. Distinctive and a little bold.' },
  { id: 'clay', name: 'Clay', about: 'Muted terracotta. Earthy and quiet.' },
  { id: 'slate', name: 'Slate', about: 'Cool grey. Neutral for any client.' },
];

// The first three palettes people saw in version 1.0 still work in links (?theme=steel).
export const LEGACY_PALETTES = { steel: 'harbor', banner: 'paprika', order: 'fern' };

export const PALETTE_IDS = PALETTES.map((p) => p.id);

export function resolvePalette(id, fallback = 'harbor') {
  if (PALETTE_IDS.includes(id)) return id;
  if (LEGACY_PALETTES[id]) return LEGACY_PALETTES[id];
  return PALETTE_IDS.includes(fallback) ? fallback : 'harbor';
}

/** The report tabs. `short` is the label on a phone. */
export const TABS = [
  { id: 'overview', long: 'Overview', short: 'Overview' },
  { id: 'weeks', long: 'Week by week', short: 'Weeks' },
  { id: 'campaigns', long: 'Campaigns', short: 'Campaigns' },
  { id: 'audiences', long: 'Audiences', short: 'Audiences' },
  { id: 'creative', long: 'Creative', short: 'Creative' },
];
export const TAB_IDS = TABS.map((t) => t.id);

/**
 * The numbers that can appear at the top of the Overview.
 * `label(l)` takes the client's result words ({one, many}); `kind` says how to print it.
 * The first three a client has chosen are shown large; the rest are shown smaller beneath them.
 */
export const METRICS = [
  { key: 'spend', label: () => 'Spend', kind: 'money0' },
  { key: 'results', label: (l) => cap(l.many), kind: 'results' },
  { key: 'costPerResult', label: (l) => `Cost per ${l.one}`, kind: 'money' },
  { key: 'resultRate', label: (l) => `${cap(l.one)} rate`, kind: 'pct', hint: (l) => `Share of clicks that ended in a ${l.one}` },
  { key: 'clicks', label: () => 'Clicks', kind: 'int' },
  { key: 'ctr', label: () => 'Click rate', kind: 'pct', hint: () => 'Share of people who saw an ad and clicked it' },
  { key: 'impressions', label: () => 'Times shown', kind: 'int' },
  { key: 'cpc', label: () => 'Cost per click', kind: 'money' },
  { key: 'roas', label: () => 'Return on ad spend', kind: 'ratio', hint: () => 'Sales for every $1 spent on ads' },
  { key: 'revenue', label: () => 'Sales value', kind: 'money0', hint: () => 'The value Google Ads recorded for the results' },
];
export const METRIC_KEYS = METRICS.map((m) => m.key);

export const DEFAULT_METRICS = ['results', 'spend', 'costPerResult', 'resultRate', 'clicks', 'ctr', 'impressions', 'cpc'];
export const DEFAULT_METRICS_WITH_SALES = ['results', 'spend', 'costPerResult', 'roas', 'resultRate', 'clicks', 'ctr', 'impressions'];

export const RANGE_CHOICES = ['7', '30', '90'];

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
