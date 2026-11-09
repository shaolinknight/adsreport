// Small hand-made SVG chart: a line for this period and a dashed line for the previous period.
// No chart library, so the page stays fast and there is nothing extra to load.

import { esc, shortDate } from '../lib/format.mjs';

/** A tidy step size (1, 2, 5 or 10 times a power of ten) so the left-hand labels are round numbers. */
export function niceStep(max, ticks = 4) {
  if (!(max > 0)) return 1;
  const raw = max / ticks;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/**
 * points: [{ date, prevDate, cur, prev }]  (numbers)
 * fmt: (number) => string, used for the left-hand labels
 * Returns { svg, model } where model is used by the page to show a tooltip.
 */
export function lineChart({ points, width, fmt, label }) {
  const W = Math.max(300, Math.round(width));
  const H = W < 520 ? 220 : 270;
  const m = { l: W < 520 ? 42 : 52, r: 12, t: 12, b: 26 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const n = points.length;

  const rawMax = Math.max(1, ...points.map((p) => Math.max(p.cur, p.prev)));
  const step = niceStep(rawMax);
  const tickTotal = Math.max(1, Math.ceil(rawMax / step));
  const yMax = step * tickTotal;
  const x = (i) => m.l + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
  const y = (v) => m.t + ph - (v / yMax) * ph;

  const path = (key) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');

  let grid = '';
  for (let t = 0; t <= tickTotal; t++) {
    const v = step * t;
    const yy = y(v).toFixed(1);
    grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" stroke="var(--line)" stroke-width="1"${t === 0 ? '' : ' stroke-dasharray="2 4"'}/>`;
    grid += `<text x="${m.l - 8}" y="${(Number(yy) + 4).toFixed(1)}" text-anchor="end" font-size="11.5" fill="var(--ink-3)">${esc(fmt(v))}</text>`;
  }

  const tickCount = W < 520 ? 4 : 6;
  let xl = '';
  const used = new Set();
  for (let t = 0; t < tickCount; t++) {
    const i = n <= 1 ? 0 : Math.round((t / (tickCount - 1)) * (n - 1));
    if (used.has(i)) continue;
    used.add(i);
    const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
    xl += `<text x="${x(i).toFixed(1)}" y="${H - 7}" text-anchor="${anchor}" font-size="11.5" fill="var(--ink-3)">${esc(shortDate(points[i].date))}</text>`;
  }

  const area = n > 1 ? `<path d="${path('cur')}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z" fill="var(--brand)" opacity="0.08"/>` : '';
  const dot = n === 1 ? `<circle cx="${x(0)}" cy="${y(points[0].cur)}" r="4" fill="var(--brand)"/>` : '';

  const svg = `<svg id="trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" width="${W}" height="${H}">
    ${grid}${xl}
    <path d="${path('prev')}" fill="none" stroke="var(--ink-3)" stroke-width="1.75" stroke-dasharray="5 4" stroke-linejoin="round"/>
    ${area}
    <path d="${path('cur')}" fill="none" stroke="var(--brand)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dot}
    <line id="guide" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" stroke="var(--ink)" stroke-width="1" opacity="0" />
    <circle id="guide-dot" r="4.5" fill="var(--brand)" stroke="#fff" stroke-width="2" opacity="0" cx="0" cy="0"/>
    <rect id="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent" style="touch-action: pan-y"/>
  </svg>`;

  return { svg, model: { W, H, m, pw, n, x: null, points, yMax } };
}

/** Where to put the tooltip guide for a pointer position. Pure maths so it can be tested. */
export function nearestIndex(offsetX, model) {
  const { m, pw, n } = model;
  if (n <= 1) return 0;
  const rel = (offsetX - m.l) / pw;
  return Math.min(n - 1, Math.max(0, Math.round(rel * (n - 1))));
}
