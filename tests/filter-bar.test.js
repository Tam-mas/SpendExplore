import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterOptions, renderFilterBar, toQueryFilters } from '../web/filter-bar.js';
import { BASELINE_LABELS } from '../lib/query/periods.js';

const SNAPSHOT = {
  categories: {
    groups: [{ id: 'food-drink', label: 'Food & Drink' }, { id: 'transport', label: 'Transport' }],
    categories: [
      { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
      { id: 'fuel', label: 'Fuel', groupId: 'transport' }
    ]
  },
  accounts: [
    { id: 'spending', label: 'Joint spending', cardOwners: { '4321': 'Alex', '8765': 'Sam' } },
    { id: 'card', label: 'Credit card', cardOwners: {} }
  ],
  transactions: [
    { id: 'a', date: '2026-06-15', amount: -10, categoryId: 'groceries', accountId: 'spending', cardSuffix: '4321', merchant: 'C', excluded: false },
    { id: 'b', date: '2026-08-15', amount: -20, categoryId: 'fuel', accountId: 'card', cardSuffix: null, merchant: 'B', excluded: false }
  ]
};

test('month options span the ledger date range, newest first', () => {
  const { months } = filterOptions(SNAPSHOT);
  assert.deepEqual(months.map((m) => m.value), ['2026-08', '2026-07', '2026-06']);
  assert.equal(months[0].label, 'Aug 2026');
});

test('month options are empty for an empty ledger', () => {
  assert.deepEqual(filterOptions({ ...SNAPSHOT, transactions: [] }).months, []);
});

test('account options come from the accounts collection', () => {
  const { accounts } = filterOptions(SNAPSHOT);
  assert.deepEqual(accounts.map((a) => a.value).sort(), ['card', 'spending']);
});

test('people options include every card owner plus Joint', () => {
  const { people } = filterOptions(SNAPSHOT);
  assert.deepEqual(people.map((p) => p.value).sort(), ['Alex', 'Joint', 'Sam']);
});

test('people is just Joint when no card owners are configured', () => {
  const bare = { ...SNAPSHOT, accounts: [{ id: 'spending', label: 'S', cardOwners: {} }] };
  assert.deepEqual(filterOptions(bare).people.map((p) => p.value), ['Joint']);
});

test('group options come from the taxonomy', () => {
  assert.deepEqual(filterOptions(SNAPSHOT).groups.map((g) => g.value), ['food-drink', 'transport']);
});

test('renderFilterBar emits a control per dimension', () => {
  const html = renderFilterBar(SNAPSHOT, {});
  for (const name of ['month', 'accountIds', 'people', 'groupIds']) {
    assert.match(html, new RegExp(`data-filter="${name}"`), name);
  }
});

test('renderFilterBar marks the active month as selected', () => {
  const html = renderFilterBar(SNAPSHOT, { month: '2026-08' });
  assert.match(html, /value="2026-08" selected/);
});

test('renderFilterBar offers an all-time option', () => {
  assert.match(renderFilterBar(SNAPSHOT, {}), /All time/);
});

test('renderFilterBar escapes account labels', () => {
  const nasty = { ...SNAPSHOT, accounts: [{ id: 'x', label: '<b>x</b>', cardOwners: {} }] };
  assert.doesNotMatch(renderFilterBar(nasty, {}), /<b>x<\/b>/);
});

test('renderFilterBar references no external host', () => {
  assert.doesNotMatch(renderFilterBar(SNAPSHOT, {}), /https?:\/\/(?!127\.0\.0\.1|localhost)/);
});

const SNAPSHOT_FOR_COMPARE = {
  transactions: [{ date: '2026-08-10' }],
  accounts: [],
  categories: { groups: [{ id: 'food-drink', label: 'Food & Drink' }], categories: [] }
};

test('the filter bar renders a comparison control with every baseline mode', () => {
  const html = renderFilterBar(SNAPSHOT_FOR_COMPARE, {}, 'off');
  assert.match(html, /data-filter="compare"/);
  for (const label of Object.values(BASELINE_LABELS)) {
    assert.ok(html.includes(label), `missing option: ${label}`);
  }
});

test('the comparison control marks the current mode as selected', () => {
  const html = renderFilterBar(SNAPSHOT_FOR_COMPARE, {}, 'trailing3');
  assert.match(html, /value="trailing3" selected/);
  assert.equal(/value="prevPeriod" selected/.test(html), false);
});

test('the comparison control defaults to off when given an unknown mode', () => {
  const html = renderFilterBar(SNAPSHOT_FOR_COMPARE, {}, 'nonsense');
  assert.match(html, /value="off" selected/);
});

test('toQueryFilters never leaks the comparison mode into a query spec', () => {
  const spec = toQueryFilters({ month: '2026-08', compare: 'trailing3' });
  assert.equal(spec.compare, undefined);
  assert.equal(spec.dateFrom, '2026-08-01');
});
