import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHART_TYPES, chartsFor, renderChart, defaultChartFor } from '../web/charts/index.js';

const ids = (sliceBy, measure = 'sum') => chartsFor(sliceBy, measure).map((c) => c.id).sort();

test('the registry exposes all seven chart types', () => {
  assert.deepEqual(CHART_TYPES.map((c) => c.id).sort(),
    ['bar', 'donut', 'dots', 'line', 'stacked', 'table', 'treemap']);
});

test('table is valid for every slice and measure', () => {
  for (const slice of ['category', 'month', 'merchant', 'weekday', 'amountBand']) {
    for (const measure of ['sum', 'count', 'avg', 'median', 'pctOfTotal']) {
      assert.ok(chartsFor(slice, measure).some((c) => c.id === 'table'), `${slice}/${measure}`);
    }
  }
});

test('line and stacked are offered only for time slices', () => {
  assert.ok(ids('month').includes('line'));
  assert.ok(ids('week').includes('stacked'));
  assert.ok(!ids('category').includes('line'));
  assert.ok(!ids('merchant').includes('stacked'));
  assert.ok(!ids('weekday').includes('line'), 'weekday is ordered but not a time axis');
});

test('donut is not offered for a time slice — a whole is not made of months', () => {
  assert.ok(!ids('month').includes('donut'));
  assert.ok(ids('category').includes('donut'));
});

test('donut and treemap are not offered for non-additive measures', () => {
  for (const measure of ['avg', 'median']) {
    assert.ok(!ids('category', measure).includes('donut'), measure);
    assert.ok(!ids('category', measure).includes('treemap'), measure);
  }
  assert.ok(ids('category', 'sum').includes('donut'));
});

test('dots is offered only for the sum measure — it plots transactions', () => {
  assert.ok(ids('category', 'sum').includes('dots'));
  assert.ok(!ids('category', 'count').includes('dots'));
});

test('bar is offered for everything except a pure time slice default', () => {
  assert.ok(ids('category').includes('bar'));
  assert.ok(ids('merchant').includes('bar'));
});

test('defaults are sensible per slice', () => {
  assert.equal(defaultChartFor('month'), 'line');
  assert.equal(defaultChartFor('week'), 'line');
  assert.equal(defaultChartFor('category'), 'bar');
  assert.equal(defaultChartFor('merchant'), 'bar');
  assert.equal(defaultChartFor('amountBand'), 'bar');
});

test('the default chart for a slice is always in that slice valid list', () => {
  for (const slice of ['category', 'group', 'merchant', 'person', 'account', 'weekday', 'week', 'month', 'amountBand']) {
    assert.ok(ids(slice).includes(defaultChartFor(slice)), slice);
  }
});

test('renderChart dispatches to the right renderer', () => {
  const result = {
    rows: [{ key: 'a', label: 'A', value: -10, count: 1, total: -10, stats: { txnCount: 1, median: -10, largest: -10, top3Share: 1 } }],
    total: -10, stats: { txnCount: 1, median: -10, largest: -10, top3Share: 1 },
    meta: { sliceBy: 'category', measure: 'sum', rowCount: 1, filteredCount: 1, truncated: false }
  };
  assert.match(renderChart('table', result, {}), /<table/);
  assert.match(renderChart('bar', result, { colourFor: () => '#2a78d6' }), /<svg/);
});

test('renderChart throws on an unknown chart id', () => {
  assert.throws(() => renderChart('pie3d', { rows: [] }, {}), /Unknown chart type: pie3d/);
});
