# Comparison & Baselines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every number in the Overview a baseline to be judged against — a global "compare to" control that re-runs the current query over an earlier window and surfaces the difference as KPI delta chips, ghost bars behind every bar, a dashed baseline series on the line chart, and a Δ column in Table view.

**Architecture:** A new pure module `lib/query/compare.js` wraps the existing `query()` rather than changing it: it runs the same spec over one or more shifted date windows and joins the results by row key. Seam 1's contract is therefore untouched, every existing panel and test keeps working, and the join logic is unit-testable against a hand-built snapshot with no DOM. Window arithmetic lives in its own module `lib/query/periods.js` because three later plans (date ranges, the digest) need the same month/day maths. The comparison mode is a single global setting in the filter bar — never per-panel — so the whole screen always tells one consistent story.

**Tech Stack:** Node.js stdlib only, `node:test` + `node:assert/strict`, vanilla DOM, hand-rolled SVG. No new dependencies.

## Global Constraints

- Zero npm dependencies. Node stdlib only. No build step; plain ES modules served directly.
- Run tests with `node --test 'tests/**/*.test.js'` (the bare-directory form is broken on this Node version) or explicit file paths.
- `lib/` stays pure: no I/O, no DOM, snapshot/spec in, data out. `web/` owns all DOM wiring, `server/` owns persistence and validation.
- **Sign convention, binding on every calculation in this plan.** The ledger stores spend as a **negative** amount, and `query()` returns `row.value` in that signed space. Comparison deltas are the opposite: `delta` and `deltaPct` are computed in **magnitude space** — `Math.abs(value) - Math.abs(baseline)` — so a **positive delta always means "more was spent"**. Computing the delta on signed values makes spending more produce a *negative* percentage, which inverts every arrow in the UI. This mirrors the same decision already made in `lib/budgets.js` (spend as positive magnitudes). `row.baseline` itself stays in the ledger's **signed** space so it renders against `row.value` consistently — only `delta`/`deltaPct` are magnitudes.
- Dates are inclusive ISO `YYYY-MM-DD` strings and all arithmetic is UTC-based, matching `lib/query/group-by.js`. Month keys are `YYYY-MM`.
- A "window" is `{ dateFrom, dateTo }` — exactly the shape `lib/query/filter.js` already filters on, so a shifted window drops straight into a query spec with no translation.
- Every new/changed test file must pass before its task's commit.
- Untrusted strings (category/group labels, merchant names) are escaped with `escapeHtml` from `web/charts/scale.js` before going into any HTML or SVG template literal.
- The comparison UI must never invent a baseline. When there is no history to compare against, `baselineAvailable` is `false` and **no delta is rendered at all** — never "▲ 100%" against a window that predates the ledger.
- No comments explaining WHAT code does, only non-obvious WHY, matching the rest of this codebase.
- **Live verification, if any is done, must use `npm run start:test`** (`DATA_DIR=./data-test`, port 5174). Never run a manual check against `data/`, and never read files from outside this repo. See `CLAUDE.md`.

---

## File Structure

| File | Change |
|---|---|
| `lib/query/periods.js` | **New.** Window arithmetic: `shiftMonth`, `monthWindow`, `isMonthAligned`, `shiftWindow`, `addDays`, `addYears`, `daySpan`, `baselineWindows`, mode constants |
| `lib/query/compare.js` | **New.** `compareQuery(snapshot, spec, mode)` — `query()` plus a joined baseline |
| `web/delta.js` | **New.** Shared delta formatting: `deltaDirection`, `formatDelta`, `deltaClass`, `deltaChip` |
| `web/filter-bar.js` | Fifth control (`data-filter="compare"`); `readFilterBar` returns `compare` |
| `web/overview-view.js` | Persist the mode; KPI delta chips; pass the mode to every panel |
| `web/panel.js` | Call `compareQuery` instead of `query` |
| `web/charts/chart-bar.js` | Ghost baseline bar + delta text per row |
| `web/charts/chart-line.js` | Dashed baseline series |
| `web/charts/chart-table.js` | Δ column |
| `web/style.css` | `.viz-delta*`, `.viz-ghost*` |
| `tests/query-periods.test.js` | **New.** |
| `tests/query-compare.test.js` | **New.** |
| `tests/delta.test.js` | **New.** |
| `tests/filter-bar.test.js` | Extend |
| `tests/overview-panels.test.js` | Extend |
| `tests/charts-bar.test.js`, `tests/charts-timeseries.test.js` | Extend |

---

## Task 1: `lib/query/periods.js` — window arithmetic

**Files:**
- Create: `lib/query/periods.js`
- Test: `tests/query-periods.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `BASELINE_MODES: readonly string[]`; `BASELINE_LABELS: Record<string,string>`; `BASELINE_SHORT_LABELS: Record<string,string>`; `daysInMonth(year, month) → number`; `shiftMonth(key, n) → "YYYY-MM"`; `monthWindow(key) → {dateFrom, dateTo}`; `isMonthAligned(window) → boolean`; `addDays(iso, n) → iso`; `addYears(iso, n) → iso`; `daySpan(window) → number`; `shiftWindow(window, n) → window`; `baselineWindows(window, mode) → window[]`. Tasks 2 and 3 import from here; the chart-interaction plan and the digest plan both extend this same file. Do not rename these.

- [ ] **Step 1: Write the failing tests**

Create `tests/query-periods.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASELINE_MODES, daysInMonth, shiftMonth, monthWindow, isMonthAligned,
  addDays, addYears, daySpan, shiftWindow, baselineWindows
} from '../lib/query/periods.js';

const AUGUST = { dateFrom: '2026-08-01', dateTo: '2026-08-31' };

test('BASELINE_MODES lists exactly the four supported modes', () => {
  assert.deepEqual([...BASELINE_MODES], ['off', 'prevPeriod', 'trailing3', 'sameLastYear']);
});

test('daysInMonth handles short months and leap Februaries', () => {
  assert.equal(daysInMonth(2026, 8), 31);
  assert.equal(daysInMonth(2026, 6), 30);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2024, 2), 29);
});

test('shiftMonth crosses year boundaries in both directions', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-01', -13), '2024-12');
  assert.equal(shiftMonth('2026-11', 2), '2027-01');
  assert.equal(shiftMonth('2026-08', 0), '2026-08');
});

test('monthWindow spans the whole calendar month', () => {
  assert.deepEqual(monthWindow('2026-08'), AUGUST);
  assert.deepEqual(monthWindow('2024-02'), { dateFrom: '2024-02-01', dateTo: '2024-02-29' });
});

test('isMonthAligned accepts only a complete calendar month', () => {
  assert.equal(isMonthAligned(AUGUST), true);
  assert.equal(isMonthAligned({ dateFrom: '2026-08-01', dateTo: '2026-08-30' }), false);
  assert.equal(isMonthAligned({ dateFrom: '2026-08-02', dateTo: '2026-08-31' }), false);
  assert.equal(isMonthAligned({ dateFrom: '2026-07-01', dateTo: '2026-08-31' }), false);
  assert.equal(isMonthAligned({}), false);
});

test('addDays and daySpan agree, and daySpan counts both ends', () => {
  assert.equal(addDays('2026-08-30', 3), '2026-09-02');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daySpan({ dateFrom: '2026-08-01', dateTo: '2026-08-01' }), 1);
  assert.equal(daySpan({ dateFrom: '2026-08-01', dateTo: '2026-08-07' }), 7);
});

test('addYears clamps 29 February onto a non-leap year', () => {
  assert.equal(addYears('2024-02-29', -1), '2023-02-28');
  assert.equal(addYears('2026-08-15', -1), '2025-08-15');
});

test('shiftWindow moves a month-aligned window by whole months, not by day count', () => {
  // July has 31 days and June has 30. A naive day-span shift would land on
  // 2026-06-30..2026-07-30, which is not June.
  assert.deepEqual(
    shiftWindow({ dateFrom: '2026-07-01', dateTo: '2026-07-31' }, -1),
    { dateFrom: '2026-06-01', dateTo: '2026-06-30' }
  );
});

test('shiftWindow moves a non-aligned window by its own inclusive day span', () => {
  assert.deepEqual(
    shiftWindow({ dateFrom: '2026-08-10', dateTo: '2026-08-16' }, -1),
    { dateFrom: '2026-08-03', dateTo: '2026-08-09' }
  );
});

test('baselineWindows returns one window for prevPeriod and three for trailing3', () => {
  assert.deepEqual(baselineWindows(AUGUST, 'prevPeriod'),
    [{ dateFrom: '2026-07-01', dateTo: '2026-07-31' }]);

  const three = baselineWindows(AUGUST, 'trailing3');
  assert.equal(three.length, 3);
  assert.deepEqual(three[0], { dateFrom: '2026-07-01', dateTo: '2026-07-31' });
  assert.deepEqual(three[2], { dateFrom: '2026-05-01', dateTo: '2026-05-31' });
});

test('baselineWindows shifts a full year back for sameLastYear', () => {
  assert.deepEqual(baselineWindows(AUGUST, 'sameLastYear'),
    [{ dateFrom: '2025-08-01', dateTo: '2025-08-31' }]);
});

test('baselineWindows is empty when off, unknown, or when the window is unbounded', () => {
  assert.deepEqual(baselineWindows(AUGUST, 'off'), []);
  assert.deepEqual(baselineWindows(AUGUST, 'nonsense'), []);
  assert.deepEqual(baselineWindows({}, 'trailing3'), []);
  assert.deepEqual(baselineWindows({ dateFrom: '2026-08-01' }, 'trailing3'), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/query-periods.test.js`
Expected: FAIL — `Cannot find module '.../lib/query/periods.js'`

- [ ] **Step 3: Write the implementation**

Create `lib/query/periods.js`:

```js
/**
 * Window arithmetic for period comparison. A "window" is `{ dateFrom, dateTo }`
 * of inclusive ISO dates — exactly the shape lib/query/filter.js already
 * filters on, so a shifted window drops straight into a query spec.
 *
 * All arithmetic is UTC-based, matching lib/query/group-by.js.
 */

export const BASELINE_MODES = Object.freeze(['off', 'prevPeriod', 'trailing3', 'sameLastYear']);

export const BASELINE_LABELS = Object.freeze({
  off: 'No comparison',
  prevPeriod: 'vs previous period',
  trailing3: 'vs 3-period average',
  sameLastYear: 'vs same period last year'
});

/** Compact forms for a KPI chip, where the full label does not fit. */
export const BASELINE_SHORT_LABELS = Object.freeze({
  off: '',
  prevPeriod: 'vs prev',
  trailing3: 'vs 3-per avg',
  sameLastYear: 'vs last year'
});

const pad = (n) => String(n).padStart(2, '0');
const toUTC = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);

export const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export function shiftMonth(key, n) {
  const [y, m] = key.split('-').map(Number);
  const index = y * 12 + (m - 1) + n;
  // Math.floor and the double-modulo both round toward negative infinity, so
  // this stays correct for keys shifted back past year zero of the ledger.
  return `${Math.floor(index / 12)}-${pad(((index % 12) + 12) % 12 + 1)}`;
}

export function monthWindow(key) {
  const [y, m] = key.split('-').map(Number);
  return { dateFrom: `${key}-01`, dateTo: `${key}-${pad(daysInMonth(y, m))}` };
}

export function isMonthAligned(window = {}) {
  const { dateFrom, dateTo } = window;
  if (!dateFrom || !dateTo) return false;
  if (dateFrom.slice(0, 7) !== dateTo.slice(0, 7)) return false;
  const [y, m] = dateFrom.split('-').map(Number);
  return dateFrom.slice(8) === '01' && Number(dateTo.slice(8)) === daysInMonth(y, m);
}

export const addDays = (iso, n) => fromUTC(toUTC(iso) + n * 86400000);

export function addYears(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const year = y + n;
  return `${year}-${pad(m)}-${pad(Math.min(d, daysInMonth(year, m)))}`;
}

/** Inclusive day count: a single-day window is 1, not 0. */
export const daySpan = (window) =>
  Math.round((toUTC(window.dateTo) - toUTC(window.dateFrom)) / 86400000) + 1;

/**
 * Shift a window `n` periods (negative goes back). A month-aligned window
 * shifts by whole calendar months, never by its own day count — otherwise
 * "one period before July" lands on 30 June–30 July rather than on June.
 */
export function shiftWindow(window, n) {
  if (isMonthAligned(window)) return monthWindow(shiftMonth(window.dateFrom.slice(0, 7), n));
  const span = daySpan(window);
  return {
    dateFrom: addDays(window.dateFrom, n * span),
    dateTo: addDays(window.dateTo, n * span)
  };
}

/**
 * The windows a baseline averages over, newest first. Empty when comparison is
 * off or when the current window is unbounded — "All time" has nothing earlier
 * to compare itself against.
 */
export function baselineWindows(window = {}, mode = 'off') {
  if (!BASELINE_MODES.includes(mode) || mode === 'off') return [];
  if (!window.dateFrom || !window.dateTo) return [];

  if (mode === 'prevPeriod') return [shiftWindow(window, -1)];
  if (mode === 'trailing3') return [1, 2, 3].map((n) => shiftWindow(window, -n));
  return [{ dateFrom: addYears(window.dateFrom, -1), dateTo: addYears(window.dateTo, -1) }];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/query-periods.test.js`
Expected: PASS, 12 tests

- [ ] **Step 5: Commit**

```bash
git add lib/query/periods.js tests/query-periods.test.js
git commit -m "feat: add period window arithmetic for comparison baselines"
```

---

## Task 2: `lib/query/compare.js` — query plus a joined baseline

**Files:**
- Create: `lib/query/compare.js`
- Test: `tests/query-compare.test.js`

**Interfaces:**
- Consumes: `query` from `lib/query/query.js`; `round2` from `lib/query/measures.js`; `baselineWindows` from `lib/query/periods.js` (Task 1).
- Produces: `compareQuery(snapshot, spec, mode) → { rows, total, stats, meta, baselineTotal, baselineDelta, baselineDeltaPct, baselineAvailable, baselineMode, baselineWindows, disappeared }` where each row is a `query()` row plus `{ baseline, delta, deltaPct, isNew }`. Tasks 4–7 and the entire monthly-digest plan depend on these exact field names.

**The shape is the same whether or not a baseline exists.** When comparison is off or unavailable, every row still carries `baseline: null, delta: null, deltaPct: null, isNew: false`. Charts therefore never branch on the *shape* of the result, only on whether `baseline` is null.

- [ ] **Step 1: Write the failing tests**

Create `tests/query-compare.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareQuery } from '../lib/query/compare.js';

const t = (over) => ({
  id: 'x', date: '2026-08-10', amount: -10, rawDescription: 'R', merchant: 'M',
  accountId: 'a', cardSuffix: null, categoryId: 'groceries', categorySource: 'rule',
  excluded: false, importId: 'i', note: null, ...over
});

const CATEGORIES = {
  groups: [{ id: 'food-drink', label: 'Food & Drink' }, { id: 'lifestyle', label: 'Lifestyle' }],
  categories: [
    { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
    { id: 'takeaway', label: 'Takeaway', groupId: 'food-drink' },
    { id: 'shopping', label: 'Shopping', groupId: 'lifestyle' }
  ]
};

// Ledger starts 2026-06-10. June: groceries 100, takeaway 50.
// July: groceries 200. August: groceries 300, shopping 40.
const SNAPSHOT = {
  categories: CATEGORIES,
  accounts: [],
  transactions: [
    t({ id: 'j1', date: '2026-06-10', amount: -100, categoryId: 'groceries' }),
    t({ id: 'j2', date: '2026-06-12', amount: -50, categoryId: 'takeaway' }),
    t({ id: 'y1', date: '2026-07-10', amount: -200, categoryId: 'groceries' }),
    t({ id: 'a1', date: '2026-08-10', amount: -300, categoryId: 'groceries' }),
    t({ id: 'a2', date: '2026-08-11', amount: -40, categoryId: 'shopping' })
  ]
};

const august = (measure = 'sum') => ({
  filters: { dateFrom: '2026-08-01', dateTo: '2026-08-31' },
  sliceBy: 'category',
  measure
});

const rowFor = (result, key) => result.rows.find((r) => r.key === key);

test('mode "off" returns the query result with null baseline fields on every row', () => {
  const result = compareQuery(SNAPSHOT, august(), 'off');
  assert.equal(result.baselineAvailable, false);
  assert.equal(result.baselineTotal, null);
  assert.deepEqual(result.disappeared, []);
  assert.equal(result.rows.length, 2);
  for (const row of result.rows) {
    assert.equal(row.baseline, null);
    assert.equal(row.delta, null);
    assert.equal(row.deltaPct, null);
    assert.equal(row.isNew, false);
  }
});

test('prevPeriod compares August against July and reports growth as POSITIVE', () => {
  const result = compareQuery(SNAPSHOT, august(), 'prevPeriod');
  assert.equal(result.baselineAvailable, true);

  const groceries = rowFor(result, 'groceries');
  assert.equal(groceries.value, -300);
  assert.equal(groceries.baseline, -200);
  // Magnitude space: spending 300 against a 200 baseline is +100, +50%.
  assert.equal(groceries.delta, 100);
  assert.equal(groceries.deltaPct, 0.5);
  assert.equal(groceries.isNew, false);
});

test('a bucket absent from every baseline window is flagged isNew with a null deltaPct', () => {
  const shopping = rowFor(compareQuery(SNAPSHOT, august(), 'prevPeriod'), 'shopping');
  assert.equal(shopping.baseline, 0);
  assert.equal(shopping.delta, 40);
  assert.equal(shopping.deltaPct, null);
  assert.equal(shopping.isNew, true);
});

test('trailing3 skips windows that predate the ledger and averages over the rest', () => {
  // Requested: July, June, May. May ends 2026-05-31, before the first
  // transaction on 2026-06-10, so it is missing history rather than a real
  // zero and must not drag the average down.
  const result = compareQuery(SNAPSHOT, august(), 'trailing3');
  assert.equal(result.baselineWindows.length, 2);

  const groceries = rowFor(result, 'groceries');
  assert.equal(groceries.baseline, -150); // (200 + 100) / 2
  assert.equal(groceries.delta, 150);
  assert.equal(groceries.deltaPct, 1);
});

test('a bucket present in only some baseline windows averages over ALL of them', () => {
  // Takeaway appears in June (50) but not July. Across two windows that is an
  // average of 25 — not 50. Dividing by "windows that contained this key"
  // would overstate every intermittent category.
  const result = compareQuery(SNAPSHOT, august(), 'trailing3');
  const gone = result.disappeared.find((d) => d.key === 'takeaway');
  assert.ok(gone, 'takeaway should be reported as disappeared');
  assert.equal(gone.baseline, -25);
  assert.equal(gone.label, 'Takeaway');
});

test('a bucket that vanished is kept OUT of rows so no zero-height bar is drawn', () => {
  const result = compareQuery(SNAPSHOT, august(), 'trailing3');
  assert.equal(rowFor(result, 'takeaway'), undefined);
});

test('grand totals carry their own baseline and delta', () => {
  const result = compareQuery(SNAPSHOT, august(), 'trailing3');
  assert.equal(result.total, -340);
  assert.equal(result.baselineTotal, -175); // July -200, June -150
  assert.equal(result.baselineDelta, 165);
  assert.equal(result.baselineDeltaPct, 0.94);
});

test('baseline is unavailable when every baseline window predates the ledger', () => {
  const spec = { filters: { dateFrom: '2026-06-01', dateTo: '2026-06-30' }, sliceBy: 'category', measure: 'sum' };
  const result = compareQuery(SNAPSHOT, spec, 'prevPeriod');
  assert.equal(result.baselineAvailable, false);
  assert.equal(result.rows[0].baseline, null);
});

test('baseline is unavailable for an unbounded (all-time) window', () => {
  const result = compareQuery(SNAPSHOT, { sliceBy: 'category', measure: 'sum' }, 'trailing3');
  assert.equal(result.baselineAvailable, false);
});

test('pctOfTotal reports a percentage-point delta and never a percentage OF a percentage', () => {
  const result = compareQuery(SNAPSHOT, august('pctOfTotal'), 'prevPeriod');
  const groceries = rowFor(result, 'groceries');
  assert.equal(groceries.deltaPct, null);
  assert.equal(typeof groceries.delta, 'number');
});

test('the count measure compares transaction counts', () => {
  const result = compareQuery(SNAPSHOT, august('count'), 'prevPeriod');
  const groceries = rowFor(result, 'groceries');
  assert.equal(groceries.value, 1);
  assert.equal(groceries.baseline, 1);
  assert.equal(groceries.delta, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/query-compare.test.js`
Expected: FAIL — `Cannot find module '.../lib/query/compare.js'`

- [ ] **Step 3: Write the implementation**

Create `lib/query/compare.js`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/query-compare.test.js`
Expected: PASS, 11 tests

- [ ] **Step 5: Run the whole suite to confirm nothing regressed**

Run: `node --test 'tests/**/*.test.js'`
Expected: PASS — `query()` itself was not modified, so every existing query test must still pass.

- [ ] **Step 6: Commit**

```bash
git add lib/query/compare.js tests/query-compare.test.js
git commit -m "feat: add compareQuery, a baseline-joined wrapper over query()"
```

---

## Task 3: `web/delta.js` — shared delta formatting

**Files:**
- Create: `web/delta.js`
- Test: `tests/delta.test.js`

**Interfaces:**
- Consumes: `formatMeasure`, `escapeHtml` from `web/charts/scale.js`; `BASELINE_SHORT_LABELS` from `lib/query/periods.js`.
- Produces: `deltaDirection(delta) → 'up'|'down'|'flat'|null`; `formatDelta(delta, deltaPct, measure) → string`; `deltaClass(delta) → string`; `deltaChip(row, measure, mode) → html string`. Tasks 4–6 all import from here — this is the one place the arrow, the wording and the colour class are decided.

- [ ] **Step 1: Write the failing tests**

Create `tests/delta.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaDirection, formatDelta, deltaClass, deltaChip } from '../web/delta.js';

test('deltaDirection returns null when there is no baseline', () => {
  assert.equal(deltaDirection(null), null);
  assert.equal(deltaDirection(undefined), null);
});

test('deltaDirection treats a sub-cent difference as flat', () => {
  assert.equal(deltaDirection(0), 'flat');
  assert.equal(deltaDirection(0.004), 'flat');
  assert.equal(deltaDirection(0.01), 'up');
  assert.equal(deltaDirection(-12), 'down');
});

test('formatDelta shows a percentage when there is a baseline to divide by', () => {
  assert.equal(formatDelta(155.3, 0.34, 'sum'), '▲ 34%');
  assert.equal(formatDelta(-90, -0.41, 'sum'), '▼ 41%');
});

test('formatDelta falls back to an absolute amount when deltaPct is null', () => {
  // A bucket with no baseline has no percentage — never "▲ ∞%".
  assert.equal(formatDelta(40, null, 'sum'), '▲ $40.00');
  assert.equal(formatDelta(3, null, 'count'), '▲ 3');
});

test('formatDelta says so plainly when nothing moved', () => {
  assert.equal(formatDelta(0, 0, 'sum'), '– no change');
});

test('formatDelta is empty when there is no delta at all', () => {
  assert.equal(formatDelta(null, null, 'sum'), '');
});

test('deltaClass marks an increase as the warning direction', () => {
  // Up means MORE SPEND, which is the direction worth flagging.
  assert.equal(deltaClass(155.3), 'viz-delta viz-delta-up');
  assert.equal(deltaClass(-90), 'viz-delta viz-delta-down');
  assert.equal(deltaClass(null), 'viz-delta');
});

test('deltaChip renders nothing when the row has no baseline', () => {
  assert.equal(deltaChip({ baseline: null, delta: null, deltaPct: null }, 'sum', 'trailing3'), '');
  assert.equal(deltaChip({}, 'sum', 'trailing3'), '');
});

test('deltaChip names the baseline it is comparing against', () => {
  const html = deltaChip({ baseline: -200, delta: 100, deltaPct: 0.5 }, 'sum', 'trailing3');
  assert.match(html, /viz-delta-up/);
  assert.match(html, /▲ 50%/);
  assert.match(html, /vs 3-per avg/);
});

test('deltaChip escapes nothing user-authored into markup unescaped', () => {
  // The only interpolated text is a fixed label, but the escape must stay in
  // place so a future mode label cannot inject markup.
  const html = deltaChip({ baseline: -200, delta: 100, deltaPct: 0.5 }, 'sum', 'prevPeriod');
  assert.equal(html.includes('<script'), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/delta.test.js`
Expected: FAIL — `Cannot find module '.../web/delta.js'`

- [ ] **Step 3: Write the implementation**

Create `web/delta.js`:

```js
import { formatMeasure, escapeHtml } from './charts/scale.js';
import { BASELINE_SHORT_LABELS } from '../lib/query/periods.js';

const ARROW = { up: '▲', down: '▼', flat: '–' };

/** Sub-cent movement is noise, not a change worth an arrow. */
export function deltaDirection(delta) {
  if (delta === null || delta === undefined) return null;
  if (Math.abs(delta) < 0.005) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

/**
 * "▲ 34%" — or "▲ $40.00" when there is no baseline to take a percentage of,
 * because a bucket that did not exist before has no meaningful percentage.
 */
export function formatDelta(delta, deltaPct, measure) {
  const direction = deltaDirection(delta);
  if (!direction) return '';
  if (direction === 'flat') return `${ARROW.flat} no change`;
  const body = deltaPct === null || deltaPct === undefined
    ? formatMeasure(Math.abs(delta), measure)
    : `${Math.round(Math.abs(deltaPct) * 100)}%`;
  return `${ARROW[direction]} ${body}`;
}

/** Up means MORE SPEND, so it takes the warning colour, not a "growth is good" one. */
export function deltaClass(delta) {
  const direction = deltaDirection(delta);
  return direction ? `viz-delta viz-delta-${direction}` : 'viz-delta';
}

export function deltaChip(row = {}, measure = 'sum', mode = 'off') {
  if (row.baseline === null || row.baseline === undefined) return '';
  const text = formatDelta(row.delta, row.deltaPct, measure);
  if (!text) return '';
  const suffix = BASELINE_SHORT_LABELS[mode] ? ` ${BASELINE_SHORT_LABELS[mode]}` : '';
  return `<span class="${deltaClass(row.delta)}">${escapeHtml(text + suffix)}</span>`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/delta.test.js`
Expected: PASS, 10 tests

- [ ] **Step 5: Confirm the module graph test still passes**

`web/delta.js` imports from both `web/charts/` and `lib/query/`. `tests/module-graph.test.js` asserts the layering rules.

Run: `node --test tests/module-graph.test.js tests/web-modules.test.js`
Expected: PASS. If the module-graph test rejects the new file, read its assertions and add `web/delta.js` to whichever allow-list describes `web/` modules that may import from `lib/query/` — `web/panel.js` and `web/overview-view.js` already do exactly this.

- [ ] **Step 6: Commit**

```bash
git add web/delta.js tests/delta.test.js
git commit -m "feat: add shared delta formatting for comparison chips"
```

---

## Task 4: the comparison control in the filter bar

**Files:**
- Modify: `web/filter-bar.js` (`renderFilterBar`, `readFilterBar`)
- Test: `tests/filter-bar.test.js`

**Interfaces:**
- Consumes: `BASELINE_MODES`, `BASELINE_LABELS` from `lib/query/periods.js` (Task 1).
- Produces: `renderFilterBar(snapshot, filters, compareMode)` now takes a third argument (default `'off'`) and emits a `<select data-filter="compare">`. `readFilterBar(root)` now returns a `compare` key alongside the existing four. `toQueryFilters` is **unchanged** — `compare` is not a query filter and must never reach a query spec.

- [ ] **Step 1: Write the failing tests**

Append to `tests/filter-bar.test.js`:

```js
import { BASELINE_LABELS } from '../lib/query/periods.js';

const SNAPSHOT_FOR_COMPARE = {
  transactions: [{ date: '2026-08-10' }],
  accounts: [],
  categories: { groups: [{ id: 'food-drink', label: 'Food & Drink' }], categories: [] }
};

test('the filter bar renders a comparison control with every baseline mode', () => {
  const html = renderFilterBar(SNAPSHOT_FOR_COMPARE, {}, 'off');
  assert.match(html, /data-filter="compare"/);
  for (const label of Object.values(BASELINE_LABELS)) {
    assert.ok(html.includes(label), `missing option: ${label}`);
  }
});

test('the comparison control marks the current mode as selected', () => {
  const html = renderFilterBar(SNAPSHOT_FOR_COMPARE, {}, 'trailing3');
  assert.match(html, /value="trailing3" selected/);
  assert.equal(/value="prevPeriod" selected/.test(html), false);
});

test('the comparison control defaults to off when given an unknown mode', () => {
  const html = renderFilterBar(SNAPSHOT_FOR_COMPARE, {}, 'nonsense');
  assert.match(html, /value="off" selected/);
});

test('toQueryFilters never leaks the comparison mode into a query spec', () => {
  const spec = toQueryFilters({ month: '2026-08', compare: 'trailing3' });
  assert.equal(spec.compare, undefined);
  assert.equal(spec.dateFrom, '2026-08-01');
});
```

Note: the existing file already imports `test`, `assert`, `renderFilterBar` and `toQueryFilters`; add only the `BASELINE_LABELS` import at the top alongside them.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/filter-bar.test.js`
Expected: FAIL — no `data-filter="compare"` in the output

- [ ] **Step 3: Write the implementation**

In `web/filter-bar.js`, add the import at the top:

```js
import { BASELINE_MODES, BASELINE_LABELS } from '../lib/query/periods.js';
```

Replace `renderFilterBar` with:

```js
/**
 * The global filter bar. Its values are the `filters` half of a query spec, so
 * they compose with each panel's own filters with no special-casing.
 *
 * `compareMode` is the one control here that is NOT a filter — it selects a
 * baseline rather than narrowing the data, so it is passed separately and
 * deliberately never reaches toQueryFilters().
 */
export function renderFilterBar(snapshot, filters = {}, compareMode = 'off') {
  const options = filterOptions(snapshot);
  const mode = BASELINE_MODES.includes(compareMode) ? compareMode : 'off';
  const compareOptions = BASELINE_MODES
    .filter((m) => m !== 'off')
    .map((m) => ({ value: m, label: BASELINE_LABELS[m] }));

  return `
  <div class="viz-filter-bar">
    ${select('month', 'Period', options.months, filters.month ?? '', 'All time')}
    ${select('accountIds', 'Account', options.accounts, (filters.accountIds ?? [])[0] ?? '', 'All accounts')}
    ${select('people', 'Person', options.people, (filters.people ?? [])[0] ?? '', 'Both of us')}
    ${select('groupIds', 'Group', options.groups, (filters.groupIds ?? [])[0] ?? '', 'All groups')}
    <label class="viz-control">
      <span class="viz-control-label">Compare</span>
      <select data-filter="compare">
        <option value="off"${mode === 'off' ? ' selected' : ''}>${escapeHtml(BASELINE_LABELS.off)}</option>
        ${compareOptions.map((o) => `<option value="${escapeHtml(o.value)}"${o.value === mode ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
      </select>
    </label>
  </div>`;
}
```

Replace `readFilterBar` with:

```js
/** Read the live filter bar back into a filters object, plus the comparison mode. */
export function readFilterBar(root) {
  const value = (name) => root.querySelector(`[data-filter="${name}"]`)?.value ?? '';
  const one = (name) => (value(name) ? [value(name)] : []);
  const compare = value('compare');
  return {
    month: value('month'),
    accountIds: one('accountIds'),
    people: one('people'),
    groupIds: one('groupIds'),
    compare: BASELINE_MODES.includes(compare) ? compare : 'off'
  };
}
```

`toQueryFilters` is left exactly as it is — it destructures only the four known filter keys, so a `compare` key on the object it is handed is already ignored.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/filter-bar.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/filter-bar.js tests/filter-bar.test.js
git commit -m "feat: add a global comparison control to the filter bar"
```

---

## Task 5: ghost baseline bars on the bar chart

**Files:**
- Modify: `web/charts/chart-bar.js`
- Test: `tests/charts-bar.test.js`

**Interfaces:**
- Consumes: `formatDelta`, `deltaClass` from `web/delta.js` (Task 3); rows carrying `baseline`/`delta`/`deltaPct` from `compareQuery` (Task 2).
- Produces: no new exports. `renderBar` gains a dashed outline rect per row and a delta text column, both only when at least one row carries a non-null `baseline`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/charts-bar.test.js`:

```js
import { renderBar as renderBarForBaseline } from '../web/charts/chart-bar.js';

const withBaseline = (rows) => ({ rows, total: 0, stats: {}, meta: { measure: 'sum' } });

test('the bar chart draws no ghost bar when no row has a baseline', () => {
  const svg = renderBarForBaseline(withBaseline([
    { key: 'groceries', label: 'Groceries', value: -300, count: 3, baseline: null, delta: null, deltaPct: null }
  ]));
  assert.equal(svg.includes('viz-ghost'), false);
  assert.equal(svg.includes('viz-delta'), false);
});

test('the bar chart draws a dashed ghost bar and a delta label when a baseline exists', () => {
  const svg = renderBarForBaseline(withBaseline([
    { key: 'groceries', label: 'Groceries', value: -300, count: 3, baseline: -200, delta: 100, deltaPct: 0.5 }
  ]));
  assert.match(svg, /class="viz-ghost"/);
  assert.match(svg, /stroke-dasharray/);
  assert.match(svg, /viz-delta-up/);
  assert.match(svg, /▲ 50%/);
});

test('the bar scale accounts for a baseline taller than every real bar', () => {
  // Spending collapsed this month. The ghost bar is the widest mark on the
  // chart, so the domain must come from it or it would overflow the plot.
  const svg = renderBarForBaseline(withBaseline([
    { key: 'groceries', label: 'Groceries', value: -50, count: 1, baseline: -500, delta: -450, deltaPct: -0.9 }
  ]));
  const widths = [...svg.matchAll(/width="([\d.]+)"/g)].map((m) => Number(m[1]));
  const plotWidth = 600 - 150 - (96 + 74);
  assert.ok(widths.every((w) => w <= plotWidth + 1), `a mark overflowed the plot: ${widths}`);
});

test('a row with a zero baseline still renders without a ghost bar of negative width', () => {
  const svg = renderBarForBaseline(withBaseline([
    { key: 'shopping', label: 'Shopping', value: -40, count: 1, baseline: 0, delta: 40, deltaPct: null }
  ]));
  assert.equal(svg.includes('width="-'), false);
  assert.match(svg, /▲ \$40\.00/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/charts-bar.test.js`
Expected: FAIL — no `viz-ghost` in the output

- [ ] **Step 3: Write the implementation**

Replace the whole of `web/charts/chart-bar.js`:

```js
import { linearScale, formatMeasure, escapeHtml } from './scale.js';
import { formatDelta, deltaClass } from '../delta.js';

const ROW_HEIGHT = 34;
const BAR_HEIGHT = 16;      // thin marks
const LABEL_WIDTH = 150;
const VALUE_WIDTH = 96;
const DELTA_WIDTH = 74;     // only reserved when a comparison is active
const GAP = 2;              // 2px surface gap between adjacent fills

/**
 * Horizontal bar chart. Every bar is direct-labelled with its name and value —
 * that is the relief the palette's light-mode contrast WARN requires.
 *
 * When the result carries a baseline, each bar gets a dashed outline at the
 * baseline value behind it, so the SIZE of the gap is visible and not just its
 * percentage. The outline is drawn first and never captures pointer events, so
 * click-to-drill still hits the solid bar.
 */
export function renderBar(result, { mode = 'light', colourFor, title = '' } = {}) {
  const rows = result.rows ?? [];
  if (!rows.length) {
    return `<svg role="img" aria-label="${escapeHtml(title)}: no data" viewBox="0 0 600 60" width="100%"><text x="300" y="34" text-anchor="middle" class="viz-empty">No data for these filters</text></svg>`;
  }

  const hasBaseline = rows.some((r) => r.baseline !== null && r.baseline !== undefined);
  const width = 600;
  const valueWidth = VALUE_WIDTH + (hasBaseline ? DELTA_WIDTH : 0);
  const plotWidth = width - LABEL_WIDTH - valueWidth;
  const height = rows.length * ROW_HEIGHT;
  // The domain includes baselines: a month whose spend collapsed has a ghost
  // bar wider than every real bar, and it must still fit the plot.
  const maxValue = Math.max(...rows.map((r) => Math.max(Math.abs(r.value), Math.abs(r.baseline ?? 0))));
  const scale = linearScale(maxValue, plotWidth);
  const measure = result.meta?.measure;
  const valueX = width - (hasBaseline ? DELTA_WIDTH : 0);

  const bars = rows.map((row, i) => {
    const y = i * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;
    const barWidth = Math.max(scale(row.value) - GAP, 0);
    const colour = colourFor ? colourFor(row) : 'currentColor';
    const showGhost = row.baseline !== null && row.baseline !== undefined;
    const ghostWidth = showGhost ? Math.max(scale(row.baseline) - GAP, 0) : 0;

    const ghost = showGhost
      ? `<rect x="${LABEL_WIDTH}" y="${(y - 3).toFixed(1)}" width="${ghostWidth.toFixed(1)}" height="${BAR_HEIGHT + 6}"
              rx="4" fill="none" stroke="${colour}" stroke-width="1" stroke-dasharray="3 2" class="viz-ghost"/>`
      : '';
    const delta = hasBaseline
      ? `<text x="${width}" y="${y + BAR_HEIGHT - 3}" text-anchor="end" class="${deltaClass(row.delta)}">${escapeHtml(formatDelta(row.delta, row.deltaPct, measure))}</text>`
      : '';

    return `
    <g>
      <text x="0" y="${y + BAR_HEIGHT - 3}" class="viz-label">${escapeHtml(row.label)}</text>
      ${ghost}
      <rect x="${LABEL_WIDTH}" y="${y}" width="${barWidth.toFixed(1)}" height="${BAR_HEIGHT}"
            rx="4" fill="${colour}" class="viz-clickable" data-slice-key="${escapeHtml(row.key)}"><title>${escapeHtml(row.label)}: ${formatMeasure(row.value, measure)} · ${row.count} txns</title></rect>
      <text x="${valueX}" y="${y + BAR_HEIGHT - 3}" text-anchor="end" class="viz-value">${formatMeasure(row.value, measure)}</text>
      ${delta}
    </g>`;
  }).join('');

  return `<svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" class="viz-bar">${bars}</svg>`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/charts-bar.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/charts/chart-bar.js tests/charts-bar.test.js
git commit -m "feat: draw ghost baseline bars and delta labels on the bar chart"
```

---

## Task 6: baseline series on the line chart, Δ column in Table view

**Files:**
- Modify: `web/charts/chart-line.js`, `web/charts/chart-table.js`
- Test: `tests/charts-timeseries.test.js`

**Interfaces:**
- Consumes: `formatDelta`, `deltaClass` from `web/delta.js` (Task 3).
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Append to `tests/charts-timeseries.test.js`:

```js
import { renderLine as renderLineForBaseline } from '../web/charts/chart-line.js';
import { renderTable as renderTableForBaseline } from '../web/charts/chart-table.js';

const monthResult = (rows) => ({ rows, total: 0, stats: {}, meta: { sliceBy: 'month', measure: 'sum' } });

test('the line chart draws a dashed baseline series when rows carry a baseline', () => {
  const svg = renderLineForBaseline(monthResult([
    { key: '2026-07', label: 'Jul 2026', value: -200, count: 1, baseline: -150, delta: 50, deltaPct: 0.33 },
    { key: '2026-08', label: 'Aug 2026', value: -340, count: 2, baseline: -175, delta: 165, deltaPct: 0.94 }
  ]));
  assert.match(svg, /class="viz-ghost-line"/);
  assert.match(svg, /stroke-dasharray/);
});

test('the line chart draws no baseline series without baselines', () => {
  const svg = renderLineForBaseline(monthResult([
    { key: '2026-08', label: 'Aug 2026', value: -340, count: 2, baseline: null, delta: null, deltaPct: null }
  ]));
  assert.equal(svg.includes('viz-ghost-line'), false);
});

test('the line chart y-domain covers a baseline higher than every point', () => {
  const svg = renderLineForBaseline(monthResult([
    { key: '2026-08', label: 'Aug 2026', value: -50, count: 1, baseline: -900, delta: -850, deltaPct: -0.94 }
  ]));
  const ys = [...svg.matchAll(/cy="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(ys.every((y) => y >= 0), `a marker was plotted above the viewBox: ${ys}`);
});

test('the table adds a delta column only when a baseline exists', () => {
  const withBaseline = renderTableForBaseline(monthResult([
    { key: '2026-08', label: 'Aug 2026', value: -340, count: 2, stats: { txnCount: 2, median: -170, largest: -300, top3Share: 1 }, baseline: -175, delta: 165, deltaPct: 0.94 }
  ]));
  assert.match(withBaseline, /<th scope="col" class="num">Δ<\/th>/);
  assert.match(withBaseline, /▲ 94%/);

  const without = renderTableForBaseline(monthResult([
    { key: '2026-08', label: 'Aug 2026', value: -340, count: 2, stats: { txnCount: 2, median: -170, largest: -300, top3Share: 1 }, baseline: null, delta: null, deltaPct: null }
  ]));
  assert.equal(without.includes('>Δ<'), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/charts-timeseries.test.js`
Expected: FAIL — no `viz-ghost-line`, no `Δ` header

- [ ] **Step 3: Implement the line chart change**

In `web/charts/chart-line.js`, add the import at the top:

```js
import { formatDelta, deltaClass } from '../delta.js';
```

Replace the `maxValue` line:

```js
  const maxValue = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
```

with:

```js
  const hasBaseline = rows.some((r) => r.baseline !== null && r.baseline !== undefined);
  // The domain covers baselines too, so a collapsed month's baseline line does
  // not run off the top of the plot.
  const maxValue = Math.max(...rows.map((r) => Math.max(Math.abs(r.value), Math.abs(r.baseline ?? 0))), 1);
```

Then, immediately after the existing `const polyline = ...` line, add:

```js
  // Drawn before the solid series so the real values always sit on top.
  const baselineLine = hasBaseline
    ? `<polyline points="${rows.map((row, i) => `${(PAD.left + i * stepX).toFixed(1)},${(PAD.top + plotH - yScale(row.baseline ?? 0)).toFixed(1)}`).join(' ')}" fill="none" stroke="${colour}" stroke-width="1.5" stroke-dasharray="4 3" class="viz-ghost-line"/>`
    : '';
```

Finally, change the return statement from `...${grid}${polyline}${markers}...` to place the baseline between the grid and the solid line, and append the delta on the last point's label:

```js
  const lastRow = rows.at(-1);
  const lastDelta = hasBaseline && points.length
    ? `<text x="${points.at(-1).x.toFixed(1)}" y="${(points.at(-1).y - 26).toFixed(1)}" text-anchor="end" class="${deltaClass(lastRow.delta)}">${escapeHtml(formatDelta(lastRow.delta, lastRow.deltaPct, measure))}</text>`
    : '';

  return `<svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${width} ${HEIGHT}" width="${width}" class="viz-line">${grid}${baselineLine}${polyline}${markers}${endLabels}${lastDelta}${xLabels}</svg>`;
```

- [ ] **Step 4: Implement the table change**

Replace the whole of `web/charts/chart-table.js`:

```js
import { formatMeasure, escapeHtml, concentrationLine } from './scale.js';
import { formatDelta, deltaClass } from '../delta.js';

/**
 * Table view. Always available for every panel — it is the accessible relief
 * for the palette's light-mode contrast WARN and for colour-blind readers,
 * so it must never be removed from the chart-type list.
 *
 * That relief obligation is also why the delta appears here as text: the ghost
 * bars on the other charts encode the comparison partly by shape, and this is
 * the view that must state it in words.
 */
export function renderTable(result, { title = '' } = {}) {
  const rows = result.rows ?? [];
  if (!rows.length) return `<p class="viz-empty">No data for these filters</p>`;

  const measure = result.meta?.measure;
  const hasBaseline = rows.some((r) => r.baseline !== null && r.baseline !== undefined);

  const body = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.label)}</td>
      <td class="num">${formatMeasure(row.value, measure)}</td>
      ${hasBaseline ? `<td class="num ${deltaClass(row.delta)}">${escapeHtml(formatDelta(row.delta, row.deltaPct, measure))}</td>` : ''}
      <td class="num">${row.count}</td>
      <td class="viz-note">${escapeHtml(concentrationLine(row.stats))}</td>
    </tr>`).join('');

  return `
  <table class="viz-table">
    <caption class="viz-caption">${escapeHtml(title)}</caption>
    <thead><tr><th scope="col">Name</th><th scope="col" class="num">Value</th>${hasBaseline ? '<th scope="col" class="num">Δ</th>' : ''}<th scope="col" class="num">Txns</th><th scope="col">Shape</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/charts-timeseries.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/charts/chart-line.js web/charts/chart-table.js tests/charts-timeseries.test.js
git commit -m "feat: add baseline series to the line chart and a delta column to Table view"
```

---

## Task 7: wire the comparison through the panel, the KPI row and the styles

**Files:**
- Modify: `web/panel.js`, `web/overview-view.js`, `web/style.css`
- Test: `tests/overview-panels.test.js`

**Interfaces:**
- Consumes: `compareQuery` (Task 2), `deltaChip` (Task 3), `readFilterBar` returning `compare` (Task 4).
- Produces: `createPanel(...).html(snapshot, globalFilters, compareMode)` takes a third argument (default `'off'`). `renderOverview(snapshot, uiFilters, panelConfigs, extraFilters, hiddenCount, searchQuery, compareMode)` takes a seventh argument (default `'off'`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/overview-panels.test.js`:

```js
import { createPanel as createPanelForCompare } from '../web/panel.js';
import { renderOverview as renderOverviewForCompare } from '../web/overview-view.js';

const cmpTxn = (over) => ({
  id: 'x', date: '2026-08-10', amount: -10, rawDescription: 'R', merchant: 'M',
  accountId: 'a', cardSuffix: null, categoryId: 'groceries', categorySource: 'rule',
  excluded: false, importId: 'i', note: null, ...over
});

const CMP_SNAPSHOT = {
  categories: {
    groups: [{ id: 'food-drink', label: 'Food & Drink' }],
    categories: [{ id: 'groceries', label: 'Groceries', groupId: 'food-drink' }]
  },
  accounts: [],
  transactions: [
    cmpTxn({ id: 'j1', date: '2026-07-10', amount: -200 }),
    cmpTxn({ id: 'a1', date: '2026-08-10', amount: -300 })
  ]
};

const AUG_FILTERS = { month: '2026-08' };

test('a panel renders no comparison markup when the mode is off', () => {
  const html = createPanelForCompare({ id: 'p', title: 'T', sliceBy: 'category', measure: 'sum', chartType: 'bar' })
    .html(CMP_SNAPSHOT, { dateFrom: '2026-08-01', dateTo: '2026-08-31' }, 'off');
  assert.equal(html.includes('viz-ghost'), false);
});

test('a panel renders ghost bars when a comparison mode is passed', () => {
  const html = createPanelForCompare({ id: 'p', title: 'T', sliceBy: 'category', measure: 'sum', chartType: 'bar' })
    .html(CMP_SNAPSHOT, { dateFrom: '2026-08-01', dateTo: '2026-08-31' }, 'prevPeriod');
  assert.match(html, /viz-ghost/);
  assert.match(html, /▲ 50%/);
});

test('the KPI row shows a delta chip naming the baseline', () => {
  const html = renderOverviewForCompare(CMP_SNAPSHOT, AUG_FILTERS, [], {}, 0, '', 'prevPeriod');
  assert.match(html, /viz-delta-up/);
  assert.match(html, /vs prev/);
});

test('the KPI row shows no delta chip when comparison is off', () => {
  const html = renderOverviewForCompare(CMP_SNAPSHOT, AUG_FILTERS, [], {}, 0, '', 'off');
  assert.equal(html.includes('viz-delta-up'), false);
});

test('the KPI row shows no delta chip when the baseline predates the ledger', () => {
  // July is the first month in this ledger, so June has no history to compare.
  const html = renderOverviewForCompare(CMP_SNAPSHOT, { month: '2026-07' }, [], {}, 0, '', 'prevPeriod');
  assert.equal(html.includes('viz-delta-up'), false);
  assert.equal(html.includes('viz-delta-down'), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/overview-panels.test.js`
Expected: FAIL — `html()` ignores its third argument

- [ ] **Step 3: Change `web/panel.js`**

Replace the import of `query`:

```js
import { query } from '../lib/query/query.js';
```

with:

```js
import { compareQuery } from '../lib/query/compare.js';
```

Change the `html` signature and the `result` line inside `createPanel`:

```js
    html(snapshot, globalFilters = {}, compareMode = 'off') {
      const spec = {
        filters: { ...globalFilters, ...config.filters },
        sliceBy: config.sliceBy,
        measure: config.measure
      };
      // compareQuery with mode 'off' runs query() exactly once and returns the
      // same rows with null baseline fields — one code path, no branch here.
      const result = compareQuery(snapshot, spec, compareMode);
```

Everything else in `html()` is unchanged: the `dots` and `stacked` branches derive their own points and series from `applyFilters`, which is untouched.

`colourResolver` still imports nothing new. Confirm `query` is no longer referenced anywhere in the file and remove the now-unused import if the linterless check `grep -n "query(" web/panel.js` shows only `compareQuery`.

- [ ] **Step 4: Change `web/overview-view.js`**

Add to the imports at the top:

```js
import { compareQuery } from '../lib/query/compare.js';
import { deltaChip } from './delta.js';
import { BASELINE_MODES } from '../lib/query/periods.js';
```

Add the storage key and its accessors next to the existing panel-config ones:

```js
const COMPARE_KEY = 'spendexplore.overview.compare';

/**
 * The comparison baseline is a preference, not a filter — it persists across
 * reloads the way panel configs do. Trailing-3 is the default because a single
 * lumpy month makes prevPeriod swing in both directions for two months running.
 */
function loadCompareMode() {
  try {
    const stored = globalThis.localStorage?.getItem(COMPARE_KEY);
    return BASELINE_MODES.includes(stored) ? stored : 'trailing3';
  } catch {
    return 'trailing3';
  }
}

function saveCompareMode(mode) {
  try {
    globalThis.localStorage?.setItem(COMPARE_KEY, mode);
  } catch { /* storage unavailable — the mode simply does not persist */ }
}
```

Replace `kpiRow` with:

```js
function kpiRow(snapshot, globalFilters, compareMode = 'off') {
  const result = compareQuery(snapshot, { filters: globalFilters, sliceBy: 'category', measure: 'sum' }, compareMode);
  const needsReview = (snapshot.transactions ?? []).filter((t) => t.categorySource === 'unknown' && !t.excluded).length;

  // The grand-total row is shaped like a query row so deltaChip can format it
  // with no special case.
  const totalRow = { baseline: result.baselineTotal, delta: result.baselineDelta, deltaPct: result.baselineDeltaPct };
  const countRow = result.baselineAvailable
    ? { baseline: 0, delta: null, deltaPct: null }
    : {};

  return `
  <div class="kpis">
    <div class="kpi"><span>Total spend</span><b>${formatMoney(result.total)}</b>${deltaChip(totalRow, 'sum', compareMode)}</div>
    <div class="kpi"><span>Transactions</span><b>${result.stats.txnCount}</b>${deltaChip(countRow, 'count', compareMode)}</div>
    <div class="kpi"><span>Largest single</span><b>${formatMoney(result.stats.largest)}</b></div>
    <div class="kpi"><span>Needs review</span><b class="${needsReview ? 'warn' : ''}">${needsReview}</b></div>
  </div>`;
}
```

Replace `renderOverview`'s signature and body:

```js
export function renderOverview(snapshot, uiFilters = {}, panelConfigs = DEFAULT_PANELS, extraFilters = {}, hiddenCount = 0, searchQuery = '', compareMode = 'off') {
  if (!(snapshot.transactions ?? []).length) {
    return '<p class="empty">No transactions yet — import a CSV to get started.</p>';
  }
  const queryFilters = { ...toQueryFilters(uiFilters), ...extraFilters };
  const panels = panelConfigs
    .map((config) => createPanel(config).html(snapshot, queryFilters, compareMode))
    .join('');
  const hiddenBanner = hiddenCount > 0
    ? `<p class="viz-note hidden-banner">${hiddenCount} transaction${hiddenCount === 1 ? '' : 's'} hidden this session · <button data-overview-action="show-all">Show all</button></p>`
    : '';

  return `
    ${kpiRow(snapshot, queryFilters, compareMode)}
    ${hiddenBanner}
    ${searchBox(searchQuery)}
    ${renderFilterBar(snapshot, uiFilters, compareMode)}
    ${panels}`;
}
```

In `mountOverview`, add the mode to the local state, just after `let filters = {};`:

```js
  let compareMode = loadCompareMode();
```

Change `draw()`:

```js
  const draw = () => {
    root.innerHTML = renderOverview(current, filters, configs, extraFilters(), excludedIds.size, searchQuery, compareMode);
    drawDrilldown();
  };
```

And in the `change` listener, replace the filter branch so a comparison change is persisted:

```js
    if (target?.dataset?.filter) {
      const read = readFilterBar(root);
      filters = read;
      if (read.compare !== compareMode) {
        compareMode = read.compare;
        saveCompareMode(compareMode);
      }
      draw();
      return;
    }
```

`readFilterBar` now returns `compare` inside the same object assigned to `filters`; `toQueryFilters` ignores it, which Task 4's test pins.

- [ ] **Step 5: Add the styles**

Append to `web/style.css`, at the end of the `/* ---- charts ---- */` block:

```css
.viz-delta { font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.viz-delta-up { color: var(--warn); fill: var(--warn); }
.viz-delta-down { color: var(--muted); fill: var(--muted); }
.viz-delta-flat { color: var(--muted); fill: var(--muted); }
.kpi .viz-delta { display: block; margin-top: 3px; }
/* Baseline marks are decoration behind the real value — they must never
   intercept the click that opens the drill-down panel. */
.viz-ghost, .viz-ghost-line { pointer-events: none; opacity: .55; }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/overview-panels.test.js`
Expected: PASS

- [ ] **Step 7: Run the whole suite**

Run: `node --test 'tests/**/*.test.js'`
Expected: PASS. The no-external-host assertion in the web tests must still pass — nothing added here references an external host.

- [ ] **Step 8: Verify live against the isolated data directory**

**Never run this against `data/`.** Per `CLAUDE.md`, live checks use the test server only.

```bash
npm run start:test
```

Open <http://127.0.0.1:5174>. If `data-test/` is empty, import a synthetic CSV from `tests/fixtures/` — write one covering at least three consecutive months if none does. Then confirm:

1. The **Compare** control appears in the filter bar and defaults to *vs 3-period average*.
2. Selecting a single month shows delta chips on Total spend, ghost outlines behind the bars, and a Δ column in Table view.
3. Selecting **All time** hides every delta — there is no baseline for an unbounded window.
4. Selecting the ledger's **earliest** month hides every delta — the baseline predates the data.
5. Reloading the page keeps the chosen comparison mode.
6. Clicking a bar still opens the drill-down panel — the ghost outline does not steal the click.

- [ ] **Step 9: Update the changelog**

Read `~/.claude/changelog-format.md` first, then add an entry to `CHANGELOG.md` covering the new comparison feature.

- [ ] **Step 10: Commit**

```bash
git add web/panel.js web/overview-view.js web/style.css tests/overview-panels.test.js CHANGELOG.md
git commit -m "feat: wire period comparison through panels, KPIs and the filter bar"
```

---

## Self-Review Notes

- **Coverage:** every decision from the questions is implemented — `compare()` wrapper (Task 2), trailing-3 default with a switch to previous period (Task 7's `loadCompareMode` + Task 4's control), global filter-bar placement (Task 4), ghost bars plus delta text (Tasks 5–6).
- **Deferred deliberately:** the Movers panel was not requested and is not built here. `compareQuery`'s `disappeared` array is the data a Movers panel would need, and the monthly-digest plan consumes it.
- **Known limitation:** the Account and Person filters remain inert because `accounts` is never written by any route (see the comment in `server/store.js`). Comparison does not change that.
