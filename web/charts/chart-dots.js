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
 * Single series, so a single hue — this is an all-pairs form and must not use
 * the categorical palette.
 */
export function renderDots(result, { mode = 'light', title = '', amounts = [] } = {}) {
  if (!amounts.length) return `<p class="viz-empty">No data for these filters</p>`;

  const colour = GROUP_SLOTS['food-drink'][mode] ?? GROUP_SLOTS['food-drink'].light;
  const magnitudes = amounts.map((a) => Math.abs(a));
  const max = Math.max(...magnitudes, 1);
  const plotW = WIDTH - PAD.left - PAD.right;
  const scale = linearScale(max, plotW);
  const baseline = HEIGHT - PAD.bottom;

  // Nudge overlapping dots upward so density is visible rather than hidden.
  const occupancy = new Map();
  const dots = magnitudes.map((magnitude, i) => {
    const x = PAD.left + scale(magnitude);
    const bucket = Math.round(x / (DOT_R * 2));
    const stack = occupancy.get(bucket) ?? 0;
    occupancy.set(bucket, stack + 1);
    const y = baseline - stack * (DOT_R * 2 + 1);
    const isMax = magnitude === max;
    const titleEl = isMax ? `<title>${formatMoney(amounts[i])}</title>` : '';
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${DOT_R}" fill="${colour}" stroke="var(--viz-surface)" stroke-width="2" opacity="0.85">${titleEl}</circle>`;
  }).join('');

  // Selective direct label: the single largest value only.
  const maxIndex = magnitudes.indexOf(max);
  const maxX = PAD.left + scale(max);
  const outlier = `<text x="${maxX.toFixed(1)}" y="${(baseline - 26).toFixed(1)}" text-anchor="end" class="viz-value">${formatMoney(amounts[maxIndex])}</text>`;

  const axis = `<line x1="${PAD.left}" y1="${baseline + 10}" x2="${WIDTH - PAD.right}" y2="${baseline + 10}" class="viz-grid"/>
    <text x="${PAD.left}" y="${HEIGHT - 6}" class="viz-label">$0</text>
    <text x="${WIDTH - PAD.right}" y="${HEIGHT - 6}" text-anchor="end" class="viz-label">${formatMoney(-max)}</text>`;

  return `<svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" class="viz-dots">${axis}${dots}${outlier}</svg>`;
}
