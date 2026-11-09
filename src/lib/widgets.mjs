// Small pieces of page markup shared by the client report and the hub.
// Everything that comes from a client or from Google goes through esc().

import { esc } from './format.mjs';

export function statusLabel(status) {
  return { green: 'On track', amber: 'Watch', red: 'Off track', nodata: 'No data yet' }[status] || '';
}

/**
 * How far along a goal is, from 0 to 1, on a strip that runs from nothing to 125% of the goal.
 * The goal itself sits where the fourth chip meets the fifth, so the last chip means "past the goal".
 */
export function goalProgress(g) {
  if (g.value == null || !(g.goal > 0)) return 0;
  return Math.max(0, Math.min(1, g.value / (1.25 * g.goal)));
}

/** One goal as a five-step paint strip. `fmt(g, number)` prints a number the way this goal shows it. */
export function goalHtml(g, fmt) {
  const progress = goalProgress(g);
  const steps = [0, 1, 2, 3, 4]
    .map((i) => `<span class="step"><i style="--fill:${Math.max(0, Math.min(1, progress * 5 - i)) * 100}%"></i></span>`)
    .join('');
  const goalText =
    g.key === 'costPerResult' ? `Goal ${fmt(g, g.goal)} or less`
    : g.key === 'spend' ? `Budget for this period ${fmt(g, g.goal)}`
    : g.key === 'roas' ? `Goal ${fmt(g, g.goal)} or more`
    : `Goal for this period ${fmt(g, g.goal)}`;
  const aria = `${g.label}: ${statusLabel(g.status)}. ${g.value == null ? 'No number yet' : `${Math.round((g.value / g.goal) * 100)} percent of the goal`}.`;
  return `<div class="goal">
    <div class="goal-head"><span class="goal-name">${esc(g.label)}</span><span class="status ${esc(g.status)}">${statusLabel(g.status)}</span></div>
    <div class="strip" role="img" aria-label="${esc(aria)}">${steps}</div>
    <div class="goal-foot"><span>Now <b class="num">${esc(fmt(g, g.value))}</b></span><span class="num">${esc(goalText)}</span></div>
  </div>`;
}
