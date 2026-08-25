import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linearScale, niceTicks, formatMoney, formatMeasure, escapeHtml } from '../web/charts/scale.js';
import { renderBar, VALUE_WIDTH, DELTA_WIDTH } from '../web/charts/chart-bar.js';
import { renderTable } from '../web/charts/chart-table.js';

const RESULT = {
  rows: [
    { key: 'fuel', label: 'Fuel', value: -200, count: 1, total: -200, stats: { txnCount: 1, median: -200, largest: -200, top3Share: 1 } },
    { key: 'groceries', label: 'Groceries', value: -140, count: 2, total: -140, stats: { txnCount: 2, median: -70, largest: -100, top3Share: 1 } }
  ],
  total: -340,
  stats: { txnCount: 3, median: -100, largest: -200, top3Share: 1 },
  meta: { sliceBy: 'category', measure: 'sum', rowCount: 2, filteredCount: 3, truncated: false }
};

const opts = { mode: 'light', colourFor: () => '#2a78d6', title: 'Spend by category' };

test('linearScale maps 0 and the domain max onto the range', () => {
  const s = linearScale(200, 100);
  assert.equal(s(0), 0);
  assert.equal(s(200), 100);
  assert.equal(s(100), 50);
});

test('linearScale is safe when the domain is zero', () => {
  assert.equal(linearScale(0, 100)(0), 0);
});

test('niceTicks returns ascending round numbers covering the max', () => {
  const ticks = niceTicks(340, 4);
  assert.ok(ticks.at(-1) >= 340);
  assert.deepEqual(ticks, [...ticks].sort((a, b) => a - b));
});

test('niceTicks ends at exactly the max when it is an exact multiple', () => {
  const ticks = niceTicks(400, 4);
  assert.equal(ticks.at(-1), 400);
});

test('niceTicks still has a tick >= max for non-multiples', () => {
  const ticks = niceTicks(340, 4);
  assert.ok(ticks.at(-1) >= 340);
});

test('formatMoney is grouped, two-decimal, sign-leading', () => {
  assert.equal(formatMoney(-1404.01), '-$1,404.01');
  assert.equal(formatMoney(0), '$0.00');
  assert.equal(formatMoney(4200), '$4,200.00');
});

test('formatMeasure picks the unit from the measure name', () => {
  assert.equal(formatMeasure(5, 'count'), '5');
  assert.equal(formatMeasure(-140, 'sum'), '-$140.00');
  assert.equal(formatMeasure(50, 'pctOfTotal'), '50%');
  assert.equal(formatMeasure(12.5, 'pctOfTotal'), '12.5%');
  assert.equal(formatMeasure(-10, undefined), '-$10.00');
});

test('escapeHtml neutralises markup from bank descriptions', () => {
  assert.equal(escapeHtml('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
  assert.equal(escapeHtml('Tom & Jerry'), 'Tom &amp; Jerry');
  assert.equal(escapeHtml('"quoted"'), '&quot;quoted&quot;');
});

test('renderBar emits SVG with one rect per row', () => {
  const svg = renderBar(RESULT, opts);
  assert.match(svg, /^<svg/);
  assert.equal((svg.match(/<rect/g) ?? []).length >= 2, true);
});

test('renderBar direct-labels every bar — the palette contrast relief', () => {
  const svg = renderBar(RESULT, opts);
  assert.match(svg, /Fuel/);
  assert.match(svg, /-\$200\.00/);
  assert.match(svg, /Groceries/);
  assert.match(svg, /-\$140\.00/);
});

test('renderBar uses rounded data-ends', () => {
  assert.match(renderBar(RESULT, opts), /rx="4"/);
});

test('renderBar escapes labels', () => {
  const nasty = { ...RESULT, rows: [{ ...RESULT.rows[0], label: '<script>x</script>' }] };
  const svg = renderBar(nasty, opts);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;/);
});

test('renderBar renders an empty result as a message, not a broken chart', () => {
  const svg = renderBar({ ...RESULT, rows: [], total: 0 }, opts);
  assert.match(svg, /No data/);
  assert.doesNotMatch(svg, /<rect/);
});

test('renderBar shows the raw sum as money — the money path must not regress', () => {
  const svg = renderBar(RESULT, opts);
  assert.match(svg, /-\$200\.00/);
});

test('renderBar shows a plain integer for a count measure, not money', () => {
  const COUNT_RESULT = {
    ...RESULT,
    rows: [{ ...RESULT.rows[0], value: 5 }],
    meta: { ...RESULT.meta, measure: 'count' }
  };
  const svg = renderBar(COUNT_RESULT, opts);
  assert.match(svg, />5</);
  assert.doesNotMatch(svg, /\$5\.00/);
});

test('renderTable shows label, value and count as text', () => {
  const html = renderTable(RESULT, opts);
  assert.match(html, /<table/);
  assert.match(html, /Fuel/);
  assert.match(html, /-\$200\.00/);
  assert.match(html, />1</);
});

test('renderTable shows the concentration line for each row', () => {
  const html = renderTable(RESULT, opts);
  assert.match(html, /top 3/i);
});

test('renderTable escapes labels', () => {
  const nasty = { ...RESULT, rows: [{ ...RESULT.rows[0], label: '<b>x</b>' }] };
  assert.doesNotMatch(renderTable(nasty, opts), /<b>x<\/b>/);
});

test('renderTable shows a plain integer for a count measure, not money', () => {
  const COUNT_RESULT = {
    ...RESULT,
    rows: [{ ...RESULT.rows[0], value: 5 }],
    meta: { ...RESULT.meta, measure: 'count' }
  };
  const html = renderTable(COUNT_RESULT, opts);
  assert.match(html, /<td class="num">5<\/td>/);
  assert.doesNotMatch(html, /\$5\.00/);
});

test('no chart output references an external host', () => {
  for (const markup of [renderBar(RESULT, opts), renderTable(RESULT, opts)]) {
    assert.doesNotMatch(markup, /https?:\/\/(?!127\.0\.0\.1|localhost)/);
  }
});

test('renderBar marks each bar with its slice key for drill-down', () => {
  const svg = renderBar(RESULT, opts);
  assert.match(svg, /data-slice-key="fuel"/);
  assert.match(svg, /data-slice-key="groceries"/);
  assert.match(svg, /class="viz-clickable"/);
});

// Task 5 tests: ghost baseline bars
import { formatDelta, deltaClass } from '../web/delta.js';

const withBaseline = (rows) => ({ rows, total: 0, stats: {}, meta: { measure: 'sum' } });

test('the bar chart draws no ghost bar when no row has a baseline', () => {
  const svg = renderBar(withBaseline([
    { key: 'groceries', label: 'Groceries', value: -300, count: 3, baseline: null, delta: null, deltaPct: null }
  ]));
  assert.equal(svg.includes('viz-ghost'), false);
  assert.equal(svg.includes('viz-delta'), false);
});

test('the bar chart draws a dashed ghost bar and a delta label when a baseline exists', () => {
  const svg = renderBar(withBaseline([
    { key: 'groceries', label: 'Groceries', value: -300, count: 3, baseline: -200, delta: 100, deltaPct: 0.5 }
  ]));
  assert.match(svg, /class="viz-ghost"/);
  assert.match(svg, /stroke-dasharray/);
  assert.match(svg, /viz-delta-up/);
  assert.match(svg, /▲ 50%/);
});

test('the bar scale accounts for a baseline taller than every real bar', () => {
  // Spending collapsed this month. The ghost bar is the widest mark on the
  // chart, so the domain must come from it or it would overflow the plot.
  const svg = renderBar(withBaseline([
    { key: 'groceries', label: 'Groceries', value: -50, count: 1, baseline: -500, delta: -450, deltaPct: -0.9 }
  ]));
  const widths = [...svg.matchAll(/width="([\d.]+)"/g)].map((m) => Number(m[1]));
  const plotWidth = 600 - 150 - (VALUE_WIDTH + DELTA_WIDTH);
  assert.ok(widths.every((w) => w <= plotWidth + 1), `a mark overflowed the plot: ${widths}`);
});

test('a row with a zero baseline still renders without a ghost bar of negative width', () => {
  const svg = renderBar(withBaseline([
    { key: 'shopping', label: 'Shopping', value: -40, count: 1, baseline: 0, delta: 40, deltaPct: null }
  ]));
  assert.equal(svg.includes('width="-'), false);
  assert.match(svg, /▲ \$40\.00/);
});

// Fix-pass tests (finding 1): the delta column must not be narrower than
// the value column when its content is at least as long.
const VALUE_COLUMN_WIDTH = VALUE_WIDTH;

test('finding 1: an isNew delta with no baseline percentage does not collide with the value column', () => {
  // No prior-period spend to divide by, so formatDelta falls back to an
  // absolute money string ("▲ $12,345.67") instead of a percentage — the
  // longest realistic content the delta column has to hold.
  const measure = 'sum';
  const row = { key: 'shopping', label: 'Shopping', value: -12345.67, count: 4, baseline: 0, delta: 12345.67, deltaPct: null };
  const svg = renderBar(withBaseline([row]));

  const valueText = formatMeasure(row.value, measure);
  const deltaText = formatDelta(row.delta, row.deltaPct, measure);
  // formatDelta's isNew fallback is formatMeasure() with an "arrow + space"
  // prefix, so for a comparable magnitude the delta string can never be
  // shorter than the value string. The fixture sanity-checks that premise so
  // the geometry assertion below is not resting on an accident of formatting.
  assert.ok(deltaText.length >= valueText.length,
    `fixture premise broken: expected the delta string to be at least as long as the value string (${JSON.stringify({ valueText, deltaText })})`);

  const width = Number(svg.match(/viewBox="0 0 (\d+)/)[1]);
  const valueXMatch = svg.match(/x="([\d.]+)" y="[\d.]+" text-anchor="end" class="viz-value"/);
  assert.ok(valueXMatch, 'expected a value text element');
  const valueX = Number(valueXMatch[1]);
  // The delta column occupies everything right of the value text's anchor.
  const deltaColumnWidth = width - valueX;

  assert.ok(deltaColumnWidth >= VALUE_COLUMN_WIDTH,
    `delta column (${deltaColumnWidth}px) is narrower than the value column (${VALUE_COLUMN_WIDTH}px) despite holding equal-or-longer content — an oversized delta string will grow left into the value column`);
});
