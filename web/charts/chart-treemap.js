import { sequentialColour } from './palette.js';
import { formatMeasure, escapeHtml } from './scale.js';

const WIDTH = 600;
const HEIGHT = 320;

/**
 * Direct labels are hard-coded white in CSS, which fails on a tile light
 * enough to need dark ink instead — the lightest categorical steps (e.g. the
 * "lifestyle" group's paler within-group tints) measure under 4:1 for white
 * text. WCAG relative luminance decides per tile, independent of app theme:
 * a light fill needs dark ink regardless of whether the page itself is dark.
 */
function relativeLuminance(hex) {
  const channel = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White text if it clears 4.5:1 on this fill, otherwise near-black ink. */
function inkFor(hex) {
  const contrastWithWhite = 1.05 / (relativeLuminance(hex) + 0.05);
  return contrastWithWhite >= 4.5 ? '#ffffff' : '#0b0b0b';
}

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
 * categorical hues fail the all-pairs CVD gate (see palette.js). For a
 * category or group slice — where colour genuinely identifies something —
 * this chart accepts that trade-off and uses the same categorical hue bar
 * and donut use for the same slice, so the treemap visually agrees with the
 * rest of the app. Any other slice (merchant, weekday, amount band, …) has
 * no taxonomy identity to colour by, so it keeps the sequential ramp keyed
 * to magnitude — colour and area then encode the same thing, which is
 * correct, not redundant.
 */
export function renderTreemap(result, { mode = 'light', title = '', colourFor } = {}) {
  const rows = [...(result.rows ?? [])].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  if (!rows.length) return `<p class="viz-empty">No data for these filters</p>`;

  const magnitudes = rows.map((r) => Math.abs(r.value));
  const max = Math.max(...magnitudes, 1);
  const tiles = squarify(magnitudes, WIDTH, HEIGHT);
  const measure = result.meta?.measure;
  const sliceBy = result.meta?.sliceBy;
  const useCategorical = Boolean(colourFor) && (sliceBy === 'category' || sliceBy === 'group');

  const cells = rows.map((row, i) => {
    const tile = tiles[i];
    const colour = useCategorical ? colourFor(row) : sequentialColour(Math.abs(row.value) / max, mode);
    const showLabel = tile.w > 70 && tile.h > 34;
    const ink = inkFor(colour);
    const label = showLabel
      ? `<text x="${(tile.x + 8).toFixed(1)}" y="${(tile.y + 20).toFixed(1)}" class="viz-tile-label" style="fill:${ink}">${escapeHtml(row.label)}</text>
         <text x="${(tile.x + 8).toFixed(1)}" y="${(tile.y + 36).toFixed(1)}" class="viz-tile-value" style="fill:${ink}">${formatMeasure(row.value, measure)}</text>`
      : '';
    return `<g>
      <rect x="${tile.x.toFixed(1)}" y="${tile.y.toFixed(1)}" width="${tile.w.toFixed(1)}" height="${tile.h.toFixed(1)}"
            fill="${colour}" stroke="var(--viz-surface)" stroke-width="2" rx="4" class="viz-clickable" data-slice-key="${escapeHtml(row.key)}"><title>${escapeHtml(row.label)}: ${formatMeasure(row.value, measure)} · ${row.count} txns</title></rect>
      ${label}
    </g>`;
  }).join('');

  return `<svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" class="viz-treemap">${cells}</svg>`;
}
