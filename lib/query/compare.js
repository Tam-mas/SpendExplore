import { query } from './query.js';
import { round2 } from './measures.js';
import { baselineWindows } from './periods.js';

const NO_BASELINE = Object.freeze({ baseline: null, delta: null, deltaPct: null, isNew: false });

function earliestDate(snapshot) {
  let earliest = null;
  for (const txn of snapshot?.transactions ?? []) {
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

  const windows = baselineWindows(
    { dateFrom: spec.filters?.dateFrom, dateTo: spec.filters?.dateTo },
    mode
  );
  if (!windows.length) return blank;

  // A window lying entirely before the ledger's first transaction is missing
  // history, not a genuine zero — "up 100%" against it would be a fabrication.
  // A window that overlaps the ledger but happens to contain no spend IS real
  // news and is kept.
  const earliest = earliestDate(snapshot);
  const covered = earliest === null ? [] : windows.filter((w) => w.dateTo >= earliest);
  if (!covered.length) return blank;

  const runs = covered.map((w) =>
    query(snapshot, { ...spec, filters: { ...spec.filters, dateFrom: w.dateFrom, dateTo: w.dateTo } })
  );

  const sums = new Map();
  const labels = new Map();
  for (const run of runs) {
    for (const row of run.rows) {
      sums.set(row.key, (sums.get(row.key) ?? 0) + row.value);
      labels.set(row.key, row.label);
    }
  }

  // Averaged over the NUMBER OF WINDOWS, never over how many of them happened
  // to contain this key — a category appearing in one month out of three
  // genuinely averages a third of that month.
  const baselineFor = (key) => (sums.has(key) ? round2(sums.get(key) / covered.length) : 0);

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

  const present = new Set(current.rows.map((r) => r.key));
  const disappeared = [...sums.keys()]
    .filter((key) => !present.has(key))
    .map((key) => ({ key, label: labels.get(key), baseline: baselineFor(key) }))
    .sort((a, b) => Math.abs(b.baseline) - Math.abs(a.baseline));

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
