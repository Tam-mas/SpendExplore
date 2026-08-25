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

// Product decision: committedMonthly/committedAnnual only ever sum HIGH-
// confidence series (see the confidence-gating tests below) — a weak match
// summing into the headline figure is exactly the "coincidence as
// commitment" failure this module exists to avoid. This test previously
// used two 3-occurrence series (medium confidence under the >=4-occurrence
// rule) and asserted their sum was the committed total; it now uses
// 4-occurrence series so it still demonstrates a real committed sum, and is
// renamed to say what it actually pins.
test('committedMonthly is the sum of every ACTIVE, HIGH-confidence series', () => {
  const result = detectRecurring(snapshotOf([
    ...monthly('Netflix', -16.99, ['2026-05', '2026-06', '2026-07', '2026-08']),
    ...monthly('Spotify', -13.99, ['2026-05', '2026-06', '2026-07', '2026-08'])
  ]), { today: TODAY });
  assert.equal(result.series.length, 2);
  assert.equal(find(result, 'Netflix').confidence, 'high');
  assert.equal(find(result, 'Spotify').confidence, 'high');
  assert.equal(result.committedMonthly, 30.98);
  assert.equal(result.committedAnnual, 371.76);
});

test('a medium-confidence active series is detected and listed but excluded from committedMonthly', () => {
  const result = detectRecurring(snapshotOf(
    // Only 3 occurrences: active, but medium confidence.
    monthly('Netflix', -16.99, ['2026-06', '2026-07', '2026-08'])
  ), { today: TODAY });
  const netflix = find(result, 'Netflix');
  assert.equal(netflix.status, 'active');
  assert.equal(netflix.confidence, 'medium');
  assert.equal(result.committedMonthly, 0);
  assert.equal(result.committedAnnual, 0);
  // Still counted, just under the "uncertain" heading instead.
  assert.equal(result.uncertainMonthly, 16.99);
  assert.equal(result.uncertainAnnual, 203.88);
});

test('a series whose next charge is long overdue is dormant and excluded from the commitment', () => {
  const result = detectRecurring(snapshotOf([
    ...monthly('Netflix', -16.99, ['2026-05', '2026-06', '2026-07', '2026-08']),
    ...monthly('OldGym', -60, ['2026-01', '2026-02', '2026-03'])
  ]), { today: TODAY });

  const gym = find(result, 'OldGym');
  assert.equal(gym.status, 'dormant');
  assert.ok(gym.missedPeriods >= 4, `expected several missed periods, got ${gym.missedPeriods}`);
  // A cancelled gym must not inflate what you are committed to.
  assert.equal(result.committedMonthly, 16.99);
});

// Dormancy boundary: nextExpected is now the CALENDAR month after lastDate
// (see the nextExpected fix below), not lastDate + round(cadence.days) days.
// 2026-01-15 + 1 calendar month = 2026-02-15 (Feb 2026 has 28 days, no clamp
// needed). grace = max(3, 30.44 * 0.25) = 7.61, and the switch to dormant
// happens when overdueDays (today - nextExpected) exceeds that grace, not
// merely reaches it. These dates were previously pinned to the OLD
// (day-rounded) nextExpected of 2026-02-14 and had to move by a day to keep
// testing the same boundary condition against the corrected date.
test('a monthly series just inside the grace period stays active with no missed periods', () => {
  const result = detectRecurring(snapshotOf(
    monthly('Boundary', -20, ['2025-11', '2025-12', '2026-01'])
  ), { today: '2026-02-22' }); // nextExpected (02-15) + 7 days; 7 <= grace (7.61)

  const series = find(result, 'Boundary');
  assert.equal(series.status, 'active');
  assert.equal(series.missedPeriods, 0);
});

test('a monthly series just past the grace period becomes dormant', () => {
  const result = detectRecurring(snapshotOf(
    monthly('Boundary', -20, ['2025-11', '2025-12', '2026-01'])
  ), { today: '2026-02-23' }); // nextExpected (02-15) + 8 days; 8 > grace (7.61)

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

// The test's own title says "one cadence after the last charge" but the
// pinned value (2026-09-14) was one day EARLY: it came from
// addDays(lastDate, round(30.44)) = lastDate + 30 days, not from a real
// calendar month. One cadence after 2026-08-15 is 2026-09-15. This is the
// one sanctioned expectation change in this pass — the test's title
// contradicted its own value.
test('nextExpected is one cadence after the last charge', () => {
  const result = detectRecurring(
    snapshotOf(monthly('Netflix', -16.99, ['2026-06', '2026-07', '2026-08'])),
    { today: TODAY }
  );
  assert.equal(find(result, 'Netflix').nextExpected, '2026-09-15');
});

test('nextExpected for a quarterly series advances by three calendar months', () => {
  const result = detectRecurring(snapshotOf([
    t({ id: 'e1', merchant: 'AGL', amount: -180, categoryId: 'energy', date: '2025-11-01' }),
    t({ id: 'e2', merchant: 'AGL', amount: -260, categoryId: 'energy', date: '2026-02-01' }),
    t({ id: 'e3', merchant: 'AGL', amount: -195, categoryId: 'energy', date: '2026-05-01' }),
    t({ id: 'e4', merchant: 'AGL', amount: -240, categoryId: 'energy', date: '2026-08-01' })
  ]), { today: TODAY });
  assert.equal(find(result, 'AGL').nextExpected, '2026-11-01');
});

test('nextExpected for an annual series advances by one calendar year', () => {
  const result = detectRecurring(snapshotOf([
    t({ id: 'y1', merchant: 'Insurance', amount: -1200, date: '2024-03-01' }),
    t({ id: 'y2', merchant: 'Insurance', amount: -1200, date: '2025-03-01' }),
    t({ id: 'y3', merchant: 'Insurance', amount: -1200, date: '2026-03-01' })
  ]), { today: TODAY });
  assert.equal(find(result, 'Insurance').nextExpected, '2027-03-01');
});

test('nextExpected clamps the day of month when the target month is shorter', () => {
  // Last charge on the 31st; a calendar month later is February, which in
  // 2026 has 28 days — the charge must clamp to 2026-02-28, not spill into
  // March.
  const result = detectRecurring(snapshotOf([
    t({ id: 'd1', merchant: 'Clampy', amount: -20, date: '2025-10-31' }),
    t({ id: 'd2', merchant: 'Clampy', amount: -20, date: '2025-11-30' }),
    t({ id: 'd3', merchant: 'Clampy', amount: -20, date: '2025-12-31' }),
    t({ id: 'd4', merchant: 'Clampy', amount: -20, date: '2026-01-31' })
  ]), { today: TODAY });
  assert.equal(find(result, 'Clampy').nextExpected, '2026-02-28');
});

test('nextExpected for weekly and fortnightly cadences still uses day-based arithmetic', () => {
  const weekly = detectRecurring(snapshotOf([
    t({ id: 'w1', merchant: 'Coffee', amount: -5, date: '2026-07-06' }),
    t({ id: 'w2', merchant: 'Coffee', amount: -5, date: '2026-07-13' }),
    t({ id: 'w3', merchant: 'Coffee', amount: -5, date: '2026-07-20' }),
    t({ id: 'w4', merchant: 'Coffee', amount: -5, date: '2026-07-27' })
  ]), { today: TODAY });
  assert.equal(find(weekly, 'Coffee').nextExpected, '2026-08-03');
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

test('committedMonthly is derived from the unrounded pooled annual sum, not by summing already-rounded per-series monthly figures', () => {
  // Three identical weekly commitments. Rounding each series's own monthly
  // share individually before summing (43.48 * 3 = 130.44) drifts further
  // from the (once-rounded) annual total than rounding the pooled annual
  // sum exactly once (130.45) — that's the fix: round once at the total,
  // not once per series plus once at the total.
  const weeklySeries = (merchant, dates) => dates.map((date, i) =>
    t({ id: `${merchant}-${i}`, merchant, amount: -10, date }));
  const dates = ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'];
  const result = detectRecurring(snapshotOf([
    ...weeklySeries('CoffeeA', dates),
    ...weeklySeries('CoffeeB', dates),
    ...weeklySeries('CoffeeC', dates)
  ]), { today: '2026-08-05' }); // nextExpected (08-03) + 2 days, within weekly grace (3)

  assert.equal(result.series.length, 3);
  for (const s of result.series) assert.equal(s.confidence, 'high');
  assert.equal(result.committedAnnual, 1565.37);
  assert.equal(result.committedMonthly, 130.45);
});

test('every cadence states its own periods per year rather than deriving it from days', () => {
  const byId = Object.fromEntries(CADENCES.map((c) => [c.id, c.perYear]));
  assert.equal(byId.monthly, 12);
  assert.equal(byId.quarterly, 4);
  assert.equal(byId.annual, 1);
});
