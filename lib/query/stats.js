import { medianOf, round2 } from './measures.js';

/**
 * Describe the SHAPE of a bucket, not just its size — the answer to
 * "is this a few large spends or a lot of small ones?".
 *
 * `top3Share` is the fraction of the bucket's absolute total contributed by
 * its three largest transactions, 0–1. Near 1 means a handful of big hits;
 * near 0 means death by a thousand cuts.
 */
export function concentrationStats(rows) {
  if (!rows.length) return { txnCount: 0, median: 0, largest: 0, top3Share: 0 };

  const byMagnitude = [...rows].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const absTotal = rows.reduce((a, r) => a + Math.abs(r.amount), 0);
  const top3 = byMagnitude.slice(0, 3).reduce((a, r) => a + Math.abs(r.amount), 0);

  return {
    txnCount: rows.length,
    median: medianOf(rows),
    largest: byMagnitude[0].amount,
    top3Share: absTotal === 0 ? 0 : round2(top3 / absTotal)
  };
}
