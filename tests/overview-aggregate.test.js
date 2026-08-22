import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateOverview } from '../web/overview-view.js';

// A small hand-built snapshot exercising: two categories in the same group,
// a category in a different group, an excluded transaction, an income
// transaction, and an 'unknown'-category row that should count toward
// needsReview without being counted as spend (its categoryId happens to be
// 'uncategorised', not 'income', so it still lands in the spend group).
const categories = {
  groups: [
    { id: 'food-drink', label: 'Food & Drink' },
    { id: 'transport', label: 'Transport' },
    { id: 'other', label: 'Other' }
  ],
  categories: [
    { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
    { id: 'coffee', label: 'Coffee', groupId: 'food-drink' },
    { id: 'fuel', label: 'Fuel', groupId: 'transport' },
    { id: 'uncategorised', label: 'Uncategorised', groupId: 'other' },
    { id: 'income', label: 'Income', groupId: 'other' }
  ]
};

function snapshot(transactions) {
  return { transactions, categories };
}

test('aggregateOverview groups spend by category and by group', () => {
  const result = aggregateOverview(snapshot([
    { id: '1', amount: -50, categoryId: 'groceries', categorySource: 'rule', excluded: false },
    { id: '2', amount: -30, categoryId: 'groceries', categorySource: 'rule', excluded: false },
    { id: '3', amount: -10, categoryId: 'coffee', categorySource: 'rule', excluded: false },
    { id: '4', amount: -20, categoryId: 'fuel', categorySource: 'rule', excluded: false }
  ]));

  assert.equal(result.total, -110);
  assert.equal(result.count, 4);
  assert.equal(result.needsReview, 0);

  const foodGroup = result.groups.find((g) => g.groupId === 'food-drink');
  assert.equal(foodGroup.total, -90);
  assert.equal(foodGroup.count, 3);
  const groceries = foodGroup.categories.find((c) => c.categoryId === 'groceries');
  assert.equal(groceries.total, -80);
  assert.equal(groceries.count, 2);

  const transportGroup = result.groups.find((g) => g.groupId === 'transport');
  assert.equal(transportGroup.total, -20);
  assert.equal(transportGroup.count, 1);
});

test('aggregateOverview excludes excluded rows, income rows and positive amounts from spend, but still counts unknown categorisation toward needsReview', () => {
  const result = aggregateOverview(snapshot([
    { id: '1', amount: -50, categoryId: 'groceries', categorySource: 'rule', excluded: false },
    { id: '2', amount: -999, categoryId: 'fuel', categorySource: 'rule', excluded: true },
    { id: '3', amount: 200, categoryId: 'income', categorySource: 'rule', excluded: false },
    { id: '4', amount: -15, categoryId: 'uncategorised', categorySource: 'unknown', excluded: false }
  ]));

  assert.equal(result.total, -65, 'excluded row and income row must not count as spend');
  assert.equal(result.count, 2);
  assert.equal(result.needsReview, 1, 'the unknown-categorised row still counts toward needsReview');
  assert.ok(!result.groups.some((g) => g.categories.some((c) => c.categoryId === 'fuel')),
    'the excluded transaction must not appear in any group at all');
});

test('aggregateOverview returns null when there is no spend to show', () => {
  const result = aggregateOverview(snapshot([
    { id: '1', amount: 100, categoryId: 'income', categorySource: 'rule', excluded: false }
  ]));
  assert.equal(result, null);
});
