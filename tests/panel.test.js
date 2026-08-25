import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPanel, colourResolver } from '../web/panel.js';

const SNAPSHOT = {
  categories: {
    groups: [
      { id: 'food-drink', label: 'Food & Drink' },
      { id: 'transport', label: 'Transport' }
    ],
    categories: [
      { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
      { id: 'alcohol', label: 'Alcohol', groupId: 'food-drink' },
      { id: 'fuel', label: 'Fuel', groupId: 'transport' }
    ]
  },
  accounts: [{ id: 'spending', label: 'Joint', cardOwners: {} }],
  transactions: [
    { id: 'a', date: '2026-07-05', amount: -100, merchant: 'Coles', accountId: 'spending', cardSuffix: null, categoryId: 'groceries', excluded: false },
    { id: 'b', date: '2026-08-05', amount: -40, merchant: 'Coles', accountId: 'spending', cardSuffix: null, categoryId: 'groceries', excluded: false },
    { id: 'c', date: '2026-08-07', amount: -200, merchant: 'BP', accountId: 'spending', cardSuffix: null, categoryId: 'fuel', excluded: false }
  ]
};

test('a panel is pure config', () => {
  const p = createPanel({ id: 'p1', title: 'Where it went', sliceBy: 'category', measure: 'sum' });
  assert.deepEqual(Object.keys(p.config).sort(), ['chartType', 'filters', 'id', 'measure', 'sliceBy', 'span', 'title']);
});

test('a panel with no chart type takes the slice default', () => {
  assert.equal(createPanel({ id: 'p', sliceBy: 'month' }).config.chartType, 'line');
  assert.equal(createPanel({ id: 'p', sliceBy: 'category' }).config.chartType, 'bar');
});

test('html renders controls and the chart', () => {
  const p = createPanel({ id: 'p', title: 'Where it went', sliceBy: 'category', measure: 'sum' });
  const html = p.html(SNAPSHOT, {});
  assert.match(html, /Where it went/);
  assert.match(html, /data-panel-control="sliceBy"/);
  assert.match(html, /data-panel-control="measure"/);
  assert.match(html, /data-panel-control="chartType"/);
  assert.match(html, /<svg/);
});

test('the chart switcher offers only valid types for the slice', () => {
  const html = createPanel({ id: 'p', sliceBy: 'category' }).html(SNAPSHOT, {});
  assert.match(html, /value="donut"/);
  assert.doesNotMatch(html, /value="line"/);
  const timeHtml = createPanel({ id: 'p', sliceBy: 'month' }).html(SNAPSHOT, {});
  assert.match(timeHtml, /value="line"/);
  assert.doesNotMatch(timeHtml, /value="donut"/);
});

test('changing the slice repairs an now-invalid chart type', () => {
  const p = createPanel({ id: 'p', sliceBy: 'month', chartType: 'line' });
  p.setSlice('category');
  assert.notEqual(p.config.chartType, 'line');
  assert.equal(p.config.chartType, 'bar');
});

test('changing the slice keeps a still-valid chart type', () => {
  const p = createPanel({ id: 'p', sliceBy: 'category', chartType: 'table' });
  p.setSlice('merchant');
  assert.equal(p.config.chartType, 'table');
});

test('changing the measure repairs an now-invalid chart type', () => {
  const p = createPanel({ id: 'p', sliceBy: 'category', chartType: 'donut' });
  p.setMeasure('avg');
  assert.notEqual(p.config.chartType, 'donut');
});

test('global filters merge with the panel own filters', () => {
  const p = createPanel({ id: 'p', sliceBy: 'category', filters: { groupIds: ['food-drink'] } });
  const html = p.html(SNAPSHOT, { dateFrom: '2026-08-01' });
  assert.match(html, /Groceries/);
  assert.doesNotMatch(html, /Fuel/); // excluded by the panel own group filter
});

test('the panel shows the concentration line for the whole result', () => {
  const html = createPanel({ id: 'p', sliceBy: 'category' }).html(SNAPSHOT, {});
  assert.match(html, /median/);
  assert.match(html, /top 3/);
});

test('the panel escapes its own title', () => {
  const html = createPanel({ id: 'p', title: '<script>x</script>', sliceBy: 'category' }).html(SNAPSHOT, {});
  assert.doesNotMatch(html, /<script>x<\/script>/);
});

test('an empty result renders a message, not a crash', () => {
  const p = createPanel({ id: 'p', sliceBy: 'category', filters: { dateFrom: '2030-01-01' } });
  assert.match(p.html(SNAPSHOT, {}), /No data/);
});

test('colourResolver keys category colour to the group, not to rank', () => {
  const resolve = colourResolver(SNAPSHOT, 'category');
  const groceries = resolve({ key: 'groceries' });
  const fuel = resolve({ key: 'fuel' });
  assert.notEqual(groceries, fuel);
  // Same answer regardless of the order rows arrive in.
  assert.equal(resolve({ key: 'groceries' }), groceries);
});

test('colourResolver keys group colour by group id', () => {
  const resolve = colourResolver(SNAPSHOT, 'group');
  assert.equal(resolve({ key: 'transport' }), '#eb6834');
});

test('a stacked panel supplies series broken down by group, aligned with the time buckets', () => {
  const p = createPanel({ id: 'p', sliceBy: 'month', chartType: 'stacked' });
  const html = p.html(SNAPSHOT, {});
  assert.match(html, /<title>Transport: -\$200\.00<\/title>/);
  assert.match(html, /<title>Food &amp; Drink: -\$100\.00<\/title>/);
  assert.match(html, /<title>Food &amp; Drink: -\$40\.00<\/title>/);
});

test('a stacked panel colours by group regardless of the panel own slice', () => {
  const p = createPanel({ id: 'p', sliceBy: 'month', chartType: 'stacked' });
  const html = p.html(SNAPSHOT, {});
  assert.match(html, /#eb6834/i);
});

test('colourResolver gives non-taxonomy slices a single stable hue', () => {
  const resolve = colourResolver(SNAPSHOT, 'merchant');
  assert.equal(resolve({ key: 'Coles' }), resolve({ key: 'BP' }));
});

test('the panel output references no external host', () => {
  const html = createPanel({ id: 'p', sliceBy: 'category' }).html(SNAPSHOT, {});
  assert.doesNotMatch(html, /https?:\/\/(?!127\.0\.0\.1|localhost)/);
});
