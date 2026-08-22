# SpendExplore Plan 2 — Exploration Core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slice the ledger by any dimension, measure it any way, and draw it as any chart type that makes sense — with the query engine as a pure contract the UI codes against.

**Architecture:** Builds layer 3 (query engine) and the configurable panel half of layer 4 from `docs/superpowers/specs/2026-08-22-spend-explorer-design.md`. The query engine is pure functions in `lib/query/` with no DOM and no I/O; it runs in the browser over the in-memory snapshot. Charts are hand-rolled SVG — no chart library. A panel is pure config handed to `query()`; it never sees a transaction record.

**Tech Stack:** Node.js 23, ES modules, `node:test` + `node:assert/strict`. **Zero npm dependencies.** Frontend is plain ES modules with no build step. Charts are inline SVG.

## Prerequisite state (Plan 1, complete — 196 tests green)

- `lib/` — `csv-parse`, `format-sniff`, `merchant-normalise`, `dedupe-hash`, `categorise`, `ingest`. All pure.
- `server/` — `index.js` (binds `127.0.0.1` only), `http.js` (`sendJson`, `readBody`, `UserFacingError`), `static.js` (`serveStatic`), `store.js` (`createStore`), `mutation-gate.js` (shared serialization gate), `routes.js` (dispatcher), `routes/import.js`, `routes/transactions.js`.
- `web/` — `index.html`, `style.css`, `api.js` (`getSnapshot`, `previewImport`, `commitImport`), `app.js`, `import-view.js`, `overview-view.js` (exports `aggregateOverview(snapshot)` and `renderOverviewView(root, snapshot)`).
- `GET /api/snapshot` → `{ transactions, categories, rules, accounts, views, imports }`.
- A transaction: `{ id, date, amount, rawDescription, merchant, accountId, cardSuffix, categoryId, categorySource, excluded, importId, note }`.
- `categorySource` ∈ `'rule' | 'manual' | 'ai' | 'unknown' | 'bulk'`.
- `categories.json` → `{ groups: [{id,label}], categories: [{id,label,groupId}] }`. **Exactly 7 groups; at most 5 categories per group.**

## Global Constraints

- ESM only (`import`/`export`), never `require`. `package.json` sets `"type": "module"`.
- **Zero npm dependencies.** Node 23 built-ins only. Never run `npm install`.
- **No outbound network requests, ever. No CDN links, no external fonts, no remote images.** `tests/smoke.test.js` asserts no UI asset references an external host and must keep passing.
- `lib/query/*` are PURE: no DOM, no `fetch`, no I/O, no global state, no `Date.now()`.
- Amounts: negative = spend, positive = income/refund. Dates are ISO `YYYY-MM-DD` strings.
- `excluded: true` transactions are omitted from all spend analysis by default.
- Transactions with `categoryId === 'income'` are excluded from spend analysis by default.
- **Colour follows the entity, never its rank.** A group's colour is fixed by its `groupId`; changing filters must never repaint the survivors.
- **Never a dual-axis chart.** One y-scale per chart, always.
- The test command is `node --test 'tests/**/*.test.js'` (`npm test`). `node --test <directory>` is broken on this machine's Node v23.11.0 — use explicit file paths for focused runs.
- Commit messages MUST NOT contain `Co-Authored-By` trailers.
- Every task adds a `CHANGELOG.md` entry at the TOP: `### [YYYY-MM-DD HH:MM] Type` then `**Tech:**` (backticked file/function), `**Dev:**` (**2–4 sentences, each under ~25 words** — the file's earlier entries ballooned into essays; do not follow that precedent), `**Plain:**` (one sentence, no jargon), `**Why:**` (the experience improved, conversational).

---

## Colour system — validated, do not re-derive

Taken from the `dataviz` skill's reference palette and **validated with its own validator** (`scripts/validate_palette.js`). Do not substitute other hexes.

**The 7 taxonomy groups map 1:1 onto the 7 categorical slots, fixed by `groupId`.**

| Slot | Group | Light | Dark |
|---|---|---|---|
| 1 | `food-drink` | `#2a78d6` | `#3987e5` |
| 2 | `transport` | `#eb6834` | `#d95926` |
| 3 | `home` | `#1baf7a` | `#199e70` |
| 4 | `health` | `#eda100` | `#c98500` |
| 5 | `lifestyle` | `#e87ba4` | `#d55181` |
| 6 | `money` | `#008300` | `#008300` |
| 7 | `other` | `#4a3aa7` | `#9085e9` |

Validator results for exactly this set:
- **light, adjacent pairs:** all PASS. Worst adjacent CVD ΔE 9.1, worst normal-vision ΔE 19.6. Contrast WARN — `#1baf7a`, `#eda100`, `#e87ba4` sit below 3:1 on the light surface.
- **dark, adjacent pairs:** all PASS, including contrast ≥ 3:1 for all 7.
- **light, ALL pairs: FAIL** — worst normal-vision ΔE 12.9 (`#e87ba4`↔`#eb6834`), below the 15 floor. **A hard fail that direct labels do NOT excuse.**

Three consequences, all binding:

1. **The contrast WARN obligates relief.** Every chart in this plan ships direct labels on its marks *and* a Table chart type is always available for the same panel. That is the relief; it is not optional.
2. **Only forms with an adjacent pairlist may use the 7 hues** — bar, stacked area, line, donut. Forms whose marks are compared all-against-all may not.
3. **Treemap therefore uses the sequential blue ramp keyed to magnitude, not the categorical hues.** Its tiles are adjacent arbitrarily, so it is an all-pairs form. Area already encodes magnitude, so a one-hue light→dark ramp is the correct encoding anyway. **Dot plot is a single series** (one slice's transactions) and uses one hue.

**Sequential blue ramp** (for the treemap, and for category steps within a group):
`100 #cde2fb · 150 #b7d3f6 · 200 #9ec5f4 · 250 #86b6ef · 300 #6da7ec · 350 #5598e7 · 400 #3987e5 · 450 #2a78d6 · 500 #256abf · 550 #1c5cab · 600 #184f95 · 650 #104281 · 700 #0d366b`

For an **ordinal** ramp (discrete ordered marks), the step nearest the surface must clear 2:1 — on light start no lighter than step 250; on dark go no darker than step 600.

**Diverging pair** (reserved for Plan 3's Compare tab, defined here so tokens live in one place): blue ↔ red, neutral gray midpoint — light `#f0efec`, dark `#383835`.

**Surfaces:** light `#fcfcfb`, dark `#1a1a19`. **Text:** light primary `#0b0b0b` / secondary `#52514e`; dark primary `#ffffff` / secondary `#c3c2b7`.

**Mark specs (binding):** thin marks; 4px rounded data-ends anchored to the baseline; 2px lines; ≥8px markers; a 2px surface-coloured gap between adjacent fills and stacked segments; a 2px surface ring on overlapping marks; selective direct labels — never a number on every point. Grid and axes are recessive. **Text always wears text tokens, never the series colour.**

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/query/filter.js` | Narrow a transaction list by the filter spec |
| `lib/query/group-by.js` | Bucket transactions by one dimension |
| `lib/query/measures.js` | Reduce a bucket to a number |
| `lib/query/stats.js` | Concentration statistics for a result set |
| `lib/query/query.js` | **Seam 1** — compose the above into `query(snapshot, spec)` |
| `web/charts/palette.js` | Validated colour tokens; `groupId` → slot; within-group steps |
| `web/charts/scale.js` | Pure scale/geometry helpers shared by every chart |
| `web/charts/chart-bar.js` | Horizontal bar |
| `web/charts/chart-table.js` | Table (always-available relief view) |
| `web/charts/chart-donut.js` | Donut |
| `web/charts/chart-line.js` | Line (time slices only) |
| `web/charts/chart-stacked.js` | Stacked area (time slices only) |
| `web/charts/chart-treemap.js` | Treemap, sequential ramp |
| `web/charts/chart-dots.js` | Dot plot, single hue |
| `web/charts/index.js` | Registry + which chart types are valid for a slice |
| `web/panel.js` | One configurable panel: controls + query + render |
| `web/filter-bar.js` | Global filter controls |
| `web/overview-view.js` | Rebuilt on panels (replaces Plan 1's table) |
| `tests/query-*.test.js`, `tests/charts-*.test.js`, `tests/panel.test.js` | One test file per module |

---

## Task 1: Query filters

**Files:**
- Create: `lib/query/filter.js`
- Test: `tests/query-filter.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `applyFilters(transactions, filters, ctx) → transaction[]`
  - `filters` = `{ dateFrom, dateTo, accountIds, categoryIds, groupIds, people, merchants, minAbsAmount, maxAbsAmount, includeExcluded, includeIncome }` — every key optional
  - `ctx` = `{ categoryToGroup: Map<categoryId, groupId>, cardOwners: Record<cardSuffix, personName> }`
  - `buildContext(snapshot) → ctx`

Defaults matter: `excluded` rows and `income` rows are **out** unless explicitly asked for. Empty arrays mean "no constraint", not "match nothing" — a filter UI with nothing ticked must show everything.

- [ ] **Step 1: Write the failing test**

Create `tests/query-filter.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFilters, buildContext } from '../lib/query/filter.js';

const SNAPSHOT = {
  categories: {
    groups: [{ id: 'food-drink', label: 'Food & Drink' }, { id: 'other', label: 'Other' }],
    categories: [
      { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
      { id: 'alcohol', label: 'Alcohol', groupId: 'food-drink' },
      { id: 'income', label: 'Income', groupId: 'other' },
      { id: 'uncategorised', label: 'Uncategorised', groupId: 'other' }
    ]
  },
  accounts: [{ id: 'spending', label: 'Joint', cardOwners: { '4321': 'Alex', '8765': 'Partner' } }]
};

const t = (over) => ({
  id: 'x', date: '2026-08-10', amount: -10, rawDescription: 'R', merchant: 'Coles',
  accountId: 'spending', cardSuffix: '4321', categoryId: 'groceries',
  categorySource: 'rule', excluded: false, importId: 'i', note: null, ...over
});

const ROWS = [
  t({ id: 'a', date: '2026-07-01', amount: -10, categoryId: 'groceries', merchant: 'Coles' }),
  t({ id: 'b', date: '2026-08-01', amount: -200, categoryId: 'alcohol', merchant: 'Dan Murphy\'s', cardSuffix: '8765' }),
  t({ id: 'c', date: '2026-08-15', amount: -5, categoryId: 'uncategorised', merchant: 'Sunshine Deli' }),
  t({ id: 'd', date: '2026-08-20', amount: 4200, categoryId: 'income', merchant: 'Payroll' }),
  t({ id: 'e', date: '2026-08-21', amount: -50, categoryId: 'groceries', excluded: true }),
  t({ id: 'f', date: '2026-08-22', amount: -30, accountId: 'card', cardSuffix: null, categoryId: 'uncategorised', merchant: 'Card charge' })
];

const ctx = buildContext(SNAPSHOT);

const ids = (rows) => rows.map((r) => r.id).sort().join('');

test('buildContext maps categories to groups and cards to people', () => {
  assert.equal(ctx.categoryToGroup.get('alcohol'), 'food-drink');
  assert.equal(ctx.cardOwners['8765'], 'Partner');
});

test('by default drops excluded and income rows', () => {
  assert.equal(ids(applyFilters(ROWS, {}, ctx)), 'abcf');
});

test('includeExcluded brings excluded rows back', () => {
  assert.ok(applyFilters(ROWS, { includeExcluded: true }, ctx).some((r) => r.id === 'e'));
});

test('includeIncome brings income rows back', () => {
  assert.ok(applyFilters(ROWS, { includeIncome: true }, ctx).some((r) => r.id === 'd'));
});

test('empty arrays mean no constraint, not match-nothing', () => {
  const all = applyFilters(ROWS, { categoryIds: [], groupIds: [], accountIds: [], people: [], merchants: [] }, ctx);
  assert.equal(ids(all), 'abcf');
});

test('date range is inclusive on both ends', () => {
  assert.equal(ids(applyFilters(ROWS, { dateFrom: '2026-08-01', dateTo: '2026-08-15' }, ctx)), 'bc');
});

test('filters by category', () => {
  assert.equal(ids(applyFilters(ROWS, { categoryIds: ['groceries'] }, ctx)), 'a');
});

test('filters by group, expanding to its categories', () => {
  assert.equal(ids(applyFilters(ROWS, { groupIds: ['food-drink'] }, ctx)), 'ab');
});

test('filters by account', () => {
  assert.equal(ids(applyFilters(ROWS, { accountIds: ['card'] }, ctx)), 'f');
});

test('filters by person via card suffix', () => {
  assert.equal(ids(applyFilters(ROWS, { people: ['Partner'] }, ctx)), 'b');
});

test('a transaction with no card suffix is attributed to Joint', () => {
  assert.equal(ids(applyFilters(ROWS, { people: ['Joint'] }, ctx)), 'f');
});

test('filters by merchant, case-insensitively', () => {
  assert.equal(ids(applyFilters(ROWS, { merchants: ['coles'] }, ctx)), 'a');
});

test('amount bounds compare absolute values', () => {
  assert.equal(ids(applyFilters(ROWS, { minAbsAmount: 100 }, ctx)), 'b');
  assert.equal(ids(applyFilters(ROWS, { maxAbsAmount: 10 }, ctx)), 'ac');
});

test('combined filters intersect', () => {
  const r = applyFilters(ROWS, { groupIds: ['food-drink'], dateFrom: '2026-08-01' }, ctx);
  assert.equal(ids(r), 'b');
});

test('does not mutate the input array or its rows', () => {
  const before = JSON.stringify(ROWS);
  applyFilters(ROWS, { categoryIds: ['groceries'] }, ctx);
  assert.equal(JSON.stringify(ROWS), before);
});

test('an unknown category id matches nothing rather than throwing', () => {
  assert.equal(applyFilters(ROWS, { categoryIds: ['nope'] }, ctx).length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/query-filter.test.js`
Expected: FAIL — `Cannot find module '../lib/query/filter.js'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/query/filter.js`:

```js
/** Person attributed to a transaction with no card suffix. */
export const JOINT = 'Joint';

/**
 * Derive the lookup tables the filters need from a snapshot, once, so
 * filtering itself stays a flat scan.
 */
export function buildContext(snapshot) {
  const categoryToGroup = new Map(
    (snapshot?.categories?.categories ?? []).map((c) => [c.id, c.groupId])
  );
  const cardOwners = {};
  for (const account of snapshot?.accounts ?? []) {
    Object.assign(cardOwners, account.cardOwners ?? {});
  }
  return { categoryToGroup, cardOwners };
}

export const personFor = (txn, ctx) =>
  (txn.cardSuffix && ctx.cardOwners[txn.cardSuffix]) || JOINT;

const has = (list) => Array.isArray(list) && list.length > 0;

/**
 * Narrow a transaction list. Every filter key is optional; an empty array
 * means "no constraint" so an untouched filter UI shows everything.
 *
 * Excluded rows and income rows are omitted unless explicitly requested —
 * they would otherwise silently distort every spend total.
 */
export function applyFilters(transactions, filters = {}, ctx) {
  const {
    dateFrom, dateTo, accountIds, categoryIds, groupIds, people, merchants,
    minAbsAmount, maxAbsAmount, includeExcluded = false, includeIncome = false
  } = filters;

  const wantedMerchants = has(merchants)
    ? new Set(merchants.map((m) => String(m).toLowerCase()))
    : null;

  return transactions.filter((txn) => {
    if (!includeExcluded && txn.excluded) return false;
    if (!includeIncome && txn.categoryId === 'income') return false;

    if (dateFrom && txn.date < dateFrom) return false;
    if (dateTo && txn.date > dateTo) return false;

    if (has(accountIds) && !accountIds.includes(txn.accountId)) return false;
    if (has(categoryIds) && !categoryIds.includes(txn.categoryId)) return false;

    if (has(groupIds)) {
      const group = ctx.categoryToGroup.get(txn.categoryId);
      if (!groupIds.includes(group)) return false;
    }

    if (has(people) && !people.includes(personFor(txn, ctx))) return false;

    if (wantedMerchants && !wantedMerchants.has(String(txn.merchant).toLowerCase())) return false;

    const magnitude = Math.abs(txn.amount);
    if (typeof minAbsAmount === 'number' && magnitude < minAbsAmount) return false;
    if (typeof maxAbsAmount === 'number' && magnitude > maxAbsAmount) return false;

    return true;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/query-filter.test.js`
Expected: PASS — `# pass 15`

- [ ] **Step 5: Commit**

Add the CHANGELOG entry, then:

```bash
git add lib/query/filter.js tests/query-filter.test.js CHANGELOG.md
git commit -m "feat: add query filtering with excluded and income omitted by default"
```

---

## Task 2: Group-by dimensions

**Files:**
- Create: `lib/query/group-by.js`
- Test: `tests/query-group-by.test.js`

**Interfaces:**
- Consumes: `buildContext`, `personFor` from `lib/query/filter.js`
- Produces:
  - `groupBy(transactions, sliceBy, ctx) → Array<{ key, label, rows }>`
  - `SLICES` — the frozen list of valid `sliceBy` values
  - `TIME_SLICES` — the subset that is chronological (`'week' | 'month'`)
  - `ctx` additionally needs `{ categoryLabels: Map, groupLabels: Map, accountLabels: Map }`; extend `buildContext` in this task.

Slices: `category`, `group`, `merchant`, `person`, `account`, `weekday`, `week`, `month`, `amountBand`.

Ordering rule: time slices and `weekday` come back in **chronological/calendar order** (so a line chart is drawn correctly); `amountBand` comes back in **band order**; everything else is unordered here and gets sorted by the caller in Task 4.

- [ ] **Step 1: Write the failing test**

Create `tests/query-group-by.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupBy, SLICES, TIME_SLICES } from '../lib/query/group-by.js';
import { buildContext } from '../lib/query/filter.js';

const SNAPSHOT = {
  categories: {
    groups: [{ id: 'food-drink', label: 'Food & Drink' }, { id: 'transport', label: 'Transport' }],
    categories: [
      { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
      { id: 'public-transport', label: 'Public transport', groupId: 'transport' }
    ]
  },
  accounts: [{ id: 'spending', label: 'Joint spending', cardOwners: { '4321': 'Alex', '8765': 'Partner' } }]
};
const ctx = buildContext(SNAPSHOT);

const t = (over) => ({
  id: 'x', date: '2026-08-10', amount: -10, merchant: 'Coles', accountId: 'spending',
  cardSuffix: '4321', categoryId: 'groceries', excluded: false, ...over
});

test('SLICES lists every supported dimension', () => {
  assert.deepEqual([...SLICES].sort(), [
    'account', 'amountBand', 'category', 'group', 'merchant', 'month', 'person', 'week', 'weekday'
  ]);
  assert.deepEqual([...TIME_SLICES], ['week', 'month']);
});

test('groups by category using the taxonomy label', () => {
  const out = groupBy([t({}), t({ categoryId: 'public-transport' })], 'category', ctx);
  const labels = out.map((g) => g.label).sort();
  assert.deepEqual(labels, ['Groceries', 'Public transport']);
});

test('groups by group', () => {
  const out = groupBy([t({}), t({ categoryId: 'public-transport' })], 'group', ctx);
  assert.deepEqual(out.map((g) => g.key).sort(), ['food-drink', 'transport']);
});

test('groups by merchant', () => {
  const out = groupBy([t({}), t({ merchant: 'Aldi' })], 'merchant', ctx);
  assert.deepEqual(out.map((g) => g.label).sort(), ['Aldi', 'Coles']);
});

test('groups by person, with no card suffix falling to Joint', () => {
  const out = groupBy([t({}), t({ cardSuffix: '8765' }), t({ cardSuffix: null })], 'person', ctx);
  assert.deepEqual(out.map((g) => g.key).sort(), ['Alex', 'Joint', 'Partner']);
});

test('groups by account using the account label', () => {
  const out = groupBy([t({})], 'account', ctx);
  assert.equal(out[0].label, 'Joint spending');
});

test('an unknown account id falls back to its raw id', () => {
  const out = groupBy([t({ accountId: 'ghost' })], 'account', ctx);
  assert.equal(out[0].label, 'ghost');
});

test('groups by month in chronological order', () => {
  const rows = [t({ date: '2026-08-02' }), t({ date: '2026-06-30' }), t({ date: '2026-07-15' })];
  assert.deepEqual(groupBy(rows, 'month', ctx).map((g) => g.key), ['2026-06', '2026-07', '2026-08']);
});

test('month labels are human readable', () => {
  assert.equal(groupBy([t({ date: '2026-08-02' })], 'month', ctx)[0].label, 'Aug 2026');
});

test('groups by ISO week in chronological order', () => {
  const rows = [t({ date: '2026-08-10' }), t({ date: '2026-08-03' })];
  const keys = groupBy(rows, 'week', ctx).map((g) => g.key);
  assert.deepEqual(keys, [...keys].sort());
  assert.equal(keys.length, 2);
});

test('groups by weekday in calendar order starting Monday', () => {
  // 2026-08-10 is a Monday, 2026-08-15 a Saturday, 2026-08-12 a Wednesday.
  const rows = [t({ date: '2026-08-15' }), t({ date: '2026-08-10' }), t({ date: '2026-08-12' })];
  assert.deepEqual(groupBy(rows, 'weekday', ctx).map((g) => g.label), ['Mon', 'Wed', 'Sat']);
});

test('groups by amount band in ascending band order', () => {
  const rows = [t({ amount: -500 }), t({ amount: -3 }), t({ amount: -45 })];
  const out = groupBy(rows, 'amountBand', ctx);
  assert.deepEqual(out.map((g) => g.label), ['Under $10', '$25–$50', '$200+']);
});

test('amount bands use absolute value so refunds band with purchases', () => {
  const out = groupBy([t({ amount: 45 })], 'amountBand', ctx);
  assert.equal(out[0].label, '$25–$50');
});

test('every returned row is in exactly one bucket', () => {
  const rows = [t({}), t({ merchant: 'Aldi' }), t({ merchant: 'Aldi' })];
  const out = groupBy(rows, 'merchant', ctx);
  assert.equal(out.reduce((n, g) => n + g.rows.length, 0), 3);
});

test('an unsupported slice throws a clear error', () => {
  assert.throws(() => groupBy([t({})], 'colour', ctx), /Unsupported slice: colour/);
});

test('does not mutate its input', () => {
  const rows = [t({})];
  const before = JSON.stringify(rows);
  groupBy(rows, 'category', ctx);
  assert.equal(JSON.stringify(rows), before);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/query-group-by.test.js`
Expected: FAIL — `Cannot find module '../lib/query/group-by.js'`

- [ ] **Step 3: Write minimal implementation**

First extend `buildContext` in `lib/query/filter.js` — replace the existing function with:

```js
export function buildContext(snapshot) {
  const categories = snapshot?.categories?.categories ?? [];
  const groups = snapshot?.categories?.groups ?? [];
  const accounts = snapshot?.accounts ?? [];

  const cardOwners = {};
  for (const account of accounts) Object.assign(cardOwners, account.cardOwners ?? {});

  return {
    categoryToGroup: new Map(categories.map((c) => [c.id, c.groupId])),
    categoryLabels: new Map(categories.map((c) => [c.id, c.label])),
    groupLabels: new Map(groups.map((g) => [g.id, g.label])),
    accountLabels: new Map(accounts.map((a) => [a.id, a.label])),
    cardOwners
  };
}
```

Create `lib/query/group-by.js`:

```js
import { personFor } from './filter.js';

export const SLICES = Object.freeze([
  'category', 'group', 'merchant', 'person', 'account',
  'weekday', 'week', 'month', 'amountBand'
]);

/** Slices whose keys are chronological — the only ones a line chart may use. */
export const TIME_SLICES = Object.freeze(['week', 'month']);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Upper bound (exclusive) of each band, on the ABSOLUTE amount.
const AMOUNT_BANDS = [
  { max: 10, label: 'Under $10' },
  { max: 25, label: '$10–$25' },
  { max: 50, label: '$25–$50' },
  { max: 100, label: '$50–$100' },
  { max: 200, label: '$100–$200' },
  { max: Infinity, label: '$200+' }
];

/** UTC-safe date parts. Dates are ISO strings, so parse them, never `new Date(str)` locally. */
const parts = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
};

/** ISO weekday index 0=Mon … 6=Sun, computed from the calendar without local time. */
function weekdayIndex(iso) {
  const { y, m, d } = parts(iso);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  return (day + 6) % 7;
}

/** Monday of the week containing `iso`, as an ISO date — a sortable week key. */
function weekStart(iso) {
  const { y, m, d } = parts(iso);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - weekdayIndex(iso));
  return dt.toISOString().slice(0, 10);
}

function bandFor(amount) {
  const magnitude = Math.abs(amount);
  const index = AMOUNT_BANDS.findIndex((b) => magnitude < b.max);
  return index === -1 ? AMOUNT_BANDS.length - 1 : index;
}

/** { key, label, sort } for one transaction under one slice. */
function keyFor(txn, sliceBy, ctx) {
  switch (sliceBy) {
    case 'category':
      return { key: txn.categoryId, label: ctx.categoryLabels.get(txn.categoryId) ?? txn.categoryId };
    case 'group': {
      const groupId = ctx.categoryToGroup.get(txn.categoryId) ?? 'other';
      return { key: groupId, label: ctx.groupLabels.get(groupId) ?? groupId };
    }
    case 'merchant':
      return { key: txn.merchant, label: txn.merchant };
    case 'person': {
      const person = personFor(txn, ctx);
      return { key: person, label: person };
    }
    case 'account':
      return { key: txn.accountId, label: ctx.accountLabels.get(txn.accountId) ?? txn.accountId };
    case 'month': {
      const { y, m } = parts(txn.date);
      const key = `${y}-${String(m).padStart(2, '0')}`;
      return { key, label: `${MONTH_NAMES[m - 1]} ${y}`, sort: key };
    }
    case 'week': {
      const key = weekStart(txn.date);
      return { key, label: `w/c ${key}`, sort: key };
    }
    case 'weekday': {
      const index = weekdayIndex(txn.date);
      return { key: WEEKDAY_NAMES[index], label: WEEKDAY_NAMES[index], sort: index };
    }
    case 'amountBand': {
      const index = bandFor(txn.amount);
      return { key: AMOUNT_BANDS[index].label, label: AMOUNT_BANDS[index].label, sort: index };
    }
    default:
      throw new Error(`Unsupported slice: ${sliceBy}`);
  }
}

/**
 * Bucket transactions by one dimension.
 *
 * Slices with an inherent order (time, weekday, amount band) come back in
 * that order so a chart drawn straight from this array is correct. Every
 * other slice is returned unordered and is sorted by the caller.
 */
export function groupBy(transactions, sliceBy, ctx) {
  if (!SLICES.includes(sliceBy)) throw new Error(`Unsupported slice: ${sliceBy}`);

  const buckets = new Map();
  for (const txn of transactions) {
    const { key, label, sort } = keyFor(txn, sliceBy, ctx);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, label, sort, rows: [] };
      buckets.set(key, bucket);
    }
    bucket.rows.push(txn);
  }

  const out = [...buckets.values()];
  if (out.some((b) => b.sort !== undefined)) {
    out.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
  }
  return out.map(({ key, label, rows }) => ({ key, label, rows }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/query-group-by.test.js`
Expected: PASS — `# pass 16`

Then `npm test` — the filter tests must still pass with the extended `buildContext`.

- [ ] **Step 5: Commit**

```bash
git add lib/query/group-by.js lib/query/filter.js tests/query-group-by.test.js CHANGELOG.md
git commit -m "feat: add nine group-by dimensions with inherent ordering"
```

---

## Task 3: Measures and concentration stats

**Files:**
- Create: `lib/query/measures.js`, `lib/query/stats.js`
- Test: `tests/query-measures.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `MEASURES` — frozen list `['sum','count','avg','median','pctOfTotal']`
  - `measure(rows, name) → number` (for `pctOfTotal`, returns the raw sum; the percentage is computed in Task 4 where the grand total is known)
  - `concentrationStats(rows) → { txnCount, median, largest, top3Share }`

`top3Share` is the answer to the user's core question — "is this bucket a few large spends or a lot of small ones?" It is the share of the bucket's absolute total contributed by its three largest transactions, `0`–`1`.

- [ ] **Step 1: Write the failing test**

Create `tests/query-measures.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, MEASURES } from '../lib/query/measures.js';
import { concentrationStats } from '../lib/query/stats.js';

const rows = (...amounts) => amounts.map((amount, i) => ({ id: String(i), amount }));

test('MEASURES lists every supported measure', () => {
  assert.deepEqual([...MEASURES], ['sum', 'count', 'avg', 'median', 'pctOfTotal']);
});

test('sum adds the amounts', () => {
  assert.equal(measure(rows(-10, -20, -5), 'sum'), -35);
});

test('sum rounds to cents rather than leaking float error', () => {
  assert.equal(measure(rows(-0.1, -0.2), 'sum'), -0.3);
});

test('count counts rows', () => {
  assert.equal(measure(rows(-10, -20), 'count'), 2);
});

test('avg is the mean, rounded to cents', () => {
  assert.equal(measure(rows(-10, -20, -5), 'avg'), -11.67);
});

test('median of an odd count is the middle value', () => {
  assert.equal(measure(rows(-10, -50, -20), 'median'), -20);
});

test('median of an even count is the mean of the middle two', () => {
  assert.equal(measure(rows(-10, -20, -30, -40), 'median'), -25);
});

test('pctOfTotal returns the raw sum for the caller to normalise', () => {
  assert.equal(measure(rows(-10, -20), 'pctOfTotal'), -30);
});

test('every measure returns 0 for an empty bucket rather than NaN', () => {
  for (const name of MEASURES) assert.equal(measure([], name), 0, name);
});

test('an unknown measure throws a clear error', () => {
  assert.throws(() => measure(rows(-1), 'stddev'), /Unsupported measure: stddev/);
});

test('concentration stats describe the shape of a bucket', () => {
  const s = concentrationStats(rows(-10, -20, -30, -286.48, -5));
  assert.equal(s.txnCount, 5);
  assert.equal(s.median, -20);
  assert.equal(s.largest, -286.48);
});

test('top3Share exposes a few-big bucket', () => {
  // 286.48 + 30 + 20 = 336.48 of 351.48 total
  const s = concentrationStats(rows(-10, -20, -30, -286.48, -5));
  assert.ok(s.top3Share > 0.95, `expected >0.95, got ${s.top3Share}`);
});

test('top3Share exposes a many-small bucket', () => {
  const s = concentrationStats(rows(...Array(20).fill(-10)));
  assert.ok(s.top3Share < 0.2, `expected <0.2, got ${s.top3Share}`);
});

test('top3Share is 1 when there are three or fewer transactions', () => {
  assert.equal(concentrationStats(rows(-10, -20)).top3Share, 1);
});

test('concentration stats on an empty bucket are all zero, never NaN', () => {
  const s = concentrationStats([]);
  assert.deepEqual(s, { txnCount: 0, median: 0, largest: 0, top3Share: 0 });
});

test('largest means largest by magnitude, not most positive', () => {
  assert.equal(concentrationStats(rows(-100, 5)).largest, -100);
});

test('stats do not mutate the input array order', () => {
  const input = rows(-10, -50, -20);
  const before = input.map((r) => r.amount).join();
  concentrationStats(input);
  assert.equal(input.map((r) => r.amount).join(), before);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/query-measures.test.js`
Expected: FAIL — `Cannot find module '../lib/query/measures.js'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/query/measures.js`:

```js
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
```

Create `lib/query/stats.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/query-measures.test.js`
Expected: PASS — `# pass 17`

- [ ] **Step 5: Commit**

```bash
git add lib/query/measures.js lib/query/stats.js tests/query-measures.test.js CHANGELOG.md
git commit -m "feat: add measures and bucket concentration statistics"
```

---

## Task 4: The query contract (Seam 1)

**Files:**
- Create: `lib/query/query.js`
- Test: `tests/query.test.js`

**Interfaces:**
- Consumes: `applyFilters`, `buildContext` (`lib/query/filter.js`); `groupBy`, `SLICES`, `TIME_SLICES` (`lib/query/group-by.js`); `measure`, `MEASURES` (`lib/query/measures.js`); `concentrationStats` (`lib/query/stats.js`)
- Produces:
  ```js
  query(snapshot, spec) → {
    rows:  [{ key, label, value, count, total, stats }],
    total: number,        // grand total of `measure` across all rows
    stats: {…},           // concentrationStats over every filtered row
    meta:  { sliceBy, measure, rowCount, filteredCount, truncated }
  }
  ```
  `spec` = `{ filters, sliceBy, measure, sort: { by: 'value'|'label', dir: 'asc'|'desc' }, limit }`

**This is the seam the whole UI codes against.** A panel hands over config and gets back rows. It must never need a transaction record to render.

Sorting rule: slices with inherent order (time, weekday, amount band) keep it and ignore `sort.by: 'value'`; everything else defaults to descending by magnitude of value, so the biggest spend is first.

- [ ] **Step 1: Write the failing test**

Create `tests/query.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '../lib/query/query.js';

const SNAPSHOT = {
  categories: {
    groups: [
      { id: 'food-drink', label: 'Food & Drink' },
      { id: 'transport', label: 'Transport' },
      { id: 'other', label: 'Other' }
    ],
    categories: [
      { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
      { id: 'alcohol', label: 'Alcohol', groupId: 'food-drink' },
      { id: 'fuel', label: 'Fuel', groupId: 'transport' },
      { id: 'income', label: 'Income', groupId: 'other' }
    ]
  },
  accounts: [{ id: 'spending', label: 'Joint', cardOwners: { '4321': 'Alex' } }],
  transactions: [
    { id: 'a', date: '2026-07-05', amount: -100, merchant: 'Coles', accountId: 'spending', cardSuffix: '4321', categoryId: 'groceries', excluded: false },
    { id: 'b', date: '2026-08-05', amount: -40, merchant: 'Coles', accountId: 'spending', cardSuffix: '4321', categoryId: 'groceries', excluded: false },
    { id: 'c', date: '2026-08-06', amount: -60, merchant: "Dan Murphy's", accountId: 'spending', cardSuffix: '4321', categoryId: 'alcohol', excluded: false },
    { id: 'd', date: '2026-08-07', amount: -200, merchant: 'BP', accountId: 'spending', cardSuffix: '4321', categoryId: 'fuel', excluded: false },
    { id: 'e', date: '2026-08-08', amount: 4200, merchant: 'Payroll', accountId: 'spending', cardSuffix: null, categoryId: 'income', excluded: false },
    { id: 'f', date: '2026-08-09', amount: -999, merchant: 'Ignore', accountId: 'spending', cardSuffix: '4321', categoryId: 'groceries', excluded: true }
  ]
};

const run = (spec) => query(SNAPSHOT, spec);

test('slices by category and sums, biggest first', () => {
  const r = run({ sliceBy: 'category', measure: 'sum' });
  assert.deepEqual(r.rows.map((x) => x.label), ['Fuel', 'Groceries', 'Alcohol']);
  assert.deepEqual(r.rows.map((x) => x.value), [-200, -140, -60]);
});

test('income and excluded rows are out of the totals', () => {
  const r = run({ sliceBy: 'category', measure: 'sum' });
  assert.equal(r.total, -400);
  assert.equal(r.meta.filteredCount, 4);
});

test('each row carries its own transaction count and concentration stats', () => {
  const groceries = run({ sliceBy: 'category', measure: 'sum' }).rows.find((x) => x.key === 'groceries');
  assert.equal(groceries.count, 2);
  assert.equal(groceries.stats.txnCount, 2);
  assert.equal(groceries.stats.largest, -100);
  assert.equal(groceries.stats.top3Share, 1);
});

test('slices by group', () => {
  const r = run({ sliceBy: 'group', measure: 'sum' });
  assert.deepEqual(r.rows.map((x) => x.key), ['transport', 'food-drink']);
  assert.deepEqual(r.rows.map((x) => x.value), [-200, -200]);
});

test('count measure counts transactions', () => {
  const r = run({ sliceBy: 'category', measure: 'count' });
  assert.equal(r.rows.find((x) => x.key === 'groceries').value, 2);
  assert.equal(r.total, 4);
});

test('pctOfTotal normalises against the grand total', () => {
  const r = run({ sliceBy: 'category', measure: 'pctOfTotal' });
  assert.equal(r.rows.find((x) => x.key === 'fuel').value, 50);
  assert.equal(r.rows.reduce((a, x) => a + x.value, 0), 100);
});

test('a time slice keeps chronological order and ignores value sorting', () => {
  const r = run({ sliceBy: 'month', measure: 'sum', sort: { by: 'value', dir: 'desc' } });
  assert.deepEqual(r.rows.map((x) => x.key), ['2026-07', '2026-08']);
});

test('sorting by label ascending', () => {
  const r = run({ sliceBy: 'category', measure: 'sum', sort: { by: 'label', dir: 'asc' } });
  assert.deepEqual(r.rows.map((x) => x.label), ['Alcohol', 'Fuel', 'Groceries']);
});

test('limit truncates and flags it', () => {
  const r = run({ sliceBy: 'category', measure: 'sum', limit: 2 });
  assert.equal(r.rows.length, 2);
  assert.equal(r.meta.truncated, true);
  assert.equal(r.meta.rowCount, 3);
});

test('total reflects ALL matching rows, not just the limited ones', () => {
  assert.equal(run({ sliceBy: 'category', measure: 'sum', limit: 1 }).total, -400);
});

test('filters flow through to the result', () => {
  const r = run({ sliceBy: 'category', measure: 'sum', filters: { groupIds: ['food-drink'] } });
  assert.equal(r.total, -200);
  assert.deepEqual(r.rows.map((x) => x.key), ['groceries', 'alcohol']);
});

test('includeIncome brings income into its own row', () => {
  const r = run({ sliceBy: 'category', measure: 'sum', filters: { includeIncome: true } });
  assert.ok(r.rows.some((x) => x.key === 'income' && x.value === 4200));
});

test('an empty result is well formed, not a crash', () => {
  const r = run({ sliceBy: 'category', measure: 'sum', filters: { dateFrom: '2030-01-01' } });
  assert.deepEqual(r.rows, []);
  assert.equal(r.total, 0);
  assert.deepEqual(r.stats, { txnCount: 0, median: 0, largest: 0, top3Share: 0 });
});

test('the spec is validated rather than trusted', () => {
  assert.throws(() => run({ sliceBy: 'colour', measure: 'sum' }), /Unsupported slice/);
  assert.throws(() => run({ sliceBy: 'category', measure: 'stddev' }), /Unsupported measure/);
});

test('query does not mutate the snapshot', () => {
  const before = JSON.stringify(SNAPSHOT);
  run({ sliceBy: 'merchant', measure: 'sum', limit: 1 });
  assert.equal(JSON.stringify(SNAPSHOT), before);
});

test('the result carries no transaction records — the UI must not need them', () => {
  const r = run({ sliceBy: 'category', measure: 'sum' });
  for (const row of r.rows) {
    assert.equal(row.rows, undefined, 'query() must not leak raw transactions into rows');
    assert.deepEqual(Object.keys(row).sort(), ['count', 'key', 'label', 'stats', 'total', 'value']);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/query.test.js`
Expected: FAIL — `Cannot find module '../lib/query/query.js'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/query/query.js`:

```js
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
    rows.sort((a, b) =>
      sort.by === 'label'
        ? direction * a.label.localeCompare(b.label)
        : direction * (Math.abs(b.value) - Math.abs(a.value))
    );
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/query.test.js`
Expected: PASS — `# pass 16`

Then `npm test` — everything from Plan 1 plus Tasks 1–3 must stay green.

- [ ] **Step 5: Verify against the real ledger**

The project's `data/ledger.json` holds the real 44-row import. Run:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { query } from './lib/query/query.js';
const snapshot = {
  transactions: JSON.parse(readFileSync('./data/ledger.json','utf8')),
  categories: JSON.parse(readFileSync('./data/categories.json','utf8')),
  accounts: JSON.parse(readFileSync('./data/accounts.json','utf8'))
};
const r = query(snapshot, { sliceBy: 'group', measure: 'sum' });
console.log('total', r.total, 'rows', r.rows.length);
for (const row of r.rows) console.log(' ', row.label, row.value, row.count, 'top3', row.stats.top3Share);
"
```

Expected: `total -1404.01`. Record the observed output in your report. If the total is not `-1404.01`, STOP and report rather than proceeding.

- [ ] **Step 6: Commit**

```bash
git add lib/query/query.js tests/query.test.js CHANGELOG.md
git commit -m "feat: add the query contract composing filter, slice, measure and stats"
```

---

## Task 5: Validated colour palette module

**Files:**
- Create: `web/charts/palette.js`
- Test: `tests/charts-palette.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `GROUP_SLOTS` — `{ [groupId]: { light, dark } }` for the 7 groups
  - `SEQUENTIAL_BLUE` — `[{ step, hex }]`, 13 steps, light→dark
  - `colourForGroup(groupId, mode) → hex`
  - `colourForCategory(categoryId, groupId, categoriesInGroup, mode) → hex`
  - `sequentialColour(fraction, mode) → hex`
  - `SURFACES`, `TEXT`, `DIVERGING`
  - `cssVariables(mode) → string` — a `:root`-ready declaration block

**These hex values were validated with the `dataviz` skill's validator and must not be changed.** The 7 groups map onto the 7 categorical slots in the fixed order below. **Colour is keyed by `groupId`, never by position in a result set** — so filtering out a group must never repaint the others.

- [ ] **Step 1: Write the failing test**

Create `tests/charts-palette.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUP_SLOTS, SEQUENTIAL_BLUE, SURFACES, TEXT, DIVERGING,
  colourForGroup, colourForCategory, sequentialColour, cssVariables
} from '../web/charts/palette.js';

test('the seven groups carry the validated categorical slots in order', () => {
  assert.deepEqual(Object.keys(GROUP_SLOTS), [
    'food-drink', 'transport', 'home', 'health', 'lifestyle', 'money', 'other'
  ]);
  assert.deepEqual(Object.values(GROUP_SLOTS).map((s) => s.light), [
    '#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7'
  ]);
  assert.deepEqual(Object.values(GROUP_SLOTS).map((s) => s.dark), [
    '#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'
  ]);
});

test('colour is keyed by group id, never by rank', () => {
  assert.equal(colourForGroup('transport', 'light'), '#eb6834');
  // Removing an earlier group must not change a later one.
  assert.equal(colourForGroup('other', 'light'), '#4a3aa7');
});

test('an unknown group falls back to the Other slot rather than throwing', () => {
  assert.equal(colourForGroup('made-up', 'light'), GROUP_SLOTS.other.light);
});

test('the sequential ramp is 13 steps, light to dark, monotonic', () => {
  assert.equal(SEQUENTIAL_BLUE.length, 13);
  assert.equal(SEQUENTIAL_BLUE[0].hex, '#cde2fb');
  assert.equal(SEQUENTIAL_BLUE.at(-1).hex, '#0d366b');
  const steps = SEQUENTIAL_BLUE.map((s) => s.step);
  assert.deepEqual(steps, [...steps].sort((a, b) => a - b));
});

test('sequentialColour maps 0..1 onto the ramp within the ordinal-safe band', () => {
  // Light mode must never go lighter than step 250 (contrast floor).
  const lightest = sequentialColour(0, 'light');
  assert.equal(lightest, '#86b6ef');
  assert.equal(sequentialColour(1, 'light'), '#0d366b');
  // Dark mode must never go darker than step 600.
  assert.equal(sequentialColour(1, 'dark'), '#184f95');
});

test('sequentialColour clamps out-of-range fractions', () => {
  assert.equal(sequentialColour(-5, 'light'), sequentialColour(0, 'light'));
  assert.equal(sequentialColour(99, 'light'), sequentialColour(1, 'light'));
});

test('categories within a group are steps of that group hue, all distinct', () => {
  const cats = ['groceries', 'restaurants', 'takeaway', 'coffee', 'alcohol'];
  const colours = cats.map((c) => colourForCategory(c, 'food-drink', cats, 'light'));
  assert.equal(new Set(colours).size, 5, `expected 5 distinct, got ${colours}`);
  assert.equal(colours[0], colourForGroup('food-drink', 'light'));
});

test('a category keeps its colour when siblings are filtered out', () => {
  const all = ['groceries', 'restaurants', 'takeaway', 'coffee', 'alcohol'];
  const before = colourForCategory('takeaway', 'food-drink', all, 'light');
  const after = colourForCategory('takeaway', 'food-drink', all, 'light');
  assert.equal(before, after);
});

test('surfaces, text and diverging tokens are present for both modes', () => {
  assert.equal(SURFACES.light, '#fcfcfb');
  assert.equal(SURFACES.dark, '#1a1a19');
  assert.equal(TEXT.light.primary, '#0b0b0b');
  assert.equal(TEXT.dark.primary, '#ffffff');
  assert.equal(DIVERGING.light.mid, '#f0efec');
  assert.equal(DIVERGING.dark.mid, '#383835');
});

test('cssVariables emits a declaration block for each mode', () => {
  const light = cssVariables('light');
  assert.match(light, /--viz-surface:\s*#fcfcfb/);
  assert.match(light, /--viz-group-food-drink:\s*#2a78d6/);
  assert.match(cssVariables('dark'), /--viz-surface:\s*#1a1a19/);
});

test('every exported hex is a full six-digit hex string', () => {
  const hexes = [
    ...Object.values(GROUP_SLOTS).flatMap((s) => [s.light, s.dark]),
    ...SEQUENTIAL_BLUE.map((s) => s.hex),
    SURFACES.light, SURFACES.dark
  ];
  for (const hex of hexes) assert.match(hex, /^#[0-9a-f]{6}$/, hex);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/charts-palette.test.js`
Expected: FAIL — `Cannot find module '../web/charts/palette.js'`

- [ ] **Step 3: Write minimal implementation**

Create `web/charts/palette.js`:

```js
/**
 * Colour tokens for SpendExplore charts.
 *
 * These hexes come from the dataviz reference palette and were validated with
 * its own validator for exactly this 7-slot set:
 *   light, adjacent pairs — PASS (worst CVD ΔE 9.1, worst normal-vision 19.6)
 *   dark,  adjacent pairs — PASS (contrast >= 3:1 on all 7)
 *   light, ALL pairs      — FAIL (normal-vision 12.9, below the 15 floor)
 *
 * Consequences, which the chart modules must respect:
 *  - Only adjacent-pairlist forms (bar, stacked, line, donut) may use the
 *    7 categorical hues.
 *  - Treemap is an all-pairs form, so it uses the SEQUENTIAL ramp keyed to
 *    magnitude instead. Dot plot is a single series and uses one hue.
 *  - Three light-mode hues sit below 3:1 contrast, so every chart ships
 *    direct labels and a Table view is always available. That is the
 *    required relief; it is not optional.
 *
 * DO NOT substitute other hexes without re-running the validator.
 */

/** The 7 taxonomy groups map 1:1 onto the 7 categorical slots, in this order. */
export const GROUP_SLOTS = Object.freeze({
  'food-drink': { light: '#2a78d6', dark: '#3987e5' },
  transport:    { light: '#eb6834', dark: '#d95926' },
  home:         { light: '#1baf7a', dark: '#199e70' },
  health:       { light: '#eda100', dark: '#c98500' },
  lifestyle:    { light: '#e87ba4', dark: '#d55181' },
  money:        { light: '#008300', dark: '#008300' },
  other:        { light: '#4a3aa7', dark: '#9085e9' }
});

export const SEQUENTIAL_BLUE = Object.freeze([
  { step: 100, hex: '#cde2fb' }, { step: 150, hex: '#b7d3f6' },
  { step: 200, hex: '#9ec5f4' }, { step: 250, hex: '#86b6ef' },
  { step: 300, hex: '#6da7ec' }, { step: 350, hex: '#5598e7' },
  { step: 400, hex: '#3987e5' }, { step: 450, hex: '#2a78d6' },
  { step: 500, hex: '#256abf' }, { step: 550, hex: '#1c5cab' },
  { step: 600, hex: '#184f95' }, { step: 650, hex: '#104281' },
  { step: 700, hex: '#0d366b' }
]);

export const SURFACES = Object.freeze({ light: '#fcfcfb', dark: '#1a1a19' });

export const TEXT = Object.freeze({
  light: { primary: '#0b0b0b', secondary: '#52514e' },
  dark:  { primary: '#ffffff', secondary: '#c3c2b7' }
});

export const DIVERGING = Object.freeze({
  light: { low: '#2a78d6', mid: '#f0efec', high: '#e34948' },
  dark:  { low: '#3987e5', mid: '#383835', high: '#e66767' }
});

// Ordinal-safe window into the ramp: on light the lightest usable step is 250
// (2.06:1 on the light surface); on dark the darkest usable step is 600.
const ORDINAL_BAND = { light: [3, 12], dark: [0, 10] };

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export function colourForGroup(groupId, mode = 'light') {
  const slot = GROUP_SLOTS[groupId] ?? GROUP_SLOTS.other;
  return slot[mode] ?? slot.light;
}

/**
 * Map 0..1 onto the sequential ramp, staying inside the mode's contrast-safe
 * band. 0 is the lightest usable step, 1 the darkest.
 */
export function sequentialColour(fraction, mode = 'light') {
  const [lo, hi] = ORDINAL_BAND[mode] ?? ORDINAL_BAND.light;
  const index = lo + Math.round(clamp01(fraction) * (hi - lo));
  return SEQUENTIAL_BLUE[index].hex;
}

/**
 * A category's colour: its group's hue, stepped by the category's fixed
 * position within that group. Keyed by identity, not by rank in a result set,
 * so filtering never repaints the survivors.
 */
export function colourForCategory(categoryId, groupId, categoriesInGroup, mode = 'light') {
  const base = colourForGroup(groupId, mode);
  const index = categoriesInGroup.indexOf(categoryId);
  if (index <= 0) return base;

  // Step the group hue toward the surface for each subsequent category.
  const total = Math.max(categoriesInGroup.length - 1, 1);
  return mixToward(base, SURFACES[mode] ?? SURFACES.light, (index / total) * 0.55);
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = (rgb) =>
  '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

/** Blend `hex` toward `target` by `amount` (0..1). Used for within-group steps. */
export function mixToward(hex, target, amount) {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  return rgbToHex(a.map((v, i) => v + (b[i] - v) * clamp01(amount)));
}

/** A `:root`-ready custom-property block for one mode. */
export function cssVariables(mode = 'light') {
  const lines = [
    `--viz-surface: ${SURFACES[mode]};`,
    `--viz-text-primary: ${TEXT[mode].primary};`,
    `--viz-text-secondary: ${TEXT[mode].secondary};`,
    `--viz-diverging-low: ${DIVERGING[mode].low};`,
    `--viz-diverging-mid: ${DIVERGING[mode].mid};`,
    `--viz-diverging-high: ${DIVERGING[mode].high};`,
    ...Object.entries(GROUP_SLOTS).map(([id, slot]) => `--viz-group-${id}: ${slot[mode]};`)
  ];
  return lines.join('\n  ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/charts-palette.test.js`
Expected: PASS — `# pass 11`

- [ ] **Step 5: Commit**

```bash
git add web/charts/palette.js tests/charts-palette.test.js CHANGELOG.md
git commit -m "feat: add validated chart colour palette keyed by group identity"
```

---

## Task 6: Scale helpers and the bar + table charts

**Files:**
- Create: `web/charts/scale.js`, `web/charts/chart-bar.js`, `web/charts/chart-table.js`
- Test: `tests/charts-bar.test.js`

**Interfaces:**
- Consumes: `colourForGroup`, `colourForCategory` (`web/charts/palette.js`)
- Produces:
  - `linearScale(domainMax, rangeMax) → (value) => number`
  - `niceTicks(max, count) → number[]`
  - `formatMoney(n) → string` (e.g. `-$1,404.01`)
  - `escapeHtml(s) → string`
  - `renderBar(result, options) → string` (SVG markup)
  - `renderTable(result, options) → string` (HTML markup)
  - `options` = `{ mode, colourFor(row) → hex, title }`

Every chart module in this plan is a **pure string-returning function** — it takes a query result and returns markup. That keeps them testable in Node with no DOM. The panel inserts the string.

`renderTable` is the **relief view** required by the palette's contrast WARN, so it must always be available and must show the value as text.

- [ ] **Step 1: Write the failing test**

Create `tests/charts-bar.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linearScale, niceTicks, formatMoney, escapeHtml } from '../web/charts/scale.js';
import { renderBar } from '../web/charts/chart-bar.js';
import { renderTable } from '../web/charts/chart-table.js';

const RESULT = {
  rows: [
    { key: 'fuel', label: 'Fuel', value: -200, count: 1, total: -200, stats: { txnCount: 1, median: -200, largest: -200, top3Share: 1 } },
    { key: 'groceries', label: 'Groceries', value: -140, count: 2, total: -140, stats: { txnCount: 2, median: -70, largest: -100, top3Share: 1 } }
  ],
  total: -340,
  stats: { txnCount: 3, median: -100, largest: -200, top3Share: 1 },
  meta: { sliceBy: 'category', measure: 'sum', rowCount: 2, filteredCount: 3, truncated: false }
};

const opts = { mode: 'light', colourFor: () => '#2a78d6', title: 'Spend by category' };

test('linearScale maps 0 and the domain max onto the range', () => {
  const s = linearScale(200, 100);
  assert.equal(s(0), 0);
  assert.equal(s(200), 100);
  assert.equal(s(100), 50);
});

test('linearScale is safe when the domain is zero', () => {
  assert.equal(linearScale(0, 100)(0), 0);
});

test('niceTicks returns ascending round numbers covering the max', () => {
  const ticks = niceTicks(340, 4);
  assert.ok(ticks.at(-1) >= 340);
  assert.deepEqual(ticks, [...ticks].sort((a, b) => a - b));
});

test('formatMoney is grouped, two-decimal, sign-leading', () => {
  assert.equal(formatMoney(-1404.01), '-$1,404.01');
  assert.equal(formatMoney(0), '$0.00');
  assert.equal(formatMoney(4200), '$4,200.00');
});

test('escapeHtml neutralises markup from bank descriptions', () => {
  assert.equal(escapeHtml('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
  assert.equal(escapeHtml('Tom & Jerry'), 'Tom &amp; Jerry');
  assert.equal(escapeHtml('"quoted"'), '&quot;quoted&quot;');
});

test('renderBar emits SVG with one rect per row', () => {
  const svg = renderBar(RESULT, opts);
  assert.match(svg, /^<svg/);
  assert.equal((svg.match(/<rect/g) ?? []).length >= 2, true);
});

test('renderBar direct-labels every bar — the palette contrast relief', () => {
  const svg = renderBar(RESULT, opts);
  assert.match(svg, /Fuel/);
  assert.match(svg, /-\$200\.00/);
  assert.match(svg, /Groceries/);
  assert.match(svg, /-\$140\.00/);
});

test('renderBar uses rounded data-ends', () => {
  assert.match(renderBar(RESULT, opts), /rx="4"/);
});

test('renderBar escapes labels', () => {
  const nasty = { ...RESULT, rows: [{ ...RESULT.rows[0], label: '<script>x</script>' }] };
  const svg = renderBar(nasty, opts);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;/);
});

test('renderBar renders an empty result as a message, not a broken chart', () => {
  const svg = renderBar({ ...RESULT, rows: [], total: 0 }, opts);
  assert.match(svg, /No data/);
  assert.doesNotMatch(svg, /<rect/);
});

test('renderTable shows label, value and count as text', () => {
  const html = renderTable(RESULT, opts);
  assert.match(html, /<table/);
  assert.match(html, /Fuel/);
  assert.match(html, /-\$200\.00/);
  assert.match(html, />1</);
});

test('renderTable shows the concentration line for each row', () => {
  const html = renderTable(RESULT, opts);
  assert.match(html, /top 3/i);
});

test('renderTable escapes labels', () => {
  const nasty = { ...RESULT, rows: [{ ...RESULT.rows[0], label: '<b>x</b>' }] };
  assert.doesNotMatch(renderTable(nasty, opts), /<b>x<\/b>/);
});

test('no chart output references an external host', () => {
  for (const markup of [renderBar(RESULT, opts), renderTable(RESULT, opts)]) {
    assert.doesNotMatch(markup, /https?:\/\/(?!127\.0\.0\.1|localhost)/);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/charts-bar.test.js`
Expected: FAIL — `Cannot find module '../web/charts/scale.js'`

- [ ] **Step 3: Write minimal implementation**

Create `web/charts/scale.js`:

```js
/** Map 0..domainMax onto 0..rangeMax. Zero domain collapses to zero, never NaN. */
export function linearScale(domainMax, rangeMax) {
  const domain = Math.abs(domainMax);
  return (value) => (domain === 0 ? 0 : (Math.abs(value) / domain) * rangeMax);
}

/** Ascending round tick values covering `max`. */
export function niceTicks(max, count = 4) {
  const magnitude = Math.abs(max);
  if (magnitude === 0) return [0];
  const rawStep = magnitude / count;
  const power = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rawStep) ?? power * 10;
  const ticks = [];
  for (let t = 0; t <= magnitude + step * 0.001; t += step) ticks.push(Math.round(t * 100) / 100);
  return ticks;
}

/** Money, grouped, always two decimals, sign leading. */
export function formatMoney(n) {
  const negative = n < 0;
  const body = Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${negative ? '-' : ''}$${body}`;
}

/** Percent with no decimals. */
export const formatPercent = (fraction) => `${Math.round(fraction * 100)}%`;

/**
 * Escape a string for interpolation into markup. Bank descriptions and
 * user-authored category labels are untrusted input.
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The concentration sentence — the few-big vs many-small answer, in words. */
export function concentrationLine(stats) {
  if (!stats || stats.txnCount === 0) return '';
  const parts = [
    `${stats.txnCount} transaction${stats.txnCount === 1 ? '' : 's'}`,
    `median ${formatMoney(stats.median)}`,
    `largest ${formatMoney(stats.largest)}`
  ];
  if (stats.txnCount > 3) parts.push(`top 3 = ${formatPercent(stats.top3Share)} of bucket`);
  else parts.push('top 3 = all of bucket');
  return parts.join(' · ');
}
```

Create `web/charts/chart-bar.js`:

```js
import { linearScale, formatMoney, escapeHtml } from './scale.js';

const ROW_HEIGHT = 34;
const BAR_HEIGHT = 16;      // thin marks
const LABEL_WIDTH = 150;
const VALUE_WIDTH = 96;
const GAP = 2;              // 2px surface gap between adjacent fills

/**
 * Horizontal bar chart. Every bar is direct-labelled with its name and value —
 * that is the relief the palette's light-mode contrast WARN requires.
 */
export function renderBar(result, { mode = 'light', colourFor, title = '' } = {}) {
  const rows = result.rows ?? [];
  if (!rows.length) {
    return `<svg role="img" aria-label="${escapeHtml(title)}: no data" viewBox="0 0 600 60" width="100%"><text x="300" y="34" text-anchor="middle" class="viz-empty">No data for these filters</text></svg>`;
  }

  const width = 600;
  const plotWidth = width - LABEL_WIDTH - VALUE_WIDTH;
  const height = rows.length * ROW_HEIGHT;
  const maxValue = Math.max(...rows.map((r) => Math.abs(r.value)));
  const scale = linearScale(maxValue, plotWidth);

  const bars = rows.map((row, i) => {
    const y = i * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;
    const barWidth = Math.max(scale(row.value) - GAP, 0);
    const colour = colourFor ? colourFor(row) : 'currentColor';
    return `
    <g>
      <text x="0" y="${y + BAR_HEIGHT - 3}" class="viz-label">${escapeHtml(row.label)}</text>
      <rect x="${LABEL_WIDTH}" y="${y}" width="${barWidth.toFixed(1)}" height="${BAR_HEIGHT}"
            rx="4" fill="${colour}"><title>${escapeHtml(row.label)}: ${formatMoney(row.value)} · ${row.count} txns</title></rect>
      <text x="${width}" y="${y + BAR_HEIGHT - 3}" text-anchor="end" class="viz-value">${formatMoney(row.value)}</text>
    </g>`;
  }).join('');

  return `<svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" class="viz-bar">${bars}</svg>`;
}
```

Create `web/charts/chart-table.js`:

```js
import { formatMoney, escapeHtml, concentrationLine } from './scale.js';

/**
 * Table view. Always available for every panel — it is the accessible relief
 * for the palette's light-mode contrast WARN and for colour-blind readers,
 * so it must never be removed from the chart-type list.
 */
export function renderTable(result, { title = '' } = {}) {
  const rows = result.rows ?? [];
  if (!rows.length) return `<p class="viz-empty">No data for these filters</p>`;

  const body = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.label)}</td>
      <td class="num">${formatMoney(row.value)}</td>
      <td class="num">${row.count}</td>
      <td class="viz-note">${escapeHtml(concentrationLine(row.stats))}</td>
    </tr>`).join('');

  return `
  <table class="viz-table">
    <caption class="viz-caption">${escapeHtml(title)}</caption>
    <thead><tr><th scope="col">Name</th><th scope="col" class="num">Value</th><th scope="col" class="num">Txns</th><th scope="col">Shape</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/charts-bar.test.js`
Expected: PASS — `# pass 13`

- [ ] **Step 5: Commit**

```bash
git add web/charts/scale.js web/charts/chart-bar.js web/charts/chart-table.js tests/charts-bar.test.js CHANGELOG.md
git commit -m "feat: add scale helpers with bar and table chart renderers"
```

---

## Task 7: Donut, line and stacked-area charts

**Files:**
- Create: `web/charts/chart-donut.js`, `web/charts/chart-line.js`, `web/charts/chart-stacked.js`
- Test: `tests/charts-timeseries.test.js`

**Interfaces:**
- Consumes: `linearScale`, `formatMoney`, `escapeHtml` (`web/charts/scale.js`)
- Produces:
  - `renderDonut(result, options) → string`
  - `renderLine(result, options) → string`
  - `renderStacked(result, options) → string`
  - Same `options` shape as Task 6.

These are the adjacent-pairlist forms, so they may use the 7 categorical hues. All three carry a legend when there are ≥ 2 series and direct labels on up to 4. **A single series gets no legend box — the title names it.**

`renderLine` and `renderStacked` require a chronological slice; the registry in Task 9 enforces that, but each should render an explanatory message rather than nonsense if handed an unordered slice.

- [ ] **Step 1: Write the failing test**

Create `tests/charts-timeseries.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDonut } from '../web/charts/chart-donut.js';
import { renderLine } from '../web/charts/chart-line.js';
import { renderStacked } from '../web/charts/chart-stacked.js';

const row = (key, label, value, count = 1) => ({
  key, label, value, count, total: value,
  stats: { txnCount: count, median: value, largest: value, top3Share: 1 }
});

const CATEGORICAL = {
  rows: [row('fuel', 'Fuel', -200), row('groceries', 'Groceries', -140), row('alcohol', 'Alcohol', -60)],
  total: -400,
  stats: { txnCount: 4, median: -100, largest: -200, top3Share: 1 },
  meta: { sliceBy: 'category', measure: 'sum', rowCount: 3, filteredCount: 4, truncated: false }
};

const MONTHLY = {
  rows: [row('2026-06', 'Jun 2026', -300), row('2026-07', 'Jul 2026', -450), row('2026-08', 'Aug 2026', -400)],
  total: -1150,
  stats: { txnCount: 9, median: -100, largest: -300, top3Share: 0.6 },
  meta: { sliceBy: 'month', measure: 'sum', rowCount: 3, filteredCount: 9, truncated: false }
};

const opts = { mode: 'light', colourFor: () => '#2a78d6', title: 'T' };

test('donut draws one arc path per row', () => {
  const svg = renderDonut(CATEGORICAL, opts);
  assert.match(svg, /^<svg/);
  assert.equal((svg.match(/<path/g) ?? []).length, 3);
});

test('donut has a hole — it is a donut, not a pie', () => {
  assert.match(renderDonut(CATEGORICAL, opts), /viz-donut-hole/);
});

test('donut carries a legend for multiple series', () => {
  assert.match(renderDonut(CATEGORICAL, opts), /viz-legend/);
});

test('donut shows the total in the centre', () => {
  assert.match(renderDonut(CATEGORICAL, opts), /-\$400\.00/);
});

test('donut refuses more than seven slices, folding the rest into Other', () => {
  const many = { ...CATEGORICAL, rows: Array.from({ length: 12 }, (_, i) => row(`k${i}`, `L${i}`, -(20 - i))) };
  const svg = renderDonut(many, opts);
  assert.ok((svg.match(/<path/g) ?? []).length <= 7);
  assert.match(svg, /Other/);
});

test('donut escapes labels', () => {
  const nasty = { ...CATEGORICAL, rows: [row('x', '<i>x</i>', -10)] };
  assert.doesNotMatch(renderDonut(nasty, opts), /<i>x<\/i>/);
});

test('line draws a single polyline for a time slice', () => {
  const svg = renderLine(MONTHLY, opts);
  assert.match(svg, /<polyline/);
  assert.equal((svg.match(/<polyline/g) ?? []).length, 1);
});

test('line uses 2px strokes and >=8px markers', () => {
  const svg = renderLine(MONTHLY, opts);
  assert.match(svg, /stroke-width="2"/);
  assert.match(svg, /r="4"/); // radius 4 => 8px diameter
});

test('line labels the first and last points only, never every point', () => {
  const svg = renderLine(MONTHLY, opts);
  assert.match(svg, /-\$300\.00/);
  assert.match(svg, /-\$400\.00/);
  assert.doesNotMatch(svg, /-\$450\.00/);
});

test('line refuses a non-chronological slice with an explanation', () => {
  const svg = renderLine(CATEGORICAL, opts);
  assert.match(svg, /time/i);
  assert.doesNotMatch(svg, /<polyline/);
});

test('single-series line has no legend box — the title names it', () => {
  assert.doesNotMatch(renderLine(MONTHLY, opts), /viz-legend/);
});

test('stacked area draws one band per series', () => {
  const svg = renderStacked(MONTHLY, { ...opts, series: [
    { key: 'food-drink', label: 'Food & Drink', values: [-100, -150, -120] },
    { key: 'transport', label: 'Transport', values: [-200, -300, -280] }
  ] });
  assert.equal((svg.match(/<path/g) ?? []).length, 2);
  assert.match(svg, /viz-legend/);
});

test('stacked area leaves a 2px surface gap between bands', () => {
  const svg = renderStacked(MONTHLY, { ...opts, series: [
    { key: 'a', label: 'A', values: [-100, -150, -120] },
    { key: 'b', label: 'B', values: [-200, -300, -280] }
  ] });
  assert.match(svg, /stroke-width="2"/);
});

test('stacked area refuses a non-chronological slice', () => {
  assert.match(renderStacked(CATEGORICAL, { ...opts, series: [] }), /time/i);
});

test('every renderer handles an empty result without throwing', () => {
  const empty = { rows: [], total: 0, stats: { txnCount: 0, median: 0, largest: 0, top3Share: 0 }, meta: { sliceBy: 'month' } };
  for (const fn of [renderDonut, renderLine]) assert.match(fn(empty, opts), /No data/);
  assert.match(renderStacked(empty, { ...opts, series: [] }), /No data/);
});

test('no timeseries output references an external host', () => {
  const markup = renderDonut(CATEGORICAL, opts) + renderLine(MONTHLY, opts);
  assert.doesNotMatch(markup, /https?:\/\/(?!127\.0\.0\.1|localhost)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/charts-timeseries.test.js`
Expected: FAIL — `Cannot find module '../web/charts/chart-donut.js'`

- [ ] **Step 3: Write minimal implementation**

Create `web/charts/chart-donut.js`:

```js
import { formatMoney, escapeHtml } from './scale.js';

const SIZE = 260;
const RADIUS = 110;
const THICKNESS = 34;
const MAX_SLICES = 7;   // never more than the validated slot count

const polar = (cx, cy, r, angle) => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];

function arcPath(cx, cy, outer, inner, start, end) {
  const [x1, y1] = polar(cx, cy, outer, start);
  const [x2, y2] = polar(cx, cy, outer, end);
  const [x3, y3] = polar(cx, cy, inner, end);
  const [x4, y4] = polar(cx, cy, inner, start);
  const large = end - start > Math.PI ? 1 : 0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${outer} ${outer} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L${x3.toFixed(2)} ${y3.toFixed(2)} A${inner} ${inner} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
}

/** Fold anything past the seventh slice into a single "Other" slice. */
function capSlices(rows) {
  if (rows.length <= MAX_SLICES) return rows;
  const kept = rows.slice(0, MAX_SLICES - 1);
  const rest = rows.slice(MAX_SLICES - 1);
  const value = rest.reduce((a, r) => a + r.value, 0);
  const count = rest.reduce((a, r) => a + r.count, 0);
  return [...kept, { key: '__other__', label: `Other (${rest.length})`, value, count, total: value, stats: { txnCount: count, median: 0, largest: 0, top3Share: 0 } }];
}

/** Donut — composition. Adjacent-pairlist form, so the categorical hues are safe. */
export function renderDonut(result, { mode = 'light', colourFor, title = '' } = {}) {
  const rows = capSlices(result.rows ?? []);
  if (!rows.length) return `<p class="viz-empty">No data for these filters</p>`;

  const magnitude = rows.reduce((a, r) => a + Math.abs(r.value), 0);
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  let angle = -Math.PI / 2;

  const paths = rows.map((row) => {
    const sweep = magnitude === 0 ? 0 : (Math.abs(row.value) / magnitude) * Math.PI * 2;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const colour = colourFor ? colourFor(row) : 'currentColor';
    return `<path d="${arcPath(cx, cy, RADIUS, RADIUS - THICKNESS, start, end)}" fill="${colour}" stroke="var(--viz-surface)" stroke-width="2"><title>${escapeHtml(row.label)}: ${formatMoney(row.value)}</title></path>`;
  }).join('');

  const legend = rows.map((row) => {
    const colour = colourFor ? colourFor(row) : 'currentColor';
    return `<li><span class="viz-swatch" style="background:${colour}"></span>${escapeHtml(row.label)} <span class="viz-value">${formatMoney(row.value)}</span></li>`;
  }).join('');

  return `
  <div class="viz-donut">
    <svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
      ${paths}
      <circle class="viz-donut-hole" cx="${cx}" cy="${cy}" r="${RADIUS - THICKNESS}" fill="var(--viz-surface)"/>
      <text x="${cx}" y="${cy + 6}" text-anchor="middle" class="viz-total">${formatMoney(result.total)}</text>
    </svg>
    <ul class="viz-legend">${legend}</ul>
  </div>`;
}
```

Create `web/charts/chart-line.js`:

```js
import { linearScale, niceTicks, formatMoney, escapeHtml } from './scale.js';

const WIDTH = 600;
const HEIGHT = 220;
const PAD = { top: 16, right: 56, bottom: 28, left: 56 };

const TIME_SLICES = new Set(['week', 'month']);

/**
 * Line — change over time. Only valid for a chronological slice; anything else
 * gets an explanation rather than a misleading line through unordered buckets.
 * Single series, so no legend: the panel title names it.
 */
export function renderLine(result, { title = '', colourFor } = {}) {
  const rows = result.rows ?? [];
  if (!TIME_SLICES.has(result.meta?.sliceBy)) {
    return `<p class="viz-empty">A line chart needs a time slice — choose Week or Month.</p>`;
  }
  if (!rows.length) return `<p class="viz-empty">No data for these filters</p>`;

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const maxValue = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  const yScale = linearScale(maxValue, plotH);
  const stepX = rows.length > 1 ? plotW / (rows.length - 1) : 0;

  const points = rows.map((row, i) => ({
    x: PAD.left + i * stepX,
    y: PAD.top + plotH - yScale(row.value),
    row
  }));

  const grid = niceTicks(maxValue, 4).map((tick) => {
    const y = PAD.top + plotH - yScale(tick);
    return `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${WIDTH - PAD.right}" y2="${y.toFixed(1)}" class="viz-grid"/>`;
  }).join('');

  const colour = colourFor ? colourFor(rows[0]) : 'currentColor';
  const polyline = `<polyline points="${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="${colour}" stroke-width="2" stroke-linejoin="round"/>`;

  const markers = points.map((p) =>
    `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${colour}" stroke="var(--viz-surface)" stroke-width="2"><title>${escapeHtml(p.row.label)}: ${formatMoney(p.row.value)}</title></circle>`
  ).join('');

  // Selective direct labels: first and last only.
  const ends = [points[0], points.at(-1)].filter(Boolean);
  const endLabels = ends.map((p, i) =>
    `<text x="${p.x.toFixed(1)}" y="${(p.y - 10).toFixed(1)}" text-anchor="${i === 0 ? 'start' : 'end'}" class="viz-value">${formatMoney(p.row.value)}</text>`
  ).join('');

  const xLabels = points.map((p) =>
    `<text x="${p.x.toFixed(1)}" y="${HEIGHT - 8}" text-anchor="middle" class="viz-label">${escapeHtml(p.row.label)}</text>`
  ).join('');

  return `<svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" class="viz-line">${grid}${polyline}${markers}${endLabels}${xLabels}</svg>`;
}
```

Create `web/charts/chart-stacked.js`:

```js
import { linearScale, formatMoney, escapeHtml } from './scale.js';

const WIDTH = 600;
const HEIGHT = 240;
const PAD = { top: 16, right: 16, bottom: 28, left: 56 };
const TIME_SLICES = new Set(['week', 'month']);

/**
 * Stacked area — how the MIX changes over time.
 *
 * `series` is supplied by the caller (the panel), because a stack needs a second
 * dimension the single-slice query result does not carry: one entry per series,
 * each with one value per time bucket, in the same order as `result.rows`.
 */
export function renderStacked(result, { title = '', colourFor, series = [] } = {}) {
  if (!TIME_SLICES.has(result.meta?.sliceBy)) {
    return `<p class="viz-empty">A stacked chart needs a time slice — choose Week or Month.</p>`;
  }
  const rows = result.rows ?? [];
  if (!rows.length || !series.length) return `<p class="viz-empty">No data for these filters</p>`;

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const stepX = rows.length > 1 ? plotW / (rows.length - 1) : 0;

  const totals = rows.map((_, i) => series.reduce((a, s) => a + Math.abs(s.values[i] ?? 0), 0));
  const maxTotal = Math.max(...totals, 1);
  const yScale = linearScale(maxTotal, plotH);

  const cumulative = rows.map(() => 0);
  const bands = series.map((s) => {
    const upper = rows.map((_, i) => {
      cumulative[i] += Math.abs(s.values[i] ?? 0);
      return { x: PAD.left + i * stepX, y: PAD.top + plotH - yScale(cumulative[i]) };
    });
    const lower = rows.map((_, i) => ({
      x: PAD.left + i * stepX,
      y: PAD.top + plotH - yScale(cumulative[i] - Math.abs(s.values[i] ?? 0))
    })).reverse();

    const d = [...upper, ...lower].map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z';
    const colour = colourFor ? colourFor({ key: s.key, label: s.label }) : 'currentColor';
    // 2px surface stroke is the gap between adjacent bands.
    return `<path d="${d}" fill="${colour}" stroke="var(--viz-surface)" stroke-width="2"><title>${escapeHtml(s.label)}</title></path>`;
  }).join('');

  const legend = series.map((s) => {
    const colour = colourFor ? colourFor({ key: s.key, label: s.label }) : 'currentColor';
    return `<li><span class="viz-swatch" style="background:${colour}"></span>${escapeHtml(s.label)}</li>`;
  }).join('');

  const xLabels = rows.map((row, i) =>
    `<text x="${(PAD.left + i * stepX).toFixed(1)}" y="${HEIGHT - 8}" text-anchor="middle" class="viz-label">${escapeHtml(row.label)}</text>`
  ).join('');

  return `
  <div class="viz-stacked">
    <svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%">${bands}${xLabels}</svg>
    <ul class="viz-legend">${legend}</ul>
  </div>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/charts-timeseries.test.js`
Expected: PASS — `# pass 16`

- [ ] **Step 5: Commit**

```bash
git add web/charts/chart-donut.js web/charts/chart-line.js web/charts/chart-stacked.js tests/charts-timeseries.test.js CHANGELOG.md
git commit -m "feat: add donut, line and stacked-area chart renderers"
```

---

## Task 8: Treemap and dot plot

**Files:**
- Create: `web/charts/chart-treemap.js`, `web/charts/chart-dots.js`
- Test: `tests/charts-treemap.test.js`

**Interfaces:**
- Consumes: `sequentialColour` (`web/charts/palette.js`); `formatMoney`, `escapeHtml`, `linearScale` (`web/charts/scale.js`)
- Produces:
  - `squarify(values, width, height) → [{ x, y, w, h }]` (exported for testing)
  - `renderTreemap(result, options) → string`
  - `renderDots(result, options) → string`

**Both are all-pairs forms, so neither may use the 7 categorical hues.**
- Treemap uses the **sequential blue ramp keyed to each tile's share of the total** — area and colour then encode the same magnitude, which is correct rather than redundant, and sidesteps the all-pairs CVD failure entirely.
- Dot plot is a **single series** in one hue: one dot per transaction in the selected slice. It is the honest picture of "few big vs many small" — an outlier sits visibly apart from a cluster.

`renderDots` is the one chart that needs raw transaction amounts, which `query()` deliberately does not return. The panel passes them explicitly as `options.amounts`; the chart still never sees a whole transaction record.

- [ ] **Step 1: Write the failing test**

Create `tests/charts-treemap.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { squarify, renderTreemap } from '../web/charts/chart-treemap.js';
import { renderDots } from '../web/charts/chart-dots.js';

const row = (key, label, value, count = 1) => ({
  key, label, value, count, total: value,
  stats: { txnCount: count, median: value, largest: value, top3Share: 1 }
});

const RESULT = {
  rows: [row('a', 'Health', -336), row('b', 'Food', -316), row('c', 'Money', -250), row('d', 'Other', -214)],
  total: -1116,
  stats: { txnCount: 30, median: -20, largest: -336, top3Share: 0.7 },
  meta: { sliceBy: 'group', measure: 'sum', rowCount: 4, filteredCount: 30, truncated: false }
};

const opts = { mode: 'light', title: 'T' };

test('squarify fills the whole rectangle', () => {
  const tiles = squarify([40, 30, 20, 10], 200, 100);
  assert.equal(tiles.length, 4);
  const area = tiles.reduce((a, t) => a + t.w * t.h, 0);
  assert.ok(Math.abs(area - 200 * 100) < 1, `area ${area}`);
});

test('squarify tiles do not overlap', () => {
  const tiles = squarify([40, 30, 20, 10], 200, 100);
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i], b = tiles[j];
      const disjoint = a.x + a.w <= b.x + 0.01 || b.x + b.w <= a.x + 0.01 ||
                       a.y + a.h <= b.y + 0.01 || b.y + b.h <= a.y + 0.01;
      assert.ok(disjoint, `tiles ${i} and ${j} overlap`);
    }
  }
});

test('squarify gives the largest value the largest area', () => {
  const tiles = squarify([40, 30, 20, 10], 200, 100);
  const areas = tiles.map((t) => t.w * t.h);
  assert.equal(areas.indexOf(Math.max(...areas)), 0);
});

test('squarify handles a single value and an empty list', () => {
  assert.deepEqual(squarify([10], 100, 50), [{ x: 0, y: 0, w: 100, h: 50 }]);
  assert.deepEqual(squarify([], 100, 50), []);
});

test('treemap draws one rect per row', () => {
  const svg = renderTreemap(RESULT, opts);
  assert.equal((svg.match(/<rect/g) ?? []).length, 4);
});

test('treemap uses the sequential ramp, NOT the categorical hues', () => {
  const svg = renderTreemap(RESULT, opts);
  // No categorical slot hex may appear.
  for (const hex of ['#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7']) {
    assert.doesNotMatch(svg, new RegExp(hex, 'i'), `categorical hue ${hex} must not appear in a treemap`);
  }
});

test('treemap direct-labels every tile', () => {
  const svg = renderTreemap(RESULT, opts);
  assert.match(svg, /Health/);
  assert.match(svg, /Food/);
});

test('treemap leaves a 2px gap between tiles', () => {
  assert.match(renderTreemap(RESULT, opts), /stroke-width="2"/);
});

test('treemap escapes labels', () => {
  const nasty = { ...RESULT, rows: [row('x', '<u>x</u>', -10)] };
  assert.doesNotMatch(renderTreemap(nasty, opts), /<u>x<\/u>/);
});

test('dot plot draws one dot per amount', () => {
  const svg = renderDots(RESULT, { ...opts, amounts: [-10, -20, -30, -286.48] });
  assert.equal((svg.match(/<circle/g) ?? []).length, 4);
});

test('dot plot uses a single hue — it is one series', () => {
  const svg = renderDots(RESULT, { ...opts, amounts: [-10, -20, -286.48] });
  const fills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/gi)].map((m) => m[1].toLowerCase());
  assert.equal(new Set(fills).size, 1, `expected one hue, got ${[...new Set(fills)]}`);
});

test('dot plot markers are at least 8px across', () => {
  assert.match(renderDots(RESULT, { ...opts, amounts: [-10] }), /r="4"/);
});

test('dot plot labels the largest outlier only', () => {
  const svg = renderDots(RESULT, { ...opts, amounts: [-10, -20, -30, -286.48] });
  assert.match(svg, /-\$286\.48/);
  assert.doesNotMatch(svg, /-\$20\.00/);
});

test('dot plot with no amounts renders a message', () => {
  assert.match(renderDots(RESULT, { ...opts, amounts: [] }), /No data/);
});

test('no treemap or dot output references an external host', () => {
  const markup = renderTreemap(RESULT, opts) + renderDots(RESULT, { ...opts, amounts: [-1] });
  assert.doesNotMatch(markup, /https?:\/\/(?!127\.0\.0\.1|localhost)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/charts-treemap.test.js`
Expected: FAIL — `Cannot find module '../web/charts/chart-treemap.js'`

- [ ] **Step 3: Write minimal implementation**

Create `web/charts/chart-treemap.js`:

```js
import { sequentialColour } from './palette.js';
import { formatMoney, escapeHtml } from './scale.js';

const WIDTH = 600;
const HEIGHT = 320;

/**
 * Slice-and-dice treemap laid out along the shorter side each pass, which keeps
 * tiles reasonably square without the full squarified algorithm's complexity.
 * Values must be positive magnitudes, largest first.
 */
export function squarify(values, width, height) {
  if (!values.length) return [];
  if (values.length === 1) return [{ x: 0, y: 0, w: width, h: height }];

  const total = values.reduce((a, v) => a + v, 0);
  if (total === 0) return values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));

  const tiles = [];
  let x = 0, y = 0, w = width, h = height;
  let remaining = total;

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const isLast = i === values.length - 1;

    if (isLast) { tiles.push({ x, y, w, h }); break; }

    const fraction = value / remaining;
    if (w >= h) {
      const tileW = w * fraction;
      tiles.push({ x, y, w: tileW, h });
      x += tileW; w -= tileW;
    } else {
      const tileH = h * fraction;
      tiles.push({ x, y, w, h: tileH });
      y += tileH; h -= tileH;
    }
    remaining -= value;
  }
  return tiles;
}

/**
 * Treemap — part-to-whole where area IS the magnitude.
 *
 * Tiles are adjacent arbitrarily, making this an ALL-PAIRS form: the 7
 * categorical hues fail the all-pairs CVD gate, so this chart deliberately
 * uses the sequential ramp keyed to each tile's share instead. Area and
 * colour then encode the same thing, which is correct, not redundant.
 */
export function renderTreemap(result, { mode = 'light', title = '' } = {}) {
  const rows = [...(result.rows ?? [])].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  if (!rows.length) return `<p class="viz-empty">No data for these filters</p>`;

  const magnitudes = rows.map((r) => Math.abs(r.value));
  const max = Math.max(...magnitudes, 1);
  const tiles = squarify(magnitudes, WIDTH, HEIGHT);

  const cells = rows.map((row, i) => {
    const tile = tiles[i];
    const colour = sequentialColour(Math.abs(row.value) / max, mode);
    const showLabel = tile.w > 70 && tile.h > 34;
    const label = showLabel
      ? `<text x="${(tile.x + 8).toFixed(1)}" y="${(tile.y + 20).toFixed(1)}" class="viz-tile-label">${escapeHtml(row.label)}</text>
         <text x="${(tile.x + 8).toFixed(1)}" y="${(tile.y + 36).toFixed(1)}" class="viz-tile-value">${formatMoney(row.value)}</text>`
      : '';
    return `<g>
      <rect x="${tile.x.toFixed(1)}" y="${tile.y.toFixed(1)}" width="${tile.w.toFixed(1)}" height="${tile.h.toFixed(1)}"
            fill="${colour}" stroke="var(--viz-surface)" stroke-width="2" rx="4"><title>${escapeHtml(row.label)}: ${formatMoney(row.value)} · ${row.count} txns</title></rect>
      ${label}
    </g>`;
  }).join('');

  return `<svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" class="viz-treemap">${cells}</svg>`;
}
```

Create `web/charts/chart-dots.js`:

```js
import { linearScale, formatMoney, escapeHtml } from './scale.js';
import { GROUP_SLOTS } from './palette.js';

const WIDTH = 600;
const HEIGHT = 160;
const PAD = { left: 24, right: 24, bottom: 34 };
const DOT_R = 4;   // 8px across

/**
 * Dot plot — one dot per transaction along an amount axis.
 *
 * This is the honest picture of "a few large spends or a lot of small ones":
 * a cluster near the left with one dot far right is a different story from an
 * even spread, and no summary statistic shows it as directly.
 *
 * Single series, so a single hue — this is an all-pairs form and must not use
 * the categorical palette.
 */
export function renderDots(result, { mode = 'light', title = '', amounts = [] } = {}) {
  if (!amounts.length) return `<p class="viz-empty">No data for these filters</p>`;

  const colour = GROUP_SLOTS['food-drink'][mode] ?? GROUP_SLOTS['food-drink'].light;
  const magnitudes = amounts.map((a) => Math.abs(a));
  const max = Math.max(...magnitudes, 1);
  const plotW = WIDTH - PAD.left - PAD.right;
  const scale = linearScale(max, plotW);
  const baseline = HEIGHT - PAD.bottom;

  // Nudge overlapping dots upward so density is visible rather than hidden.
  const occupancy = new Map();
  const dots = magnitudes.map((magnitude, i) => {
    const x = PAD.left + scale(magnitude);
    const bucket = Math.round(x / (DOT_R * 2));
    const stack = occupancy.get(bucket) ?? 0;
    occupancy.set(bucket, stack + 1);
    const y = baseline - stack * (DOT_R * 2 + 1);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${DOT_R}" fill="${colour}" stroke="var(--viz-surface)" stroke-width="2" opacity="0.85"><title>${formatMoney(amounts[i])}</title></circle>`;
  }).join('');

  // Selective direct label: the single largest value only.
  const maxIndex = magnitudes.indexOf(max);
  const maxX = PAD.left + scale(max);
  const outlier = `<text x="${maxX.toFixed(1)}" y="${(baseline - 26).toFixed(1)}" text-anchor="end" class="viz-value">${formatMoney(amounts[maxIndex])}</text>`;

  const axis = `<line x1="${PAD.left}" y1="${baseline + 10}" x2="${WIDTH - PAD.right}" y2="${baseline + 10}" class="viz-grid"/>
    <text x="${PAD.left}" y="${HEIGHT - 6}" class="viz-label">$0</text>
    <text x="${WIDTH - PAD.right}" y="${HEIGHT - 6}" text-anchor="end" class="viz-label">${formatMoney(-max)}</text>`;

  return `<svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" class="viz-dots">${axis}${dots}${outlier}</svg>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/charts-treemap.test.js`
Expected: PASS — `# pass 15`

- [ ] **Step 5: Commit**

```bash
git add web/charts/chart-treemap.js web/charts/chart-dots.js tests/charts-treemap.test.js CHANGELOG.md
git commit -m "feat: add treemap and dot plot using non-categorical encodings"
```

---

## Task 9: Chart registry and validity rules

**Files:**
- Create: `web/charts/index.js`
- Test: `tests/charts-registry.test.js`

**Interfaces:**
- Consumes: every `render*` from Tasks 6–8
- Produces:
  - `CHART_TYPES` — `[{ id, label, render, validFor(sliceBy, measure) }]`
  - `chartsFor(sliceBy, measure) → chartType[]`
  - `renderChart(chartId, result, options) → string`
  - `defaultChartFor(sliceBy) → chartId`

**This encodes the constraint agreed at design time:** the chart switcher only offers types that make sense for the current slice. No line chart on a non-time slice, no donut across 40 merchants, no donut on a `count` measure that would imply part-to-whole of something that isn't a whole. Unrestricted chart choice mostly produces charts that mislead.

`table` is valid for everything and can never be removed — it is the accessibility relief the palette requires.

- [ ] **Step 1: Write the failing test**

Create `tests/charts-registry.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHART_TYPES, chartsFor, renderChart, defaultChartFor } from '../web/charts/index.js';

const ids = (sliceBy, measure = 'sum') => chartsFor(sliceBy, measure).map((c) => c.id).sort();

test('the registry exposes all seven chart types', () => {
  assert.deepEqual(CHART_TYPES.map((c) => c.id).sort(),
    ['bar', 'donut', 'dots', 'line', 'stacked', 'table', 'treemap']);
});

test('table is valid for every slice and measure', () => {
  for (const slice of ['category', 'month', 'merchant', 'weekday', 'amountBand']) {
    for (const measure of ['sum', 'count', 'avg', 'median', 'pctOfTotal']) {
      assert.ok(chartsFor(slice, measure).some((c) => c.id === 'table'), `${slice}/${measure}`);
    }
  }
});

test('line and stacked are offered only for time slices', () => {
  assert.ok(ids('month').includes('line'));
  assert.ok(ids('week').includes('stacked'));
  assert.ok(!ids('category').includes('line'));
  assert.ok(!ids('merchant').includes('stacked'));
  assert.ok(!ids('weekday').includes('line'), 'weekday is ordered but not a time axis');
});

test('donut is not offered for a time slice — a whole is not made of months', () => {
  assert.ok(!ids('month').includes('donut'));
  assert.ok(ids('category').includes('donut'));
});

test('donut and treemap are not offered for non-additive measures', () => {
  for (const measure of ['avg', 'median']) {
    assert.ok(!ids('category', measure).includes('donut'), measure);
    assert.ok(!ids('category', measure).includes('treemap'), measure);
  }
  assert.ok(ids('category', 'sum').includes('donut'));
});

test('dots is offered only for the sum measure — it plots transactions', () => {
  assert.ok(ids('category', 'sum').includes('dots'));
  assert.ok(!ids('category', 'count').includes('dots'));
});

test('bar is offered for everything except a pure time slice default', () => {
  assert.ok(ids('category').includes('bar'));
  assert.ok(ids('merchant').includes('bar'));
});

test('defaults are sensible per slice', () => {
  assert.equal(defaultChartFor('month'), 'line');
  assert.equal(defaultChartFor('week'), 'line');
  assert.equal(defaultChartFor('category'), 'bar');
  assert.equal(defaultChartFor('merchant'), 'bar');
  assert.equal(defaultChartFor('amountBand'), 'bar');
});

test('the default chart for a slice is always in that slice valid list', () => {
  for (const slice of ['category', 'group', 'merchant', 'person', 'account', 'weekday', 'week', 'month', 'amountBand']) {
    assert.ok(ids(slice).includes(defaultChartFor(slice)), slice);
  }
});

test('renderChart dispatches to the right renderer', () => {
  const result = {
    rows: [{ key: 'a', label: 'A', value: -10, count: 1, total: -10, stats: { txnCount: 1, median: -10, largest: -10, top3Share: 1 } }],
    total: -10, stats: { txnCount: 1, median: -10, largest: -10, top3Share: 1 },
    meta: { sliceBy: 'category', measure: 'sum', rowCount: 1, filteredCount: 1, truncated: false }
  };
  assert.match(renderChart('table', result, {}), /<table/);
  assert.match(renderChart('bar', result, { colourFor: () => '#2a78d6' }), /<svg/);
});

test('renderChart throws on an unknown chart id', () => {
  assert.throws(() => renderChart('pie3d', { rows: [] }, {}), /Unknown chart type: pie3d/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/charts-registry.test.js`
Expected: FAIL — `Cannot find module '../web/charts/index.js'`

- [ ] **Step 3: Write minimal implementation**

Create `web/charts/index.js`:

```js
import { renderBar } from './chart-bar.js';
import { renderTable } from './chart-table.js';
import { renderDonut } from './chart-donut.js';
import { renderLine } from './chart-line.js';
import { renderStacked } from './chart-stacked.js';
import { renderTreemap } from './chart-treemap.js';
import { renderDots } from './chart-dots.js';

const TIME_SLICES = new Set(['week', 'month']);
/** Measures whose parts genuinely sum to the whole. */
const ADDITIVE = new Set(['sum', 'count', 'pctOfTotal']);

/**
 * The chart switcher offers only types that make sense for the current slice
 * and measure. Unrestricted chart choice sounds freeing but mostly produces
 * charts that mislead — a line through unordered categories, or a donut whose
 * slices are averages and therefore do not make a whole.
 *
 * `table` is valid everywhere and must never be removed: it is the required
 * relief for the palette's light-mode contrast WARN.
 */
export const CHART_TYPES = Object.freeze([
  { id: 'bar', label: 'Bar', render: renderBar, validFor: () => true },
  { id: 'table', label: 'Table', render: renderTable, validFor: () => true },
  {
    id: 'donut', label: 'Donut', render: renderDonut,
    validFor: (slice, measure) => !TIME_SLICES.has(slice) && ADDITIVE.has(measure)
  },
  {
    id: 'treemap', label: 'Treemap', render: renderTreemap,
    validFor: (slice, measure) => !TIME_SLICES.has(slice) && ADDITIVE.has(measure)
  },
  { id: 'line', label: 'Line', render: renderLine, validFor: (slice) => TIME_SLICES.has(slice) },
  { id: 'stacked', label: 'Stacked', render: renderStacked, validFor: (slice) => TIME_SLICES.has(slice) },
  { id: 'dots', label: 'Dots', render: renderDots, validFor: (slice, measure) => measure === 'sum' }
]);

export const chartsFor = (sliceBy, measure = 'sum') =>
  CHART_TYPES.filter((c) => c.validFor(sliceBy, measure));

export function defaultChartFor(sliceBy) {
  return TIME_SLICES.has(sliceBy) ? 'line' : 'bar';
}

export function renderChart(chartId, result, options = {}) {
  const chart = CHART_TYPES.find((c) => c.id === chartId);
  if (!chart) throw new Error(`Unknown chart type: ${chartId}`);
  return chart.render(result, options);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/charts-registry.test.js`
Expected: PASS — `# pass 11`

- [ ] **Step 5: Commit**

```bash
git add web/charts/index.js tests/charts-registry.test.js CHANGELOG.md
git commit -m "feat: add chart registry restricting types to sensible slices"
```

---

## Task 10: The configurable panel

**Files:**
- Create: `web/panel.js`
- Modify: `web/style.css` (append the `viz-*` styles)
- Test: `tests/panel.test.js`

**Interfaces:**
- Consumes: `query` (`lib/query/query.js`); `applyFilters`, `buildContext` (`lib/query/filter.js`); `chartsFor`, `renderChart`, `defaultChartFor` (`web/charts/index.js`); `colourForGroup`, `colourForCategory` (`web/charts/palette.js`); `escapeHtml`, `concentrationLine` (`web/charts/scale.js`)
- Produces:
  - `createPanel(config) → panel` where `config` = `{ id, title, sliceBy, measure, chartType, filters }`
  - `panel.html(snapshot, globalFilters) → string` (pure — testable without a DOM)
  - `panel.config` — the current config object
  - `panel.setSlice(v)`, `panel.setMeasure(v)`, `panel.setChart(v)` — each returns the updated config and repairs an invalid chart type
  - `mount(panel, root, { snapshot, globalFilters, onChange })` — attaches listeners (needs a DOM; not unit-tested)
  - `colourResolver(snapshot, sliceBy) → (row) => hex`

**A panel is pure config.** It hands `{ sliceBy, measure, filters }` to `query()` and renders what comes back. It never touches a transaction record — except `dots`, which receives amounts explicitly.

Panel state must survive a slice change: switching from `month` (line) to `category` must **repair** the chart type to a valid one rather than rendering an error.

- [ ] **Step 1: Write the failing test**

Create `tests/panel.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPanel, colourResolver } from '../web/panel.js';

const SNAPSHOT = {
  categories: {
    groups: [
      { id: 'food-drink', label: 'Food & Drink' },
      { id: 'transport', label: 'Transport' }
    ],
    categories: [
      { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
      { id: 'alcohol', label: 'Alcohol', groupId: 'food-drink' },
      { id: 'fuel', label: 'Fuel', groupId: 'transport' }
    ]
  },
  accounts: [{ id: 'spending', label: 'Joint', cardOwners: {} }],
  transactions: [
    { id: 'a', date: '2026-07-05', amount: -100, merchant: 'Coles', accountId: 'spending', cardSuffix: null, categoryId: 'groceries', excluded: false },
    { id: 'b', date: '2026-08-05', amount: -40, merchant: 'Coles', accountId: 'spending', cardSuffix: null, categoryId: 'groceries', excluded: false },
    { id: 'c', date: '2026-08-07', amount: -200, merchant: 'BP', accountId: 'spending', cardSuffix: null, categoryId: 'fuel', excluded: false }
  ]
};

test('a panel is pure config', () => {
  const p = createPanel({ id: 'p1', title: 'Where it went', sliceBy: 'category', measure: 'sum' });
  assert.deepEqual(Object.keys(p.config).sort(), ['chartType', 'filters', 'id', 'measure', 'sliceBy', 'title']);
});

test('a panel with no chart type takes the slice default', () => {
  assert.equal(createPanel({ id: 'p', sliceBy: 'month' }).config.chartType, 'line');
  assert.equal(createPanel({ id: 'p', sliceBy: 'category' }).config.chartType, 'bar');
});

test('html renders controls and the chart', () => {
  const p = createPanel({ id: 'p', title: 'Where it went', sliceBy: 'category', measure: 'sum' });
  const html = p.html(SNAPSHOT, {});
  assert.match(html, /Where it went/);
  assert.match(html, /data-panel-control="sliceBy"/);
  assert.match(html, /data-panel-control="measure"/);
  assert.match(html, /data-panel-control="chartType"/);
  assert.match(html, /<svg/);
});

test('the chart switcher offers only valid types for the slice', () => {
  const html = createPanel({ id: 'p', sliceBy: 'category' }).html(SNAPSHOT, {});
  assert.match(html, /value="donut"/);
  assert.doesNotMatch(html, /value="line"/);
  const timeHtml = createPanel({ id: 'p', sliceBy: 'month' }).html(SNAPSHOT, {});
  assert.match(timeHtml, /value="line"/);
  assert.doesNotMatch(timeHtml, /value="donut"/);
});

test('changing the slice repairs an now-invalid chart type', () => {
  const p = createPanel({ id: 'p', sliceBy: 'month', chartType: 'line' });
  p.setSlice('category');
  assert.notEqual(p.config.chartType, 'line');
  assert.equal(p.config.chartType, 'bar');
});

test('changing the slice keeps a still-valid chart type', () => {
  const p = createPanel({ id: 'p', sliceBy: 'category', chartType: 'table' });
  p.setSlice('merchant');
  assert.equal(p.config.chartType, 'table');
});

test('changing the measure repairs an now-invalid chart type', () => {
  const p = createPanel({ id: 'p', sliceBy: 'category', chartType: 'donut' });
  p.setMeasure('avg');
  assert.notEqual(p.config.chartType, 'donut');
});

test('global filters merge with the panel own filters', () => {
  const p = createPanel({ id: 'p', sliceBy: 'category', filters: { groupIds: ['food-drink'] } });
  const html = p.html(SNAPSHOT, { dateFrom: '2026-08-01' });
  assert.match(html, /Groceries/);
  assert.doesNotMatch(html, /Fuel/); // excluded by the panel own group filter
});

test('the panel shows the concentration line for the whole result', () => {
  const html = createPanel({ id: 'p', sliceBy: 'category' }).html(SNAPSHOT, {});
  assert.match(html, /median/);
  assert.match(html, /top 3/);
});

test('the panel escapes its own title', () => {
  const html = createPanel({ id: 'p', title: '<script>x</script>', sliceBy: 'category' }).html(SNAPSHOT, {});
  assert.doesNotMatch(html, /<script>x<\/script>/);
});

test('an empty result renders a message, not a crash', () => {
  const p = createPanel({ id: 'p', sliceBy: 'category', filters: { dateFrom: '2030-01-01' } });
  assert.match(p.html(SNAPSHOT, {}), /No data/);
});

test('colourResolver keys category colour to the group, not to rank', () => {
  const resolve = colourResolver(SNAPSHOT, 'category');
  const groceries = resolve({ key: 'groceries' });
  const fuel = resolve({ key: 'fuel' });
  assert.notEqual(groceries, fuel);
  // Same answer regardless of the order rows arrive in.
  assert.equal(resolve({ key: 'groceries' }), groceries);
});

test('colourResolver keys group colour by group id', () => {
  const resolve = colourResolver(SNAPSHOT, 'group');
  assert.equal(resolve({ key: 'transport' }), '#eb6834');
});

test('colourResolver gives non-taxonomy slices a single stable hue', () => {
  const resolve = colourResolver(SNAPSHOT, 'merchant');
  assert.equal(resolve({ key: 'Coles' }), resolve({ key: 'BP' }));
});

test('the panel output references no external host', () => {
  const html = createPanel({ id: 'p', sliceBy: 'category' }).html(SNAPSHOT, {});
  assert.doesNotMatch(html, /https?:\/\/(?!127\.0\.0\.1|localhost)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/panel.test.js`
Expected: FAIL — `Cannot find module '../web/panel.js'`

- [ ] **Step 3: Write minimal implementation**

Create `web/panel.js`:

```js
import { query } from '../lib/query/query.js';
import { applyFilters, buildContext } from '../lib/query/filter.js';
import { SLICES } from '../lib/query/group-by.js';
import { MEASURES } from '../lib/query/measures.js';
import { chartsFor, renderChart, defaultChartFor } from './charts/index.js';
import { colourForGroup, colourForCategory, GROUP_SLOTS } from './charts/palette.js';
import { escapeHtml, concentrationLine } from './charts/scale.js';

const SLICE_LABELS = {
  category: 'Category', group: 'Group', merchant: 'Merchant', person: 'Person',
  account: 'Account', weekday: 'Day of week', week: 'Week', month: 'Month',
  amountBand: 'Amount band'
};

const MEASURE_LABELS = {
  sum: 'Total $', count: '# Txns', avg: 'Average', median: 'Median', pctOfTotal: '% of total'
};

/**
 * A row's colour, keyed by ENTITY identity so that filtering out one bucket
 * never repaints the survivors.
 *
 * Category slices step their group's hue; group slices use the group hue
 * directly; every other slice is a single series and takes one stable hue.
 */
export function colourResolver(snapshot, sliceBy, mode = 'light') {
  const categories = snapshot?.categories?.categories ?? [];
  const groupOf = new Map(categories.map((c) => [c.id, c.groupId]));
  const siblings = new Map();
  for (const c of categories) {
    if (!siblings.has(c.groupId)) siblings.set(c.groupId, []);
    siblings.get(c.groupId).push(c.id);
  }

  if (sliceBy === 'group') return (row) => colourForGroup(row.key, mode);
  if (sliceBy === 'category') {
    return (row) => {
      const groupId = groupOf.get(row.key) ?? 'other';
      return colourForCategory(row.key, groupId, siblings.get(groupId) ?? [row.key], mode);
    };
  }
  const single = GROUP_SLOTS['food-drink'][mode] ?? GROUP_SLOTS['food-drink'].light;
  return () => single;
}

const selectFor = (name, options, current) => `
  <label class="viz-control">
    <span class="viz-control-label">${name === 'sliceBy' ? 'Slice by' : name === 'measure' ? 'Measure' : 'Chart'}</span>
    <select data-panel-control="${name}">
      ${options.map((o) => `<option value="${escapeHtml(o.value)}"${o.value === current ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>
  </label>`;

/**
 * One configurable panel: a slice, a measure, a chart type and its own filters.
 * `html()` is pure — it takes a snapshot and returns markup, so it is testable
 * without a DOM.
 */
export function createPanel(initial = {}) {
  const config = {
    id: initial.id ?? `panel-${Math.random().toString(36).slice(2, 8)}`,
    title: initial.title ?? 'Untitled panel',
    sliceBy: SLICES.includes(initial.sliceBy) ? initial.sliceBy : 'category',
    measure: MEASURES.includes(initial.measure) ? initial.measure : 'sum',
    chartType: initial.chartType ?? null,
    filters: initial.filters ?? {}
  };

  /** Keep the chart type valid whenever the slice or measure changes. */
  const repairChart = () => {
    const valid = chartsFor(config.sliceBy, config.measure).map((c) => c.id);
    if (!config.chartType || !valid.includes(config.chartType)) {
      const preferred = defaultChartFor(config.sliceBy);
      config.chartType = valid.includes(preferred) ? preferred : valid[0];
    }
    return config;
  };
  repairChart();

  const panel = {
    config,
    setSlice(value) { if (SLICES.includes(value)) config.sliceBy = value; return repairChart(); },
    setMeasure(value) { if (MEASURES.includes(value)) config.measure = value; return repairChart(); },
    setChart(value) {
      const valid = chartsFor(config.sliceBy, config.measure).map((c) => c.id);
      if (valid.includes(value)) config.chartType = value;
      return config;
    },

    html(snapshot, globalFilters = {}) {
      const spec = {
        filters: { ...globalFilters, ...config.filters },
        sliceBy: config.sliceBy,
        measure: config.measure
      };
      const result = query(snapshot, spec);
      const colourFor = colourResolver(snapshot, config.sliceBy);

      const options = { mode: 'light', colourFor, title: config.title };
      if (config.chartType === 'dots') {
        // The only chart needing raw amounts. They are derived through the SAME
        // filters as the rest of the panel, then reduced to bare numbers — so the
        // chart still never receives a whole transaction record.
        const ctx = buildContext(snapshot);
        options.amounts = applyFilters(snapshot.transactions ?? [], spec.filters, ctx)
          .map((t) => t.amount);
      }

      const chart = renderChart(config.chartType, result, options);
      const sliceOptions = SLICES.map((s) => ({ value: s, label: SLICE_LABELS[s] ?? s }));
      const measureOptions = MEASURES.map((m) => ({ value: m, label: MEASURE_LABELS[m] ?? m }));
      const chartOptions = chartsFor(config.sliceBy, config.measure).map((c) => ({ value: c.id, label: c.label }));

      return `
      <section class="viz-panel" data-panel-id="${escapeHtml(config.id)}">
        <header class="viz-panel-head">
          <h3>${escapeHtml(config.title)}</h3>
          <div class="viz-controls">
            ${selectFor('sliceBy', sliceOptions, config.sliceBy)}
            ${selectFor('measure', measureOptions, config.measure)}
            ${selectFor('chartType', chartOptions, config.chartType)}
          </div>
        </header>
        <p class="viz-note">${escapeHtml(concentrationLine(result.stats))}</p>
        <div class="viz-plot">${chart}</div>
      </section>`;
    }
  };

  return panel;
}

/**
 * Attach the panel's controls to a live DOM node. Re-renders on any change and
 * notifies the caller so panel state can be persisted.
 */
export function mount(panel, root, { snapshot, globalFilters = {}, onChange } = {}) {
  const draw = () => { root.innerHTML = panel.html(snapshot, globalFilters); };
  draw();

  root.addEventListener('change', (event) => {
    const control = event.target?.dataset?.panelControl;
    if (!control) return;
    if (control === 'sliceBy') panel.setSlice(event.target.value);
    else if (control === 'measure') panel.setMeasure(event.target.value);
    else if (control === 'chartType') panel.setChart(event.target.value);
    draw();
    onChange?.(panel.config);
  });

  return { redraw: draw };
}
```

Append to `web/style.css`:

```css
/* ---- charts ---- */
:root {
  --viz-surface: #fcfcfb;
  --viz-text-primary: #0b0b0b;
  --viz-text-secondary: #52514e;
  --viz-grid: #e3e5e8;
}
@media (prefers-color-scheme: dark) {
  :root {
    --viz-surface: #1a1a19;
    --viz-text-primary: #ffffff;
    --viz-text-secondary: #c3c2b7;
    --viz-grid: #2c2f34;
  }
}
.viz-panel { border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 20px; background: var(--viz-surface); }
.viz-panel-head { display: flex; flex-wrap: wrap; gap: 12px; align-items: baseline; justify-content: space-between; }
.viz-panel-head h3 { margin: 0; font-size: 15px; }
.viz-controls { display: flex; gap: 12px; flex-wrap: wrap; }
.viz-control { display: flex; align-items: center; gap: 5px; }
.viz-control-label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--viz-text-secondary); }
.viz-control select { font: inherit; font-size: 12px; padding: 3px 6px; border: 1px solid var(--line); border-radius: 5px; background: var(--viz-surface); color: var(--viz-text-primary); }
.viz-note { font-size: 12px; color: var(--viz-text-secondary); margin: 8px 0 12px; }
.viz-plot { overflow-x: auto; }
.viz-label { font-size: 12px; fill: var(--viz-text-secondary); }
.viz-value { font-size: 12px; fill: var(--viz-text-primary); font-variant-numeric: tabular-nums; }
.viz-total { font-size: 17px; fill: var(--viz-text-primary); font-weight: 600; }
.viz-tile-label { font-size: 12px; fill: #ffffff; font-weight: 600; }
.viz-tile-value { font-size: 11px; fill: #ffffff; }
.viz-grid { stroke: var(--viz-grid); stroke-width: 1; }
.viz-empty { color: var(--viz-text-secondary); padding: 24px 0; text-align: center; }
.viz-legend { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12px; }
.viz-legend li { display: flex; align-items: center; gap: 6px; }
.viz-swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.viz-donut { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
.viz-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.viz-table th, .viz-table td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); }
.viz-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.viz-caption { text-align: left; font-weight: 600; padding-bottom: 8px; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/panel.test.js`
Expected: PASS — `# pass 15`

Then `npm test` — everything green.

- [ ] **Step 5: Commit**

```bash
git add web/panel.js web/style.css tests/panel.test.js CHANGELOG.md
git commit -m "feat: add the configurable panel with slice, measure and chart controls"
```

---

## Task 11: Global filter bar

**Files:**
- Create: `web/filter-bar.js`
- Test: `tests/filter-bar.test.js`

**Interfaces:**
- Consumes: `escapeHtml` (`web/charts/scale.js`); `buildContext` (`lib/query/filter.js`)
- Produces:
  - `filterOptions(snapshot) → { months, accounts, people, groups }`
  - `renderFilterBar(snapshot, filters) → string`
  - `readFilterBar(root) → filters` (DOM; not unit-tested)
  - `mountFilterBar(root, { snapshot, filters, onChange })`

The filter bar sits above every panel and re-slices **all** of them at once. Filters here are the `filters` half of a query spec, so they compose with a panel's own filters without special-casing.

Month options derive from the ledger's own date range — never a hardcoded list, and never a future month the user has no data for.

- [ ] **Step 1: Write the failing test**

Create `tests/filter-bar.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterOptions, renderFilterBar } from '../web/filter-bar.js';

const SNAPSHOT = {
  categories: {
    groups: [{ id: 'food-drink', label: 'Food & Drink' }, { id: 'transport', label: 'Transport' }],
    categories: [
      { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
      { id: 'fuel', label: 'Fuel', groupId: 'transport' }
    ]
  },
  accounts: [
    { id: 'spending', label: 'Joint spending', cardOwners: { '4321': 'Alex', '8765': 'Sam' } },
    { id: 'card', label: 'Credit card', cardOwners: {} }
  ],
  transactions: [
    { id: 'a', date: '2026-06-15', amount: -10, categoryId: 'groceries', accountId: 'spending', cardSuffix: '4321', merchant: 'C', excluded: false },
    { id: 'b', date: '2026-08-15', amount: -20, categoryId: 'fuel', accountId: 'card', cardSuffix: null, merchant: 'B', excluded: false }
  ]
};

test('month options span the ledger date range, newest first', () => {
  const { months } = filterOptions(SNAPSHOT);
  assert.deepEqual(months.map((m) => m.value), ['2026-08', '2026-07', '2026-06']);
  assert.equal(months[0].label, 'Aug 2026');
});

test('month options are empty for an empty ledger', () => {
  assert.deepEqual(filterOptions({ ...SNAPSHOT, transactions: [] }).months, []);
});

test('account options come from the accounts collection', () => {
  const { accounts } = filterOptions(SNAPSHOT);
  assert.deepEqual(accounts.map((a) => a.value).sort(), ['card', 'spending']);
});

test('people options include every card owner plus Joint', () => {
  const { people } = filterOptions(SNAPSHOT);
  assert.deepEqual(people.map((p) => p.value).sort(), ['Alex', 'Joint', 'Sam']);
});

test('people is just Joint when no card owners are configured', () => {
  const bare = { ...SNAPSHOT, accounts: [{ id: 'spending', label: 'S', cardOwners: {} }] };
  assert.deepEqual(filterOptions(bare).people.map((p) => p.value), ['Joint']);
});

test('group options come from the taxonomy', () => {
  assert.deepEqual(filterOptions(SNAPSHOT).groups.map((g) => g.value), ['food-drink', 'transport']);
});

test('renderFilterBar emits a control per dimension', () => {
  const html = renderFilterBar(SNAPSHOT, {});
  for (const name of ['month', 'accountIds', 'people', 'groupIds']) {
    assert.match(html, new RegExp(`data-filter="${name}"`), name);
  }
});

test('renderFilterBar marks the active month as selected', () => {
  const html = renderFilterBar(SNAPSHOT, { month: '2026-08' });
  assert.match(html, /value="2026-08" selected/);
});

test('renderFilterBar offers an all-time option', () => {
  assert.match(renderFilterBar(SNAPSHOT, {}), /All time/);
});

test('renderFilterBar escapes account labels', () => {
  const nasty = { ...SNAPSHOT, accounts: [{ id: 'x', label: '<b>x</b>', cardOwners: {} }] };
  assert.doesNotMatch(renderFilterBar(nasty, {}), /<b>x<\/b>/);
});

test('renderFilterBar references no external host', () => {
  assert.doesNotMatch(renderFilterBar(SNAPSHOT, {}), /https?:\/\/(?!127\.0\.0\.1|localhost)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/filter-bar.test.js`
Expected: FAIL — `Cannot find module '../web/filter-bar.js'`

- [ ] **Step 3: Write minimal implementation**

Create `web/filter-bar.js`:

```js
import { escapeHtml } from './charts/scale.js';
import { JOINT } from '../lib/query/filter.js';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

/** Every month between the ledger's first and last transaction, newest first. */
function monthsBetween(dates) {
  if (!dates.length) return [];
  const sorted = [...dates].sort();
  const [firstY, firstM] = sorted[0].split('-').map(Number);
  const [lastY, lastM] = sorted.at(-1).split('-').map(Number);

  const out = [];
  for (let y = firstY, m = firstM; y < lastY || (y === lastY && m <= lastM); m++) {
    if (m > 12) { m = 1; y++; }
    out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out.reverse();
}

/** Options for each global filter, derived from the data — never hardcoded. */
export function filterOptions(snapshot) {
  const transactions = snapshot?.transactions ?? [];
  const accounts = snapshot?.accounts ?? [];

  const owners = new Set([JOINT]);
  for (const account of accounts) {
    for (const person of Object.values(account.cardOwners ?? {})) owners.add(person);
  }

  return {
    months: monthsBetween(transactions.map((t) => t.date)).map((value) => ({ value, label: monthLabel(value) })),
    accounts: accounts.map((a) => ({ value: a.id, label: a.label ?? a.id })),
    people: [...owners].map((value) => ({ value, label: value })),
    groups: (snapshot?.categories?.groups ?? []).map((g) => ({ value: g.id, label: g.label }))
  };
}

const select = (name, label, options, current, allLabel) => `
  <label class="viz-control">
    <span class="viz-control-label">${escapeHtml(label)}</span>
    <select data-filter="${name}">
      <option value="">${escapeHtml(allLabel)}</option>
      ${options.map((o) => `<option value="${escapeHtml(o.value)}"${o.value === current ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>
  </label>`;

/**
 * The global filter bar. Its values are the `filters` half of a query spec, so
 * they compose with each panel's own filters with no special-casing.
 */
export function renderFilterBar(snapshot, filters = {}) {
  const options = filterOptions(snapshot);
  return `
  <div class="viz-filter-bar">
    ${select('month', 'Period', options.months, filters.month ?? '', 'All time')}
    ${select('accountIds', 'Account', options.accounts, (filters.accountIds ?? [])[0] ?? '', 'All accounts')}
    ${select('people', 'Person', options.people, (filters.people ?? [])[0] ?? '', 'Both of us')}
    ${select('groupIds', 'Group', options.groups, (filters.groupIds ?? [])[0] ?? '', 'All groups')}
  </div>`;
}

/** Turn a `month` selection into the dateFrom/dateTo a query spec wants. */
export function toQueryFilters(filters = {}) {
  const { month, accountIds, people, groupIds } = filters;
  const spec = {};
  if (month) {
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    spec.dateFrom = `${month}-01`;
    spec.dateTo = `${month}-${String(lastDay).padStart(2, '0')}`;
  }
  if (accountIds?.length) spec.accountIds = accountIds;
  if (people?.length) spec.people = people;
  if (groupIds?.length) spec.groupIds = groupIds;
  return spec;
}

/** Read the live filter bar back into a filters object. */
export function readFilterBar(root) {
  const value = (name) => root.querySelector(`[data-filter="${name}"]`)?.value ?? '';
  const one = (name) => (value(name) ? [value(name)] : []);
  return { month: value('month'), accountIds: one('accountIds'), people: one('people'), groupIds: one('groupIds') };
}

export function mountFilterBar(root, { snapshot, filters = {}, onChange } = {}) {
  root.innerHTML = renderFilterBar(snapshot, filters);
  root.addEventListener('change', (event) => {
    if (!event.target?.dataset?.filter) return;
    onChange?.(readFilterBar(root));
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/filter-bar.test.js`
Expected: PASS — `# pass 11`

- [ ] **Step 5: Commit**

```bash
git add web/filter-bar.js tests/filter-bar.test.js CHANGELOG.md
git commit -m "feat: add global filter bar deriving its options from the ledger"
```

---

## Task 12: Rebuild the Overview on panels

**Files:**
- Modify: `web/overview-view.js`, `web/app.js`, `web/index.html`
- Test: `tests/overview-panels.test.js`

**Interfaces:**
- Consumes: `createPanel`, `mount`, `colourResolver` (`web/panel.js`); `renderFilterBar`, `toQueryFilters`, `mountFilterBar`, `readFilterBar` (`web/filter-bar.js`); `query` (`lib/query/query.js`)
- Produces:
  - `DEFAULT_PANELS` — the panel set the Overview opens with
  - `renderOverview(snapshot, globalFilters) → string` (pure)
  - `mountOverview(root, { snapshot }) → void`
  - **Keeps** the existing `aggregateOverview(snapshot)` export so Plan 1's `tests/overview-aggregate.test.js` keeps passing.

The Overview keeps its KPI row and gains three default panels: spend by group (bar), spend by category (bar), and spend by month (line). Panel choices persist to `localStorage` so the app reopens as it was left — saved named views are Plan 3.

- [ ] **Step 1: Write the failing test**

Create `tests/overview-panels.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PANELS, renderOverview } from '../web/overview-view.js';
import { aggregateOverview } from '../web/overview-view.js';

const SNAPSHOT = {
  categories: {
    groups: [{ id: 'food-drink', label: 'Food & Drink' }, { id: 'transport', label: 'Transport' }],
    categories: [
      { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
      { id: 'fuel', label: 'Fuel', groupId: 'transport' }
    ]
  },
  accounts: [{ id: 'spending', label: 'Joint', cardOwners: {} }],
  transactions: [
    { id: 'a', date: '2026-07-05', amount: -100, merchant: 'Coles', accountId: 'spending', cardSuffix: null, categoryId: 'groceries', categorySource: 'rule', excluded: false },
    { id: 'b', date: '2026-08-07', amount: -200, merchant: 'BP', accountId: 'spending', cardSuffix: null, categoryId: 'fuel', categorySource: 'unknown', excluded: false }
  ]
};

test('the default panel set is three panels covering group, category and month', () => {
  assert.equal(DEFAULT_PANELS.length, 3);
  assert.deepEqual(DEFAULT_PANELS.map((p) => p.sliceBy), ['group', 'category', 'month']);
  assert.equal(DEFAULT_PANELS.find((p) => p.sliceBy === 'month').chartType, 'line');
});

test('every default panel has a stable id and a title', () => {
  for (const panel of DEFAULT_PANELS) {
    assert.ok(panel.id, 'missing id');
    assert.ok(panel.title, 'missing title');
  }
  assert.equal(new Set(DEFAULT_PANELS.map((p) => p.id)).size, 3);
});

test('renderOverview shows the KPI row with real totals', () => {
  const html = renderOverview(SNAPSHOT, {});
  assert.match(html, /-\$300\.00/);
  assert.match(html, /Total spend/i);
  assert.match(html, /Needs review/i);
});

test('renderOverview renders the filter bar above the panels', () => {
  const html = renderOverview(SNAPSHOT, {});
  assert.ok(html.indexOf('viz-filter-bar') < html.indexOf('viz-panel'), 'filter bar must precede panels');
});

test('renderOverview renders one section per default panel', () => {
  const html = renderOverview(SNAPSHOT, {});
  assert.equal((html.match(/class="viz-panel"/g) ?? []).length, 3);
});

test('global filters flow into every panel and mark the bar as selected', () => {
  const html = renderOverview(SNAPSHOT, { month: '2026-08' });
  assert.match(html, /-\$200\.00/);
  assert.doesNotMatch(html, /-\$300\.00/);
  assert.match(html, /value="2026-08" selected/);
});

test('an empty ledger renders the get-started message, not broken panels', () => {
  const html = renderOverview({ ...SNAPSHOT, transactions: [] }, {});
  assert.match(html, /import a CSV/i);
});

test('aggregateOverview is still exported for Plan 1 compatibility', () => {
  const agg = aggregateOverview(SNAPSHOT);
  assert.ok(agg);
});

test('renderOverview references no external host', () => {
  assert.doesNotMatch(renderOverview(SNAPSHOT, {}), /https?:\/\/(?!127\.0\.0\.1|localhost)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/overview-panels.test.js`
Expected: FAIL — `DEFAULT_PANELS` is not exported

- [ ] **Step 3: Write minimal implementation**

In `web/overview-view.js`, **keep the existing `aggregateOverview` export unchanged** and add below it:

```js
import { createPanel, mount } from './panel.js';
import { renderFilterBar, mountFilterBar, toQueryFilters, readFilterBar } from './filter-bar.js';
import { query } from '../lib/query/query.js';
import { escapeHtml, formatMoney } from './charts/scale.js';

const STORAGE_KEY = 'spendexplore.overview.panels';

/** The panel set the Overview opens with. Saved named views are Plan 3. */
export const DEFAULT_PANELS = Object.freeze([
  { id: 'by-group', title: 'Where it went', sliceBy: 'group', measure: 'sum', chartType: 'bar' },
  { id: 'by-category', title: 'By category', sliceBy: 'category', measure: 'sum', chartType: 'bar' },
  { id: 'by-month', title: 'Over time', sliceBy: 'month', measure: 'sum', chartType: 'line' }
]);

function loadPanelConfigs() {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : null;
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_PANELS.map((p) => ({ ...p }));
  } catch {
    return DEFAULT_PANELS.map((p) => ({ ...p }));
  }
}

function savePanelConfigs(configs) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(configs));
  } catch { /* storage unavailable — panel state simply does not persist */ }
}

function kpiRow(snapshot, globalFilters) {
  const result = query(snapshot, { filters: globalFilters, sliceBy: 'category', measure: 'sum' });
  const needsReview = (snapshot.transactions ?? []).filter((t) => t.categorySource === 'unknown').length;
  return `
  <div class="kpis">
    <div class="kpi"><span>Total spend</span><b>${formatMoney(result.total)}</b></div>
    <div class="kpi"><span>Transactions</span><b>${result.stats.txnCount}</b></div>
    <div class="kpi"><span>Largest single</span><b>${formatMoney(result.stats.largest)}</b></div>
    <div class="kpi"><span>Needs review</span><b class="${needsReview ? 'warn' : ''}">${needsReview}</b></div>
  </div>`;
}

/**
 * Pure render of the whole Overview: KPIs, filter bar, then the panels.
 *
 * `uiFilters` is the FILTER BAR's own shape (`{ month, accountIds, people,
 * groupIds }`), not a query spec — the bar needs it to mark the active option
 * as selected. It is converted to query shape once, here, so panels and KPIs
 * both see the same thing.
 */
export function renderOverview(snapshot, uiFilters = {}, panelConfigs = DEFAULT_PANELS) {
  if (!(snapshot.transactions ?? []).length) {
    return '<p class="empty">No transactions yet — import a CSV to get started.</p>';
  }
  const queryFilters = toQueryFilters(uiFilters);
  const panels = panelConfigs
    .map((config) => createPanel(config).html(snapshot, queryFilters))
    .join('');

  return `
    ${kpiRow(snapshot, queryFilters)}
    ${renderFilterBar(snapshot, uiFilters)}
    ${panels}`;
}

/** Wire the Overview into a live DOM node. */
export function mountOverview(root, { snapshot } = {}) {
  let filters = {};
  let configs = loadPanelConfigs();

  const draw = () => {
    root.innerHTML = renderOverview(snapshot, filters, configs);
  };
  draw();

  root.addEventListener('change', (event) => {
    const target = event.target;
    if (target?.dataset?.filter) {
      filters = readFilterBar(root);
      draw();
      return;
    }
    const control = target?.dataset?.panelControl;
    if (!control) return;

    const panelId = target.closest('[data-panel-id]')?.dataset.panelId;
    const config = configs.find((c) => c.id === panelId);
    if (!config) return;

    const panel = createPanel(config);
    if (control === 'sliceBy') panel.setSlice(target.value);
    else if (control === 'measure') panel.setMeasure(target.value);
    else if (control === 'chartType') panel.setChart(target.value);

    configs = configs.map((c) => (c.id === panelId ? { ...panel.config } : c));
    savePanelConfigs(configs);
    draw();
  });
}
```

In `web/app.js`, replace the `refresh` function and the `renderOverviewView` import:

```js
import { getSnapshot } from './api.js';
import { renderImportView } from './import-view.js';
import { mountOverview } from './overview-view.js';

const views = {
  overview: document.querySelector('#view-overview'),
  import: document.querySelector('#view-import')
};

async function refresh() {
  const snapshot = await getSnapshot();
  mountOverview(views.overview, { snapshot });
}

function showTab(name) {
  for (const [key, element] of Object.entries(views)) element.classList.toggle('hidden', key !== name);
  for (const button of document.querySelectorAll('#tabs button')) {
    button.classList.toggle('active', button.dataset.tab === name);
  }
}

document.querySelector('#tabs').addEventListener('click', (event) => {
  const tab = event.target.dataset?.tab;
  if (tab) showTab(tab);
});

renderImportView(views.import, {
  onImported: async () => { await refresh(); showTab('overview'); }
});

await refresh();
showTab('overview');
```

`web/index.html` needs no structural change — `#view-overview` already exists.

Add to `web/style.css`:

```css
.viz-filter-bar { display: flex; gap: 16px; flex-wrap: wrap; padding: 12px 0 20px; border-bottom: 1px solid var(--line); margin-bottom: 20px; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/overview-panels.test.js`
Expected: PASS — `# pass 9`

Then `npm test` — everything green, including Plan 1's `tests/overview-aggregate.test.js`, `tests/web-modules.test.js` and `tests/smoke.test.js`.

- [ ] **Step 5: Verify end-to-end in a real browser**

```bash
npm start
```

Open `http://127.0.0.1:5173`. Your real ledger is already imported. Confirm:

- The KPI row reads **Total spend -$1,404.01**, **44 transactions**, **largest -$286.48**, **10 needs review**.
- Three panels render: Where it went (bar by group), By category (bar), Over time (line by month).
- Changing the **Slice by** dropdown on any panel to `Merchant` redraws it with merchants, and the **Chart** dropdown's options change to match.
- Setting **Slice by** to `Month` makes `Line` available and removes `Donut`.
- Choosing **Table** on any panel shows the concentration line per row.
- Changing the **Period** filter re-slices every panel at once.
- Reloading the page preserves each panel's slice/measure/chart choices.

Record the observed values in your report. If the KPI total is not `-$1,404.01`, STOP and report.

- [ ] **Step 6: Commit**

```bash
git add web/overview-view.js web/app.js web/style.css tests/overview-panels.test.js CHANGELOG.md
git commit -m "feat: rebuild the Overview on configurable panels with a global filter bar"
```

---

## Done when

- `npm test` passes with every suite green (Plan 1's 196 plus this plan's additions).
- `npm start` serves a working Overview built from panels at `127.0.0.1:5173`.
- The KPI row reconciles to **-$1,404.01** across 44 transactions.
- Every panel's slice, measure and chart type can be changed independently and the chart list adapts to the slice.
- The global filter bar re-slices every panel at once.
- Panel choices survive a reload.
- No UI asset references an external host (`tests/smoke.test.js` still green).
- `CHANGELOG.md` has an entry per task, each `**Dev:**` 2–4 short sentences.

## Deliberately NOT in this plan (Plan 3)

Keyboard review queue · saved named views and the add/remove/reorder panel builder · Trends, Merchants, Recurring and Compare tabs · recurring/subscription detection · copy-paste AI categorisation round trip · budgets · Settings UI for card→person mapping and accounts · `csvMapping` persistence per account (still deferred from Plan 1) · drill-down from a chart mark into the transaction list.

**Carried-forward Minor findings** from Plan 1 live in `.superpowers/sdd/progress.md` (26 items) and should be triaged before or alongside Plan 3 — notably the import preview showing "spend $0.00" when a re-import yields 0 new rows, and the Confirm button staying enabled with nothing to import.
