import { linearScale, niceTicks, formatMeasure, escapeHtml } from './scale.js';
import { formatDelta, deltaClass, hasBaseline as rowsHaveBaseline } from '../delta.js';

const WIDTH = 600;
const HEIGHT = 220;
const PAD = { top: 16, right: 56, bottom: 28, left: 56 };
const MIN_POINT_SPACING = 60; // below this, a month label collides with its neighbour's

const TIME_SLICES = new Set(['week', 'month']);

/**
 * Line — change over time. Only valid for a chronological slice; anything else
 * gets an explanation rather than a misleading line through unordered buckets.
 * Single series, so no legend: the panel title names it.
 *
 * The ghost-baseline rendering below (`viz-ghost-line`, the last-point delta
 * label) is currently dormant in production: `compareQuery()` never supplies
 * a baseline for a time slice (week/month), because a time slice's key IS
 * the period, so an earlier baseline window's keys can never join against
 * it — see lib/query/compare.js. Left in place and still covered by its own
 * unit tests (hand-built rows), since it becomes reachable the moment period
 * comparison gains a way to express a shifted multi-bucket window.
 */
export function renderLine(result, { title = '', colourFor } = {}) {
  const rows = result.rows ?? [];
  if (!TIME_SLICES.has(result.meta?.sliceBy)) {
    return `<p class="viz-empty">A line chart needs a time slice — choose Week or Month.</p>`;
  }
  if (!rows.length) return `<p class="viz-empty">No data for these filters</p>`;

  // Width grows with the number of points instead of cramming them —
  // years of monthly data overflow into `.viz-plot`'s own horizontal
  // scrollbar rather than collapsing the x-axis labels into each other.
  const minPlotW = rows.length > 1 ? (rows.length - 1) * MIN_POINT_SPACING : 0;
  const width = Math.max(WIDTH, PAD.left + PAD.right + minPlotW);
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const hasBaseline = rowsHaveBaseline(rows);
  // The domain covers baselines too, so a collapsed month's baseline line does
  // not run off the top of the plot.
  const maxValue = Math.max(...rows.map((r) => Math.max(Math.abs(r.value), Math.abs(r.baseline ?? 0))), 1);
  const yScale = linearScale(maxValue, plotH);
  const stepX = rows.length > 1 ? plotW / (rows.length - 1) : 0;

  const points = rows.map((row, i) => ({
    x: PAD.left + i * stepX,
    y: PAD.top + plotH - yScale(row.value),
    row
  }));

  const grid = niceTicks(maxValue, 4).map((tick) => {
    const y = PAD.top + plotH - yScale(tick);
    return `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${width - PAD.right}" y2="${y.toFixed(1)}" class="viz-grid"/>`;
  }).join('');

  const colour = colourFor ? colourFor(rows[0]) : 'currentColor';
  const measure = result.meta?.measure;
  const polyline = `<polyline points="${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="${colour}" stroke-width="2" stroke-linejoin="round"/>`;

  // Drawn before the solid series so the real values always sit on top.
  const baselineLine = hasBaseline
    ? `<polyline points="${rows.map((row, i) => `${(PAD.left + i * stepX).toFixed(1)},${(PAD.top + plotH - yScale(row.baseline ?? 0)).toFixed(1)}`).join(' ')}" fill="none" stroke="${colour}" stroke-width="1.5" stroke-dasharray="4 3" class="viz-ghost-line"/>`
    : '';

  const markers = points.map((p, i) => {
    const isEnd = i === 0 || i === points.length - 1;
    const title = isEnd ? `<title>${escapeHtml(p.row.label)}: ${formatMeasure(p.row.value, measure)}</title>` : '';
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${colour}" stroke="var(--viz-surface)" stroke-width="2" class="viz-clickable" data-slice-key="${escapeHtml(p.row.key)}">${title}</circle>`;
  }).join('');

  // Selective direct labels: first and last only.
  const ends = points.length > 1 ? [points[0], points.at(-1)] : [points[0]];
  const endLabels = ends.map((p, i) =>
    `<text x="${p.x.toFixed(1)}" y="${(p.y - 10).toFixed(1)}" text-anchor="${i === 0 ? 'start' : 'end'}" class="viz-value">${formatMeasure(p.row.value, measure)}</text>`
  ).join('');

  const xLabels = points.map((p) =>
    `<text x="${p.x.toFixed(1)}" y="${HEIGHT - 8}" text-anchor="middle" class="viz-label">${escapeHtml(p.row.label)}</text>`
  ).join('');

  const lastRow = rows.at(-1);
  const lastDelta = hasBaseline && points.length
    ? (() => {
        const p = points.at(-1);
        // Normally sits 26px above the point, level with the value label
        // 16px further up. A point near the top of the domain pushes that
        // above y=0 — off the declared viewBox — so flip it below the point
        // instead of clamping, which keeps it clear of the value label
        // regardless of how close the point sits to the top. Flip at y=8,
        // not y=0: text y is the baseline, and an 11px font's ascender rises
        // ~8px above it, so a label placed at y=0..8 still gets its glyph
        // tops clipped by the viewport even though the baseline itself is
        // in bounds.
        const y = p.y - 26 < 8 ? p.y + 18 : p.y - 26;
        return `<text x="${p.x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="end" class="${deltaClass(lastRow.delta)}">${escapeHtml(formatDelta(lastRow.delta, lastRow.deltaPct, measure))}</text>`;
      })()
    : '';

  return `<svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${width} ${HEIGHT}" width="${width}" class="viz-line">${grid}${baselineLine}${polyline}${markers}${endLabels}${lastDelta}${xLabels}</svg>`;
}
