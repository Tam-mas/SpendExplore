import { linearScale, formatMoney, escapeHtml } from './scale.js';

const WIDTH = 600;
const HEIGHT = 260;
const PAD = { top: 16, right: 16, bottom: 40, left: 16 };
const BAR_GAP = 8;
const SEGMENT_GAP = 2; // 2px surface gap between stacked segments
const TIME_SLICES = new Set(['week', 'month']);

/**
 * Stacked bar — one column per time bucket, each segmented by group, so the
 * category MIX within a month is as visible as the month's total.
 *
 * Discrete columns rather than a smooth area, because the question this
 * answers is "what made up July," not "what shape does the trend have" —
 * that's what Line is for.
 *
 * `series` is supplied by the caller (the panel), because a stack needs a
 * second dimension the single-slice query result does not carry: one entry
 * per series, each with one value per time bucket, in the same order as
 * `result.rows`.
 */
export function renderStacked(result, { title = '', colourFor, series = [] } = {}) {
  if (!TIME_SLICES.has(result.meta?.sliceBy)) {
    return `<p class="viz-empty">A stacked chart needs a time slice — choose Week or Month.</p>`;
  }
  const rows = result.rows ?? [];
  if (!rows.length || !series.length) return `<p class="viz-empty">No data for these filters</p>`;

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const barWidth = Math.max((plotW - BAR_GAP * (rows.length - 1)) / rows.length, 4);
  const baseline = PAD.top + plotH;

  const totals = rows.map((_, i) => series.reduce((a, s) => a + Math.abs(s.values[i] ?? 0), 0));
  const maxTotal = Math.max(...totals, 1);
  const yScale = linearScale(maxTotal, plotH);

  const columns = rows.map((row, i) => {
    const x = PAD.left + i * (barWidth + BAR_GAP);
    let cumulative = 0;
    const segments = series.map((s) => {
      const value = Math.abs(s.values[i] ?? 0);
      if (value === 0) return '';
      const y = baseline - yScale(cumulative + value);
      const h = Math.max(yScale(value) - SEGMENT_GAP, 0);
      cumulative += value;
      const colour = colourFor ? colourFor({ key: s.key, label: s.label }) : 'currentColor';
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" fill="${colour}" rx="2"><title>${escapeHtml(s.label)}: ${formatMoney(-value)}</title></rect>`;
    }).join('');

    const xLabel = `<text x="${(x + barWidth / 2).toFixed(1)}" y="${(baseline + 16).toFixed(1)}" text-anchor="middle" class="viz-label">${escapeHtml(row.label)}</text>`;
    const totalLabel = totals[i] > 0
      ? `<text x="${(x + barWidth / 2).toFixed(1)}" y="${(baseline - yScale(totals[i]) - 6).toFixed(1)}" text-anchor="middle" class="viz-value">${formatMoney(-totals[i])}</text>`
      : '';

    return `<g>${segments}${totalLabel}${xLabel}</g>`;
  }).join('');

  const legend = series.map((s) => {
    const colour = colourFor ? colourFor({ key: s.key, label: s.label }) : 'currentColor';
    return `<li><span class="viz-swatch" style="background:${colour}"></span>${escapeHtml(s.label)}</li>`;
  }).join('');
  const legendHtml = series.length > 1 ? `<ul class="viz-legend">${legend}</ul>` : '';

  return `
  <div class="viz-stacked">
    <svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%">${columns}</svg>
    ${legendHtml}
  </div>`;
}
