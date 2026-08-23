import { applyFilters, buildContext } from './filter.js';
import { groupBy, SLICES } from './group-by.js';

/**
 * The transaction records behind ONE slice bucket — the drill-down UI's
 * deliberate escape hatch from Seam 1's "no records" contract. `query()` in
 * query.js must never return raw transactions; this is a separate function,
 * for the one feature (drill down + re-categorise) that genuinely needs them.
 *
 * @param {object} snapshot
 * @param {{filters?: object, sliceBy?: string}} spec
 * @param {string} key  the bucket key to isolate — a category id, group id,
 *   month/week string, merchant name, etc., matching `sliceBy`.
 * @returns {{key: string, label: string, rows: Array} | null}
 */
export function transactionsForSlice(snapshot, spec = {}, key) {
  const { filters = {}, sliceBy = 'category' } = spec;
  if (!SLICES.includes(sliceBy)) throw new Error(`Unsupported slice: ${sliceBy}`);

  const ctx = buildContext(snapshot);
  const filtered = applyFilters(snapshot.transactions ?? [], filters, ctx);
  const bucket = groupBy(filtered, sliceBy, ctx).find((b) => b.key === key);
  return bucket ?? null;
}
