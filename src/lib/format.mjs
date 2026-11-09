// Small formatting helpers. Used by the report page in the browser and by the tests.

/** Escape text before putting it into HTML, so a campaign called "<b>Sale</b>" cannot break the page. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function money(n, currency = 'USD', { cents } = {}) {
  if (n == null || Number.isNaN(n)) return '—';
  const useCents = cents ?? Math.abs(n) < 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: useCents ? 2 : 0,
    maximumFractionDigits: useCents ? 2 : 0,
  }).format(n);
}

export function int(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n));
}

/** Results can be fractional in Google Ads (data-driven credit). Show one decimal only when needed. */
export function results(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const rounded = Math.round(n * 10) / 10;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(rounded);
}

/** ratio 0.0432 -> "4.3%" */
export function pct(ratio, digits = 1) {
  if (ratio == null || Number.isNaN(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** change ratio 0.123 -> "+12.3%" */
export function signedPct(change) {
  if (change == null || Number.isNaN(change)) return '—';
  const v = change * 100;
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${Math.abs(v).toFixed(Math.abs(v) >= 100 ? 0 : 1)}%`;
}

export function compact(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-08" -> "Nov 8" */
export function shortDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "2026-11-08" -> "Nov 8, 2026" */
export function longDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
