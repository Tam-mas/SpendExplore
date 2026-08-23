import { linearScale, niceTicks, formatMeasure, escapeHtml } from './scale.js';

const WIDTH = 600;
const HEIGHT = 220;
const PAD = { top: 16, right: 56, bottom: 28, left: 56 };

const TIME_SLICES = new Set(['week', 'month']);

/**
 * Line — change over time. Only valid for a chronological slice; anything else
 * gets an explanation rather than a misleading line through unordered buckets.
 * Single series, so no legend: the panel title names it.
 */
export function renderLine(result, { title = '', colourFor } = {}) {
  const rows = result.rows ?? [];
  if (!TIME_SLICES.has(result.meta?.sliceBy)) {
    return `<p class="viz-empty">A line chart needs a time slice — choose Week or Month.</p>`;
  }
  if (!rows.length) return `<p class="viz-empty">No data for these filters</p>`;

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const maxValue = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  const yScale = linearScale(maxValue, plotH);
  const stepX = rows.length > 1 ? plotW / (rows.length - 1) : 0;

  const points = rows.map((row, i) => ({
    x: PAD.left + i * stepX,
    y: PAD.top + plotH - yScale(row.value),
    row
  }));

  const grid = niceTicks(maxValue, 4).map((tick) => {
    const y = PAD.top + plotH - yScale(tick);
    return `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${WIDTH - PAD.right}" y2="${y.toFixed(1)}" class="viz-grid"/>`;
  }).join('');

  const colour = colourFor ? colourFor(rows[0]) : 'currentColor';
  const measure = result.meta?.measure;
  const polyline = `<polyline points="${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="${colour}" stroke-width="2" stroke-linejoin="round"/>`;

  const markers = points.map((p, i) => {
    const isEnd = i === 0 || i === points.length - 1;
    const title = isEnd ? `<title>${escapeHtml(p.row.label)}: ${formatMeasure(p.row.value, measure)}</title>` : '';
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${colour}" stroke="var(--viz-surface)" stroke-width="2">${title}</circle>`;
  }).join('');

  // Selective direct labels: first and last only.
  const ends = points.length > 1 ? [points[0], points.at(-1)] : [points[0]];
  const endLabels = ends.map((p, i) =>
    `<text x="${p.x.toFixed(1)}" y="${(p.y - 10).toFixed(1)}" text-anchor="${i === 0 ? 'start' : 'end'}" class="viz-value">${formatMeasure(p.row.value, measure)}</text>`
  ).join('');

  const xLabels = points.map((p) =>
    `<text x="${p.x.toFixed(1)}" y="${HEIGHT - 8}" text-anchor="middle" class="viz-label">${escapeHtml(p.row.label)}</text>`
  ).join('');

  return `<svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" class="viz-line">${grid}${polyline}${markers}${endLabels}${xLabels}</svg>`;
}
