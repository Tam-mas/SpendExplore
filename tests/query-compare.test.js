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

// --- Finding 1: derived measures cannot be averaged across windows ---

// July: one $100 groceries txn (avg $100). June: ten $10 groceries txns
// (avg $10). True combined average across both windows is 200/11 ≈ 18.18 —
// NOT the mean of the two per-window averages (which would be 55).
const AVG_SNAPSHOT = {
  categories: CATEGORIES,
  accounts: [],
  transactions: [
    ...Array.from({ length: 10 }, (_, i) =>
      t({ id: `jun${i}`, date: `2026-06-${String(i + 1).padStart(2, '0')}`, amount: -10, categoryId: 'groceries' })
    ),
    t({ id: 'jul1', date: '2026-07-15', amount: -100, categoryId: 'groceries' }),
    t({ id: 'aug1', date: '2026-08-10', amount: -50, categoryId: 'groceries' })
  ]
};

test('avg baseline is the true combined average (Σtotal/Σcount), not the mean of per-window averages', () => {
  const result = compareQuery(
    AVG_SNAPSHOT,
    { filters: { dateFrom: '2026-08-01', dateTo: '2026-08-31' }, sliceBy: 'category', measure: 'avg' },
    'trailing3'
  );
  const groceries = rowFor(result, 'groceries');
  // Buggy mean-of-per-window-averages would give -55; true combined is -200/11.
  assert.equal(groceries.baseline, -18.18);
});

test('median measure returns no baseline at all — a combined median cannot be reconstructed from per-window aggregates', () => {
  const result = compareQuery(SNAPSHOT, august('median'), 'trailing3');
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

// --- Finding 2: spec.limit corrupts the join ---

const LIMIT_GROUPS = { groups: [{ id: 'g', label: 'G' }] };
const withLimitCategories = (ids) => ({
  groups: LIMIT_GROUPS.groups,
  categories: ids.map((id) => ({ id, label: id, groupId: 'g' }))
});

// July (baseline): big1 -500, big2 -400, small -50 — small ranks 3rd and
// would be truncated out of July's own top-2 if the baseline query reused
// spec.limit. August (current): small -30, other -10 — only two categories,
// so current's own limit:2 truncates nothing here.
const LIMIT_SNAPSHOT_1 = {
  categories: withLimitCategories(['big1', 'big2', 'small', 'other']),
  accounts: [],
  transactions: [
    t({ id: 'b1', date: '2026-07-05', amount: -500, categoryId: 'big1' }),
    t({ id: 'b2', date: '2026-07-06', amount: -400, categoryId: 'big2' }),
    t({ id: 'b3', date: '2026-07-07', amount: -50, categoryId: 'small' }),
    t({ id: 'c1', date: '2026-08-05', amount: -30, categoryId: 'small' }),
    t({ id: 'c2', date: '2026-08-06', amount: -10, categoryId: 'other' })
  ]
};

test('a baseline window truncated by spec.limit does not falsely mark a real category as new', () => {
  const result = compareQuery(
    LIMIT_SNAPSHOT_1,
    { filters: { dateFrom: '2026-08-01', dateTo: '2026-08-31' }, sliceBy: 'category', measure: 'sum', limit: 2 },
    'prevPeriod'
  );
  const small = rowFor(result, 'small');
  assert.ok(small, 'small should still be a displayed current row');
  assert.equal(small.baseline, -50);
  assert.equal(small.isNew, false);
});

// August (current): bigA -500, bigB -400, target -50 — target ranks 3rd and
// is truncated out of the DISPLAYED current rows by limit:2. July (baseline):
// target -60 — real spend, so target still exists now, just isn't shown.
const LIMIT_SNAPSHOT_2 = {
  categories: withLimitCategories(['bigA', 'bigB', 'target']),
  accounts: [],
  transactions: [
    t({ id: 'd1', date: '2026-08-05', amount: -500, categoryId: 'bigA' }),
    t({ id: 'd2', date: '2026-08-06', amount: -400, categoryId: 'bigB' }),
    t({ id: 'd3', date: '2026-08-07', amount: -50, categoryId: 'target' }),
    t({ id: 'e1', date: '2026-07-05', amount: -60, categoryId: 'target' })
  ]
};

test('a current-window category truncated by spec.limit is not reported as disappeared', () => {
  const result = compareQuery(
    LIMIT_SNAPSHOT_2,
    { filters: { dateFrom: '2026-08-01', dateTo: '2026-08-31' }, sliceBy: 'category', measure: 'sum', limit: 2 },
    'prevPeriod'
  );
  assert.equal(rowFor(result, 'target'), undefined, 'target should be truncated out of the displayed rows');
  assert.equal(
    result.disappeared.find((d) => d.key === 'target'),
    undefined,
    'target still exists this period — just not displayed — so it must not be reported as disappeared'
  );
});

// --- Final review C1/I2: a time slice's key IS the period, so a key-based
// join against an earlier, non-overlapping window can never match. ---

test('C1: sliceBy month never fabricates a baseline — key spaces are disjoint by construction', () => {
  const result = compareQuery(
    SNAPSHOT,
    { filters: { dateFrom: '2026-08-01', dateTo: '2026-08-31' }, sliceBy: 'month', measure: 'sum' },
    'trailing3'
  );
  assert.equal(result.baselineAvailable, false);
  assert.equal(result.baselineTotal, null);
  assert.deepEqual(result.baselineWindows, []);
  assert.deepEqual(result.disappeared, []);
  assert.ok(result.rows.length > 0);
  for (const row of result.rows) {
    assert.equal(row.baseline, null);
    assert.equal(row.delta, null);
    assert.equal(row.deltaPct, null);
    assert.equal(row.isNew, false);
  }
});

test('C1: sliceBy week never fabricates a baseline either', () => {
  const result = compareQuery(
    SNAPSHOT,
    { filters: { dateFrom: '2026-08-01', dateTo: '2026-08-31' }, sliceBy: 'week', measure: 'sum' },
    'prevPeriod'
  );
  assert.equal(result.baselineAvailable, false);
  for (const row of result.rows) {
    assert.equal(row.baseline, null);
    assert.equal(row.delta, null);
    assert.equal(row.deltaPct, null);
  }
});

// --- Final review C2: earliestDate must respect the spec's own filters,
// not scan every transaction in the ledger unconditionally. ---

test('C2: a baseline window before a filtered account existed is excluded, not averaged in as zero', () => {
  const snap = {
    categories: CATEGORIES,
    accounts: [],
    transactions: [
      ...SNAPSHOT.transactions,
      // Account "b" only has history from July onward.
      t({ id: 'b1', date: '2026-07-15', amount: -200, accountId: 'b', categoryId: 'groceries' }),
      t({ id: 'b2', date: '2026-08-15', amount: -300, accountId: 'b', categoryId: 'groceries' })
    ]
  };
  const result = compareQuery(
    snap,
    { filters: { accountIds: ['b'], dateFrom: '2026-08-01', dateTo: '2026-08-31' }, sliceBy: 'category', measure: 'sum' },
    'trailing3'
  );
  // June predates account b's own history and must not be counted, even
  // though account "a" has June data — the spec filters to "b" only.
  assert.equal(result.baselineWindows.length, 1);
  const groceries = rowFor(result, 'groceries');
  assert.equal(groceries.baseline, -200);
  assert.equal(groceries.delta, 100);
  assert.equal(groceries.deltaPct, 0.5); // truth: 200 -> 300 is +50%, not +200%
});

test('C2: earliestDate ignores income and excluded rows the display never shows', () => {
  const snap = {
    categories: CATEGORIES,
    accounts: [],
    transactions: [
      t({ id: 'inc1', date: '2026-01-05', amount: 5000, categoryId: 'income' }),
      t({ id: 'y1', date: '2026-07-10', amount: -200, categoryId: 'groceries' }),
      t({ id: 'a1', date: '2026-08-10', amount: -300, categoryId: 'groceries' })
    ]
  };
  const result = compareQuery(
    snap,
    { filters: { dateFrom: '2026-08-01', dateTo: '2026-08-31' }, sliceBy: 'category', measure: 'sum' },
    'trailing3'
  );
  // Only July has any queryable (non-income) spend history, so June and May
  // must be excluded — the January income row must not stand in for it.
  assert.equal(result.baselineWindows.length, 1);
  const groceries = rowFor(result, 'groceries');
  assert.equal(groceries.baseline, -200);
  assert.equal(groceries.deltaPct, 0.5); // truth: 200 -> 300 is +50%, not +350%
});
