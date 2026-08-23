# Envelope Budgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-category monthly budgets with envelope (rollover) balances — a new `budgets.json` collection, a pure calculation engine, a `POST /api/budgets` endpoint, and a new "Budgets" tab showing this month's allocation vs. spend, a three-state status, and the running "Available" balance, per category.

**Architecture:** Follows the app's existing three-seam shape exactly. `lib/budgets.js` is a new pure module (snapshot in, numbers out) — no I/O, no DOM — consumed by both the new server route (to validate) and the new browser view (to compute everything the UI shows, matching how `lib/query/*` already works). `budgets.json` is an append-only history, never a mutable single value, so "what was budgeted for month M" is answerable for any M regardless of later edits. The Budgets tab reuses the existing drill-down side panel (`renderDrilldown`) for showing a category's transactions, extended with an optional flag to omit the session-hide checkbox (which has no meaning on this tab, since nothing here reads the session-only `excludeIds` filter).

**Tech Stack:** Node.js stdlib only, `node:test` + `node:assert/strict`, vanilla DOM. No new dependencies.

## Global Constraints

- Zero npm dependencies. Node stdlib only.
- Run tests with `node --test 'tests/**/*.test.js'` (the bare-directory form is broken on this Node version) or explicit file paths.
- `lib/` stays pure: no I/O, no DOM, snapshot/spec in, data out. `web/` owns all DOM wiring, `server/` owns persistence and validation.
- **Sign convention, binding on every calculation in this plan:** `lib/budgets.js`'s `spend` values are **positive magnitudes**, never the ledger's signed negative amount. Allocations are positive; comparing a signed-negative spend against a positive allocation makes every month look on-track by construction — this exact bug was caught while designing this plan and must not be reintroduced.
- Month keys are `"YYYY-MM"` strings throughout, matching `lib/query/group-by.js`'s existing convention. Derived via `date.slice(0, 7)` for a transaction's ISO date, or `new Date().toISOString().slice(0, 7)` for "now" — UTC-based, consistent with how the rest of the app already treats dates (see `group-by.js`'s own UTC-safe comment). This means "now" can lag the real Melbourne calendar by up to ~11 hours right at a month boundary — a known, accepted limitation, not something to solve here.
- Every new/changed test file must pass before its task's commit.
- Untrusted strings (category/group labels) are escaped with `escapeHtml` from `web/charts/scale.js` before going into any HTML template literal.
- Budget-status colours use the app's top-level design tokens (`--accent`, `--warn`, `--muted` from `web/style.css`'s `:root`), **not** `web/charts/palette.js`'s SVG-chart palette — badges are plain HTML, not chart marks, and don't carry that system's colourblind-pairing constraints. Status is never colour-alone: `covered`/`over` also get a distinct text prefix (`↻`/`⚠`), not just a colour.
- No comments explaining WHAT code does, only non-obvious WHY, matching the rest of this codebase.

---

## File Structure

| File | Change |
|---|---|
| `lib/budgets.js` | **New.** `currentMonthKey`, `budgetStatus`, `allBudgetStatuses` |
| `server/store.js` | Add `budgets` to the `COLLECTIONS` allow-list |
| `server/routes/budgets.js` | **New.** `POST /api/budgets` |
| `server/routes.js` | Wire in `budgetRoutes`; extend `GET /api/snapshot` with `budgets` |
| `web/budgets-view.js` | **New.** `renderBudgets` (pure), then `mountBudgets` (DOM wiring) |
| `web/drilldown-panel.js` | Add optional `hideable` flag (default `true`, backward compatible) |
| `web/api.js` | Add `postBudget` |
| `web/app.js` | Register the Budgets tab, its own drill-down root |
| `web/index.html` | Add the tab button, its view section, and a second drill-down root |
| `web/style.css` | Budget-status badges, table, and input styling |

---

## Task 1: `lib/budgets.js` — the calculation engine

**Files:**
- Create: `lib/budgets.js`
- Test: `tests/budgets.test.js`

**Interfaces:**
- Produces: `currentMonthKey() → "YYYY-MM"`; `budgetStatus(snapshot, categoryId, month = currentMonthKey()) → { allocation, spend, balance, status: 'on-track'|'covered'|'over' } | null`; `allBudgetStatuses(snapshot, month = currentMonthKey()) → Array<{ categoryId, hasAllocationForMonth, allocation, spend, balance, status }>`. `snapshot.budgets` is an array of `{ id, categoryId, amount, effectiveFrom }`. Both later web and server tasks import from here — do not change these names or shapes without checking Tasks 2, 3, 5.

- [ ] **Step 1: Write the failing tests**

Create `tests/budgets.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetStatus, allBudgetStatuses, currentMonthKey } from '../lib/budgets.js';

const t = (over) => ({
  id: 'x', date: '2026-08-10', amount: -10, rawDescription: 'R', merchant: 'M',
  accountId: 'a', cardSuffix: null, categoryId: 'travel', categorySource: 'rule',
  excluded: false, importId: 'i', note: null, ...over
});

const SNAPSHOT = {
  budgets: [
    { id: 'b1', categoryId: 'travel', amount: 500, effectiveFrom: '2026-06' },
    { id: 'b2', categoryId: 'travel', amount: 600, effectiveFrom: '2026-08' }
  ],
  transactions: [
    t({ id: '1', date: '2026-06-05', amount: -100 }),
    // July: deliberately no transactions at all — a gap month.
    t({ id: '3', date: '2026-08-01', amount: -700 })
  ]
};

test('currentMonthKey returns a YYYY-MM string', () => {
  assert.match(currentMonthKey(), /^\d{4}-\d{2}$/);
});

test('allocation lookup picks the latest entry at or before the queried month', () => {
  assert.equal(budgetStatus(SNAPSHOT, 'travel', '2026-06').allocation, 500);
  assert.equal(budgetStatus(SNAPSHOT, 'travel', '2026-07').allocation, 500);
  assert.equal(budgetStatus(SNAPSHOT, 'travel', '2026-08').allocation, 600);
});

test('envelope balance accumulates across months, including a gap month with no spend', () => {
  const status = budgetStatus(SNAPSHOT, 'travel', '2026-08');
  // Jun: 500-100=400. Jul (gap, zero spend): 500-0=500. Aug: 600-700=-100. Total: 800.
  assert.equal(status.balance, 800);
});

test('spend is reported as a positive magnitude, not the ledger signed amount', () => {
  assert.equal(budgetStatus(SNAPSHOT, 'travel', '2026-08').spend, 700);
});

test('status is on-track when the month spend is within its own allocation', () => {
  assert.equal(budgetStatus(SNAPSHOT, 'travel', '2026-06').status, 'on-track');
});

test('status is covered when over the month allocation but the envelope is still positive', () => {
  const status = budgetStatus(SNAPSHOT, 'travel', '2026-08');
  assert.ok(status.spend > status.allocation);
  assert.equal(status.status, 'covered');
});

test('status is over when the envelope itself goes negative', () => {
  const heavy = {
    budgets: [{ id: 'b1', categoryId: 'travel', amount: 500, effectiveFrom: '2026-06' }],
    transactions: [t({ id: '1', date: '2026-06-05', amount: -5000 })]
  };
  const status = budgetStatus(heavy, 'travel', '2026-06');
  assert.equal(status.status, 'over');
  assert.ok(status.balance < 0);
});

test('a $0 budget still distinguishes covered from over via the envelope', () => {
  const paused = {
    budgets: [
      { id: 'b1', categoryId: 'travel', amount: 500, effectiveFrom: '2026-06' },
      { id: 'b2', categoryId: 'travel', amount: 0, effectiveFrom: '2026-07' }
    ],
    transactions: [
      t({ id: '1', date: '2026-06-05', amount: -50 }),  // leaves 450 rolling into July
      t({ id: '2', date: '2026-07-10', amount: -20 })   // any spend at all exceeds a $0 allocation
    ]
  };
  const status = budgetStatus(paused, 'travel', '2026-07');
  assert.equal(status.allocation, 0);
  assert.equal(status.spend, 20);
  assert.equal(status.status, 'covered'); // still covered by the 450 rolled forward from June
});

test('a category never budgeted returns null', () => {
  assert.equal(budgetStatus(SNAPSHOT, 'groceries', '2026-08'), null);
});

test('a month before the first budget entry returns null', () => {
  assert.equal(budgetStatus(SNAPSHOT, 'travel', '2026-05'), null);
});

test('spend before the first budget entry is excluded from the envelope entirely', () => {
  const withPriorSpend = {
    budgets: [{ id: 'b1', categoryId: 'travel', amount: 500, effectiveFrom: '2026-08' }],
    transactions: [
      t({ id: 'old', date: '2026-01-05', amount: -9000 }), // long before the budget existed
      t({ id: 'new', date: '2026-08-05', amount: -100 })
    ]
  };
  const status = budgetStatus(withPriorSpend, 'travel', '2026-08');
  assert.equal(status.balance, 400); // 500 - 100; the -9000 in January never counted
});

test('excluded transactions do not count as spend', () => {
  const withExcluded = {
    budgets: [{ id: 'b1', categoryId: 'travel', amount: 500, effectiveFrom: '2026-08' }],
    transactions: [t({ id: 'e', date: '2026-08-05', amount: -9000, excluded: true })]
  };
  const status = budgetStatus(withExcluded, 'travel', '2026-08');
  assert.equal(status.spend, 0);
  assert.equal(status.balance, 500);
});

test('allBudgetStatuses returns one row per budgeted category', () => {
  const rows = allBudgetStatuses(SNAPSHOT, '2026-08');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].categoryId, 'travel');
  assert.equal(rows[0].hasAllocationForMonth, true);
});

test('allBudgetStatuses reports hasAllocationForMonth false before the first entry, without throwing', () => {
  const rows = allBudgetStatuses(SNAPSHOT, '2026-01');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hasAllocationForMonth, false);
  assert.equal(rows[0].status, null);
});

test('a snapshot with no budgets at all produces no rows', () => {
  assert.deepEqual(allBudgetStatuses({ budgets: [], transactions: [] }, '2026-08'), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/budgets.test.js`
Expected: FAIL — the module does not exist yet.

- [ ] **Step 3: Implement `lib/budgets.js`**

```js
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * The current real-world month as a "YYYY-MM" key, UTC-based — matches the
 * month key convention every other part of this app uses (see
 * lib/query/group-by.js). Used both as the default month for every function
 * below and, server-side, to stamp a new budget entry's effectiveFrom.
 */
export function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

/** The budget entry in effect for `categoryId` at `month`: the one with the
 * latest effectiveFrom that is still <= month. `null` if none exists. */
function allocationEntryFor(budgets, categoryId, month) {
  const candidates = budgets
    .filter((b) => b.categoryId === categoryId && b.effectiveFrom <= month)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0));
  return candidates[0] ?? null;
}

/** Every month from `from` through `to`, inclusive, as "YYYY-MM" keys. */
function monthsBetween(from, to) {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const out = [];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m++) {
    if (m > 12) { m = 1; y++; }
    out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

/** Spend in `categoryId` during `month`, as a POSITIVE magnitude — see the
 * plan's Global Constraints note on sign convention. Permanently-excluded
 * rows never count. */
function spendFor(transactions, categoryId, month) {
  return round2(transactions
    .filter((t) => !t.excluded && t.categoryId === categoryId && t.date.slice(0, 7) === month)
    .reduce((a, t) => a - t.amount, 0));
}

/**
 * Full budget status for one category at one month. `null` when the
 * category has no allocation covering `month` — either never budgeted, or
 * `month` predates its first budget entry.
 */
export function budgetStatus(snapshot, categoryId, month = currentMonthKey()) {
  const budgets = snapshot?.budgets ?? [];
  const transactions = snapshot?.transactions ?? [];
  const entry = allocationEntryFor(budgets, categoryId, month);
  if (!entry) return null;

  const categoryEntries = budgets.filter((b) => b.categoryId === categoryId);
  const first = categoryEntries.reduce(
    (earliest, b) => (b.effectiveFrom < earliest ? b.effectiveFrom : earliest),
    categoryEntries[0].effectiveFrom);

  let balance = 0;
  for (const m of monthsBetween(first, month)) {
    const alloc = allocationEntryFor(budgets, categoryId, m);
    balance += (alloc ? alloc.amount : 0) - spendFor(transactions, categoryId, m);
  }
  balance = round2(balance);

  const allocation = entry.amount;
  const spend = spendFor(transactions, categoryId, month);
  const status = spend <= allocation ? 'on-track' : (balance >= 0 ? 'covered' : 'over');

  return { allocation, spend, balance, status };
}

/**
 * One row per category that has ANY budget history, for `month`.
 * `hasAllocationForMonth` is false only when `month` predates the
 * category's first entry — allocation/spend/balance are 0 and status is
 * null in that case, since there is nothing to report yet.
 */
export function allBudgetStatuses(snapshot, month = currentMonthKey()) {
  const budgets = snapshot?.budgets ?? [];
  const categoryIds = [...new Set(budgets.map((b) => b.categoryId))];
  return categoryIds.map((categoryId) => {
    const status = budgetStatus(snapshot, categoryId, month);
    return status
      ? { categoryId, hasAllocationForMonth: true, ...status }
      : { categoryId, hasAllocationForMonth: false, allocation: 0, spend: 0, balance: 0, status: null };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/budgets.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add lib/budgets.js tests/budgets.test.js
git commit -m "feat: add the envelope budget calculation engine"
```

---

## Task 2: `POST /api/budgets` and the `budgets` collection

**Files:**
- Modify: `server/store.js`
- Create: `server/routes/budgets.js`
- Modify: `server/routes.js`
- Test: `tests/budget-routes.test.js`

**Interfaces:**
- Consumes: `currentMonthKey` (`lib/budgets.js`, Task 1).
- Produces: `POST /api/budgets` — body `{ categoryId: string, amount: number }` → `200 { budgets: Array }` on success, `400 { error }` on a bad category or amount. `GET /api/snapshot` now includes a `budgets` array alongside the existing five collections.

- [ ] **Step 1: Write the failing tests**

Create `tests/budget-routes.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';

const withServer = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'spendexplore-budgets-'));
  const app = await startServer({ port: 0, dataDir: dir });
  const base = `http://127.0.0.1:${app.port}`;
  try { await fn(base, app.store); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
};

const postBudget = (base, body) =>
  fetch(`${base}/api/budgets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

test('a valid budget is appended and returned', async () => {
  await withServer(async (base) => {
    const res = await postBudget(base, { categoryId: 'groceries', amount: 500 });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.budgets.length, 1);
    assert.equal(body.budgets[0].categoryId, 'groceries');
    assert.equal(body.budgets[0].amount, 500);
    assert.match(body.budgets[0].effectiveFrom, /^\d{4}-\d{2}$/);
    assert.ok(body.budgets[0].id);
  });
});

test('rejects an unknown category', async () => {
  await withServer(async (base) => {
    const res = await postBudget(base, { categoryId: 'not-a-real-category', amount: 500 });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Unknown category/);
  });
});

test('rejects a negative amount', async () => {
  await withServer(async (base) => {
    assert.equal((await postBudget(base, { categoryId: 'groceries', amount: -50 })).status, 400);
  });
});

test('rejects a non-numeric amount', async () => {
  await withServer(async (base) => {
    assert.equal((await postBudget(base, { categoryId: 'groceries', amount: 'lots' })).status, 400);
  });
});

test('a missing categoryId is rejected', async () => {
  await withServer(async (base) => {
    assert.equal((await postBudget(base, { amount: 500 })).status, 400);
  });
});

test('a $0 budget is accepted', async () => {
  await withServer(async (base) => {
    assert.equal((await postBudget(base, { categoryId: 'groceries', amount: 0 })).status, 200);
  });
});

test('a second budget for the same category APPENDS rather than overwrites', async () => {
  await withServer(async (base, store) => {
    await postBudget(base, { categoryId: 'groceries', amount: 500 });
    await postBudget(base, { categoryId: 'groceries', amount: 600 });
    const budgets = await store.read('budgets');
    assert.equal(budgets.length, 2);
    assert.equal(budgets[0].amount, 500);
    assert.equal(budgets[1].amount, 600);
  });
});

test('a malformed JSON body is a clean 400, not a 500', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/budgets`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json'
    });
    assert.equal(res.status, 400);
  });
});

test('GET /api/snapshot includes budgets', async () => {
  await withServer(async (base) => {
    await postBudget(base, { categoryId: 'groceries', amount: 500 });
    const snapshot = await (await fetch(`${base}/api/snapshot`)).json();
    assert.equal(snapshot.budgets.length, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/budget-routes.test.js`
Expected: FAIL — `/api/budgets` doesn't exist (404) and `GET /api/snapshot` has no `budgets` key.

- [ ] **Step 3: Add `budgets` to `server/store.js`'s collection allow-list**

Change:

```js
const COLLECTIONS = {
  ledger:     { file: 'ledger.json',     seed: () => [] },
  categories: { file: 'categories.json', seedFile: 'categories.json' },
  rules:      { file: 'rules.json',      seedFile: 'rules.json' },
  accounts:   { file: 'accounts.json',   seed: () => [] },
  views:      { file: 'views.json',      seed: () => [] },
  imports:    { file: 'imports.json',    seed: () => [] }
};
```

to:

```js
const COLLECTIONS = {
  ledger:     { file: 'ledger.json',     seed: () => [] },
  categories: { file: 'categories.json', seedFile: 'categories.json' },
  rules:      { file: 'rules.json',      seedFile: 'rules.json' },
  accounts:   { file: 'accounts.json',   seed: () => [] },
  views:      { file: 'views.json',      seed: () => [] },
  imports:    { file: 'imports.json',    seed: () => [] },
  budgets:    { file: 'budgets.json',    seed: () => [] }
};
```

- [ ] **Step 4: Create `server/routes/budgets.js`**

```js
import { randomUUID } from 'node:crypto';
import { sendJson, readBody } from '../http.js';
import { currentMonthKey } from '../../lib/budgets.js';

function validateBudgetBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' };
  }
  if (typeof body.categoryId !== 'string' || body.categoryId === '') {
    return { error: 'categoryId is required' };
  }
  if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount < 0) {
    return { error: 'amount must be a non-negative number' };
  }
  return { body };
}

/**
 * POST /api/budgets — appends a new budget entry. Never overwrites a prior
 * entry: the append-only history is what lets a past month keep whatever
 * allocation was actually in effect for it, even after a later edit (see
 * docs/superpowers/specs/2026-08-23-envelope-budgets-design.md). Queued
 * behind `serialized`, the same shared mutation gate every other write in
 * this app uses, so a budget write can never race an import commit or a
 * transaction PATCH into a lost update.
 *
 * Returns a router function `(req, res, pathname) => boolean | Promise`,
 * matching the same fall-through contract as the other route modules.
 */
export function createBudgetRoutes(store, serialized) {
  return function handleBudgetRoute(req, res, pathname) {
    if (req.method === 'POST' && pathname === '/api/budgets') {
      return serialized(async () => {
        const raw = await readBody(req);
        const validated = validateBudgetBody(raw);
        if (validated.error) return sendJson(res, 400, { error: validated.error });
        const { categoryId, amount } = validated.body;

        const { categories } = await store.read('categories');
        if (!categories.some((c) => c.id === categoryId)) {
          return sendJson(res, 400, { error: `Unknown category: ${categoryId}` });
        }

        const budgets = await store.read('budgets');
        const entry = { id: randomUUID(), categoryId, amount, effectiveFrom: currentMonthKey() };
        const next = [...budgets, entry];

        await store.backup();
        await store.write('budgets', next);
        return sendJson(res, 200, { budgets: next });
      });
    }
    return false;
  };
}
```

- [ ] **Step 5: Wire it into `server/routes.js`**

Change:

```js
import { sendJson } from './http.js';
import { createImportRoutes } from './routes/import.js';
import { createTransactionRoutes } from './routes/transactions.js';
import { createMutationGate } from './mutation-gate.js';

export function createRouter(store) {
  const gate = createMutationGate();
  const importRoutes = createImportRoutes(store, gate);
  const transactionRoutes = createTransactionRoutes(store, gate);

  return async function route(req, res, pathname) {
    if (req.method === 'GET' && pathname === '/api/snapshot') {
      const [transactions, categories, rules, accounts, views, imports] = await Promise.all([
        store.read('ledger'), store.read('categories'), store.read('rules'),
        store.read('accounts'), store.read('views'), store.read('imports')
      ]);
      return sendJson(res, 200, { transactions, categories, rules, accounts, views, imports });
    }

    for (const handler of [importRoutes, transactionRoutes]) {
      const handled = handler(req, res, pathname);
      if (handled !== false) return await handled;
    }

    return sendJson(res, 404, { error: 'Not found' });
  };
}
```

to:

```js
import { sendJson } from './http.js';
import { createImportRoutes } from './routes/import.js';
import { createTransactionRoutes } from './routes/transactions.js';
import { createBudgetRoutes } from './routes/budgets.js';
import { createMutationGate } from './mutation-gate.js';

export function createRouter(store) {
  const gate = createMutationGate();
  const importRoutes = createImportRoutes(store, gate);
  const transactionRoutes = createTransactionRoutes(store, gate);
  const budgetRoutes = createBudgetRoutes(store, gate);

  return async function route(req, res, pathname) {
    if (req.method === 'GET' && pathname === '/api/snapshot') {
      const [transactions, categories, rules, accounts, views, imports, budgets] = await Promise.all([
        store.read('ledger'), store.read('categories'), store.read('rules'),
        store.read('accounts'), store.read('views'), store.read('imports'), store.read('budgets')
      ]);
      return sendJson(res, 200, { transactions, categories, rules, accounts, views, imports, budgets });
    }

    for (const handler of [importRoutes, transactionRoutes, budgetRoutes]) {
      const handled = handler(req, res, pathname);
      if (handled !== false) return await handled;
    }

    return sendJson(res, 404, { error: 'Not found' });
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test tests/budget-routes.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 7: Commit**

```bash
git add server/store.js server/routes/budgets.js server/routes.js tests/budget-routes.test.js
git commit -m "feat: add POST /api/budgets and the budgets collection"
```

---

## Task 3: `renderBudgets` — the pure render of the Budgets tab

**Files:**
- Create: `web/budgets-view.js` (this task adds only `renderBudgets`; Task 5 appends `mountBudgets` to the same file)
- Test: `tests/budgets-view.test.js`

**Interfaces:**
- Consumes: `allBudgetStatuses`, `currentMonthKey` (`lib/budgets.js`, Task 1); `escapeHtml`, `formatMoney` (`web/charts/scale.js`, unchanged).
- Produces: `renderBudgets(snapshot, state = {})` → HTML string. `state` is `{ month?: string, editing?: string | null }` — `month` defaults to `currentMonthKey()`, `editing` is the categoryId currently showing an inline edit input (or `null`). Markup carries `data-budget-category="<id>"` per row, `data-budget-action="add"|"edit"|"save"|"cancel"` + `data-category-id="<id>"` on the relevant buttons, and `data-budget-input` on the edit `<input>` — Task 5's `mountBudgets` wires all of these.

- [ ] **Step 1: Write the failing tests**

Create `tests/budgets-view.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBudgets } from '../web/budgets-view.js';

const SNAPSHOT = {
  categories: {
    groups: [{ id: 'food-drink', label: 'Food & Drink' }, { id: 'other', label: 'Other' }],
    categories: [
      { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
      { id: 'alcohol', label: 'Alcohol', groupId: 'food-drink' },
      { id: 'uncategorised', label: 'Uncategorised', groupId: 'other' },
      { id: 'income', label: 'Income', groupId: 'other' }
    ]
  },
  budgets: [
    { id: 'b1', categoryId: 'groceries', amount: 500, effectiveFrom: '2026-08' }
  ],
  transactions: [
    { id: 't1', date: '2026-08-05', amount: -200, categoryId: 'groceries', excluded: false }
  ]
};

test('shows a row for every assignable category', () => {
  const html = renderBudgets(SNAPSHOT, { month: '2026-08' });
  assert.match(html, /Groceries/);
  assert.match(html, /Alcohol/);
});

test('never shows income or uncategorised', () => {
  const html = renderBudgets(SNAPSHOT, { month: '2026-08' });
  assert.doesNotMatch(html, /data-budget-category="income"/);
  assert.doesNotMatch(html, /data-budget-category="uncategorised"/);
});

test('a budgeted category shows allocation, spend, status and the available balance', () => {
  const html = renderBudgets(SNAPSHOT, { month: '2026-08' });
  assert.match(html, /\$500\.00 budgeted/);
  assert.match(html, /\$200\.00 spent/);
  assert.match(html, /budget-status-on-track/);
  assert.match(html, /\$300\.00/); // 500 - 200 available
});

test('an unbudgeted category shows an Add budget prompt', () => {
  const html = renderBudgets(SNAPSHOT, { month: '2026-08' });
  assert.match(html, /No budget set/);
  assert.match(html, /data-budget-action="add" data-category-id="alcohol"/);
});

test('the editing category shows an input pre-filled with its current allocation', () => {
  const html = renderBudgets(SNAPSHOT, { month: '2026-08', editing: 'groceries' });
  assert.match(html, /data-budget-input/);
  assert.match(html, /value="500"/);
  assert.match(html, /data-budget-action="save" data-category-id="groceries"/);
  assert.match(html, /data-budget-action="cancel" data-category-id="groceries"/);
});

test('editing an unbudgeted category starts the input at 0', () => {
  const html = renderBudgets(SNAPSHOT, { month: '2026-08', editing: 'alcohol' });
  assert.match(html, /data-budget-input/);
  assert.match(html, /value="0"/);
});

test('groups categories under their group label', () => {
  const html = renderBudgets(SNAPSHOT, { month: '2026-08' });
  assert.match(html, /Food &amp; Drink/);
});

test('escapes category and group labels', () => {
  const nasty = {
    ...SNAPSHOT,
    categories: {
      groups: [{ id: 'g', label: '<script>x</script>' }],
      categories: [{ id: 'c', label: '<img src=x>', groupId: 'g' }]
    },
    budgets: []
  };
  const html = renderBudgets(nasty, { month: '2026-08' });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.doesNotMatch(html, /<img src=x>/);
});

test('references no external host', () => {
  assert.doesNotMatch(renderBudgets(SNAPSHOT, { month: '2026-08' }), /https?:\/\/(?!127\.0\.0\.1|localhost)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/budgets-view.test.js`
Expected: FAIL — the module does not exist yet.

- [ ] **Step 3: Implement `renderBudgets` in `web/budgets-view.js`**

```js
import { escapeHtml, formatMoney } from './charts/scale.js';
import { allBudgetStatuses, currentMonthKey } from '../lib/budgets.js';

const STATUS_LABELS = {
  'on-track': 'On track',
  covered: '↻ Covered by rollover',
  over: '⚠ Over'
};

const assignableCategories = (snapshot) =>
  (snapshot?.categories?.categories ?? []).filter((c) => c.id !== 'income' && c.id !== 'uncategorised');

/**
 * Pure render of the Budgets tab: every assignable category, grouped, each
 * showing this month's allocation vs. spend, its three-state status, and
 * the running envelope balance ("Available"). A category with no budget
 * history renders an "Add budget" prompt instead. `state.editing` is the
 * one category currently showing an inline amount input in place of its
 * normal row.
 */
export function renderBudgets(snapshot, state = {}) {
  const month = state.month ?? currentMonthKey();
  const editing = state.editing ?? null;

  const categories = assignableCategories(snapshot);
  if (!categories.length) return '<p class="empty">No categories yet.</p>';

  const groups = snapshot?.categories?.groups ?? [];
  const groupLabel = new Map(groups.map((g) => [g.id, g.label]));
  const statusByCategory = new Map(allBudgetStatuses(snapshot, month).map((s) => [s.categoryId, s]));

  const byGroup = new Map();
  for (const c of categories) {
    const groupId = c.groupId ?? 'other';
    if (!byGroup.has(groupId)) byGroup.set(groupId, []);
    byGroup.get(groupId).push(c);
  }

  const body = [...byGroup.entries()].map(([groupId, cats]) => {
    const catRows = cats.map((c) => {
      const status = statusByCategory.get(c.id);
      const budgeted = Boolean(status?.hasAllocationForMonth);
      const isEditing = editing === c.id;

      if (isEditing) {
        const current = budgeted ? status.allocation : 0;
        return `
        <tr data-budget-category="${escapeHtml(c.id)}">
          <td>${escapeHtml(c.label)}</td>
          <td colspan="3">
            <input type="number" data-budget-input min="0" step="0.01" value="${current}">
          </td>
          <td>
            <button data-budget-action="save" data-category-id="${escapeHtml(c.id)}">Save</button>
            <button data-budget-action="cancel" data-category-id="${escapeHtml(c.id)}">Cancel</button>
          </td>
        </tr>`;
      }

      if (!budgeted) {
        return `
        <tr data-budget-category="${escapeHtml(c.id)}">
          <td>${escapeHtml(c.label)}</td>
          <td colspan="3" class="budget-unset">No budget set</td>
          <td><button data-budget-action="add" data-category-id="${escapeHtml(c.id)}">Add budget</button></td>
        </tr>`;
      }

      return `
      <tr data-budget-category="${escapeHtml(c.id)}">
        <td>${escapeHtml(c.label)}</td>
        <td>${formatMoney(status.allocation)} budgeted · ${formatMoney(status.spend)} spent</td>
        <td><span class="budget-status budget-status-${status.status}">${STATUS_LABELS[status.status]}</span></td>
        <td class="num">${formatMoney(status.balance)}</td>
        <td><button data-budget-action="edit" data-category-id="${escapeHtml(c.id)}">Edit</button></td>
      </tr>`;
    }).join('');

    return `
    <tr class="group-row"><td colspan="5">${escapeHtml(groupLabel.get(groupId) ?? groupId)}</td></tr>
    ${catRows}`;
  }).join('');

  return `
  <table class="viz-table budgets-table">
    <thead><tr><th>Category</th><th>This month</th><th>Status</th><th class="num">Available</th><th></th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/budgets-view.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add web/budgets-view.js tests/budgets-view.test.js
git commit -m "feat: add the pure Budgets tab render"
```

---

## Task 4: `drilldown-panel.js` — an optional `hideable` flag

The Budgets tab (Task 5) reuses `renderDrilldown` to show a category's transactions, but the session-only "hide" feature has no meaning there — nothing on the Budgets tab reads the `excludeIds` filter, so a hide checkbox that silently did nothing would be a dead, confusing control. This task adds a flag to omit it, defaulting to `true` so the Overview's existing usage (Plan from 2026-08-23, already shipped) is completely unaffected.

**Files:**
- Modify: `web/drilldown-panel.js`
- Test: `tests/drilldown-panel.test.js`

**Interfaces:**
- Produces: `renderDrilldown(snapshot, state)` — `state` gains an optional `hideable` field (default `true`). When `false`, the Hide column (header, checkbox, and the "this session only" note) is omitted entirely; the category re-assign `<select>` is unaffected either way.

- [ ] **Step 1: Write the failing tests**

Add to `tests/drilldown-panel.test.js` (it already has `SNAPSHOT` and `ROWS` fixtures — reuse them):

```js
test('hideable defaults to true — existing callers keep the hide column', () => {
  const html = renderDrilldown(SNAPSHOT, { label: 'Alcohol', rows: ROWS, excludedIds: new Set() });
  assert.match(html, /toggle-hide/);
  assert.match(html, /this session/i);
});

test('hideable: false omits the hide column and its note entirely, but keeps re-categorise', () => {
  const html = renderDrilldown(SNAPSHOT, { label: 'Alcohol', rows: ROWS, excludedIds: new Set(), hideable: false });
  assert.doesNotMatch(html, /toggle-hide/);
  assert.doesNotMatch(html, /this session/i);
  assert.match(html, /data-drilldown-action="recategorise"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/drilldown-panel.test.js`
Expected: FAIL on the new `hideable: false` test — the flag doesn't exist yet, so the hide column always renders.

- [ ] **Step 3: Implement the flag in `web/drilldown-panel.js`**

Change:

```js
export function renderDrilldown(snapshot, state) {
  if (!state) return '';
  const { label, rows = [], excludedIds = new Set() } = state;
  const categories = assignableCategories(snapshot);

  const options = (currentId) => categories
    .map((c) => `<option value="${escapeHtml(c.id)}"${c.id === currentId ? ' selected' : ''}>${escapeHtml(c.label)}</option>`)
    .join('');

  const sorted = [...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const rowsHtml = sorted.map((t) => {
    const hidden = excludedIds.has(t.id);
    return `
    <tr class="${hidden ? 'drilldown-hidden-row' : ''}" data-drilldown-id="${escapeHtml(t.id)}">
      <td>${escapeHtml(t.date)}</td>
      <td>${escapeHtml(t.merchant)}</td>
      <td class="num">${formatMoney(t.amount)}</td>
      <td><select data-drilldown-action="recategorise">${options(t.categoryId)}</select></td>
      <td>
        <label class="drilldown-hide">
          <input type="checkbox" data-drilldown-action="toggle-hide" ${hidden ? 'checked' : ''}>
          Hide
        </label>
      </td>
    </tr>`;
  }).join('');

  const total = rows.filter((t) => !excludedIds.has(t.id)).reduce((a, t) => a + t.amount, 0);

  return `
  <div class="drilldown-panel">
    <header class="drilldown-head">
      <h3>${escapeHtml(label)}</h3>
      <button data-drilldown-action="close" aria-label="Close">✕</button>
    </header>
    <p class="viz-note">${rows.length} transaction${rows.length === 1 ? '' : 's'} · ${formatMoney(total)}</p>
    <p class="viz-note">Hiding a transaction removes it from the charts for this session only — it resets when you reload the page. To exclude one permanently, use the Review tab.</p>
    <table class="viz-table drilldown-table">
      <thead><tr><th>Date</th><th>Merchant</th><th class="num">Amount</th><th>Category</th><th></th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>`;
}
```

to:

```js
export function renderDrilldown(snapshot, state) {
  if (!state) return '';
  const { label, rows = [], excludedIds = new Set(), hideable = true } = state;
  const categories = assignableCategories(snapshot);

  const options = (currentId) => categories
    .map((c) => `<option value="${escapeHtml(c.id)}"${c.id === currentId ? ' selected' : ''}>${escapeHtml(c.label)}</option>`)
    .join('');

  const sorted = [...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const rowsHtml = sorted.map((t) => {
    const hidden = excludedIds.has(t.id);
    const hideCell = hideable
      ? `<td>
          <label class="drilldown-hide">
            <input type="checkbox" data-drilldown-action="toggle-hide" ${hidden ? 'checked' : ''}>
            Hide
          </label>
        </td>`
      : '';
    return `
    <tr class="${hidden ? 'drilldown-hidden-row' : ''}" data-drilldown-id="${escapeHtml(t.id)}">
      <td>${escapeHtml(t.date)}</td>
      <td>${escapeHtml(t.merchant)}</td>
      <td class="num">${formatMoney(t.amount)}</td>
      <td><select data-drilldown-action="recategorise">${options(t.categoryId)}</select></td>
      ${hideCell}
    </tr>`;
  }).join('');

  const total = rows.filter((t) => !excludedIds.has(t.id)).reduce((a, t) => a + t.amount, 0);
  const hideNote = hideable
    ? `<p class="viz-note">Hiding a transaction removes it from the charts for this session only — it resets when you reload the page. To exclude one permanently, use the Review tab.</p>`
    : '';
  const hideHeader = hideable ? '<th></th>' : '';

  return `
  <div class="drilldown-panel">
    <header class="drilldown-head">
      <h3>${escapeHtml(label)}</h3>
      <button data-drilldown-action="close" aria-label="Close">✕</button>
    </header>
    <p class="viz-note">${rows.length} transaction${rows.length === 1 ? '' : 's'} · ${formatMoney(total)}</p>
    ${hideNote}
    <table class="viz-table drilldown-table">
      <thead><tr><th>Date</th><th>Merchant</th><th class="num">Amount</th><th>Category</th>${hideHeader}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/drilldown-panel.test.js`
Expected: PASS, all tests in the file (the pre-existing ones AND the two new ones).

- [ ] **Step 5: Commit**

```bash
git add web/drilldown-panel.js tests/drilldown-panel.test.js
git commit -m "feat: add an optional hideable flag to the drill-down panel"
```

---

## Task 5: Wire the Budgets tab into the app

The final task: `mountBudgets` (inline edit, click-through to a category's transactions this month, re-categorise from there), a `postBudget` API helper, and registering the whole tab — its own nav button, view section, and its own drill-down root (kept separate from Overview's `#drilldown` deliberately: both `mountOverview` and `mountBudgets` attach their own click/change listeners to whatever element they're given, and if they shared one DOM node those listeners would double-fire on every interaction — two independent, identically-styled overlay panels, only one of which is ever open at a time in practice, avoids that entirely).

**Files:**
- Modify: `web/api.js`
- Modify: `web/budgets-view.js` (adds `mountBudgets`, appended after `renderBudgets` from Task 3)
- Modify: `web/app.js`
- Modify: `web/index.html`
- Modify: `web/style.css`

**Interfaces:**
- Consumes: `renderBudgets` (Task 3); `renderDrilldown` with `hideable` (Task 4); `transactionsForSlice` (`lib/query/slice-transactions.js`, unchanged); `currentMonthKey` (Task 1); `getSnapshot`, `patchTransaction` (`web/api.js`, unchanged).
- Produces: `postBudget(categoryId, amount)` (`web/api.js`); `mountBudgets(root, { snapshot, drilldownRoot }) → { redraw, refresh }`, the same shape `mountOverview`/`mountReview` already return.

- [ ] **Step 1: Add `postBudget` to `web/api.js`**

Change:

```js
export const bulkCategorise = (payload) => postJson('/api/transactions/bulk', payload);
export const createCategory  = (payload) => postJson('/api/categories', payload);
```

to:

```js
export const bulkCategorise = (payload) => postJson('/api/transactions/bulk', payload);
export const createCategory  = (payload) => postJson('/api/categories', payload);
export const postBudget      = (categoryId, amount) => postJson('/api/budgets', { categoryId, amount });
```

- [ ] **Step 2: Append `mountBudgets` to `web/budgets-view.js`**

Add these imports at the top of the file, alongside the existing ones:

```js
import { transactionsForSlice } from '../lib/query/slice-transactions.js';
import { renderDrilldown } from './drilldown-panel.js';
import { postBudget, getSnapshot, patchTransaction } from './api.js';
```

Append this function at the end of the file (after `renderBudgets`):

```js
/** The inclusive dateFrom/dateTo for one "YYYY-MM" month. */
function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { dateFrom: `${month}-01`, dateTo: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/** Wire the Budgets tab into a live DOM node. */
export function mountBudgets(root, { snapshot, drilldownRoot } = {}) {
  let current = snapshot;
  let editing = null;
  let drilldown = null; // { label, rows, refetch } | null

  const draw = () => {
    if (drilldown) {
      const bucket = drilldown.refetch();
      drilldown = bucket ? { ...drilldown, rows: bucket.rows, label: bucket.label } : null;
    }
    root.innerHTML = renderBudgets(current, { month: currentMonthKey(), editing });
    if (drilldownRoot) {
      // hideable: false — the session-only hide feature has no meaning here;
      // nothing on this tab reads the excludeIds filter.
      drilldownRoot.innerHTML = renderDrilldown(current, drilldown && { ...drilldown, hideable: false });
      drilldownRoot.classList.toggle('hidden', !drilldown);
    }
  };

  function openDrilldown(categoryId, label) {
    const month = currentMonthKey();
    const { dateFrom, dateTo } = monthRange(month);
    const doFetch = () =>
      transactionsForSlice(current, { filters: { dateFrom, dateTo }, sliceBy: 'category' }, categoryId);
    const bucket = doFetch();
    drilldown = bucket ? { label: `${label} — ${month}`, rows: bucket.rows, refetch: doFetch } : null;
  }

  async function reassign(id, categoryId) {
    await patchTransaction(id, { categoryId });
    current = await getSnapshot();
    draw();
  }

  async function refresh() {
    current = await getSnapshot();
    draw();
  }

  root.addEventListener('click', async (event) => {
    const actionEl = event.target.closest('[data-budget-action]');
    if (actionEl) {
      const action = actionEl.dataset.budgetAction;
      const categoryId = actionEl.dataset.categoryId;
      if (action === 'add' || action === 'edit') {
        editing = categoryId;
        draw();
      } else if (action === 'cancel') {
        editing = null;
        draw();
      } else if (action === 'save') {
        const input = root.querySelector('[data-budget-input]');
        const amount = Number(input?.value);
        if (Number.isFinite(amount) && amount >= 0) {
          await postBudget(categoryId, amount);
          editing = null;
          await refresh();
        }
      }
      return;
    }

    const row = event.target.closest('[data-budget-category]');
    if (row && !event.target.closest('[data-budget-input]')) {
      const label = row.querySelector('td')?.textContent?.trim() ?? row.dataset.budgetCategory;
      openDrilldown(row.dataset.budgetCategory, label);
      draw();
    }
  });

  if (drilldownRoot) {
    drilldownRoot.addEventListener('click', (event) => {
      if (event.target.closest('[data-drilldown-action="close"]')) {
        drilldown = null;
        draw();
      }
    });
    drilldownRoot.addEventListener('change', (event) => {
      const row = event.target.closest('[data-drilldown-id]');
      if (!row) return;
      if (event.target.dataset.drilldownAction === 'recategorise') {
        reassign(row.dataset.drilldownId, event.target.value);
      }
    });
  }

  draw();
  return { redraw: draw, refresh };
}
```

- [ ] **Step 3: Register the tab in `web/index.html`**

Change:

```html
  <header>
    <h1>SpendExplore</h1>
    <nav id="tabs">
      <button data-tab="overview" class="active">Overview</button>
      <button data-tab="import">Import</button>
      <button data-tab="review">Review</button>
    </nav>
  </header>
  <main>
    <section id="view-overview" class="view"></section>
    <section id="view-import" class="view hidden"></section>
    <section id="view-review" class="view hidden"></section>
  </main>
  <div id="drilldown" class="drilldown hidden"></div>
  <script type="module" src="/app.js"></script>
```

to:

```html
  <header>
    <h1>SpendExplore</h1>
    <nav id="tabs">
      <button data-tab="overview" class="active">Overview</button>
      <button data-tab="import">Import</button>
      <button data-tab="review">Review</button>
      <button data-tab="budgets">Budgets</button>
    </nav>
  </header>
  <main>
    <section id="view-overview" class="view"></section>
    <section id="view-import" class="view hidden"></section>
    <section id="view-review" class="view hidden"></section>
    <section id="view-budgets" class="view hidden"></section>
  </main>
  <div id="drilldown" class="drilldown hidden"></div>
  <div id="budgets-drilldown" class="drilldown hidden"></div>
  <script type="module" src="/app.js"></script>
```

- [ ] **Step 4: Wire it up in `web/app.js`**

Replace the whole file with:

```js
import { getSnapshot } from './api.js';
import { renderImportView } from './import-view.js';
import { mountOverview } from './overview-view.js';
import { mountReview } from './review-view.js';
import { mountBudgets } from './budgets-view.js';

const views = {
  overview: document.querySelector('#view-overview'),
  import: document.querySelector('#view-import'),
  review: document.querySelector('#view-review'),
  budgets: document.querySelector('#view-budgets')
};
const drilldownRoot = document.querySelector('#drilldown');
const budgetsDrilldownRoot = document.querySelector('#budgets-drilldown');

let overview = null;
let review = null;
let budgets = null;

async function refresh() {
  const snapshot = await getSnapshot();
  if (overview) await overview.refresh();
  else overview = mountOverview(views.overview, { snapshot, drilldownRoot });
  if (review) await review.refresh();
  else review = mountReview(views.review, { snapshot });
  if (budgets) await budgets.refresh();
  else budgets = mountBudgets(views.budgets, { snapshot, drilldownRoot: budgetsDrilldownRoot });
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

- [ ] **Step 5: Add CSS**

Append to `web/style.css`:

```css
.budgets-table .budget-unset { color: var(--viz-text-secondary); font-style: italic; }
.budget-status { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; }
.budget-status-on-track { color: var(--viz-text-secondary); }
.budget-status-covered { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.budget-status-over { color: var(--warn); background: color-mix(in srgb, var(--warn) 15%, transparent); font-weight: 600; }
.budgets-table input[type="number"] { width: 100px; font: inherit; font-size: 13px; padding: 4px 6px; border: 1px solid var(--line); border-radius: 5px; background: var(--viz-surface); color: var(--viz-text-primary); }
.budgets-table button { padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--viz-surface); color: var(--viz-text-primary); cursor: pointer; font: inherit; font-size: 12px; }
.budgets-table tbody tr[data-budget-category] { cursor: pointer; }
.budgets-table tbody tr[data-budget-category]:hover { background: var(--line); }
```

- [ ] **Step 6: Run the full suite**

Run: `node --test 'tests/**/*.test.js'`
Expected: PASS, every test in the repository — this also re-runs `tests/module-graph.test.js`, which walks the real browser module graph from `/app.js` over HTTP and will independently confirm `budgets-view.js`, `lib/budgets.js`, and every import between them actually resolve (this is exactly the class of bug — a 404 on a module the browser needs but Node's test runner never notices — that test exists to catch).

- [ ] **Step 7: Commit**

```bash
git add web/api.js web/budgets-view.js web/app.js web/index.html web/style.css
git commit -m "feat: wire the Budgets tab into the app"
```

---

## Final Verification

- [ ] Run the entire suite once more: `node --test 'tests/**/*.test.js'` — confirm the pass count increased by the number of tests added across all five tasks and nothing regressed.
- [ ] Start the server (`npm start`) and manually verify: the Budgets tab lists every category, grouped; setting a $500 Travel budget and importing/having a $200 spend shows "on track"; a month with no spend still shows the full allocation rolled into Available the next time you check; editing the amount takes effect for the current month immediately (not "next month"); clicking a budgeted category's row opens its transactions for the current month, and re-categorising one there updates the Budgets tab; the drill-down panel here has **no** Hide checkbox (confirm this specifically — it's the one thing most likely to have leaked from the Overview's version if the `hideable` flag was wired backwards).
