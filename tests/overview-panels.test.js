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
