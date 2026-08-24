import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareQuery } from '../lib/query/compare.js';

const t = (over) => ({
  id: 'x', date: '2026-08-10', amount: -10, rawDescription: 'R', merchant: 'M',
  accountId: 'a', cardSuffix: null, categoryId: 'groceries', categorySource: 'rule',
  excluded: false, importId: 'i', note: null, ...over
});

const CATEGORIES = {
  groups: [{ id: 'food-drink', label: 'Food & Drink' }, { id: 'lifestyle', label: 'Lifestyle' }],
  categories: [
    { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
    { id: 'takeaway', label: 'Takeaway', groupId: 'food-drink' },
    { id: 'shopping', label: 'Shopping', groupId: 'lifestyle' }
  ]
};

// Ledger starts 2026-06-10. June: groceries 100, takeaway 50.
// July: groceries 200. August: groceries 300, shopping 40.
const SNAPSHOT = {
  categories: CATEGORIES,
  accounts: [],
  transactions: [
    t({ id: 'j1', date: '2026-06-10', amount: -100, categoryId: 'groceries' }),
    t({ id: 'j2', date: '2026-06-12', amount: -50, categoryId: 'takeaway' }),
    t({ id: 'y1', date: '2026-07-10', amount: -200, categoryId: 'groceries' }),
    t({ id: 'a1', date: '2026-08-10', amount: -300, categoryId: 'groceries' }),
    t({ id: 'a2', date: '2026-08-11', amount: -40, categoryId: 'shopping' })
  ]
};

const august = (measure = 'sum') => ({
  filters: { dateFrom: '2026-08-01', dateTo: '2026-08-31' },
  sliceBy: 'category',
  measure
});

const rowFor = (result, key) => result.rows.find((r) => r.key === key);

test('mode "off" returns the query result with null baseline fields on every row', () => {
  const result = compareQuery(SNAPSHOT, august(), 'off');
  assert.equal(result.baselineAvailable, false);
  assert.equal(result.baselineTotal, null);
  assert.deepEqual(result.disappeared, []);
  assert.equal(result.rows.length, 2);
  for (const row of result.rows) {
    assert.equal(row.baseline, null);
    assert.equal(row.delta, null);
    assert.equal(row.deltaPct, null);
    assert.equal(row.isNew, false);
  }
});

test('prevPeriod compares August against July and reports growth as POSITIVE', () => {
  const result = compareQuery(SNAPSHOT, august(), 'prevPeriod');
  assert.equal(result.baselineAvailable, true);

  const groceries = rowFor(result, 'groceries');
  assert.equal(groceries.value, -300);
  assert.equal(groceries.baseline, -200);
  // Magnitude space: spending 300 against a 200 baseline is +100, +50%.
  assert.equal(groceries.delta, 100);
  assert.equal(groceries.deltaPct, 0.5);
  assert.equal(groceries.isNew, false);
});

test('a bucket absent from every baseline window is flagged isNew with a null deltaPct', () => {
  const shopping = rowFor(compareQuery(SNAPSHOT, august(), 'prevPeriod'), 'shopping');
  assert.equal(shopping.baseline, 0);
  assert.equal(shopping.delta, 40);
  assert.equal(shopping.deltaPct, null);
  assert.equal(shopping.isNew, true);
});

test('trailing3 skips windows that predate the ledger and averages over the rest', () => {
  // Requested: July, June, May. May ends 2026-05-31, before the first
  // transaction on 2026-06-10, so it is missing history rather than a real
  // zero and must not drag the average down.
  const result = compareQuery(SNAPSHOT, august(), 'trailing3');
  assert.equal(result.baselineWindows.length, 2);

  const groceries = rowFor(result, 'groceries');
  assert.equal(groceries.baseline, -150); // (200 + 100) / 2
  assert.equal(groceries.delta, 150);
  assert.equal(groceries.deltaPct, 1);
});

test('a bucket present in only some baseline windows averages over ALL of them', () => {
  // Takeaway appears in June (50) but not July. Across two windows that is an
  // average of 25 — not 50. Dividing by "windows that contained this key"
  // would overstate every intermittent category.
  const result = compareQuery(SNAPSHOT, august(), 'trailing3');
  const gone = result.disappeared.find((d) => d.key === 'takeaway');
  assert.ok(gone, 'takeaway should be reported as disappeared');
  assert.equal(gone.baseline, -25);
  assert.equal(gone.label, 'Takeaway');
});

test('a bucket that vanished is kept OUT of rows so no zero-height bar is drawn', () => {
  const result = compareQuery(SNAPSHOT, august(), 'trailing3');
  assert.equal(rowFor(result, 'takeaway'), undefined);
});

test('grand totals carry their own baseline and delta', () => {
  const result = compareQuery(SNAPSHOT, august(), 'trailing3');
  assert.equal(result.total, -340);
  assert.equal(result.baselineTotal, -175); // July -200, June -150
  assert.equal(result.baselineDelta, 165);
  assert.equal(result.baselineDeltaPct, 0.94);
});

test('baseline is unavailable when every baseline window predates the ledger', () => {
  const spec = { filters: { dateFrom: '2026-06-01', dateTo: '2026-06-30' }, sliceBy: 'category', measure: 'sum' };
  const result = compareQuery(SNAPSHOT, spec, 'prevPeriod');
  assert.equal(result.baselineAvailable, false);
  assert.equal(result.rows[0].baseline, null);
});

test('baseline is unavailable for an unbounded (all-time) window', () => {
  const result = compareQuery(SNAPSHOT, { sliceBy: 'category', measure: 'sum' }, 'trailing3');
  assert.equal(result.baselineAvailable, false);
});

test('pctOfTotal reports a percentage-point delta and never a percentage OF a percentage', () => {
  const result = compareQuery(SNAPSHOT, august('pctOfTotal'), 'prevPeriod');
  const groceries = rowFor(result, 'groceries');
  assert.equal(groceries.deltaPct, null);
  assert.equal(typeof groceries.delta, 'number');
});

test('the count measure compares transaction counts', () => {
  const result = compareQuery(SNAPSHOT, august('count'), 'prevPeriod');
  const groceries = rowFor(result, 'groceries');
  assert.equal(groceries.value, 1);
  assert.equal(groceries.baseline, 1);
  assert.equal(groceries.delta, 0);
});
