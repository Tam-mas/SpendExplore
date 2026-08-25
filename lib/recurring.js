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
  // `perYear` is stated, not derived from `days`. A monthly subscription is
  // billed 12 times a year, not 365.25/30.44 = 11.999 times — deriving it
  // leaves cents of drift in every annual figure, and the whole point of this
  // tab is that the annual number is the one people can act on.
  { id: 'weekly',      label: 'Weekly',      days: 7,      tolerance: 2,   perYear: 365.25 / 7 },
  { id: 'fortnightly', label: 'Fortnightly', days: 14,     tolerance: 3,   perYear: 365.25 / 14 },
  { id: 'monthly',     label: 'Monthly',     days: 30.44,  tolerance: 5.5, perYear: 12 },
  { id: 'quarterly',   label: 'Quarterly',   days: 91.31,  tolerance: 9,   perYear: 4 },
  { id: 'annual',      label: 'Annual',      days: 365.25, tolerance: 20,  perYear: 1 }
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

// Real drift on a doubled interval is not double the drift on a single one,
// so the tolerance is NOT scaled by the multiple — only the target (days *
// multiple) is.
const within = (gap, cadence, multiple) =>
  Math.abs(gap - cadence.days * multiple) <= cadence.tolerance;

// The primary (multiple-1) bands are disjoint by construction (see the
// CADENCES comment and its pinning test), but a doubled-gap window is not:
// a skipped weekly charge (~14 days) lands inside fortnightly's own primary
// band, and a skipped fortnightly charge (~28 days) lands inside monthly's.
// If a gap is a legitimate period for some OTHER cadence, calling it a skip
// of a shorter one is exactly the coincidence-as-commitment error this
// module exists to avoid, so any gap sitting in another cadence's primary
// band is disqualified from counting as a skip at all.
const inSomePrimaryBand = (gap) => CADENCES.some((c) => within(gap, c, 1));

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
      if (within(gap, cadence, 2) && !inSomePrimaryBand(gap)) { skipped += 1; continue; }
      matched = false;
      break;
    }
    if (!matched) continue;
    // More skips than real intervals means the "subscription" is mostly
    // absence. Reject rather than report a commitment that is not one.
    if (skipped * 2 > gaps.length) continue;
    return {
      cadence: cadence.id,
      days: cadence.days,
      perYear: cadence.perYear,
      label: cadence.label,
      skippedPeriods: skipped
    };
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
  // Range over the MINIMUM, not a symmetric percent-change from a baseline —
  // so 20 -> 21 (1/20 = 5%) is stable but 20 -> 19 (1/19 = 5.26%) is not.
  // Intentional and asymmetric; do not "fix" this without checking the
  // amount-profile tests that pin it.
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

const round2 = (n) => Math.round(n * 100) / 100;
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso, n) => fromUTC(toUTC(iso) + Math.round(n) * MS_PER_DAY);

/**
 * Every repeating charge in the ledger.
 *
 * Detection runs over ALL of a merchant's transactions at once rather than
 * over amount clusters: a quarterly bill swinging $180–$260 is one commitment
 * with a variable amount, and clustering by amount first would leave every
 * cluster too small to detect anything. amountProfile() then describes the
 * shape after the fact.
 *
 * `today` is injected rather than read from the clock so this stays a pure
 * function and its tests stay deterministic.
 */
export function detectRecurring(snapshot, { today = new Date().toISOString().slice(0, 10), strict = true } = {}) {
  // Transfers are excluded for the same reason lib/query/filter.js excludes
  // them from every spend total: they are movement between the household's own
  // accounts, not spending. "Committed monthly" sits in the same KPI row as
  // "Total spend", so counting a standing transfer to savings as committed
  // SPEND would make the two figures mean different things.
  const transactions = (snapshot?.transactions ?? []).filter(
    (txn) => !txn.excluded
      && txn.categoryId !== 'income'
      && txn.categoryId !== 'transfers'
      && txn.amount < 0
  );

  const byMerchant = new Map();
  for (const txn of transactions) {
    const key = txn.merchant ?? '';
    if (!key) continue;
    if (!byMerchant.has(key)) byMerchant.set(key, []);
    byMerchant.get(key).push(txn);
  }

  const series = [];
  for (const [merchant, group] of byMerchant) {
    const ordered = [...group].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const cadence = detectCadence(ordered.map((t) => t.date), { strict });
    if (!cadence) continue;

    const profile = amountProfile(ordered.map((t) => t.amount));
    const lastDate = ordered.at(-1).date;
    const nextExpected = addDays(lastDate, cadence.days);

    // How many whole cadences have elapsed past the expected charge. A grace
    // of a quarter-period absorbs a billing date that drifts a few days.
    const grace = Math.max(3, cadence.days * 0.25);
    const overdueDays = Math.round((toUTC(today) - toUTC(nextExpected)) / MS_PER_DAY);
    const missedPeriods = overdueDays > grace ? Math.floor(overdueDays / cadence.days) + 1 : 0;

    // Annualise first, then divide — rounding once rather than twice. Going
    // via a rounded monthly figure leaves a quarterly or annual bill drifting
    // by cents against the amount actually charged.
    const annualCost = round2(profile.typical * cadence.perYear);
    const monthlyCost = round2(annualCost / 12);

    series.push({
      merchant,
      // The most recent transaction's category, not a vote across the whole
      // series: recategorising just the latest charge should move the whole
      // subscription immediately, not get outvoted by older history.
      categoryId: ordered.at(-1).categoryId,
      cadence: cadence.cadence,
      cadenceLabel: cadence.label,
      cadenceDays: cadence.days,
      confidence: ordered.length >= 4 && cadence.skippedPeriods === 0 && profile.kind !== 'variable'
        ? 'high'
        : 'medium',
      occurrences: ordered.length,
      firstDate: ordered[0].date,
      lastDate,
      skippedPeriods: cadence.skippedPeriods,
      amountKind: profile.kind,
      typicalAmount: profile.typical,
      minAmount: profile.min,
      maxAmount: profile.max,
      monthlyCost,
      annualCost,
      nextExpected,
      status: missedPeriods > 0 ? 'dormant' : 'active',
      missedPeriods,
      priceChange: profile.step
        ? { from: profile.step.from, to: profile.step.to, date: ordered[profile.step.index].date }
        : null,
      transactionIds: ordered.map((t) => t.id)
    });
  }

  series.sort((a, b) => b.annualCost - a.annualCost);

  // A dormant series is money you are probably NOT committed to any more.
  // Counting it would overstate the one number this whole tab exists to give.
  const active = series.filter((s) => s.status === 'active');
  return {
    series,
    committedMonthly: round2(active.reduce((a, s) => a + s.monthlyCost, 0)),
    committedAnnual: round2(active.reduce((a, s) => a + s.annualCost, 0))
  };
}

export const OVERRIDE_DECISIONS = Object.freeze(['recurring', 'ignored', 'auto']);

/**
 * Fold the user's own corrections over a detection result.
 *
 * Detection itself is always recomputed from the ledger, so it can never drift
 * out of sync with the data. These overrides are the ONLY persisted state —
 * the same relationship rules.json has with categorisation.
 */
export function applyOverrides(result, overrides = [], snapshot, options = {}) {
  const decisions = new Map(
    (overrides ?? [])
      .filter((o) => o && typeof o.merchant === 'string')
      .map((o) => [o.merchant, o.decision])
  );
  if (!decisions.size) return result;

  const series = result.series.filter((s) => decisions.get(s.merchant) !== 'ignored');
  const alreadyPresent = new Set(series.map((s) => s.merchant));

  // A merchant the user insists is recurring gets a second pass with the
  // 2-occurrence threshold, which strict detection deliberately refuses.
  const forcedMerchants = [...decisions.entries()]
    .filter(([merchant, decision]) => decision === 'recurring' && !alreadyPresent.has(merchant))
    .map(([merchant]) => merchant);

  if (forcedMerchants.length) {
    const wanted = new Set(forcedMerchants);
    const loose = detectRecurring(
      { ...snapshot, transactions: (snapshot?.transactions ?? []).filter((t) => wanted.has(t.merchant)) },
      { ...options, strict: false }
    );
    for (const found of loose.series) {
      series.push({ ...found, confidence: 'medium', forced: true });
    }
  }

  series.sort((a, b) => b.annualCost - a.annualCost);
  const active = series.filter((s) => s.status === 'active');
  return {
    series,
    committedMonthly: round2(active.reduce((a, s) => a + s.monthlyCost, 0)),
    committedAnnual: round2(active.reduce((a, s) => a + s.annualCost, 0))
  };
}
