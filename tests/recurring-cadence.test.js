import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CADENCES, gapsBetween, detectCadence } from '../lib/recurring.js';

test('cadence tolerance bands never overlap', () => {
  const bands = CADENCES.map((c) => [c.days - c.tolerance, c.days + c.tolerance]).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < bands.length; i++) {
    assert.ok(bands[i][0] > bands[i - 1][1],
      `bands overlap: ${JSON.stringify(bands[i - 1])} and ${JSON.stringify(bands[i])}`);
  }
});

test('gapsBetween returns inclusive day differences in date order', () => {
  assert.deepEqual(gapsBetween(['2026-08-01', '2026-08-08', '2026-08-15']), [7, 7]);
  // Unsorted input must still produce ascending gaps.
  assert.deepEqual(gapsBetween(['2026-08-15', '2026-08-01', '2026-08-08']), [7, 7]);
  assert.deepEqual(gapsBetween(['2026-08-01']), []);
});

test('detectCadence recognises a monthly charge despite 28-31 day months', () => {
  const result = detectCadence(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
  assert.equal(result.cadence, 'monthly');
  assert.equal(result.skippedPeriods, 0);
});

test('detectCadence separates fortnightly from monthly', () => {
  assert.equal(detectCadence(['2026-08-01', '2026-08-15', '2026-08-29']).cadence, 'fortnightly');
  assert.equal(detectCadence(['2026-06-01', '2026-07-01', '2026-08-01']).cadence, 'monthly');
});

test('detectCadence recognises weekly, quarterly and annual', () => {
  assert.equal(detectCadence(['2026-08-03', '2026-08-10', '2026-08-17']).cadence, 'weekly');
  assert.equal(detectCadence(['2025-11-01', '2026-02-01', '2026-05-01']).cadence, 'quarterly');
  assert.equal(detectCadence(['2024-03-01', '2025-03-01', '2026-03-01']).cadence, 'annual');
});

test('detectCadence rejects fewer than three occurrences in strict mode', () => {
  assert.equal(detectCadence(['2026-07-01', '2026-08-01']), null);
});

test('detectCadence accepts two occurrences in loose mode', () => {
  const result = detectCadence(['2026-07-01', '2026-08-01'], { strict: false });
  assert.equal(result.cadence, 'monthly');
});

test('detectCadence rejects gaps that match no band', () => {
  // 20 days is in the dead zone between fortnightly and monthly. It is not a
  // cadence, and calling it one would manufacture a subscription.
  assert.equal(detectCadence(['2026-08-01', '2026-08-21', '2026-09-10']), null);
});

test('detectCadence rejects an irregular sequence even when the median looks clean', () => {
  // Gaps 30, 5, 55: the median is 30, but this is not a monthly charge.
  assert.equal(detectCadence(['2026-06-01', '2026-07-01', '2026-07-06', '2026-08-30']), null);
});

test('detectCadence tolerates a single skipped period and counts it', () => {
  // A failed payment in March. Still monthly, with one period missed.
  const result = detectCadence(['2026-01-15', '2026-02-15', '2026-04-15', '2026-05-15']);
  assert.equal(result.cadence, 'monthly');
  assert.equal(result.skippedPeriods, 1);
});

test('detectCadence rejects a sequence that is mostly skips', () => {
  // Two of three gaps are doubled — too sparse to call a monthly commitment.
  assert.equal(detectCadence(['2026-01-15', '2026-03-15', '2026-05-15', '2026-06-15']), null);
});
