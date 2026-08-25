import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRecurring, CADENCES } from '../lib/recurring.js';

const t = (over) => ({
  id: 'x', date: '2026-08-10', amount: -10, rawDescription: 'R', merchant: 'M',
  accountId: 'a', cardSuffix: null, categoryId: 'subscriptions', categorySource: 'rule',
  excluded: false, importId: 'i', note: null, ...over
});

const monthly = (merchant, amount, months, categoryId = 'subscriptions') =>
  months.map((month, i) => t({
    id: `${merchant}-${i}`, merchant, amount, categoryId, date: `${month}-15`
  }));

const TODAY = '2026-08-24';

const snapshotOf = (transactions) => ({
  transactions,
  accounts: [],
  recurring: [],
  categories: {
    groups: [{ id: 'lifestyle', label: 'Lifestyle' }, { id: 'home', label: 'Home' }],
    categories: [
      { id: 'subscriptions', label: 'Subscriptions', groupId: 'lifestyle' },
      { id: 'energy', label: 'Energy', groupId: 'home' },
      { id: 'groceries', label: 'Groceries', groupId: 'lifestyle' },
      { id: 'income', label: 'Income', groupId: 'other' }
    ]
  }
});

const find = (result, merchant) => result.series.find((s) => s.merchant === merchant);

test('a monthly subscription is detected with its annualised cost', () => {
  const result = detectRecurring(
    snapshotOf(monthly('Netflix', -16.99, ['2026-05', '2026-06', '2026-07', '2026-08'])),
    { today: TODAY }
  );
  const netflix = find(result, 'Netflix');
  assert.equal(netflix.cadence, 'monthly');
  assert.equal(netflix.occurrences, 4);
  assert.equal(netflix.typicalAmount, 16.99);
  assert.equal(netflix.amountKind, 'fixed');
  assert.equal(netflix.confidence, 'high');
  // A monthly subscription is billed 12 times a year: 16.99 * 12.
  assert.equal(netflix.annualCost, 203.88);
  assert.equal(netflix.monthlyCost, 16.99);
});

test('costs are positive magnitudes, never the ledger sign', () => {
  const result = detectRecurring(
    snapshotOf(monthly('Netflix', -16.99, ['2026-05', '2026-06', '2026-07', '2026-08'])),
    { today: TODAY }
  );
  const netflix = find(result, 'Netflix');
  assert.ok(netflix.typicalAmount > 0);
  assert.ok(netflix.monthlyCost > 0);
  assert.ok(result.committedMonthly > 0);
});

test('committedMonthly is the sum of every ACTIVE series', () => {
  const result = detectRecurring(snapshotOf([
    ...monthly('Netflix', -16.99, ['2026-06', '2026-07', '2026-08']),
    ...monthly('Spotify', -13.99, ['2026-06', '2026-07', '2026-08'])
  ]), { today: TODAY });
  assert.equal(result.series.length, 2);
  assert.equal(result.committedMonthly, 30.98);
  assert.equal(result.committedAnnual, 371.76);
});

test('a series whose next charge is long overdue is dormant and excluded from the commitment', () => {
  const result = detectRecurring(snapshotOf([
    ...monthly('Netflix', -16.99, ['2026-06', '2026-07', '2026-08']),
    ...monthly('OldGym', -60, ['2026-01', '2026-02', '2026-03'])
  ]), { today: TODAY });

  const gym = find(result, 'OldGym');
  assert.equal(gym.status, 'dormant');
  assert.ok(gym.missedPeriods >= 4, `expected several missed periods, got ${gym.missedPeriods}`);
  // A cancelled gym must not inflate what you are committed to.
  assert.equal(result.committedMonthly, 16.99);
});

// Dormancy boundary: nextExpected = lastDate + round(cadence.days) days.
// For monthly (days 30.44), round(30.44) = 30, so 2026-01-15 + 30 = 2026-02-14.
// grace = max(3, 30.44 * 0.25) = 7.61, and the switch to dormant happens when
// overdueDays (today - nextExpected) exceeds that grace, not merely reaches it.
test('a monthly series just inside the grace period stays active with no missed periods', () => {
  const result = detectRecurring(snapshotOf(
    monthly('Boundary', -20, ['2025-11', '2025-12', '2026-01'])
  ), { today: '2026-02-21' }); // nextExpected + 7 days; 7 <= grace (7.61)

  const series = find(result, 'Boundary');
  assert.equal(series.status, 'active');
  assert.equal(series.missedPeriods, 0);
});

test('a monthly series just past the grace period becomes dormant', () => {
  const result = detectRecurring(snapshotOf(
    monthly('Boundary', -20, ['2025-11', '2025-12', '2026-01'])
  ), { today: '2026-02-22' }); // nextExpected + 8 days; 8 > grace (7.61)

  const series = find(result, 'Boundary');
  assert.equal(series.status, 'dormant');
  assert.equal(series.missedPeriods, 1);
});

test('a price rise is reported with the date it took effect', () => {
  const result = detectRecurring(snapshotOf([
    t({ id: 'n1', merchant: 'Netflix', amount: -16.99, date: '2026-05-15' }),
    t({ id: 'n2', merchant: 'Netflix', amount: -16.99, date: '2026-06-15' }),
    t({ id: 'n3', merchant: 'Netflix', amount: -18.99, date: '2026-07-15' }),
    t({ id: 'n4', merchant: 'Netflix', amount: -18.99, date: '2026-08-15' })
  ]), { today: TODAY });

  const netflix = find(result, 'Netflix');
  assert.equal(netflix.amountKind, 'stepped');
  assert.deepEqual(netflix.priceChange, { from: 16.99, to: 18.99, date: '2026-07-15' });
  // The commitment uses the NEW price.
  assert.equal(netflix.typicalAmount, 18.99);
});

test('a variable quarterly bill is detected as one commitment, not split by amount', () => {
  const result = detectRecurring(snapshotOf([
    t({ id: 'e1', merchant: 'AGL', amount: -180, categoryId: 'energy', date: '2025-11-01' }),
    t({ id: 'e2', merchant: 'AGL', amount: -260, categoryId: 'energy', date: '2026-02-01' }),
    t({ id: 'e3', merchant: 'AGL', amount: -195, categoryId: 'energy', date: '2026-05-01' }),
    t({ id: 'e4', merchant: 'AGL', amount: -240, categoryId: 'energy', date: '2026-08-01' })
  ]), { today: TODAY });

  const agl = find(result, 'AGL');
  assert.equal(agl.cadence, 'quarterly');
  assert.equal(agl.amountKind, 'variable');
  assert.equal(agl.priceChange, null);
  assert.equal(agl.minAmount, 180);
  assert.equal(agl.maxAmount, 260);
});

test('irregular shopping is not reported as recurring', () => {
  const result = detectRecurring(snapshotOf([
    t({ id: 'c1', merchant: 'Coles', amount: -84.2, categoryId: 'groceries', date: '2026-08-02' }),
    t({ id: 'c2', merchant: 'Coles', amount: -21.9, categoryId: 'groceries', date: '2026-08-05' }),
    t({ id: 'c3', merchant: 'Coles', amount: -110.4, categoryId: 'groceries', date: '2026-08-19' })
  ]), { today: TODAY });
  assert.equal(find(result, 'Coles'), undefined);
});

test('two occurrences are never enough on their own', () => {
  const result = detectRecurring(
    snapshotOf(monthly('Newsletter', -5, ['2026-07', '2026-08'])),
    { today: TODAY }
  );
  assert.equal(result.series.length, 0);
});

test('excluded, income and transfer transactions are ignored', () => {
  const result = detectRecurring(snapshotOf([
    ...monthly('Salary', 4000, ['2026-06', '2026-07', '2026-08'], 'income'),
    ...monthly('Hidden', -500, ['2026-06', '2026-07', '2026-08']).map((x) => ({ ...x, excluded: true })),
    // A standing transfer to savings is a real commitment, but it is not
    // SPEND — and this tab's headline number sits beside "Total spend",
    // which excludes transfers. Counting it here would make the two figures
    // mean different things.
    ...monthly('Savings Transfer', -500, ['2026-06', '2026-07', '2026-08'], 'transfers')
  ]), { today: TODAY });
  assert.equal(result.series.length, 0);
});

test('nextExpected is one cadence after the last charge', () => {
  const result = detectRecurring(
    snapshotOf(monthly('Netflix', -16.99, ['2026-06', '2026-07', '2026-08'])),
    { today: TODAY }
  );
  assert.equal(find(result, 'Netflix').nextExpected, '2026-09-14');
});

test('series are ordered by annual cost, most expensive first', () => {
  const result = detectRecurring(snapshotOf([
    ...monthly('Spotify', -13.99, ['2026-06', '2026-07', '2026-08']),
    ...monthly('Netflix', -18.99, ['2026-06', '2026-07', '2026-08'])
  ]), { today: TODAY });
  assert.deepEqual(result.series.map((s) => s.merchant), ['Netflix', 'Spotify']);
});

test('confidence drops to medium on a thin or skipped series', () => {
  const result = detectRecurring(
    snapshotOf(monthly('Thin', -9, ['2026-06', '2026-07', '2026-08'])),
    { today: TODAY }
  );
  assert.equal(find(result, 'Thin').confidence, 'medium');
});

test('cadences that divide the year cleanly annualise exactly, with no rounding drift', () => {
  // Guards the double-rounding this originally had (typical -> monthly ->
  // x12), which left quarterly and annual bills cents away from what is
  // actually charged.
  const quarterly = detectRecurring(snapshotOf([
    t({ id: 'q1', merchant: 'Water', amount: -300, date: '2025-11-01' }),
    t({ id: 'q2', merchant: 'Water', amount: -300, date: '2026-02-01' }),
    t({ id: 'q3', merchant: 'Water', amount: -300, date: '2026-05-01' }),
    t({ id: 'q4', merchant: 'Water', amount: -300, date: '2026-08-01' })
  ]), { today: TODAY });
  assert.equal(find(quarterly, 'Water').annualCost, 1200);
  assert.equal(find(quarterly, 'Water').monthlyCost, 100);

  const annual = detectRecurring(snapshotOf([
    t({ id: 'y1', merchant: 'Insurance', amount: -1200, date: '2024-03-01' }),
    t({ id: 'y2', merchant: 'Insurance', amount: -1200, date: '2025-03-01' }),
    t({ id: 'y3', merchant: 'Insurance', amount: -1200, date: '2026-03-01' })
  ]), { today: TODAY });
  assert.equal(find(annual, 'Insurance').annualCost, 1200);
  assert.equal(find(annual, 'Insurance').monthlyCost, 100);
});

test('every cadence states its own periods per year rather than deriving it from days', () => {
  const byId = Object.fromEntries(CADENCES.map((c) => [c.id, c.perYear]));
  assert.equal(byId.monthly, 12);
  assert.equal(byId.quarterly, 4);
  assert.equal(byId.annual, 1);
});
