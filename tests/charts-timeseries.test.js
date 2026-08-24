import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDonut } from '../web/charts/chart-donut.js';
import { renderLine } from '../web/charts/chart-line.js';
import { renderLine as renderLineForBaseline } from '../web/charts/chart-line.js';
import { renderStacked } from '../web/charts/chart-stacked.js';
import { renderTable as renderTableForBaseline } from '../web/charts/chart-table.js';

const row = (key, label, value, count = 1) => ({
  key, label, value, count, total: value,
  stats: { txnCount: count, median: value, largest: value, top3Share: 1 }
});

const CATEGORICAL = {
  rows: [row('fuel', 'Fuel', -200), row('groceries', 'Groceries', -140), row('alcohol', 'Alcohol', -60)],
  total: -400,
  stats: { txnCount: 4, median: -100, largest: -200, top3Share: 1 },
  meta: { sliceBy: 'category', measure: 'sum', rowCount: 3, filteredCount: 4, truncated: false }
};

const MONTHLY = {
  rows: [row('2026-06', 'Jun 2026', -300), row('2026-07', 'Jul 2026', -450), row('2026-08', 'Aug 2026', -400)],
  total: -1150,
  stats: { txnCount: 9, median: -100, largest: -300, top3Share: 0.6 },
  meta: { sliceBy: 'month', measure: 'sum', rowCount: 3, filteredCount: 9, truncated: false }
};

const opts = { mode: 'light', colourFor: () => '#2a78d6', title: 'T' };

test('donut draws one arc path per row', () => {
  const svg = renderDonut(CATEGORICAL, opts);
  assert.match(svg, /<div class="viz-donut">\s*<svg/);
  assert.equal((svg.match(/<path/g) ?? []).length, 3);
});

test('donut has a hole — it is a donut, not a pie', () => {
  assert.match(renderDonut(CATEGORICAL, opts), /viz-donut-hole/);
});

test('donut carries a legend for multiple series', () => {
  assert.match(renderDonut(CATEGORICAL, opts), /viz-legend/);
});

test('single-row donut emits no legend — the title names it', () => {
  const single = { ...CATEGORICAL, rows: [CATEGORICAL.rows[0]] };
  assert.doesNotMatch(renderDonut(single, opts), /viz-legend/);
});

test('donut shows the total in the centre', () => {
  assert.match(renderDonut(CATEGORICAL, opts), /-\$400\.00/);
});

test('donut refuses more than seven slices, folding the rest into Other', () => {
  const many = { ...CATEGORICAL, rows: Array.from({ length: 12 }, (_, i) => row(`k${i}`, `L${i}`, -(20 - i))) };
  const svg = renderDonut(many, opts);
  assert.ok((svg.match(/<path/g) ?? []).length <= 7);
  assert.match(svg, /Other/);
});

test('donut escapes labels', () => {
  const nasty = { ...CATEGORICAL, rows: [row('x', '<i>x</i>', -10)] };
  assert.doesNotMatch(renderDonut(nasty, opts), /<i>x<\/i>/);
});

test('line draws a single polyline for a time slice', () => {
  const svg = renderLine(MONTHLY, opts);
  assert.match(svg, /<polyline/);
  assert.equal((svg.match(/<polyline/g) ?? []).length, 1);
});

test('line uses 2px strokes and >=8px markers', () => {
  const svg = renderLine(MONTHLY, opts);
  assert.match(svg, /stroke-width="2"/);
  assert.match(svg, /r="4"/); // radius 4 => 8px diameter
});

test('line labels the first and last points only, never every point', () => {
  const svg = renderLine(MONTHLY, opts);
  assert.match(svg, /-\$300\.00/);
  assert.match(svg, /-\$400\.00/);
  assert.doesNotMatch(svg, /-\$450\.00/);
});

test('line refuses a non-chronological slice with an explanation', () => {
  const svg = renderLine(CATEGORICAL, opts);
  assert.match(svg, /time/i);
  assert.doesNotMatch(svg, /<polyline/);
});

test('single-point line emits exactly one value label, not two duplicates', () => {
  const single = { ...MONTHLY, rows: [MONTHLY.rows[0]] };
  const svg = renderLine(single, opts);
  const valueLabels = (svg.match(/class="viz-value"/g) ?? []).length;
  assert.equal(valueLabels, 1);
});

test('single-series line has no legend box — the title names it', () => {
  assert.doesNotMatch(renderLine(MONTHLY, opts), /viz-legend/);
});

test('line widens rather than cramming points when there are many time buckets', () => {
  const manyMonths = {
    rows: Array.from({ length: 24 }, (_, i) => row(`k${i}`, `M${i}`, -100)),
    total: -2400,
    stats: { txnCount: 24, median: -100, largest: -100, top3Share: 1 },
    meta: { sliceBy: 'month', measure: 'sum', rowCount: 24, filteredCount: 24, truncated: false }
  };
  const svg = renderLine(manyMonths, opts);
  const widthMatch = svg.match(/<svg[^>]*\swidth="(\d+)"/);
  assert.ok(widthMatch, 'svg should have an explicit numeric width, not 100%, so it can overflow into a scrollbar instead of squeezing');
  assert.ok(Number(widthMatch[1]) > 600, `expected width > 600 for 24 points, got ${widthMatch[1]}`);
});

test('line stays at the base width for few points', () => {
  const svg = renderLine(MONTHLY, opts);
  const widthMatch = svg.match(/<svg[^>]*\swidth="(\d+)"/);
  assert.equal(Number(widthMatch[1]), 600);
});

test('stacked bar draws one column of segments per time bucket', () => {
  const svg = renderStacked(MONTHLY, { ...opts, series: [
    { key: 'food-drink', label: 'Food & Drink', values: [-100, -150, -120] },
    { key: 'transport', label: 'Transport', values: [-200, -300, -280] }
  ] });
  assert.equal((svg.match(/<rect/g) ?? []).length, 6); // 2 series x 3 months
  assert.match(svg, /viz-legend/);
});

test('stacked bar omits a segment when its value is zero for that bucket', () => {
  const svg = renderStacked(MONTHLY, { ...opts, series: [
    { key: 'food-drink', label: 'Food & Drink', values: [0, -150, -120] },
    { key: 'transport', label: 'Transport', values: [-200, -300, -280] }
  ] });
  assert.equal((svg.match(/<rect/g) ?? []).length, 5);
});

test('single-series stacked emits no legend — the title names it', () => {
  const svg = renderStacked(MONTHLY, { ...opts, series: [
    { key: 'all', label: 'All Spend', values: [-300, -450, -400] }
  ] });
  assert.doesNotMatch(svg, /viz-legend/);
});

test('stacked bar direct-labels each time bucket and its total', () => {
  const svg = renderStacked(MONTHLY, { ...opts, series: [
    { key: 'a', label: 'A', values: [-300, -450, -400] }
  ] });
  assert.match(svg, /Jun 2026/);
  assert.match(svg, /Jul 2026/);
  assert.match(svg, /Aug 2026/);
  assert.match(svg, /-\$300\.00/);
  assert.match(svg, /-\$450\.00/);
  assert.match(svg, /-\$400\.00/);
});

test('stacked bar widens rather than shrinking columns when there are many time buckets', () => {
  const manyMonths = {
    rows: Array.from({ length: 24 }, (_, i) => row(`k${i}`, `M${i}`, -100)),
    total: -2400,
    stats: { txnCount: 24, median: -100, largest: -100, top3Share: 1 },
    meta: { sliceBy: 'month', measure: 'sum', rowCount: 24, filteredCount: 24, truncated: false }
  };
  const svg = renderStacked(manyMonths, { ...opts, series: [{ key: 'a', label: 'A', values: manyMonths.rows.map(() => -100) }] });
  const widthMatch = svg.match(/<svg[^>]*\swidth="(\d+)"/);
  assert.ok(widthMatch, 'svg should have an explicit numeric width, not 100%, so it can overflow into a scrollbar instead of squeezing');
  assert.ok(Number(widthMatch[1]) > 600, `expected width > 600 for 24 columns, got ${widthMatch[1]}`);
});

test('stacked bar omits per-column total labels once there are too many to fit without overlapping', () => {
  const manyMonths = {
    rows: Array.from({ length: 24 }, (_, i) => row(`k${i}`, `M${i}`, -100)),
    total: -2400,
    stats: { txnCount: 24, median: -100, largest: -100, top3Share: 1 },
    meta: { sliceBy: 'month', measure: 'sum', rowCount: 24, filteredCount: 24, truncated: false }
  };
  const svg = renderStacked(manyMonths, { ...opts, series: [{ key: 'a', label: 'A', values: manyMonths.rows.map(() => -100) }] });
  assert.equal((svg.match(/class="viz-value"/g) ?? []).length, 0);
  // The month labels themselves are unaffected — only the total figure above each bar is dropped.
  assert.equal((svg.match(/class="viz-label"/g) ?? []).length, 24);
});

test('stacked bar still labels every column total when there are few of them', () => {
  const svg = renderStacked(MONTHLY, { ...opts, series: [{ key: 'a', label: 'A', values: [-300, -450, -400] }] });
  assert.equal((svg.match(/class="viz-value"/g) ?? []).length, 3);
});

test('stacked bar hover tooltip shows the group name and amount for each segment', () => {
  const svg = renderStacked(MONTHLY, { ...opts, series: [
    { key: 'food-drink', label: 'Food & Drink', values: [-100, -150, -120] }
  ] });
  assert.match(svg, /<title>Food &amp; Drink: -\$100\.00<\/title>/);
});

test('stacked bar refuses a non-chronological slice', () => {
  assert.match(renderStacked(CATEGORICAL, { ...opts, series: [] }), /time/i);
});

test('every renderer handles an empty result without throwing', () => {
  const empty = { rows: [], total: 0, stats: { txnCount: 0, median: 0, largest: 0, top3Share: 0 }, meta: { sliceBy: 'month' } };
  for (const fn of [renderDonut, renderLine]) assert.match(fn(empty, opts), /No data/);
  assert.match(renderStacked(empty, { ...opts, series: [] }), /No data/);
});

test('no timeseries output references an external host', () => {
  const markup = renderDonut(CATEGORICAL, opts) + renderLine(MONTHLY, opts);
  assert.doesNotMatch(markup, /https?:\/\/(?!127\.0\.0\.1|localhost)/);
});

test('donut marks each slice with its key for drill-down, except the Other bucket', () => {
  const svg = renderDonut(CATEGORICAL, opts);
  assert.match(svg, /data-slice-key="fuel"/);
  const many = { ...CATEGORICAL, rows: Array.from({ length: 12 }, (_, i) => row(`k${i}`, `L${i}`, -(20 - i))) };
  const manySvg = renderDonut(many, opts);
  assert.doesNotMatch(manySvg, /data-slice-key="__other__"/);
});

test('line marks every point with its slice key for drill-down', () => {
  const svg = renderLine(MONTHLY, opts);
  assert.match(svg, /data-slice-key="2026-06"/);
  assert.match(svg, /data-slice-key="2026-07"/);
  assert.match(svg, /data-slice-key="2026-08"/);
});

const monthResult = (rows) => ({ rows, total: 0, stats: {}, meta: { sliceBy: 'month', measure: 'sum' } });

test('the line chart draws a dashed baseline series when rows carry a baseline', () => {
  const svg = renderLineForBaseline(monthResult([
    { key: '2026-07', label: 'Jul 2026', value: -200, count: 1, baseline: -150, delta: 50, deltaPct: 0.33 },
    { key: '2026-08', label: 'Aug 2026', value: -340, count: 2, baseline: -175, delta: 165, deltaPct: 0.94 }
  ]));
  assert.match(svg, /class="viz-ghost-line"/);
  assert.match(svg, /stroke-dasharray/);
});

test('the line chart draws no baseline series without baselines', () => {
  const svg = renderLineForBaseline(monthResult([
    { key: '2026-08', label: 'Aug 2026', value: -340, count: 2, baseline: null, delta: null, deltaPct: null }
  ]));
  assert.equal(svg.includes('viz-ghost-line'), false);
});

test('the line chart y-domain covers a baseline higher than every point', () => {
  const svg = renderLineForBaseline(monthResult([
    { key: '2026-08', label: 'Aug 2026', value: -50, count: 1, baseline: -900, delta: -850, deltaPct: -0.94 }
  ]));
  const ys = [...svg.matchAll(/cy="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(ys.every((y) => y >= 0), `a marker was plotted above the viewBox: ${ys}`);
});

test('the table adds a delta column only when a baseline exists', () => {
  const withBaseline = renderTableForBaseline(monthResult([
    { key: '2026-08', label: 'Aug 2026', value: -340, count: 2, stats: { txnCount: 2, median: -170, largest: -300, top3Share: 1 }, baseline: -175, delta: 165, deltaPct: 0.94 }
  ]));
  assert.match(withBaseline, /<th scope="col" class="num">Δ<\/th>/);
  assert.match(withBaseline, /▲ 94%/);

  const without = renderTableForBaseline(monthResult([
    { key: '2026-08', label: 'Aug 2026', value: -340, count: 2, stats: { txnCount: 2, median: -170, largest: -300, top3Share: 1 }, baseline: null, delta: null, deltaPct: null }
  ]));
  assert.equal(without.includes('>Δ<'), false);
});

// Fix-pass test (finding 2): the last-point delta label must stay inside
// the declared viewBox even when that point sits at the domain maximum.
test('finding 2: the last-point delta label stays inside the viewBox when the last point is the domain max', () => {
  // A single row whose own magnitude sets the y-domain (baseline is smaller)
  // puts the point at the very top of the plot — PAD.top, y=16 — which is
  // exactly where an unclamped "y - 26" label goes negative.
  const svg = renderLineForBaseline(monthResult([
    { key: '2026-08', label: 'Aug 2026', value: -500, count: 3, baseline: -100, delta: 400, deltaPct: 4 }
  ]));

  const deltaMatch = svg.match(/x="([\d.]+)" y="(-?[\d.]+)" text-anchor="end" class="viz-delta[^"]*"/);
  assert.ok(deltaMatch, 'expected a delta label');
  const deltaY = Number(deltaMatch[2]);
  assert.ok(deltaY >= 0, `delta label y=${deltaY} is outside the viewBox (< 0)`);

  // It must also not land on top of the existing end-of-series value label,
  // which is drawn at the same x, y = point.y - 10. (A single-point chart
  // labels its lone point as the series start, so the anchor is "start".)
  const valueMatch = svg.match(/x="([\d.]+)" y="([\d.]+)" text-anchor="(?:start|end)" class="viz-value"/);
  assert.ok(valueMatch, 'expected an end-of-series value label');
  const valueY = Number(valueMatch[2]);
  assert.ok(Math.abs(deltaY - valueY) >= 8,
    `delta label (y=${deltaY}) is too close to the value label (y=${valueY})`);
});
