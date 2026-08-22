import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDonut } from '../web/charts/chart-donut.js';
import { renderLine } from '../web/charts/chart-line.js';
import { renderStacked } from '../web/charts/chart-stacked.js';

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
  assert.match(svg, /^<svg/);
  assert.equal((svg.match(/<path/g) ?? []).length, 3);
});

test('donut has a hole — it is a donut, not a pie', () => {
  assert.match(renderDonut(CATEGORICAL, opts), /viz-donut-hole/);
});

test('donut carries a legend for multiple series', () => {
  assert.match(renderDonut(CATEGORICAL, opts), /viz-legend/);
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

test('single-series line has no legend box — the title names it', () => {
  assert.doesNotMatch(renderLine(MONTHLY, opts), /viz-legend/);
});

test('stacked area draws one band per series', () => {
  const svg = renderStacked(MONTHLY, { ...opts, series: [
    { key: 'food-drink', label: 'Food & Drink', values: [-100, -150, -120] },
    { key: 'transport', label: 'Transport', values: [-200, -300, -280] }
  ] });
  assert.equal((svg.match(/<path/g) ?? []).length, 2);
  assert.match(svg, /viz-legend/);
});

test('stacked area leaves a 2px surface gap between bands', () => {
  const svg = renderStacked(MONTHLY, { ...opts, series: [
    { key: 'a', label: 'A', values: [-100, -150, -120] },
    { key: 'b', label: 'B', values: [-200, -300, -280] }
  ] });
  assert.match(svg, /stroke-width="2"/);
});

test('stacked area refuses a non-chronological slice', () => {
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
