// Turns "last 30 days" or a custom start and end date into the exact dates a report covers,
// plus the previous period of the same length (used for every "change" number).

import { addDays, diffDays } from '../../src/lib/calc.mjs';

export const PRESETS = [7, 30, 90];
export const MAX_CUSTOM_DAYS = 366;

/** Today's date (YYYY-MM-DD) in the client's own time zone. */
export function todayIn(timeZone, now = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s) {
  if (!ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * input: { range: '7' | '30' | '90' | 'custom', start, end }
 * Reports always end yesterday (today's numbers are still changing), in the client's time zone.
 */
export function resolveRange(input, timeZone, now = new Date()) {
  const yesterday = addDays(todayIn(timeZone, now), -1);
  const raw = String(input.range ?? '30');

  if (raw !== 'custom') {
    const n = Number(raw);
    if (!PRESETS.includes(n)) throw new RangeError('Choose 7, 30 or 90 days, or pick custom dates.');
    return build(addDays(yesterday, -(n - 1)), yesterday, String(n));
  }

  const { start, end } = input;
  if (!validDate(start) || !validDate(end)) throw new RangeError('Pick a start and an end date.');
  if (start > end) throw new RangeError('The start date must be before the end date.');
  const clampedEnd = end > yesterday ? yesterday : end;
  if (start > clampedEnd) throw new RangeError('Those dates are in the future. Reports run up to yesterday.');
  if (diffDays(start, clampedEnd) + 1 > MAX_CUSTOM_DAYS) throw new RangeError('Custom ranges can cover up to one year.');
  return build(start, clampedEnd, 'custom');
}

function build(start, end, preset) {
  const days = diffDays(start, end) + 1;
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  const key = preset === 'custom' ? `c_${start}_${end}` : preset;
  return { preset, key, start, end, prevStart, prevEnd, days };
}
