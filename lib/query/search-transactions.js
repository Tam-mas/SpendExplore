import { applyFilters, buildContext } from './filter.js';

/**
 * Transactions whose merchant name or raw bank description contains `term`
 * (case-insensitive substring). Like transactionsForSlice, this is a
 * deliberate exception to Seam 1's "no records" rule — the search UI's data
 * source, not something query() itself may do.
 *
 * @param {object} snapshot
 * @param {{filters?: object}} spec
 * @param {string} term
 * @returns {Array} matching transaction records, in ledger order
 */
export function searchTransactions(snapshot, spec = {}, term) {
  const needle = String(term ?? '').trim().toLowerCase();
  if (!needle) return [];

  const { filters = {} } = spec;
  const ctx = buildContext(snapshot);
  const filtered = applyFilters(snapshot.transactions ?? [], filters, ctx);

  return filtered.filter((t) =>
    String(t.merchant ?? '').toLowerCase().includes(needle) ||
    String(t.rawDescription ?? '').toLowerCase().includes(needle));
}
