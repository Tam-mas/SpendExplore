import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBudgets } from '../web/budgets-view.js';

const SNAPSHOT = {
  categories: {
    groups: [{ id: 'food-drink', label: 'Food & Drink' }, { id: 'other', label: 'Other' }],
    categories: [
      { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
      { id: 'alcohol', label: 'Alcohol', groupId: 'food-drink' },
      { id: 'uncategorised', label: 'Uncategorised', groupId: 'other' },
      { id: 'income', label: 'Income', groupId: 'other' }
    ]
  },
  budgets: [
    { id: 'b1', categoryId: 'groceries', amount: 500, effectiveFrom: '2026-08' }
  ],
  transactions: [
    { id: 't1', date: '2026-08-05', amount: -200, categoryId: 'groceries', excluded: false }
  ]
};

test('shows a row for every assignable category', () => {
  const html = renderBudgets(SNAPSHOT, { month: '2026-08' });
  assert.match(html, /Groceries/);
  assert.match(html, /Alcohol/);
});

test('never shows income or uncategorised', () => {
  const html = renderBudgets(SNAPSHOT, { month: '2026-08' });
  assert.doesNotMatch(html, /data-budget-category="income"/);
  assert.doesNotMatch(html, /data-budget-category="uncategorised"/);
});

test('a budgeted category shows allocation, spend, status and the available balance', () => {
  const html = renderBudgets(SNAPSHOT, { month: '2026-08' });
  assert.match(html, /\$500\.00 budgeted/);
  assert.match(html, /\$200\.00 spent/);
  assert.match(html, /budget-status-on-track/);
  assert.match(html, /\$300\.00/); // 500 - 200 available
});

test('an unbudgeted category shows an Add budget prompt', () => {
  const html = renderBudgets(SNAPSHOT, { month: '2026-08' });
  assert.match(html, /No budget set/);
  assert.match(html, /data-budget-action="add" data-category-id="alcohol"/);
});

test('the editing category shows an input pre-filled with its current allocation', () => {
  const html = renderBudgets(SNAPSHOT, { month: '2026-08', editing: 'groceries' });
  assert.match(html, /data-budget-input/);
  assert.match(html, /value="500"/);
  assert.match(html, /data-budget-action="save" data-category-id="groceries"/);
  assert.match(html, /data-budget-action="cancel" data-category-id="groceries"/);
});

test('editing an unbudgeted category starts the input at 0', () => {
  const html = renderBudgets(SNAPSHOT, { month: '2026-08', editing: 'alcohol' });
  assert.match(html, /data-budget-input/);
  assert.match(html, /value="0"/);
});

test('groups categories under their group label', () => {
  const html = renderBudgets(SNAPSHOT, { month: '2026-08' });
  assert.match(html, /Food &amp; Drink/);
});

test('escapes category and group labels', () => {
  const nasty = {
    ...SNAPSHOT,
    categories: {
      groups: [{ id: 'g', label: '<script>x</script>' }],
      categories: [{ id: 'c', label: '<img src=x>', groupId: 'g' }]
    },
    budgets: []
  };
  const html = renderBudgets(nasty, { month: '2026-08' });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.doesNotMatch(html, /<img src=x>/);
});

test('references no external host', () => {
  assert.doesNotMatch(renderBudgets(SNAPSHOT, { month: '2026-08' }), /https?:\/\/(?!127\.0\.0\.1|localhost)/);
});
