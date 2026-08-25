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

test('the "Needs review" KPI ignores excluded transactions', () => {
  const html = renderOverview(SNAPSHOT, {});
  assert.match(html, /Needs review<\/span><b class="warn">1<\/b>/,
    'expected exactly the one non-excluded unknown row to count');

  const excluded = {
    ...SNAPSHOT,
    transactions: SNAPSHOT.transactions.map((t) =>
      t.categorySource === 'unknown' ? { ...t, excluded: true } : t)
  };
  const excludedHtml = renderOverview(excluded, {});
  assert.match(excludedHtml, /Needs review<\/span><b class="">0<\/b>/,
    'excluding the only unknown row should bring the KPI to 0');
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

test('extra filters (e.g. a session-only exclude) merge into every panel and the KPI row', () => {
  const html = renderOverview(SNAPSHOT, {}, DEFAULT_PANELS, { excludeIds: ['b'] });
  assert.match(html, /-\$100\.00/);
  assert.doesNotMatch(html, /-\$300\.00/);
});

test('a hidden-count banner appears with a Show all control when something is hidden this session', () => {
  const html = renderOverview(SNAPSHOT, {}, DEFAULT_PANELS, { excludeIds: ['b'] }, 1);
  assert.match(html, /1 transaction hidden this session/);
  assert.match(html, /data-overview-action="show-all"/);
});

test('no hidden-count banner when nothing is hidden', () => {
  const html = renderOverview(SNAPSHOT, {});
  assert.doesNotMatch(html, /hidden this session/);
});

test('renderOverview shows a search box with the given query pre-filled', () => {
  const html = renderOverview(SNAPSHOT, {}, DEFAULT_PANELS, {}, 0, 'chem');
  assert.match(html, /data-search/);
  assert.match(html, /value="chem"/);
});

test('renderOverview escapes the search query', () => {
  const html = renderOverview(SNAPSHOT, {}, DEFAULT_PANELS, {}, 0, '"><script>x</script>');
  assert.doesNotMatch(html, /<script>x<\/script>/);
});

test('the search box is empty by default', () => {
  const html = renderOverview(SNAPSHOT, {});
  assert.match(html, /data-search[^>]*value=""/);
});

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

test('the Transactions tile carries its own count baseline, not the dollar one', () => {
  // July had 1 transaction, August has 1 — the count is flat while the dollars
  // are up 50%. If this tile reused the sum's delta it would read "up 50%".
  const html = renderOverviewForCompare(CMP_SNAPSHOT, AUG_FILTERS, [], {}, 0, '', 'prevPeriod');
  assert.match(html, /Transactions<\/span><b>1<\/b><span class="viz-delta[^"]*">– no change/);
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
