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

/** The budget entry in effect for `field === id` (e.g. `categoryId: 'travel'`
 * or `groupId: 'food-drink'`) at `month`: the one with the latest
 * effectiveFrom that is still <= month. On a tie (two entries with the same
 * effectiveFrom — guaranteed whenever the same target is edited twice in one
 * month, since the server always stamps "now"), the LATER-APPENDED one wins:
 * budgets.json is append-only, so array order IS edit order, and `>=` here
 * means a later candidate at an equal effectiveFrom replaces the earlier
 * one. `null` if no candidate qualifies at all. */
function allocationEntryFor(budgets, field, id, month) {
  let best = null;
  for (const b of budgets) {
    if (b[field] !== id || b.effectiveFrom > month) continue;
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

/** Spend in category `categoryId` during `month`, as a POSITIVE magnitude —
 * see the plan's Global Constraints note on sign convention.
 * Permanently-excluded rows never count. */
function spendForCategory(transactions, categoryId, month) {
  return round2(transactions
    .filter((t) => !t.excluded && t.categoryId === categoryId && t.date.slice(0, 7) === month)
    .reduce((a, t) => a - t.amount, 0));
}

/** categoryId -> groupId, from the snapshot's category list. Transactions
 * only carry categoryId, so a group's spend has to be resolved through this
 * — every transaction whose category resolves to `groupId` counts, exactly
 * like spendForCategory but summed across every category in the group. */
function categoryGroupMap(snapshot) {
  return new Map((snapshot?.categories?.categories ?? []).map((c) => [c.id, c.groupId]));
}

function spendForGroup(transactions, groupId, month, catGroup) {
  return round2(transactions
    .filter((t) => !t.excluded && catGroup.get(t.categoryId) === groupId && t.date.slice(0, 7) === month)
    .reduce((a, t) => a - t.amount, 0));
}

/**
 * Shared envelope math for one budget target (a category OR a group) at one
 * month. `field`/`id` identify which budget entries belong to this target
 * (e.g. `'categoryId'`/`'travel'`); `spend(month)` computes that target's
 * spend for an arbitrary month. `null` when the target has no allocation
 * covering `month` — either never budgeted, or `month` predates its first
 * budget entry.
 */
function computeStatus(budgets, field, id, month, spend) {
  const entry = allocationEntryFor(budgets, field, id, month);
  if (!entry) return null;

  const ownEntries = budgets.filter((b) => b[field] === id);
  const first = ownEntries.reduce(
    (earliest, b) => (b.effectiveFrom < earliest ? b.effectiveFrom : earliest),
    ownEntries[0].effectiveFrom);

  let balance = 0;
  for (const m of monthsBetween(first, month)) {
    const alloc = allocationEntryFor(budgets, field, id, m);
    balance += (alloc ? alloc.amount : 0) - spend(m);
  }
  balance = round2(balance);

  const allocation = entry.amount;
  const spendThisMonth = spend(month);
  const status = spendThisMonth <= allocation ? 'on-track' : (balance >= 0 ? 'covered' : 'over');

  return { allocation, spend: spendThisMonth, balance, status };
}

/**
 * Full budget status for one category at one month — see computeStatus for
 * the shared envelope/rollover math.
 */
export function budgetStatus(snapshot, categoryId, month = currentMonthKey()) {
  const budgets = snapshot?.budgets ?? [];
  const transactions = snapshot?.transactions ?? [];
  return computeStatus(budgets, 'categoryId', categoryId, month,
    (m) => spendForCategory(transactions, categoryId, m));
}

/**
 * Full budget status for one GROUP at one month — independent of whatever
 * its individual categories are budgeting; this is purely the group's own
 * allocation vs. the combined spend of every category inside it. Same
 * envelope/rollover semantics as budgetStatus.
 */
export function groupBudgetStatus(snapshot, groupId, month = currentMonthKey()) {
  const budgets = snapshot?.budgets ?? [];
  const transactions = snapshot?.transactions ?? [];
  const catGroup = categoryGroupMap(snapshot);
  return computeStatus(budgets, 'groupId', groupId, month,
    (m) => spendForGroup(transactions, groupId, m, catGroup));
}

/**
 * One row per category that has ANY budget history, for `month`.
 * `hasAllocationForMonth` is false only when `month` predates the
 * category's first entry — allocation/spend/balance are 0 and status is
 * null in that case, since there is nothing to report yet.
 */
export function allBudgetStatuses(snapshot, month = currentMonthKey()) {
  const budgets = snapshot?.budgets ?? [];
  const categoryIds = [...new Set(budgets.filter((b) => b.categoryId).map((b) => b.categoryId))];
  return categoryIds.map((categoryId) => {
    const status = budgetStatus(snapshot, categoryId, month);
    return status
      ? { categoryId, hasAllocationForMonth: true, ...status }
      : { categoryId, hasAllocationForMonth: false, allocation: 0, spend: 0, balance: 0, status: null };
  });
}

/** Group equivalent of allBudgetStatuses — one row per group that has ANY
 * budget history, for `month`. */
export function allGroupBudgetStatuses(snapshot, month = currentMonthKey()) {
  const budgets = snapshot?.budgets ?? [];
  const groupIds = [...new Set(budgets.filter((b) => b.groupId).map((b) => b.groupId))];
  return groupIds.map((groupId) => {
    const status = groupBudgetStatus(snapshot, groupId, month);
    return status
      ? { groupId, hasAllocationForMonth: true, ...status }
      : { groupId, hasAllocationForMonth: false, allocation: 0, spend: 0, balance: 0, status: null };
  });
}
