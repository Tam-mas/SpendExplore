import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupBy, SLICES, TIME_SLICES } from '../lib/query/group-by.js';
import { buildContext } from '../lib/query/filter.js';

const SNAPSHOT = {
  categories: {
    groups: [{ id: 'food-drink', label: 'Food & Drink' }, { id: 'transport', label: 'Transport' }],
    categories: [
      { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
      { id: 'public-transport', label: 'Public transport', groupId: 'transport' }
    ]
  },
  accounts: [{ id: 'spending', label: 'Joint spending', cardOwners: { '4321': 'Alex', '8765': 'Partner' } }]
};
const ctx = buildContext(SNAPSHOT);

const t = (over) => ({
  id: 'x', date: '2026-08-10', amount: -10, merchant: 'Coles', accountId: 'spending',
  cardSuffix: '4321', categoryId: 'groceries', excluded: false, ...over
});

test('SLICES lists every supported dimension', () => {
  assert.deepEqual([...SLICES].sort(), [
    'account', 'amountBand', 'category', 'group', 'merchant', 'month', 'person', 'week', 'weekday'
  ]);
  assert.deepEqual([...TIME_SLICES], ['week', 'month']);
});

test('groups by category using the taxonomy label', () => {
  const out = groupBy([t({}), t({ categoryId: 'public-transport' })], 'category', ctx);
  const labels = out.map((g) => g.label).sort();
  assert.deepEqual(labels, ['Groceries', 'Public transport']);
});

test('groups by group', () => {
  const out = groupBy([t({}), t({ categoryId: 'public-transport' })], 'group', ctx);
  assert.deepEqual(out.map((g) => g.key).sort(), ['food-drink', 'transport']);
});

test('groups by merchant', () => {
  const out = groupBy([t({}), t({ merchant: 'Aldi' })], 'merchant', ctx);
  assert.deepEqual(out.map((g) => g.label).sort(), ['Aldi', 'Coles']);
});

test('groups by person, with no card suffix falling to Joint', () => {
  const out = groupBy([t({}), t({ cardSuffix: '8765' }), t({ cardSuffix: null })], 'person', ctx);
  assert.deepEqual(out.map((g) => g.key).sort(), ['Alex', 'Joint', 'Partner']);
});

test('groups by account using the account label', () => {
  const out = groupBy([t({})], 'account', ctx);
  assert.equal(out[0].label, 'Joint spending');
});

test('an unknown account id falls back to its raw id', () => {
  const out = groupBy([t({ accountId: 'ghost' })], 'account', ctx);
  assert.equal(out[0].label, 'ghost');
});

test('groups by month in chronological order', () => {
  const rows = [t({ date: '2026-08-02' }), t({ date: '2026-06-30' }), t({ date: '2026-07-15' })];
  assert.deepEqual(groupBy(rows, 'month', ctx).map((g) => g.key), ['2026-06', '2026-07', '2026-08']);
});

test('month labels are human readable', () => {
  assert.equal(groupBy([t({ date: '2026-08-02' })], 'month', ctx)[0].label, 'Aug 2026');
});

test('groups by ISO week in chronological order', () => {
  const rows = [t({ date: '2026-08-10' }), t({ date: '2026-08-03' })];
  const keys = groupBy(rows, 'week', ctx).map((g) => g.key);
  assert.deepEqual(keys, [...keys].sort());
  assert.equal(keys.length, 2);
});

test('groups by weekday in calendar order starting Monday', () => {
  // 2026-08-10 is a Monday, 2026-08-15 a Saturday, 2026-08-12 a Wednesday.
  const rows = [t({ date: '2026-08-15' }), t({ date: '2026-08-10' }), t({ date: '2026-08-12' })];
  assert.deepEqual(groupBy(rows, 'weekday', ctx).map((g) => g.label), ['Mon', 'Wed', 'Sat']);
});

test('groups by amount band in ascending band order', () => {
  const rows = [t({ amount: -500 }), t({ amount: -3 }), t({ amount: -45 })];
  const out = groupBy(rows, 'amountBand', ctx);
  assert.deepEqual(out.map((g) => g.label), ['Under $10', '$25–$50', '$200+']);
});

test('amount bands use absolute value so refunds band with purchases', () => {
  const out = groupBy([t({ amount: 45 })], 'amountBand', ctx);
  assert.equal(out[0].label, '$25–$50');
});

test('every returned row is in exactly one bucket', () => {
  const rows = [t({}), t({ merchant: 'Aldi' }), t({ merchant: 'Aldi' })];
  const out = groupBy(rows, 'merchant', ctx);
  assert.equal(out.reduce((n, g) => n + g.rows.length, 0), 3);
});

test('an unsupported slice throws a clear error', () => {
  assert.throws(() => groupBy([t({})], 'colour', ctx), /Unsupported slice: colour/);
});

test('does not mutate its input', () => {
  const rows = [t({})];
  const before = JSON.stringify(rows);
  groupBy(rows, 'category', ctx);
  assert.equal(JSON.stringify(rows), before);
});
