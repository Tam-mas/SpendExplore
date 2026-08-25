/**
 * Recurring-charge detection over the ledger. Pure: snapshot in, series out,
 * no I/O and no DOM.
 *
 * This is only tractable because lib/merchant-normalise.js has already turned
 * a raw bank description into a stable merchant name — grouping on raw text
 * would scatter one subscription across a dozen "merchants".
 *
 * Every cost reported here is a POSITIVE magnitude, matching lib/budgets.js.
 */

/**
 * Tolerance bands are deliberately non-overlapping. A gap landing between two
 * bands matches nothing, which is the honest answer: 20 days is not a cadence.
 */
export const CADENCES = Object.freeze([
  { id: 'weekly',      label: 'Weekly',      days: 7,      tolerance: 2 },
  { id: 'fortnightly', label: 'Fortnightly', days: 14,     tolerance: 3 },
  { id: 'monthly',     label: 'Monthly',     days: 30.44,  tolerance: 5.5 },
  { id: 'quarterly',   label: 'Quarterly',   days: 91.31,  tolerance: 9 },
  { id: 'annual',      label: 'Annual',      days: 365.25, tolerance: 20 }
]);

const MS_PER_DAY = 86400000;
const toUTC = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Day differences between consecutive dates, ascending. */
export function gapsBetween(dates) {
  const sorted = [...dates].sort();
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(Math.round((toUTC(sorted[i]) - toUTC(sorted[i - 1])) / MS_PER_DAY));
  }
  return gaps;
}

const within = (gap, cadence, multiple) =>
  Math.abs(gap - cadence.days * multiple) <= cadence.tolerance * multiple;

/**
 * The cadence a date sequence follows, or null when it follows none.
 *
 * A gap at roughly TWICE the period is treated as one skipped occurrence
 * rather than a failure — a declined payment or a paused month should not
 * erase an obvious subscription — but a sequence that is mostly skips is
 * rejected, because at that point it is not a reliable commitment.
 */
export function detectCadence(dates, { strict = true } = {}) {
  const minimum = strict ? 3 : 2;
  if (!Array.isArray(dates) || dates.length < minimum) return null;

  const gaps = gapsBetween(dates);
  if (!gaps.length) return null;

  for (const cadence of CADENCES) {
    let skipped = 0;
    let matched = true;
    for (const gap of gaps) {
      if (within(gap, cadence, 1)) continue;
      if (within(gap, cadence, 2)) { skipped += 1; continue; }
      matched = false;
      break;
    }
    if (!matched) continue;
    // More skips than real intervals means the "subscription" is mostly
    // absence. Reject rather than report a commitment that is not one.
    if (skipped * 2 > gaps.length) continue;
    return { cadence: cadence.id, days: cadence.days, label: cadence.label, skippedPeriods: skipped };
  }

  return null;
}

/** Within 5% of each other counts as the same price. */
const FIXED_TOLERANCE = 0.05;

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(value * 100) / 100;
};

const isStable = (values) => {
  if (values.length < 2) return values.length === 1;
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low > 0 && (high - low) / low <= FIXED_TOLERANCE;
};

/**
 * Describe a series' amounts: a fixed price, a fixed price that stepped once,
 * or a genuinely variable bill.
 *
 * The distinction is what makes a price-change alert trustworthy. Flagging a
 * "price rise" on a quarterly electricity bill that swings $180–$260 every
 * time would be noise; flagging Netflix going 16.99 → 18.99 is the whole point.
 *
 * `amounts` must be in DATE order. Signs are ignored — the profile is in
 * positive magnitudes.
 */
export function amountProfile(amounts) {
  const magnitudes = amounts.map((a) => Math.round(Math.abs(a) * 100) / 100);
  if (!magnitudes.length) return { kind: 'variable', typical: 0, min: 0, max: 0, step: null };

  const min = Math.min(...magnitudes);
  const max = Math.max(...magnitudes);

  if (isStable(magnitudes)) {
    return { kind: 'fixed', typical: median(magnitudes), min, max, step: null };
  }

  // A step needs two stable runs with at least two readings each — one high
  // final charge is an anomaly, not an established new price.
  for (let index = 2; index <= magnitudes.length - 2; index++) {
    const before = magnitudes.slice(0, index);
    const after = magnitudes.slice(index);
    if (!isStable(before) || !isStable(after)) continue;
    const from = median(before);
    const to = median(after);
    if (from > 0 && Math.abs(to - from) / from <= FIXED_TOLERANCE) continue;
    // The current cost is what it costs NOW, never a blend of old and new.
    return { kind: 'stepped', typical: to, min, max, step: { from, to, index } };
  }

  return { kind: 'variable', typical: median(magnitudes), min, max, step: null };
}
