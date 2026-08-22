import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '../lib/query/query.js';

const SNAPSHOT = {
  categories: {
    groups: [
      { id: 'food-drink', label: 'Food & Drink' },
      { id: 'transport', label: 'Transport' },
      { id: 'other', label: 'Other' }
    ],
    categories: [
      { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
      { id: 'alcohol', label: 'Alcohol', groupId: 'food-drink' },
      { id: 'fuel', label: 'Fuel', groupId: 'transport' },
      { id: 'income', label: 'Income', groupId: 'other' }
    ]
  },
  accounts: [{ id: 'spending', label: 'Joint', cardOwners: { '4321': 'Alex' } }],
  transactions: [
    { id: 'a', date: '2026-07-05', amount: -100, merchant: 'Coles', accountId: 'spending', cardSuffix: '4321', categoryId: 'groceries', excluded: false },
    { id: 'b', date: '2026-08-05', amount: -40, merchant: 'Coles', accountId: 'spending', cardSuffix: '4321', categoryId: 'groceries', excluded: false },
    { id: 'c', date: '2026-08-06', amount: -60, merchant: "Dan Murphy's", accountId: 'spending', cardSuffix: '4321', categoryId: 'alcohol', excluded: false },
    { id: 'd', date: '2026-08-07', amount: -200, merchant: 'BP', accountId: 'spending', cardSuffix: '4321', categoryId: 'fuel', excluded: false },
    { id: 'e', date: '2026-08-08', amount: 4200, merchant: 'Payroll', accountId: 'spending', cardSuffix: null, categoryId: 'income', excluded: false },
    { id: 'f', date: '2026-08-09', amount: -999, merchant: 'Ignore', accountId: 'spending', cardSuffix: '4321', categoryId: 'groceries', excluded: true }
  ]
};

const run = (spec) => query(SNAPSHOT, spec);

test('slices by category and sums, biggest first', () => {
  const r = run({ sliceBy: 'category', measure: 'sum' });
  assert.deepEqual(r.rows.map((x) => x.label), ['Fuel', 'Groceries', 'Alcohol']);
  assert.deepEqual(r.rows.map((x) => x.value), [-200, -140, -60]);
});

test('income and excluded rows are out of the totals', () => {
  const r = run({ sliceBy: 'category', measure: 'sum' });
  assert.equal(r.total, -400);
  assert.equal(r.meta.filteredCount, 4);
});

test('each row carries its own transaction count and concentration stats', () => {
  const groceries = run({ sliceBy: 'category', measure: 'sum' }).rows.find((x) => x.key === 'groceries');
  assert.equal(groceries.count, 2);
  assert.equal(groceries.stats.txnCount, 2);
  assert.equal(groceries.stats.largest, -100);
  assert.equal(groceries.stats.top3Share, 1);
});

test('slices by group', () => {
  const r = run({ sliceBy: 'group', measure: 'sum' });
  assert.deepEqual(r.rows.map((x) => x.key), ['transport', 'food-drink']);
  assert.deepEqual(r.rows.map((x) => x.value), [-200, -200]);
});

test('count measure counts transactions', () => {
  const r = run({ sliceBy: 'category', measure: 'count' });
  assert.equal(r.rows.find((x) => x.key === 'groceries').value, 2);
  assert.equal(r.total, 4);
});

test('pctOfTotal normalises against the grand total', () => {
  const r = run({ sliceBy: 'category', measure: 'pctOfTotal' });
  assert.equal(r.rows.find((x) => x.key === 'fuel').value, 50);
  assert.equal(r.rows.reduce((a, x) => a + x.value, 0), 100);
});

test('a time slice keeps chronological order and ignores value sorting', () => {
  const r = run({ sliceBy: 'month', measure: 'sum', sort: { by: 'value', dir: 'desc' } });
  assert.deepEqual(r.rows.map((x) => x.key), ['2026-07', '2026-08']);
});

test('sorting by label ascending', () => {
  const r = run({ sliceBy: 'category', measure: 'sum', sort: { by: 'label', dir: 'asc' } });
  assert.deepEqual(r.rows.map((x) => x.label), ['Alcohol', 'Fuel', 'Groceries']);
});

test('limit truncates and flags it', () => {
  const r = run({ sliceBy: 'category', measure: 'sum', limit: 2 });
  assert.equal(r.rows.length, 2);
  assert.equal(r.meta.truncated, true);
  assert.equal(r.meta.rowCount, 3);
});

test('total reflects ALL matching rows, not just the limited ones', () => {
  assert.equal(run({ sliceBy: 'category', measure: 'sum', limit: 1 }).total, -400);
});

test('filters flow through to the result', () => {
  const r = run({ sliceBy: 'category', measure: 'sum', filters: { groupIds: ['food-drink'] } });
  assert.equal(r.total, -200);
  assert.deepEqual(r.rows.map((x) => x.key), ['groceries', 'alcohol']);
});

test('includeIncome brings income into its own row', () => {
  const r = run({ sliceBy: 'category', measure: 'sum', filters: { includeIncome: true } });
  assert.ok(r.rows.some((x) => x.key === 'income' && x.value === 4200));
});

test('an empty result is well formed, not a crash', () => {
  const r = run({ sliceBy: 'category', measure: 'sum', filters: { dateFrom: '2030-01-01' } });
  assert.deepEqual(r.rows, []);
  assert.equal(r.total, 0);
  assert.deepEqual(r.stats, { txnCount: 0, median: 0, largest: 0, top3Share: 0 });
});

test('the spec is validated rather than trusted', () => {
  assert.throws(() => run({ sliceBy: 'colour', measure: 'sum' }), /Unsupported slice/);
  assert.throws(() => run({ sliceBy: 'category', measure: 'stddev' }), /Unsupported measure/);
});

test('query does not mutate the snapshot', () => {
  const before = JSON.stringify(SNAPSHOT);
  run({ sliceBy: 'merchant', measure: 'sum', limit: 1 });
  assert.equal(JSON.stringify(SNAPSHOT), before);
});

test('the result carries no transaction records — the UI must not need them', () => {
  const r = run({ sliceBy: 'category', measure: 'sum' });
  for (const row of r.rows) {
    assert.equal(row.rows, undefined, 'query() must not leak raw transactions into rows');
    assert.deepEqual(Object.keys(row).sort(), ['count', 'key', 'label', 'stats', 'total', 'value']);
  }
});
