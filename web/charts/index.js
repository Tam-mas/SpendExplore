import { renderBar } from './chart-bar.js';
import { renderTable } from './chart-table.js';
import { renderDonut } from './chart-donut.js';
import { renderLine } from './chart-line.js';
import { renderStacked } from './chart-stacked.js';
import { renderTreemap } from './chart-treemap.js';
import { renderDots } from './chart-dots.js';

const TIME_SLICES = new Set(['week', 'month']);
/** Measures whose parts genuinely sum to the whole. */
const ADDITIVE = new Set(['sum', 'count', 'pctOfTotal']);

/**
 * The chart switcher offers only types that make sense for the current slice
 * and measure. Unrestricted chart choice sounds freeing but mostly produces
 * charts that mislead — a line through unordered categories, or a donut whose
 * slices are averages and therefore do not make a whole.
 *
 * `table` is valid everywhere and must never be removed: it is the required
 * relief for the palette's light-mode contrast WARN.
 */
export const CHART_TYPES = Object.freeze([
  { id: 'bar', label: 'Bar', render: renderBar, validFor: () => true },
  { id: 'table', label: 'Table', render: renderTable, validFor: () => true },
  {
    id: 'donut', label: 'Donut', render: renderDonut,
    validFor: (slice, measure) => !TIME_SLICES.has(slice) && ADDITIVE.has(measure)
  },
  {
    id: 'treemap', label: 'Treemap', render: renderTreemap,
    validFor: (slice, measure) => !TIME_SLICES.has(slice) && ADDITIVE.has(measure)
  },
  { id: 'line', label: 'Line', render: renderLine, validFor: (slice) => TIME_SLICES.has(slice) },
  { id: 'stacked', label: 'Stacked', render: renderStacked, validFor: (slice) => TIME_SLICES.has(slice) },
  { id: 'dots', label: 'Dots', render: renderDots, validFor: (slice, measure) => measure === 'sum' }
]);

export const chartsFor = (sliceBy, measure = 'sum') =>
  CHART_TYPES.filter((c) => c.validFor(sliceBy, measure));

export function defaultChartFor(sliceBy) {
  return TIME_SLICES.has(sliceBy) ? 'line' : 'bar';
}

export function renderChart(chartId, result, options = {}) {
  const chart = CHART_TYPES.find((c) => c.id === chartId);
  if (!chart) throw new Error(`Unknown chart type: ${chartId}`);
  return chart.render(result, options);
}
