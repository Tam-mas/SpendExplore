import { sequentialColour } from './palette.js';
import { formatMeasure, escapeHtml } from './scale.js';

const WIDTH = 600;
const HEIGHT = 320;

/**
 * Slice-and-dice treemap laid out along the shorter side each pass, which keeps
 * tiles reasonably square without the full squarified algorithm's complexity.
 * Values must be positive magnitudes, largest first.
 */
export function squarify(values, width, height) {
  if (!values.length) return [];
  if (values.length === 1) return [{ x: 0, y: 0, w: width, h: height }];

  const total = values.reduce((a, v) => a + v, 0);
  if (total === 0) return values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));

  const tiles = [];
  let x = 0, y = 0, w = width, h = height;
  let remaining = total;

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const isLast = i === values.length - 1;

    if (isLast) { tiles.push({ x, y, w, h }); break; }

    const fraction = value / remaining;
    if (w >= h) {
      const tileW = w * fraction;
      tiles.push({ x, y, w: tileW, h });
      x += tileW; w -= tileW;
    } else {
      const tileH = h * fraction;
      tiles.push({ x, y, w, h: tileH });
      y += tileH; h -= tileH;
    }
    remaining -= value;
  }
  return tiles;
}

/**
 * Treemap — part-to-whole where area IS the magnitude.
 *
 * Tiles are adjacent arbitrarily, making this an ALL-PAIRS form: the 7
 * categorical hues fail the all-pairs CVD gate, so this chart deliberately
 * uses the sequential ramp keyed to each tile's share instead. Area and
 * colour then encode the same thing, which is correct, not redundant.
 */
export function renderTreemap(result, { mode = 'light', title = '' } = {}) {
  const rows = [...(result.rows ?? [])].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  if (!rows.length) return `<p class="viz-empty">No data for these filters</p>`;

  const magnitudes = rows.map((r) => Math.abs(r.value));
  const max = Math.max(...magnitudes, 1);
  const tiles = squarify(magnitudes, WIDTH, HEIGHT);
  const measure = result.meta?.measure;

  const cells = rows.map((row, i) => {
    const tile = tiles[i];
    const colour = sequentialColour(Math.abs(row.value) / max, mode);
    const showLabel = tile.w > 70 && tile.h > 34;
    const label = showLabel
      ? `<text x="${(tile.x + 8).toFixed(1)}" y="${(tile.y + 20).toFixed(1)}" class="viz-tile-label">${escapeHtml(row.label)}</text>
         <text x="${(tile.x + 8).toFixed(1)}" y="${(tile.y + 36).toFixed(1)}" class="viz-tile-value">${formatMeasure(row.value, measure)}</text>`
      : '';
    return `<g>
      <rect x="${tile.x.toFixed(1)}" y="${tile.y.toFixed(1)}" width="${tile.w.toFixed(1)}" height="${tile.h.toFixed(1)}"
            fill="${colour}" stroke="var(--viz-surface)" stroke-width="2" rx="4"><title>${escapeHtml(row.label)}: ${formatMeasure(row.value, measure)} · ${row.count} txns</title></rect>
      ${label}
    </g>`;
  }).join('');

  return `<svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" class="viz-treemap">${cells}</svg>`;
}
