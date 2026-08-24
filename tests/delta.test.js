import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaDirection, formatDelta, deltaClass, deltaChip } from '../web/delta.js';

test('deltaDirection returns null when there is no baseline', () => {
  assert.equal(deltaDirection(null), null);
  assert.equal(deltaDirection(undefined), null);
});

test('deltaDirection treats a sub-cent difference as flat', () => {
  assert.equal(deltaDirection(0), 'flat');
  assert.equal(deltaDirection(0.004), 'flat');
  assert.equal(deltaDirection(0.01), 'up');
  assert.equal(deltaDirection(-12), 'down');
});

test('formatDelta shows a percentage when there is a baseline to divide by', () => {
  assert.equal(formatDelta(155.3, 0.34, 'sum'), '▲ 34%');
  assert.equal(formatDelta(-90, -0.41, 'sum'), '▼ 41%');
});

test('formatDelta falls back to an absolute amount when deltaPct is null', () => {
  // A bucket with no baseline has no percentage — never "▲ ∞%".
  assert.equal(formatDelta(40, null, 'sum'), '▲ $40.00');
  assert.equal(formatDelta(3, null, 'count'), '▲ 3');
});

test('formatDelta says so plainly when nothing moved', () => {
  assert.equal(formatDelta(0, 0, 'sum'), '– no change');
});

test('formatDelta is empty when there is no delta at all', () => {
  assert.equal(formatDelta(null, null, 'sum'), '');
});

test('deltaClass marks an increase as the warning direction', () => {
  // Up means MORE SPEND, which is the direction worth flagging.
  assert.equal(deltaClass(155.3), 'viz-delta viz-delta-up');
  assert.equal(deltaClass(-90), 'viz-delta viz-delta-down');
  assert.equal(deltaClass(null), 'viz-delta');
});

test('deltaChip renders nothing when the row has no baseline', () => {
  assert.equal(deltaChip({ baseline: null, delta: null, deltaPct: null }, 'sum', 'trailing3'), '');
  assert.equal(deltaChip({}, 'sum', 'trailing3'), '');
});

test('deltaChip names the baseline it is comparing against', () => {
  const html = deltaChip({ baseline: -200, delta: 100, deltaPct: 0.5 }, 'sum', 'trailing3');
  assert.match(html, /viz-delta-up/);
  assert.match(html, /▲ 50%/);
  assert.match(html, /vs 3-per avg/);
});

test('deltaChip emits exactly one element and no other markup', () => {
  // Two angle brackets = <span> and </span>. Any interpolation that bypassed
  // escapeHtml and introduced markup would push this count above two.
  const html = deltaChip({ baseline: -200, delta: 100, deltaPct: 0.5 }, 'sum', 'prevPeriod');
  assert.equal((html.match(/</g) ?? []).length, 2);
  assert.equal((html.match(/>/g) ?? []).length, 2);
});
