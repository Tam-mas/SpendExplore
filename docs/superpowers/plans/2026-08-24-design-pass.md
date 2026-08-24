# Design Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app look chosen rather than defaulted, without abandoning its sober, data-first character — a real type and spacing scale, every figure in tabular monospace, a responsive panel grid that lets two panels sit side by side, full phone support, purposeful motion, and the first actual visual review of dark mode.

**Architecture:** Almost entirely `web/style.css`, driven by a token layer at the top of the file. Three things need markup: a per-panel width control (a `span` on the panel config, persisted like every other panel setting), a collapsible filter bar on narrow screens, and table wrappers that can scroll independently. Everything else is styling over the existing DOM.

**Tech Stack:** Plain CSS, no preprocessor, no build step, no dependencies.

## Global Constraints

- **No external requests, ever — this is the constraint that outranks every aesthetic preference here.** No Google Fonts, no CDN, no remote images. `tests/smoke.test.js`'s *"no UI asset references an external host"* fails the build if one appears, and it must keep passing.
- **System font stack only. No font files are added to the repo.** Distinctiveness comes from scale, weight, spacing and the monospace-figures treatment — not from a typeface.
- **Every figure is tabular.** Money, counts, dates and percentages render in `ui-monospace` with `font-variant-numeric: tabular-nums`, so columns of numbers align. In a money app this is the single highest-impact typographic change available, and it costs nothing.
- **Dark mode is not optional and not an afterthought.** Every token added here is defined in both themes in the same commit. The existing `prefers-color-scheme` block is the only mechanism — no theme toggle is being built.
- **Colour is never the only signal.** The chart palette's light-mode contrast WARN already obliges direct labels and an always-available Table view; nothing in this plan may weaken that. New states (muted, over-budget, dormant, delta direction) each carry a glyph or a word as well as a colour.
- Zero npm dependencies; no build step. Run tests with `node --test 'tests/**/*.test.js'`.
- Every new/changed test file must pass before its task's commit.
- **CSS is not unit-testable in this project — `node --test` has no DOM.** Tasks here are gated on *live* verification, and every live check uses `npm run start:test` (`DATA_DIR=./data-test`, port 5174). **Never against `data/`; never read files from outside this repo.** See `CLAUDE.md`. Where a task changes markup or config, that part **is** unit-tested.
- No comments explaining WHAT code does, only non-obvious WHY.

## Sequencing

Run **after** `2026-08-24-chart-interaction.md`. That plan introduces the tooltip, the multi-select popover and the custom-range inputs; styling them here avoids doing it twice.

---

## File Structure

| File | Change |
|---|---|
| `web/style.css` | Token layer; typography; grid; responsive rules; motion; dark-mode fixes |
| `web/panel.js` | `span` config, a width control in the panel header, `data-span` attribute |
| `web/overview-view.js` | Handle the span control; wrap tables for independent scrolling |
| `web/index.html` | `<meta name="color-scheme">`; filter-bar `<details>` wrapper on mobile |
| `web/drilldown-panel.js` | Bottom-sheet markup hook |
| `tests/overview-panels.test.js` | Extend — span config and default |
| `tests/design-tokens.test.js` | **New.** Guards the constraints that *are* mechanically checkable |

---

## Task 1: the token layer and the numeric treatment

**Files:**
- Modify: `web/style.css`
- Create: `tests/design-tokens.test.js`

**Interfaces:**
- Produces: CSS custom properties consumed by every later task — `--step--1` … `--step-4` (type), `--space-1` … `--space-6`, `--radius-sm/md/lg`, `--surface-raised`, `--font-sans`, `--font-mono`. Tasks 2–4 use these names.

**What "restrained but warmer" means concretely here:** the current palette is a neutral grey on pure white. Warming it means a paper-white background rather than `#ffffff`, ink rather than near-black, and one degree of surface separation so a card reads as a card. No new hues, no gradients, no shadow-heavy "cards on cards".

- [ ] **Step 1: Write the failing test**

Create `tests/design-tokens.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../web/style.css', import.meta.url), 'utf8');

test('no external font or asset host is referenced', () => {
  // The privacy guarantee outranks every aesthetic preference here.
  assert.doesNotMatch(css, /@import/);
  assert.doesNotMatch(css, /https?:\/\//);
  assert.doesNotMatch(css, /url\((?!['"]?data:)/);
});

test('the type and space scales are defined as tokens', () => {
  for (const token of ['--step--1', '--step-0', '--step-1', '--step-2', '--step-3', '--step-4']) {
    assert.match(css, new RegExp(`${token}\\s*:`), `missing type token ${token}`);
  }
  for (const token of ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6']) {
    assert.match(css, new RegExp(`${token}\\s*:`), `missing space token ${token}`);
  }
});

test('a monospace figure stack is defined and used for numbers', () => {
  assert.match(css, /--font-mono\s*:/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
});

test('every colour token defined in light mode is redefined in dark mode', () => {
  const darkBlock = css.slice(css.indexOf('prefers-color-scheme: dark'));
  const colourTokens = [...css.matchAll(/(--(?:bg|fg|muted|line|accent|warn|bar|surface-raised|viz-[a-z-]+))\s*:/g)]
    .map((m) => m[1]);
  const missing = [...new Set(colourTokens)].filter((token) => !darkBlock.includes(`${token}:`));
  assert.deepEqual(missing, [], `colour tokens with no dark-mode definition: ${missing.join(', ')}`);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/design-tokens.test.js`
Expected: FAIL — the type and space tokens do not exist yet

- [ ] **Step 3: Replace the token block at the top of `web/style.css`**

```css
:root {
  /* A 1.2 modular scale. Six steps is enough for a dashboard and few enough
     that every size on screen is a deliberate choice from a short list. */
  --step--1: 0.79rem;
  --step-0:  0.9375rem;   /* 15px — unchanged body size */
  --step-1:  1.125rem;
  --step-2:  1.35rem;
  --step-3:  1.62rem;
  --step-4:  1.95rem;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 40px;

  --radius-sm: 5px;
  --radius-md: 8px;
  --radius-lg: 12px;

  --font-sans: system-ui, -apple-system, "Segoe UI", sans-serif;
  /* Every figure on screen goes through this stack. Aligned columns of money
     are worth more here than any typeface could be, and it costs no bytes. */
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;

  /* Paper rather than pure white, ink rather than pure black — the one degree
     of warmth this design takes. */
  --bg: #fcfcfb;
  --fg: #1a1c1e;
  --muted: #6b7280;
  --line: #e3e5e8;
  --surface-raised: #ffffff;
  --accent: #2563eb;
  --warn: #b45309;
  --bar: #93b8f5;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16181c;
    --fg: #e8eaed;
    --muted: #9aa0a6;
    --line: #2c2f34;
    --surface-raised: #1d2025;
    --accent: #6ea8fe;
    --warn: #e0a458;
    --bar: #3b5f9e;
  }
}
```

Keep the existing `/* ---- charts ---- */` `--viz-*` block where it is, but change `--viz-surface` to `var(--surface-raised)` in both themes so a panel and a card share one definition.

- [ ] **Step 4: Apply the scale through the existing rules**

Replace the hard-coded sizes and paddings with tokens. The mechanical substitutions:

```css
body { margin: 0; background: var(--bg); color: var(--fg); font: var(--step-0)/1.55 var(--font-sans); }
header { display: flex; align-items: baseline; gap: var(--space-5); padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--line); }
h1 { font-size: var(--step-1); margin: 0; letter-spacing: -0.02em; font-weight: 600; }
main { padding: var(--space-5); max-width: 1400px; margin: 0 auto; }
.card { border: 1px solid var(--line); border-radius: var(--radius-md); padding: var(--space-4); margin-bottom: var(--space-4); background: var(--surface-raised); }
.viz-panel { border: 1px solid var(--line); border-radius: var(--radius-lg); padding: var(--space-4); background: var(--surface-raised); }
```

Note `main`'s `max-width` moves from 980px to 1400px and centres — the grid in Task 2 needs the room, and a single column at 1400px would be unreadable, which is exactly why Task 2 follows immediately.

- [ ] **Step 5: Route every figure through the mono stack**

```css
/* One rule, applied wherever a number is rendered, rather than repeated
   per component — new components inherit the treatment by using the class. */
.num, td.num, th.num,
.kpi b,
.viz-value, .viz-total, .viz-delta,
.review-meta,
.budgets-table input[type="number"] {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.kpi b { font-size: var(--step-4); font-weight: 600; line-height: 1.15; }
.kpi span { display: block; font-size: var(--step--1); text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: var(--space-1); }
.kpi { flex: 1 1 150px; border: 1px solid var(--line); border-radius: var(--radius-md); padding: var(--space-3) var(--space-4); background: var(--surface-raised); }
```

`.viz-value` and `.viz-total` are SVG `<text>` classes; `font-family` applies to SVG text exactly as it does to HTML.

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/design-tokens.test.js`
Expected: PASS, 4 tests

- [ ] **Step 7: Verify live in both themes**

**Never run this against `data/`.**

```bash
npm run start:test
```

At <http://127.0.0.1:5174>, confirm in light mode and then with the OS switched to dark: nothing is unreadable, panels separate from the page background, KPI figures align on the decimal point down the row, and the chart SVG text picks up the mono stack.

- [ ] **Step 8: Commit**

```bash
git add web/style.css tests/design-tokens.test.js
git commit -m "feat: add a design token layer and route every figure through tabular monospace"
```

---

## Task 2: the responsive panel grid

**Files:**
- Modify: `web/panel.js`, `web/overview-view.js`, `web/style.css`
- Test: `tests/overview-panels.test.js`

**Interfaces:**
- Consumes: the `applyPanelChange` helper added in the chart-interaction plan's Task 6. If that plan has not been run, add the helper here — it is four lines and is reused by three handlers.
- Produces: `createPanel` accepts `span: 'half' | 'full'` (default `'half'`, except time slices which default to `'full'`), emits `data-span` on `.viz-panel`, and renders a width control in the panel header. `renderOverview` wraps the panels in `.viz-grid-panels`.

**Why a per-panel span and not a uniform two-column grid:** a month-by-month line chart needs width to be readable and a category bar chart does not. A grid that cannot express that forces every panel to the width of the neediest one.

- [ ] **Step 1: Write the failing tests**

Append to `tests/overview-panels.test.js`:

```js
import { createPanel as createPanelForSpan } from '../web/panel.js';
import { renderOverview as renderOverviewForGrid } from '../web/overview-view.js';

const spanTxn = (over) => ({
  id: 'x', date: '2026-08-10', amount: -100, rawDescription: 'R', merchant: 'M',
  accountId: 'a', cardSuffix: null, categoryId: 'groceries', categorySource: 'rule',
  excluded: false, importId: 'i', note: null, ...over
});

const SPAN_SNAPSHOT = {
  accounts: [],
  categories: {
    groups: [{ id: 'food-drink', label: 'Food & Drink' }],
    categories: [{ id: 'groceries', label: 'Groceries', groupId: 'food-drink' }]
  },
  transactions: [spanTxn({ id: 'a' }), spanTxn({ id: 'b', date: '2026-07-10' })]
};

test('a category panel defaults to half width', () => {
  const html = createPanelForSpan({ id: 'p', title: 'T', sliceBy: 'category', measure: 'sum', chartType: 'bar' })
    .html(SPAN_SNAPSHOT, {});
  assert.match(html, /data-span="half"/);
});

test('a time-series panel defaults to full width, because a squeezed timeline is unreadable', () => {
  const html = createPanelForSpan({ id: 'p', title: 'T', sliceBy: 'month', measure: 'sum', chartType: 'line' })
    .html(SPAN_SNAPSHOT, {});
  assert.match(html, /data-span="full"/);
});

test('an explicit span overrides the default in both directions', () => {
  const wide = createPanelForSpan({ id: 'p', title: 'T', sliceBy: 'category', measure: 'sum', chartType: 'bar', span: 'full' })
    .html(SPAN_SNAPSHOT, {});
  assert.match(wide, /data-span="full"/);

  const narrow = createPanelForSpan({ id: 'p', title: 'T', sliceBy: 'month', measure: 'sum', chartType: 'line', span: 'half' })
    .html(SPAN_SNAPSHOT, {});
  assert.match(narrow, /data-span="half"/);
});

test('an unknown span value falls back to the default rather than emitting it', () => {
  const html = createPanelForSpan({ id: 'p', title: 'T', sliceBy: 'category', measure: 'sum', chartType: 'bar', span: 'enormous' })
    .html(SPAN_SNAPSHOT, {});
  assert.match(html, /data-span="half"/);
});

test('the panel header offers a width control', () => {
  const html = createPanelForSpan({ id: 'p', title: 'T', sliceBy: 'category', measure: 'sum', chartType: 'bar' })
    .html(SPAN_SNAPSHOT, {});
  assert.match(html, /data-panel-control="span"/);
});

test('setSpan changes the config and rejects nonsense', () => {
  const panel = createPanelForSpan({ id: 'p', title: 'T', sliceBy: 'category', measure: 'sum', chartType: 'bar' });
  assert.equal(panel.setSpan('full').span, 'full');
  assert.equal(panel.setSpan('sideways').span, 'full');
});

test('the panels are wrapped in a grid container', () => {
  const html = renderOverviewForGrid(SPAN_SNAPSHOT, {}, [
    { id: 'p1', title: 'A', sliceBy: 'category', measure: 'sum', chartType: 'bar' }
  ]);
  assert.match(html, /class="viz-grid-panels"/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/overview-panels.test.js`
Expected: FAIL — no `data-span`

- [ ] **Step 3: Add the span to `web/panel.js`**

Add near the other label maps:

```js
const SPANS = Object.freeze(['half', 'full']);
const SPAN_LABELS = { half: 'Half width', full: 'Full width' };

/** A squeezed timeline is unreadable, so time slices claim the full row by default. */
const defaultSpanFor = (sliceBy) => (TIME_SLICES_FOR_SPAN.has(sliceBy) ? 'full' : 'half');
const TIME_SLICES_FOR_SPAN = new Set(['week', 'month']);
```

Move `TIME_SLICES_FOR_SPAN` above `defaultSpanFor` so it is initialised first.

In `config`, add:

```js
    span: SPANS.includes(initial.span) ? initial.span : null
```

Storing `null` rather than the resolved default keeps "follow the slice's default" distinguishable from "the user chose half". Add a resolver used by `html()`:

```js
  const resolvedSpan = () => config.span ?? defaultSpanFor(config.sliceBy);
```

Add to the `panel` object:

```js
    setSpan(value) { if (SPANS.includes(value)) config.span = value; return config; },
```

Extend `selectFor`'s label lookup so it can render a fourth control — replace the inline ternary with a map:

```js
const CONTROL_LABELS = { sliceBy: 'Slice by', measure: 'Measure', chartType: 'Chart', span: 'Width' };

const selectFor = (name, options, current) => `
  <label class="viz-control">
    <span class="viz-control-label">${CONTROL_LABELS[name] ?? name}</span>
    <select data-panel-control="${name}">
      ${options.map((o) => `<option value="${escapeHtml(o.value)}"${o.value === current ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>
  </label>`;
```

In `html()`, add the control and the attribute:

```js
      const spanOptions = SPANS.map((s) => ({ value: s, label: SPAN_LABELS[s] }));
```

```js
      <section class="viz-panel" data-panel-id="${escapeHtml(config.id)}" data-span="${resolvedSpan()}">
        <header class="viz-panel-head">
          <h3>${escapeHtml(config.title)}</h3>
          <div class="viz-controls">
            ${selectFor('sliceBy', sliceOptions, config.sliceBy)}
            ${selectFor('measure', measureOptions, config.measure)}
            ${selectFor('chartType', chartOptions, config.chartType)}
            ${selectFor('span', spanOptions, resolvedSpan())}
          </div>
        </header>
```

- [ ] **Step 4: Handle the control in `web/overview-view.js`**

In the `change` listener's panel branch, add:

```js
    else if (control === 'span') panel.setSpan(target.value);
```

Wrap the panels in `renderOverview`:

```js
  const panels = `<div class="viz-grid-panels">${panelConfigs
    .map((config) => createPanel(config).html(snapshot, queryFilters, compareMode))
    .join('')}</div>`;
```

- [ ] **Step 5: Add the grid styles**

```css
.viz-grid-panels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-5);
  align-items: start;
}
.viz-panel[data-span="full"] { grid-column: 1 / -1; }
/* minmax(0, 1fr) above is what lets a wide SVG scroll inside its own
   .viz-plot instead of forcing the whole grid track wider. */
.viz-plot { overflow-x: auto; }

@media (max-width: 1100px) {
  .viz-grid-panels { grid-template-columns: minmax(0, 1fr); }
  .viz-panel[data-span="full"] { grid-column: auto; }
}
```

Remove `margin-bottom: 20px` from `.viz-panel` — the grid `gap` owns spacing now, and keeping both double-spaces the rows.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/overview-panels.test.js`
Expected: PASS

- [ ] **Step 7: Verify live**

**Never run this against `data/`.**

```bash
npm run start:test
```

Confirm: two panels sit side by side on a wide window; the "Over time" panel spans the full width by default; changing a panel's Width control moves it and the choice survives a reload; a wide line chart scrolls inside its own panel and never widens the page; below 1100px everything returns to one column.

- [ ] **Step 8: Commit**

```bash
git add web/panel.js web/overview-view.js web/style.css tests/overview-panels.test.js
git commit -m "feat: lay the Overview out as a responsive grid with per-panel width"
```

---

## Task 3: phone support

**Files:**
- Modify: `web/style.css`, `web/index.html`, `web/overview-view.js`, `web/drilldown-panel.js`

**Interfaces:**
- Produces: a `.viz-filter-bar` that collapses behind a summary below 640px; KPI tiles that stack two-up; every table wrapped in `.table-scroll`; a drill-down that becomes a bottom sheet.

**Target: usable at 375px.** Checking whether a transaction came out yet, from a phone, is a real use of this app.

- [ ] **Step 1: Wrap every table so it scrolls independently**

The page body must never scroll horizontally; a wide table scrolls inside its own box instead. In `web/charts/chart-table.js`, wrap the return value:

```js
  return `
  <div class="table-scroll">
  <table class="viz-table">
    ...
  </table>
  </div>`;
```

Do the same for the `<table>` in `web/budgets-view.js`, `web/recurring-view.js` (if the recurring plan has been run), and the drill-down table in `web/drilldown-panel.js`.

- [ ] **Step 2: Make the filter bar collapsible on narrow screens**

In `web/filter-bar.js`, wrap the bar's contents:

```js
  return `
  <details class="viz-filter-bar-wrap" open>
    <summary class="viz-filter-summary">Filters</summary>
    <div class="viz-filter-bar">
      ...existing controls...
    </div>
  </details>`;
```

`open` by default means desktop behaviour is unchanged; CSS closes it visually on mobile by hiding the summary above 640px and letting the user collapse it below.

Because `readFilterBar` queries by `[data-filter=...]` from `root`, the extra wrapper changes nothing about reading values.

- [ ] **Step 3: Add the responsive rules**

```css
.table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }

/* The summary is a mobile affordance only — on desktop the bar is always open
   and the toggle would be noise. */
.viz-filter-summary { display: none; }

@media (max-width: 640px) {
  main { padding: var(--space-3); }
  header { flex-wrap: wrap; gap: var(--space-3); padding: var(--space-3); }
  nav#tabs { display: flex; gap: var(--space-1); overflow-x: auto; width: 100%; }
  nav button { white-space: nowrap; }

  .kpis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
  .kpi b { font-size: var(--step-2); }

  .viz-filter-summary {
    display: block; cursor: pointer; font-size: var(--step--1);
    text-transform: uppercase; letter-spacing: .06em; color: var(--muted);
    padding: var(--space-2) 0;
  }
  .viz-filter-bar { flex-direction: column; gap: var(--space-3); }
  .viz-controls { width: 100%; }
  .viz-control select { width: 100%; }

  .viz-panel { padding: var(--space-3); }
  .viz-panel-head { flex-direction: column; align-items: stretch; gap: var(--space-2); }

  /* A 420px side panel on a 375px screen is a side panel in name only —
     a bottom sheet is the honest form factor. */
  .drilldown {
    top: auto; bottom: 0; left: 0; right: 0;
    width: 100vw; height: 80vh;
    border-left: none; border-top: 1px solid var(--line);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    box-shadow: 0 -4px 20px rgba(0,0,0,.22);
  }
  /* A tooltip that follows a finger is useless and covers what was tapped. */
  .viz-tooltip { display: none; }
}
```

- [ ] **Step 4: Confirm the viewport meta and add a colour-scheme hint**

`web/index.html` already has `<meta name="viewport" content="width=device-width, initial-scale=1">`. Add, immediately after it:

```html
  <meta name="color-scheme" content="light dark">
```

This makes the browser render form controls and scrollbars in the matching theme — without it, native `<select>` and `<input type="date">` stay light-on-white inside an otherwise dark page.

- [ ] **Step 5: Run the whole suite**

Run: `node --test 'tests/**/*.test.js'`
Expected: PASS. Tests asserting on table markup may need the `.table-scroll` wrapper accounted for; update assertions to match on the `<table>` rather than on the exact leading string.

- [ ] **Step 6: Verify live at phone width**

**Never run this against `data/`.**

```bash
npm run start:test
```

At <http://127.0.0.1:5174>, with the browser narrowed to 375px, confirm: **the page body never scrolls horizontally on any tab**; the tab bar scrolls instead of wrapping badly; KPI tiles sit two-up and stay legible; the filter bar collapses and every control is full width; wide tables scroll inside their own box; the drill-down opens as a bottom sheet and closes; no tooltip appears on tap.

- [ ] **Step 7: Commit**

```bash
git add web/style.css web/index.html web/filter-bar.js web/charts/chart-table.js web/budgets-view.js web/drilldown-panel.js
git commit -m "feat: make the app usable down to phone width"
```

---

## Task 4: dark-mode review and purposeful motion

**Files:**
- Modify: `web/style.css`, `web/charts/palette.js`

**Interfaces:**
- Produces: no new exports. Dark-mode token corrections and a motion layer.

**This is the first actual visual review of dark mode.** The README records that the tokens were defined but never looked at. Two things are known to need checking rather than assuming: the chart palette's dark-mode slots in `web/charts/palette.js`, which were validated by a tool but never seen; and every surface introduced since — the drill-down, the error banner, budget status badges, and the tooltip and popover from the interaction plan.

- [ ] **Step 1: Add the motion layer**

```css
/* Motion earns its place by showing WHICH bar moved when a filter changes —
   not by announcing that the page loaded. */
@media (prefers-reduced-motion: no-preference) {
  .viz-bar rect,
  .viz-stacked rect {
    transition: width 220ms cubic-bezier(.2, .7, .3, 1),
                height 220ms cubic-bezier(.2, .7, .3, 1),
                y 220ms cubic-bezier(.2, .7, .3, 1);
  }
  .viz-panel, .kpi, .card { transition: border-color 160ms ease, background-color 160ms ease; }
  nav button { transition: background-color 120ms ease, color 120ms ease; }
  .drilldown { animation: drilldown-in 180ms cubic-bezier(.2, .7, .3, 1); }
}

@keyframes drilldown-in {
  from { transform: translateX(12px); opacity: 0; }
  to   { transform: none; opacity: 1; }
}
```

**Note the real limit of this:** `draw()` replaces `root.innerHTML` wholesale, so the bars after a filter change are *new elements* and will not tween from their old values — the transition applies to hover and to attribute changes on surviving elements only. Making bars morph between filter states requires diffing rather than replacing the markup, which is a structural change well beyond a design pass. Do not attempt it here; note it and move on.

- [ ] **Step 2: Review dark mode against a real screen, and fix what is wrong**

**Never run this against `data/`.**

```bash
npm run start:test
```

Switch the OS to dark mode, reload <http://127.0.0.1:5174>, and walk every surface, fixing whatever fails. Check each of these explicitly:

1. **Chart marks against `--viz-surface`.** Open a bar, donut, treemap, stacked and dots chart. Any hue that disappears into the panel background needs its dark slot in `web/charts/palette.js` adjusted. **Do not narrow the hue separation between groups to fix a contrast problem** — the palette's group separation is what the whole colour system rests on; raise lightness instead.
2. **Direct labels on top of fills.** `.viz-tile-label` and `.viz-tile-value` are hard-coded `#ffffff` for treemap tiles. Confirm they are still readable on the lightest tile in dark mode, and if not, switch them to a token chosen per tile luminance.
3. **The drill-down panel**, which uses `box-shadow: -4px 0 16px rgba(0,0,0,.12)` — a shadow that is nearly invisible against a dark page. Deepen it in the dark block, or replace it with a stronger border.
4. **The error banner** (`--warn` background with `#fff` text) — check contrast in dark mode, where `--warn` is the lighter `#e0a458`. White on that is likely to fail; use `--bg` for the text instead.
5. **Budget status badges**, which use `color-mix(in srgb, var(--accent) 12%, transparent)`. At 12% over a dark surface the tint may be invisible; raise the percentage in the dark block.
6. **The tooltip** from the interaction plan, which is `background: var(--fg); color: var(--bg)` — an inversion that should work in both themes, but confirm it.
7. **Native form controls** — `<select>`, `<input type="date">`, checkboxes — now that `color-scheme` is set.
8. **Focus rings.** Tab through the whole page in both themes and confirm every interactive element shows a visible focus ring. Add one if any does not:

```css
:where(a, button, select, summary, input, [tabindex]):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
```

- [ ] **Step 3: Re-run the token test**

The dark-mode fixes must not introduce a colour token defined in only one theme.

Run: `node --test tests/design-tokens.test.js`
Expected: PASS

- [ ] **Step 4: Run the whole suite**

Run: `node --test 'tests/**/*.test.js'`
Expected: PASS, including `tests/smoke.test.js`'s no-external-host assertion and `tests/charts-palette.test.js`.

- [ ] **Step 5: Verify light mode did not regress**

Switch the OS back to light and walk the same eight checks. A dark-mode fix that dims a light-mode surface is a regression, not a fix.

- [ ] **Step 6: Update the README and the changelog**

The README currently says dark mode *"has validated colour tokens defined but hasn't been visually reviewed"*. That is no longer true — update that line, and remove dark mode from the **Not built yet** list.

Read `~/.claude/changelog-format.md` first, then add a `CHANGELOG.md` entry covering the whole design pass.

- [ ] **Step 7: Commit**

```bash
git add web/style.css web/charts/palette.js README.md CHANGELOG.md
git commit -m "feat: review and fix dark mode, add purposeful motion"
```

---

## Self-Review Notes

- **Coverage:** restrained-but-warmer direction (Task 1), system stack with monospace figures (Task 1), responsive grid with per-panel span (Task 2), full phone support (Task 3), dark-mode review and motion (Task 4).
- **Honest about testability:** only Tasks 1 and 2 have meaningful unit tests. Tasks 3 and 4 are gated on live checks with explicit, enumerated criteria rather than "looks good" — that is the strongest gate available without a DOM in the test runner.
- **Known limitation, stated in Task 4:** bars will not tween between filter states, because `draw()` replaces the markup wholesale. Fixing that is a rendering-architecture change, not a design change.
- **Deliberately not built:** a theme toggle. The app follows the OS, which is one fewer piece of state to persist and matches how it is actually used.
