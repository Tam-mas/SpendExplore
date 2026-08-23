import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFilters, buildContext } from '../lib/query/filter.js';

const SNAPSHOT = {
  categories: {
    groups: [{ id: 'food-drink', label: 'Food & Drink' }, { id: 'other', label: 'Other' }],
    categories: [
      { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
      { id: 'alcohol', label: 'Alcohol', groupId: 'food-drink' },
      { id: 'income', label: 'Income', groupId: 'other' },
      { id: 'uncategorised', label: 'Uncategorised', groupId: 'other' }
    ]
  },
  accounts: [{ id: 'spending', label: 'Joint', cardOwners: { '4321': 'Alex', '8765': 'Partner' } }]
};

const t = (over) => ({
  id: 'x', date: '2026-08-10', amount: -10, rawDescription: 'R', merchant: 'Coles',
  accountId: 'spending', cardSuffix: '4321', categoryId: 'groceries',
  categorySource: 'rule', excluded: false, importId: 'i', note: null, ...over
});

const ROWS = [
  t({ id: 'a', date: '2026-07-01', amount: -10, categoryId: 'groceries', merchant: 'Coles' }),
  t({ id: 'b', date: '2026-08-01', amount: -200, categoryId: 'alcohol', merchant: 'Dan Murphy\'s', cardSuffix: '8765' }),
  t({ id: 'c', date: '2026-08-15', amount: -5, categoryId: 'uncategorised', merchant: 'Sunshine Deli' }),
  t({ id: 'd', date: '2026-08-20', amount: 4200, categoryId: 'income', merchant: 'Payroll' }),
  t({ id: 'e', date: '2026-08-21', amount: -50, categoryId: 'groceries', excluded: true }),
  t({ id: 'f', date: '2026-08-22', amount: -30, accountId: 'card', cardSuffix: null, categoryId: 'uncategorised', merchant: 'Card charge' })
];

const ctx = buildContext(SNAPSHOT);

const ids = (rows) => rows.map((r) => r.id).sort().join('');

test('buildContext maps categories to groups and cards to people', () => {
  assert.equal(ctx.categoryToGroup.get('alcohol'), 'food-drink');
  assert.equal(ctx.cardOwners['8765'], 'Partner');
});

test('by default drops excluded and income rows', () => {
  assert.equal(ids(applyFilters(ROWS, {}, ctx)), 'abcf');
});

test('includeExcluded brings excluded rows back', () => {
  assert.ok(applyFilters(ROWS, { includeExcluded: true }, ctx).some((r) => r.id === 'e'));
});

test('includeIncome brings income rows back', () => {
  assert.ok(applyFilters(ROWS, { includeIncome: true }, ctx).some((r) => r.id === 'd'));
});

test('empty arrays mean no constraint, not match-nothing', () => {
  const all = applyFilters(ROWS, { categoryIds: [], groupIds: [], accountIds: [], people: [], merchants: [] }, ctx);
  assert.equal(ids(all), 'abcf');
});

test('date range is inclusive on both ends', () => {
  assert.equal(ids(applyFilters(ROWS, { dateFrom: '2026-08-01', dateTo: '2026-08-15' }, ctx)), 'bc');
});

test('filters by category', () => {
  assert.equal(ids(applyFilters(ROWS, { categoryIds: ['groceries'] }, ctx)), 'a');
});

test('filters by group, expanding to its categories', () => {
  assert.equal(ids(applyFilters(ROWS, { groupIds: ['food-drink'] }, ctx)), 'ab');
});

test('filters by account', () => {
  assert.equal(ids(applyFilters(ROWS, { accountIds: ['card'] }, ctx)), 'f');
});

test('filters by person via card suffix', () => {
  assert.equal(ids(applyFilters(ROWS, { people: ['Partner'] }, ctx)), 'b');
});

test('a transaction with no card suffix is attributed to Joint', () => {
  assert.equal(ids(applyFilters(ROWS, { people: ['Joint'] }, ctx)), 'f');
});

test('filters by merchant, case-insensitively', () => {
  assert.equal(ids(applyFilters(ROWS, { merchants: ['coles'] }, ctx)), 'a');
});

test('amount bounds compare absolute values', () => {
  assert.equal(ids(applyFilters(ROWS, { minAbsAmount: 100 }, ctx)), 'b');
  assert.equal(ids(applyFilters(ROWS, { maxAbsAmount: 10 }, ctx)), 'ac');
});

test('combined filters intersect', () => {
  const r = applyFilters(ROWS, { groupIds: ['food-drink'], dateFrom: '2026-08-01' }, ctx);
  assert.equal(ids(r), 'b');
});

test('does not mutate the input array or its rows', () => {
  const before = JSON.stringify(ROWS);
  applyFilters(ROWS, { categoryIds: ['groceries'] }, ctx);
  assert.equal(JSON.stringify(ROWS), before);
});

test('an unknown category id matches nothing rather than throwing', () => {
  assert.equal(applyFilters(ROWS, { categoryIds: ['nope'] }, ctx).length, 0);
});

test('excludeIds drops specific rows regardless of their other fields', () => {
  assert.equal(ids(applyFilters(ROWS, { excludeIds: ['a', 'c'] }, ctx)), 'bf');
});

test('an empty excludeIds means no constraint, not match-nothing', () => {
  assert.equal(ids(applyFilters(ROWS, { excludeIds: [] }, ctx)), 'abcf');
});

test('excludeIds is independent of the ledger own excluded field', () => {
  // row e already has excluded:true and is already dropped by default; excludeIds
  // hiding row a on top of that must not need includeExcluded to reveal e.
  const result = applyFilters(ROWS, { excludeIds: ['a'] }, ctx);
  assert.ok(!result.some((r) => r.id === 'a'));
  assert.ok(!result.some((r) => r.id === 'e'));
});
