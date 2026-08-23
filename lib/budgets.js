const round2 = (n) => Math.round(n * 100) / 100;

/**
 * The current real-world month as a "YYYY-MM" key, using LOCAL date
 * components — matches server/routes/import.js's `localDay` fix for the
 * same UTC-lag hazard (a UTC-based "now" reads as yesterday, or last
 * month, for most of an Australian working day). Used both as the default
 * month for every function below and, server-side, to stamp a new budget
 * entry's effectiveFrom.
 */
export function currentMonthKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** The budget entry in effect for `categoryId` at `month`: the one with the
 * latest effectiveFrom that is still <= month. On a tie (two entries with
 * the same effectiveFrom — guaranteed whenever a category is edited twice
 * in one month, since the server always stamps "now"), the LATER-APPENDED
 * one wins: budgets.json is append-only, so array order IS edit order, and
 * `>=` here means a later candidate at an equal effectiveFrom replaces the
 * earlier one. `null` if no candidate qualifies at all. */
function allocationEntryFor(budgets, categoryId, month) {
  let best = null;
  for (const b of budgets) {
    if (b.categoryId !== categoryId || b.effectiveFrom > month) continue;
    if (!best || b.effectiveFrom >= best.effectiveFrom) best = b;
  }
  return best;
}

/** Every month from `from` through `to`, inclusive, as "YYYY-MM" keys. */
function monthsBetween(from, to) {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const out = [];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m++) {
    if (m > 12) { m = 1; y++; }
    out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

/** Spend in `categoryId` during `month`, as a POSITIVE magnitude — see the
 * plan's Global Constraints note on sign convention. Permanently-excluded
 * rows never count. */
function spendFor(transactions, categoryId, month) {
  return round2(transactions
    .filter((t) => !t.excluded && t.categoryId === categoryId && t.date.slice(0, 7) === month)
    .reduce((a, t) => a - t.amount, 0));
}

/**
 * Full budget status for one category at one month. `null` when the
 * category has no allocation covering `month` — either never budgeted, or
 * `month` predates its first budget entry.
 */
export function budgetStatus(snapshot, categoryId, month = currentMonthKey()) {
  const budgets = snapshot?.budgets ?? [];
  const transactions = snapshot?.transactions ?? [];
  const entry = allocationEntryFor(budgets, categoryId, month);
  if (!entry) return null;

  const categoryEntries = budgets.filter((b) => b.categoryId === categoryId);
  const first = categoryEntries.reduce(
    (earliest, b) => (b.effectiveFrom < earliest ? b.effectiveFrom : earliest),
    categoryEntries[0].effectiveFrom);

  let balance = 0;
  for (const m of monthsBetween(first, month)) {
    const alloc = allocationEntryFor(budgets, categoryId, m);
    balance += (alloc ? alloc.amount : 0) - spendFor(transactions, categoryId, m);
  }
  balance = round2(balance);

  const allocation = entry.amount;
  const spend = spendFor(transactions, categoryId, month);
  const status = spend <= allocation ? 'on-track' : (balance >= 0 ? 'covered' : 'over');

  return { allocation, spend, balance, status };
}

/**
 * One row per category that has ANY budget history, for `month`.
 * `hasAllocationForMonth` is false only when `month` predates the
 * category's first entry — allocation/spend/balance are 0 and status is
 * null in that case, since there is nothing to report yet.
 */
export function allBudgetStatuses(snapshot, month = currentMonthKey()) {
  const budgets = snapshot?.budgets ?? [];
  const categoryIds = [...new Set(budgets.map((b) => b.categoryId))];
  return categoryIds.map((categoryId) => {
    const status = budgetStatus(snapshot, categoryId, month);
    return status
      ? { categoryId, hasAllocationForMonth: true, ...status }
      : { categoryId, hasAllocationForMonth: false, allocation: 0, spend: 0, balance: 0, status: null };
  });
}
