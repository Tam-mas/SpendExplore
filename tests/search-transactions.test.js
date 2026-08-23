import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchTransactions } from '../lib/query/search-transactions.js';

const SNAPSHOT = {
  categories: {
    groups: [{ id: 'health', label: 'Health' }, { id: 'food-drink', label: 'Food & Drink' }],
    categories: [
      { id: 'pharmacy', label: 'Pharmacy', groupId: 'health' },
      { id: 'groceries', label: 'Groceries', groupId: 'food-drink' }
    ]
  },
  accounts: [{ id: 'spending', label: 'Joint', cardOwners: {} }],
  transactions: [
    { id: 'a', date: '2026-08-01', amount: -20, rawDescription: 'CHEMIST WAREHOUSE COBURG', merchant: 'Chemist Warehouse', accountId: 'spending', cardSuffix: null, categoryId: 'pharmacy', excluded: false },
    { id: 'b', date: '2026-08-02', amount: -5, rawDescription: 'COLES 1234 CHEM ST', merchant: 'Coles', accountId: 'spending', cardSuffix: null, categoryId: 'groceries', excluded: false },
    { id: 'c', date: '2026-08-03', amount: -8, rawDescription: 'WW METRO 55', merchant: 'Woolworths', accountId: 'spending', cardSuffix: null, categoryId: 'groceries', excluded: false }
  ]
};

test('matches by merchant name, case-insensitively', () => {
  assert.deepEqual(searchTransactions(SNAPSHOT, {}, 'CHEM').map((r) => r.id).sort(), ['a', 'b']);
});

test('matches by raw description when the merchant itself does not match', () => {
  assert.deepEqual(searchTransactions(SNAPSHOT, {}, 'chem st').map((r) => r.id), ['b']);
});

test('empty or whitespace-only query returns nothing', () => {
  assert.deepEqual(searchTransactions(SNAPSHOT, {}, ''), []);
  assert.deepEqual(searchTransactions(SNAPSHOT, {}, '   '), []);
});

test('a term matching nothing returns an empty array, not an error', () => {
  assert.deepEqual(searchTransactions(SNAPSHOT, {}, 'zzz'), []);
});

test('applies the given filters before matching', () => {
  const results = searchTransactions(SNAPSHOT, { filters: { categoryIds: ['groceries'] } }, 'chem');
  assert.deepEqual(results.map((r) => r.id), ['b']);
});

test('does not mutate the snapshot', () => {
  const before = JSON.stringify(SNAPSHOT);
  searchTransactions(SNAPSHOT, {}, 'chem');
  assert.equal(JSON.stringify(SNAPSHOT), before);
});
