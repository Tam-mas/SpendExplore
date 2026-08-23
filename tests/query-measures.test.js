import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, MEASURES } from '../lib/query/measures.js';
import { concentrationStats } from '../lib/query/stats.js';

const rows = (...amounts) => amounts.map((amount, i) => ({ id: String(i), amount }));

test('MEASURES lists every supported measure', () => {
  assert.deepEqual([...MEASURES], ['sum', 'count', 'avg', 'median', 'pctOfTotal']);
});

test('sum adds the amounts', () => {
  assert.equal(measure(rows(-10, -20, -5), 'sum'), -35);
});

test('sum rounds to cents rather than leaking float error', () => {
  assert.equal(measure(rows(-0.1, -0.2), 'sum'), -0.3);
});

test('count counts rows', () => {
  assert.equal(measure(rows(-10, -20), 'count'), 2);
});

test('avg is the mean, rounded to cents', () => {
  assert.equal(measure(rows(-10, -20, -5), 'avg'), -11.67);
});

test('median of an odd count is the middle value', () => {
  assert.equal(measure(rows(-10, -50, -20), 'median'), -20);
});

test('median of an even count is the mean of the middle two', () => {
  assert.equal(measure(rows(-10, -20, -30, -40), 'median'), -25);
});

test('pctOfTotal returns the raw sum for the caller to normalise', () => {
  assert.equal(measure(rows(-10, -20), 'pctOfTotal'), -30);
});

test('every measure returns 0 for an empty bucket rather than NaN', () => {
  for (const name of MEASURES) assert.equal(measure([], name), 0, name);
});

test('an unknown measure throws a clear error', () => {
  assert.throws(() => measure(rows(-1), 'stddev'), /Unsupported measure: stddev/);
});

test('concentration stats describe the shape of a bucket', () => {
  const s = concentrationStats(rows(-10, -20, -30, -286.48, -5));
  assert.equal(s.txnCount, 5);
  assert.equal(s.median, -20);
  assert.equal(s.largest, -286.48);
});

test('top3Share exposes a few-big bucket', () => {
  // 286.48 + 30 + 20 = 336.48 of 351.48 total
  const s = concentrationStats(rows(-10, -20, -30, -286.48, -5));
  assert.ok(s.top3Share > 0.95, `expected >0.95, got ${s.top3Share}`);
});

test('top3Share exposes a many-small bucket', () => {
  const s = concentrationStats(rows(...Array(20).fill(-10)));
  assert.ok(s.top3Share < 0.2, `expected <0.2, got ${s.top3Share}`);
});

test('top3Share is 1 when there are three or fewer transactions', () => {
  assert.equal(concentrationStats(rows(-10, -20)).top3Share, 1);
});

test('concentration stats on an empty bucket are all zero, never NaN', () => {
  const s = concentrationStats([]);
  assert.deepEqual(s, { txnCount: 0, median: 0, largest: 0, top3Share: 0 });
});

test('largest means largest by magnitude, not most positive', () => {
  assert.equal(concentrationStats(rows(-100, 5)).largest, -100);
});

test('stats do not mutate the input array order', () => {
  const input = rows(-10, -50, -20);
  const before = input.map((r) => r.amount).join();
  concentrationStats(input);
  assert.equal(input.map((r) => r.amount).join(), before);
});
