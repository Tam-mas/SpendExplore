# Monthly Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End the monthly import ritual with an answer instead of a receipt — a generated summary of what actually changed, in plain English, every line clickable through to the transactions behind it. Entirely local and entirely deterministic: no model call, no network, the same month always producing the same summary.

**Architecture:** Three separate stages, because collapsing them is what makes generated prose feel robotic. **Detectors** emit structured, numeric *findings* with no words in them. A **ranker** scores findings by materiality × surprise and applies suppression thresholds. A **renderer** turns the surviving findings into sentences. Variety comes from *which findings fire*, never from varied wording — so a quiet month and a chaotic month read differently without a single template changing. All three live in `lib/digest/` as pure functions and are unit-tested on their outputs; `web/digest-view.js` owns every piece of DOM.

**Tech Stack:** Node.js stdlib only, `node:test` + `node:assert/strict`, vanilla DOM. No new dependencies. **No LLM anywhere in this plan.**

## Dependencies

| Needs | From | Used for |
|---|---|---|
| `lib/query/periods.js` — `monthWindow`, `addDays`, `daySpan`, `shiftMonth`, `isMonthAligned` | `2026-08-24-comparison-baselines.md` Task 1 | Window arithmetic and proration |
| `lib/recurring.js` — `detectRecurring` | `2026-08-24-recurring-detection.md` Task 3 | The price-change finding |

This plan **does not** depend on `lib/query/compare.js`. The digest builds its own baselines, because it needs the individual per-window samples to compute surprise, and because its baseline windows are truncated to match a partial month — neither of which `compareQuery` does.

If the recurring plan has not been run, Task 2's price-change detector can be omitted; every other finding stands alone. Do not stub it.

## Global Constraints

- Zero npm dependencies. Node stdlib only. No build step; plain ES modules served directly.
- Run tests with `node --test 'tests/**/*.test.js'` or explicit file paths.
- `lib/` stays pure: no I/O, no DOM. `today` is always **injected**, never read from the clock inside a pure function, so every test is deterministic.
- **Sign convention.** The ledger stores spend as a negative amount. Every figure the digest reports is a **positive magnitude**, and a positive `delta` always means **more was spent**. Same rule as `lib/budgets.js` and `lib/query/compare.js`.
- **The digest never states a number that did not happen, without labelling it.** Real spend and a projection are visually and grammatically distinct: the projection is always hedged ("on pace for about…") and never leads a sentence.
- **The digest reports changes in spending, never changes in bookkeeping — unlabelled.** Where a category's movement is partly explained by review work, the sentence says so.
- **Suppression is a feature.** A finding below the materiality floor, or one with too little history behind it, is not reported. A short digest is correct; a padded one is not.
- Every new/changed test file must pass before its task's commit.
- Merchant and category labels come from bank CSVs and user input — escape with `escapeHtml` from `web/charts/scale.js` before any markup.
- No comments explaining WHAT code does, only non-obvious WHY.
- **Live verification must use `npm run start:test`** (`DATA_DIR=./data-test`, port 5174). Never against `data/`; never read files from outside this repo. See `CLAUDE.md`.

---

## File Structure

| File | Change |
|---|---|
| `lib/digest/baseline.js` | **New.** Window truncation, per-window queries, samples, projection |
| `lib/digest/taxonomy.js` | **New.** How much of a movement is review work rather than spending |
| `lib/digest/findings.js` | **New.** The six detectors |
| `lib/digest/rank.js` | **New.** Scoring and suppression |
| `lib/digest/render.js` | **New.** Findings → sentences |
| `lib/digest/index.js` | **New.** `buildDigest` — the one entry point |
| `web/digest-view.js` | **New.** `renderDigest` (pure), `mountDigest` (DOM) |
| `web/import-view.js` | Land on the digest after a successful commit |
| `web/app.js` | Wire the digest's post-import handoff |
| `web/overview-view.js` | Collapsible digest section at the top |
| `web/style.css` | Digest layout |
| `tests/digest-baseline.test.js`, `digest-taxonomy.test.js`, `digest-findings.test.js`, `digest-rank.test.js`, `digest-render.test.js`, `digest-view.test.js` | **New.** |

---

## Task 1: `lib/digest/baseline.js` — proration and per-window samples

**Files:**
- Create: `lib/digest/baseline.js`
- Test: `tests/digest-baseline.test.js`

**Interfaces:**
- Consumes: `query` from `lib/query/query.js`; `monthWindow`, `shiftMonth`, `addDays`, `daySpan` from `lib/query/periods.js`.
- Produces: `truncateToToday(window, today) → { window, elapsedDays, totalDays, isPartial }`; `matchWindow(window, elapsedDays) → window`; `digestBaseline(snapshot, { monthKey, today, windowCount, sliceBy, measure }) → { current, currentWindow, isPartial, elapsedDays, totalDays, projectionFactor, baselines, coveredCount, averageFor, samplesFor, currentFor }`. Tasks 2–4 depend on these names.

**Proration, precisely.** Both readings are produced, because both were asked for and they answer different questions:

- **Matched baseline** — the baseline windows are each cut to the *same number of elapsed days*. Comparing 18 days of August against the first 18 days of July, June and May means every figure on screen is money that actually left the account.
- **Projection** — `totalDays / elapsedDays`, applied only where a sentence explicitly hedges it.

- [ ] **Step 1: Write the failing tests**

Create `tests/digest-baseline.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncateToToday, matchWindow, digestBaseline } from '../lib/digest/baseline.js';

const t = (over) => ({
  id: 'x', date: '2026-08-10', amount: -10, rawDescription: 'R', merchant: 'M',
  accountId: 'a', cardSuffix: null, categoryId: 'groceries', categorySource: 'rule',
  excluded: false, importId: 'i', note: null, ...over
});

const SNAPSHOT = {
  accounts: [],
  categories: {
    groups: [{ id: 'food-drink', label: 'Food & Drink' }],
    categories: [
      { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
      { id: 'takeaway', label: 'Takeaway', groupId: 'food-drink' }
    ]
  },
  transactions: [
    // June: 100 early, 900 late.
    t({ id: 'j1', date: '2026-06-05', amount: -100 }),
    t({ id: 'j2', date: '2026-06-25', amount: -900 }),
    // July: 200 early, 800 late.
    t({ id: 'y1', date: '2026-07-05', amount: -200 }),
    t({ id: 'y2', date: '2026-07-25', amount: -800 }),
    // August, month to date.
    t({ id: 'a1', date: '2026-08-05', amount: -300 })
  ]
};

test('a window ending in the past is complete, not partial', () => {
  const result = truncateToToday({ dateFrom: '2026-07-01', dateTo: '2026-07-31' }, '2026-08-18');
  assert.equal(result.isPartial, false);
  assert.equal(result.elapsedDays, 31);
  assert.equal(result.totalDays, 31);
  assert.deepEqual(result.window, { dateFrom: '2026-07-01', dateTo: '2026-07-31' });
});

test('a window containing today is partial and is cut at today', () => {
  const result = truncateToToday({ dateFrom: '2026-08-01', dateTo: '2026-08-31' }, '2026-08-18');
  assert.equal(result.isPartial, true);
  assert.equal(result.elapsedDays, 18);
  assert.equal(result.totalDays, 31);
  assert.deepEqual(result.window, { dateFrom: '2026-08-01', dateTo: '2026-08-18' });
});

test('matchWindow cuts a baseline window to the same elapsed length', () => {
  assert.deepEqual(matchWindow({ dateFrom: '2026-07-01', dateTo: '2026-07-31' }, 18),
    { dateFrom: '2026-07-01', dateTo: '2026-07-18' });
});

test('matchWindow never runs past the end of the month it is matching', () => {
  // 31 elapsed days of July cannot be matched against 31 days of June — June
  // only has 30. Without the clamp the "June" baseline would reach into July
  // and double-count a day of the month being compared.
  assert.deepEqual(matchWindow({ dateFrom: '2026-06-01', dateTo: '2026-06-30' }, 31),
    { dateFrom: '2026-06-01', dateTo: '2026-06-30' });
});

test('a partial month is compared against the SAME point in earlier months', () => {
  // By 10 August only the early-month spend has happened. Comparing it to whole
  // months would report a collapse every single time.
  const result = digestBaseline(SNAPSHOT, { monthKey: '2026-08', today: '2026-08-10', windowCount: 2 });
  assert.equal(result.isPartial, true);
  assert.equal(result.current.total, -300);
  // Matched baselines are July 1-10 (200) and June 1-10 (100), averaging 150.
  assert.equal(result.averageFor('groceries'), -150);
});

test('the projection factor scales an elapsed window to the whole month', () => {
  const result = digestBaseline(SNAPSHOT, { monthKey: '2026-08', today: '2026-08-10', windowCount: 2 });
  assert.equal(result.totalDays, 31);
  assert.equal(result.elapsedDays, 10);
  assert.equal(result.projectionFactor, 3.1);
});

test('a complete month has a projection factor of exactly 1', () => {
  const result = digestBaseline(SNAPSHOT, { monthKey: '2026-07', today: '2026-08-24', windowCount: 1 });
  assert.equal(result.isPartial, false);
  assert.equal(result.projectionFactor, 1);
  assert.equal(result.current.total, -1000);
});

test('samplesFor exposes the individual window values, not just their average', () => {
  // The ranker needs the spread to know whether a movement is surprising.
  const result = digestBaseline(SNAPSHOT, { monthKey: '2026-08', today: '2026-08-31', windowCount: 2 });
  assert.deepEqual(result.samplesFor('groceries'), [-1000, -1000]);
  assert.equal(result.coveredCount, 2);
});

test('a key missing from one baseline window contributes zero to that sample', () => {
  const snapshot = {
    ...SNAPSHOT,
    transactions: [...SNAPSHOT.transactions, t({ id: 'k1', date: '2026-07-09', amount: -60, categoryId: 'takeaway' })]
  };
  const result = digestBaseline(snapshot, { monthKey: '2026-08', today: '2026-08-31', windowCount: 2 });
  // Takeaway appeared in July but not June — the June sample is a real zero.
  assert.deepEqual(result.samplesFor('takeaway'), [-60, 0]);
});

test('windows predating the ledger are dropped, not counted as zeroes', () => {
  const result = digestBaseline(SNAPSHOT, { monthKey: '2026-07', today: '2026-08-24', windowCount: 3 });
  // Only June has data before July; May and April predate the ledger entirely.
  assert.equal(result.coveredCount, 1);
});

test('a ledger with no earlier data reports zero covered windows', () => {
  const result = digestBaseline(SNAPSHOT, { monthKey: '2026-06', today: '2026-08-24', windowCount: 3 });
  assert.equal(result.coveredCount, 0);
  assert.deepEqual(result.samplesFor('groceries'), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/digest-baseline.test.js`
Expected: FAIL — `Cannot find module '.../lib/digest/baseline.js'`

- [ ] **Step 3: Write the implementation**

Create `lib/digest/baseline.js`:

```js
import { query } from '../query/query.js';
import { monthWindow, shiftMonth, addDays, daySpan } from '../query/periods.js';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Cut a window at today if today falls inside it.
 *
 * Statements do not respect calendar boundaries, so most imports land
 * mid-month. Comparing 18 elapsed days against a full-month baseline would
 * report "spending down 40%" every single time.
 */
export function truncateToToday(window, today) {
  const totalDays = daySpan(window);
  if (today >= window.dateTo) {
    return { window, elapsedDays: totalDays, totalDays, isPartial: false };
  }
  const cut = { dateFrom: window.dateFrom, dateTo: today };
  return { window: cut, elapsedDays: daySpan(cut), totalDays, isPartial: true };
}

/**
 * The first `elapsedDays` of a window — the like-for-like baseline.
 *
 * Clamped to the window's own end: 31 elapsed days of July cannot be matched
 * against 31 days of June, because June has 30. Without the clamp the "June"
 * baseline would reach into July and double-count a day of the very month
 * being compared.
 */
export const matchWindow = (window, elapsedDays) => {
  const wanted = addDays(window.dateFrom, elapsedDays - 1);
  return { dateFrom: window.dateFrom, dateTo: wanted > window.dateTo ? window.dateTo : wanted };
};

function earliestDate(snapshot) {
  let earliest = null;
  for (const txn of snapshot?.transactions ?? []) {
    if (earliest === null || txn.date < earliest) earliest = txn.date;
  }
  return earliest;
}

/**
 * Everything the detectors need about one month and the months before it.
 *
 * Deliberately does NOT use lib/query/compare.js: the digest needs the
 * individual per-window values to judge how surprising a movement is, and its
 * baseline windows are cut to match a partial month — neither of which
 * compareQuery does.
 */
export function digestBaseline(snapshot, {
  monthKey, today, windowCount = 3, sliceBy = 'category', measure = 'sum', filters = {}
} = {}) {
  const full = monthWindow(monthKey);
  const { window: currentWindow, elapsedDays, totalDays, isPartial } = truncateToToday(full, today);

  const specFor = (w) => ({ filters: { ...filters, dateFrom: w.dateFrom, dateTo: w.dateTo }, sliceBy, measure });
  const current = query(snapshot, specFor(currentWindow));

  const earliest = earliestDate(snapshot);
  const baselines = [];
  for (let n = 1; n <= windowCount; n++) {
    const priorMonth = monthWindow(shiftMonth(monthKey, -n));
    const matched = matchWindow(priorMonth, elapsedDays);
    // A window entirely before the ledger starts is missing history, not a
    // real zero. Counting it would drag every average toward nothing.
    if (earliest === null || matched.dateTo < earliest) continue;
    baselines.push({ window: matched, result: query(snapshot, specFor(matched)) });
  }

  const valueIn = (result, key) => result.rows.find((r) => r.key === key)?.value ?? 0;

  return {
    current,
    currentWindow,
    isPartial,
    elapsedDays,
    totalDays,
    projectionFactor: round2(totalDays / elapsedDays),
    baselines,
    coveredCount: baselines.length,
    /** One value per covered window, in recency order. A genuine zero stays a zero. */
    samplesFor: (key) => baselines.map((b) => valueIn(b.result, key)),
    averageFor: (key) => (baselines.length
      ? round2(baselines.reduce((a, b) => a + valueIn(b.result, key), 0) / baselines.length)
      : 0),
    currentFor: (key) => valueIn(current, key),
    baselineTotal: baselines.length
      ? round2(baselines.reduce((a, b) => a + b.result.total, 0) / baselines.length)
      : 0
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/digest-baseline.test.js`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add lib/digest/baseline.js tests/digest-baseline.test.js
git commit -m "feat: add digest baselines with matched-window proration"
```

---

## Task 2: taxonomy attribution — bookkeeping versus spending

**Files:**
- Create: `lib/digest/taxonomy.js`
- Test: `tests/digest-taxonomy.test.js`

**Interfaces:**
- Consumes: nothing outside the snapshot.
- Produces: `taxonomyAttribution(snapshot, { categoryId, currentWindow, baselineWindows }) → { amount, count, merchants }`.

**The mechanism this detects.** Correcting a transaction does **not** rewrite history unless you opt in — that is a deliberate design decision recorded in the README. So when you clear the review queue, this month's rows land in *Groceries* while the same merchant's earlier rows are still sitting in *Uncategorised*. Groceries appears to jump. Nothing about the spending changed.

The signal is therefore: **current-window spend in category C, from merchants that were still `uncategorised` during the baseline period.** That is computable exactly, from the snapshot as it stands, with no history of `categorySource` needed.

- [ ] **Step 1: Write the failing tests**

Create `tests/digest-taxonomy.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taxonomyAttribution } from '../lib/digest/taxonomy.js';

const t = (over) => ({
  id: 'x', date: '2026-08-10', amount: -10, rawDescription: 'R', merchant: 'M',
  accountId: 'a', cardSuffix: null, categoryId: 'groceries', categorySource: 'rule',
  excluded: false, importId: 'i', note: null, ...over
});

const CURRENT = { dateFrom: '2026-08-01', dateTo: '2026-08-31' };
const BASELINES = [
  { dateFrom: '2026-07-01', dateTo: '2026-07-31' },
  { dateFrom: '2026-06-01', dateTo: '2026-06-31' }
];

const ask = (transactions, categoryId = 'groceries') =>
  taxonomyAttribution({ transactions }, { categoryId, currentWindow: CURRENT, baselineWindows: BASELINES });

test('spend from a merchant that was uncategorised in the baseline is attributed to review work', () => {
  const result = ask([
    t({ id: 'b1', date: '2026-07-10', merchant: 'Bunnings', amount: -200, categoryId: 'uncategorised', categorySource: 'unknown' }),
    t({ id: 'a1', date: '2026-08-10', merchant: 'Bunnings', amount: -220, categoryId: 'groceries', categorySource: 'manual' })
  ]);
  assert.equal(result.amount, 220);
  assert.equal(result.count, 1);
  assert.deepEqual(result.merchants, ['Bunnings']);
});

test('a merchant already categorised in the baseline is NOT attributed', () => {
  const result = ask([
    t({ id: 'c1', date: '2026-07-10', merchant: 'Coles', amount: -200 }),
    t({ id: 'c2', date: '2026-08-10', merchant: 'Coles', amount: -420 })
  ]);
  assert.equal(result.amount, 0);
  assert.equal(result.count, 0);
});

test('only the named category is attributed, not every category the merchant touches', () => {
  const result = ask([
    t({ id: 'b1', date: '2026-07-10', merchant: 'Bunnings', amount: -200, categoryId: 'uncategorised', categorySource: 'unknown' }),
    t({ id: 'a1', date: '2026-08-10', merchant: 'Bunnings', amount: -220, categoryId: 'furniture', categorySource: 'manual' })
  ]);
  assert.equal(result.amount, 0);
});

test('a merchant appearing for the first time this month is not review work', () => {
  // It has no baseline rows at all, so it is new spending, not recategorised
  // spending. The new-merchant finding covers it instead.
  const result = ask([t({ id: 'a1', date: '2026-08-10', merchant: 'Brandnew', amount: -220, categorySource: 'manual' })]);
  assert.equal(result.amount, 0);
});

test('several affected merchants are summed and listed by size', () => {
  const result = ask([
    t({ id: 'b1', date: '2026-07-10', merchant: 'Bunnings', amount: -50, categoryId: 'uncategorised', categorySource: 'unknown' }),
    t({ id: 'o1', date: '2026-07-11', merchant: 'Officeworks', amount: -30, categoryId: 'uncategorised', categorySource: 'unknown' }),
    t({ id: 'a1', date: '2026-08-10', merchant: 'Bunnings', amount: -100, categorySource: 'manual' }),
    t({ id: 'a2', date: '2026-08-11', merchant: 'Officeworks', amount: -300, categorySource: 'bulk' })
  ]);
  assert.equal(result.amount, 400);
  assert.equal(result.count, 2);
  assert.deepEqual(result.merchants, ['Officeworks', 'Bunnings']);
});

test('excluded rows are ignored on both sides', () => {
  const result = ask([
    t({ id: 'b1', date: '2026-07-10', merchant: 'Bunnings', amount: -200, categoryId: 'uncategorised', categorySource: 'unknown', excluded: true }),
    t({ id: 'a1', date: '2026-08-10', merchant: 'Bunnings', amount: -220, categorySource: 'manual' })
  ]);
  assert.equal(result.amount, 0);
});

test('an empty ledger attributes nothing', () => {
  assert.deepEqual(ask([]), { amount: 0, count: 0, merchants: [] });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/digest-taxonomy.test.js`
Expected: FAIL — `Cannot find module '.../lib/digest/taxonomy.js'`

- [ ] **Step 3: Write the implementation**

Create `lib/digest/taxonomy.js`:

```js
const round2 = (n) => Math.round(n * 100) / 100;

const inAnyWindow = (date, windows) =>
  windows.some((w) => date >= w.dateFrom && date <= w.dateTo);

/**
 * How much of a category's movement is review work rather than a change in
 * spending.
 *
 * Correcting a transaction does NOT rewrite history unless you opt in — that
 * is deliberate (see the README). So clearing the review queue puts this
 * month's rows in Groceries while the same merchant's earlier rows are still
 * in Uncategorised, and Groceries appears to jump although nothing was spent
 * differently.
 *
 * The exact signal is therefore current-window spend in this category from
 * merchants that were still uncategorised across the baseline period. A
 * merchant with no baseline rows at all is NOT counted: that is genuinely new
 * spending, which the new-merchant finding reports instead.
 */
export function taxonomyAttribution(snapshot, { categoryId, currentWindow, baselineWindows = [] } = {}) {
  const transactions = (snapshot?.transactions ?? []).filter((t) => !t.excluded);

  const uncategorisedThen = new Set();
  for (const txn of transactions) {
    if (txn.categoryId !== 'uncategorised') continue;
    if (!inAnyWindow(txn.date, baselineWindows)) continue;
    uncategorisedThen.add(txn.merchant);
  }
  if (!uncategorisedThen.size) return { amount: 0, count: 0, merchants: [] };

  const byMerchant = new Map();
  for (const txn of transactions) {
    if (txn.categoryId !== categoryId) continue;
    if (!inAnyWindow(txn.date, [currentWindow])) continue;
    if (!uncategorisedThen.has(txn.merchant)) continue;
    byMerchant.set(txn.merchant, (byMerchant.get(txn.merchant) ?? 0) + Math.abs(txn.amount));
  }

  const ordered = [...byMerchant.entries()].sort((a, b) => b[1] - a[1]);
  return {
    amount: round2(ordered.reduce((a, [, value]) => a + value, 0)),
    count: ordered.length,
    merchants: ordered.map(([merchant]) => merchant)
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/digest-taxonomy.test.js`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add lib/digest/taxonomy.js tests/digest-taxonomy.test.js
git commit -m "feat: attribute category movement to review work rather than spending"
```

---

## Task 3: the detectors

**Files:**
- Create: `lib/digest/findings.js`
- Test: `tests/digest-findings.test.js`

**Interfaces:**
- Consumes: `digestBaseline` (Task 1), `taxonomyAttribution` (Task 2), `query` from `lib/query/query.js`, `detectRecurring` from `lib/recurring.js`.
- Produces: `detectFindings(snapshot, context) → Finding[]`, where `context` is a `digestBaseline` result plus `{ monthKey, today }`.

**A finding carries numbers, never words:**

```
{
  type: 'headline'|'mover'|'new-merchant'|'price-change'|'extreme'|'vanished',
  key,                 // category id, merchant name, etc.
  label,               // human label, already resolved
  value, baseline,     // signed, ledger space
  delta, deltaPct,     // magnitude space; positive = more spent
  materiality,         // absolute dollars moved
  evidence: {...},     // type-specific numbers the renderer may use
  drilldown: { sliceBy, key } | null
}
```

Scoring and wording happen later, in Tasks 4 and 5, and never here.

- [ ] **Step 1: Write the failing tests**

Create `tests/digest-findings.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestBaseline } from '../lib/digest/baseline.js';
import { detectFindings } from '../lib/digest/findings.js';

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
    { id: 'subscriptions', label: 'Subscriptions', groupId: 'lifestyle' },
    { id: 'uncategorised', label: 'Uncategorised', groupId: 'other' }
  ]
};

const build = (transactions, { monthKey = '2026-08', today = '2026-08-31' } = {}) => {
  const snapshot = { transactions, accounts: [], recurring: [], categories: CATEGORIES };
  const context = digestBaseline(snapshot, { monthKey, today, windowCount: 3 });
  return detectFindings(snapshot, { ...context, monthKey, today });
};

const typed = (findings, type) => findings.filter((f) => f.type === type);

const threeMonths = (categoryId, merchant, amounts) =>
  ['2026-05', '2026-06', '2026-07', '2026-08'].map((month, i) =>
    t({ id: `${merchant}-${i}`, merchant, categoryId, date: `${month}-10`, amount: amounts[i] }));

test('there is always exactly one headline finding', () => {
  const findings = build(threeMonths('groceries', 'Coles', [-400, -400, -400, -600]));
  assert.equal(typed(findings, 'headline').length, 1);
  const headline = typed(findings, 'headline')[0];
  assert.equal(headline.value, -600);
  assert.equal(headline.baseline, -400);
  assert.equal(headline.delta, 200);
});

test('a category that rose is a mover, with the rise as a positive delta', () => {
  const mover = typed(build(threeMonths('groceries', 'Coles', [-400, -400, -400, -600])), 'mover')[0];
  assert.equal(mover.key, 'groceries');
  assert.equal(mover.label, 'Groceries');
  assert.equal(mover.delta, 200);
  assert.equal(mover.deltaPct, 0.5);
  assert.deepEqual(mover.drilldown, { sliceBy: 'category', key: 'groceries' });
});

test('a category that fell is also a mover, with a negative delta', () => {
  const mover = typed(build(threeMonths('groceries', 'Coles', [-400, -400, -400, -100])), 'mover')[0];
  assert.equal(mover.delta, -300);
});

test('a mover carries the concentration evidence behind it', () => {
  const findings = build([
    ...threeMonths('groceries', 'Coles', [-400, -400, -400, -100]),
    t({ id: 'big1', date: '2026-08-12', merchant: 'Coles', amount: -300 }),
    t({ id: 'big2', date: '2026-08-14', merchant: 'Coles', amount: -300 })
  ]);
  const mover = typed(findings, 'mover').find((f) => f.key === 'groceries');
  assert.equal(typeof mover.evidence.top3Share, 'number');
  assert.equal(typeof mover.evidence.baselineTop3Share, 'number');
  assert.equal(typeof mover.evidence.largest, 'number');
});

test('a mover explained by review work carries the attribution', () => {
  const findings = build([
    t({ id: 'u1', date: '2026-07-10', merchant: 'Bunnings', amount: -300, categoryId: 'uncategorised', categorySource: 'unknown' }),
    t({ id: 'u2', date: '2026-06-10', merchant: 'Bunnings', amount: -300, categoryId: 'uncategorised', categorySource: 'unknown' }),
    t({ id: 'a1', date: '2026-08-10', merchant: 'Bunnings', amount: -320, categoryId: 'groceries', categorySource: 'manual' })
  ]);
  const mover = typed(findings, 'mover').find((f) => f.key === 'groceries');
  assert.equal(mover.evidence.taxonomy.amount, 320);
  assert.deepEqual(mover.evidence.taxonomy.merchants, ['Bunnings']);
});

test('a merchant never seen before this month is reported as new', () => {
  const findings = build([
    ...threeMonths('groceries', 'Coles', [-400, -400, -400, -400]),
    t({ id: 'n1', date: '2026-08-12', merchant: 'Bunnings', amount: -180 })
  ]);
  const fresh = typed(findings, 'new-merchant');
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].key, 'Bunnings');
  assert.equal(fresh[0].value, -180);
  assert.deepEqual(fresh[0].drilldown, { sliceBy: 'merchant', key: 'Bunnings' });
});

test('a merchant seen in any earlier month is not new', () => {
  const findings = build(threeMonths('groceries', 'Coles', [-400, -400, -400, -400]));
  assert.equal(typed(findings, 'new-merchant').length, 0);
});

test('a category absent this month but present in the baseline is reported as vanished', () => {
  const findings = build([
    ...threeMonths('groceries', 'Coles', [-400, -400, -400, -400]),
    t({ id: 'k1', date: '2026-07-10', merchant: 'Uber Eats', categoryId: 'takeaway', amount: -180 }),
    t({ id: 'k2', date: '2026-06-10', merchant: 'Uber Eats', categoryId: 'takeaway', amount: -180 })
  ]);
  const gone = typed(findings, 'vanished');
  assert.equal(gone.length, 1);
  assert.equal(gone[0].key, 'takeaway');
});

test('a category at its lowest or highest month in the ledger is reported as extreme', () => {
  const findings = build(threeMonths('groceries', 'Coles', [-400, -420, -410, -90]));
  const extreme = typed(findings, 'extreme').find((f) => f.key === 'groceries');
  assert.equal(extreme.evidence.direction, 'lowest');
  assert.equal(extreme.evidence.previousExtremeMonth, '2026-05');
});

test('a price change dated inside the month is reported', () => {
  const findings = build([
    t({ id: 'p1', date: '2026-05-15', merchant: 'Netflix', categoryId: 'subscriptions', amount: -16.99 }),
    t({ id: 'p2', date: '2026-06-15', merchant: 'Netflix', categoryId: 'subscriptions', amount: -16.99 }),
    t({ id: 'p3', date: '2026-07-15', merchant: 'Netflix', categoryId: 'subscriptions', amount: -18.99 }),
    t({ id: 'p4', date: '2026-08-15', merchant: 'Netflix', categoryId: 'subscriptions', amount: -18.99 })
  ], { monthKey: '2026-07', today: '2026-08-31' });
  const price = typed(findings, 'price-change');
  assert.equal(price.length, 1);
  assert.equal(price[0].key, 'Netflix');
  assert.deepEqual(price[0].evidence, { from: 16.99, to: 18.99, date: '2026-07-15' });
});

test('with no history at all, only the headline is produced', () => {
  const findings = build([t({ id: 'a1', date: '2026-08-10', amount: -300 })]);
  assert.deepEqual(findings.map((f) => f.type), ['headline']);
});

test('every finding is numeric — no prose leaks out of the detectors', () => {
  const findings = build(threeMonths('groceries', 'Coles', [-400, -400, -400, -600]));
  for (const finding of findings) {
    assert.equal(finding.sentence, undefined, 'a detector must not produce wording');
    assert.equal(typeof finding.materiality, 'number');
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/digest-findings.test.js`
Expected: FAIL — `Cannot find module '.../lib/digest/findings.js'`

- [ ] **Step 3: Write the implementation**

Create `lib/digest/findings.js`:

```js
import { query } from '../query/query.js';
import { detectRecurring } from '../recurring.js';
import { taxonomyAttribution } from './taxonomy.js';

const round2 = (n) => Math.round(n * 100) / 100;
const magnitudeDelta = (value, baseline) => round2(Math.abs(value) - Math.abs(baseline));
const ratio = (delta, baseline) => (Math.abs(baseline) === 0 ? null : round2(delta / Math.abs(baseline)));

const labelFor = (snapshot, categoryId) =>
  (snapshot?.categories?.categories ?? []).find((c) => c.id === categoryId)?.label ?? categoryId;

/**
 * Every finding the digest could report, unranked and unworded.
 *
 * Detectors emit NUMBERS ONLY. Scoring happens in rank.js and wording in
 * render.js — keeping the three apart is what stops the digest reading like a
 * form letter, because variety then comes from which findings fire rather than
 * from shuffled phrasing.
 */
export function detectFindings(snapshot, context) {
  const {
    current, currentWindow, baselines, coveredCount, monthKey, today,
    averageFor, samplesFor, baselineTotal
  } = context;

  const findings = [];
  const baselineWindows = baselines.map((b) => b.window);

  const headlineDelta = magnitudeDelta(current.total, baselineTotal);
  findings.push({
    type: 'headline',
    key: monthKey,
    label: monthKey,
    value: current.total,
    baseline: coveredCount ? baselineTotal : null,
    delta: coveredCount ? headlineDelta : null,
    deltaPct: coveredCount ? ratio(headlineDelta, baselineTotal) : null,
    materiality: Math.abs(current.total),
    evidence: { txnCount: current.stats.txnCount, coveredCount },
    drilldown: null
  });

  // Without a baseline there is nothing to compare against, and every finding
  // below is a comparison. Reporting them anyway would invent a story.
  if (!coveredCount) return findings;

  for (const row of current.rows) {
    const baseline = averageFor(row.key);
    const delta = magnitudeDelta(row.value, baseline);
    const baselineStats = baselines
      .map((b) => b.result.rows.find((r) => r.key === row.key)?.stats?.top3Share ?? 0);

    findings.push({
      type: 'mover',
      key: row.key,
      label: row.label,
      value: row.value,
      baseline,
      delta,
      deltaPct: ratio(delta, baseline),
      materiality: Math.abs(delta),
      evidence: {
        samples: samplesFor(row.key),
        txnCount: row.stats.txnCount,
        largest: row.stats.largest,
        top3Share: row.stats.top3Share,
        baselineTop3Share: round2(baselineStats.reduce((a, s) => a + s, 0) / baselineStats.length),
        taxonomy: taxonomyAttribution(snapshot, { categoryId: row.key, currentWindow, baselineWindows })
      },
      drilldown: { sliceBy: 'category', key: row.key }
    });
  }

  const present = new Set(current.rows.map((r) => r.key));
  const seenInBaseline = new Map();
  for (const b of baselines) {
    for (const row of b.result.rows) seenInBaseline.set(row.key, row.label);
  }
  for (const [key, label] of seenInBaseline) {
    if (present.has(key)) continue;
    const baseline = averageFor(key);
    findings.push({
      type: 'vanished',
      key,
      label,
      value: 0,
      baseline,
      delta: magnitudeDelta(0, baseline),
      deltaPct: -1,
      materiality: Math.abs(baseline),
      evidence: { samples: samplesFor(key) },
      drilldown: { sliceBy: 'category', key }
    });
  }

  findings.push(...newMerchantFindings(snapshot, currentWindow));
  findings.push(...extremeFindings(snapshot, current, monthKey));
  findings.push(...priceChangeFindings(snapshot, currentWindow, today));

  return findings;
}

/** A merchant with no transaction anywhere before this window. */
function newMerchantFindings(snapshot, currentWindow) {
  const transactions = (snapshot?.transactions ?? []).filter(
    (t) => !t.excluded && t.categoryId !== 'income'
  );
  const before = new Set(transactions.filter((t) => t.date < currentWindow.dateFrom).map((t) => t.merchant));

  const totals = new Map();
  for (const txn of transactions) {
    if (txn.date < currentWindow.dateFrom || txn.date > currentWindow.dateTo) continue;
    if (before.has(txn.merchant)) continue;
    totals.set(txn.merchant, (totals.get(txn.merchant) ?? 0) + txn.amount);
  }

  return [...totals.entries()].map(([merchant, value]) => ({
    type: 'new-merchant',
    key: merchant,
    label: merchant,
    value: round2(value),
    baseline: 0,
    delta: round2(Math.abs(value)),
    deltaPct: null,
    materiality: Math.abs(value),
    evidence: {},
    drilldown: { sliceBy: 'merchant', key: merchant }
  }));
}

/** A category at its lowest or highest month across the whole ledger. */
function extremeFindings(snapshot, current, monthKey) {
  const out = [];
  for (const row of current.rows) {
    const series = query(snapshot, { filters: { categoryIds: [row.key] }, sliceBy: 'month', measure: 'sum' });
    // Two points cannot establish a record worth reporting.
    if (series.rows.length < 4) continue;

    const others = series.rows.filter((r) => r.key !== monthKey);
    if (!others.length) continue;
    const magnitude = Math.abs(row.value);
    const lowest = others.every((r) => Math.abs(r.value) > magnitude);
    const highest = others.every((r) => Math.abs(r.value) < magnitude);
    if (!lowest && !highest) continue;

    const comparator = lowest
      ? others.reduce((a, r) => (Math.abs(r.value) < Math.abs(a.value) ? r : a))
      : others.reduce((a, r) => (Math.abs(r.value) > Math.abs(a.value) ? r : a));

    out.push({
      type: 'extreme',
      key: row.key,
      label: row.label,
      value: row.value,
      baseline: comparator.value,
      delta: magnitudeDelta(row.value, comparator.value),
      deltaPct: ratio(magnitudeDelta(row.value, comparator.value), comparator.value),
      materiality: Math.abs(row.value),
      evidence: {
        direction: lowest ? 'lowest' : 'highest',
        monthsObserved: series.rows.length,
        previousExtremeMonth: comparator.key
      },
      drilldown: { sliceBy: 'category', key: row.key }
    });
  }
  return out;
}

/** A subscription whose price stepped inside this window. */
function priceChangeFindings(snapshot, currentWindow, today) {
  const { series } = detectRecurring(snapshot, { today });
  return series
    .filter((s) => s.priceChange
      && s.priceChange.date >= currentWindow.dateFrom
      && s.priceChange.date <= currentWindow.dateTo)
    .map((s) => ({
      type: 'price-change',
      key: s.merchant,
      label: s.merchant,
      value: -s.priceChange.to,
      baseline: -s.priceChange.from,
      delta: round2(s.priceChange.to - s.priceChange.from),
      deltaPct: ratio(round2(s.priceChange.to - s.priceChange.from), s.priceChange.from),
      // A recurring price rise costs its difference every period, forever —
      // materiality is the ANNUAL impact, not the one charge.
      materiality: Math.abs(round2((s.priceChange.to - s.priceChange.from) * (365.25 / s.cadenceDays))),
      evidence: { ...s.priceChange },
      drilldown: { sliceBy: 'merchant', key: s.merchant }
    }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/digest-findings.test.js`
Expected: PASS, 12 tests

- [ ] **Step 5: Commit**

```bash
git add lib/digest/findings.js tests/digest-findings.test.js
git commit -m "feat: add the digest's six numeric detectors"
```

---

## Task 4: ranking and suppression

**Files:**
- Create: `lib/digest/rank.js`
- Test: `tests/digest-rank.test.js`

**Interfaces:**
- Consumes: findings from Task 3.
- Produces: `THRESHOLDS`; `standardDeviation(values) → number`; `scoreFinding(finding, context) → number`; `rankFindings(findings, context) → Finding[]` (headline always first, then the rest by descending score, suppressed ones removed).

**Rank by materiality × surprise, never by percentage.** Sorting by percentage puts *"Coffee up 300%"* — $4 to $12 — above *"Groceries up $155"*. Surprise is the movement measured against the baseline's own spread, so a category that always swings wildly needs to swing further before it counts.

- [ ] **Step 1: Write the failing tests**

Create `tests/digest-rank.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THRESHOLDS, standardDeviation, scoreFinding, rankFindings } from '../lib/digest/rank.js';

const context = { current: { total: -4000 }, coveredCount: 3 };

const mover = (over) => ({
  type: 'mover', key: 'k', label: 'L', value: -100, baseline: -50,
  delta: 50, deltaPct: 1, materiality: 50,
  evidence: { samples: [-50, -50, -50] }, drilldown: null, ...over
});

const headline = { type: 'headline', key: '2026-08', label: '2026-08', materiality: 4000, delta: 100, evidence: {} };

test('standardDeviation is zero for a flat series and positive for a spread one', () => {
  assert.equal(standardDeviation([100, 100, 100]), 0);
  assert.ok(standardDeviation([50, 100, 150]) > 0);
});

test('a large move against a steady baseline outranks a large percentage on small money', () => {
  const groceries = mover({ key: 'groceries', delta: 155, materiality: 155, evidence: { samples: [-450, -460, -455] } });
  const coffee = mover({ key: 'coffee', delta: 8, materiality: 8, deltaPct: 3, evidence: { samples: [-4, -4, -4] } });
  assert.ok(scoreFinding(groceries, context) > scoreFinding(coffee, context));
});

test('the same movement counts for less against a baseline that always swings', () => {
  const steady = mover({ delta: 200, materiality: 200, evidence: { samples: [-400, -405, -395] } });
  const erratic = mover({ delta: 200, materiality: 200, evidence: { samples: [-100, -700, -400] } });
  assert.ok(scoreFinding(steady, context) > scoreFinding(erratic, context));
});

test('a movement below the dollar floor is suppressed', () => {
  const ranked = rankFindings([headline, mover({ delta: 5, materiality: 5 })], context);
  assert.deepEqual(ranked.map((f) => f.type), ['headline']);
});

test('a movement below the share-of-month floor is suppressed even if it clears the dollar floor', () => {
  // 2% of a $4,000 month is $80, which outranks the flat $25 floor.
  const ranked = rankFindings([headline, mover({ delta: 40, materiality: 40 })], context);
  assert.deepEqual(ranked.map((f) => f.type), ['headline']);
  assert.equal(THRESHOLDS.minShareOfTotal, 0.02);
});

test('the headline is always kept and always first, however small the month', () => {
  const ranked = rankFindings([mover({ delta: 900, materiality: 900 }), headline], { current: { total: -10 }, coveredCount: 3 });
  assert.equal(ranked[0].type, 'headline');
});

test('with too little history every comparison finding is suppressed', () => {
  const ranked = rankFindings([headline, mover({ delta: 900, materiality: 900 })], { current: { total: -4000 }, coveredCount: 0 });
  assert.deepEqual(ranked.map((f) => f.type), ['headline']);
});

test('a price change survives the floor on its annual impact, not its single charge', () => {
  // $2 a month is under every dollar floor; $24 a year is the real cost.
  const price = { type: 'price-change', key: 'Netflix', label: 'Netflix', delta: 2, materiality: 24, deltaPct: 0.12, evidence: {} };
  const ranked = rankFindings([headline, price], context);
  assert.ok(ranked.some((f) => f.type === 'price-change'));
});

test('a new merchant is always kept regardless of size, because it is news either way', () => {
  const fresh = { type: 'new-merchant', key: 'Bunnings', label: 'Bunnings', delta: 30, materiality: 30, deltaPct: null, evidence: {} };
  const ranked = rankFindings([headline, fresh], context);
  assert.ok(ranked.some((f) => f.type === 'new-merchant'));
});

test('findings come back sorted by score, most significant first', () => {
  const small = mover({ key: 'small', delta: 120, materiality: 120, evidence: { samples: [-300, -300, -300] } });
  const big = mover({ key: 'big', delta: 600, materiality: 600, evidence: { samples: [-900, -900, -900] } });
  const ranked = rankFindings([headline, small, big], context);
  assert.deepEqual(ranked.slice(1).map((f) => f.key), ['big', 'small']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/digest-rank.test.js`
Expected: FAIL — `Cannot find module '.../lib/digest/rank.js'`

- [ ] **Step 3: Write the implementation**

Create `lib/digest/rank.js`:

```js
export const THRESHOLDS = Object.freeze({
  minAbsolute: 25,
  minShareOfTotal: 0.02,
  /** Below this many baseline windows, spread is not measurable. */
  minWindowsForSurprise: 2,
  /** Caps how far a very steady baseline can inflate a score. */
  maxSurprise: 6
});

/** Types that are news on their own terms and skip the materiality floor. */
const ALWAYS_KEEP = new Set(['headline', 'new-merchant', 'price-change']);

export function standardDeviation(values) {
  if (!values || values.length < 2) return 0;
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * materiality × surprise.
 *
 * Never percentage: sorting by percentage puts "Coffee up 300%" ($4 to $12)
 * above "Groceries up $155". Surprise measures the movement against the
 * baseline's OWN spread, so a category that always swings wildly has to swing
 * further before it earns a line.
 */
export function scoreFinding(finding, context = {}) {
  const materiality = Math.abs(finding.materiality ?? finding.delta ?? 0);
  const samples = finding.evidence?.samples;
  const spread = standardDeviation((samples ?? []).map((v) => Math.abs(v)));

  const surprise = (context.coveredCount ?? 0) < THRESHOLDS.minWindowsForSurprise || spread === 0
    ? 1
    : Math.min(Math.abs(finding.delta ?? 0) / spread, THRESHOLDS.maxSurprise);

  return materiality * surprise;
}

/**
 * Score, suppress, and order. The headline is always kept and always first —
 * it is the frame every other line is read inside.
 *
 * Suppression is the point, not a limitation: a month with nothing notable in
 * it should produce a short digest, not a padded one.
 */
export function rankFindings(findings, context = {}) {
  const monthTotal = Math.abs(context.current?.total ?? 0);
  const floor = Math.max(THRESHOLDS.minAbsolute, monthTotal * THRESHOLDS.minShareOfTotal);
  const hasHistory = (context.coveredCount ?? 0) > 0;

  const headline = findings.find((f) => f.type === 'headline');
  const rest = findings
    .filter((f) => f.type !== 'headline')
    // Every non-headline finding is a comparison; without history they would
    // be assertions about nothing.
    .filter(() => hasHistory)
    .filter((f) => ALWAYS_KEEP.has(f.type) || Math.abs(f.materiality ?? 0) >= floor)
    .map((f) => ({ ...f, score: scoreFinding(f, context) }))
    .sort((a, b) => b.score - a.score);

  return headline ? [headline, ...rest] : rest;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/digest-rank.test.js`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add lib/digest/rank.js tests/digest-rank.test.js
git commit -m "feat: rank digest findings by materiality times surprise"
```

---

## Task 5: sentences, and the `buildDigest` entry point

**Files:**
- Create: `lib/digest/render.js`, `lib/digest/index.js`
- Test: `tests/digest-render.test.js`

**Interfaces:**
- Consumes: `digestBaseline`, `detectFindings`, `rankFindings`; `formatMoney`, `formatPercent` from `web/charts/scale.js`.
- Produces: `sentenceFor(finding, context) → { lead, detail, tone, drilldown }`; `buildDigest(snapshot, { monthKey, today, topCount }) → { monthKey, isPartial, elapsedDays, totalDays, top, more, coveredCount }`.

**`render.js` returns text, not markup.** Keeping it string-only means it is testable in `node --test` and that `web/digest-view.js` owns every escaping decision in one place.

**Wait — `lib/` importing from `web/`.** `formatMoney` currently lives in `web/charts/scale.js`. Rather than reach upward from `lib/`, **copy the two formatters into `lib/digest/render.js`** as local helpers. They are six lines, and the alternative — a `lib/` module depending on `web/` — inverts the layering the whole codebase rests on and would fail `tests/module-graph.test.js`.

- [ ] **Step 1: Write the failing tests**

Create `tests/digest-render.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sentenceFor } from '../lib/digest/render.js';
import { buildDigest } from '../lib/digest/index.js';

const context = { isPartial: false, projectionFactor: 1, coveredCount: 3, monthKey: '2026-08' };
const partial = { isPartial: true, projectionFactor: 1.72, coveredCount: 3, monthKey: '2026-08', elapsedDays: 18, totalDays: 31 };

test('the headline states real spend, the transaction count and the comparison', () => {
  const { lead } = sentenceFor({
    type: 'headline', value: -4182, delta: 310, deltaPct: 0.08,
    evidence: { txnCount: 213, coveredCount: 3 }
  }, context);
  assert.match(lead, /\$4,182\.00/);
  assert.match(lead, /213 transactions/);
  assert.match(lead, /up 8%/);
});

test('a partial month says so, and hedges the projection separately', () => {
  const { lead, detail } = sentenceFor({
    type: 'headline', value: -1840, delta: 130, deltaPct: 0.08,
    evidence: { txnCount: 96, coveredCount: 3 }
  }, partial);
  assert.match(lead, /18 days/);
  assert.match(lead, /same point/);
  // The projection is hedged and never leads.
  assert.match(detail, /on pace for about/);
  assert.match(detail, /\$3,164\.80/);
  assert.equal(/^on pace/i.test(lead), false);
});

test('a complete month never mentions a projection', () => {
  const { detail } = sentenceFor({
    type: 'headline', value: -4182, delta: 310, deltaPct: 0.08, evidence: { txnCount: 213, coveredCount: 3 }
  }, context);
  assert.equal(/on pace/.test(detail), false);
});

test('the headline says plainly when there is nothing to compare against', () => {
  const { lead } = sentenceFor({
    type: 'headline', value: -4182, delta: null, deltaPct: null, evidence: { txnCount: 213, coveredCount: 0 }
  }, { ...context, coveredCount: 0 });
  assert.match(lead, /no earlier months/);
  assert.equal(/up |down /.test(lead), false);
});

test('a mover names the category, the amount and the direction', () => {
  const { lead } = sentenceFor({
    type: 'mover', label: 'Groceries', value: -612, baseline: -457, delta: 155, deltaPct: 0.34,
    evidence: { txnCount: 11, top3Share: 0.44, baselineTop3Share: 0.2, largest: -94.2, taxonomy: { amount: 0, count: 0, merchants: [] } }
  }, context);
  assert.match(lead, /Groceries/);
  assert.match(lead, /\$612\.00/);
  assert.match(lead, /up 34%/);
});

test('a mover driven by a few large transactions says which shape it is', () => {
  const { detail } = sentenceFor({
    type: 'mover', label: 'Groceries', value: -612, baseline: -457, delta: 155, deltaPct: 0.34,
    evidence: { txnCount: 11, top3Share: 0.72, baselineTop3Share: 0.2, largest: -94.2, taxonomy: { amount: 0, count: 0, merchants: [] } }
  }, context);
  assert.match(detail, /three/);
  assert.match(detail, /unusual/);
});

test('a mover explained by review work says so explicitly', () => {
  const { detail } = sentenceFor({
    type: 'mover', label: 'Home', value: -820, baseline: -400, delta: 420, deltaPct: 1.05,
    evidence: {
      txnCount: 14, top3Share: 0.3, baselineTop3Share: 0.3, largest: -200,
      taxonomy: { amount: 420, count: 2, merchants: ['Bunnings', 'Officeworks'] }
    }
  }, context);
  assert.match(detail, /categorised/);
  assert.match(detail, /Bunnings/);
  // Bookkeeping must never be presented as a change in spending.
  assert.match(detail, /\$420\.00/);
});

test('a price change gives both prices', () => {
  const { lead } = sentenceFor({
    type: 'price-change', label: 'Netflix', evidence: { from: 16.99, to: 18.99, date: '2026-07-15' }
  }, context);
  assert.match(lead, /Netflix/);
  assert.match(lead, /\$16\.99/);
  assert.match(lead, /\$18\.99/);
});

test('new merchants, vanished categories and extremes each get their own wording', () => {
  assert.match(sentenceFor({ type: 'new-merchant', label: 'Bunnings', value: -180, evidence: {} }, context).lead, /first time/);
  assert.match(sentenceFor({ type: 'vanished', label: 'Takeaway', baseline: -180, evidence: {} }, context).lead, /nothing/);
  assert.match(
    sentenceFor({ type: 'extreme', label: 'Takeaway', value: -90, evidence: { direction: 'lowest', previousExtremeMonth: '2026-03', monthsObserved: 8 } }, context).lead,
    /lowest/
  );
});

test('buildDigest returns three findings up front and the rest behind "more"', () => {
  const t = (over) => ({
    id: 'x', date: '2026-08-10', amount: -10, rawDescription: 'R', merchant: 'M',
    accountId: 'a', cardSuffix: null, categoryId: 'groceries', categorySource: 'rule',
    excluded: false, importId: 'i', note: null, ...over
  });
  const categories = {
    groups: [{ id: 'food-drink', label: 'Food & Drink' }],
    categories: ['groceries', 'takeaway', 'coffee', 'shopping', 'fuel']
      .map((id) => ({ id, label: id, groupId: 'food-drink' }))
  };
  const transactions = [];
  for (const month of ['2026-05', '2026-06', '2026-07', '2026-08']) {
    for (const [i, id] of ['groceries', 'takeaway', 'coffee', 'shopping', 'fuel'].entries()) {
      transactions.push(t({
        id: `${month}-${id}`, date: `${month}-10`, categoryId: id, merchant: id,
        amount: month === '2026-08' ? -(300 + i * 220) : -(100 + i * 40)
      }));
    }
  }

  const digest = buildDigest({ transactions, accounts: [], recurring: [], categories },
    { monthKey: '2026-08', today: '2026-08-31' });

  assert.equal(digest.top.length, 3);
  assert.ok(digest.more.length > 0);
  assert.equal(digest.top[0].type, 'headline');
  for (const item of [...digest.top, ...digest.more]) {
    assert.equal(typeof item.lead, 'string');
    assert.ok(item.lead.length > 0);
  }
});

test('a digest with nothing notable is short rather than padded', () => {
  const t = (over) => ({
    id: 'x', date: '2026-08-10', amount: -400, rawDescription: 'R', merchant: 'Coles',
    accountId: 'a', cardSuffix: null, categoryId: 'groceries', categorySource: 'rule',
    excluded: false, importId: 'i', note: null, ...over
  });
  const snapshot = {
    accounts: [], recurring: [],
    categories: { groups: [{ id: 'food-drink', label: 'Food & Drink' }], categories: [{ id: 'groceries', label: 'Groceries', groupId: 'food-drink' }] },
    transactions: ['2026-05', '2026-06', '2026-07', '2026-08'].map((m, i) => t({ id: `m${i}`, date: `${m}-10` }))
  };
  const digest = buildDigest(snapshot, { monthKey: '2026-08', today: '2026-08-31' });
  assert.equal(digest.top.length, 1);
  assert.equal(digest.more.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/digest-render.test.js`
Expected: FAIL — `Cannot find module '.../lib/digest/render.js'`

- [ ] **Step 3: Write `lib/digest/render.js`**

```js
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Copied rather than imported from web/charts/scale.js on purpose: lib/ must
 * not depend on web/, and these are six lines. tests/module-graph.test.js
 * enforces that direction.
 */
function money(n) {
  const negative = n < 0;
  const body = Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${negative ? '-' : ''}$${body}`;
}
const percent = (fraction) => `${Math.round(Math.abs(fraction) * 100)}%`;
const direction = (delta) => (delta > 0 ? 'up' : 'down');

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function monthName(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function headlineSentence(finding, context) {
  const spend = money(Math.abs(finding.value));
  const count = finding.evidence.txnCount;
  const scope = context.isPartial
    ? `the first ${context.elapsedDays} days of ${monthName(context.monthKey)}`
    : monthName(context.monthKey);

  if (!finding.evidence.coveredCount || finding.delta === null) {
    return {
      lead: `${spend} across ${count} transactions in ${scope} — no earlier months to compare against yet.`,
      detail: '',
      tone: 'neutral'
    };
  }

  const comparison = finding.deltaPct === null
    ? `${direction(finding.delta)} ${money(Math.abs(finding.delta))}`
    : `${direction(finding.delta)} ${percent(finding.deltaPct)}`;
  const against = context.isPartial ? 'the same point in an average month' : 'your 3-month average';

  // The projection is hedged and never leads: every figure in `lead` is money
  // that actually left the account.
  const detail = context.isPartial
    ? `On pace for about ${money(round2(Math.abs(finding.value) * context.projectionFactor))} by month end.`
    : '';

  return {
    lead: `${spend} across ${count} transactions in ${scope} — ${comparison} on ${against}.`,
    detail,
    tone: finding.delta > 0 ? 'up' : 'down'
  };
}

function moverSentence(finding) {
  const { evidence } = finding;
  const change = finding.deltaPct === null
    ? `${direction(finding.delta)} ${money(Math.abs(finding.delta))}`
    : `${direction(finding.delta)} ${percent(finding.deltaPct)}`;
  const lead = `${finding.label} ${money(Math.abs(finding.value))} — ${change} on its average.`;

  const details = [];
  if (evidence.taxonomy?.amount > 0 && evidence.taxonomy.amount >= Math.abs(finding.delta) * 0.25) {
    const names = evidence.taxonomy.merchants.slice(0, 3).join(', ');
    details.push(`${money(evidence.taxonomy.amount)} of this is spend from ${names}, which you categorised this month — it was sitting in Uncategorised before, so that part is bookkeeping rather than a change in spending.`);
  }
  if (evidence.top3Share >= 0.6 && evidence.top3Share > evidence.baselineTop3Share + 0.15) {
    details.push(`Driven by its three largest transactions, the biggest ${money(Math.abs(evidence.largest))} — more concentrated than usual for this category.`);
  } else if (evidence.top3Share <= 0.3 && evidence.txnCount >= 8) {
    details.push(`Spread across ${evidence.txnCount} transactions rather than a few large ones.`);
  }

  return { lead, detail: details.join(' '), tone: finding.delta > 0 ? 'up' : 'down' };
}

/**
 * One finding, in words. Returns text rather than markup so this stays
 * testable in node --test and web/digest-view.js owns every escaping decision.
 */
export function sentenceFor(finding, context = {}) {
  const base = { drilldown: finding.drilldown ?? null };

  switch (finding.type) {
    case 'headline':
      return { ...base, ...headlineSentence(finding, context) };

    case 'mover':
      return { ...base, ...moverSentence(finding) };

    case 'new-merchant':
      return {
        ...base,
        lead: `${finding.label} — ${money(Math.abs(finding.value))}, the first time it has appeared.`,
        detail: '',
        tone: 'new'
      };

    case 'vanished':
      return {
        ...base,
        lead: `${finding.label} — nothing at all this month, against ${money(Math.abs(finding.baseline))} on average.`,
        detail: '',
        tone: 'down'
      };

    case 'price-change': {
      const { from, to, date } = finding.evidence;
      return {
        ...base,
        lead: `${finding.label} went from ${money(from)} to ${money(to)} on ${date}.`,
        detail: '',
        tone: to > from ? 'up' : 'down'
      };
    }

    case 'extreme':
      return {
        ...base,
        lead: `${finding.label} ${money(Math.abs(finding.value))} — its ${finding.evidence.direction} month in ${finding.evidence.monthsObserved} months of records.`,
        detail: `Previous ${finding.evidence.direction} was ${monthName(finding.evidence.previousExtremeMonth)}.`,
        tone: finding.evidence.direction === 'highest' ? 'up' : 'down'
      };

    default:
      return { ...base, lead: '', detail: '', tone: 'neutral' };
  }
}
```

- [ ] **Step 4: Write `lib/digest/index.js`**

```js
import { digestBaseline } from './baseline.js';
import { detectFindings } from './findings.js';
import { rankFindings } from './rank.js';
import { sentenceFor } from './render.js';

export { monthName } from './render.js';

/**
 * The digest for one month: detect, rank, then word — in that order, and never
 * mixed. Entirely local and entirely deterministic; the same month always
 * produces the same summary.
 *
 * `today` is injected so the result is reproducible under test and so a
 * partial month can be prorated against the same point in earlier months.
 */
export function buildDigest(snapshot, { monthKey, today, topCount = 3, windowCount = 3 } = {}) {
  const context = digestBaseline(snapshot, { monthKey, today, windowCount });
  const findings = detectFindings(snapshot, { ...context, monthKey, today });
  const ranked = rankFindings(findings, { ...context, monthKey, today });

  const worded = ranked.map((finding) => ({
    type: finding.type,
    key: finding.key,
    ...sentenceFor(finding, { ...context, monthKey, today })
  }));

  return {
    monthKey,
    isPartial: context.isPartial,
    elapsedDays: context.elapsedDays,
    totalDays: context.totalDays,
    coveredCount: context.coveredCount,
    top: worded.slice(0, topCount),
    more: worded.slice(topCount)
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/digest-render.test.js`
Expected: PASS, 11 tests

- [ ] **Step 6: Confirm the layering test still passes**

Run: `node --test tests/module-graph.test.js`
Expected: PASS — nothing in `lib/digest/` imports from `web/`.

- [ ] **Step 7: Commit**

```bash
git add lib/digest/render.js lib/digest/index.js tests/digest-render.test.js
git commit -m "feat: compose digest findings into sentences behind one buildDigest entry point"
```

---

## Task 6: the digest in the UI

**Files:**
- Create: `web/digest-view.js`
- Modify: `web/overview-view.js`, `web/import-view.js`, `web/app.js`, `web/style.css`
- Test: `tests/digest-view.test.js`

**Interfaces:**
- Consumes: `buildDigest`, `monthName` from `lib/digest/index.js`; `escapeHtml` from `web/charts/scale.js`.
- Produces: `renderDigest(snapshot, { monthKey, today, expanded }) → html`; the Overview renders it collapsibly at the top, and a successful import lands on it.

**Where it appears:** after a successful import, and re-openable from the Overview. The import handler currently jumps straight to the Overview; it will now jump to the Overview **with the digest expanded**, for the month the import covered.

- [ ] **Step 1: Write the failing tests**

Create `tests/digest-view.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDigest } from '../web/digest-view.js';

const t = (over) => ({
  id: 'x', date: '2026-08-10', amount: -400, rawDescription: 'R', merchant: 'Coles',
  accountId: 'a', cardSuffix: null, categoryId: 'groceries', categorySource: 'rule',
  excluded: false, importId: 'i', note: null, ...over
});

const SNAPSHOT = {
  accounts: [], recurring: [],
  categories: {
    groups: [{ id: 'food-drink', label: 'Food & Drink' }],
    categories: [{ id: 'groceries', label: 'Groceries', groupId: 'food-drink' }]
  },
  transactions: [
    ...['2026-05', '2026-06', '2026-07'].map((m, i) => t({ id: `p${i}`, date: `${m}-10` })),
    t({ id: 'a1', date: '2026-08-10', amount: -900 }),
    t({ id: 'a2', date: '2026-08-12', merchant: 'Bunnings', amount: -260 })
  ]
};

const OPTIONS = { monthKey: '2026-08', today: '2026-08-31' };

test('the digest names the month it is describing', () => {
  assert.match(renderDigest(SNAPSHOT, OPTIONS), /August 2026/);
});

test('the top findings are shown and the rest are behind a disclosure', () => {
  const html = renderDigest(SNAPSHOT, OPTIONS);
  assert.match(html, /digest-finding/);
  assert.match(html, /data-digest-action="more"/);
});

test('a finding with a drill-down carries the slice and key needed to open it', () => {
  const html = renderDigest(SNAPSHOT, OPTIONS);
  assert.match(html, /data-digest-slice="category"/);
  assert.match(html, /data-digest-key="groceries"/);
});

test('an empty ledger renders nothing rather than an empty shell', () => {
  assert.equal(renderDigest({ transactions: [], accounts: [], categories: { groups: [], categories: [] } }, OPTIONS), '');
});

test('a merchant name from a bank CSV is escaped', () => {
  const hostile = {
    ...SNAPSHOT,
    transactions: [...SNAPSHOT.transactions, t({ id: 'h1', date: '2026-08-14', merchant: '<img src=x onerror=alert(1)>', amount: -300 })]
  };
  const html = renderDigest(hostile, OPTIONS);
  assert.equal(html.includes('<img src=x'), false);
});

test('a partial month is labelled as month to date', () => {
  const html = renderDigest(SNAPSHOT, { monthKey: '2026-08', today: '2026-08-18' });
  assert.match(html, /first 18 days/);
  assert.match(html, /on pace for about/i);
});

test('the expanded flag controls whether the disclosure starts open', () => {
  assert.match(renderDigest(SNAPSHOT, { ...OPTIONS, expanded: true }), /<details class="digest" open>/);
  assert.equal(/<details class="digest" open>/.test(renderDigest(SNAPSHOT, OPTIONS)), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/digest-view.test.js`
Expected: FAIL — `Cannot find module '.../web/digest-view.js'`

- [ ] **Step 3: Write `web/digest-view.js`**

```js
import { buildDigest, monthName } from '../lib/digest/index.js';
import { escapeHtml } from './charts/scale.js';

/** The most recent month with any transaction in it, or null for an empty ledger. */
export function latestMonthKey(snapshot) {
  let latest = null;
  for (const txn of snapshot?.transactions ?? []) {
    const key = txn.date.slice(0, 7);
    if (latest === null || key > latest) latest = key;
  }
  return latest;
}

const item = (finding) => {
  const drill = finding.drilldown
    ? ` data-digest-slice="${escapeHtml(finding.drilldown.sliceBy)}" data-digest-key="${escapeHtml(finding.drilldown.key)}"`
    : '';
  return `
    <li class="digest-finding digest-tone-${escapeHtml(finding.tone)}"${drill}>
      <p class="digest-lead">${escapeHtml(finding.lead)}</p>
      ${finding.detail ? `<p class="digest-detail">${escapeHtml(finding.detail)}</p>` : ''}
    </li>`;
};

/**
 * The digest, as a collapsible section. Every sentence comes from lib/digest —
 * this file only decides markup and escaping, which is why all the text
 * arrives here as plain strings.
 */
export function renderDigest(snapshot, { monthKey, today, expanded = false } = {}) {
  const key = monthKey ?? latestMonthKey(snapshot);
  if (!key) return '';

  const digest = buildDigest(snapshot, { monthKey: key, today });
  if (!digest.top.length) return '';

  const more = digest.more.length
    ? `<details class="digest-more"><summary data-digest-action="more">${digest.more.length} more</summary><ul class="digest-list">${digest.more.map(item).join('')}</ul></details>`
    : '';

  return `
  <details class="digest"${expanded ? ' open' : ''}>
    <summary class="digest-summary">${escapeHtml(monthName(key))}${digest.isPartial ? ' · month to date' : ''}</summary>
    <ul class="digest-list">${digest.top.map(item).join('')}</ul>
    ${more}
  </details>`;
}
```

- [ ] **Step 4: Render it in the Overview**

In `web/overview-view.js`, add the import:

```js
import { renderDigest } from './digest-view.js';
```

Add `digestExpanded` and `digestMonth` to `renderOverview`'s options — extend its signature rather than adding a ninth positional argument, which is already at its readable limit:

```js
export function renderOverview(snapshot, uiFilters = {}, panelConfigs = DEFAULT_PANELS, extraFilters = {}, hiddenCount = 0, searchQuery = '', compareMode = 'off', digest = {}) {
```

and render it above the KPI row:

```js
  return `
    ${renderDigest(snapshot, digest)}
    ${kpiRow(snapshot, queryFilters, compareMode)}
    ...`;
```

In `mountOverview`, hold the state and pass it:

```js
  let digest = { expanded: false };
```

```js
  const draw = () => {
    root.innerHTML = renderOverview(current, filters, configs, extraFilters(), excludedIds.size, searchQuery, compareMode, digest);
    drawDrilldown();
  };
```

Add a click branch so a digest line opens the drill-down, before the `[data-slice-key]` branch:

```js
    const digestItem = event.target.closest('[data-digest-key]');
    if (digestItem) {
      const doFetch = () => transactionsForSlice(
        current,
        { filters: toQueryFilters(filters), sliceBy: digestItem.dataset.digestSlice },
        digestItem.dataset.digestKey
      );
      const bucket = doFetch();
      drilldown = bucket ? { label: bucket.label, rows: bucket.rows, refetch: doFetch } : null;
      drawDrilldown();
      return;
    }
```

Expose a way for the import handoff to open it:

```js
  function showDigest(monthKey) {
    digest = { expanded: true, monthKey };
    draw();
  }
```

and add `showDigest` to the returned object alongside `redraw`, `refresh` and `closeDrilldown`.

**Keep `<details open>` across a redraw.** `draw()` replaces the markup, which would collapse the digest while the user is reading it. Reuse the same technique the multi-select popover uses — record the open state before the redraw and restore it after — or, simpler here, drive `open` entirely from `digest.expanded` and toggle that state from a `toggle` listener:

```js
  root.addEventListener('toggle', (event) => {
    if (event.target.matches?.('details.digest')) digest = { ...digest, expanded: event.target.open };
  }, true);
```

- [ ] **Step 5: Land on the digest after an import**

In `web/app.js`, change the import handler so it expands the digest for the month the import covered:

```js
renderImportView(views.import, {
  onImported: async (summary) => {
    await guardedRefresh();
    showTab('overview');
    // The ritual should end with an answer, not a receipt.
    overview?.showDigest?.(summary?.latestMonth);
  }
});
```

In `web/import-view.js`, have the commit handler pass the latest month it wrote. After a successful `commitImport`, derive it from the response's date range (the commit response already reports the imported range; use its end date's `YYYY-MM`) and pass it through:

```js
      onImported?.({ latestMonth: result?.dateTo?.slice(0, 7) ?? null });
```

If the commit response does not expose `dateTo`, pass `null` — `renderDigest` falls back to `latestMonthKey(snapshot)`, which is the same month in every normal case. Do not add a field to the API for this.

- [ ] **Step 6: Add the styles**

```css
.digest { border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface-raised); margin-bottom: var(--space-5); padding: var(--space-3) var(--space-4); }
.digest-summary { cursor: pointer; font-size: var(--step-1); font-weight: 600; letter-spacing: -0.01em; }
.digest-list { list-style: none; margin: var(--space-3) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
.digest-finding { border-left: 3px solid var(--line); padding-left: var(--space-3); }
.digest-finding[data-digest-key] { cursor: pointer; }
.digest-finding[data-digest-key]:hover { border-left-color: var(--accent); }
.digest-lead { margin: 0; }
.digest-detail { margin: var(--space-1) 0 0; font-size: var(--step--1); color: var(--muted); }
/* Tone is a border tint only — every finding's meaning is in its words. */
.digest-tone-up { border-left-color: var(--warn); }
.digest-tone-new { border-left-color: var(--accent); }
.digest-more { margin-top: var(--space-3); }
.digest-more summary { cursor: pointer; font-size: var(--step--1); color: var(--muted); }
```

- [ ] **Step 7: Run the whole suite**

Run: `node --test 'tests/**/*.test.js'`
Expected: PASS

- [ ] **Step 8: Verify live**

**Never run this against `data/`.** Per `CLAUDE.md`, live checks use the test server only, and any data it needs must be a synthetic fixture you write — never a real-looking CSV from elsewhere on the filesystem.

```bash
npm run start:test
```

Write a fixture into `tests/fixtures/` covering at least four consecutive months, including a new merchant in the final month, a category that jumps, and a subscription price rise. Import it at <http://127.0.0.1:5174>, then confirm:

1. The import lands on the Overview with the digest **expanded**, naming the right month.
2. The headline gives real spend, a transaction count and a comparison.
3. At most three findings are shown, with the rest behind **n more**.
4. Clicking a finding opens the drill-down on those transactions.
5. Importing a **part-month** statement labels it *month to date*, compares against the same point in earlier months, and hedges the projection separately.
6. Clearing several merchants in the Review tab and reloading produces a digest line that **names the recategorisation** rather than reporting it as a spending change.
7. A first-ever import shows only the headline, saying there is nothing to compare against.

- [ ] **Step 9: Update the README and the changelog**

Add a **Digest** section to the README describing what it reports and stating plainly that it is computed locally with no model call. Read `~/.claude/changelog-format.md`, then add a `CHANGELOG.md` entry.

- [ ] **Step 10: Commit**

```bash
git add web/digest-view.js web/overview-view.js web/import-view.js web/app.js web/style.css tests/digest-view.test.js README.md CHANGELOG.md
git commit -m "feat: add the monthly digest to the Overview and the post-import landing"
```

---

## Self-Review Notes

- **Coverage:** post-import landing plus a re-openable Overview section (Task 6), top 3 with expandable more (Tasks 5–6), **both** proration readings — matched baseline in the lead, hedged projection in the detail (Tasks 1 and 5), and annotated taxonomy attribution rather than suppression (Tasks 2, 3, 5).
- **No LLM anywhere.** Every sentence is template composition over local data.
- **Known limitation:** taxonomy attribution detects the common case — a merchant that was uncategorised in the baseline and is categorised now. It cannot detect a *re-*categorisation between two real categories, because the ledger keeps no history of `categorySource`. Storing that history would be a data-model change and is out of scope here.
- **Known limitation:** the `extreme` detector needs four months of a category's history before it will report a record, so it stays silent for the first few months of a new ledger. That is intended.
- **Deliberately not built:** any cross-finding synthesis ("the grocery spike and the takeaway drop are the same story"). That needs causal reasoning a template cannot do, and it was ruled out with the no-LLM constraint.
