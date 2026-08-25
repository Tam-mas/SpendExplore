# Recurring & Subscription Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect repeating charges from the existing ledger — no new data, no user setup — and answer the questions a monthly total cannot: what is committed before you spend anything, what does each subscription actually cost per year, which prices went up, and what has gone quiet.

**Architecture:** `lib/recurring.js` is a new pure module: snapshot in, series out, no I/O and no DOM, exactly like `lib/budgets.js`. It leans entirely on `lib/merchant-normalise.js` already having collapsed `SQ*NETFLIX 0592 COBURG VI AUS` down to `Netflix` — cadence detection over a clean merchant name is tractable; over raw bank descriptions it is not. Detection is **recomputed from the ledger on every load** so it can never drift out of sync with the data; the only persisted state is the user's own corrections, in a new `recurring.json` collection shaped like `rules.json`.

**Tech Stack:** Node.js stdlib only, `node:test` + `node:assert/strict`, vanilla DOM. No new dependencies.

## Global Constraints

- Zero npm dependencies. Node stdlib only. No build step; plain ES modules served directly.
- Run tests with `node --test 'tests/**/*.test.js'` (the bare-directory form is broken on this Node version) or explicit file paths.
- `lib/` stays pure: no I/O, no DOM. `web/` owns all DOM wiring, `server/` owns persistence and validation.
- **Sign convention.** The ledger stores spend as a **negative** amount. Every cost this module reports — `typicalAmount`, `monthlyCost`, `annualCost`, `committedMonthly` — is a **positive magnitude**, matching `lib/budgets.js`. A negative "annual cost" is a bug, not a display choice.
- Dates are inclusive ISO `YYYY-MM-DD` strings; all arithmetic is UTC-based, matching `lib/query/group-by.js`.
- **Detection is strict by default.** A series needs **3 or more** occurrences. It is better to miss a subscription than to tell the user a coincidence is a commitment — a false "you're committed to $847/month" is worse than an incomplete list.
- Detection never mutates the ledger and never writes anything. The only write in this plan is a user's explicit override.
- Every new/changed test file must pass before its task's commit.
- Untrusted strings — **merchant names come from bank CSVs and are untrusted** — are escaped with `escapeHtml` from `web/charts/scale.js` before going into any markup.
- Server-side validation rejects unknown fields and over-long strings before anything is written; the override route follows `server/routes/budgets.js` exactly, including reading and validating the body **before** entering the shared mutation gate.
- No comments explaining WHAT code does, only non-obvious WHY.
- **Live verification must use `npm run start:test`** (`DATA_DIR=./data-test`, port 5174). Never against `data/`; never read files from outside this repo. See `CLAUDE.md`.

---

## File Structure

| File | Change |
|---|---|
| `lib/recurring.js` | **New.** `CADENCES`, `detectCadence`, `amountProfile`, `detectRecurring` |
| `server/store.js` | Add `recurring` to the `COLLECTIONS` allow-list |
| `server/routes/recurring.js` | **New.** `POST /api/recurring/override` |
| `server/routes.js` | Wire in `recurringRoutes`; add `recurring` to `GET /api/snapshot` |
| `web/recurring-view.js` | **New.** `renderRecurring` (pure), `mountRecurring` (DOM) |
| `web/api.js` | Add `postRecurringOverride` |
| `web/app.js` | Register the Recurring tab and its drill-down root |
| `web/index.html` | Tab button, view section, third drill-down root |
| `web/overview-view.js` | "Committed monthly" KPI tile |
| `web/style.css` | Recurring table, cadence and status badges |
| `tests/recurring-cadence.test.js` | **New.** |
| `tests/recurring-detect.test.js` | **New.** |
| `tests/recurring-routes.test.js` | **New.** |
| `tests/recurring-view.test.js` | **New.** |

---

## Task 1: cadence detection

**Files:**
- Create: `lib/recurring.js`
- Test: `tests/recurring-cadence.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `CADENCES: readonly {id, label, days, tolerance}[]`; `gapsBetween(dates) → number[]`; `detectCadence(dates, { strict }) → { cadence, days, label, skippedPeriods } | null`. Tasks 3 and 5 depend on these names.

**The tolerance bands must not overlap.** Weekly 5–9, fortnightly 11–17, monthly 25–36, quarterly 82–100, annual 345–385. A gap in the dead zone between two bands (say 20 days) matches nothing, which is correct — that is not a cadence.

- [ ] **Step 1: Write the failing tests**

Create `tests/recurring-cadence.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CADENCES, gapsBetween, detectCadence } from '../lib/recurring.js';

test('cadence tolerance bands never overlap', () => {
  const bands = CADENCES.map((c) => [c.days - c.tolerance, c.days + c.tolerance]).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < bands.length; i++) {
    assert.ok(bands[i][0] > bands[i - 1][1],
      `bands overlap: ${JSON.stringify(bands[i - 1])} and ${JSON.stringify(bands[i])}`);
  }
});

test('gapsBetween returns inclusive day differences in date order', () => {
  assert.deepEqual(gapsBetween(['2026-08-01', '2026-08-08', '2026-08-15']), [7, 7]);
  // Unsorted input must still produce ascending gaps.
  assert.deepEqual(gapsBetween(['2026-08-15', '2026-08-01', '2026-08-08']), [7, 7]);
  assert.deepEqual(gapsBetween(['2026-08-01']), []);
});

test('detectCadence recognises a monthly charge despite 28-31 day months', () => {
  const result = detectCadence(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
  assert.equal(result.cadence, 'monthly');
  assert.equal(result.skippedPeriods, 0);
});

test('detectCadence separates fortnightly from monthly', () => {
  assert.equal(detectCadence(['2026-08-01', '2026-08-15', '2026-08-29']).cadence, 'fortnightly');
  assert.equal(detectCadence(['2026-06-01', '2026-07-01', '2026-08-01']).cadence, 'monthly');
});

test('detectCadence recognises weekly, quarterly and annual', () => {
  assert.equal(detectCadence(['2026-08-03', '2026-08-10', '2026-08-17']).cadence, 'weekly');
  assert.equal(detectCadence(['2025-11-01', '2026-02-01', '2026-05-01']).cadence, 'quarterly');
  assert.equal(detectCadence(['2024-03-01', '2025-03-01', '2026-03-01']).cadence, 'annual');
});

test('detectCadence rejects fewer than three occurrences in strict mode', () => {
  assert.equal(detectCadence(['2026-07-01', '2026-08-01']), null);
});

test('detectCadence accepts two occurrences in loose mode', () => {
  const result = detectCadence(['2026-07-01', '2026-08-01'], { strict: false });
  assert.equal(result.cadence, 'monthly');
});

test('detectCadence rejects gaps that match no band', () => {
  // 20 days is in the dead zone between fortnightly and monthly. It is not a
  // cadence, and calling it one would manufacture a subscription.
  assert.equal(detectCadence(['2026-08-01', '2026-08-21', '2026-09-10']), null);
});

test('detectCadence rejects an irregular sequence even when the median looks clean', () => {
  // Gaps 30, 5, 55: the median is 30, but this is not a monthly charge.
  assert.equal(detectCadence(['2026-06-01', '2026-07-01', '2026-07-06', '2026-08-30']), null);
});

test('detectCadence tolerates a single skipped period and counts it', () => {
  // A failed payment in March. Still monthly, with one period missed.
  const result = detectCadence(['2026-01-15', '2026-02-15', '2026-04-15', '2026-05-15']);
  assert.equal(result.cadence, 'monthly');
  assert.equal(result.skippedPeriods, 1);
});

test('detectCadence rejects a sequence that is mostly skips', () => {
  // Two of three gaps are doubled — too sparse to call a monthly commitment.
  assert.equal(detectCadence(['2026-01-15', '2026-03-15', '2026-05-15', '2026-06-15']), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/recurring-cadence.test.js`
Expected: FAIL — `Cannot find module '.../lib/recurring.js'`

- [ ] **Step 3: Write the implementation**

Create `lib/recurring.js`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/recurring-cadence.test.js`
Expected: PASS, 11 tests

- [ ] **Step 5: Commit**

```bash
git add lib/recurring.js tests/recurring-cadence.test.js
git commit -m "feat: add cadence detection for recurring charges"
```

---

## Task 2: amount profiling — fixed, stepped, or variable

**Files:**
- Modify: `lib/recurring.js`
- Test: `tests/recurring-amount.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `amountProfile(amounts) → { kind: 'fixed'|'stepped'|'variable', typical, min, max, step: { from, to, index } | null }`. `amounts` is in **date order** and may be signed; the profile works on magnitudes. Task 3 depends on this.

**Why this exists:** a Netflix subscription is fixed and a price rise is the interesting event; a quarterly electricity bill is variable and a "price change" alert on it would be noise. The profile is how the two are told apart.

- [ ] **Step 1: Write the failing tests**

Create `tests/recurring-amount.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountProfile } from '../lib/recurring.js';

test('a constant amount profiles as fixed', () => {
  const profile = amountProfile([-16.99, -16.99, -16.99]);
  assert.equal(profile.kind, 'fixed');
  assert.equal(profile.typical, 16.99);
  assert.equal(profile.step, null);
});

test('tiny variation still profiles as fixed', () => {
  // A few cents of rounding is not a price change.
  assert.equal(amountProfile([-16.99, -17.0, -16.99]).kind, 'fixed');
});

test('a single sustained rise profiles as stepped and reports the change', () => {
  const profile = amountProfile([-16.99, -16.99, -18.99, -18.99]);
  assert.equal(profile.kind, 'stepped');
  assert.equal(profile.step.from, 16.99);
  assert.equal(profile.step.to, 18.99);
  assert.equal(profile.step.index, 2);
  // The typical cost is what it costs NOW, not the average of the old and new.
  assert.equal(profile.typical, 18.99);
});

test('a price DROP is reported as a step too', () => {
  const profile = amountProfile([-22.0, -22.0, -15.0, -15.0]);
  assert.equal(profile.kind, 'stepped');
  assert.equal(profile.step.from, 22);
  assert.equal(profile.step.to, 15);
});

test('a fluctuating bill profiles as variable with no step', () => {
  const profile = amountProfile([-180, -260, -195, -240]);
  assert.equal(profile.kind, 'variable');
  assert.equal(profile.step, null);
  assert.equal(profile.min, 180);
  assert.equal(profile.max, 260);
  // A variable series' typical cost is its median, not its latest value.
  assert.equal(profile.typical, 217.5);
});

test('two runs that each fluctuate are variable, not stepped', () => {
  // Only a clean step between two stable runs counts as a price change.
  assert.equal(amountProfile([-180, -260, -300, -420]).kind, 'variable');
});

test('a step needs at least two readings on each side', () => {
  // One high final charge is an anomaly, not an established new price.
  assert.equal(amountProfile([-16.99, -16.99, -16.99, -49.0]).kind, 'variable');
});

test('amountProfile is empty-safe', () => {
  const profile = amountProfile([]);
  assert.equal(profile.kind, 'variable');
  assert.equal(profile.typical, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/recurring-amount.test.js`
Expected: FAIL — `amountProfile is not a function`

- [ ] **Step 3: Write the implementation**

Append to `lib/recurring.js`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/recurring-amount.test.js`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add lib/recurring.js tests/recurring-amount.test.js
git commit -m "feat: profile recurring amounts as fixed, stepped or variable"
```

---

## Task 3: `detectRecurring` — assembling the series

**Files:**
- Modify: `lib/recurring.js`
- Test: `tests/recurring-detect.test.js`

**Interfaces:**
- Consumes: `detectCadence` (Task 1), `amountProfile` (Task 2).
- Produces: `detectRecurring(snapshot, { today }) → { series, committedMonthly, committedAnnual }`.

Each series is:

```
{
  merchant, categoryId, cadence, cadenceLabel, cadenceDays, confidence: 'high'|'medium',
  occurrences, firstDate, lastDate, skippedPeriods,
  amountKind, typicalAmount, minAmount, maxAmount,
  monthlyCost, annualCost,
  nextExpected, status: 'active'|'dormant', missedPeriods,
  priceChange: { from, to, date } | null,
  transactionIds: string[]
}
```

**Grouping strategy, and why:** detection runs on **all of a merchant's transactions at once**, not on amount clusters. A quarterly electricity bill swinging $180–$260 is one commitment with a variable amount — splitting it by amount first would leave each cluster too small to detect anything. `amountProfile` then describes the shape after the fact.

- [ ] **Step 1: Write the failing tests**

Create `tests/recurring-detect.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRecurring } from '../lib/recurring.js';

const t = (over) => ({
  id: 'x', date: '2026-08-10', amount: -10, rawDescription: 'R', merchant: 'M',
  accountId: 'a', cardSuffix: null, categoryId: 'subscriptions', categorySource: 'rule',
  excluded: false, importId: 'i', note: null, ...over
});

const monthly = (merchant, amount, months, categoryId = 'subscriptions') =>
  months.map((month, i) => t({
    id: `${merchant}-${i}`, merchant, amount, categoryId, date: `${month}-15`
  }));

const TODAY = '2026-08-24';

const snapshotOf = (transactions) => ({
  transactions,
  accounts: [],
  recurring: [],
  categories: {
    groups: [{ id: 'lifestyle', label: 'Lifestyle' }, { id: 'home', label: 'Home' }],
    categories: [
      { id: 'subscriptions', label: 'Subscriptions', groupId: 'lifestyle' },
      { id: 'energy', label: 'Energy', groupId: 'home' },
      { id: 'groceries', label: 'Groceries', groupId: 'lifestyle' },
      { id: 'income', label: 'Income', groupId: 'other' }
    ]
  }
});

const find = (result, merchant) => result.series.find((s) => s.merchant === merchant);

test('a monthly subscription is detected with its annualised cost', () => {
  const result = detectRecurring(
    snapshotOf(monthly('Netflix', -16.99, ['2026-05', '2026-06', '2026-07', '2026-08'])),
    { today: TODAY }
  );
  const netflix = find(result, 'Netflix');
  assert.equal(netflix.cadence, 'monthly');
  assert.equal(netflix.occurrences, 4);
  assert.equal(netflix.typicalAmount, 16.99);
  assert.equal(netflix.amountKind, 'fixed');
  assert.equal(netflix.confidence, 'high');
  // 16.99 * (365.25 / 30.44) = 203.87
  assert.equal(netflix.annualCost, 203.87);
  assert.equal(netflix.monthlyCost, 16.99);
});

test('costs are positive magnitudes, never the ledger sign', () => {
  const result = detectRecurring(
    snapshotOf(monthly('Netflix', -16.99, ['2026-05', '2026-06', '2026-07', '2026-08'])),
    { today: TODAY }
  );
  const netflix = find(result, 'Netflix');
  assert.ok(netflix.typicalAmount > 0);
  assert.ok(netflix.monthlyCost > 0);
  assert.ok(result.committedMonthly > 0);
});

test('committedMonthly is the sum of every ACTIVE series', () => {
  const result = detectRecurring(snapshotOf([
    ...monthly('Netflix', -16.99, ['2026-06', '2026-07', '2026-08']),
    ...monthly('Spotify', -13.99, ['2026-06', '2026-07', '2026-08'])
  ]), { today: TODAY });
  assert.equal(result.series.length, 2);
  assert.equal(result.committedMonthly, 30.98);
  assert.equal(result.committedAnnual, 371.76);
});

test('a series whose next charge is long overdue is dormant and excluded from the commitment', () => {
  const result = detectRecurring(snapshotOf([
    ...monthly('Netflix', -16.99, ['2026-06', '2026-07', '2026-08']),
    ...monthly('OldGym', -60, ['2026-01', '2026-02', '2026-03'])
  ]), { today: TODAY });

  const gym = find(result, 'OldGym');
  assert.equal(gym.status, 'dormant');
  assert.ok(gym.missedPeriods >= 4, `expected several missed periods, got ${gym.missedPeriods}`);
  // A cancelled gym must not inflate what you are committed to.
  assert.equal(result.committedMonthly, 16.99);
});

test('a price rise is reported with the date it took effect', () => {
  const result = detectRecurring(snapshotOf([
    t({ id: 'n1', merchant: 'Netflix', amount: -16.99, date: '2026-05-15' }),
    t({ id: 'n2', merchant: 'Netflix', amount: -16.99, date: '2026-06-15' }),
    t({ id: 'n3', merchant: 'Netflix', amount: -18.99, date: '2026-07-15' }),
    t({ id: 'n4', merchant: 'Netflix', amount: -18.99, date: '2026-08-15' })
  ]), { today: TODAY });

  const netflix = find(result, 'Netflix');
  assert.equal(netflix.amountKind, 'stepped');
  assert.deepEqual(netflix.priceChange, { from: 16.99, to: 18.99, date: '2026-07-15' });
  // The commitment uses the NEW price.
  assert.equal(netflix.typicalAmount, 18.99);
});

test('a variable quarterly bill is detected as one commitment, not split by amount', () => {
  const result = detectRecurring(snapshotOf([
    t({ id: 'e1', merchant: 'AGL', amount: -180, categoryId: 'energy', date: '2025-11-01' }),
    t({ id: 'e2', merchant: 'AGL', amount: -260, categoryId: 'energy', date: '2026-02-01' }),
    t({ id: 'e3', merchant: 'AGL', amount: -195, categoryId: 'energy', date: '2026-05-01' }),
    t({ id: 'e4', merchant: 'AGL', amount: -240, categoryId: 'energy', date: '2026-08-01' })
  ]), { today: TODAY });

  const agl = find(result, 'AGL');
  assert.equal(agl.cadence, 'quarterly');
  assert.equal(agl.amountKind, 'variable');
  assert.equal(agl.priceChange, null);
  assert.equal(agl.minAmount, 180);
  assert.equal(agl.maxAmount, 260);
});

test('irregular shopping is not reported as recurring', () => {
  const result = detectRecurring(snapshotOf([
    t({ id: 'c1', merchant: 'Coles', amount: -84.2, categoryId: 'groceries', date: '2026-08-02' }),
    t({ id: 'c2', merchant: 'Coles', amount: -21.9, categoryId: 'groceries', date: '2026-08-05' }),
    t({ id: 'c3', merchant: 'Coles', amount: -110.4, categoryId: 'groceries', date: '2026-08-19' })
  ]), { today: TODAY });
  assert.equal(find(result, 'Coles'), undefined);
});

test('two occurrences are never enough on their own', () => {
  const result = detectRecurring(
    snapshotOf(monthly('Newsletter', -5, ['2026-07', '2026-08'])),
    { today: TODAY }
  );
  assert.equal(result.series.length, 0);
});

test('excluded, income and transfer transactions are ignored', () => {
  const result = detectRecurring(snapshotOf([
    ...monthly('Salary', 4000, ['2026-06', '2026-07', '2026-08'], 'income'),
    ...monthly('Hidden', -500, ['2026-06', '2026-07', '2026-08']).map((x) => ({ ...x, excluded: true })),
    // A standing transfer to savings is a real commitment, but it is not
    // SPEND — and this tab's headline number sits beside "Total spend",
    // which excludes transfers. Counting it here would make the two figures
    // mean different things.
    ...monthly('Savings Transfer', -500, ['2026-06', '2026-07', '2026-08'], 'transfers')
  ]), { today: TODAY });
  assert.equal(result.series.length, 0);
});

test('nextExpected is one cadence after the last charge', () => {
  const result = detectRecurring(
    snapshotOf(monthly('Netflix', -16.99, ['2026-06', '2026-07', '2026-08'])),
    { today: TODAY }
  );
  assert.equal(find(result, 'Netflix').nextExpected, '2026-09-14');
});

test('series are ordered by annual cost, most expensive first', () => {
  const result = detectRecurring(snapshotOf([
    ...monthly('Spotify', -13.99, ['2026-06', '2026-07', '2026-08']),
    ...monthly('Netflix', -18.99, ['2026-06', '2026-07', '2026-08'])
  ]), { today: TODAY });
  assert.deepEqual(result.series.map((s) => s.merchant), ['Netflix', 'Spotify']);
});

test('confidence drops to medium on a thin or skipped series', () => {
  const result = detectRecurring(
    snapshotOf(monthly('Thin', -9, ['2026-06', '2026-07', '2026-08'])),
    { today: TODAY }
  );
  assert.equal(find(result, 'Thin').confidence, 'medium');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/recurring-detect.test.js`
Expected: FAIL — `detectRecurring is not a function`

- [ ] **Step 3: Write the implementation**

Append to `lib/recurring.js`:

```js
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

    const annualCost = round2(profile.typical * (365.25 / cadence.days));

    series.push({
      merchant,
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
      monthlyCost: round2(annualCost / 12),
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/recurring-detect.test.js`
Expected: PASS, 12 tests

- [ ] **Step 5: Commit**

```bash
git add lib/recurring.js tests/recurring-detect.test.js
git commit -m "feat: detect recurring charges with annualised costs and price changes"
```

---

## Task 4: user overrides — persistence and the route

**Files:**
- Modify: `lib/recurring.js`, `server/store.js`, `server/routes.js`
- Create: `server/routes/recurring.js`
- Test: `tests/recurring-routes.test.js`

**Interfaces:**
- Consumes: `detectRecurring` (Task 3); `store`, `serialized` from the existing server plumbing.
- Produces: `applyOverrides(result, overrides, snapshot, options) → { series, committedMonthly, committedAnnual }`; `createRecurringRoutes(store, serialized)`; `POST /api/recurring/override` accepting `{ merchant, decision }` where decision is `'recurring' | 'ignored' | 'auto'`. `GET /api/snapshot` gains a `recurring` array.

**Override semantics:**
- `ignored` — drop every series for that merchant, and drop it from the committed totals.
- `recurring` — if strict detection found nothing for that merchant, re-run detection for it in **loose** mode (2+ occurrences) and include the result, marked `confidence: 'medium'` and `forced: true`.
- `auto` — remove the override, returning that merchant to normal detection.

- [ ] **Step 1: Write the failing tests**

Create `tests/recurring-routes.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';
import { applyOverrides, detectRecurring } from '../lib/recurring.js';

// Every test uses a throwaway data directory. NEVER point a test at ./data —
// that is the user's real ledger. See CLAUDE.md.
async function withServer(run) {
  const dataDir = await mkdtemp(join(tmpdir(), 'spendexplore-recurring-'));
  const server = await startServer({ dataDir, port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run({ base, dataDir });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const t = (over) => ({
  id: 'x', date: '2026-08-15', amount: -16.99, rawDescription: 'R', merchant: 'Netflix',
  accountId: 'a', cardSuffix: null, categoryId: 'subscriptions', categorySource: 'rule',
  excluded: false, importId: 'i', note: null, ...over
});

const NETFLIX = ['2026-06', '2026-07', '2026-08'].map((m, i) =>
  t({ id: `n${i}`, date: `${m}-15` }));

const SNAPSHOT = {
  transactions: NETFLIX,
  categories: { groups: [], categories: [] },
  accounts: []
};

test('an "ignored" override removes the series and its cost', () => {
  const detected = detectRecurring(SNAPSHOT, { today: '2026-08-24' });
  assert.equal(detected.series.length, 1);

  const result = applyOverrides(detected, [{ merchant: 'Netflix', decision: 'ignored' }], SNAPSHOT, { today: '2026-08-24' });
  assert.equal(result.series.length, 0);
  assert.equal(result.committedMonthly, 0);
});

test('a "recurring" override forces a two-occurrence series into the list', () => {
  const thin = {
    ...SNAPSHOT,
    transactions: [t({ id: 'a', merchant: 'Newsletter', date: '2026-07-15', amount: -5 }),
                   t({ id: 'b', merchant: 'Newsletter', date: '2026-08-15', amount: -5 })]
  };
  assert.equal(detectRecurring(thin, { today: '2026-08-24' }).series.length, 0);

  const result = applyOverrides(
    detectRecurring(thin, { today: '2026-08-24' }),
    [{ merchant: 'Newsletter', decision: 'recurring' }],
    thin,
    { today: '2026-08-24' }
  );
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].merchant, 'Newsletter');
  assert.equal(result.series[0].forced, true);
  assert.equal(result.series[0].confidence, 'medium');
});

test('an override for a merchant with no usable history changes nothing', () => {
  const result = applyOverrides(
    detectRecurring(SNAPSHOT, { today: '2026-08-24' }),
    [{ merchant: 'Nowhere', decision: 'recurring' }],
    SNAPSHOT,
    { today: '2026-08-24' }
  );
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].merchant, 'Netflix');
});

test('POST /api/recurring/override persists a decision and returns the list', async () => {
  await withServer(async ({ base, dataDir }) => {
    const res = await fetch(`${base}/api/recurring/override`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ merchant: 'Netflix', decision: 'ignored' })
    });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).recurring, [{ merchant: 'Netflix', decision: 'ignored' }]);

    const onDisk = JSON.parse(await readFile(join(dataDir, 'recurring.json'), 'utf8'));
    assert.deepEqual(onDisk, [{ merchant: 'Netflix', decision: 'ignored' }]);
  });
});

test('a second decision for the same merchant replaces the first, never duplicates it', async () => {
  await withServer(async ({ base }) => {
    const post = (body) => fetch(`${base}/api/recurring/override`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    await post({ merchant: 'Netflix', decision: 'ignored' });
    const res = await post({ merchant: 'Netflix', decision: 'recurring' });
    assert.deepEqual((await res.json()).recurring, [{ merchant: 'Netflix', decision: 'recurring' }]);
  });
});

test('"auto" clears an override', async () => {
  await withServer(async ({ base }) => {
    const post = (body) => fetch(`${base}/api/recurring/override`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    await post({ merchant: 'Netflix', decision: 'ignored' });
    const res = await post({ merchant: 'Netflix', decision: 'auto' });
    assert.deepEqual((await res.json()).recurring, []);
  });
});

test('the override route rejects a bad body', async () => {
  await withServer(async ({ base }) => {
    const post = (body) => fetch(`${base}/api/recurring/override`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    assert.equal((await post({ merchant: '', decision: 'ignored' })).status, 400);
    assert.equal((await post({ merchant: 'Netflix', decision: 'nope' })).status, 400);
    assert.equal((await post({ merchant: 'x'.repeat(201), decision: 'ignored' })).status, 400);
    assert.equal((await post(['array']).catch(() => ({ status: 400 }))).status, 400);
  });
});

test('GET /api/snapshot includes the recurring overrides', async () => {
  await withServer(async ({ base }) => {
    const snapshot = await (await fetch(`${base}/api/snapshot`)).json();
    assert.deepEqual(snapshot.recurring, []);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/recurring-routes.test.js`
Expected: FAIL — `applyOverrides is not a function`, and the route 404s

- [ ] **Step 3: Add `applyOverrides` to `lib/recurring.js`**

```js
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
```

- [ ] **Step 4: Add the collection to `server/store.js`**

Inside `COLLECTIONS`, after the `budgets` entry:

```js
  // User corrections to recurring detection, keyed by merchant. Detection
  // itself is always recomputed from the ledger — only the corrections are
  // stored, so a stale cache can never disagree with the data.
  recurring:  { file: 'recurring.json',  seed: () => [] }
```

- [ ] **Step 5: Create `server/routes/recurring.js`**

```js
import { sendJson, readBody } from '../http.js';
import { OVERRIDE_DECISIONS } from '../../lib/recurring.js';

const MAX_MERCHANT_LENGTH = 200;

function validateOverrideBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' };
  }
  const { merchant, decision } = body;
  if (typeof merchant !== 'string' || merchant === '') {
    return { error: 'merchant is required' };
  }
  // Merchant names come from bank CSVs. Cap the length so a malformed file
  // cannot append an unbounded string to a file we then read on every request.
  if (merchant.length > MAX_MERCHANT_LENGTH) {
    return { error: `merchant must be ${MAX_MERCHANT_LENGTH} characters or fewer` };
  }
  if (!OVERRIDE_DECISIONS.includes(decision)) {
    return { error: `decision must be one of: ${OVERRIDE_DECISIONS.join(', ')}` };
  }
  return { body: { merchant, decision } };
}

/**
 * POST /api/recurring/override — record (or clear) the user's decision about
 * one merchant. Replaces any prior decision for that merchant rather than
 * appending, because unlike budgets there is no history worth keeping: only
 * the current opinion matters.
 *
 * Returns a router function `(req, res, pathname) => boolean | Promise`,
 * matching the same fall-through contract as the other route modules.
 */
export function createRecurringRoutes(store, serialized) {
  // readBody() and shape validation run BEFORE entering `serialized` — a
  // stalled connection inside the one shared mutation gate would wedge every
  // other write in the app. Same reasoning as server/routes/budgets.js.
  async function handleOverride(req, res) {
    const validated = validateOverrideBody(await readBody(req));
    if (validated.error) return sendJson(res, 400, { error: validated.error });
    const { merchant, decision } = validated.body;

    return serialized(async () => {
      const current = await store.read('recurring');
      const without = current.filter((entry) => entry.merchant !== merchant);
      const next = decision === 'auto' ? without : [...without, { merchant, decision }];

      await store.backup();
      await store.write('recurring', next);
      return sendJson(res, 200, { recurring: next });
    });
  }

  return function handleRecurringRoute(req, res, pathname) {
    if (req.method === 'POST' && pathname === '/api/recurring/override') {
      return handleOverride(req, res);
    }
    return false;
  };
}
```

- [ ] **Step 6: Wire it into `server/routes.js`**

Add the import:

```js
import { createRecurringRoutes } from './routes/recurring.js';
```

Add the construction alongside the others:

```js
  const recurringRoutes = createRecurringRoutes(store, gate);
```

Extend the snapshot read and response:

```js
    if (req.method === 'GET' && pathname === '/api/snapshot') {
      const [transactions, categories, rules, accounts, views, imports, budgets, recurring] = await Promise.all([
        store.read('ledger'), store.read('categories'), store.read('rules'),
        store.read('accounts'), store.read('views'), store.read('imports'),
        store.read('budgets'), store.read('recurring')
      ]);
      return sendJson(res, 200, { transactions, categories, rules, accounts, views, imports, budgets, recurring });
    }
```

And add it to the handler list:

```js
    for (const handler of [importRoutes, transactionRoutes, budgetRoutes, recurringRoutes]) {
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test tests/recurring-routes.test.js`
Expected: PASS, 8 tests

- [ ] **Step 8: Run the whole suite**

Run: `node --test 'tests/**/*.test.js'`
Expected: PASS. `tests/store.test.js` and `tests/routes.test.js` may assert the exact snapshot key set — if either fails, add `recurring` to its expectation.

- [ ] **Step 9: Commit**

```bash
git add lib/recurring.js server/store.js server/routes/recurring.js server/routes.js tests/recurring-routes.test.js
git commit -m "feat: persist recurring-detection overrides and expose them in the snapshot"
```

---

## Task 5: `web/recurring-view.js` — the pure render

**Files:**
- Create: `web/recurring-view.js`
- Test: `tests/recurring-view.test.js`

**Interfaces:**
- Consumes: `detectRecurring`, `applyOverrides` from `lib/recurring.js`; `formatMoney`, `escapeHtml` from `web/charts/scale.js`.
- Produces: `renderRecurring(snapshot, { today }) → html string`. Task 6 adds `mountRecurring`.

- [ ] **Step 1: Write the failing tests**

Create `tests/recurring-view.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRecurring } from '../web/recurring-view.js';

const t = (over) => ({
  id: 'x', date: '2026-08-15', amount: -16.99, rawDescription: 'R', merchant: 'Netflix',
  accountId: 'a', cardSuffix: null, categoryId: 'subscriptions', categorySource: 'rule',
  excluded: false, importId: 'i', note: null, ...over
});

const series = (merchant, amount, months) => months.map((m, i) =>
  t({ id: `${merchant}${i}`, merchant, amount, date: `${m}-15` }));

const snapshotOf = (transactions, recurring = []) => ({
  transactions, recurring, accounts: [],
  categories: {
    groups: [{ id: 'lifestyle', label: 'Lifestyle' }],
    categories: [{ id: 'subscriptions', label: 'Subscriptions', groupId: 'lifestyle' }]
  }
});

const TODAY = { today: '2026-08-24' };

test('an empty ledger explains itself instead of rendering an empty table', () => {
  const html = renderRecurring(snapshotOf([]), TODAY);
  assert.match(html, /Nothing recurring/);
  assert.equal(html.includes('<table'), false);
});

test('the header states the total commitment in both monthly and annual terms', () => {
  const html = renderRecurring(snapshotOf([
    ...series('Netflix', -16.99, ['2026-06', '2026-07', '2026-08']),
    ...series('Spotify', -13.99, ['2026-06', '2026-07', '2026-08'])
  ]), TODAY);
  assert.match(html, /\$30\.98/);
  assert.match(html, /\$371\.76/);
  assert.match(html, /2 active/);
});

test('each row shows cadence, current price, annual cost and next expected date', () => {
  const html = renderRecurring(snapshotOf(series('Netflix', -16.99, ['2026-06', '2026-07', '2026-08'])), TODAY);
  assert.match(html, /Netflix/);
  assert.match(html, /Monthly/);
  assert.match(html, /\$16\.99/);
  assert.match(html, /\$203\.87/);
  assert.match(html, /2026-09-14/);
});

test('a price change is called out with both prices', () => {
  const html = renderRecurring(snapshotOf([
    t({ id: 'n1', amount: -16.99, date: '2026-05-15' }),
    t({ id: 'n2', amount: -16.99, date: '2026-06-15' }),
    t({ id: 'n3', amount: -18.99, date: '2026-07-15' }),
    t({ id: 'n4', amount: -18.99, date: '2026-08-15' })
  ]), TODAY);
  assert.match(html, /recurring-price-change/);
  assert.match(html, /\$16\.99/);
  assert.match(html, /\$18\.99/);
});

test('a dormant series is separated out and labelled with how long it has been quiet', () => {
  const html = renderRecurring(snapshotOf([
    ...series('Netflix', -16.99, ['2026-06', '2026-07', '2026-08']),
    ...series('OldGym', -60, ['2026-01', '2026-02', '2026-03'])
  ]), TODAY);
  assert.match(html, /Gone quiet/);
  assert.match(html, /OldGym/);
});

test('a variable bill shows its range rather than a single fixed price', () => {
  const html = renderRecurring(snapshotOf([
    t({ id: 'e1', merchant: 'AGL', amount: -180, date: '2025-11-01' }),
    t({ id: 'e2', merchant: 'AGL', amount: -260, date: '2026-02-01' }),
    t({ id: 'e3', merchant: 'AGL', amount: -195, date: '2026-05-01' }),
    t({ id: 'e4', merchant: 'AGL', amount: -240, date: '2026-08-01' })
  ]), TODAY);
  assert.match(html, /\$180\.00\s*–\s*\$260\.00/);
});

test('a merchant name from a bank CSV is escaped, never injected as markup', () => {
  const html = renderRecurring(snapshotOf(
    series('<img src=x onerror=alert(1)>', -9.99, ['2026-06', '2026-07', '2026-08'])
  ), TODAY);
  assert.equal(html.includes('<img src=x'), false);
  assert.match(html, /&lt;img src=x/);
});

test('an ignored merchant does not appear and does not count', () => {
  const html = renderRecurring(
    snapshotOf(series('Netflix', -16.99, ['2026-06', '2026-07', '2026-08']),
      [{ merchant: 'Netflix', decision: 'ignored' }]),
    TODAY
  );
  assert.match(html, /Nothing recurring/);
});

test('every row carries the merchant key needed to drill down and to override', () => {
  const html = renderRecurring(snapshotOf(series('Netflix', -16.99, ['2026-06', '2026-07', '2026-08'])), TODAY);
  assert.match(html, /data-recurring-merchant="Netflix"/);
  assert.match(html, /data-recurring-action="ignore"/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/recurring-view.test.js`
Expected: FAIL — `Cannot find module '.../web/recurring-view.js'`

- [ ] **Step 3: Write the implementation**

Create `web/recurring-view.js`:

```js
import { detectRecurring, applyOverrides } from '../lib/recurring.js';
import { formatMoney, escapeHtml } from './charts/scale.js';

/**
 * Compute the recurring picture for a snapshot: detect, then fold the user's
 * own overrides over the result. Exported so the Overview's KPI tile and this
 * view agree by construction rather than by coincidence.
 */
export function recurringFor(snapshot, options = {}) {
  const detected = detectRecurring(snapshot, options);
  return applyOverrides(detected, snapshot?.recurring ?? [], snapshot, options);
}

const priceCell = (item) => {
  if (item.amountKind === 'variable') {
    return `${formatMoney(item.minAmount)} – ${formatMoney(item.maxAmount)}`;
  }
  return formatMoney(item.typicalAmount);
};

const priceChangeNote = (item) => {
  if (!item.priceChange) return '';
  const { from, to, date } = item.priceChange;
  const direction = to > from ? 'rose' : 'fell';
  return `<p class="recurring-price-change">Price ${direction} from ${formatMoney(from)} to ${formatMoney(to)} on ${escapeHtml(date)}</p>`;
};

function row(item) {
  const merchant = escapeHtml(item.merchant);
  const quiet = item.status === 'dormant'
    ? `<span class="recurring-quiet">${item.missedPeriods} missed</span>`
    : escapeHtml(item.nextExpected);

  return `
    <tr data-recurring-merchant="${merchant}">
      <td>
        ${merchant}
        ${item.confidence === 'medium' ? '<span class="recurring-confidence" title="Fewer occurrences, a skipped period, or a variable amount">likely</span>' : ''}
        ${priceChangeNote(item)}
      </td>
      <td>${escapeHtml(item.cadenceLabel)}</td>
      <td class="num">${priceCell(item)}</td>
      <td class="num">${formatMoney(item.monthlyCost)}</td>
      <td class="num">${formatMoney(item.annualCost)}</td>
      <td>${quiet}</td>
      <td><button data-recurring-action="ignore" data-recurring-merchant="${merchant}">Not recurring</button></td>
    </tr>`;
}

const table = (caption, items) => `
  <table class="recurring-table">
    <caption class="viz-caption">${escapeHtml(caption)}</caption>
    <thead>
      <tr>
        <th scope="col">Merchant</th><th scope="col">Cadence</th>
        <th scope="col" class="num">Amount</th><th scope="col" class="num">Per month</th>
        <th scope="col" class="num">Per year</th><th scope="col">Next</th><th scope="col"></th>
      </tr>
    </thead>
    <tbody>${items.map(row).join('')}</tbody>
  </table>`;

/**
 * Pure render of the Recurring tab. `today` is injected so the output is
 * deterministic under test.
 */
export function renderRecurring(snapshot, { today } = {}) {
  const { series, committedMonthly, committedAnnual } = recurringFor(snapshot, today ? { today } : {});
  if (!series.length) {
    return `<p class="empty">Nothing recurring detected yet — a charge needs to appear at least three times on a consistent cadence before it counts.</p>`;
  }

  const active = series.filter((s) => s.status === 'active');
  const dormant = series.filter((s) => s.status === 'dormant');

  return `
    <div class="kpis">
      <div class="kpi"><span>Committed monthly</span><b>${formatMoney(committedMonthly)}</b></div>
      <div class="kpi"><span>Committed yearly</span><b>${formatMoney(committedAnnual)}</b></div>
      <div class="kpi"><span>Subscriptions</span><b>${active.length} active</b></div>
    </div>
    <p class="viz-note">Committed spend is what leaves your accounts before you decide anything. Click a row to see its transactions.</p>
    ${active.length ? table('Active', active) : ''}
    ${dormant.length ? table('Gone quiet — cancelled, or a payment that failed?', dormant) : ''}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/recurring-view.test.js`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add web/recurring-view.js tests/recurring-view.test.js
git commit -m "feat: add the pure render for the Recurring tab"
```

---

## Task 6: mount the tab, the KPI tile and the styles

**Files:**
- Modify: `web/recurring-view.js` (add `mountRecurring`), `web/api.js`, `web/app.js`, `web/index.html`, `web/overview-view.js`, `web/style.css`
- Test: `tests/recurring-view.test.js` (extend), `tests/overview-panels.test.js` (extend)

**Interfaces:**
- Consumes: `renderRecurring`, `recurringFor` (Task 5); `transactionsForSlice` from `lib/query/slice-transactions.js`; `renderDrilldown` from `web/drilldown-panel.js`; `guard` from `web/errors.js`.
- Produces: `mountRecurring(root, { snapshot, drilldownRoot }) → { redraw, refresh, closeDrilldown }`, matching the contract `mountBudgets` already returns; `postRecurringOverride(merchant, decision)` in `web/api.js`.

- [ ] **Step 1: Write the failing test for the KPI tile**

Append to `tests/overview-panels.test.js`:

```js
import { renderOverview as renderOverviewForRecurring } from '../web/overview-view.js';

const recTxn = (over) => ({
  id: 'x', date: '2026-08-15', amount: -16.99, rawDescription: 'R', merchant: 'Netflix',
  accountId: 'a', cardSuffix: null, categoryId: 'subscriptions', categorySource: 'rule',
  excluded: false, importId: 'i', note: null, ...over
});

test('the Overview KPI row reports the committed monthly total', () => {
  const snapshot = {
    accounts: [], recurring: [],
    categories: {
      groups: [{ id: 'lifestyle', label: 'Lifestyle' }],
      categories: [{ id: 'subscriptions', label: 'Subscriptions', groupId: 'lifestyle' }]
    },
    transactions: ['2026-06', '2026-07', '2026-08'].map((m, i) => recTxn({ id: `n${i}`, date: `${m}-15` }))
  };
  const html = renderOverviewForRecurring(snapshot, {}, []);
  assert.match(html, /Committed monthly/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/overview-panels.test.js`
Expected: FAIL — no `Committed monthly` tile

- [ ] **Step 3: Add `mountRecurring` to `web/recurring-view.js`**

Add these imports at the top of the file:

```js
import { transactionsForSlice } from '../lib/query/slice-transactions.js';
import { renderDrilldown } from './drilldown-panel.js';
import { postRecurringOverride, patchTransaction, getSnapshot } from './api.js';
import { guard } from './errors.js';
```

Append:

```js
/**
 * Wire the Recurring tab into a live DOM node. Mirrors mountBudgets: same
 * return shape, same drill-down reuse, and the session-hide checkbox is turned
 * off because nothing on this tab reads the session-only excludeIds filter.
 */
export function mountRecurring(root, { snapshot, drilldownRoot } = {}) {
  let current = snapshot;
  let drilldown = null;
  let reassignToken = 0;

  const drawDrilldown = () => {
    if (drilldown) {
      const bucket = drilldown.refetch();
      drilldown = bucket ? { ...drilldown, rows: bucket.rows, label: bucket.label } : null;
    }
    if (drilldownRoot) {
      drilldownRoot.innerHTML = renderDrilldown(current, drilldown && { ...drilldown, hideable: false });
      drilldownRoot.classList.toggle('hidden', !drilldown);
    }
  };

  const draw = () => {
    root.innerHTML = renderRecurring(current);
    drawDrilldown();
  };

  function openDrilldown(merchant) {
    const doFetch = () => transactionsForSlice(current, { filters: {}, sliceBy: 'merchant' }, merchant);
    const bucket = doFetch();
    drilldown = bucket ? { label: bucket.label, rows: bucket.rows, refetch: doFetch } : null;
    draw();
  }

  function closeDrilldown() {
    drilldown = null;
    draw();
  }

  const ignore = guard(async (merchant) => {
    await postRecurringOverride(merchant, 'ignored');
    current = await getSnapshot();
    draw();
  });

  // Same race guard as the Overview: discard a snapshot that arrives after a
  // newer edit has already started, or a slow response silently reverts it.
  const reassign = guard(async (id, categoryId) => {
    const token = ++reassignToken;
    await patchTransaction(id, { categoryId });
    const result = await getSnapshot();
    if (token !== reassignToken) return;
    current = result;
    draw();
  });

  const refresh = async () => {
    current = await getSnapshot();
    drilldown = null;
    draw();
  };

  draw();

  root.addEventListener('click', guard(async (event) => {
    const ignoreButton = event.target.closest('[data-recurring-action="ignore"]');
    if (ignoreButton) {
      await ignore(ignoreButton.dataset.recurringMerchant);
      return;
    }
    const row = event.target.closest('[data-recurring-merchant]');
    if (row) openDrilldown(row.dataset.recurringMerchant);
  }));

  if (drilldownRoot) {
    drilldownRoot.addEventListener('click', (event) => {
      if (event.target.closest('[data-drilldown-action="close"]')) closeDrilldown();
    });
    drilldownRoot.addEventListener('change', (event) => {
      const row = event.target.closest('[data-drilldown-id]');
      if (row && event.target.dataset.drilldownAction === 'recategorise') {
        reassign(row.dataset.drilldownId, event.target.value);
      }
    });
  }

  return { redraw: draw, refresh, closeDrilldown };
}
```

- [ ] **Step 4: Add the API call to `web/api.js`**

```js
export const postRecurringOverride = (merchant, decision) =>
  postJson('/api/recurring/override', { merchant, decision });
```

- [ ] **Step 5: Add the tab to `web/index.html`**

In the `<nav id="tabs">` block, after the Budgets button:

```html
      <button data-tab="recurring">Recurring</button>
```

In `<main>`, after the budgets section:

```html
    <section id="view-recurring" class="view hidden"></section>
```

After `#budgets-drilldown`:

```html
  <div id="recurring-drilldown" class="drilldown hidden"></div>
```

- [ ] **Step 6: Register it in `web/app.js`**

Add the import:

```js
import { mountRecurring } from './recurring-view.js';
```

Add to the `views` map:

```js
  recurring: document.querySelector('#view-recurring')
```

Add the root and the state variable:

```js
const recurringDrilldownRoot = document.querySelector('#recurring-drilldown');
let recurring = null;
```

Add to `refresh()`, after the budgets line:

```js
    if (recurring) await recurring.refresh();
    else recurring = mountRecurring(views.recurring, { snapshot, drilldownRoot: recurringDrilldownRoot });
```

And in `showTab`, alongside the other drill-down closers:

```js
  recurring?.closeDrilldown?.();
```

- [ ] **Step 7: Add the KPI tile to `web/overview-view.js`**

Add the import:

```js
import { recurringFor } from './recurring-view.js';
```

In `kpiRow`, compute and add the tile:

```js
  const committed = recurringFor(snapshot).committedMonthly;
```

and add this tile before the "Needs review" one:

```js
    <div class="kpi"><span>Committed monthly</span><b>${formatMoney(committed)}</b></div>
```

Note: `web/overview-view.js` now imports from `web/recurring-view.js`, and `mountRecurring` imports `renderDrilldown` and `api.js`. Confirm no cycle: `recurring-view.js` does **not** import `overview-view.js`.

- [ ] **Step 8: Add the styles**

Append to `web/style.css`:

```css
.recurring-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px; }
.recurring-table th, .recurring-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); }
.recurring-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.recurring-table tbody tr { cursor: pointer; }
.recurring-table tbody tr:hover { background: var(--line); }
.recurring-table button { padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--viz-surface); color: var(--viz-text-primary); cursor: pointer; font: inherit; font-size: 12px; }
.recurring-price-change { margin: 4px 0 0; font-size: 12px; color: var(--warn); }
.recurring-quiet { color: var(--warn); }
/* "likely" is never colour-alone — the word itself carries the meaning. */
.recurring-confidence { font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 8px; padding: 1px 6px; margin-left: 6px; }
```

- [ ] **Step 9: Run the whole suite**

Run: `node --test 'tests/**/*.test.js'`
Expected: PASS. `tests/web-modules.test.js` and `tests/module-graph.test.js` must both still pass; if the module-graph test enumerates `web/` files, add `web/recurring-view.js` to it.

- [ ] **Step 10: Verify live against the isolated data directory**

**Never run this against `data/`.** Per `CLAUDE.md`, live checks use the test server only.

```bash
npm run start:test
```

Open <http://127.0.0.1:5174>. `data-test/` starts empty — if it has no repeating charges, **write a synthetic fixture** into `tests/fixtures/` covering at least four months with a fixed monthly subscription, a variable quarterly bill, and a price rise, and import that. Never reach for a real-looking CSV from elsewhere on the filesystem. Then confirm:

1. The **Recurring** tab lists the subscriptions, most expensive per year first.
2. The committed monthly and yearly figures are positive and match the row sum.
3. The price rise is called out with both prices and the date.
4. A cancelled subscription appears under **Gone quiet** and is excluded from the committed total.
5. Clicking a row opens the drill-down with that merchant's transactions and no session-hide checkbox.
6. **Not recurring** removes the row, and the row stays gone after a reload.
7. The Overview shows the **Committed monthly** tile.

- [ ] **Step 11: Update the changelog**

Read `~/.claude/changelog-format.md` first, then add an entry to `CHANGELOG.md`.

- [ ] **Step 12: Commit**

```bash
git add web/recurring-view.js web/api.js web/app.js web/index.html web/overview-view.js web/style.css tests/ CHANGELOG.md
git commit -m "feat: add the Recurring tab and a committed-monthly KPI tile"
```

---

## Self-Review Notes

- **Coverage:** strict detection with a manual override (Tasks 1, 4), new tab plus an Overview KPI tile (Tasks 5–6), recompute-always with only corrections persisted (Tasks 3–4), and all five cadences (Task 1).
- **Known limitation, deliberate:** a price change smaller than 5% is absorbed as normal variance and not reported. Tightening that threshold would make every variable bill look like a series of price changes.
- **Known limitation, deliberate:** a merchant whose name changes in the bank feed (a rebrand, or a new payment gateway prefix `merchant-normalise.js` does not yet strip) reads as two merchants and neither may reach three occurrences. The fix belongs in `merchant-normalise.js`, not here.
- **Interaction with the digest plan:** the monthly digest consumes `priceChange` from this module. Build this plan before the digest's price-change finding.
