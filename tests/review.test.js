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
