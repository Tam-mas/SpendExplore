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

test('offers a hide-all control in the header when hideable, unchecked while some rows are visible', () => {
  const html = renderDrilldown(SNAPSHOT, { label: 'Alcohol', rows: ROWS, excludedIds: new Set() });
  assert.match(html, /data-drilldown-action="toggle-hide-all"/);
  assert.doesNotMatch(html, /toggle-hide-all"\s*checked/);
});

test('the hide-all control is checked once every row is already hidden', () => {
  const html = renderDrilldown(SNAPSHOT, { label: 'Alcohol', rows: ROWS, excludedIds: new Set(['a', 'b']) });
  assert.match(html, /toggle-hide-all"\s*checked/);
});

test('the hide-all control is absent when hideable is false', () => {
  const html = renderDrilldown(SNAPSHOT, { label: 'Alcohol', rows: ROWS, excludedIds: new Set(), hideable: false });
  assert.doesNotMatch(html, /toggle-hide-all/);
});

test('the hide-all control is unchecked, not absent, for an empty row list', () => {
  const html = renderDrilldown(SNAPSHOT, { label: 'Alcohol', rows: [], excludedIds: new Set() });
  assert.match(html, /data-drilldown-action="toggle-hide-all"/);
  assert.doesNotMatch(html, /toggle-hide-all"\s*checked/);
});

test('markRecurring defaults to false — existing callers get no mark-recurring column', () => {
  const html = renderDrilldown(SNAPSHOT, { label: 'Alcohol', rows: ROWS, excludedIds: new Set() });
  assert.doesNotMatch(html, /mark-recurring/);
});

test('markRecurring: true adds a per-row button carrying that row\'s merchant', () => {
  const html = renderDrilldown(SNAPSHOT, { label: 'Search: "dan"', rows: ROWS, excludedIds: new Set(), markRecurring: true });
  const matches = [...html.matchAll(/data-drilldown-action="mark-recurring" data-drilldown-merchant="([^"]+)"/g)];
  assert.equal(matches.length, 2);
  assert.ok(matches.every((m) => m[1] === 'Dan Murphy&#39;s'));
});

test('a merchant name is escaped in the mark-recurring button, never injected as markup', () => {
  const nasty = [{ ...ROWS[0], merchant: '<img src=x onerror=alert(1)>' }];
  const html = renderDrilldown(SNAPSHOT, { label: 'Search', rows: nasty, excludedIds: new Set(), markRecurring: true });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});
