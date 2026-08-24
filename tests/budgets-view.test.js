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
  const html = renderBudgets(SNAPSHOT, { month: '2026-08', editing: { scope: 'category', id: 'groceries' } });
  assert.match(html, /data-budget-input/);
  assert.match(html, /value="500"/);
  assert.match(html, /data-budget-action="save" data-category-id="groceries"/);
  assert.match(html, /data-budget-action="cancel" data-category-id="groceries"/);
});

test('editing an unbudgeted category starts the input at 0', () => {
  const html = renderBudgets(SNAPSHOT, { month: '2026-08', editing: { scope: 'category', id: 'alcohol' } });
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

test('rows carry data-budgeted reflecting whether the category has a budget', () => {
  const html = renderBudgets(SNAPSHOT, { month: '2026-08' });
  assert.match(html, /data-budget-category="groceries" data-budgeted="true"/);
  assert.match(html, /data-budget-category="alcohol" data-budgeted="false"/);
});

// --- Group budgets ---

const GROUP_BUDGETED = {
  ...SNAPSHOT,
  budgets: [
    ...SNAPSHOT.budgets,
    { id: 'g1', groupId: 'food-drink', amount: 400, effectiveFrom: '2026-08' }
  ]
};

test('an unbudgeted group shows an "Add group budget" prompt on its header row', () => {
  const html = renderBudgets(SNAPSHOT, { month: '2026-08' });
  assert.match(html, /No group budget/);
  assert.match(html, /data-budget-action="add" data-group-id="food-drink">Add group budget/);
});

test('a budgeted group shows allocation, spend, status and available on its header row', () => {
  const html = renderBudgets(GROUP_BUDGETED, { month: '2026-08' });
  assert.match(html, /data-budget-group="food-drink" data-budgeted="true"/);
  assert.match(html, /\$400\.00 budgeted/);
  assert.match(html, /\$200\.00 spent/); // groceries' $200, same transaction the category row also sees
});

test('editing the group shows an input pre-filled with its current allocation', () => {
  const html = renderBudgets(GROUP_BUDGETED, { month: '2026-08', editing: { scope: 'group', id: 'food-drink' } });
  assert.match(html, /data-budget-input/);
  assert.match(html, /value="400"/);
  assert.match(html, /data-budget-action="save" data-group-id="food-drink"/);
});

test('editing the group does not also put a category row into edit mode, and vice versa', () => {
  const groupEditing = renderBudgets(GROUP_BUDGETED, { month: '2026-08', editing: { scope: 'group', id: 'food-drink' } });
  // Groceries' own row must still show its normal (non-editing) budgeted state.
  assert.match(groupEditing, /data-budget-category="groceries" data-budgeted="true"/);
  assert.doesNotMatch(groupEditing, /data-budget-action="save" data-category-id="groceries"/);

  const categoryEditing = renderBudgets(GROUP_BUDGETED, { month: '2026-08', editing: { scope: 'category', id: 'groceries' } });
  assert.match(categoryEditing, /data-budget-group="food-drink" data-budgeted="true"/);
  assert.doesNotMatch(categoryEditing, /data-budget-action="save" data-group-id="food-drink"/);
});

test('a group budget renders independently of a category budget inside it — figures do not leak between them', () => {
  const html = renderBudgets(GROUP_BUDGETED, { month: '2026-08' });
  // Groceries: $500 budgeted, $200 spent (its own row).
  // Food & Drink group: $400 budgeted, $200 spent (its own row) — same
  // transaction counted once each, on two independent rows, not summed.
  const groupRowMatch = html.match(/<tr class="group-row"[^>]*>[\s\S]*?<\/tr>/);
  assert.match(groupRowMatch[0], /\$400\.00 budgeted/);
  assert.match(groupRowMatch[0], /\$200\.00 spent/);
});

test('the "other" group (income/uncategorised only) never gets a header row', () => {
  const html = renderBudgets(SNAPSHOT, { month: '2026-08' });
  assert.doesNotMatch(html, /data-budget-group="other"/);
});
