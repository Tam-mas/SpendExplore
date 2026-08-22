import { applyFilters, buildContext } from './filter.js';
import { groupBy, SLICES, TIME_SLICES } from './group-by.js';
import { measure as reduceRows, MEASURES, round2 } from './measures.js';
import { concentrationStats } from './stats.js';

/** Slices that carry their own order and must not be re-sorted by value. */
const ORDERED_SLICES = new Set([...TIME_SLICES, 'weekday', 'amountBand']);

/**
 * Seam 1 — the only contract the UI codes against.
 *
 * A panel is pure config: { filters, sliceBy, measure, sort, limit }. It hands
 * that here and gets back rows it can draw. Deliberately returns NO transaction
 * records, so a chart can never reach around the contract into raw data.
 *
 * @param {object} snapshot  { transactions, categories, accounts, … }
 * @param {object} spec
 * @returns {{rows: Array, total: number, stats: object, meta: object}}
 */
export function query(snapshot, spec = {}) {
  const {
    filters = {},
    sliceBy = 'category',
    measure = 'sum',
    sort = { by: 'value', dir: 'desc' },
    limit = null
  } = spec;

  if (!SLICES.includes(sliceBy)) throw new Error(`Unsupported slice: ${sliceBy}`);
  if (!MEASURES.includes(measure)) throw new Error(`Unsupported measure: ${measure}`);

  const ctx = buildContext(snapshot);
  const filtered = applyFilters(snapshot.transactions ?? [], filters, ctx);
  const buckets = groupBy(filtered, sliceBy, ctx);

  let rows = buckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    value: reduceRows(bucket.rows, measure),
    count: bucket.rows.length,
    total: reduceRows(bucket.rows, 'sum'),
    stats: concentrationStats(bucket.rows)
  }));

  // Grand total across every bucket, before any limit is applied.
  let total = measure === 'count'
    ? filtered.length
    : round2(rows.reduce((a, r) => a + r.value, 0));

  if (measure === 'pctOfTotal') {
    const denominator = rows.reduce((a, r) => a + Math.abs(r.value), 0);
    rows = rows.map((r) => ({
      ...r,
      value: denominator === 0 ? 0 : round2((Math.abs(r.value) / denominator) * 100)
    }));
    total = round2(rows.reduce((a, r) => a + r.value, 0));
  }

  if (!ORDERED_SLICES.has(sliceBy)) {
    const direction = sort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      if (sort.by === 'label') {
        return direction * a.label.localeCompare(b.label);
      }
      // Primary sort by value magnitude
      const valueDiff = direction * (Math.abs(a.value) - Math.abs(b.value));
      if (valueDiff !== 0) return valueDiff;
      // Secondary sort by label (descending) when values are equal
      return -a.label.localeCompare(b.label);
    });
  }

  const rowCount = rows.length;
  const truncated = typeof limit === 'number' && limit > 0 && rowCount > limit;
  if (truncated) rows = rows.slice(0, limit);

  return {
    rows,
    total,
    stats: concentrationStats(filtered),
    meta: { sliceBy, measure, rowCount, filteredCount: filtered.length, truncated }
  };
}
