# Review Navigation, Chart Colour, and Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five features to the existing SpendExplore UI: Back/Forward navigation in Review (with the ability to revisit and change a decision made earlier in the session), category colour on the Dots and Treemap charts, a richer Dots hover tooltip, a session-only "hide this transaction" toggle, and a click-to-drill-down side panel (with inline re-categorise) on every chart that slices the data into buckets.

**Architecture:** No new architectural layers. This plan extends the existing three seams:
- `lib/query/filter.js` gains one new optional filter key (`excludeIds`), additive and backward compatible.
- A new pure function, `lib/query/slice-transactions.js`, is the *second* place (after the Dots chart's amount extraction in `panel.js`) that legitimately reaches past Seam 1's "no records" contract — `query()` itself in `lib/query/query.js` is untouched and still never returns a transaction record.
- The drill-down panel is a new, independent UI component (`web/drilldown-panel.js`, pure render function) wired up by `web/overview-view.js`'s existing `mountOverview`, the same way `panel.js`'s pure `html()` output is already wired up there.

**Tech Stack:** Node.js stdlib only, `node:test` + `node:assert/strict`, vanilla DOM (no framework), hand-rolled SVG charts. No new dependencies.

## Global Constraints

- Zero npm dependencies. Node stdlib only.
- Run tests with `node --test 'tests/**/*.test.js'` (the bare-directory form is broken on this Node version) or explicit file paths — never `node --test tests/`.
- Every new/changed file must have its tests passing before commit; run the *specific* test file(s) touched by a task, not the whole suite, per step — the final task review runs everything.
- `lib/` stays pure: no I/O, no DOM, snapshot/spec in, data out. `web/` owns all DOM wiring.
- `lib/query/query.js` (`query()`, Seam 1) must continue to return **no transaction records** — this plan does not touch that file. The drill-down feature gets records from a *new*, separate function (`transactionsForSlice`), never by changing `query()`'s contract.
- Untrusted strings (merchant names, category/group labels, raw bank descriptions) are escaped with `escapeHtml` from `web/charts/scale.js` before going into any HTML string. This applies to every new template literal that interpolates data from a snapshot.
- Colour tokens come only from `web/charts/palette.js` (`GROUP_SLOTS`, `colourForGroup`, `colourForCategory`, `sequentialColour`) — never invent a new hex value inline.
- The session-only "hide" feature (`excludeIds`) is entirely client-side and resets on page reload. It must never be confused in code or copy with the ledger's persisted `excluded` field (set via the Review tab's Exclude action or a transaction PATCH) — that one is permanent and server-side. Every new UI string referring to the session-only version says "this session" explicitly.
- Match existing code style exactly: no comments explaining *what* code does, only non-obvious *why*; template-literal HTML generation, not a virtual DOM; `const`/arrow functions matching the surrounding file's style.

---

## File Structure

| File | Change |
|---|---|
| `lib/review.js` | Add `itemForMerchant(snapshot, merchant)` |
| `web/review-view.js` | Rewrite navigation/state to support Back/Forward + revisit |
| `web/style.css` | Add `.review-nav`, `.drilldown*`, `.viz-clickable` |
| `lib/query/filter.js` | Add `excludeIds` filter key |
| `web/charts/chart-treemap.js` | Colour by category/group when applicable; add `data-slice-key` |
| `web/charts/chart-bar.js` | Add `data-slice-key` to each bar |
| `web/charts/chart-donut.js` | Add `data-slice-key` to each slice (except "Other") |
| `web/charts/chart-line.js` | Add `data-slice-key` to every marker |
| `web/panel.js` | Build `points` (not bare `amounts`) for the Dots chart |
| `web/charts/chart-dots.js` | Colour per-dot by category; richer hover tooltip |
| `lib/query/slice-transactions.js` | **New.** `transactionsForSlice(snapshot, spec, key)` |
| `web/drilldown-panel.js` | **New.** Pure render of the slide-over panel |
| `web/index.html` | Add `<div id="drilldown">` |
| `web/overview-view.js` | Wire clicks → drill-down panel; session `excludeIds` state |
| `web/app.js` | Pass the drill-down root through; call `overview.refresh()` |

---

## Task 1: Review — Back/Forward navigation with the ability to revisit a decision

Today, `buildQueue()` only ever lists merchants still needing a decision — the moment you assign one, it vanishes from the queue and `mountReview` resets to index 0. There is no way back to "wait, I meant Groceries not Alcohol" without leaving the Review tab. This task adds a **stable, session-long ordering** (`order`, an array of merchant names that only ever grows) alongside the existing live queue, so Back/Forward can always return to a merchant already decided this session and let the user change it.

**Files:**
- Modify: `lib/review.js`
- Modify: `web/review-view.js`
- Modify: `web/style.css`
- Test: `tests/review.test.js`
- Test: `tests/review-view.test.js`

**Interfaces:**
- Consumes: `buildQueue(snapshot)` (existing, unchanged), `suggestCategories(merchant, snapshot, limit)` (existing, unchanged).
- Produces: `itemForMerchant(snapshot, merchant) → { merchant, ids, count, total, dateFrom, dateTo, sampleDescription, suggestions, isPending, currentCategoryId } | null` — used by both `renderReview` and `mountReview`. `isPending` is `true` while any of that merchant's transactions still have `categorySource === 'unknown'`; `currentCategoryId` is `null` while pending, else the merchant's live category id.

- [ ] **Step 1: Write the failing test for `itemForMerchant`**

Add to `tests/review.test.js` (append; check the existing `SNAPSHOT`/fixture name in that file first and reuse it rather than redefining — if the file does not already export a shared fixture, add these tests using its existing top-of-file snapshot constant):

```js
test('itemForMerchant returns null for a merchant with no transactions', () => {
  assert.equal(itemForMerchant(SNAPSHOT, 'Nobody'), null);
});

test('itemForMerchant reports isPending true while any transaction is unknown', () => {
  const item = itemForMerchant(SNAPSHOT, 'Good Heavens');
  assert.equal(item.isPending, true);
  assert.equal(item.currentCategoryId, null);
});

test('itemForMerchant reports isPending false once every transaction has a real category', () => {
  const decided = {
    ...SNAPSHOT,
    transactions: SNAPSHOT.transactions.map((t) =>
      t.merchant === 'Good Heavens' ? { ...t, categoryId: 'coffee', categorySource: 'manual' } : t)
  };
  const item = itemForMerchant(decided, 'Good Heavens');
  assert.equal(item.isPending, false);
  assert.equal(item.currentCategoryId, 'coffee');
});

test('itemForMerchant excludes permanently-excluded transactions from its totals', () => {
  const withExcluded = {
    ...SNAPSHOT,
    transactions: [...SNAPSHOT.transactions, { id: 'zz', date: '2026-08-01', amount: -999, merchant: 'Good Heavens', rawDescription: 'x', categoryId: 'uncategorised', categorySource: 'unknown', excluded: true }]
  };
  const item = itemForMerchant(withExcluded, 'Good Heavens');
  assert.equal(item.count, itemForMerchant(SNAPSHOT, 'Good Heavens').count);
});
```

Add `itemForMerchant` to the existing `import { ... } from '../lib/review.js'` line at the top of `tests/review.test.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review.test.js`
Expected: FAIL — `itemForMerchant is not a function` / not exported.

- [ ] **Step 3: Implement `itemForMerchant` in `lib/review.js`**

Add this function directly after `buildQueue` (it reuses `buildQueue`'s `round2` and `suggestCategories`, both already defined earlier in the file — do not redefine them):

```js
/**
 * A queue-item-shaped view of ONE merchant, whether it is still pending or
 * was already decided. `buildQueue` only ever lists pending merchants —
 * this is what lets the Review UI page back to one that has been resolved
 * and show what it is currently filed as, so a decision can be corrected.
 */
export function itemForMerchant(snapshot, merchant) {
  const transactions = (snapshot?.transactions ?? []).filter((t) => t.merchant === merchant && !t.excluded);
  if (!transactions.length) return null;

  const dates = transactions.map((t) => t.date).sort();
  const isPending = transactions.some((t) => t.categorySource === 'unknown');

  return {
    merchant,
    ids: transactions.map((t) => t.id),
    count: transactions.length,
    total: round2(transactions.reduce((a, t) => a + t.amount, 0)),
    dateFrom: dates[0] ?? null,
    dateTo: dates[dates.length - 1] ?? null,
    sampleDescription: transactions[0].rawDescription ?? '',
    suggestions: suggestCategories(merchant, snapshot),
    isPending,
    currentCategoryId: isPending ? null : transactions[0].categoryId
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/review.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add lib/review.js tests/review.test.js
git commit -m "feat: add itemForMerchant for revisiting a review decision"
```

- [ ] **Step 6: Rewrite the failing/updated tests in `tests/review-view.test.js`**

Replace the entire contents of `tests/review-view.test.js` with:

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
  assert.match(html, /\b2 transactions\b/);
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

test('an index past the end clamps to the last item rather than crashing or showing done', () => {
  const html = renderReview(SNAPSHOT, { index: 99 });
  assert.doesNotMatch(html, /all caught up/i);
  assert.match(html, /Good Heavens|Arctel/);
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

test('offers Back and Next navigation buttons', () => {
  const html = renderReview(SNAPSHOT, state);
  assert.match(html, /data-review-action="prev"/);
  assert.match(html, /data-review-action="next"/);
});

test('Back is disabled on the first item, Next is disabled on the last', () => {
  const first = renderReview(SNAPSHOT, { index: 0 });
  assert.match(first, /data-review-action="prev"[^>]*disabled/);
  const last = renderReview(SNAPSHOT, { index: 1 });
  assert.match(last, /data-review-action="next"[^>]*disabled/);
});

test('revisiting an already-decided merchant shows what it is filed as, not the assign prompt', () => {
  const decided = {
    ...SNAPSHOT,
    transactions: SNAPSHOT.transactions.map((t) =>
      t.merchant === 'Arctel' ? { ...t, categoryId: 'coffee', categorySource: 'manual' } : t)
  };
  const html = renderReview(decided, { index: 0, order: ['Arctel', 'Good Heavens'] });
  assert.match(html, /Arctel/);
  assert.match(html, /Currently filed as/i);
  assert.match(html, /Coffee/);
});

test('a fully resolved session still lets you page back through it, not "all caught up"', () => {
  const allDone = {
    ...SNAPSHOT,
    transactions: SNAPSHOT.transactions.map((t) => ({ ...t, categoryId: 'coffee', categorySource: 'manual' }))
  };
  const html = renderReview(allDone, { index: 0, order: ['Arctel', 'Good Heavens'] });
  assert.doesNotMatch(html, /all caught up/i);
  assert.match(html, /Arctel/);
});
```

- [ ] **Step 7: Run test to verify the new/changed assertions fail**

Run: `node --test tests/review-view.test.js`
Expected: FAIL on the Back/Next/revisit tests and the clamping test (current `renderReview` shows "done" for an out-of-range index and has no `prev`/`next` actions).

- [ ] **Step 8: Rewrite `web/review-view.js`**

Replace the entire file with:

```js
import { buildQueue, itemForMerchant, promptForClaude, parseClaudeResponse } from '../lib/review.js';
import { escapeHtml, formatMoney } from './charts/scale.js';
import { bulkCategorise, patchTransaction, createCategory, getSnapshot } from './api.js';

const labelFor = (snapshot, id) =>
  (snapshot?.categories?.categories ?? []).find((c) => c.id === id)?.label ?? id;

const assignableCategories = (snapshot) =>
  (snapshot?.categories?.categories ?? []).filter((c) => c.id !== 'income' && c.id !== 'uncategorised');

/**
 * The session's stable review order: every merchant that has ever appeared
 * in the pending queue, in the order it first appeared. Only ever grows —
 * an assignment never removes a merchant from it, which is what lets Back
 * return to a merchant after it has been decided.
 */
function growOrder(snapshot, previousOrder = []) {
  const pending = buildQueue(snapshot).items.map((item) => item.merchant);
  const seen = new Set(previousOrder);
  return [...previousOrder, ...pending.filter((merchant) => !seen.has(merchant))];
}

/**
 * Render the queue. Pure — snapshot and state in, markup out — so it is
 * testable in Node with no DOM.
 */
export function renderReview(snapshot, state = {}) {
  const queue = buildQueue(snapshot);
  const order = state.order ?? growOrder(snapshot);
  const index = order.length ? Math.min(Math.max(state.index ?? 0, 0), order.length - 1) : 0;
  const merchant = order[index];
  const item = merchant ? itemForMerchant(snapshot, merchant) : null;

  if (!order.length || !item) {
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

  const statusNote = item.isPending
    ? `<p class="viz-note">Assigning remembers this merchant for future imports. Past transactions are left alone.</p>`
    : `<p class="viz-note">Currently filed as <b>${escapeHtml(labelFor(snapshot, item.currentCategoryId))}</b>. Pick a different category to change it — past transactions are left alone.</p>`;

  return `
  <div class="review">
    <header class="review-head">
      <button class="review-nav" data-review-action="prev" ${index === 0 ? 'disabled' : ''} aria-label="Back">‹ Back</button>
      <span class="viz-note">${index + 1} of ${order.length}${queue.totalRows ? ` · ${queue.totalRows} transaction${queue.totalRows === 1 ? '' : 's'} still to place` : ''}</span>
      <button class="review-nav" data-review-action="next" ${index === order.length - 1 ? 'disabled' : ''} aria-label="Next">Next ›</button>
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
      ${statusNote}
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
  let current = snapshot;
  let state = { index: 0, order: growOrder(current) };

  const draw = () => { root.innerHTML = renderReview(current, state); };

  const refresh = async () => {
    current = await getSnapshot();
    state.order = growOrder(current, state.order);
    state.index = state.order.length ? Math.min(state.index, state.order.length - 1) : 0;
    draw();
    onChanged?.(current);
  };

  const currentItem = () => {
    const merchant = state.order[state.index];
    return merchant ? itemForMerchant(current, merchant) : null;
  };

  const advance = () => {
    state.index = state.order.length ? Math.min(state.index + 1, state.order.length - 1) : 0;
  };

  async function assign(categoryId) {
    const item = currentItem();
    if (!item) return;
    await bulkCategorise({ ids: item.ids, categoryId, rememberRule: true, applyToPast: false });
    advance();
    await refresh();
  }

  async function excludeGroup() {
    const item = currentItem();
    if (!item) return;
    for (const id of item.ids) await patchTransaction(id, { excluded: true });
    advance();
    await refresh();
  }

  root.addEventListener('click', async (event) => {
    const assignTo = event.target.closest('[data-assign]')?.dataset.assign;
    if (assignTo) return assign(assignTo);

    const action = event.target.closest('[data-review-action]')?.dataset.reviewAction;
    if (!action) return;

    if (action === 'skip' || action === 'next') {
      advance();
      draw();
    } else if (action === 'prev') {
      state.index = Math.max(0, state.index - 1);
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
      let skippedMerchants = 0;
      for (const { merchant, categoryId } of assignments) {
        const item = queue.items.find((i) => i.merchant === merchant);
        if (!item) { skippedMerchants++; continue; }
        await bulkCategorise({ ids: item.ids, categoryId, rememberRule: true, applyToPast: false });
        applied++;
      }
      const parts = [`Applied ${applied} of ${assignments.length}.`];
      if (skippedMerchants > 0) parts.push(`${skippedMerchants} merchant${skippedMerchants === 1 ? ' was' : 's were'} not in the queue.`);
      if (errors.length > 0) parts.push(`${errors.length} error${errors.length === 1 ? '' : 's'}.`);
      state.index = 0;
      state.pasteResult = parts.join(' ');
      state.pasteError = null;
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
    } else if (event.key === 's') { advance(); draw(); }
    else if (event.key === 'x') { excludeGroup(); }
    else if (event.key === 'n') { root.querySelector('[data-review-action="new-category"]')?.click(); }
    else if (event.key === '/') { event.preventDefault(); root.querySelector('[data-review-action="search"]')?.focus(); }
    else if (event.key === 'ArrowRight') { advance(); draw(); }
    else if (event.key === 'ArrowLeft') { state.index = Math.max(0, state.index - 1); draw(); }
  };
  document.addEventListener('keydown', onKey);

  draw();
  return { redraw: draw, refresh };
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `node --test tests/review-view.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 10: Add CSS for the nav buttons**

In `web/style.css`, replace this line:

```css
.review-card { border: 1px solid var(--line); border-radius: 10px; padding: 20px; margin: 12px 0; }
```

with:

```css
.review-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.review-nav { padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--viz-surface); color: var(--viz-text-primary); cursor: pointer; font: inherit; font-size: 13px; }
.review-nav[disabled] { opacity: .4; cursor: default; }
.review-card { border: 1px solid var(--line); border-radius: 10px; padding: 20px; margin: 12px 0; }
```

- [ ] **Step 11: Run the full review-related suite**

Run: `node --test tests/review.test.js tests/review-view.test.js`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add lib/review.js web/review-view.js web/style.css tests/review.test.js tests/review-view.test.js
git commit -m "feat: Review Back/Forward navigation and decision revisiting"
```

---

## Task 2: Session-only exclude filter in the query engine

Adds `excludeIds` to `applyFilters` — a list of transaction ids to drop from a result, independent of the ledger's own persisted `excluded` field. This is what lets the drill-down panel's "hide for this session" checkbox (Task 7) actually remove a transaction from every chart's totals without writing anything to disk.

**Files:**
- Modify: `lib/query/filter.js`
- Test: `tests/query-filter.test.js`

**Interfaces:**
- Produces: `applyFilters(transactions, { ..., excludeIds }, ctx)` — `excludeIds` is an optional array of transaction id strings; when present and non-empty, any transaction whose `id` is in it is dropped, regardless of every other filter. An empty array or `undefined` means no constraint, matching every other filter key's convention.

- [ ] **Step 1: Write the failing test**

Append to `tests/query-filter.test.js` (the file already defines `ROWS`, `ctx`, and the `ids()` helper — reuse them):

```js
test('excludeIds drops specific rows regardless of their other fields', () => {
  assert.equal(ids(applyFilters(ROWS, { excludeIds: ['a', 'c'] }, ctx)), 'bf');
});

test('an empty excludeIds means no constraint, not match-nothing', () => {
  assert.equal(ids(applyFilters(ROWS, { excludeIds: [] }, ctx)), 'abf');
});

test('excludeIds is independent of the ledger own excluded field', () => {
  // row e already has excluded:true and is already dropped by default; excludeIds
  // hiding row a on top of that must not need includeExcluded to reveal e.
  const result = applyFilters(ROWS, { excludeIds: ['a'] }, ctx);
  assert.ok(!result.some((r) => r.id === 'a'));
  assert.ok(!result.some((r) => r.id === 'e'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/query-filter.test.js`
Expected: FAIL — `excludeIds` is currently ignored, so `applyFilters(ROWS, { excludeIds: ['a', 'c'] }, ctx)` still returns rows `a`, `b`, `f` (income `d` and excluded `e` and uncategorised-but-otherwise-normal `c`... check against the real default output before asserting; the test above asserts the POST-fix behaviour).

- [ ] **Step 3: Implement in `lib/query/filter.js`**

Change the destructuring line:

```js
  const {
    dateFrom, dateTo, accountIds, categoryIds, groupIds, people, merchants,
    minAbsAmount, maxAbsAmount, includeExcluded = false, includeIncome = false
  } = filters;
```

to:

```js
  const {
    dateFrom, dateTo, accountIds, categoryIds, groupIds, people, merchants,
    minAbsAmount, maxAbsAmount, includeExcluded = false, includeIncome = false, excludeIds
  } = filters;
```

Change:

```js
  const wantedMerchants = has(merchants)
    ? new Set(merchants.map((m) => String(m).toLowerCase()))
    : null;

  return transactions.filter((txn) => {
    if (!includeExcluded && txn.excluded) return false;
    if (!includeIncome && txn.categoryId === 'income') return false;
```

to:

```js
  const wantedMerchants = has(merchants)
    ? new Set(merchants.map((m) => String(m).toLowerCase()))
    : null;
  // A session-only hide, distinct from the ledger's own persisted `excluded`
  // field — this list never touches disk.
  const hiddenIds = has(excludeIds) ? new Set(excludeIds) : null;

  return transactions.filter((txn) => {
    if (hiddenIds && hiddenIds.has(txn.id)) return false;
    if (!includeExcluded && txn.excluded) return false;
    if (!includeIncome && txn.categoryId === 'income') return false;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/query-filter.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add lib/query/filter.js tests/query-filter.test.js
git commit -m "feat: add session-only excludeIds filter to the query engine"
```

---

## Task 3: Treemap — colour by category/group, and add drill-down slice keys

Today the treemap always uses the sequential blue ramp keyed to magnitude, on purpose (it is an all-pairs colour form, documented in `web/charts/palette.js`). This task colours it with the same categorical hues bar/donut already use, **only when the slice actually has a taxonomy identity to colour by** (`sliceBy` is `category` or `group`) — for any other slice (merchant, weekday, amount band, …) there is no category to hang a hue on, so it keeps the existing sequential ramp. This is a deliberate, narrower reading of "colour by category" than literally always-on: it reuses the exact `colourFor` panels already pass to every chart, rather than inventing a new rule, and never makes a non-taxonomy treemap worse than it is today.

**Files:**
- Modify: `web/charts/chart-treemap.js`
- Test: `tests/charts-treemap.test.js`

**Interfaces:**
- Consumes: `colourFor(row) → hex` — already passed by `web/panel.js` to every chart renderer via `options.colourFor`; `result.meta.sliceBy` — already present on every `query()` result.
- Produces: `renderTreemap(result, { mode, title, colourFor })` — `colourFor` is a new optional option; every tile also gets `class="viz-clickable" data-slice-key="<row.key>"`, consumed by Task 8's click wiring.

- [ ] **Step 1: Write the failing tests**

In `tests/charts-treemap.test.js`, replace this test:

```js
test('treemap uses the sequential ramp, NOT the categorical hues', () => {
  const svg = renderTreemap(RESULT, opts);
  // No categorical slot hex may appear.
  for (const hex of ['#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7']) {
    assert.doesNotMatch(svg, new RegExp(hex, 'i'), `categorical hue ${hex} must not appear in a treemap`);
  }
});
```

with:

```js
test('treemap uses the sequential ramp when no colourFor is supplied', () => {
  const svg = renderTreemap(RESULT, opts);
  for (const hex of ['#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7']) {
    assert.doesNotMatch(svg, new RegExp(hex, 'i'), `categorical hue ${hex} must not appear without colourFor`);
  }
});

test('treemap uses the categorical hue when colourFor is supplied for a category/group slice', () => {
  const svg = renderTreemap(RESULT, { ...opts, colourFor: () => '#eb6834' });
  assert.match(svg, /fill="#eb6834"/);
});

test('treemap ignores colourFor for a slice with no taxonomy identity', () => {
  const merchantResult = { ...RESULT, meta: { ...RESULT.meta, sliceBy: 'merchant' } };
  const svg = renderTreemap(merchantResult, { ...opts, colourFor: () => '#eb6834' });
  assert.doesNotMatch(svg, /fill="#eb6834"/);
});

test('treemap tiles carry a slice key for drill-down clicks', () => {
  const svg = renderTreemap(RESULT, opts);
  assert.match(svg, /data-slice-key="a"/);
  assert.match(svg, /class="viz-clickable"/);
});
```

(`RESULT.meta.sliceBy` is already `'group'` in this file's fixture, so the second new test exercises the categorical path without any fixture changes.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/charts-treemap.test.js`
Expected: FAIL on the three new tests (`renderTreemap` does not yet accept `colourFor` and tiles have no `data-slice-key`).

- [ ] **Step 3: Implement in `web/charts/chart-treemap.js`**

Replace the file's doc comment and `renderTreemap` function:

```js
/**
 * Treemap — part-to-whole where area IS the magnitude.
 *
 * Tiles are adjacent arbitrarily, making this an ALL-PAIRS form: the 7
 * categorical hues fail the all-pairs CVD gate (see palette.js). For a
 * category or group slice — where colour genuinely identifies something —
 * this chart accepts that trade-off and uses the same categorical hue bar
 * and donut use for the same slice, so the treemap visually agrees with the
 * rest of the app. Any other slice (merchant, weekday, amount band, …) has
 * no taxonomy identity to colour by, so it keeps the sequential ramp keyed
 * to magnitude — colour and area then encode the same thing, which is
 * correct, not redundant.
 */
export function renderTreemap(result, { mode = 'light', title = '', colourFor } = {}) {
  const rows = [...(result.rows ?? [])].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  if (!rows.length) return `<p class="viz-empty">No data for these filters</p>`;

  const magnitudes = rows.map((r) => Math.abs(r.value));
  const max = Math.max(...magnitudes, 1);
  const tiles = squarify(magnitudes, WIDTH, HEIGHT);
  const measure = result.meta?.measure;
  const sliceBy = result.meta?.sliceBy;
  const useCategorical = Boolean(colourFor) && (sliceBy === 'category' || sliceBy === 'group');

  const cells = rows.map((row, i) => {
    const tile = tiles[i];
    const colour = useCategorical ? colourFor(row) : sequentialColour(Math.abs(row.value) / max, mode);
    const showLabel = tile.w > 70 && tile.h > 34;
    const label = showLabel
      ? `<text x="${(tile.x + 8).toFixed(1)}" y="${(tile.y + 20).toFixed(1)}" class="viz-tile-label">${escapeHtml(row.label)}</text>
         <text x="${(tile.x + 8).toFixed(1)}" y="${(tile.y + 36).toFixed(1)}" class="viz-tile-value">${formatMeasure(row.value, measure)}</text>`
      : '';
    return `<g>
      <rect x="${tile.x.toFixed(1)}" y="${tile.y.toFixed(1)}" width="${tile.w.toFixed(1)}" height="${tile.h.toFixed(1)}"
            fill="${colour}" stroke="var(--viz-surface)" stroke-width="2" rx="4" class="viz-clickable" data-slice-key="${escapeHtml(row.key)}"><title>${escapeHtml(row.label)}: ${formatMeasure(row.value, measure)} · ${row.count} txns</title></rect>
      ${label}
    </g>`;
  }).join('');

  return `<svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" class="viz-treemap">${cells}</svg>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/charts-treemap.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add web/charts/chart-treemap.js tests/charts-treemap.test.js
git commit -m "feat: colour treemap tiles by category/group and add drill-down slice keys"
```

---

## Task 4: Bar, Donut and Line — add drill-down slice keys

Mechanical: give every clickable mark in the three remaining bucketed charts a `data-slice-key` attribute (and `.viz-clickable` for the pointer cursor), so Task 8 can wire one delegated click handler across all four chart types. The donut's aggregated "Other" slice is excluded — it has no single category id to drill into.

**Files:**
- Modify: `web/charts/chart-bar.js`
- Modify: `web/charts/chart-donut.js`
- Modify: `web/charts/chart-line.js`
- Test: `tests/charts-bar.test.js`
- Test: `tests/charts-timeseries.test.js`

**Interfaces:**
- Produces: every bar `<rect>`, non-"Other" donut `<path>`, and line `<circle>` marker carries `class="viz-clickable" data-slice-key="<row.key>"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/charts-bar.test.js`:

```js
test('renderBar marks each bar with its slice key for drill-down', () => {
  const svg = renderBar(RESULT, opts);
  assert.match(svg, /data-slice-key="fuel"/);
  assert.match(svg, /data-slice-key="groceries"/);
  assert.match(svg, /class="viz-clickable"/);
});
```

Append to `tests/charts-timeseries.test.js`:

```js
test('donut marks each slice with its key for drill-down, except the Other bucket', () => {
  const svg = renderDonut(CATEGORICAL, opts);
  assert.match(svg, /data-slice-key="fuel"/);
  const many = { ...CATEGORICAL, rows: Array.from({ length: 12 }, (_, i) => row(`k${i}`, `L${i}`, -(20 - i))) };
  const manySvg = renderDonut(many, opts);
  assert.doesNotMatch(manySvg, /data-slice-key="__other__"/);
});

test('line marks every point with its slice key for drill-down', () => {
  const svg = renderLine(MONTHLY, opts);
  assert.match(svg, /data-slice-key="2026-06"/);
  assert.match(svg, /data-slice-key="2026-07"/);
  assert.match(svg, /data-slice-key="2026-08"/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/charts-bar.test.js tests/charts-timeseries.test.js`
Expected: FAIL on the three new tests.

- [ ] **Step 3: Implement in `web/charts/chart-bar.js`**

Change:

```js
      <rect x="${LABEL_WIDTH}" y="${y}" width="${barWidth.toFixed(1)}" height="${BAR_HEIGHT}"
            rx="4" fill="${colour}"><title>${escapeHtml(row.label)}: ${formatMeasure(row.value, measure)} · ${row.count} txns</title></rect>
```

to:

```js
      <rect x="${LABEL_WIDTH}" y="${y}" width="${barWidth.toFixed(1)}" height="${BAR_HEIGHT}"
            rx="4" fill="${colour}" class="viz-clickable" data-slice-key="${escapeHtml(row.key)}"><title>${escapeHtml(row.label)}: ${formatMeasure(row.value, measure)} · ${row.count} txns</title></rect>
```

- [ ] **Step 4: Implement in `web/charts/chart-donut.js`**

Change:

```js
  const paths = rows.map((row) => {
    const sweep = magnitude === 0 ? 0 : (Math.abs(row.value) / magnitude) * Math.PI * 2;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const colour = colourFor ? colourFor(row) : 'currentColor';
    return `<path d="${arcPath(cx, cy, RADIUS, RADIUS - THICKNESS, start, end)}" fill="${colour}" stroke="var(--viz-surface)" stroke-width="2"><title>${escapeHtml(row.label)}: ${formatMeasure(row.value, measure)}</title></path>`;
  }).join('');
```

to:

```js
  const paths = rows.map((row) => {
    const sweep = magnitude === 0 ? 0 : (Math.abs(row.value) / magnitude) * Math.PI * 2;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const colour = colourFor ? colourFor(row) : 'currentColor';
    // The folded-together "Other" slice has no single category to drill into.
    const clickAttrs = row.key === '__other__' ? '' : ` class="viz-clickable" data-slice-key="${escapeHtml(row.key)}"`;
    return `<path d="${arcPath(cx, cy, RADIUS, RADIUS - THICKNESS, start, end)}" fill="${colour}" stroke="var(--viz-surface)" stroke-width="2"${clickAttrs}><title>${escapeHtml(row.label)}: ${formatMeasure(row.value, measure)}</title></path>`;
  }).join('');
```

- [ ] **Step 5: Implement in `web/charts/chart-line.js`**

Change:

```js
  const markers = points.map((p, i) => {
    const isEnd = i === 0 || i === points.length - 1;
    const title = isEnd ? `<title>${escapeHtml(p.row.label)}: ${formatMeasure(p.row.value, measure)}</title>` : '';
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${colour}" stroke="var(--viz-surface)" stroke-width="2">${title}</circle>`;
  }).join('');
```

to:

```js
  const markers = points.map((p, i) => {
    const isEnd = i === 0 || i === points.length - 1;
    const title = isEnd ? `<title>${escapeHtml(p.row.label)}: ${formatMeasure(p.row.value, measure)}</title>` : '';
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${colour}" stroke="var(--viz-surface)" stroke-width="2" class="viz-clickable" data-slice-key="${escapeHtml(p.row.key)}">${title}</circle>`;
  }).join('');
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/charts-bar.test.js tests/charts-timeseries.test.js`
Expected: PASS, all tests in both files.

- [ ] **Step 7: Commit**

```bash
git add web/charts/chart-bar.js web/charts/chart-donut.js web/charts/chart-line.js tests/charts-bar.test.js tests/charts-timeseries.test.js
git commit -m "feat: add drill-down slice keys to bar, donut and line marks"
```

---

## Task 5: Dots — colour each dot by its own category, richer hover tooltip

The Dots chart currently takes a bare array of numbers (`amounts`) and renders every dot in one hue, since it was built as a single-series, all-pairs-safe form. Individual transactions genuinely differ by category though (a $30 coffee and a $30 fuel top-up are different stories at the same x position), so this task switches it to richer `points` (`{ amount, key, label }`, `key` = the transaction's own `categoryId`) and colours each dot with the same categorical palette `colourResolver(snapshot, 'category')` already produces — independent of whatever slice the panel itself is currently showing, since dots represent raw transactions, not slice buckets. The hover tooltip changes from "amount only" to "merchant: amount".

**Files:**
- Modify: `web/panel.js`
- Modify: `web/charts/chart-dots.js`
- Test: `tests/charts-treemap.test.js` (this is where the existing dot-plot tests live)

**Interfaces:**
- Consumes: `colourResolver(snapshot, sliceBy, mode)` — already defined in `web/panel.js`, unchanged signature.
- Produces: `renderDots(result, { mode, title, points, colourFor })` — replaces the old `amounts` option entirely. Each `points` entry is `{ amount: number, key: string, label: string }`.

- [ ] **Step 1: Write the failing tests**

In `tests/charts-treemap.test.js`, replace the five existing dot-plot tests (`'dot plot draws one dot per amount'` through `'dot plot with no amounts renders a message'`) and the dots half of the "no external host" test with:

```js
const dotPoints = (amounts) => amounts.map((amount, i) => ({ amount, key: `cat-${i % 2}`, label: `Merchant ${i}` }));
const dotsColourFor = (point) => (point.key === 'cat-0' ? '#2a78d6' : '#eb6834');

test('dot plot draws one dot per point', () => {
  const svg = renderDots(RESULT, { ...opts, points: dotPoints([-10, -20, -30, -286.48]) });
  assert.equal((svg.match(/<circle/g) ?? []).length, 4);
});

test('dot plot colours each dot by its own category', () => {
  const svg = renderDots(RESULT, { ...opts, points: dotPoints([-10, -20, -30]), colourFor: dotsColourFor });
  const fills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/gi)].map((m) => m[1].toLowerCase());
  assert.deepEqual(new Set(fills), new Set(['#2a78d6', '#eb6834']));
});

test('dot plot falls back to a single hue with no colourFor', () => {
  const svg = renderDots(RESULT, { ...opts, points: dotPoints([-10, -20, -30]) });
  const fills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/gi)].map((m) => m[1].toLowerCase());
  assert.equal(new Set(fills).size, 1, `expected one hue, got ${[...new Set(fills)]}`);
});

test('dot plot markers are at least 8px across', () => {
  assert.match(renderDots(RESULT, { ...opts, points: dotPoints([-10]) }), /r="4"/);
});

test('dot plot shows exactly one VISIBLE label, for the largest outlier', () => {
  const svg = renderDots(RESULT, { ...opts, points: dotPoints([-10, -20, -30, -286.48]) });
  assert.equal((svg.match(/class="viz-value"/g) ?? []).length, 1);
  assert.match(svg, /class="viz-value">-\$286\.48</);
});

test('dot plot hover shows the merchant AND the amount, on every dot', () => {
  const svg = renderDots(RESULT, { ...opts, points: [{ amount: -12.5, key: 'coffee', label: 'Blend Coffee' }, { amount: -8, key: 'coffee', label: 'Blend Coffee' }] });
  assert.equal((svg.match(/<title>/g) ?? []).length, 2);
  assert.match(svg, /<title>Blend Coffee: -\$12\.50<\/title>/);
});

test('dot plot with no points renders a message', () => {
  assert.match(renderDots(RESULT, { ...opts, points: [] }), /No data/);
});
```

And change the "no treemap or dot output references an external host" test's dots call from `renderDots(RESULT, { ...opts, amounts: [-1] })` to `renderDots(RESULT, { ...opts, points: dotPoints([-1]) })`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/charts-treemap.test.js`
Expected: FAIL — `renderDots` does not yet accept `points` or `colourFor`.

- [ ] **Step 3: Implement in `web/charts/chart-dots.js`**

Replace the file's doc comment and `renderDots` function:

```js
/**
 * Dot plot — one dot per transaction along an amount axis.
 *
 * This is the honest picture of "a few large spends or a lot of small ones":
 * a cluster near the left with one dot far right is a different story from an
 * even spread, and no summary statistic shows it as directly.
 *
 * Each dot is coloured by its OWN transaction's category, not by whatever
 * slice the panel happens to be showing — a $30 coffee and a $30 fuel top-up
 * land at the same x position but are different spends. That makes this an
 * ALL-PAIRS colour form (same trade-off as the treemap — see palette.js),
 * deliberately accepted here because colour is the only way to tell two
 * same-sized dots apart.
 */
export function renderDots(result, { mode = 'light', title = '', points = [], colourFor } = {}) {
  if (!points.length) return `<p class="viz-empty">No data for these filters</p>`;

  const fallback = GROUP_SLOTS['food-drink'][mode] ?? GROUP_SLOTS['food-drink'].light;
  const magnitudes = points.map((p) => Math.abs(p.amount));
  const max = Math.max(...magnitudes, 1);
  const plotW = WIDTH - PAD.left - PAD.right;
  const scale = linearScale(max, plotW);
  const baseline = HEIGHT - PAD.bottom;

  // Nudge overlapping dots upward so density is visible rather than hidden.
  const occupancy = new Map();
  const dots = points.map((point, i) => {
    const magnitude = magnitudes[i];
    const x = PAD.left + scale(magnitude);
    const bucket = Math.round(x / (DOT_R * 2));
    const stack = occupancy.get(bucket) ?? 0;
    occupancy.set(bucket, stack + 1);
    const y = baseline - stack * (DOT_R * 2 + 1);
    const colour = colourFor ? colourFor(point) : fallback;
    // Every dot carries its own hover tooltip — identifying an individual
    // point is the whole reason this chart exists. Only the VISIBLE label
    // below is selective.
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${DOT_R}" fill="${colour}" stroke="var(--viz-surface)" stroke-width="2" opacity="0.85"><title>${escapeHtml(point.label)}: ${formatMoney(point.amount)}</title></circle>`;
  }).join('');

  // Selective direct label: the single largest value only.
  const maxIndex = magnitudes.indexOf(max);
  const maxX = PAD.left + scale(max);
  const outlier = `<text x="${maxX.toFixed(1)}" y="${(baseline - 26).toFixed(1)}" text-anchor="end" class="viz-value">${formatMoney(points[maxIndex].amount)}</text>`;

  const axis = `<line x1="${PAD.left}" y1="${baseline + 10}" x2="${WIDTH - PAD.right}" y2="${baseline + 10}" class="viz-grid"/>
    <text x="${PAD.left}" y="${HEIGHT - 6}" class="viz-label">$0</text>
    <text x="${WIDTH - PAD.right}" y="${HEIGHT - 6}" text-anchor="end" class="viz-label">${formatMoney(-max)}</text>`;

  return `<svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" class="viz-dots">${axis}${dots}${outlier}</svg>`;
}
```

The file's `import` line and constants (`WIDTH`, `HEIGHT`, `PAD`, `DOT_R`) are unchanged — only the function body and doc comment above it change.

- [ ] **Step 4: Update the caller in `web/panel.js`**

Change:

```js
      if (config.chartType === 'dots') {
        // The only chart needing raw amounts. They are derived through the SAME
        // filters as the rest of the panel, then reduced to bare numbers — so the
        // chart still never receives a whole transaction record.
        const ctx = buildContext(snapshot);
        options.amounts = applyFilters(snapshot.transactions ?? [], spec.filters, ctx)
          .map((t) => t.amount);
      }
```

to:

```js
      if (config.chartType === 'dots') {
        // The only chart needing raw amounts. They are derived through the SAME
        // filters as the rest of the panel, then reduced to bare {amount, key,
        // label} points — never a whole transaction record. Dots colour by the
        // transaction's OWN category regardless of the panel's chosen slice, so
        // this always resolves colour via the 'category' slice, not config.sliceBy.
        const ctx = buildContext(snapshot);
        options.points = applyFilters(snapshot.transactions ?? [], spec.filters, ctx)
          .map((t) => ({ amount: t.amount, key: t.categoryId, label: t.merchant }));
        options.colourFor = colourResolver(snapshot, 'category');
      }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/charts-treemap.test.js tests/panel.test.js`
Expected: PASS, all tests in both files.

- [ ] **Step 6: Commit**

```bash
git add web/charts/chart-dots.js web/panel.js tests/charts-treemap.test.js
git commit -m "feat: colour Dots by category and show merchant+amount on hover"
```

---

## Task 6: Transactions-for-slice lookup

A new, small, pure function that turns `(snapshot, filters+sliceBy, a bucket key)` into the actual transaction records behind that one bucket — e.g. every transaction currently filed as `alcohol`, or every transaction in `2026-08`. This is what the drill-down panel (Task 7) queries when a chart mark is clicked. It deliberately does **not** live inside `lib/query/query.js` — Seam 1 must keep returning no records — and instead reuses `applyFilters`/`buildContext`/`groupBy` directly, the same way `web/panel.js` already does for the Dots chart's raw amounts.

**Files:**
- Create: `lib/query/slice-transactions.js`
- Test: `tests/slice-transactions.test.js`

**Interfaces:**
- Consumes: `applyFilters(transactions, filters, ctx)`, `buildContext(snapshot)` (both from `lib/query/filter.js`, unchanged), `groupBy(transactions, sliceBy, ctx)`, `SLICES` (both from `lib/query/group-by.js`, unchanged).
- Produces: `transactionsForSlice(snapshot, { filters, sliceBy }, key) → { key, label, rows: Transaction[] } | null` — consumed by `web/overview-view.js` in Task 8.

- [ ] **Step 1: Write the failing test**

Create `tests/slice-transactions.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transactionsForSlice } from '../lib/query/slice-transactions.js';

const SNAPSHOT = {
  categories: {
    groups: [{ id: 'food-drink', label: 'Food & Drink' }],
    categories: [
      { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
      { id: 'alcohol', label: 'Alcohol', groupId: 'food-drink' }
    ]
  },
  accounts: [{ id: 'spending', label: 'Joint', cardOwners: {} }],
  transactions: [
    { id: 'a', date: '2026-07-05', amount: -100, merchant: 'Coles', accountId: 'spending', cardSuffix: null, categoryId: 'groceries', excluded: false },
    { id: 'b', date: '2026-08-05', amount: -40, merchant: 'Dan Murphy\'s', accountId: 'spending', cardSuffix: null, categoryId: 'alcohol', excluded: false },
    { id: 'c', date: '2026-08-07', amount: -20, merchant: 'Dan Murphy\'s', accountId: 'spending', cardSuffix: null, categoryId: 'alcohol', excluded: false }
  ]
};

test('returns the rows and label for a matching bucket', () => {
  const result = transactionsForSlice(SNAPSHOT, { sliceBy: 'category' }, 'alcohol');
  assert.equal(result.label, 'Alcohol');
  assert.deepEqual(result.rows.map((r) => r.id).sort(), ['b', 'c']);
});

test('returns null for a key with no matching bucket', () => {
  assert.equal(transactionsForSlice(SNAPSHOT, { sliceBy: 'category' }, 'nope'), null);
});

test('applies the given filters before bucketing', () => {
  const result = transactionsForSlice(SNAPSHOT, { sliceBy: 'category', filters: { dateFrom: '2026-08-06' } }, 'alcohol');
  assert.deepEqual(result.rows.map((r) => r.id), ['c']);
});

test('defaults sliceBy to category', () => {
  const result = transactionsForSlice(SNAPSHOT, {}, 'groceries');
  assert.equal(result.rows.length, 1);
});

test('throws on an unsupported slice, same as query()', () => {
  assert.throws(() => transactionsForSlice(SNAPSHOT, { sliceBy: 'nonsense' }, 'x'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/slice-transactions.test.js`
Expected: FAIL — the module does not exist yet.

- [ ] **Step 3: Implement `lib/query/slice-transactions.js`**

```js
import { applyFilters, buildContext } from './filter.js';
import { groupBy, SLICES } from './group-by.js';

/**
 * The transaction records behind ONE slice bucket — the drill-down UI's
 * deliberate escape hatch from Seam 1's "no records" contract. `query()` in
 * query.js must never return raw transactions; this is a separate function,
 * for the one feature (drill down + re-categorise) that genuinely needs them.
 *
 * @param {object} snapshot
 * @param {{filters?: object, sliceBy?: string}} spec
 * @param {string} key  the bucket key to isolate — a category id, group id,
 *   month/week string, merchant name, etc., matching `sliceBy`.
 * @returns {{key: string, label: string, rows: Array} | null}
 */
export function transactionsForSlice(snapshot, spec = {}, key) {
  const { filters = {}, sliceBy = 'category' } = spec;
  if (!SLICES.includes(sliceBy)) throw new Error(`Unsupported slice: ${sliceBy}`);

  const ctx = buildContext(snapshot);
  const filtered = applyFilters(snapshot.transactions ?? [], filters, ctx);
  const bucket = groupBy(filtered, sliceBy, ctx).find((b) => b.key === key);
  return bucket ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/slice-transactions.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add lib/query/slice-transactions.js tests/slice-transactions.test.js
git commit -m "feat: add transactionsForSlice, the drill-down panel's data source"
```

---

## Task 7: The drill-down side panel component

A pure render function for the slide-over panel: the slice's label, its transactions (date, merchant, amount, a category `<select>` to re-categorise, and a "Hide for this session" checkbox), and a close button. No event wiring here — `web/overview-view.js` (Task 8) owns that, the same way it already owns all wiring for `panel.js`'s pure `html()` output.

**Files:**
- Create: `web/drilldown-panel.js`
- Modify: `web/style.css`
- Modify: `web/index.html`
- Test: `tests/drilldown-panel.test.js`

**Interfaces:**
- Consumes: `escapeHtml`, `formatMoney` from `web/charts/scale.js` (unchanged).
- Produces: `renderDrilldown(snapshot, state) → string` where `state` is `{ label, rows, excludedIds }` (`rows` are transaction records from `transactionsForSlice`, `excludedIds` a `Set<string>` of session-hidden transaction ids) or `null`/`undefined` for "closed" (renders empty string). Markup carries `data-drilldown-id="<txn id>"` per row, `data-drilldown-action="close" | "recategorise" | "toggle-hide"` for Task 8's event delegation.

- [ ] **Step 1: Write the failing test**

Create `tests/drilldown-panel.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDrilldown } from '../web/drilldown-panel.js';

const SNAPSHOT = {
  categories: {
    groups: [{ id: 'food-drink', label: 'Food & Drink' }, { id: 'other', label: 'Other' }],
    categories: [
      { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
      { id: 'alcohol', label: 'Alcohol', groupId: 'food-drink' },
      { id: 'income', label: 'Income', groupId: 'other' },
      { id: 'uncategorised', label: 'Uncategorised', groupId: 'other' }
    ]
  }
};

const ROWS = [
  { id: 'a', date: '2026-08-05', amount: -40, merchant: 'Dan Murphy\'s', categoryId: 'alcohol' },
  { id: 'b', date: '2026-08-07', amount: -20, merchant: 'Dan Murphy\'s', categoryId: 'alcohol' }
];

test('renders nothing when there is no open slice', () => {
  assert.equal(renderDrilldown(SNAPSHOT, null), '');
  assert.equal(renderDrilldown(SNAPSHOT, undefined), '');
});

test('shows the label and every row', () => {
  const html = renderDrilldown(SNAPSHOT, { label: 'Alcohol', rows: ROWS, excludedIds: new Set() });
  assert.match(html, /Alcohol/);
  assert.match(html, /Dan Murphy/);
  assert.match(html, /-\$40\.00/);
  assert.match(html, /-\$20\.00/);
});

test('offers a close button', () => {
  const html = renderDrilldown(SNAPSHOT, { label: 'Alcohol', rows: ROWS, excludedIds: new Set() });
  assert.match(html, /data-drilldown-action="close"/);
});

test('offers a category select per row, pre-selected to its current category', () => {
  const html = renderDrilldown(SNAPSHOT, { label: 'Alcohol', rows: ROWS, excludedIds: new Set() });
  assert.match(html, /data-drilldown-action="recategorise"/);
  assert.match(html, /<option value="alcohol" selected>Alcohol<\/option>/);
});

test('never offers income or uncategorised as a re-categorise option', () => {
  const html = renderDrilldown(SNAPSHOT, { label: 'Alcohol', rows: ROWS, excludedIds: new Set() });
  assert.doesNotMatch(html, /<option value="income"/);
  assert.doesNotMatch(html, /<option value="uncategorised"/);
});

test('offers a hide-for-this-session checkbox per row, reflecting current state', () => {
  const html = renderDrilldown(SNAPSHOT, { label: 'Alcohol', rows: ROWS, excludedIds: new Set(['a']) });
  // Split into per-row chunks rather than a cross-row regex — rows render
  // newest-first, so a naive `id="a"[\s\S]*?checked` can backtrack straight
  // past row a's own (unchecked) box into row b's, giving a false match.
  const rowChunks = html.split('<tr').slice(1).map((chunk) => '<tr' + chunk);
  const rowA = rowChunks.find((r) => r.includes('data-drilldown-id="a"'));
  const rowB = rowChunks.find((r) => r.includes('data-drilldown-id="b"'));
  assert.match(rowA, /toggle-hide"\s*checked/);
  assert.doesNotMatch(rowB, /toggle-hide"\s*checked/);
});

test('the running total excludes hidden rows', () => {
  const html = renderDrilldown(SNAPSHOT, { label: 'Alcohol', rows: ROWS, excludedIds: new Set(['a']) });
  assert.match(html, /-\$20\.00/);
  assert.doesNotMatch(html, /-\$60\.00/);
});

test('is explicit that hiding is session-only, not permanent', () => {
  const html = renderDrilldown(SNAPSHOT, { label: 'Alcohol', rows: ROWS, excludedIds: new Set() });
  assert.match(html, /this session/i);
});

test('escapes merchant names and labels', () => {
  const nasty = [{ ...ROWS[0], merchant: '<img src=x>' }];
  const html = renderDrilldown(SNAPSHOT, { label: '<script>x</script>', rows: nasty, excludedIds: new Set() });
  assert.doesNotMatch(html, /<img src=x>/);
  assert.doesNotMatch(html, /<script>x<\/script>/);
});

test('references no external host', () => {
  const html = renderDrilldown(SNAPSHOT, { label: 'Alcohol', rows: ROWS, excludedIds: new Set() });
  assert.doesNotMatch(html, /https?:\/\/(?!127\.0\.0\.1|localhost)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/drilldown-panel.test.js`
Expected: FAIL — the module does not exist yet.

- [ ] **Step 3: Implement `web/drilldown-panel.js`**

```js
import { escapeHtml, formatMoney } from './charts/scale.js';

const assignableCategories = (snapshot) =>
  (snapshot?.categories?.categories ?? []).filter((c) => c.id !== 'income' && c.id !== 'uncategorised');

/**
 * Pure render of the slide-over drill-down panel: the transactions behind
 * one clicked chart mark, each with a category select (re-categorise) and a
 * session-only hide checkbox. `state` is `{ label, rows, excludedIds }` or
 * falsy for "closed" — closed renders an empty string so the caller can
 * always set `root.innerHTML = renderDrilldown(...)` unconditionally.
 */
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

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/drilldown-panel.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Add the panel's CSS**

Append to `web/style.css`:

```css
.viz-clickable { cursor: pointer; }
.viz-clickable:hover { opacity: .85; }

.drilldown {
  position: fixed; top: 0; right: 0; height: 100vh; width: min(420px, 100vw);
  background: var(--viz-surface); border-left: 1px solid var(--line);
  box-shadow: -4px 0 16px rgba(0,0,0,.12); overflow-y: auto; z-index: 20;
  padding: 20px;
}
.drilldown.hidden { display: none; }
.drilldown-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
.drilldown-head h3 { margin: 0; font-size: 16px; }
.drilldown-head button { background: none; border: 1px solid var(--line); border-radius: 6px; cursor: pointer; color: var(--viz-text-primary); padding: 2px 8px; }
.drilldown-table { margin-top: 12px; font-size: 12px; }
.drilldown-table select { font: inherit; font-size: 12px; padding: 2px 4px; border: 1px solid var(--line); border-radius: 4px; background: var(--viz-surface); color: var(--viz-text-primary); }
.drilldown-hide { display: flex; align-items: center; gap: 4px; font-size: 11px; white-space: nowrap; }
.drilldown-hidden-row { opacity: .5; }
```

- [ ] **Step 6: Add the panel's root element to `web/index.html`**

Change:

```html
  <main>
    <section id="view-overview" class="view"></section>
    <section id="view-import" class="view hidden"></section>
    <section id="view-review" class="view hidden"></section>
  </main>
  <script type="module" src="/app.js"></script>
```

to:

```html
  <main>
    <section id="view-overview" class="view"></section>
    <section id="view-import" class="view hidden"></section>
    <section id="view-review" class="view hidden"></section>
  </main>
  <div id="drilldown" class="drilldown hidden"></div>
  <script type="module" src="/app.js"></script>
```

- [ ] **Step 7: Commit**

```bash
git add web/drilldown-panel.js web/style.css web/index.html tests/drilldown-panel.test.js
git commit -m "feat: add the drill-down side panel component"
```

---

## Task 8: Wire the drill-down panel and session hide into the Overview

The last task connects everything: clicking a `[data-slice-key]` mark on any panel opens the drill-down panel (via `transactionsForSlice`), the panel's checkbox toggles a session-only `excludeIds` Set that flows into every panel and the KPI row (via Task 2's filter and `renderOverview`'s new `extraFilters` parameter), and the panel's category select calls the existing `patchTransaction` API and refreshes both the panel and the underlying charts.

`mountOverview` currently gets fully re-created on every `app.js` refresh (losing its filter-bar and, without this change, its new session state). This task gives it the same `{ redraw, refresh }` return shape `mountReview` already has, and updates `app.js` to call `.refresh()` on subsequent refreshes instead of re-mounting — the same pattern already used for Review.

**Files:**
- Modify: `web/overview-view.js`
- Modify: `web/app.js`
- Test: `tests/overview-panels.test.js`

**Interfaces:**
- Consumes: `transactionsForSlice` (`lib/query/slice-transactions.js`, Task 6), `renderDrilldown` (`web/drilldown-panel.js`, Task 7), `patchTransaction`, `getSnapshot` (`web/api.js`, unchanged).
- Produces: `renderOverview(snapshot, uiFilters, panelConfigs, extraFilters)` — new fourth parameter, defaults to `{}`, fully backward compatible. `mountOverview(root, { snapshot, drilldownRoot })` — new `drilldownRoot` option; returns `{ redraw, refresh }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/overview-panels.test.js`:

```js
test('extra filters (e.g. a session-only exclude) merge into every panel and the KPI row', () => {
  const html = renderOverview(SNAPSHOT, {}, DEFAULT_PANELS, { excludeIds: ['b'] });
  assert.match(html, /-\$100\.00/);
  assert.doesNotMatch(html, /-\$300\.00/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/overview-panels.test.js`
Expected: FAIL — `renderOverview` currently ignores a fourth argument.

- [ ] **Step 3: Update `renderOverview`'s signature in `web/overview-view.js`**

Change:

```js
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
```

to:

```js
export function renderOverview(snapshot, uiFilters = {}, panelConfigs = DEFAULT_PANELS, extraFilters = {}) {
  if (!(snapshot.transactions ?? []).length) {
    return '<p class="empty">No transactions yet — import a CSV to get started.</p>';
  }
  const queryFilters = { ...toQueryFilters(uiFilters), ...extraFilters };
  const panels = panelConfigs
    .map((config) => createPanel(config).html(snapshot, queryFilters))
    .join('');

  return `
    ${kpiRow(snapshot, queryFilters)}
    ${renderFilterBar(snapshot, uiFilters)}
    ${panels}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/overview-panels.test.js`
Expected: PASS, all tests in the file (including the pre-existing `aggregateOverview`-is-still-exported test — that function is untouched by this plan).

- [ ] **Step 5: Rewrite `mountOverview` in `web/overview-view.js`**

Add these imports at the top of the file, alongside the existing ones:

```js
import { transactionsForSlice } from '../lib/query/slice-transactions.js';
import { renderDrilldown } from './drilldown-panel.js';
import { patchTransaction, getSnapshot } from './api.js';
```

Replace the existing `mountOverview` function:

```js
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

with:

```js
/** Wire the Overview into a live DOM node. */
export function mountOverview(root, { snapshot, drilldownRoot } = {}) {
  let current = snapshot;
  let filters = {};
  let configs = loadPanelConfigs();
  const excludedIds = new Set();
  let drilldown = null; // { sliceBy, key, label, rows, panelFilters } | null

  const extraFilters = () => (excludedIds.size ? { excludeIds: [...excludedIds] } : {});

  const draw = () => {
    root.innerHTML = renderOverview(current, filters, configs, extraFilters());
    if (drilldownRoot) {
      drilldownRoot.innerHTML = renderDrilldown(current, drilldown && { ...drilldown, excludedIds });
      drilldownRoot.classList.toggle('hidden', !drilldown);
    }
  };

  const fetchSlice = (sliceBy, panelFilters, key) => {
    const base = toQueryFilters(filters);
    const spec = { filters: { ...base, ...panelFilters }, sliceBy };
    return transactionsForSlice(current, spec, key);
  };

  function openDrilldown(config, key) {
    const bucket = fetchSlice(config.sliceBy, config.filters, key);
    drilldown = bucket ? { sliceBy: config.sliceBy, key, label: bucket.label, rows: bucket.rows, panelFilters: config.filters } : null;
    draw();
  }

  function closeDrilldown() {
    drilldown = null;
    draw();
  }

  function toggleHidden(id) {
    if (excludedIds.has(id)) excludedIds.delete(id); else excludedIds.add(id);
    draw();
  }

  async function reassign(id, categoryId) {
    await patchTransaction(id, { categoryId });
    current = await getSnapshot();
    if (drilldown) {
      const bucket = fetchSlice(drilldown.sliceBy, drilldown.panelFilters, drilldown.key);
      drilldown = bucket ? { ...drilldown, rows: bucket.rows, label: bucket.label } : null;
    }
    draw();
  }

  const refresh = async () => {
    current = await getSnapshot();
    drilldown = null;
    draw();
  };

  draw();

  root.addEventListener('click', (event) => {
    const mark = event.target.closest('[data-slice-key]');
    if (mark) {
      const panelId = mark.closest('[data-panel-id]')?.dataset.panelId;
      const config = configs.find((c) => c.id === panelId);
      if (config) openDrilldown(config, mark.dataset.sliceKey);
      return;
    }
  });

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

  if (drilldownRoot) {
    drilldownRoot.addEventListener('click', (event) => {
      if (event.target.closest('[data-drilldown-action="close"]')) closeDrilldown();
    });
    drilldownRoot.addEventListener('change', (event) => {
      const row = event.target.closest('[data-drilldown-id]');
      if (!row) return;
      const id = row.dataset.drilldownId;
      const action = event.target.dataset.drilldownAction;
      if (action === 'recategorise') reassign(id, event.target.value);
      else if (action === 'toggle-hide') toggleHidden(id);
    });
  }

  return { redraw: draw, refresh };
}
```

- [ ] **Step 6: Update `web/app.js`**

Replace:

```js
import { getSnapshot } from './api.js';
import { renderImportView } from './import-view.js';
import { mountOverview } from './overview-view.js';
import { mountReview } from './review-view.js';

const views = {
  overview: document.querySelector('#view-overview'),
  import: document.querySelector('#view-import'),
  review: document.querySelector('#view-review')
};

let review = null;

async function refresh() {
  const snapshot = await getSnapshot();
  mountOverview(views.overview, { snapshot });
  if (review) await review.refresh();
  else review = mountReview(views.review, { snapshot });
}
```

with:

```js
import { getSnapshot } from './api.js';
import { renderImportView } from './import-view.js';
import { mountOverview } from './overview-view.js';
import { mountReview } from './review-view.js';

const views = {
  overview: document.querySelector('#view-overview'),
  import: document.querySelector('#view-import'),
  review: document.querySelector('#view-review'),
  drilldown: document.querySelector('#drilldown')
};

let overview = null;
let review = null;

async function refresh() {
  const snapshot = await getSnapshot();
  if (overview) await overview.refresh();
  else overview = mountOverview(views.overview, { snapshot, drilldownRoot: views.drilldown });
  if (review) await review.refresh();
  else review = mountReview(views.review, { snapshot });
}
```

The rest of `app.js` (`showTab`, the tab-click listener, `renderImportView(...)`, the trailing `await refresh(); showTab('overview');`) is unchanged.

- [ ] **Step 7: Run the full suite**

Run: `node --test 'tests/**/*.test.js'`
Expected: PASS, every test in the repository.

- [ ] **Step 8: Commit**

```bash
git add web/overview-view.js web/app.js tests/overview-panels.test.js
git commit -m "feat: wire click-to-drill-down and session-only hide into the Overview"
```

---

## Final Verification

- [ ] Run the entire suite once more: `node --test 'tests/**/*.test.js'` — confirm the pass count increased by the number of tests added across all eight tasks and nothing regressed.
- [ ] Start the server (`npm start`) and manually verify, per the design's five requests: Review's Back/Forward buttons work and Back can change an already-assigned merchant; the Dots and Treemap charts on "By category" show multiple colours matching the bar/donut palette; hovering a dot shows the merchant name and amount; clicking a bar/slice/tile/line-point opens the side panel with that slice's transactions; ticking "Hide" on a row removes it from the KPI/chart totals immediately and the note reads "this session"; changing a row's category in the side panel updates it and the underlying charts.
