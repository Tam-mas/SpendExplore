import { query } from './query.js';
import { round2 } from './measures.js';
import { baselineWindows } from './periods.js';
import { applyFilters, buildContext } from './filter.js';
import { TIME_SLICES } from './group-by.js';

const NO_BASELINE = Object.freeze({ baseline: null, delta: null, deltaPct: null, isNew: false });

// Earliest date of the population the SPEC actually queries — same filters
// (accounts, categories, excluded/income exclusion, …) minus the date bounds
// themselves, so "does this baseline window predate the queried data" is
// asked about the rows the display will ever show, not every row in the
// ledger. Filtering unconditionally over snapshot.transactions let a window
// survive `covered` purely because SOME unrelated account or an excluded/
// income row happened to be old, then averaged real zeros into the baseline.
function earliestDate(snapshot, spec) {
  const ctx = buildContext(snapshot);
  const filters = { ...spec.filters, dateFrom: undefined, dateTo: undefined };
  const population = applyFilters(snapshot?.transactions ?? [], filters, ctx);
  let earliest = null;
  for (const txn of population) {
    if (earliest === null || txn.date < earliest) earliest = txn.date;
  }
  return earliest;
}

/**
 * Seam 1 plus a baseline. Runs the SAME spec over one or more earlier windows
 * and joins the results by row key.
 *
 * Deliberately a wrapper rather than a `compare` option on query() itself:
 * query()'s contract stays exactly as every existing panel and test expects,
 * and the join is unit-testable on its own against a hand-built snapshot.
 *
 * `delta` and `deltaPct` are in MAGNITUDE space, so positive always means more
 * was spent — see the sign convention in this plan. `baseline` stays in the
 * ledger's signed space so it renders against `value` consistently.
 *
 * A bucket present now but absent from every baseline window is `isNew`. A
 * bucket present in the baseline but gone now is NOT added to `rows` — a
 * zero-height bar for something that no longer exists reads as a real value —
 * it goes to `disappeared` instead.
 */
export function compareQuery(snapshot, spec = {}, mode = 'off') {
  const current = query(snapshot, spec);
  const blank = {
    ...current,
    rows: current.rows.map((row) => ({ ...row, ...NO_BASELINE })),
    baselineTotal: null,
    baselineDelta: null,
    baselineDeltaPct: null,
    baselineAvailable: false,
    baselineMode: mode,
    baselineWindows: [],
    disappeared: []
  };

  // A true combined median across windows can't be reconstructed from
  // per-window aggregates the way avg can (Σtotal/Σcount) — median needs the
  // full sorted sample, which query() deliberately never returns. And "the
  // mean of N monthly medians" is a different, misleading statistic: a user
  // reading "vs 3-month average" would not expect it. Report no baseline
  // rather than a number that looks right but isn't.
  if (spec.measure === 'median') return blank;

  // A time slice's key IS the period ('2026-08', '2026-08-10'). A baseline
  // window is by definition an earlier, non-overlapping window, so its keys
  // can never intersect the current run's keys — every row would join
  // against nothing and read as `isNew` with a fabricated 100% baseline
  // drop. The key-based join below is only meaningful for slices whose keys
  // are dimensions (category, merchant, …), not an ordered timeline.
  if (TIME_SLICES.includes(spec.sliceBy)) return blank;

  const windows = baselineWindows(
    { dateFrom: spec.filters?.dateFrom, dateTo: spec.filters?.dateTo },
    mode
  );
  if (!windows.length) return blank;

  // A window lying entirely before the ledger's first transaction is missing
  // history, not a genuine zero — "up 100%" against it would be a fabrication.
  // A window that overlaps the ledger but happens to contain no spend IS real
  // news and is kept.
  const earliest = earliestDate(snapshot, spec);
  const covered = earliest === null ? [] : windows.filter((w) => w.dateTo >= earliest);
  if (!covered.length) return blank;

  // The join needs every row each baseline window produced, not just its own
  // top-N — otherwise a key that ranks inside the CURRENT window's top-N but
  // outside a given baseline window's top-N silently drops out of that
  // window's data and reads as a false isNew/0. `current` above stays
  // limited (that's what gets displayed); only the join's inputs are not.
  const runs = covered.map((w) =>
    query(snapshot, { ...spec, limit: null, filters: { ...spec.filters, dateFrom: w.dateFrom, dateTo: w.dateTo } })
  );

  const sums = new Map();
  const totals = new Map();
  const counts = new Map();
  const labels = new Map();
  for (const run of runs) {
    for (const row of run.rows) {
      sums.set(row.key, (sums.get(row.key) ?? 0) + row.value);
      totals.set(row.key, (totals.get(row.key) ?? 0) + row.total);
      counts.set(row.key, (counts.get(row.key) ?? 0) + row.count);
      labels.set(row.key, row.label);
    }
  }

  const isAvg = spec.measure === 'avg';

  // avg is a derived ratio, not additive: averaging per-window averages
  // over-weights whichever window had fewer transactions (one $100 charge
  // vs ten $10 charges is NOT a 50/50 split). The true combined average
  // across every covered window is total spend / total transaction count —
  // both of which every row carries regardless of the requested measure, so
  // no window's underlying records are needed to get this right.
  const baselineFor = (key) => {
    if (!sums.has(key)) return 0;
    if (isAvg) {
      const count = counts.get(key) ?? 0;
      return count === 0 ? 0 : round2(totals.get(key) / count);
    }
    // Averaged over the NUMBER OF WINDOWS, never over how many of them
    // happened to contain this key — a category appearing in one month out
    // of three genuinely averages a third of that month. Valid here because
    // sum/count/pctOfTotal are additive across windows; avg is handled above.
    return round2(sums.get(key) / covered.length);
  };

  // pctOfTotal is already a share, so a percentage change in a percentage is
  // meaningless. Its delta stays in percentage points and deltaPct is null.
  const ratioMeaningful = spec.measure !== 'pctOfTotal';
  const changeRatio = (delta, baseline) =>
    (!ratioMeaningful || Math.abs(baseline) === 0 ? null : round2(delta / Math.abs(baseline)));

  const rows = current.rows.map((row) => {
    const baseline = baselineFor(row.key);
    const delta = round2(Math.abs(row.value) - Math.abs(baseline));
    return {
      ...row,
      baseline,
      delta,
      deltaPct: changeRatio(delta, baseline),
      isNew: !sums.has(row.key)
    };
  });

  const hasLimit = typeof spec.limit === 'number' && spec.limit > 0;
  // current.rows is the DISPLAYED set, already truncated to spec.limit. A
  // category cut by that same limit still exists this period — diffing
  // against the truncated set would wrongly call it disappeared. Only pay
  // for the extra unlimited query when a limit is actually in play.
  const currentKeys = hasLimit
    ? new Set(query(snapshot, { ...spec, limit: null }).rows.map((r) => r.key))
    : new Set(current.rows.map((r) => r.key));

  const disappeared = [...sums.keys()]
    .filter((key) => !currentKeys.has(key))
    .map((key) => ({ key, label: labels.get(key), baseline: baselineFor(key) }))
    .sort((a, b) => Math.abs(b.baseline) - Math.abs(a.baseline));

  // r.total inherits query()'s own result-level `total`, which for
  // measure: 'avg' is the SUM of per-bucket averages, not a meaningful
  // aggregate — averaging that across windows compounds the same problem.
  // Not a live bug: the only caller of baselineTotal today hard-codes
  // 'sum'/'count', both of which total additively. A future avg caller would
  // need the same Σtotal/Σcount treatment baselineFor already gives per-row.
  const baselineTotal = round2(runs.reduce((a, r) => a + r.total, 0) / covered.length);
  const baselineDelta = round2(Math.abs(current.total) - Math.abs(baselineTotal));

  return {
    ...current,
    rows,
    baselineTotal,
    baselineDelta,
    baselineDeltaPct: changeRatio(baselineDelta, baselineTotal),
    baselineAvailable: true,
    baselineMode: mode,
    baselineWindows: covered,
    disappeared
  };
}
