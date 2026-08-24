import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDots } from '../web/charts/chart-dots.js';

const opts = (points) => ({ mode: 'light', title: 'Small spends', points, colourFor: () => '#2a78d6' });

test('renders nothing for no points', () => {
  assert.match(renderDots({}, opts([])), /No data/);
});

test('labels the real largest transaction even when every amount is under $1', () => {
  // Before the fix, the domain was floored to $1 whenever the true max was
  // under $1, which moved the outlier label to the position for $1 (where
  // no dot exists) and made it show the WRONG transaction's amount.
  const points = [
    { amount: -0.20, label: 'Parking meter' },
    { amount: -0.50, label: 'Vending machine' },
    { amount: -0.35, label: 'Transit tap' }
  ];
  const html = renderDots({}, opts(points));
  assert.match(html, /-\$0\.50/, 'outlier label should show the true largest magnitude, $0.50');
  assert.doesNotMatch(html, /-\$1\.00/, 'the domain must not be floored to $1 when every point is under $1');
});

test('still labels correctly when a point is exactly $0 (zero-domain guard)', () => {
  const points = [{ amount: 0, label: 'Free sample' }];
  const html = renderDots({}, opts(points));
  assert.match(html, /\$0\.00/);
});
