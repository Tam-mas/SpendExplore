import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transactionsForSlice } from '../lib/query/slice-transactions.js';

const SNAPSHOT = {
  categories: {
    groups: [{ id: 'food-drink', label: 'Food & Drink' }],
    categories: [
      { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
      { id: 'alcohol', label: 'Alcohol', groupId: 'food-drink' }
    ]
  },
  accounts: [{ id: 'spending', label: 'Joint', cardOwners: {} }],
  transactions: [
    { id: 'a', date: '2026-07-05', amount: -100, merchant: 'Coles', accountId: 'spending', cardSuffix: null, categoryId: 'groceries', excluded: false },
    { id: 'b', date: '2026-08-05', amount: -40, merchant: 'Dan Murphy\'s', accountId: 'spending', cardSuffix: null, categoryId: 'alcohol', excluded: false },
    { id: 'c', date: '2026-08-07', amount: -20, merchant: 'Dan Murphy\'s', accountId: 'spending', cardSuffix: null, categoryId: 'alcohol', excluded: false }
  ]
};

test('returns the rows and label for a matching bucket', () => {
  const result = transactionsForSlice(SNAPSHOT, { sliceBy: 'category' }, 'alcohol');
  assert.equal(result.label, 'Alcohol');
  assert.deepEqual(result.rows.map((r) => r.id).sort(), ['b', 'c']);
});

test('returns null for a key with no matching bucket', () => {
  assert.equal(transactionsForSlice(SNAPSHOT, { sliceBy: 'category' }, 'nope'), null);
});

test('applies the given filters before bucketing', () => {
  const result = transactionsForSlice(SNAPSHOT, { sliceBy: 'category', filters: { dateFrom: '2026-08-06' } }, 'alcohol');
  assert.deepEqual(result.rows.map((r) => r.id), ['c']);
});

test('defaults sliceBy to category', () => {
  const result = transactionsForSlice(SNAPSHOT, {}, 'groceries');
  assert.equal(result.rows.length, 1);
});

test('throws on an unsupported slice, same as query()', () => {
  assert.throws(() => transactionsForSlice(SNAPSHOT, { sliceBy: 'nonsense' }, 'x'));
});
