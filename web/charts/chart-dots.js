import { linearScale, formatMoney, escapeHtml } from './scale.js';
import { GROUP_SLOTS } from './palette.js';

const WIDTH = 600;
const HEIGHT = 160;
const PAD = { left: 24, right: 24, bottom: 34 };
const DOT_R = 4;   // 8px across

/**
 * Dot plot — one dot per transaction along an amount axis.
 *
 * This is the honest picture of "a few large spends or a lot of small ones":
 * a cluster near the left with one dot far right is a different story from an
 * even spread, and no summary statistic shows it as directly.
 *
 * Each dot is coloured by its OWN transaction's category, not by whatever
 * slice the panel happens to be showing — a $30 coffee and a $30 fuel top-up
 * land at the same x position but are different spends. That makes this an
 * ALL-PAIRS colour form (same trade-off as the treemap — see palette.js),
 * deliberately accepted here because colour is the only way to tell two
 * same-sized dots apart.
 */
export function renderDots(result, { mode = 'light', title = '', points = [], colourFor } = {}) {
  if (!points.length) return `<p class="viz-empty">No data for these filters</p>`;

  const fallback = GROUP_SLOTS['food-drink'][mode] ?? GROUP_SLOTS['food-drink'].light;
  const magnitudes = points.map((p) => Math.abs(p.amount));
  const max = Math.max(...magnitudes, 1);
  const plotW = WIDTH - PAD.left - PAD.right;
  const scale = linearScale(max, plotW);
  const baseline = HEIGHT - PAD.bottom;

  // Nudge overlapping dots upward so density is visible rather than hidden.
  const occupancy = new Map();
  const dots = points.map((point, i) => {
    const magnitude = magnitudes[i];
    const x = PAD.left + scale(magnitude);
    const bucket = Math.round(x / (DOT_R * 2));
    const stack = occupancy.get(bucket) ?? 0;
    occupancy.set(bucket, stack + 1);
    const y = baseline - stack * (DOT_R * 2 + 1);
    const colour = colourFor ? colourFor(point) : fallback;
    // Every dot carries its own hover tooltip — identifying an individual
    // point is the whole reason this chart exists. Only the VISIBLE label
    // below is selective.
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${DOT_R}" fill="${colour}" stroke="var(--viz-surface)" stroke-width="2" opacity="0.85"><title>${escapeHtml(point.label)}: ${formatMoney(point.amount)}</title></circle>`;
  }).join('');

  // Selective direct label: the single largest value only.
  const maxIndex = magnitudes.includes(max) ? magnitudes.indexOf(max) : 0;
  const maxX = PAD.left + scale(max);
  const outlier = `<text x="${maxX.toFixed(1)}" y="${(baseline - 26).toFixed(1)}" text-anchor="end" class="viz-value">${formatMoney(points[maxIndex].amount)}</text>`;

  const axis = `<line x1="${PAD.left}" y1="${baseline + 10}" x2="${WIDTH - PAD.right}" y2="${baseline + 10}" class="viz-grid"/>
    <text x="${PAD.left}" y="${HEIGHT - 6}" class="viz-label">$0</text>
    <text x="${WIDTH - PAD.right}" y="${HEIGHT - 6}" text-anchor="end" class="viz-label">${formatMoney(-max)}</text>`;

  return `<svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" class="viz-dots">${axis}${dots}${outlier}</svg>`;
}
