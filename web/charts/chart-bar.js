import { linearScale, formatMoney, escapeHtml } from './scale.js';

const ROW_HEIGHT = 34;
const BAR_HEIGHT = 16;      // thin marks
const LABEL_WIDTH = 150;
const VALUE_WIDTH = 96;
const GAP = 2;              // 2px surface gap between adjacent fills

/**
 * Horizontal bar chart. Every bar is direct-labelled with its name and value —
 * that is the relief the palette's light-mode contrast WARN requires.
 */
export function renderBar(result, { mode = 'light', colourFor, title = '' } = {}) {
  const rows = result.rows ?? [];
  if (!rows.length) {
    return `<svg role="img" aria-label="${escapeHtml(title)}: no data" viewBox="0 0 600 60" width="100%"><text x="300" y="34" text-anchor="middle" class="viz-empty">No data for these filters</text></svg>`;
  }

  const width = 600;
  const plotWidth = width - LABEL_WIDTH - VALUE_WIDTH;
  const height = rows.length * ROW_HEIGHT;
  const maxValue = Math.max(...rows.map((r) => Math.abs(r.value)));
  const scale = linearScale(maxValue, plotWidth);

  const bars = rows.map((row, i) => {
    const y = i * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;
    const barWidth = Math.max(scale(row.value) - GAP, 0);
    const colour = colourFor ? colourFor(row) : 'currentColor';
    return `
    <g>
      <text x="0" y="${y + BAR_HEIGHT - 3}" class="viz-label">${escapeHtml(row.label)}</text>
      <rect x="${LABEL_WIDTH}" y="${y}" width="${barWidth.toFixed(1)}" height="${BAR_HEIGHT}"
            rx="4" fill="${colour}"><title>${escapeHtml(row.label)}: ${formatMoney(row.value)} · ${row.count} txns</title></rect>
      <text x="${width}" y="${y + BAR_HEIGHT - 3}" text-anchor="end" class="viz-value">${formatMoney(row.value)}</text>
    </g>`;
  }).join('');

  return `<svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" class="viz-bar">${bars}</svg>`;
}
