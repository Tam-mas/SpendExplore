export const MEASURES = Object.freeze(['sum', 'count', 'avg', 'median', 'pctOfTotal']);

export const round2 = (n) => Math.round(n * 100) / 100;

const sum = (rows) => round2(rows.reduce((a, r) => a + r.amount, 0));

export function medianOf(rows) {
  if (!rows.length) return 0;
  const sorted = rows.map((r) => r.amount).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? round2(sorted[mid])
    : round2((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Reduce a bucket of transactions to a single number.
 *
 * `pctOfTotal` returns the raw sum — the percentage needs the grand total
 * across all buckets, which only the query composer knows.
 */
export function measure(rows, name) {
  if (!MEASURES.includes(name)) throw new Error(`Unsupported measure: ${name}`);
  if (!rows.length) return 0;

  switch (name) {
    case 'sum':
    case 'pctOfTotal':
      return sum(rows);
    case 'count':
      return rows.length;
    case 'avg':
      return round2(sum(rows) / rows.length);
    case 'median':
      return medianOf(rows);
    default:
      throw new Error(`Unsupported measure: ${name}`);
  }
}
