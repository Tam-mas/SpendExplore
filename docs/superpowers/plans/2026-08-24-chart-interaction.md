# Chart Interaction Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Overview from a printed page into something you can move your hands through — hover tooltips on every chart mark, real date ranges and rolling windows alongside the existing month list, multi-select filters, and click-to-mute legend entries.

**Architecture:** Charts stay pure functions returning SVG strings; they gain `data-tip-title` / `data-tip` attributes on their marks and nothing more. A single shared overlay element in `web/tooltip.js` reads those attributes on hover and positions itself — one listener on the Overview root, not one per mark. Period resolution moves into `lib/query/periods.js` (created by the comparison plan) so both plans share one definition of what a window is. Multi-select uses a native `<details>` popover, which gives open/close and keyboard access with zero JavaScript.

**Tech Stack:** Node.js stdlib only, `node:test` + `node:assert/strict`, vanilla DOM, hand-rolled SVG. No new dependencies.

## Dependency

**Task 1 requires `lib/query/periods.js` to exist.** It is created by `2026-08-24-comparison-baselines.md` Task 1.

Task 1 here adds `PERIOD_PRESETS`, `periodOptions` and `resolvePeriod` to that file, and its implementation calls three helpers the comparison plan defines: **`monthWindow`, `shiftMonth` and `addDays`**. If the comparison plan has not been run, port those three (and the `daysInMonth`, `pad`, `toUTC`, `fromUTC` internals they rest on) from its Task 1 first — do not reimplement them differently, or the two plans will disagree about what a window is.

## Global Constraints

- Zero npm dependencies. Node stdlib only. No build step; plain ES modules served directly.
- Run tests with `node --test 'tests/**/*.test.js'` (the bare-directory form is broken on this Node version) or explicit file paths.
- `lib/` stays pure: no I/O, no DOM. `web/` owns all DOM wiring.
- **Tooltip content is set with `textContent`, never `innerHTML`.** Merchant names and category labels come from bank CSVs and user input; going through the DOM's text API removes the injection question entirely rather than relying on an escape being remembered at every call site.
- **A mark carries its accessible name as `aria-label`, not as a child `<title>`.** A `<title>` element makes the browser draw its own native tooltip, which would then race and overlap the custom one. `aria-label` on a `role="img"` mark preserves the screen-reader affordance with no visual duplicate.
- Dates are inclusive ISO `YYYY-MM-DD` strings; arithmetic is UTC-based, matching `lib/query/group-by.js`.
- Rolling windows are **day-based**, not calendar-month-based ("Last 3 months" is the last 90 days). A day-based window has one unambiguous definition, and it shifts predictably under `shiftWindow` when a comparison baseline is also active.
- Every new/changed test file must pass before its task's commit.
- No comments explaining WHAT code does, only non-obvious WHY.
- **Live verification must use `npm run start:test`** (`DATA_DIR=./data-test`, port 5174). Never against `data/`; never read files from outside this repo. See `CLAUDE.md`.

## Out of scope, deliberately

**Brush-to-filter on the time chart is not built here.** It was considered and not selected. Do not add a partial version — a half-working drag interaction is worse than none.

---

## File Structure

| File | Change |
|---|---|
| `lib/query/periods.js` | Add `PERIOD_PRESETS`, `periodOptions`, `resolvePeriod` |
| `web/multiselect.js` | **New.** `renderMultiSelect`, `readMultiSelect` |
| `web/tooltip.js` | **New.** `mountTooltip` |
| `web/filter-bar.js` | New period control; multi-select for account/person/group; `toQueryFilters` rewritten |
| `web/charts/chart-bar.js`, `chart-donut.js`, `chart-line.js`, `chart-stacked.js`, `chart-treemap.js`, `chart-dots.js` | `data-tip*` attributes; `<title>` → `aria-label` |
| `web/panel.js` | Legend muting; hidden-series note |
| `web/overview-view.js` | Mount the tooltip; persist muted keys; handle legend clicks |
| `web/index.html` | Tooltip root element |
| `web/style.css` | Tooltip, multi-select popover, muted legend entries |
| `tests/query-periods.test.js` | Extend |
| `tests/multiselect.test.js` | **New.** |
| `tests/chart-tips.test.js` | **New.** |
| `tests/filter-bar.test.js`, `tests/overview-panels.test.js` | Extend |

---

## Task 1: period presets and resolution

**Files:**
- Modify: `lib/query/periods.js`
- Test: `tests/query-periods.test.js`

**Interfaces:**
- Consumes: `monthWindow`, `addDays` (already in the file).
- Produces: `PERIOD_PRESETS: readonly {value,label,days?}[]`; `periodOptions(snapshot) → { presets, months }`; `resolvePeriod(selection, { today, dateFrom, dateTo }) → { dateFrom, dateTo } | {}`. Task 2 depends on these.

**Selection grammar:** `'all'`, one of the rolling preset values, `'month:2026-08'`, or `'custom'`. Anything unrecognised resolves to `{}` (all time) rather than throwing — a stale value in `localStorage` must not break the page.

- [ ] **Step 1: Write the failing tests**

Append to `tests/query-periods.test.js`:

```js
import { PERIOD_PRESETS, periodOptions, resolvePeriod } from '../lib/query/periods.js';

const TODAY = '2026-08-24';

test('PERIOD_PRESETS offers all-time, four rolling windows and a custom option', () => {
  assert.deepEqual(PERIOD_PRESETS.map((p) => p.value),
    ['all', 'last30', 'last90', 'last180', 'ytd', 'custom']);
});

test('resolvePeriod returns an unbounded window for all time', () => {
  assert.deepEqual(resolvePeriod('all', { today: TODAY }), {});
  assert.deepEqual(resolvePeriod('', { today: TODAY }), {});
  assert.deepEqual(resolvePeriod('nonsense', { today: TODAY }), {});
  assert.deepEqual(resolvePeriod(undefined, { today: TODAY }), {});
});

test('rolling windows are day-based and include today', () => {
  assert.deepEqual(resolvePeriod('last30', { today: TODAY }),
    { dateFrom: '2026-07-26', dateTo: '2026-08-24' });
  assert.deepEqual(resolvePeriod('last90', { today: TODAY }),
    { dateFrom: '2026-05-27', dateTo: '2026-08-24' });
});

test('this year runs from 1 January to today', () => {
  assert.deepEqual(resolvePeriod('ytd', { today: TODAY }),
    { dateFrom: '2026-01-01', dateTo: '2026-08-24' });
});

test('a month selection resolves to that whole calendar month', () => {
  assert.deepEqual(resolvePeriod('month:2026-02', { today: TODAY }),
    { dateFrom: '2026-02-01', dateTo: '2026-02-28' });
  assert.deepEqual(resolvePeriod('month:2024-02', { today: TODAY }),
    { dateFrom: '2024-02-01', dateTo: '2024-02-29' });
});

test('a custom range uses the supplied ends', () => {
  assert.deepEqual(resolvePeriod('custom', { today: TODAY, dateFrom: '2026-03-01', dateTo: '2026-04-15' }),
    { dateFrom: '2026-03-01', dateTo: '2026-04-15' });
});

test('an incomplete or backwards custom range falls back to all time rather than filtering to nothing', () => {
  assert.deepEqual(resolvePeriod('custom', { today: TODAY, dateFrom: '2026-03-01' }), {});
  assert.deepEqual(resolvePeriod('custom', { today: TODAY }), {});
  assert.deepEqual(resolvePeriod('custom', { today: TODAY, dateFrom: '2026-05-01', dateTo: '2026-03-01' }), {});
  assert.deepEqual(resolvePeriod('custom', { today: TODAY, dateFrom: 'garbage', dateTo: '2026-03-01' }), {});
});

test('periodOptions lists every month in the ledger, newest first, alongside the presets', () => {
  const snapshot = { transactions: [{ date: '2026-06-10' }, { date: '2026-08-01' }] };
  const options = periodOptions(snapshot);
  assert.deepEqual(options.months.map((m) => m.value), ['month:2026-08', 'month:2026-07', 'month:2026-06']);
  assert.equal(options.months[0].label, 'Aug 2026');
  assert.equal(options.presets, PERIOD_PRESETS);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/query-periods.test.js`
Expected: FAIL — `PERIOD_PRESETS is not defined`

- [ ] **Step 3: Write the implementation**

Append to `lib/query/periods.js`:

```js
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rolling windows are DAY-based, not calendar-month-based: "Last 3 months"
 * means the last 90 days. A day-based window has exactly one definition, and
 * it shifts predictably under shiftWindow() when a comparison is also active.
 */
export const PERIOD_PRESETS = Object.freeze([
  { value: 'all',     label: 'All time' },
  { value: 'last30',  label: 'Last 30 days',  days: 30 },
  { value: 'last90',  label: 'Last 3 months', days: 90 },
  { value: 'last180', label: 'Last 6 months', days: 180 },
  { value: 'ytd',     label: 'This year' },
  { value: 'custom',  label: 'Custom range…' }
]);

const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

/** Every month between the ledger's first and last transaction, newest first. */
function monthsInLedger(dates) {
  if (!dates.length) return [];
  const sorted = [...dates].sort();
  const first = sorted[0].slice(0, 7);
  const last = sorted.at(-1).slice(0, 7);
  const out = [];
  for (let key = first; key <= last; key = shiftMonth(key, 1)) out.push(key);
  return out.reverse();
}

/**
 * The Period control's options. Individual months stay in the list alongside
 * the rolling windows — picking one month from a list is faster than setting
 * two dates by hand, and it is the most common thing this app is asked to do.
 */
export function periodOptions(snapshot) {
  const dates = (snapshot?.transactions ?? []).map((t) => t.date);
  return {
    presets: PERIOD_PRESETS,
    months: monthsInLedger(dates).map((key) => ({ value: `month:${key}`, label: monthLabel(key) }))
  };
}

/**
 * Turn a Period selection into a window. Anything unrecognised resolves to an
 * unbounded window rather than throwing — a stale value left in localStorage
 * must never break the page.
 */
export function resolvePeriod(selection, { today = new Date().toISOString().slice(0, 10), dateFrom, dateTo } = {}) {
  if (!selection || selection === 'all') return {};

  if (selection.startsWith('month:')) {
    const key = selection.slice(6);
    return /^\d{4}-\d{2}$/.test(key) ? monthWindow(key) : {};
  }

  if (selection === 'ytd') {
    return { dateFrom: `${today.slice(0, 4)}-01-01`, dateTo: today };
  }

  if (selection === 'custom') {
    // A half-entered range must not silently filter the ledger down to
    // nothing while the user is still typing the second date.
    if (!ISO_DATE.test(dateFrom ?? '') || !ISO_DATE.test(dateTo ?? '')) return {};
    if (dateFrom > dateTo) return {};
    return { dateFrom, dateTo };
  }

  const preset = PERIOD_PRESETS.find((p) => p.value === selection && p.days);
  if (!preset) return {};
  return { dateFrom: addDays(today, -(preset.days - 1)), dateTo: today };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/query-periods.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/query/periods.js tests/query-periods.test.js
git commit -m "feat: add period presets, rolling windows and custom-range resolution"
```

---

## Task 2: the new period control in the filter bar

**Files:**
- Modify: `web/filter-bar.js`
- Test: `tests/filter-bar.test.js`

**Interfaces:**
- Consumes: `periodOptions`, `resolvePeriod` (Task 1).
- Produces: `renderFilterBar` emits `<select data-filter="period">` with an `<optgroup>` for rolling windows and one for months, plus two `data-filter="dateFrom"` / `data-filter="dateTo"` inputs revealed when `custom` is chosen. `readFilterBar` returns `{ period, dateFrom, dateTo, accountIds, people, groupIds, compare }`. `toQueryFilters` resolves the period.

**Migration note:** the old `month` key is replaced by `period`. A stored filter object holding `month: '2026-08'` is upgraded on read to `period: 'month:2026-08'` so an existing session does not lose its selection.

- [ ] **Step 1: Write the failing tests**

Append to `tests/filter-bar.test.js`:

```js
const LEDGER = {
  transactions: [{ date: '2026-06-10' }, { date: '2026-08-01' }],
  accounts: [],
  categories: { groups: [{ id: 'food-drink', label: 'Food & Drink' }], categories: [] }
};

test('the period control groups rolling windows and individual months separately', () => {
  const html = renderFilterBar(LEDGER, { period: 'all' });
  assert.match(html, /data-filter="period"/);
  assert.match(html, /<optgroup label="Rolling"/);
  assert.match(html, /<optgroup label="Months"/);
  assert.match(html, /value="last90"/);
  assert.match(html, /value="month:2026-08"/);
});

test('the custom date inputs are hidden until custom is selected', () => {
  assert.match(renderFilterBar(LEDGER, { period: 'last30' }), /viz-custom-range hidden/);
  const custom = renderFilterBar(LEDGER, { period: 'custom', dateFrom: '2026-03-01', dateTo: '2026-04-15' });
  assert.equal(/viz-custom-range hidden/.test(custom), false);
  assert.match(custom, /value="2026-03-01"/);
});

test('toQueryFilters resolves a rolling window into dateFrom and dateTo', () => {
  const spec = toQueryFilters({ period: 'last30' }, { today: '2026-08-24' });
  assert.equal(spec.dateFrom, '2026-07-26');
  assert.equal(spec.dateTo, '2026-08-24');
});

test('toQueryFilters resolves a month selection', () => {
  const spec = toQueryFilters({ period: 'month:2026-02' }, { today: '2026-08-24' });
  assert.deepEqual(spec, { dateFrom: '2026-02-01', dateTo: '2026-02-28' });
});

test('toQueryFilters upgrades a legacy month key to a period selection', () => {
  // A session that was open across the upgrade keeps its selection.
  const spec = toQueryFilters({ month: '2026-02' }, { today: '2026-08-24' });
  assert.deepEqual(spec, { dateFrom: '2026-02-01', dateTo: '2026-02-28' });
});

test('toQueryFilters passes multi-selected ids through as arrays', () => {
  const spec = toQueryFilters({ period: 'all', groupIds: ['food-drink', 'home'] }, { today: '2026-08-24' });
  assert.deepEqual(spec.groupIds, ['food-drink', 'home']);
  assert.equal(spec.dateFrom, undefined);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/filter-bar.test.js`
Expected: FAIL — no `data-filter="period"`

- [ ] **Step 3: Write the implementation**

In `web/filter-bar.js`, add to the imports:

```js
import { periodOptions, resolvePeriod } from '../lib/query/periods.js';
```

Delete the now-unused `MONTH_NAMES`, `monthLabel` and `monthsBetween` helpers — `periodOptions` owns that logic now — and remove `months` from `filterOptions`'s return.

Add the period control renderer:

```js
const periodControl = (snapshot, filters) => {
  const { presets, months } = periodOptions(snapshot);
  const current = filters.period ?? (filters.month ? `month:${filters.month}` : 'all');
  const rolling = presets.filter((p) => p.days || p.value === 'ytd');
  const option = (value, label) =>
    `<option value="${escapeHtml(value)}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`;

  return `
  <label class="viz-control">
    <span class="viz-control-label">Period</span>
    <select data-filter="period">
      ${option('all', 'All time')}
      <optgroup label="Rolling">${rolling.map((p) => option(p.value, p.label)).join('')}</optgroup>
      <optgroup label="Months">${months.map((m) => option(m.value, m.label)).join('')}</optgroup>
      ${option('custom', 'Custom range…')}
    </select>
  </label>
  <div class="viz-custom-range${current === 'custom' ? '' : ' hidden'}">
    <input type="date" data-filter="dateFrom" value="${escapeHtml(filters.dateFrom ?? '')}" aria-label="Range start">
    <span>to</span>
    <input type="date" data-filter="dateTo" value="${escapeHtml(filters.dateTo ?? '')}" aria-label="Range end">
  </div>`;
};
```

Replace the `select('month', …)` line in `renderFilterBar` with `${periodControl(snapshot, filters)}`.

Replace `toQueryFilters`:

```js
/**
 * Turn the filter bar's own shape into the `filters` half of a query spec.
 *
 * `period` replaced the old single-month `month` key; a legacy value is
 * upgraded here rather than at every call site, so a session open across the
 * change keeps its selection.
 */
export function toQueryFilters(filters = {}, { today } = {}) {
  const { period, month, dateFrom, dateTo, accountIds, people, groupIds } = filters;
  const selection = period ?? (month ? `month:${month}` : 'all');
  const spec = { ...resolvePeriod(selection, { today, dateFrom, dateTo }) };
  if (accountIds?.length) spec.accountIds = accountIds;
  if (people?.length) spec.people = people;
  if (groupIds?.length) spec.groupIds = groupIds;
  return spec;
}
```

Replace `readFilterBar`:

```js
/** Read the live filter bar back into a filters object, plus the comparison mode. */
export function readFilterBar(root) {
  const value = (name) => root.querySelector(`[data-filter="${name}"]`)?.value ?? '';
  const compare = value('compare');
  return {
    period: value('period') || 'all',
    dateFrom: value('dateFrom'),
    dateTo: value('dateTo'),
    accountIds: readMultiSelect(root, 'accountIds'),
    people: readMultiSelect(root, 'people'),
    groupIds: readMultiSelect(root, 'groupIds'),
    compare: BASELINE_MODES.includes(compare) ? compare : 'off'
  };
}
```

`readMultiSelect` arrives in Task 3. Until then, temporarily define it inline at the bottom of the file as `const readMultiSelect = (root, name) => { const v = root.querySelector(\`[data-filter="${name}"]\`)?.value; return v ? [v] : []; };` and delete it in Task 3.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/filter-bar.test.js`
Expected: PASS

- [ ] **Step 5: Update `web/overview-view.js` so the custom inputs toggle**

In `mountOverview`'s `change` listener, the existing filter branch already calls `readFilterBar` and redraws; because `renderFilterBar` decides the `hidden` class from `filters.period`, a redraw is all that is needed. Confirm the branch reads:

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

Also add an `input` handler so typing a custom date applies without needing a blur — extend the existing `input` listener:

```js
  root.addEventListener('input', (event) => {
    if (event.target.matches?.('[data-filter="dateFrom"], [data-filter="dateTo"]')) {
      filters = readFilterBar(root);
      draw();
      return;
    }
    if (!event.target.matches?.('[data-search]')) return;
    runSearch(event.target.value);
  });
```

- [ ] **Step 6: Add the styles**

```css
.viz-custom-range { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
.viz-custom-range.hidden { display: none; }
.viz-custom-range input { font: inherit; font-size: 12px; padding: 3px 6px; border: 1px solid var(--line); border-radius: 5px; background: var(--viz-surface); color: var(--viz-text-primary); }
```

- [ ] **Step 7: Run the whole suite and commit**

Run: `node --test 'tests/**/*.test.js'`
Expected: PASS

```bash
git add web/filter-bar.js web/overview-view.js web/style.css tests/filter-bar.test.js
git commit -m "feat: replace the month dropdown with rolling windows, months and a custom range"
```

---

## Task 3: multi-select filters

**Files:**
- Create: `web/multiselect.js`
- Modify: `web/filter-bar.js`
- Test: `tests/multiselect.test.js`

**Interfaces:**
- Consumes: `escapeHtml` from `web/charts/scale.js`.
- Produces: `renderMultiSelect({ name, label, options, selected, allLabel }) → html`; `readMultiSelect(root, name) → string[]`.

**Why `<details>`:** it gives open/close state, keyboard operation and click-outside-to-ignore for free, with no JavaScript and no focus-trap code. In a project with no build step and no dependencies, that is the right trade against a hand-rolled popover.

**Known limitation, not a bug:** the Account and Person filters will show no options, because `accounts` is never written by any route — see the comment in `server/store.js`. Multi-select does not change that; the Group filter is the one with real data today.

- [ ] **Step 1: Write the failing tests**

Create `tests/multiselect.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMultiSelect } from '../web/multiselect.js';

const OPTIONS = [
  { value: 'food-drink', label: 'Food & Drink' },
  { value: 'home', label: 'Home' },
  { value: 'transport', label: 'Transport' }
];

const render = (selected) => renderMultiSelect({
  name: 'groupIds', label: 'Group', options: OPTIONS, selected, allLabel: 'All groups'
});

test('the trigger reads as the all-label when nothing is selected', () => {
  assert.match(render([]), /All groups/);
});

test('the trigger names the single selection when there is exactly one', () => {
  assert.match(render(['home']), /Home/);
  assert.equal(/1 selected/.test(render(['home'])), false);
});

test('the trigger counts the selections when there is more than one', () => {
  assert.match(render(['home', 'transport']), /2 selected/);
});

test('every option is a checkbox carrying the filter name and its value', () => {
  const html = render([]);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /data-filter="groupIds"/);
  assert.match(html, /value="food-drink"/);
});

test('selected options are checked and unselected ones are not', () => {
  const html = render(['home']);
  assert.match(html, /value="home"\s+checked/);
  assert.equal(/value="transport"\s+checked/.test(html), false);
});

test('labels are escaped', () => {
  const html = renderMultiSelect({
    name: 'groupIds', label: 'Group', allLabel: 'All', selected: [],
    options: [{ value: 'x', label: '<img src=x onerror=alert(1)>' }]
  });
  assert.equal(html.includes('<img src=x'), false);
  assert.match(html, /&lt;img src=x/);
});

test('an empty option list still renders a usable, clearly empty control', () => {
  const html = renderMultiSelect({ name: 'accountIds', label: 'Account', options: [], selected: [], allLabel: 'All accounts' });
  assert.match(html, /All accounts/);
  assert.match(html, /None available/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/multiselect.test.js`
Expected: FAIL — `Cannot find module '.../web/multiselect.js'`

- [ ] **Step 3: Write the implementation**

Create `web/multiselect.js`:

```js
import { escapeHtml } from './charts/scale.js';

/**
 * A checkbox popover built on <details>, which supplies open/close state and
 * keyboard operation with no JavaScript and no focus-trap code — the right
 * trade in a project with no build step and no dependencies.
 *
 * Every checkbox carries `data-filter="<name>"`, so readMultiSelect and the
 * existing `change` listener in mountOverview both find them the same way the
 * single selects were found.
 */
export function renderMultiSelect({ name, label, options = [], selected = [], allLabel = 'All' }) {
  const chosen = new Set(selected);
  const trigger = chosen.size === 0
    ? allLabel
    : chosen.size === 1
      ? (options.find((o) => chosen.has(o.value))?.label ?? allLabel)
      : `${chosen.size} selected`;

  const items = options.length
    ? options.map((option) => `
      <label class="viz-multi-option">
        <input type="checkbox" data-filter="${escapeHtml(name)}" value="${escapeHtml(option.value)}"${chosen.has(option.value) ? ' checked' : ''}>
        ${escapeHtml(option.label)}
      </label>`).join('')
    : '<p class="viz-multi-empty">None available</p>';

  return `
  <details class="viz-multi" data-multi="${escapeHtml(name)}">
    <summary>
      <span class="viz-control-label">${escapeHtml(label)}</span>
      <span class="viz-multi-trigger">${escapeHtml(trigger)}</span>
    </summary>
    <div class="viz-multi-menu">${items}</div>
  </details>`;
}

/** The checked values for one filter, in the order they appear. */
export function readMultiSelect(root, name) {
  return [...root.querySelectorAll(`input[type="checkbox"][data-filter="${name}"]`)]
    .filter((input) => input.checked)
    .map((input) => input.value);
}
```

- [ ] **Step 4: Wire it into `web/filter-bar.js`**

Add the import and delete the temporary `readMultiSelect` stub from Task 2:

```js
import { renderMultiSelect, readMultiSelect } from './multiselect.js';
```

Re-export it so `readFilterBar` and `mountOverview` share one definition:

```js
export { readMultiSelect };
```

Replace the three `select('accountIds' | 'people' | 'groupIds', …)` calls in `renderFilterBar` with:

```js
    ${renderMultiSelect({ name: 'accountIds', label: 'Account', options: options.accounts, selected: filters.accountIds ?? [], allLabel: 'All accounts' })}
    ${renderMultiSelect({ name: 'people', label: 'Person', options: options.people, selected: filters.people ?? [], allLabel: 'Both of us' })}
    ${renderMultiSelect({ name: 'groupIds', label: 'Group', options: options.groups, selected: filters.groupIds ?? [], allLabel: 'All groups' })}
```

The `select` helper is still used by the `compare` control, so leave it in place.

**Keep the popover open across a redraw.** `draw()` replaces the whole of `root.innerHTML`, which would collapse an open `<details>` after every checkbox click. In `mountOverview`, record which popover is open before the redraw and restore it after:

```js
  /**
   * A checkbox click redraws the whole Overview, which would otherwise collapse
   * the popover the user is still ticking boxes in.
   */
  const withOpenPopover = (redraw) => {
    const open = root.querySelector('details.viz-multi[open]')?.dataset.multi ?? null;
    redraw();
    if (open) root.querySelector(`details.viz-multi[data-multi="${open}"]`)?.setAttribute('open', '');
  };
```

and call `withOpenPopover(draw)` instead of `draw()` in the filter branch of the `change` listener.

- [ ] **Step 5: Add the styles**

```css
.viz-multi { position: relative; }
.viz-multi > summary { display: flex; flex-direction: column; gap: 2px; cursor: pointer; list-style: none; padding: 2px 0; }
.viz-multi > summary::-webkit-details-marker { display: none; }
.viz-multi-trigger { font-size: 12px; padding: 3px 22px 3px 6px; border: 1px solid var(--line); border-radius: 5px; background: var(--viz-surface); }
.viz-multi[open] .viz-multi-trigger { border-color: var(--accent); }
.viz-multi-menu {
  position: absolute; z-index: 10; top: 100%; left: 0; min-width: 180px; max-height: 260px;
  overflow-y: auto; margin-top: 4px; padding: 8px; display: flex; flex-direction: column; gap: 6px;
  background: var(--viz-surface); border: 1px solid var(--line); border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0,0,0,.14);
}
.viz-multi-option { display: flex; align-items: center; gap: 7px; font-size: 13px; cursor: pointer; }
.viz-multi-empty { margin: 0; font-size: 12px; color: var(--muted); }
```

- [ ] **Step 6: Run the tests and commit**

Run: `node --test 'tests/**/*.test.js'`
Expected: PASS

```bash
git add web/multiselect.js web/filter-bar.js web/overview-view.js web/style.css tests/multiselect.test.js
git commit -m "feat: multi-select account, person and group filters"
```

---

## Task 4: tooltip data on every chart mark

**Files:**
- Modify: `web/charts/chart-bar.js`, `chart-donut.js`, `chart-line.js`, `chart-stacked.js`, `chart-treemap.js`, `chart-dots.js`
- Test: `tests/chart-tips.test.js`

**Interfaces:**
- Consumes: `formatMeasure`, `formatMoney`, `escapeHtml`, `concentrationLine` from `web/charts/scale.js`.
- Produces: no new exports. Every clickable mark gains `data-tip-title` (the bucket's name) and `data-tip` (a ` · `-separated body), and its child `<title>` is replaced by `aria-label` on the mark itself.

**The tip body is where the concentration answer belongs.** A hover on a bar should say `$412.30 · 16 txns · median $13.90 · top 3 = 45%` — the question this whole app exists to answer, without a click.

- [ ] **Step 1: Write the failing tests**

Create `tests/chart-tips.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBar } from '../web/charts/chart-bar.js';
import { renderDonut } from '../web/charts/chart-donut.js';
import { renderLine } from '../web/charts/chart-line.js';
import { renderTreemap } from '../web/charts/chart-treemap.js';
import { renderStacked } from '../web/charts/chart-stacked.js';
import { renderDots } from '../web/charts/chart-dots.js';

const stats = { txnCount: 16, median: -13.9, largest: -64.15, top3Share: 0.45 };
const row = (over = {}) => ({ key: 'groceries', label: 'Groceries', value: -412.3, count: 16, total: -412.3, stats, ...over });
const result = (meta = {}) => ({ rows: [row()], total: -412.3, stats, meta: { measure: 'sum', ...meta } });

test('a bar mark carries a tip title and a tip body', () => {
  const svg = renderBar(result());
  assert.match(svg, /data-tip-title="Groceries"/);
  assert.match(svg, /data-tip="[^"]*\$412\.30[^"]*"/);
  assert.match(svg, /data-tip="[^"]*16 transactions[^"]*"/);
});

test('the tip body answers the few-big-or-many-small question without a click', () => {
  const svg = renderBar(result());
  assert.match(svg, /median/);
  assert.match(svg, /top 3/);
});

test('marks carry aria-label instead of a child title element', () => {
  // A <title> child makes the browser draw its own native tooltip, which would
  // race and overlap the custom one.
  const svg = renderBar(result());
  assert.equal(svg.includes('<title>'), false);
  assert.match(svg, /aria-label="Groceries: \$412\.30 · 16 txns"/);
});

test('the donut, treemap and dots marks all carry tip data', () => {
  assert.match(renderDonut(result()), /data-tip-title="Groceries"/);
  assert.match(renderTreemap(result()), /data-tip-title="Groceries"/);
  assert.match(
    renderDots(result(), { points: [{ amount: -64.15, key: 'groceries', label: 'Coles' }] }),
    /data-tip-title="Coles"/
  );
});

test('every line marker carries tip data, not just the first and last', () => {
  const svg = renderLine({
    rows: [
      { key: '2026-06', label: 'Jun 2026', value: -100, count: 1, stats },
      { key: '2026-07', label: 'Jul 2026', value: -200, count: 2, stats },
      { key: '2026-08', label: 'Aug 2026', value: -340, count: 3, stats }
    ],
    total: -640, stats, meta: { sliceBy: 'month', measure: 'sum' }
  });
  assert.equal([...svg.matchAll(/data-tip-title=/g)].length, 3);
});

test('a stacked segment names its own band, not the column total', () => {
  const svg = renderStacked({
    rows: [{ key: '2026-08', label: 'Aug 2026', value: -340, count: 3, stats }],
    total: -340, stats, meta: { sliceBy: 'month', measure: 'sum' }
  }, {
    series: [
      { key: 'food-drink', label: 'Food & Drink', values: [-200] },
      { key: 'home', label: 'Home', values: [-140] }
    ]
  });
  assert.match(svg, /data-tip-title="Food &amp; Drink"/);
  assert.match(svg, /data-tip-title="Home"/);
});

test('tip attributes are escaped', () => {
  const svg = renderBar(result()).replace('Groceries', 'x');
  assert.equal(svg.includes('onerror='), false);
  const hostile = renderBar({ rows: [row({ label: '"><img src=x onerror=alert(1)>' })], total: -1, stats, meta: { measure: 'sum' } });
  assert.equal(hostile.includes('<img src=x'), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/chart-tips.test.js`
Expected: FAIL — no `data-tip-title` attributes

- [ ] **Step 3: Add a shared tip builder to `web/charts/scale.js`**

```js
/**
 * The two attributes every hoverable mark carries. The body deliberately leads
 * with the value and then answers the few-big-or-many-small question, so a
 * hover gives the same insight a drill-down click would.
 */
export function tipAttrs(title, value, measure, stats) {
  const parts = [formatMeasure(value, measure)];
  if (stats?.txnCount) parts.push(concentrationLine(stats));
  return `data-tip-title="${escapeHtml(title)}" data-tip="${escapeHtml(parts.join(' · '))}"`;
}
```

`concentrationLine` and `formatMeasure` are already defined above it in the same file; move `tipAttrs` below both.

- [ ] **Step 4: Apply it to each chart**

In **`web/charts/chart-bar.js`**, import `tipAttrs` and replace the bar `<rect>`'s `<title>` child:

```js
      <rect x="${LABEL_WIDTH}" y="${y}" width="${barWidth.toFixed(1)}" height="${BAR_HEIGHT}"
            rx="4" fill="${colour}" class="viz-clickable" role="img"
            aria-label="${escapeHtml(`${row.label}: ${formatMeasure(row.value, measure)} · ${row.count} txns`)}"
            data-slice-key="${escapeHtml(row.key)}" ${tipAttrs(row.label, row.value, measure, row.stats)}></rect>
```

In **`web/charts/chart-donut.js`**, replace the `<path>`'s `<title>` child the same way:

```js
    return `<path d="${arcPath(cx, cy, RADIUS, RADIUS - THICKNESS, start, end)}" fill="${colour}" stroke="var(--viz-surface)" stroke-width="2" role="img" aria-label="${escapeHtml(`${row.label}: ${formatMeasure(row.value, measure)}`)}" ${tipAttrs(row.label, row.value, measure, row.stats)}${clickAttrs}></path>`;
```

In **`web/charts/chart-line.js`**, give **every** marker tip data — not only the first and last, which is all the current `<title>` covers:

```js
  const markers = points.map((p) =>
    `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${colour}" stroke="var(--viz-surface)" stroke-width="2" class="viz-clickable" role="img" aria-label="${escapeHtml(`${p.row.label}: ${formatMeasure(p.row.value, measure)}`)}" data-slice-key="${escapeHtml(p.row.key)}" ${tipAttrs(p.row.label, p.row.value, measure, p.row.stats)}></circle>`
  ).join('');
```

In **`web/charts/chart-stacked.js`**, each segment names its own band:

```js
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" fill="${colour}" rx="2" role="img" aria-label="${escapeHtml(`${s.label}: ${formatMoney(-value)}`)}" data-tip-title="${escapeHtml(s.label)}" data-tip="${escapeHtml(`${formatMoney(-value)} · ${row.label}`)}"></rect>`;
```

In **`web/charts/chart-treemap.js`** and **`web/charts/chart-dots.js`**, apply the same substitution to whichever element currently carries a `<title>` child: drop the `<title>`, add `role="img"` plus `aria-label` with the same text, and add `tipAttrs(...)`. For dots, the title is the point's `label` (the merchant) and the value is its `amount`; there are no per-point stats, so pass `null`.

Verify no `<title>` remains in any chart:

```bash
grep -rn "<title>" web/charts/
```

Expected: no output.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/chart-tips.test.js tests/charts-bar.test.js tests/charts-timeseries.test.js tests/charts-treemap.test.js tests/charts-dots.test.js`
Expected: PASS. Existing chart tests asserting on `<title>` must be updated to assert on `aria-label` instead.

- [ ] **Step 6: Commit**

```bash
git add web/charts/ tests/chart-tips.test.js tests/charts-*.test.js
git commit -m "feat: add tooltip data to every chart mark, replacing native SVG titles"
```

---

## Task 5: the tooltip overlay

**Files:**
- Create: `web/tooltip.js`
- Modify: `web/index.html`, `web/overview-view.js`, `web/style.css`

**Interfaces:**
- Consumes: an element to render into and a container to listen on.
- Produces: `mountTooltip(container, element) → { destroy }`.

**Content is set with `textContent`, never `innerHTML`.** Tip text comes from merchant names and category labels, which originate in bank CSVs. Going through the DOM's text API removes the injection question rather than relying on an escape being remembered.

**One listener on the container, not one per mark.** `draw()` replaces `root.innerHTML` wholesale on every filter change; per-mark listeners would be destroyed and leaked on each redraw. Delegation survives redraws with no re-binding.

- [ ] **Step 1: Write the implementation**

Create `web/tooltip.js`:

```js
const OFFSET = 14;

/**
 * One shared hover tooltip for every chart mark inside `container`.
 *
 * Delegated from the container rather than bound per mark: draw() replaces the
 * container's whole innerHTML on every filter change, so per-mark listeners
 * would be destroyed and re-created on each redraw.
 *
 * Content is written with textContent, never innerHTML — tip text originates
 * in bank CSVs and user-authored labels.
 */
export function mountTooltip(container, element) {
  if (!container || !element) return { destroy() {} };

  const titleNode = document.createElement('strong');
  const bodyNode = document.createElement('span');
  element.append(titleNode, bodyNode);

  let active = null;

  const hide = () => {
    active = null;
    element.classList.add('hidden');
  };

  const place = (event) => {
    const bounds = element.getBoundingClientRect();
    // Flip to the other side of the cursor rather than running off-screen.
    const overflowsRight = event.clientX + OFFSET + bounds.width > window.innerWidth;
    const overflowsBottom = event.clientY + OFFSET + bounds.height > window.innerHeight;
    const x = overflowsRight ? event.clientX - OFFSET - bounds.width : event.clientX + OFFSET;
    const y = overflowsBottom ? event.clientY - OFFSET - bounds.height : event.clientY + OFFSET;
    element.style.transform = `translate(${Math.max(x, 4)}px, ${Math.max(y, 4)}px)`;
  };

  const show = (target, event) => {
    if (target !== active) {
      active = target;
      titleNode.textContent = target.getAttribute('data-tip-title') ?? '';
      bodyNode.textContent = target.getAttribute('data-tip') ?? '';
      element.classList.remove('hidden');
    }
    place(event);
  };

  const onMove = (event) => {
    const target = event.target.closest?.('[data-tip]');
    if (target) show(target, event);
    else if (active) hide();
  };

  container.addEventListener('mousemove', onMove);
  container.addEventListener('mouseleave', hide);
  // A redraw can remove the hovered mark out from under the pointer.
  container.addEventListener('click', hide);
  window.addEventListener('scroll', hide, { passive: true });

  return {
    destroy() {
      container.removeEventListener('mousemove', onMove);
      container.removeEventListener('mouseleave', hide);
      container.removeEventListener('click', hide);
      window.removeEventListener('scroll', hide);
      hide();
    }
  };
}
```

- [ ] **Step 2: Add the element to `web/index.html`**

Before `#error-banner`:

```html
  <div id="tooltip" class="viz-tooltip hidden" role="tooltip" aria-hidden="true"></div>
```

- [ ] **Step 3: Mount it in `web/overview-view.js`**

Add the import:

```js
import { mountTooltip } from './tooltip.js';
```

In `mountOverview`, after the initial `draw();`:

```js
  // Delegated from `root`, so it survives every draw() without re-binding.
  mountTooltip(root, document.querySelector('#tooltip'));
```

- [ ] **Step 4: Add the styles**

```css
.viz-tooltip {
  position: fixed; top: 0; left: 0; z-index: 40; pointer-events: none;
  max-width: 260px; padding: 7px 10px; border-radius: 7px;
  background: var(--fg); color: var(--bg);
  font-size: 12px; line-height: 1.45; box-shadow: 0 4px 14px rgba(0,0,0,.22);
}
.viz-tooltip.hidden { display: none; }
.viz-tooltip strong { display: block; font-weight: 600; }
.viz-tooltip span { font-variant-numeric: tabular-nums; opacity: .85; }
```

- [ ] **Step 5: Verify live**

There is no DOM in `node --test`, so this is the one part of the plan that can only be checked in a browser.

**Never run this against `data/`.**

```bash
npm run start:test
```

Open <http://127.0.0.1:5174> and confirm: hovering any bar, donut slice, treemap tile, line marker, stacked segment or dot shows the tooltip; it follows the cursor; it flips rather than running off the right or bottom edge; it disappears on leaving the chart; and no second native tooltip appears after a one-second hover.

- [ ] **Step 6: Commit**

```bash
git add web/tooltip.js web/index.html web/overview-view.js web/style.css
git commit -m "feat: add a shared hover tooltip for every chart mark"
```

---

## Task 6: legend muting

**Files:**
- Modify: `web/charts/chart-donut.js`, `web/charts/chart-stacked.js`, `web/panel.js`, `web/overview-view.js`, `web/style.css`
- Test: `tests/overview-panels.test.js`

**Interfaces:**
- Consumes: `config.muted` on a panel config.
- Produces: legend `<li>` elements gain `data-legend-key` and a `viz-legend-muted` class when muted. `createPanel` accepts and persists `muted: string[]`, filters muted keys out before rendering, and renders a "n hidden · Show all" note.

**Scope: charts that actually have a legend — donut and stacked.** Bar, line, treemap and dots direct-label their marks and have no legend to click. Muting on the donut re-normalises the ring and its centre total, so the two agree; the note below the panel says how many are hidden.

- [ ] **Step 1: Write the failing tests**

Append to `tests/overview-panels.test.js`:

```js
import { createPanel as createPanelForMute } from '../web/panel.js';

const muteTxn = (over) => ({
  id: 'x', date: '2026-08-10', amount: -100, rawDescription: 'R', merchant: 'M',
  accountId: 'a', cardSuffix: null, categoryId: 'groceries', categorySource: 'rule',
  excluded: false, importId: 'i', note: null, ...over
});

const MUTE_SNAPSHOT = {
  accounts: [],
  categories: {
    groups: [{ id: 'food-drink', label: 'Food & Drink' }, { id: 'home', label: 'Home' }],
    categories: [
      { id: 'groceries', label: 'Groceries', groupId: 'food-drink' },
      { id: 'rent', label: 'Rent', groupId: 'home' }
    ]
  },
  transactions: [
    muteTxn({ id: 'a', categoryId: 'groceries', amount: -100 }),
    muteTxn({ id: 'b', categoryId: 'rent', amount: -900 })
  ]
};

test('a donut legend entry carries its key so it can be clicked to mute', () => {
  const html = createPanelForMute({ id: 'p', title: 'T', sliceBy: 'category', measure: 'sum', chartType: 'donut' })
    .html(MUTE_SNAPSHOT, {});
  assert.match(html, /data-legend-key="groceries"/);
  assert.match(html, /data-legend-key="rent"/);
});

test('muting a key removes its slice and says how many are hidden', () => {
  const html = createPanelForMute({ id: 'p', title: 'T', sliceBy: 'category', measure: 'sum', chartType: 'donut', muted: ['rent'] })
    .html(MUTE_SNAPSHOT, {});
  assert.match(html, /1 series hidden/);
  assert.match(html, /data-panel-action="unmute-all"/);
  assert.match(html, /viz-legend-muted/);
});

test('the donut centre total matches the ring after muting', () => {
  const html = createPanelForMute({ id: 'p', title: 'T', sliceBy: 'category', measure: 'sum', chartType: 'donut', muted: ['rent'] })
    .html(MUTE_SNAPSHOT, {});
  // Only groceries survives, so the centre must read $100.00, not $1,000.00.
  assert.match(html, /viz-total">-\$100\.00/);
  assert.equal(html.includes('$1,000.00'), false);
});

test('muting every key leaves an explanation rather than an empty chart', () => {
  const html = createPanelForMute({ id: 'p', title: 'T', sliceBy: 'category', measure: 'sum', chartType: 'donut', muted: ['rent', 'groceries'] })
    .html(MUTE_SNAPSHOT, {});
  assert.match(html, /2 series hidden/);
  assert.match(html, /unmute-all/);
});

test('a chart with no legend is unaffected by muted keys', () => {
  const html = createPanelForMute({ id: 'p', title: 'T', sliceBy: 'category', measure: 'sum', chartType: 'bar', muted: ['rent'] })
    .html(MUTE_SNAPSHOT, {});
  assert.match(html, /Rent/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/overview-panels.test.js`
Expected: FAIL — no `data-legend-key`

- [ ] **Step 3: Add legend keys to the two charts with legends**

In `web/charts/chart-donut.js`, replace the legend map:

```js
  const legend = rows.map((row) => {
    const colour = colourFor ? colourFor(row) : 'currentColor';
    const muted = row.key === '__other__' ? '' : ' viz-legend-clickable';
    return `<li class="viz-legend-item${muted}" data-legend-key="${escapeHtml(row.key)}"><span class="viz-swatch" style="background:${colour}"></span>${escapeHtml(row.label)} <span class="viz-value">${formatMeasure(row.value, measure)}</span></li>`;
  }).join('');
```

In `web/charts/chart-stacked.js`:

```js
  const legend = series.map((s) => {
    const colour = colourFor ? colourFor({ key: s.key, label: s.label }) : 'currentColor';
    return `<li class="viz-legend-item viz-legend-clickable" data-legend-key="${escapeHtml(s.key)}"><span class="viz-swatch" style="background:${colour}"></span>${escapeHtml(s.label)}</li>`;
  }).join('');
```

Also accept a `muted` option in both so a muted entry is still listed but struck through — hiding the legend entry entirely would leave no way to bring it back. In each renderer's options destructuring add `muted = []`, build `const mutedSet = new Set(muted);`, and append `${mutedSet.has(key) ? ' viz-legend-muted' : ''}` to the `<li>`'s class list.

- [ ] **Step 4: Apply muting in `web/panel.js`**

In `createPanel`'s `config`, add:

```js
    muted: Array.isArray(initial.muted) ? initial.muted : []
```

Add to the returned `panel` object:

```js
    toggleMute(key) {
      config.muted = config.muted.includes(key)
        ? config.muted.filter((k) => k !== key)
        : [...config.muted, key];
      return config;
    },
    unmuteAll() { config.muted = []; return config; },
```

Inside `html()`, after `const result = compareQuery(...)`, add:

```js
      // Muting applies only to charts that HAVE a legend to click. Bar, line,
      // treemap and dots direct-label their marks instead.
      const LEGEND_CHARTS = new Set(['donut', 'stacked']);
      const muted = new Set(LEGEND_CHARTS.has(config.chartType) ? config.muted : []);
      const visible = muted.size ? result.rows.filter((r) => !muted.has(r.key)) : result.rows;
      // The donut prints the total in its centre — recompute it from the
      // surviving rows so the number and the ring cannot disagree.
      const shown = muted.size
        ? { ...result, rows: visible, total: visible.reduce((a, r) => a + r.value, 0) }
        : result;
```

Change the chart call to use `shown` and pass the muted keys:

```js
      const options = { mode: 'light', colourFor, title: config.title, muted: config.muted };
      ...
      const chart = renderChart(config.chartType, shown, options);
```

For the `stacked` branch, filter the series after building them:

```js
        options.series = groupOrder
          .filter((groupId) => !muted.has(groupId))
          .map((groupId) => ({ ... }));
```

but build the legend from the **unfiltered** order so a muted band can be clicked back on — pass `options.legendSeries = groupOrder.map(...)` and have `renderStacked` draw its legend from `legendSeries ?? series`.

Add the note to the returned markup, immediately after the existing concentration line:

```js
        ${muted.size ? `<p class="viz-note">${muted.size} series hidden · <button data-panel-action="unmute-all">Show all</button></p>` : ''}
```

- [ ] **Step 5: Handle the clicks in `web/overview-view.js`**

In `mountOverview`'s `click` listener, before the `[data-slice-key]` branch:

```js
    const unmute = event.target.closest('[data-panel-action="unmute-all"]');
    if (unmute) {
      const panelId = unmute.closest('[data-panel-id]')?.dataset.panelId;
      applyPanelChange(panelId, (panel) => panel.unmuteAll());
      return;
    }
    const legendItem = event.target.closest('[data-legend-key]');
    if (legendItem) {
      const panelId = legendItem.closest('[data-panel-id]')?.dataset.panelId;
      applyPanelChange(panelId, (panel) => panel.toggleMute(legendItem.dataset.legendKey));
      return;
    }
```

Add the shared helper next to `draw`, and refactor the existing `change` handler's panel branch to use it too — the same four lines are otherwise repeated:

```js
  /** Apply a mutation to one panel's config, persist it, and redraw. */
  function applyPanelChange(panelId, mutate) {
    const config = configs.find((c) => c.id === panelId);
    if (!config) return;
    const panel = createPanel(config);
    mutate(panel);
    configs = configs.map((c) => (c.id === panelId ? { ...panel.config } : c));
    savePanelConfigs(configs);
    draw();
  }
```

- [ ] **Step 6: Add the styles**

```css
.viz-legend-clickable { cursor: pointer; }
.viz-legend-clickable:hover { text-decoration: underline; }
/* Never colour-alone: a muted entry is struck through as well as dimmed. */
.viz-legend-muted { opacity: .45; text-decoration: line-through; }
```

- [ ] **Step 7: Run the whole suite**

Run: `node --test 'tests/**/*.test.js'`
Expected: PASS

- [ ] **Step 8: Verify live**

**Never run this against `data/`.**

```bash
npm run start:test
```

Confirm at <http://127.0.0.1:5174>: the Period control offers rolling windows, individual months and a custom range that only applies once both dates are set; multi-select popovers stay open while ticking boxes and their trigger text updates; tooltips work on every chart type; clicking a donut or stacked legend entry mutes it, the note appears, and **Show all** restores everything; the muted state survives a reload.

- [ ] **Step 9: Update the changelog**

Read `~/.claude/changelog-format.md` first, then add an entry to `CHANGELOG.md`.

- [ ] **Step 10: Commit**

```bash
git add web/charts/ web/panel.js web/overview-view.js web/style.css tests/overview-panels.test.js CHANGELOG.md
git commit -m "feat: mute chart series by clicking a legend entry"
```

---

## Self-Review Notes

- **Coverage:** HTML overlay tooltips (Tasks 4–5), rolling windows **and** individual months **and** a custom range (Tasks 1–2), checkbox-popover multi-select (Task 3), legend muting (Task 6).
- **Deliberately excluded:** brush-to-filter. It was not selected and no partial version is built.
- **Known limitation:** Account and Person multi-selects have no options to offer, because `accounts` is never written by any route (see `server/store.js`). A Settings screen is a separate piece of work.
- **Coordination with the design plan:** Task 5's tooltip and Task 3's popover both introduce new surfaces. `2026-08-24-design-pass.md` restyles them along with everything else — run this plan first.
