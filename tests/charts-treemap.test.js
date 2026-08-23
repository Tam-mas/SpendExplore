import { test } from 'node:test';
import assert from 'node:assert/strict';
import { squarify, renderTreemap } from '../web/charts/chart-treemap.js';
import { renderDots } from '../web/charts/chart-dots.js';

const row = (key, label, value, count = 1) => ({
  key, label, value, count, total: value,
  stats: { txnCount: count, median: value, largest: value, top3Share: 1 }
});

const RESULT = {
  rows: [row('a', 'Health', -336), row('b', 'Food', -316), row('c', 'Money', -250), row('d', 'Other', -214)],
  total: -1116,
  stats: { txnCount: 30, median: -20, largest: -336, top3Share: 0.7 },
  meta: { sliceBy: 'group', measure: 'sum', rowCount: 4, filteredCount: 30, truncated: false }
};

const opts = { mode: 'light', title: 'T' };

test('squarify fills the whole rectangle', () => {
  const tiles = squarify([40, 30, 20, 10], 200, 100);
  assert.equal(tiles.length, 4);
  const area = tiles.reduce((a, t) => a + t.w * t.h, 0);
  assert.ok(Math.abs(area - 200 * 100) < 1, `area ${area}`);
});

test('squarify tiles do not overlap', () => {
  const tiles = squarify([40, 30, 20, 10], 200, 100);
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i], b = tiles[j];
      const disjoint = a.x + a.w <= b.x + 0.01 || b.x + b.w <= a.x + 0.01 ||
                       a.y + a.h <= b.y + 0.01 || b.y + b.h <= a.y + 0.01;
      assert.ok(disjoint, `tiles ${i} and ${j} overlap`);
    }
  }
});

test('squarify gives the largest value the largest area', () => {
  const tiles = squarify([40, 30, 20, 10], 200, 100);
  const areas = tiles.map((t) => t.w * t.h);
  assert.equal(areas.indexOf(Math.max(...areas)), 0);
});

test('squarify handles a single value and an empty list', () => {
  assert.deepEqual(squarify([10], 100, 50), [{ x: 0, y: 0, w: 100, h: 50 }]);
  assert.deepEqual(squarify([], 100, 50), []);
});

test('treemap draws one rect per row', () => {
  const svg = renderTreemap(RESULT, opts);
  assert.equal((svg.match(/<rect/g) ?? []).length, 4);
});

test('treemap uses the sequential ramp when no colourFor is supplied', () => {
  const svg = renderTreemap(RESULT, opts);
  for (const hex of ['#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7']) {
    assert.doesNotMatch(svg, new RegExp(hex, 'i'), `categorical hue ${hex} must not appear without colourFor`);
  }
});

test('treemap uses the categorical hue when colourFor is supplied for a category/group slice', () => {
  const svg = renderTreemap(RESULT, { ...opts, colourFor: () => '#eb6834' });
  assert.match(svg, /fill="#eb6834"/);
});

test('treemap ignores colourFor for a slice with no taxonomy identity', () => {
  const merchantResult = { ...RESULT, meta: { ...RESULT.meta, sliceBy: 'merchant' } };
  const svg = renderTreemap(merchantResult, { ...opts, colourFor: () => '#eb6834' });
  assert.doesNotMatch(svg, /fill="#eb6834"/);
});

test('treemap tiles carry a slice key for drill-down clicks', () => {
  const svg = renderTreemap(RESULT, opts);
  assert.match(svg, /data-slice-key="a"/);
  assert.match(svg, /class="viz-clickable"/);
});

test('treemap direct-labels every tile', () => {
  const svg = renderTreemap(RESULT, opts);
  assert.match(svg, /Health/);
  assert.match(svg, /Food/);
});

test('treemap leaves a 2px gap between tiles', () => {
  assert.match(renderTreemap(RESULT, opts), /stroke-width="2"/);
});

test('treemap escapes labels', () => {
  const nasty = { ...RESULT, rows: [row('x', '<u>x</u>', -10)] };
  assert.doesNotMatch(renderTreemap(nasty, opts), /<u>x<\/u>/);
});

const dotPoints = (amounts) => amounts.map((amount, i) => ({ amount, key: `cat-${i % 2}`, label: `Merchant ${i}` }));
const dotsColourFor = (point) => (point.key === 'cat-0' ? '#2a78d6' : '#eb6834');

test('dot plot draws one dot per point', () => {
  const svg = renderDots(RESULT, { ...opts, points: dotPoints([-10, -20, -30, -286.48]) });
  assert.equal((svg.match(/<circle/g) ?? []).length, 4);
});

test('dot plot colours each dot by its own category', () => {
  const svg = renderDots(RESULT, { ...opts, points: dotPoints([-10, -20, -30]), colourFor: dotsColourFor });
  const fills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/gi)].map((m) => m[1].toLowerCase());
  assert.deepEqual(new Set(fills), new Set(['#2a78d6', '#eb6834']));
});

test('dot plot falls back to a single hue with no colourFor', () => {
  const svg = renderDots(RESULT, { ...opts, points: dotPoints([-10, -20, -30]) });
  const fills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/gi)].map((m) => m[1].toLowerCase());
  assert.equal(new Set(fills).size, 1, `expected one hue, got ${[...new Set(fills)]}`);
});

test('dot plot markers are at least 8px across', () => {
  assert.match(renderDots(RESULT, { ...opts, points: dotPoints([-10]) }), /r="4"/);
});

test('dot plot shows exactly one VISIBLE label, for the largest outlier', () => {
  const svg = renderDots(RESULT, { ...opts, points: dotPoints([-10, -20, -30, -286.48]) });
  assert.equal((svg.match(/class="viz-value"/g) ?? []).length, 1);
  assert.match(svg, /class="viz-value">-\$286\.48</);
});

test('dot plot hover shows the merchant AND the amount, on every dot', () => {
  const svg = renderDots(RESULT, { ...opts, points: [{ amount: -12.5, key: 'coffee', label: 'Blend Coffee' }, { amount: -8, key: 'coffee', label: 'Blend Coffee' }] });
  assert.equal((svg.match(/<title>/g) ?? []).length, 2);
  assert.match(svg, /<title>Blend Coffee: -\$12\.50<\/title>/);
});

test('dot plot with no points renders a message', () => {
  assert.match(renderDots(RESULT, { ...opts, points: [] }), /No data/);
});

test('no treemap or dot output references an external host', () => {
  const markup = renderTreemap(RESULT, opts) + renderDots(RESULT, { ...opts, points: dotPoints([-1]) });
  assert.doesNotMatch(markup, /https?:\/\/(?!127\.0\.0\.1|localhost)/);
});
