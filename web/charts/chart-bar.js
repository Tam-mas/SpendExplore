import { linearScale, formatMeasure, escapeHtml } from './scale.js';
import { formatDelta, deltaClass, hasBaseline as rowsHaveBaseline } from '../delta.js';

const ROW_HEIGHT = 34;
const BAR_HEIGHT = 16;      // thin marks
const LABEL_WIDTH = 150;
export const VALUE_WIDTH = 96;
// The delta column holds formatDelta's output, which for an isNew row (no
// baseline to take a percentage of) falls back to an arrow-prefixed money
// string ("▲ $12,345.67") — never shorter than the plain value string next
// to it. Give it at least as much room as the value column, plus space for
// the "▲ " prefix and a visible gap so the two columns never touch.
export const DELTA_WIDTH = VALUE_WIDTH + 18; // only reserved when a comparison is active
const GAP = 2;              // 2px surface gap between adjacent fills

/**
 * Horizontal bar chart. Every bar is direct-labelled with its name and value —
 * that is the relief the palette's light-mode contrast WARN requires.
 *
 * When the result carries a baseline, each bar gets a dashed outline at the
 * baseline value behind it, so the SIZE of the gap is visible and not just its
 * percentage. The outline is drawn first and never captures pointer events, so
 * click-to-drill still hits the solid bar.
 */
export function renderBar(result, { mode = 'light', colourFor, title = '' } = {}) {
  const rows = result.rows ?? [];
  if (!rows.length) {
    return `<svg role="img" aria-label="${escapeHtml(title)}: no data" viewBox="0 0 600 60" width="100%"><text x="300" y="34" text-anchor="middle" class="viz-empty">No data for these filters</text></svg>`;
  }

  const hasBaseline = rowsHaveBaseline(rows);
  const width = 600;
  const valueWidth = VALUE_WIDTH + (hasBaseline ? DELTA_WIDTH : 0);
  const plotWidth = width - LABEL_WIDTH - valueWidth;
  const height = rows.length * ROW_HEIGHT;
  // The domain includes baselines: a month whose spend collapsed has a ghost
  // bar wider than every real bar, and it must still fit the plot.
  const maxValue = Math.max(...rows.map((r) => Math.max(Math.abs(r.value), Math.abs(r.baseline ?? 0))));
  const scale = linearScale(maxValue, plotWidth);
  const measure = result.meta?.measure;
  const valueX = width - (hasBaseline ? DELTA_WIDTH : 0);

  const bars = rows.map((row, i) => {
    const y = i * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;
    const barWidth = Math.max(scale(row.value) - GAP, 0);
    const colour = colourFor ? colourFor(row) : 'currentColor';
    const showGhost = row.baseline !== null && row.baseline !== undefined;
    const ghostWidth = showGhost ? Math.max(scale(row.baseline) - GAP, 0) : 0;

    const ghost = showGhost
      ? `<rect x="${LABEL_WIDTH}" y="${(y - 3).toFixed(1)}" width="${ghostWidth.toFixed(1)}" height="${BAR_HEIGHT + 6}"
              rx="4" fill="none" stroke="${colour}" stroke-width="1" stroke-dasharray="3 2" class="viz-ghost"/>`
      : '';
    const delta = hasBaseline
      ? `<text x="${width}" y="${y + BAR_HEIGHT - 3}" text-anchor="end" class="${deltaClass(row.delta)}">${escapeHtml(formatDelta(row.delta, row.deltaPct, measure))}</text>`
      : '';

    return `
    <g>
      <text x="0" y="${y + BAR_HEIGHT - 3}" class="viz-label">${escapeHtml(row.label)}</text>
      ${ghost}
      <rect x="${LABEL_WIDTH}" y="${y}" width="${barWidth.toFixed(1)}" height="${BAR_HEIGHT}"
            rx="4" fill="${colour}" class="viz-clickable" data-slice-key="${escapeHtml(row.key)}"><title>${escapeHtml(row.label)}: ${formatMeasure(row.value, measure)} · ${row.count} txns</title></rect>
      <text x="${valueX}" y="${y + BAR_HEIGHT - 3}" text-anchor="end" class="viz-value">${formatMeasure(row.value, measure)}</text>
      ${delta}
    </g>`;
  }).join('');

  return `<svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" class="viz-bar">${bars}</svg>`;
}
