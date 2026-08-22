import { linearScale, formatMoney, escapeHtml } from './scale.js';

const WIDTH = 600;
const HEIGHT = 240;
const PAD = { top: 16, right: 16, bottom: 28, left: 56 };
const TIME_SLICES = new Set(['week', 'month']);

/**
 * Stacked area — how the MIX changes over time.
 *
 * `series` is supplied by the caller (the panel), because a stack needs a second
 * dimension the single-slice query result does not carry: one entry per series,
 * each with one value per time bucket, in the same order as `result.rows`.
 */
export function renderStacked(result, { title = '', colourFor, series = [] } = {}) {
  if (!TIME_SLICES.has(result.meta?.sliceBy)) {
    return `<p class="viz-empty">A stacked chart needs a time slice — choose Week or Month.</p>`;
  }
  const rows = result.rows ?? [];
  if (!rows.length || !series.length) return `<p class="viz-empty">No data for these filters</p>`;

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const stepX = rows.length > 1 ? plotW / (rows.length - 1) : 0;

  const totals = rows.map((_, i) => series.reduce((a, s) => a + Math.abs(s.values[i] ?? 0), 0));
  const maxTotal = Math.max(...totals, 1);
  const yScale = linearScale(maxTotal, plotH);

  const cumulative = rows.map(() => 0);
  const bands = series.map((s) => {
    const upper = rows.map((_, i) => {
      cumulative[i] += Math.abs(s.values[i] ?? 0);
      return { x: PAD.left + i * stepX, y: PAD.top + plotH - yScale(cumulative[i]) };
    });
    const lower = rows.map((_, i) => ({
      x: PAD.left + i * stepX,
      y: PAD.top + plotH - yScale(cumulative[i] - Math.abs(s.values[i] ?? 0))
    })).reverse();

    const d = [...upper, ...lower].map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z';
    const colour = colourFor ? colourFor({ key: s.key, label: s.label }) : 'currentColor';
    // 2px surface stroke is the gap between adjacent bands.
    return `<path d="${d}" fill="${colour}" stroke="var(--viz-surface)" stroke-width="2"><title>${escapeHtml(s.label)}</title></path>`;
  }).join('');

  const legend = series.map((s) => {
    const colour = colourFor ? colourFor({ key: s.key, label: s.label }) : 'currentColor';
    return `<li><span class="viz-swatch" style="background:${colour}"></span>${escapeHtml(s.label)}</li>`;
  }).join('');

  const xLabels = rows.map((row, i) =>
    `<text x="${(PAD.left + i * stepX).toFixed(1)}" y="${HEIGHT - 8}" text-anchor="middle" class="viz-label">${escapeHtml(row.label)}</text>`
  ).join('');

  return `
  <div class="viz-stacked">
    <svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%">${bands}${xLabels}</svg>
    <ul class="viz-legend">${legend}</ul>
  </div>`;
}
