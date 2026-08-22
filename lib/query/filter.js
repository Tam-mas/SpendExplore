/** Person attributed to a transaction with no card suffix. */
export const JOINT = 'Joint';

/**
 * Derive the lookup tables the filters need from a snapshot, once, so
 * filtering itself stays a flat scan.
 */
export function buildContext(snapshot) {
  const categoryToGroup = new Map(
    (snapshot?.categories?.categories ?? []).map((c) => [c.id, c.groupId])
  );
  const cardOwners = {};
  for (const account of snapshot?.accounts ?? []) {
    Object.assign(cardOwners, account.cardOwners ?? {});
  }
  return { categoryToGroup, cardOwners };
}

export const personFor = (txn, ctx) =>
  (txn.cardSuffix && ctx.cardOwners[txn.cardSuffix]) || JOINT;

const has = (list) => Array.isArray(list) && list.length > 0;

/**
 * Narrow a transaction list. Every filter key is optional; an empty array
 * means "no constraint" so an untouched filter UI shows everything.
 *
 * Excluded rows and income rows are omitted unless explicitly requested —
 * they would otherwise silently distort every spend total.
 */
export function applyFilters(transactions, filters = {}, ctx) {
  const {
    dateFrom, dateTo, accountIds, categoryIds, groupIds, people, merchants,
    minAbsAmount, maxAbsAmount, includeExcluded = false, includeIncome = false
  } = filters;

  const wantedMerchants = has(merchants)
    ? new Set(merchants.map((m) => String(m).toLowerCase()))
    : null;

  return transactions.filter((txn) => {
    if (!includeExcluded && txn.excluded) return false;
    if (!includeIncome && txn.categoryId === 'income') return false;

    if (dateFrom && txn.date < dateFrom) return false;
    if (dateTo && txn.date > dateTo) return false;

    if (has(accountIds) && !accountIds.includes(txn.accountId)) return false;
    if (has(categoryIds) && !categoryIds.includes(txn.categoryId)) return false;

    if (has(groupIds)) {
      const group = ctx.categoryToGroup.get(txn.categoryId);
      if (!groupIds.includes(group)) return false;
    }

    if (has(people) && !people.includes(personFor(txn, ctx))) return false;

    if (wantedMerchants && !wantedMerchants.has(String(txn.merchant).toLowerCase())) return false;

    const magnitude = Math.abs(txn.amount);
    if (typeof minAbsAmount === 'number' && magnitude < minAbsAmount) return false;
    if (typeof maxAbsAmount === 'number' && magnitude > maxAbsAmount) return false;

    return true;
  });
}
