import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetStatus, allBudgetStatuses, currentMonthKey } from '../lib/budgets.js';

const t = (over) => ({
  id: 'x', date: '2026-08-10', amount: -10, rawDescription: 'R', merchant: 'M',
  accountId: 'a', cardSuffix: null, categoryId: 'travel', categorySource: 'rule',
  excluded: false, importId: 'i', note: null, ...over
});

const SNAPSHOT = {
  budgets: [
    { id: 'b1', categoryId: 'travel', amount: 500, effectiveFrom: '2026-06' },
    { id: 'b2', categoryId: 'travel', amount: 600, effectiveFrom: '2026-08' }
  ],
  transactions: [
    t({ id: '1', date: '2026-06-05', amount: -100 }),
    // July: deliberately no transactions at all — a gap month.
    t({ id: '3', date: '2026-08-01', amount: -700 })
  ]
};

test('currentMonthKey returns a YYYY-MM string', () => {
  assert.match(currentMonthKey(), /^\d{4}-\d{2}$/);
});

test('allocation lookup picks the latest entry at or before the queried month', () => {
  assert.equal(budgetStatus(SNAPSHOT, 'travel', '2026-06').allocation, 500);
  assert.equal(budgetStatus(SNAPSHOT, 'travel', '2026-07').allocation, 500);
  assert.equal(budgetStatus(SNAPSHOT, 'travel', '2026-08').allocation, 600);
});

test('envelope balance accumulates across months, including a gap month with no spend', () => {
  const status = budgetStatus(SNAPSHOT, 'travel', '2026-08');
  // Jun: 500-100=400. Jul (gap, zero spend): 500-0=500. Aug: 600-700=-100. Total: 800.
  assert.equal(status.balance, 800);
});

test('spend is reported as a positive magnitude, not the ledger signed amount', () => {
  assert.equal(budgetStatus(SNAPSHOT, 'travel', '2026-08').spend, 700);
});

test('status is on-track when the month spend is within its own allocation', () => {
  assert.equal(budgetStatus(SNAPSHOT, 'travel', '2026-06').status, 'on-track');
});

test('status is covered when over the month allocation but the envelope is still positive', () => {
  const status = budgetStatus(SNAPSHOT, 'travel', '2026-08');
  assert.ok(status.spend > status.allocation);
  assert.equal(status.status, 'covered');
});

test('status is over when the envelope itself goes negative', () => {
  const heavy = {
    budgets: [{ id: 'b1', categoryId: 'travel', amount: 500, effectiveFrom: '2026-06' }],
    transactions: [t({ id: '1', date: '2026-06-05', amount: -5000 })]
  };
  const status = budgetStatus(heavy, 'travel', '2026-06');
  assert.equal(status.status, 'over');
  assert.ok(status.balance < 0);
});

test('a $0 budget still distinguishes covered from over via the envelope', () => {
  const paused = {
    budgets: [
      { id: 'b1', categoryId: 'travel', amount: 500, effectiveFrom: '2026-06' },
      { id: 'b2', categoryId: 'travel', amount: 0, effectiveFrom: '2026-07' }
    ],
    transactions: [
      t({ id: '1', date: '2026-06-05', amount: -50 }),  // leaves 450 rolling into July
      t({ id: '2', date: '2026-07-10', amount: -20 })   // any spend at all exceeds a $0 allocation
    ]
  };
  const status = budgetStatus(paused, 'travel', '2026-07');
  assert.equal(status.allocation, 0);
  assert.equal(status.spend, 20);
  assert.equal(status.status, 'covered'); // still covered by the 450 rolled forward from June
});

test('a category never budgeted returns null', () => {
  assert.equal(budgetStatus(SNAPSHOT, 'groceries', '2026-08'), null);
});

test('a month before the first budget entry returns null', () => {
  assert.equal(budgetStatus(SNAPSHOT, 'travel', '2026-05'), null);
});

test('spend before the first budget entry is excluded from the envelope entirely', () => {
  const withPriorSpend = {
    budgets: [{ id: 'b1', categoryId: 'travel', amount: 500, effectiveFrom: '2026-08' }],
    transactions: [
      t({ id: 'old', date: '2026-01-05', amount: -9000 }), // long before the budget existed
      t({ id: 'new', date: '2026-08-05', amount: -100 })
    ]
  };
  const status = budgetStatus(withPriorSpend, 'travel', '2026-08');
  assert.equal(status.balance, 400); // 500 - 100; the -9000 in January never counted
});

test('excluded transactions do not count as spend', () => {
  const withExcluded = {
    budgets: [{ id: 'b1', categoryId: 'travel', amount: 500, effectiveFrom: '2026-08' }],
    transactions: [t({ id: 'e', date: '2026-08-05', amount: -9000, excluded: true })]
  };
  const status = budgetStatus(withExcluded, 'travel', '2026-08');
  assert.equal(status.spend, 0);
  assert.equal(status.balance, 500);
});

test('allBudgetStatuses returns one row per budgeted category', () => {
  const rows = allBudgetStatuses(SNAPSHOT, '2026-08');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].categoryId, 'travel');
  assert.equal(rows[0].hasAllocationForMonth, true);
});

test('allBudgetStatuses reports hasAllocationForMonth false before the first entry, without throwing', () => {
  const rows = allBudgetStatuses(SNAPSHOT, '2026-01');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hasAllocationForMonth, false);
  assert.equal(rows[0].status, null);
});

test('a snapshot with no budgets at all produces no rows', () => {
  assert.deepEqual(allBudgetStatuses({ budgets: [], transactions: [] }, '2026-08'), []);
});

test('a second edit within the same month wins over the first (last-appended wins on a tie)', () => {
  const snap = {
    budgets: [
      { id: 'a', categoryId: 'travel', amount: 500, effectiveFrom: '2026-08' },
      { id: 'b', categoryId: 'travel', amount: 900, effectiveFrom: '2026-08' }
    ],
    transactions: []
  };
  const status = budgetStatus(snap, 'travel', '2026-08');
  assert.equal(status.allocation, 900);
});

test('a later actual month still wins over an earlier one when they are not a tie', () => {
  const snap = {
    budgets: [
      { id: 'a', categoryId: 'travel', amount: 500, effectiveFrom: '2026-06' },
      { id: 'b', categoryId: 'travel', amount: 600, effectiveFrom: '2026-08' }
    ],
    transactions: []
  };
  assert.equal(budgetStatus(snap, 'travel', '2026-07').allocation, 500); // June's entry still in effect in July
  assert.equal(budgetStatus(snap, 'travel', '2026-08').allocation, 600); // August's entry now in effect
});
