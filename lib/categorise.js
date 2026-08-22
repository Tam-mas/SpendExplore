/**
 * Find the categoryId for a merchant using an ordered rule list.
 * Rules are evaluated top-down and the first match wins, so more specific
 * rules must appear before more general ones. Returns null if nothing matches.
 */
export function matchRule(merchant, rules) {
  const subject = String(merchant ?? '').toLowerCase().trim();
  if (subject === '') return null;

  for (const rule of rules ?? []) {
    const value = String(rule.value ?? '').toLowerCase();
    if (value === '') continue;

    if (rule.match === 'exact') {
      if (subject === value) return rule.categoryId;
    } else if (rule.match === 'contains') {
      if (subject.includes(value)) return rule.categoryId;
    } else if (rule.match === 'regex') {
      try {
        if (new RegExp(rule.value, 'i').test(merchant)) return rule.categoryId;
      } catch {
        // A malformed user-authored regex must never break an import.
        continue;
      }
    }
  }
  return null;
}

/**
 * Decide a transaction's category.
 *
 * Spend (negative): rule match, else uncategorised.
 * Positive amount: treated as a refund and given the merchant's own category
 * ONLY if that merchant has prior spend; otherwise it is income. This stops a
 * salary deposit being netted against a spending category.
 */
export function categoriseTransaction(txn, rules, merchantsWithPriorSpend) {
  const merchantKey = String(txn.merchant ?? '').toLowerCase().trim();

  if (txn.amount > 0 && !merchantsWithPriorSpend.has(merchantKey)) {
    return { categoryId: 'income', categorySource: 'rule' };
  }

  const categoryId = matchRule(txn.merchant, rules);
  if (categoryId) return { categoryId, categorySource: 'rule' };
  return { categoryId: 'uncategorised', categorySource: 'unknown' };
}
