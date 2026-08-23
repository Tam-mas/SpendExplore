# SpendExplore Plan 3a — Review Queue

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the "Needs review" pile in a couple of minutes a month — one keyboard-driven decision per merchant, with an optional copy-paste round trip to Claude for the ones you genuinely can't place.

**Architecture:** One new pure module (`lib/review.js`) that turns a snapshot into a merchant-grouped work queue with ranked category suggestions; one new bulk endpoint; one new UI tab. Follows the existing seams — the UI never touches a transaction record except through the API.

**Tech Stack:** Node.js 23, ES modules, `node:test`. **Zero npm dependencies.** No build step.

## Prerequisite state (Plans 1 and 2 complete — 375 tests green, merged to `main`)

- `lib/query/*` — pure query engine. `lib/ingest.js`, `lib/categorise.js`, `lib/merchant-normalise.js` etc.
- `server/store.js` → `createStore(dataDir)` → `{ read, write, init, backup, dataDir }`
- `server/mutation-gate.js` → `createMutationGate()` returning a `run(fn)` that serialises mutating handlers
- `server/routes.js` → `createRouter(store)` dispatcher; `server/routes/import.js`, `server/routes/transactions.js`
- `server/http.js` → `sendJson`, `readBody`, `UserFacingError`
- `PATCH /api/transactions/:id` accepts `{ categoryId?, excluded?, note?, applyToPast?, rememberRule? }` and returns `{ transaction, updatedPast, ruleAdded }`
- `POST /api/categories` accepts `{ id, label, groupId }`
- `web/` — `app.js`, `api.js`, `import-view.js`, `overview-view.js`, `panel.js`, `filter-bar.js`, `charts/*`
- `categorySource` ∈ `'rule' | 'manual' | 'ai' | 'unknown' | 'bulk'`
- A transaction: `{ id, date, amount, rawDescription, merchant, accountId, cardSuffix, categoryId, categorySource, excluded, importId, note }`

## Global Constraints

- ESM only (`import`/`export`), never `require`. **Zero npm dependencies.** Never run `npm install`.
- **No outbound network requests, no CDN links, no external fonts.** `tests/smoke.test.js` and the module-graph test assert this and must keep passing.
- `lib/review.js` is PURE: no DOM, no I/O, no global state, no `Date.now()`.
- Untrusted strings (merchant names from bank descriptions, user-authored category labels) must be escaped with `escapeHtml` from `web/charts/scale.js` before interpolation.
- **History is never rewritten silently.** `applyToPast` defaults OFF; `rememberRule` defaults ON in the UI but the server never assumes either.
- **A `manual` transaction is never overwritten** by a bulk apply.
- All mutating endpoints go through the shared mutation gate and back up before writing.
- Commit messages MUST NOT contain `Co-Authored-By` trailers.
- Every task adds a `CHANGELOG.md` entry at the TOP: `### [YYYY-MM-DD HH:MM] Type` then `**Tech:**` (backticked file/function), `**Dev:**` (**2–4 sentences, each under ~25 words**), `**Plain:**` (one sentence, no jargon), `**Why:**` (conversational).
- Test command is `node --test 'tests/**/*.test.js'` (`npm test`). `node --test <directory>` is broken on Node v23.11.0 — use explicit file paths for focused runs.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/review.js` | Snapshot → merchant-grouped review queue with ranked suggestions |
| `server/routes/transactions.js` | *(modify)* add `POST /api/transactions/bulk` |
| `web/api.js` | *(modify)* add `bulkCategorise`, `patchTransaction`, `createCategory` wrappers |
| `web/review-view.js` | The keyboard-driven queue UI, plus the Claude copy/paste round trip |
| `web/index.html`, `web/app.js`, `web/style.css` | *(modify)* wire the Review tab |
| `tests/review.test.js`, `tests/bulk-routes.test.js`, `tests/review-view.test.js` | Tests |

---

## Task 1: The review queue model

**Files:**
- Create: `lib/review.js`
- Test: `tests/review.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `buildQueue(snapshot) → { items, totalRows, totalMerchants }`
    where `items` is `[{ merchant, rows, ids, count, total, dateFrom, dateTo, sampleDescription, suggestions }]`, biggest absolute spend first
  - `suggestCategories(merchant, snapshot, limit = 9) → categoryId[]`
  - `promptForClaude(queue, snapshot) → string`
  - `parseClaudeResponse(text, snapshot) → { assignments, errors }`
    where `assignments` is `[{ merchant, categoryId }]`

**Why merchant-grouped:** the user's real ledger has 10 uncategorised rows across 7 merchants — three of them are the same coffee shop. Deciding once per merchant is the whole point.

**Suggestion ranking, in order:** categories the user has assigned by hand before (most-used first), then categories already in use anywhere in the ledger by frequency, then any remaining categories in taxonomy order. Never `income`, never `uncategorised`. Capped at `limit` so they fit on keys `1`–`9`.

- [ ] **Step 1: Write the failing test**

Create `tests/review.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQueue, suggestCategories, promptForClaude, parseClaudeResponse } from '../lib/review.js';

const CATEGORIES = {
  groups: [
    { id: 'food-drink', label: 'Food & Drink' },
    { id: 'transport', label: 'Transport' },
    { id: 'other', label: 'Other' }
  ],
  categories: [
    { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
    { id: 'coffee', label: 'Coffee', groupId: 'food-drink' },
    { id: 'takeaway', label: 'Takeaway', groupId: 'food-drink' },
    { id: 'fuel', label: 'Fuel', groupId: 'transport' },
    { id: 'uncategorised', label: 'Uncategorised', groupId: 'other' },
    { id: 'income', label: 'Income', groupId: 'other' }
  ]
};

const t = (over) => ({
  id: 'x', date: '2026-08-10', amount: -10, rawDescription: 'RAW', merchant: 'M',
  accountId: 'a', cardSuffix: null, categoryId: 'groceries', categorySource: 'rule',
  excluded: false, importId: 'i', note: null, ...over
});

const SNAPSHOT = {
  categories: CATEGORIES,
  transactions: [
    t({ id: '1', merchant: 'Coles', categoryId: 'groceries', categorySource: 'rule' }),
    t({ id: '2', merchant: 'Coles', categoryId: 'groceries', categorySource: 'rule' }),
    t({ id: '3', merchant: 'Bean Bar', categoryId: 'coffee', categorySource: 'manual' }),
    t({ id: 'u1', date: '2026-08-05', amount: -16.77, merchant: 'Good Heavens', categoryId: 'uncategorised', categorySource: 'unknown', rawDescription: 'Good Heavens Melbourne AU' }),
    t({ id: 'u2', date: '2026-08-12', amount: -19.31, merchant: 'Good Heavens', categoryId: 'uncategorised', categorySource: 'unknown' }),
    t({ id: 'u3', date: '2026-08-14', amount: -37.61, merchant: 'Good Heavens', categoryId: 'uncategorised', categorySource: 'unknown' }),
    t({ id: 'u4', date: '2026-08-06', amount: -59.99, merchant: 'Arctel', categoryId: 'uncategorised', categorySource: 'unknown' }),
    t({ id: 'u5', date: '2026-08-08', amount: -7.11, merchant: 'Ember Eats', categoryId: 'uncategorised', categorySource: 'unknown' }),
    t({ id: 'x1', merchant: 'Ghost', categoryId: 'uncategorised', categorySource: 'unknown', excluded: true })
  ]
};

test('groups uncategorised rows by merchant', () => {
  const q = buildQueue(SNAPSHOT);
  assert.equal(q.totalRows, 5);
  assert.equal(q.totalMerchants, 3);
  assert.deepEqual(q.items.map((i) => i.merchant), ['Good Heavens', 'Arctel', 'Ember Eats']);
});

test('orders by absolute spend, biggest decision first', () => {
  const q = buildQueue(SNAPSHOT);
  assert.equal(q.items[0].total, -73.69);
  assert.equal(q.items[0].count, 3);
});

test('each item carries every id it would apply to', () => {
  const item = buildQueue(SNAPSHOT).items[0];
  assert.deepEqual([...item.ids].sort(), ['u1', 'u2', 'u3']);
});

test('each item carries its date span and a sample raw description', () => {
  const item = buildQueue(SNAPSHOT).items[0];
  assert.equal(item.dateFrom, '2026-08-05');
  assert.equal(item.dateTo, '2026-08-14');
  assert.equal(item.sampleDescription, 'Good Heavens Melbourne AU');
});

test('excluded rows never enter the queue', () => {
  assert.ok(!buildQueue(SNAPSHOT).items.some((i) => i.merchant === 'Ghost'));
});

test('an already-clean ledger produces an empty queue, not an error', () => {
  const clean = { ...SNAPSHOT, transactions: [t({ categorySource: 'rule' })] };
  const q = buildQueue(clean);
  assert.deepEqual(q.items, []);
  assert.equal(q.totalRows, 0);
});

test('suggestions put hand-picked categories first', () => {
  const s = suggestCategories('Anything', SNAPSHOT);
  assert.equal(s[0], 'coffee', 'the only manual choice should lead');
});

test('suggestions never offer income or uncategorised', () => {
  const s = suggestCategories('Anything', SNAPSHOT);
  assert.ok(!s.includes('income'));
  assert.ok(!s.includes('uncategorised'));
});

test('suggestions are capped so they fit on the number keys', () => {
  assert.ok(suggestCategories('Anything', SNAPSHOT, 9).length <= 9);
});

test('suggestions still return something for an empty ledger', () => {
  const bare = { categories: CATEGORIES, transactions: [] };
  const s = suggestCategories('Anything', bare);
  assert.ok(s.length > 0);
  assert.ok(!s.includes('uncategorised'));
});

test('the Claude prompt lists every unresolved merchant and the valid category ids', () => {
  const p = promptForClaude(buildQueue(SNAPSHOT), SNAPSHOT);
  for (const m of ['Good Heavens', 'Arctel', 'Ember Eats']) assert.ok(p.includes(m), m);
  for (const c of ['groceries', 'coffee', 'takeaway', 'fuel']) assert.ok(p.includes(c), c);
  assert.ok(!p.includes('income'), 'income is not a spend category to assign');
});

test('the Claude prompt asks for JSON and shows the exact shape', () => {
  const p = promptForClaude(buildQueue(SNAPSHOT), SNAPSHOT);
  assert.match(p, /JSON/);
  assert.match(p, /"merchant"/);
  assert.match(p, /"categoryId"/);
});

test('the Claude prompt carries no amounts or dates — only merchant names', () => {
  const p = promptForClaude(buildQueue(SNAPSHOT), SNAPSHOT);
  assert.doesNotMatch(p, /-?\d+\.\d\d/);
  assert.doesNotMatch(p, /2026-08/);
});

test('parses a clean JSON response', () => {
  const { assignments, errors } = parseClaudeResponse(
    '[{"merchant":"Arctel","categoryId":"fuel"}]', SNAPSHOT);
  assert.deepEqual(assignments, [{ merchant: 'Arctel', categoryId: 'fuel' }]);
  assert.deepEqual(errors, []);
});

test('parses JSON wrapped in a markdown fence', () => {
  const text = 'Sure:\n```json\n[{"merchant":"Arctel","categoryId":"fuel"}]\n```\nHope that helps.';
  const { assignments, errors } = parseClaudeResponse(text, SNAPSHOT);
  assert.equal(assignments.length, 1);
  assert.deepEqual(errors, []);
});

test('rejects an unknown category id rather than writing it', () => {
  const { assignments, errors } = parseClaudeResponse(
    '[{"merchant":"Arctel","categoryId":"not-real"}]', SNAPSHOT);
  assert.deepEqual(assignments, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not-real/);
});

test('rejects unparseable text with a readable error', () => {
  const { assignments, errors } = parseClaudeResponse('I think Arctel is a phone bill', SNAPSHOT);
  assert.deepEqual(assignments, []);
  assert.match(errors[0], /could not|JSON/i);
});

test('a non-array payload is rejected', () => {
  const { errors } = parseClaudeResponse('{"merchant":"Arctel","categoryId":"fuel"}', SNAPSHOT);
  assert.equal(errors.length, 1);
});

test('malformed entries are skipped individually, good ones still applied', () => {
  const { assignments, errors } = parseClaudeResponse(
    '[{"merchant":"Arctel","categoryId":"fuel"},{"categoryId":"coffee"},{"merchant":"Ember Eats","categoryId":"takeaway"}]',
    SNAPSHOT);
  assert.equal(assignments.length, 2);
  assert.equal(errors.length, 1);
});

test('buildQueue does not mutate the snapshot', () => {
  const before = JSON.stringify(SNAPSHOT);
  buildQueue(SNAPSHOT);
  assert.equal(JSON.stringify(SNAPSHOT), before);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review.test.js`
Expected: FAIL — `Cannot find module '../lib/review.js'`

- [ ] **Step 3: Write minimal implementation**

Create `lib/review.js`:

```js
const NON_ASSIGNABLE = new Set(['uncategorised', 'income']);

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Turn a snapshot into a merchant-grouped work queue.
 *
 * Grouping by merchant is the point: three coffees from the same shop are one
 * decision, not three. Biggest absolute spend leads, so the decisions that
 * move the totals most come first.
 */
export function buildQueue(snapshot) {
  const transactions = snapshot?.transactions ?? [];
  const unknown = transactions.filter((t) => t.categorySource === 'unknown' && !t.excluded);

  const byMerchant = new Map();
  for (const txn of unknown) {
    let item = byMerchant.get(txn.merchant);
    if (!item) {
      item = { merchant: txn.merchant, ids: [], count: 0, total: 0, dates: [], sampleDescription: '' };
      byMerchant.set(txn.merchant, item);
    }
    item.ids.push(txn.id);
    item.count += 1;
    item.total += txn.amount;
    item.dates.push(txn.date);
    if (!item.sampleDescription) item.sampleDescription = txn.rawDescription ?? '';
  }

  const items = [...byMerchant.values()]
    .map((item) => {
      const dates = [...item.dates].sort();
      return {
        merchant: item.merchant,
        ids: item.ids,
        count: item.count,
        total: round2(item.total),
        dateFrom: dates[0] ?? null,
        dateTo: dates[dates.length - 1] ?? null,
        sampleDescription: item.sampleDescription,
        suggestions: suggestCategories(item.merchant, snapshot)
      };
    })
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  return { items, totalRows: unknown.length, totalMerchants: items.length };
}

/**
 * Rank category ids for the number keys.
 *
 * Categories the user has already chosen BY HAND lead — those are the ones
 * they reach for. Then whatever else the ledger already uses, by frequency.
 * Then the rest of the taxonomy, so every category stays reachable.
 */
export function suggestCategories(merchant, snapshot, limit = 9) {
  const transactions = snapshot?.transactions ?? [];
  const all = (snapshot?.categories?.categories ?? [])
    .map((c) => c.id)
    .filter((id) => !NON_ASSIGNABLE.has(id));

  const tally = (predicate) => {
    const counts = new Map();
    for (const txn of transactions) {
      if (!predicate(txn)) continue;
      if (NON_ASSIGNABLE.has(txn.categoryId)) continue;
      counts.set(txn.categoryId, (counts.get(txn.categoryId) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  };

  const handPicked = tally((t) => t.categorySource === 'manual' || t.categorySource === 'bulk');
  const everUsed = tally(() => true);

  const ordered = [];
  for (const id of [...handPicked, ...everUsed, ...all]) {
    if (!ordered.includes(id) && all.includes(id)) ordered.push(id);
  }
  return ordered.slice(0, limit);
}

/**
 * A prompt the user can paste into a Claude conversation.
 *
 * Deliberately carries ONLY merchant names — no amounts, no dates, no account
 * details. The user is pasting this into a chat window, so it should reveal as
 * little about their finances as it possibly can while still being useful.
 */
export function promptForClaude(queue, snapshot) {
  const categories = (snapshot?.categories?.categories ?? []).filter((c) => !NON_ASSIGNABLE.has(c.id));
  const groups = new Map((snapshot?.categories?.groups ?? []).map((g) => [g.id, g.label]));

  const categoryList = categories
    .map((c) => `  ${c.id}  —  ${c.label} (${groups.get(c.groupId) ?? c.groupId})`)
    .join('\n');

  const merchantList = queue.items.map((i) => `  ${i.merchant}`).join('\n');

  return `I have some bank transaction merchant names I need sorted into spending categories.

Merchants:
${merchantList}

Valid category ids — use these exactly:
${categoryList}

Reply with ONLY a JSON array, no commentary, in exactly this shape:

[
  { "merchant": "Example Merchant", "categoryId": "groceries" }
]

Include every merchant listed. If you genuinely cannot tell what a merchant is, omit it rather than guessing.`;
}

/** Pull a JSON array out of a reply that may be wrapped in prose or a code fence. */
function extractJsonArray(text) {
  const trimmed = String(text ?? '').trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Validate a pasted reply before any of it reaches the ledger.
 *
 * Every categoryId is checked against the real taxonomy — a hallucinated
 * category is reported, never written. Bad entries are skipped individually so
 * one mistake does not throw away the whole batch.
 */
export function parseClaudeResponse(text, snapshot) {
  const valid = new Set((snapshot?.categories?.categories ?? []).map((c) => c.id));
  const parsed = extractJsonArray(text);

  if (parsed === null) {
    return { assignments: [], errors: ['Could not find a JSON array in that text. Paste just the JSON array Claude replied with.'] };
  }
  if (!Array.isArray(parsed)) {
    return { assignments: [], errors: ['That JSON is not an array. Expected a list of { "merchant", "categoryId" } objects.'] };
  }

  const assignments = [];
  const errors = [];
  for (const entry of parsed) {
    if (!entry || typeof entry.merchant !== 'string' || typeof entry.categoryId !== 'string') {
      errors.push(`Skipped an entry missing "merchant" or "categoryId": ${JSON.stringify(entry)}`);
      continue;
    }
    if (NON_ASSIGNABLE.has(entry.categoryId) || !valid.has(entry.categoryId)) {
      errors.push(`Skipped "${entry.merchant}" — "${entry.categoryId}" is not a category in this ledger.`);
      continue;
    }
    assignments.push({ merchant: entry.merchant, categoryId: entry.categoryId });
  }
  return { assignments, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/review.test.js`
Expected: PASS — `# pass 19`

Then `npm test` — all 375 existing tests must still pass.

- [ ] **Step 5: Verify against the real ledger**

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { buildQueue, promptForClaude } from './lib/review.js';
const snap = {
  transactions: JSON.parse(readFileSync('./data/ledger.json','utf8')),
  categories: JSON.parse(readFileSync('./data/categories.json','utf8'))
};
const q = buildQueue(snap);
console.log(q.totalRows, 'rows ->', q.totalMerchants, 'decisions');
for (const i of q.items) console.log(' ', i.merchant, i.total, i.count + ' txns', '| suggests:', i.suggestions.slice(0,4).join(', '));
console.log('--- prompt preview ---');
console.log(promptForClaude(q, snap).slice(0, 400));
"
```

Expected: `10 rows -> 7 decisions`, led by Good Heavens at `-73.69`. Record the real output in your report.

- [ ] **Step 6: Commit**

```bash
git add lib/review.js tests/review.test.js CHANGELOG.md
git commit -m "feat: add merchant-grouped review queue model with ranked suggestions"
```

---

## Task 2: Bulk categorisation endpoint

**Files:**
- Modify: `server/routes/transactions.js`
- Test: `tests/bulk-routes.test.js`

**Interfaces:**
- Consumes: `store`, the shared mutation gate
- Produces: `POST /api/transactions/bulk` — body `{ ids: string[], categoryId, rememberRule?, applyToPast? }` → `{ updated, ruleAdded, skippedManual }`

Assigning a category to one merchant's whole group is the queue's core action, and doing it as N separate PATCH calls would be N backups and N round trips.

Semantics, matching the existing PATCH exactly:
- Every id in `ids` is set to `categoryId` with `categorySource: 'manual'` — these are explicit user decisions.
- `rememberRule: true` saves one `exact` rule for the merchant of the **first** supplied id, at the head of the rules list, replacing any existing exact rule for that merchant.
- `applyToPast: true` additionally updates other transactions of that same merchant, marking them `'bulk'`, **never** touching rows already marked `'manual'`.
- The merchant `'Unknown'` is never groupable — `rememberRule` and `applyToPast` are refused for it, exactly as PATCH already does.
- Backup before writing; run inside the shared mutation gate.

- [ ] **Step 1: Write the failing test**

Create `tests/bulk-routes.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';

const CSV = [
  '05/08/2026,"GOOD HEAVENS MELBOURNE AU","acct","cat","-16.77"',
  '12/08/2026,"GOOD HEAVENS MELBOURNE AU","acct","cat","-19.31"',
  '14/08/2026,"GOOD HEAVENS MELBOURNE AU","acct","cat","-37.61"',
  '06/08/2026,"ARCTEL PTY LTD BELLA VISTA AU","acct","cat","-59.99"'
].join('\n');

const withImported = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'se-bulk-'));
  const app = await startServer({ port: 0, dataDir: dir });
  const base = `http://127.0.0.1:${app.port}`;
  await fetch(`${base}/api/import/commit`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files: [{ filename: 'a.csv', text: CSV }] })
  });
  try { await fn(base, app.store, dir); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
};

const bulk = (base, body) =>
  fetch(`${base}/api/transactions/bulk`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });

const idsFor = async (store, merchant) =>
  (await store.read('ledger')).filter((t) => t.merchant === merchant).map((t) => t.id);

test('assigns a category to every supplied id', async () => {
  await withImported(async (base, store) => {
    const ids = await idsFor(store, 'Good Heavens');
    const body = await (await bulk(base, { ids, categoryId: 'coffee' })).json();
    assert.equal(body.updated, 3);
    const after = (await store.read('ledger')).filter((t) => t.merchant === 'Good Heavens');
    assert.ok(after.every((t) => t.categoryId === 'coffee'));
    assert.ok(after.every((t) => t.categorySource === 'manual'));
  });
});

test('leaves other merchants alone', async () => {
  await withImported(async (base, store) => {
    await bulk(base, { ids: await idsFor(store, 'Good Heavens'), categoryId: 'coffee' });
    const arctel = (await store.read('ledger')).find((t) => t.merchant.startsWith('Arctel'));
    assert.equal(arctel.categoryId, 'uncategorised');
  });
});

test('rememberRule saves one exact rule at the head', async () => {
  await withImported(async (base, store) => {
    const body = await (await bulk(base, {
      ids: await idsFor(store, 'Good Heavens'), categoryId: 'coffee', rememberRule: true
    })).json();
    assert.equal(body.ruleAdded, true);
    const rules = await store.read('rules');
    assert.deepEqual(rules[0], { match: 'exact', value: 'good heavens', categoryId: 'coffee' });
  });
});

test('re-running replaces the rule rather than accumulating duplicates', async () => {
  await withImported(async (base, store) => {
    const ids = await idsFor(store, 'Good Heavens');
    await bulk(base, { ids, categoryId: 'coffee', rememberRule: true });
    await bulk(base, { ids, categoryId: 'takeaway', rememberRule: true });
    const rules = await store.read('rules');
    assert.equal(rules.filter((r) => r.value === 'good heavens').length, 1);
    assert.equal(rules[0].categoryId, 'takeaway');
  });
});

test('a saved rule categorises a later import automatically', async () => {
  await withImported(async (base, store) => {
    await bulk(base, {
      ids: await idsFor(store, 'Good Heavens'), categoryId: 'coffee', rememberRule: true
    });
    const res = await fetch(`${base}/api/import/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files: [{ filename: 'b.csv', text: '01/09/2026,"GOOD HEAVENS MELBOURNE AU","acct","cat","-8.00"' }] })
    });
    const preview = (await res.json()).previews[0];
    assert.equal(preview.sampleTransactions[0].categoryId, 'coffee');
    assert.equal(preview.summary.needsReview, 0);
  });
});

test('takes a backup before writing', async () => {
  await withImported(async (base, store, dir) => {
    const { readdir } = await import('node:fs/promises');
    const before = (await readdir(join(dir, 'backups'))).length;
    await bulk(base, { ids: await idsFor(store, 'Good Heavens'), categoryId: 'coffee' });
    assert.ok((await readdir(join(dir, 'backups'))).length > before);
  });
});

test('rejects an unknown category with 400', async () => {
  await withImported(async (base, store) => {
    const res = await bulk(base, { ids: await idsFor(store, 'Good Heavens'), categoryId: 'nope' });
    assert.equal(res.status, 400);
  });
});

test('rejects a malformed body with 400, never 500', async () => {
  await withImported(async (base) => {
    for (const body of [{}, { ids: 'x', categoryId: 'coffee' }, { ids: [], categoryId: 'coffee' }, { ids: [1], categoryId: 'coffee' }]) {
      assert.equal((await bulk(base, body)).status, 400, JSON.stringify(body));
    }
    const res = await fetch(`${base}/api/transactions/bulk`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ broken'
    });
    assert.equal(res.status, 400);
  });
});

test('an unknown id is reported, not silently ignored', async () => {
  await withImported(async (base, store) => {
    const ids = await idsFor(store, 'Good Heavens');
    const body = await (await bulk(base, { ids: [...ids, 'deadbeefdeadbeef'], categoryId: 'coffee' })).json();
    assert.equal(body.updated, 3);
    assert.equal(body.notFound, 1);
  });
});

test('two concurrent bulk calls both land', async () => {
  await withImported(async (base, store) => {
    const gh = await idsFor(store, 'Good Heavens');
    const arctel = (await store.read('ledger')).filter((t) => t.merchant.startsWith('Arctel')).map((t) => t.id);
    const [a, b] = await Promise.all([
      bulk(base, { ids: gh, categoryId: 'coffee' }),
      bulk(base, { ids: arctel, categoryId: 'internet-phone' })
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const ledger = await store.read('ledger');
    assert.ok(ledger.filter((t) => t.merchant === 'Good Heavens').every((t) => t.categoryId === 'coffee'));
    assert.ok(ledger.filter((t) => t.merchant.startsWith('Arctel')).every((t) => t.categoryId === 'internet-phone'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bulk-routes.test.js`
Expected: FAIL — 404 responses; `body.updated` undefined

- [ ] **Step 3: Write minimal implementation**

In `server/routes/transactions.js`, add a handler alongside the existing PATCH. Follow the file's existing conventions for reading the body, validating, backing up and running inside the gate. Insert this route check before the module's final "not found" fallback:

```js
    if (req.method === 'POST' && pathname === '/api/transactions/bulk') {
      return gate.run(async () => {
        const body = await readBody(req);
        const ids = body?.ids;
        const categoryId = body?.categoryId;

        if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
          return sendJson(res, 400, { error: 'ids must be a non-empty array of transaction ids' });
        }
        if (typeof categoryId !== 'string') {
          return sendJson(res, 400, { error: 'categoryId is required' });
        }

        const { categories } = await store.read('categories');
        if (!categories.some((c) => c.id === categoryId)) {
          return sendJson(res, 400, { error: `Unknown category: ${categoryId}` });
        }

        const ledger = await store.read('ledger');
        const wanted = new Set(ids);
        const next = [...ledger];
        let updated = 0;

        for (let i = 0; i < next.length; i++) {
          if (!wanted.has(next[i].id)) continue;
          // An explicit selection is a hand decision, so it is 'manual'.
          next[i] = { ...next[i], categoryId, categorySource: 'manual' };
          updated++;
        }
        const notFound = ids.length - updated;

        // The merchant to group on comes from the first id that actually exists.
        const anchor = next.find((t) => wanted.has(t.id));
        const merchant = anchor?.merchant ?? '';
        // 'Unknown' is a placeholder for undecipherable descriptions, not a real
        // merchant — grouping on it would sweep unrelated transactions together.
        const canGroup = Boolean(merchant) && merchant !== 'Unknown';

        let updatedPast = 0;
        if (body?.applyToPast === true && canGroup) {
          for (let i = 0; i < next.length; i++) {
            const txn = next[i];
            if (wanted.has(txn.id) || txn.merchant !== merchant) continue;
            if (txn.categorySource === 'manual') continue;   // never overwrite a hand decision
            next[i] = { ...txn, categoryId, categorySource: 'bulk' };
            updatedPast++;
          }
        }

        if (updated > 0 || updatedPast > 0) {
          await store.backup();
          await store.write('ledger', next);
        }

        let ruleAdded = false;
        if (body?.rememberRule === true && canGroup) {
          const value = merchant.toLowerCase().trim();
          const rules = await store.read('rules');
          const without = rules.filter((r) => !(r.match === 'exact' && r.value === value));
          await store.write('rules', [{ match: 'exact', value, categoryId }, ...without]);
          ruleAdded = true;
        }

        return sendJson(res, 200, { updated, updatedPast, notFound, ruleAdded });
      });
    }
```

Read the surrounding file first — reuse its existing imports (`sendJson`, `readBody`) and its gate variable name rather than inventing new ones.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bulk-routes.test.js`
Expected: PASS — `# pass 10`

Then `npm test` — everything green.

- [ ] **Step 5: Commit**

```bash
git add server/routes/transactions.js tests/bulk-routes.test.js CHANGELOG.md
git commit -m "feat: add bulk categorisation endpoint for the review queue"
```

---

## Task 3: The review queue UI

**Files:**
- Create: `web/review-view.js`
- Modify: `web/api.js`, `web/index.html`, `web/app.js`, `web/style.css`
- Test: `tests/review-view.test.js`

**Interfaces:**
- Consumes: `buildQueue`, `suggestCategories`, `promptForClaude`, `parseClaudeResponse` (`lib/review.js`); `escapeHtml` (`web/charts/scale.js`)
- Produces:
  - `renderReview(snapshot, state) → string` (pure — testable with no DOM)
  - `mountReview(root, { snapshot, onChanged })`
  - `web/api.js` gains `bulkCategorise(payload)`, `patchTransaction(id, payload)`, `createCategory(payload)`

`state` = `{ index, pasteError, pasteResult }`.

The queue shows **one merchant at a time**, biggest decision first, with its transaction count, total, date span and a sample raw description so the user can tell what it actually was.

Keyboard: `1`–`9` assign a suggested category · `/` focus the search-all box · `n` create a new category · `x` exclude the whole group · `s` skip · `←`/`→` move between items.

Every assignment sends one bulk call with `rememberRule: true` (so future imports learn) and `applyToPast: false` (so history is never rewritten silently).

- [ ] **Step 1: Write the failing test**

Create `tests/review-view.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReview } from '../web/review-view.js';

const SNAPSHOT = {
  categories: {
    groups: [{ id: 'food-drink', label: 'Food & Drink' }, { id: 'other', label: 'Other' }],
    categories: [
      { id: 'coffee', label: 'Coffee', groupId: 'food-drink' },
      { id: 'takeaway', label: 'Takeaway', groupId: 'food-drink' },
      { id: 'uncategorised', label: 'Uncategorised', groupId: 'other' },
      { id: 'income', label: 'Income', groupId: 'other' }
    ]
  },
  transactions: [
    { id: 'u1', date: '2026-08-05', amount: -16.77, merchant: 'Good Heavens', rawDescription: 'GOOD HEAVENS MELBOURNE AU', categoryId: 'uncategorised', categorySource: 'unknown', excluded: false },
    { id: 'u2', date: '2026-08-14', amount: -37.61, merchant: 'Good Heavens', rawDescription: 'GOOD HEAVENS MELBOURNE AU', categoryId: 'uncategorised', categorySource: 'unknown', excluded: false },
    { id: 'u3', date: '2026-08-06', amount: -59.99, merchant: 'Arctel', rawDescription: 'ARCTEL PTY LTD', categoryId: 'uncategorised', categorySource: 'unknown', excluded: false }
  ]
};

const state = { index: 0 };

test('shows progress through the queue', () => {
  const html = renderReview(SNAPSHOT, state);
  assert.match(html, /1\s*(of|\/)\s*2/i);
});

test('leads with the biggest decision', () => {
  assert.match(renderReview(SNAPSHOT, state), /Arctel/);
});

test('shows the transaction count, total and date span for the group', () => {
  const html = renderReview(SNAPSHOT, { index: 1 });
  assert.match(html, /Good Heavens/);
  assert.match(html, /2/);
  assert.match(html, /-\$54\.38/);
  assert.match(html, /2026-08-05/);
});

test('shows the raw bank description so the user can tell what it was', () => {
  assert.match(renderReview(SNAPSHOT, { index: 1 }), /GOOD HEAVENS MELBOURNE AU/);
});

test('offers numbered category shortcuts', () => {
  const html = renderReview(SNAPSHOT, state);
  assert.match(html, /data-assign="coffee"/);
  assert.match(html, /data-key="1"/);
});

test('never offers income or uncategorised as a shortcut', () => {
  const html = renderReview(SNAPSHOT, state);
  assert.doesNotMatch(html, /data-assign="income"/);
  assert.doesNotMatch(html, /data-assign="uncategorised"/);
});

test('offers search, new category, exclude and skip', () => {
  const html = renderReview(SNAPSHOT, state);
  for (const action of ['search', 'new-category', 'exclude', 'skip']) {
    assert.match(html, new RegExp(`data-review-action="${action}"`), action);
  }
});

test('offers the Claude copy and paste controls', () => {
  const html = renderReview(SNAPSHOT, state);
  assert.match(html, /data-review-action="copy-prompt"/);
  assert.match(html, /data-review-action="apply-paste"/);
});

test('an empty queue shows a done state, not a broken card', () => {
  const clean = { ...SNAPSHOT, transactions: [] };
  const html = renderReview(clean, state);
  assert.match(html, /nothing to review|all caught up/i);
  assert.doesNotMatch(html, /data-assign=/);
});

test('an index past the end shows the done state rather than crashing', () => {
  assert.match(renderReview(SNAPSHOT, { index: 99 }), /nothing to review|all caught up/i);
});

test('escapes merchant names and raw descriptions', () => {
  const nasty = {
    ...SNAPSHOT,
    transactions: [{ ...SNAPSHOT.transactions[0], merchant: '<img src=x>', rawDescription: '<script>x</script>' }]
  };
  const html = renderReview(nasty, state);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;img/);
});

test('shows paste errors when present', () => {
  const html = renderReview(SNAPSHOT, { index: 0, pasteError: 'Could not find a JSON array' });
  assert.match(html, /Could not find a JSON array/);
});

test('references no external host', () => {
  assert.doesNotMatch(renderReview(SNAPSHOT, state), /https?:\/\/(?!127\.0\.0\.1|localhost)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-view.test.js`
Expected: FAIL — `Cannot find module '../web/review-view.js'`

- [ ] **Step 3: Write minimal implementation**

Add to `web/api.js`:

```js
export const patchTransaction = (id, payload) =>
  request(`/api/transactions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

export const bulkCategorise = (payload) => postJson('/api/transactions/bulk', payload);
export const createCategory  = (payload) => postJson('/api/categories', payload);
```

Create `web/review-view.js`:

```js
import { buildQueue, promptForClaude, parseClaudeResponse } from '../lib/review.js';
import { escapeHtml, formatMoney } from './charts/scale.js';
import { bulkCategorise, patchTransaction, createCategory, getSnapshot } from './api.js';

const labelFor = (snapshot, id) =>
  (snapshot?.categories?.categories ?? []).find((c) => c.id === id)?.label ?? id;

const assignableCategories = (snapshot) =>
  (snapshot?.categories?.categories ?? []).filter((c) => c.id !== 'income' && c.id !== 'uncategorised');

/**
 * Render the queue. Pure — snapshot and state in, markup out — so it is
 * testable in Node with no DOM.
 */
export function renderReview(snapshot, state = {}) {
  const queue = buildQueue(snapshot);
  const index = state.index ?? 0;
  const item = queue.items[index];

  if (!queue.items.length || !item) {
    return `<div class="review-done">
      <h2>All caught up</h2>
      <p class="viz-note">Nothing to review — every transaction has a category.</p>
    </div>`;
  }

  const shortcuts = item.suggestions.map((id, i) => `
    <button class="review-key" data-assign="${escapeHtml(id)}" data-key="${i + 1}">
      <kbd>${i + 1}</kbd> ${escapeHtml(labelFor(snapshot, id))}
    </button>`).join('');

  const options = assignableCategories(snapshot)
    .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`).join('');

  const pasteFeedback = state.pasteError
    ? `<p class="review-error">${escapeHtml(state.pasteError)}</p>`
    : state.pasteResult
      ? `<p class="review-ok">${escapeHtml(state.pasteResult)}</p>`
      : '';

  return `
  <div class="review">
    <header class="review-head">
      <span class="viz-note">${index + 1} of ${queue.items.length} · ${queue.totalRows} transactions to place</span>
    </header>

    <section class="review-card">
      <h2>${escapeHtml(item.merchant)}</h2>
      <p class="review-meta">
        <b>${formatMoney(item.total)}</b> ·
        ${item.count} transaction${item.count === 1 ? '' : 's'} ·
        ${escapeHtml(item.dateFrom ?? '')}${item.dateTo !== item.dateFrom ? ' to ' + escapeHtml(item.dateTo ?? '') : ''}
      </p>
      <p class="review-raw">${escapeHtml(item.sampleDescription)}</p>

      <div class="review-keys">${shortcuts}</div>

      <div class="review-actions">
        <label class="viz-control">
          <span class="viz-control-label">All categories</span>
          <select data-review-action="search">
            <option value="">Choose…</option>
            ${options}
          </select>
        </label>
        <button data-review-action="new-category"><kbd>n</kbd> New category</button>
        <button data-review-action="exclude"><kbd>x</kbd> Exclude</button>
        <button data-review-action="skip"><kbd>s</kbd> Skip</button>
      </div>
      <p class="viz-note">Assigning remembers this merchant for future imports. Past transactions are left alone.</p>
    </section>

    <details class="review-claude">
      <summary>Stuck? Ask Claude</summary>
      <p class="viz-note">Copies the merchant names only — no amounts, dates or account details.</p>
      <button data-review-action="copy-prompt">Copy ${queue.items.length} merchant names for Claude</button>
      <textarea data-review-paste rows="5" placeholder="Paste Claude's JSON reply here"></textarea>
      <button data-review-action="apply-paste">Apply pasted JSON</button>
      ${pasteFeedback}
    </details>
  </div>`;
}

/** Wire the queue to the live DOM. */
export function mountReview(root, { snapshot, onChanged } = {}) {
  let state = { index: 0 };
  let current = snapshot;

  const draw = () => { root.innerHTML = renderReview(current, state); };

  const refresh = async () => {
    current = await getSnapshot();
    if (state.index >= buildQueue(current).items.length) state.index = 0;
    draw();
    onChanged?.(current);
  };

  const currentItem = () => buildQueue(current).items[state.index];

  async function assign(categoryId) {
    const item = currentItem();
    if (!item) return;
    await bulkCategorise({ ids: item.ids, categoryId, rememberRule: true, applyToPast: false });
    state = { index: 0 };
    await refresh();
  }

  async function excludeGroup() {
    const item = currentItem();
    if (!item) return;
    for (const id of item.ids) await patchTransaction(id, { excluded: true });
    state = { index: 0 };
    await refresh();
  }

  root.addEventListener('click', async (event) => {
    const assignTo = event.target.closest('[data-assign]')?.dataset.assign;
    if (assignTo) return assign(assignTo);

    const action = event.target.closest('[data-review-action]')?.dataset.reviewAction;
    if (!action) return;

    if (action === 'skip') {
      state.index += 1;
      draw();
    } else if (action === 'exclude') {
      await excludeGroup();
    } else if (action === 'new-category') {
      const label = prompt('New category name?');
      if (!label) return;
      const groups = current.categories.groups.map((g) => g.label).join(', ');
      const groupLabel = prompt(`Which group? (${groups})`);
      const group = current.categories.groups.find(
        (g) => g.label.toLowerCase() === String(groupLabel).toLowerCase());
      if (!group) return;
      const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      await createCategory({ id, label, groupId: group.id });
      await assign(id);
    } else if (action === 'copy-prompt') {
      const text = promptForClaude(buildQueue(current), current);
      await navigator.clipboard.writeText(text);
      state.pasteResult = 'Copied. Paste it into Claude, then paste the JSON reply below.';
      state.pasteError = null;
      draw();
    } else if (action === 'apply-paste') {
      const text = root.querySelector('[data-review-paste]')?.value ?? '';
      const { assignments, errors } = parseClaudeResponse(text, current);
      if (!assignments.length) {
        state.pasteError = errors[0] ?? 'Nothing to apply.';
        state.pasteResult = null;
        return draw();
      }
      const queue = buildQueue(current);
      let applied = 0;
      for (const { merchant, categoryId } of assignments) {
        const item = queue.items.find((i) => i.merchant === merchant);
        if (!item) continue;
        await bulkCategorise({ ids: item.ids, categoryId, rememberRule: true, applyToPast: false });
        applied++;
      }
      state = { index: 0, pasteResult: `Applied ${applied} of ${assignments.length}.${errors.length ? ' ' + errors.length + ' skipped.' : ''}` };
      await refresh();
    }
  });

  root.addEventListener('change', (event) => {
    if (event.target.dataset?.reviewAction === 'search' && event.target.value) {
      assign(event.target.value);
    }
  });

  // Keyboard shortcuts, ignored while the user is typing into a field.
  const onKey = (event) => {
    if (root.classList.contains('hidden')) return;
    const tag = event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const item = currentItem();
    if (!item) return;

    if (/^[1-9]$/.test(event.key)) {
      const id = item.suggestions[Number(event.key) - 1];
      if (id) { event.preventDefault(); assign(id); }
    } else if (event.key === 's') { state.index += 1; draw(); }
    else if (event.key === 'x') { excludeGroup(); }
    else if (event.key === 'n') { root.querySelector('[data-review-action="new-category"]')?.click(); }
    else if (event.key === '/') { event.preventDefault(); root.querySelector('[data-review-action="search"]')?.focus(); }
    else if (event.key === 'ArrowRight') { state.index += 1; draw(); }
    else if (event.key === 'ArrowLeft') { state.index = Math.max(0, state.index - 1); draw(); }
  };
  document.addEventListener('keydown', onKey);

  draw();
  return { redraw: draw, refresh };
}
```

In `web/index.html`, add the tab button and its view container:

```html
      <button data-tab="review">Review</button>
```
```html
    <section id="view-review" class="view hidden"></section>
```

In `web/app.js`, register the view and mount it:

```js
import { mountReview } from './review-view.js';
```

Add `review: document.querySelector('#view-review')` to the `views` object.

**Mount the review queue ONCE, not inside `refresh()`.** `mountReview` attaches a
`document`-level `keydown` listener, so calling it per refresh would stack a new
listener every time and fire each shortcut repeatedly. Keep a handle and refresh
through it:

```js
let review = null;

async function refresh() {
  const snapshot = await getSnapshot();
  mountOverview(views.overview, { snapshot });
  if (review) await review.refresh();
  else review = mountReview(views.review, { snapshot });
}
```

`mountReview` returns `{ redraw, refresh }`; its `refresh()` re-reads the snapshot
itself, so the queue stays current after an import without re-mounting.

Append to `web/style.css`:

```css
.review { max-width: 640px; }
.review-card { border: 1px solid var(--line); border-radius: 10px; padding: 20px; margin: 12px 0; }
.review-card h2 { margin: 0 0 4px; font-size: 20px; }
.review-meta { margin: 0 0 4px; font-variant-numeric: tabular-nums; }
.review-raw { font-family: ui-monospace, monospace; font-size: 12px; color: var(--viz-text-secondary); word-break: break-all; margin: 0 0 16px; }
.review-keys { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.review-key { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--viz-surface); color: var(--viz-text-primary); cursor: pointer; font: inherit; font-size: 13px; }
.review-key:hover { border-color: var(--accent); }
.review-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 10px; }
.review-actions button { padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--viz-surface); color: var(--viz-text-primary); cursor: pointer; font: inherit; font-size: 13px; }
kbd { font: inherit; font-size: 11px; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px; padding: 1px 5px; }
.review-done { text-align: center; padding: 48px 0; }
.review-claude { margin-top: 20px; border-top: 1px solid var(--line); padding-top: 16px; }
.review-claude summary { cursor: pointer; font-size: 14px; }
.review-claude textarea { width: 100%; margin: 10px 0; font-family: ui-monospace, monospace; font-size: 12px; padding: 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--viz-surface); color: var(--viz-text-primary); }
.review-claude button { padding: 6px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--viz-surface); color: var(--viz-text-primary); cursor: pointer; font: inherit; font-size: 13px; }
.review-error { color: var(--warn); font-size: 13px; }
.review-ok { color: var(--viz-text-secondary); font-size: 13px; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/review-view.test.js`
Expected: PASS — `# pass 13`

Then `npm test` — all existing tests green, including `smoke` and the module-graph test.

- [ ] **Step 5: Verify end-to-end in a real browser**

```bash
npm start
```

Open `http://127.0.0.1:5173`, go to **Review**, and confirm against the real ledger:

- The header reads `1 of 7 · 10 transactions to place`.
- The first card is **Arctel** at `-$59.99`, since it is the biggest single decision after Good Heavens' group total… (check the real order and record it).
- Pressing a number key assigns that category and advances; the Overview's "Needs review" count drops by that group's size.
- `s` skips, `x` excludes the whole group, `/` focuses the category dropdown.
- **Copy for Claude** puts a prompt on the clipboard containing merchant names and no amounts.
- Pasting `[{"merchant":"Arctel","categoryId":"internet-phone"}]` and clicking Apply categorises all its rows.
- Pasting nonsense shows a readable error and changes nothing.

Record what you actually observed. If assigning a category does not reduce the Needs review count, STOP and report.

- [ ] **Step 6: Commit**

```bash
git add web/review-view.js web/api.js web/index.html web/app.js web/style.css tests/review-view.test.js CHANGELOG.md
git commit -m "feat: add keyboard-driven review queue with Claude round trip"
```

---

## Done when

- `npm test` passes — 375 existing plus this plan's additions.
- The Review tab clears your real ledger's 10 uncategorised rows in 7 keystroke-level decisions.
- Assigning a category saves a rule, so a later import of the same merchant needs no review.
- The Claude prompt contains merchant names only — no amounts, dates or account details.
- A pasted reply is validated against the real taxonomy; a hallucinated category is reported, never written.
- History is never rewritten: `applyToPast` stays off in every call the queue makes.
- `CHANGELOG.md` has an entry per task.

## Deliberately NOT in this plan

Trends, Merchants, Recurring and Compare tabs · recurring/subscription detection · saved named views and the panel builder · budgets · Settings UI for card→person mapping and accounts · `csvMapping` persistence per account · drill-down from a chart mark into transactions.
